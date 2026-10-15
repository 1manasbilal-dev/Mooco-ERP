-- ============================================================================
-- Migration: 20260920000000_atomic_procurement_and_expenses.sql
-- Description: Atomic single-transaction RPCs for Milk Intake, Supplier Payments,
--              and Expense Vouchers to guarantee ACID integrity and eliminate
--              half-saved/corrupted state under unstable network conditions.
-- ============================================================================

-- 1. Atomic Milk Intake Procurement RPC
CREATE OR REPLACE FUNCTION public.procure_milk_intake_effects(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_purchase_id text := p_payload ->> 'purchase_id';
  v_supplier_id text := p_payload ->> 'supplier_id';
  v_supplier_name text := coalesce(p_payload ->> 'supplier_name', 'Unknown');
  v_date timestamptz := (p_payload ->> 'date')::timestamptz;
  v_shift text := coalesce(p_payload ->> 'shift', 'Morning');
  v_milk_type text := coalesce(p_payload ->> 'milk_type', 'Buffalo');
  v_quantity numeric := round(coalesce((p_payload ->> 'quantity')::numeric, 0), 3);
  v_rate numeric := round(coalesce((p_payload ->> 'rate')::numeric, 0), 2);
  v_fat numeric := round(coalesce((p_payload ->> 'fat')::numeric, 0), 2);
  v_snf numeric := round(coalesce((p_payload ->> 'snf')::numeric, 0), 2);
  v_total_amount numeric := round(coalesce((p_payload ->> 'total_amount')::numeric, v_quantity * v_rate), 2);
  v_paid_amount numeric := round(coalesce((p_payload ->> 'paid_amount')::numeric, 0), 2);
  v_due_amount numeric := round(coalesce((p_payload ->> 'due_amount')::numeric, greatest(0, v_total_amount - v_paid_amount)), 2);
  v_payment_mode text := p_payload ->> 'payment_mode';
  v_account_id text := p_payload ->> 'account_id';
  v_business_day_id text := p_payload ->> 'business_day_id';
  v_shift_session_id text := p_payload ->> 'shift_session_id';
  v_drawer_id text := p_payload ->> 'drawer_id';
  v_cashier_id text := p_payload ->> 'cashier_id';

  v_alloc_id text := 'alloc_' || v_purchase_id;
  v_stx_id text := 'stx_pur_' || v_purchase_id;
  v_btx_id text := 'btx_pur_' || v_purchase_id;
begin
  if v_purchase_id is null or v_purchase_id = '' then
    raise exception 'purchase_id is required.';
  end if;
  if v_supplier_id is null or v_supplier_id = '' then
    raise exception 'supplier_id is required.';
  end if;
  if v_quantity <= 0 then
    raise exception 'Quantity must be greater than 0.';
  end if;

  -- Idempotency guard: If this purchase already exists, return cleanly
  if exists (select 1 from purchases where id = v_purchase_id) then
    return jsonb_build_object('already_applied', true, 'purchase_id', v_purchase_id);
  end if;

  -- 1. Insert Purchase Document
  insert into purchases (
    id, supplier_id, date, shift, milk_type, quantity, rate, fat, snf,
    total_amount, status, business_day_id, shift_session_id, drawer_id, cashier_id, details
  ) values (
    v_purchase_id, v_supplier_id, v_date, v_shift, v_milk_type, v_quantity, v_rate, v_fat, v_snf,
    v_total_amount, 'Completed', v_business_day_id, v_shift_session_id, v_drawer_id, v_cashier_id,
    p_payload || jsonb_build_object(
      'paid_amount', v_paid_amount,
      'due_amount', v_due_amount,
      'payment_mode', v_payment_mode,
      'account_id', v_account_id
    )
  );

  -- 2. Insert Allocation Record (Unallocated status for processing/retail)
  insert into allocations (
    id, purchase_id, date, supplier_name, milk_type,
    original_quantity, remaining_quantity, allocated_quantity,
    status, average_rate, details
  ) values (
    v_alloc_id, v_purchase_id, v_date, v_supplier_name, v_milk_type,
    v_quantity, v_quantity, 0,
    'Unallocated', v_rate, jsonb_build_object('purchase_id', v_purchase_id)
  )
  on conflict (id) do nothing;

  -- 3. Supplier Khata Update for the Due Portion
  if v_due_amount > 0 then
    perform public.adjust_supplier_balance(v_supplier_id, v_due_amount);
  end if;

  -- 4. Spot Payment Handling (Supplier Transaction + Bank/Cash Transaction)
  if v_paid_amount > 0 then
    insert into supplier_transactions (
      id, supplier_id, date, type, amount, details
    ) values (
      v_stx_id, v_supplier_id, v_date, 'Payment', v_paid_amount,
      jsonb_build_object(
        'mode', coalesce(v_payment_mode, 'Cash'),
        'note', 'Spot Payment for Milk Intake (' || v_quantity || 'L ' || v_milk_type || ')',
        'purchase_id', v_purchase_id,
        'business_day_id', v_business_day_id,
        'shift_session_id', v_shift_session_id,
        'drawer_id', v_drawer_id,
        'cashier_id', v_cashier_id
      )
    )
    on conflict (id) do nothing;

    if v_account_id is not null and not exists (select 1 from bank_transactions where id = v_btx_id) then
      insert into bank_transactions (
        id, account_id, amount, date, type, category, description, reference_id,
        business_day_id, shift_session_id, drawer_id, cashier_id
      ) values (
        v_btx_id, v_account_id, v_paid_amount, v_date, 'Expense', 'Milk Purchase',
        'Milk Intake Payment: ' || v_supplier_name || ' (' || v_quantity || 'L)',
        v_purchase_id, v_business_day_id, v_shift_session_id, v_drawer_id, v_cashier_id
      );

      perform public.adjust_account_balance(v_account_id, -v_paid_amount);
    end if;
  end if;

  return jsonb_build_object(
    'applied', true,
    'purchase_id', v_purchase_id,
    'alloc_id', v_alloc_id,
    'due_added', v_due_amount,
    'paid_posted', v_paid_amount
  );
end;
$$;


-- 2. Atomic Supplier Payment Effects RPC
CREATE OR REPLACE FUNCTION public.record_supplier_payment_effects(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_tx_id text := p_payload ->> 'tx_id';
  v_supplier_id text := p_payload ->> 'supplier_id';
  v_supplier_name text := coalesce(p_payload ->> 'supplier_name', 'Supplier');
  v_amount numeric := round(coalesce((p_payload ->> 'amount')::numeric, 0), 2);
  v_date timestamptz := (p_payload ->> 'date')::timestamptz;
  v_type text := coalesce(p_payload ->> 'type', 'Payment');
  v_mode text := coalesce(p_payload ->> 'mode', 'Cash');
  v_note text := p_payload ->> 'note';
  v_account_id text := p_payload ->> 'account_id';
  v_business_day_id text := p_payload ->> 'business_day_id';
  v_shift_session_id text := p_payload ->> 'shift_session_id';
  v_drawer_id text := p_payload ->> 'drawer_id';
  v_cashier_id text := p_payload ->> 'cashier_id';

  v_btx_id text := 'btx_' || v_tx_id;
begin
  if v_tx_id is null or v_tx_id = '' then
    raise exception 'tx_id is required.';
  end if;
  if v_supplier_id is null or v_supplier_id = '' then
    raise exception 'supplier_id is required.';
  end if;
  if v_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  -- Idempotency check
  if exists (select 1 from supplier_transactions where id = v_tx_id) then
    return jsonb_build_object('already_applied', true, 'tx_id', v_tx_id);
  end if;

  -- 1. Insert into supplier_transactions
  insert into supplier_transactions (
    id, supplier_id, date, type, amount, details
  ) values (
    v_tx_id, v_supplier_id, v_date, v_type, v_amount,
    jsonb_build_object(
      'mode', v_mode,
      'note', v_note,
      'account_id', v_account_id,
      'business_day_id', v_business_day_id,
      'shift_session_id', v_shift_session_id,
      'drawer_id', v_drawer_id,
      'cashier_id', v_cashier_id
    )
  );

  -- 2. Deduct Supplier Payable Balance
  perform public.adjust_supplier_balance(v_supplier_id, -v_amount);

  -- 3. Deduct Financial Account (Cash/Bank)
  if v_account_id is not null and not exists (select 1 from bank_transactions where id = v_btx_id) then
    insert into bank_transactions (
      id, account_id, amount, date, type, category, description, reference_id,
      business_day_id, shift_session_id, drawer_id, cashier_id
    ) values (
      v_btx_id, v_account_id, v_amount, v_date, 'Expense', 'Supplier Payment',
      'Supplier Payment: ' || v_supplier_name || coalesce(' (' || v_note || ')', ''),
      v_tx_id, v_business_day_id, v_shift_session_id, v_drawer_id, v_cashier_id
    );

    perform public.adjust_account_balance(v_account_id, -v_amount);
  end if;

  return jsonb_build_object('applied', true, 'tx_id', v_tx_id);
end;
$$;


-- 3. Atomic Expense Effects RPC
CREATE OR REPLACE FUNCTION public.record_expense_effects(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_expense_id text := p_payload ->> 'expense_id';
  v_date timestamptz := (p_payload ->> 'date')::timestamptz;
  v_category text := coalesce(p_payload ->> 'category', 'General');
  v_amount numeric := round(coalesce((p_payload ->> 'amount')::numeric, 0), 2);
  v_paid_amount numeric := round(coalesce((p_payload ->> 'paid_amount')::numeric, 0), 2);
  v_description text := coalesce(p_payload ->> 'description', '');
  v_account_id text := p_payload ->> 'account_id';
  v_account_name text := p_payload ->> 'account_name';
  v_vendor_id text := p_payload ->> 'vendor_id';
  v_vendor_name text := p_payload ->> 'vendor_name';
  v_business_day_id text := p_payload ->> 'business_day_id';
  v_shift_session_id text := p_payload ->> 'shift_session_id';
  v_drawer_id text := p_payload ->> 'drawer_id';
  v_cashier_id text := p_payload ->> 'cashier_id';

  v_unpaid numeric := greatest(0, v_amount - v_paid_amount);
  v_btx_id text := 'btx_' || v_expense_id;
begin
  if v_expense_id is null or v_expense_id = '' then
    raise exception 'expense_id is required.';
  end if;
  if v_amount < 0 then
    raise exception 'Expense amount cannot be negative.';
  end if;

  -- Idempotency check
  if exists (select 1 from expenses where id = v_expense_id) then
    return jsonb_build_object('already_applied', true, 'expense_id', v_expense_id);
  end if;

  -- 1. Insert into expenses
  insert into expenses (
    id, date, category, amount, description, details,
    business_day_id, shift_session_id, drawer_id, cashier_id
  ) values (
    v_expense_id, v_date, v_category, v_amount, v_description,
    p_payload,
    v_business_day_id, v_shift_session_id, v_drawer_id, v_cashier_id
  );

  -- 2. If vendor associated, adjust stats
  if v_vendor_id is not null then
    perform public.adjust_expense_vendor_stats(v_vendor_id, v_unpaid, v_amount, v_paid_amount);
  end if;

  -- 3. If paid from cash/bank, insert bank_transaction and deduct balance
  if v_paid_amount > 0 and v_account_id is not null and not exists (select 1 from bank_transactions where id = v_btx_id) then
    insert into bank_transactions (
      id, account_id, amount, date, type, category, description, reference_id,
      business_day_id, shift_session_id, drawer_id, cashier_id
    ) values (
      v_btx_id, v_account_id, v_paid_amount, v_date, 'Expense', v_category,
      'Expense: ' || v_description || coalesce(' (' || v_vendor_name || ')', ''),
      v_expense_id, v_business_day_id, v_shift_session_id, v_drawer_id, v_cashier_id
    );

    perform public.adjust_account_balance(v_account_id, -v_paid_amount);
  end if;

  return jsonb_build_object('applied', true, 'expense_id', v_expense_id);
end;
$$;
