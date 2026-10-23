-- Customer bad-debt write-off and supplier settlement in one transaction each (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- Before: archiving a customer with a balance wrote the khata row, a bad-debt expense and the
-- balance move as three browser calls (undone one by one on failure), then deactivated the customer
-- in a fourth. Settling a supplier did the same with two writes plus the deactivation. A dropped
-- connection could leave a write-off row with the balance unmoved, or the balance cleared on a
-- customer still active.
--
-- Both functions lock the party row, write off the balance the server holds (never the screen's
-- copy), and deactivate in the same transaction. p_write_off_id / p_settle_id make a retry after a
-- lost response a no-op. Need customers:delete / suppliers:delete (the archive buttons' rights).

create or replace function public.write_off_customer_balance(p_customer_id text, p_write_off_id text, p_deactivate boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust customers;
  v_bal numeric;
  v_now timestamptz := now();
  v_tx_id text := 'ctx_wo_' || p_write_off_id;
  v_kind text := 'none';
begin
  perform app_private.assert_can('customers', 'delete', 'customer archive / write off karne');
  if nullif(p_write_off_id, '') is null then raise exception 'write-off id zaroori hai.'; end if;

  select * into v_cust from customers where id = p_customer_id for update;
  if not found then raise exception 'Customer nahi mila. Page reload karein.'; end if;
  if exists (select 1 from customer_transactions where id = v_tx_id) then
    return jsonb_build_object('already_applied', true, 'customer_id', p_customer_id, 'balance', v_cust.balance, 'is_active', v_cust.is_active);
  end if;

  v_bal := round(coalesce(v_cust.balance, 0), 2);
  if abs(v_bal) >= 0.01 then
    perform app_private.assert_books_open(v_now, null);
  end if;

  if v_bal >= 0.01 then
    -- The customer owes us: the khata is cleared and the loss is a non-cash bad-debt expense
    -- (settled in full, no account), so the balance sheet still balances.
    v_kind := 'bad_debt';
    insert into customer_transactions (id, customer_id, date, type, amount, details)
    values (v_tx_id, p_customer_id, v_now, 'Payment', v_bal, jsonb_build_object(
      'mode', 'Bad Debt Write-Off',
      'note', 'Khata balance written off as bad debt expense (Customer Archived)',
      'is_write_off', true
    ));
    insert into expenses (id, date, category, amount, description, details)
    values (
      'exp_wo_' || p_write_off_id, v_now, 'Bad Debt & Write-off', v_bal,
      'Bad debt write-off for customer: ' || coalesce(v_cust.name, p_customer_id),
      jsonb_build_object(
        'expense_id', 'exp_wo_' || p_write_off_id, 'customer_id', p_customer_id, 'write_off', true,
        'amount', v_bal, 'paid_amount', v_bal, 'payment_mode', 'Adjustment', 'payment_status', 'Paid',
        'category', 'Bad Debt & Write-off', 'description', 'Bad debt write-off for customer: ' || coalesce(v_cust.name, p_customer_id)
      )
    );
    perform public.adjust_customer_balance(p_customer_id, -v_bal);
  elsif v_bal <= -0.01 then
    -- An unclaimed advance we hold is forfeited.
    v_kind := 'advance_forfeit';
    insert into customer_transactions (id, customer_id, date, type, amount, details)
    values (v_tx_id, p_customer_id, v_now, 'Charge', abs(v_bal), jsonb_build_object(
      'mode', 'Advance Forfeited',
      'note', 'Unclaimed customer advance forfeited upon archival',
      'is_write_off', true
    ));
    perform public.adjust_customer_balance(p_customer_id, abs(v_bal));
  end if;

  if coalesce(p_deactivate, true) then
    update customers set is_active = false where id = p_customer_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'customer_id', p_customer_id,
    'kind', v_kind,
    'written_off', v_bal,
    'balance', (select balance from customers where id = p_customer_id),
    'is_active', not coalesce(p_deactivate, true) and coalesce(v_cust.is_active, true)
  );
end;
$$;

create or replace function public.settle_supplier_balance(p_supplier_id text, p_settle_id text, p_deactivate boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup suppliers;
  v_bal numeric;
  v_now timestamptz := now();
  v_tx_id text := 'stx_wo_' || p_settle_id;
  v_kind text := 'none';
begin
  perform app_private.assert_can('suppliers', 'delete', 'supplier ka hisaab settle / archive karne');
  if nullif(p_settle_id, '') is null then raise exception 'settle id zaroori hai.'; end if;

  select * into v_sup from suppliers where id = p_supplier_id for update;
  if not found then raise exception 'Supplier nahi mila. Page reload karein.'; end if;
  if exists (select 1 from supplier_transactions where id = v_tx_id) then
    return jsonb_build_object('already_applied', true, 'supplier_id', p_supplier_id, 'balance', v_sup.balance, 'is_active', v_sup.is_active);
  end if;

  v_bal := round(coalesce(v_sup.balance, 0), 2);
  if abs(v_bal) >= 0.01 then
    perform app_private.assert_books_open(v_now, null);
    -- We owe (bal > 0): a waiver Payment settles the khata with no money leaving an account
    -- (waiver: true keeps it out of the cash-paid register and of any reversal on delete).
    -- The supplier holds our advance (bal < 0): it is written off with a Charge.
    v_kind := case when v_bal > 0 then 'waiver' else 'advance_written_off' end;
    insert into supplier_transactions (id, supplier_id, date, type, amount, details)
    values (
      v_tx_id, p_supplier_id, v_now, case when v_bal > 0 then 'Payment' else 'Charge' end, abs(v_bal),
      case when v_bal > 0
        then jsonb_build_object('mode', 'Supplier Waiver / Discount', 'note', 'Payable balance settled via discount waiver prior to vendor archival', 'waiver', true)
        else jsonb_build_object('mode', 'Advance Written Off', 'note', 'Unrecovered advance written off prior to supplier archival', 'waiver', true)
      end
    );
    perform public.adjust_supplier_balance(p_supplier_id, -v_bal);
  end if;

  if coalesce(p_deactivate, true) then
    update suppliers set is_active = false where id = p_supplier_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'supplier_id', p_supplier_id,
    'kind', v_kind,
    'settled', v_bal,
    'balance', (select balance from suppliers where id = p_supplier_id),
    'is_active', not coalesce(p_deactivate, true) and coalesce(v_sup.is_active, true)
  );
end;
$$;

revoke all on function public.write_off_customer_balance(text, text, boolean) from public, anon;
revoke all on function public.settle_supplier_balance(text, text, boolean) from public, anon;
grant execute on function public.write_off_customer_balance(text, text, boolean) to authenticated, service_role;
grant execute on function public.settle_supplier_balance(text, text, boolean) to authenticated, service_role;
