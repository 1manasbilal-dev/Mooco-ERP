-- Expense edit in one transaction (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- Before: updateExpense deleted the old bank row, put the old payment back, undid the old vendor
-- figures, wrote the new bank row, took the new payment, added the new vendor figures and finally
-- saved the voucher: up to 7 browser calls, each undone by hand if a later one failed. A dropped
-- connection (or a failed undo) left the money moved twice or the voucher out of step with its
-- bank row.
--
-- update_expense locks the voucher, undoes the old payment from the ledger rows that actually exist
-- for it (id 'btx_<expense>' or reference_id = expense), undoes the old vendor figures, saves the
-- edit and posts the new payment and vendor figures, all together. Payment fields stay in
-- expenses.details (snake_case, the shape record_expense_effects writes and the loader reads).
-- A closed shift or a locked day / closed books (old or new date) is refused. p_edit_id makes a
-- retry after a lost response a no-op. Needs expenses:edit.

create or replace function public.update_expense(p_expense_id text, p_edit_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp expenses;
  v_old jsonb;
  v_old_amount numeric;
  v_old_paid numeric;
  v_old_vendor text;
  v_btx record;
  v_shift_status text;

  v_date timestamptz := coalesce(nullif(p_payload->>'date', '')::timestamptz, now());
  v_category text := coalesce(nullif(p_payload->>'category', ''), 'General');
  v_amount numeric := round(coalesce((p_payload->>'amount')::numeric, 0), 2);
  v_status text := nullif(p_payload->>'payment_status', '');
  v_paid numeric;
  v_description text := coalesce(p_payload->>'description', '');
  v_account_id text := nullif(p_payload->>'account_id', '');
  v_vendor_id text := nullif(p_payload->>'vendor_id', '');
  v_vendor_name text := nullif(p_payload->>'vendor_name', '');
  v_details jsonb;
  v_btx_id text := 'btx_' || p_expense_id;
begin
  perform app_private.assert_can('expenses', 'edit', 'kharcha badalne');
  if nullif(p_expense_id, '') is null then raise exception 'expense id zaroori hai.'; end if;
  if nullif(p_edit_id, '') is null then raise exception 'edit id zaroori hai.'; end if;

  select * into v_exp from expenses where id = p_expense_id for update;
  if not found then raise exception 'Kharcha nahi mila. Page reload karein.'; end if;

  v_old := coalesce(v_exp.details, '{}'::jsonb);
  if coalesce(v_old->'edit_ids', '[]'::jsonb) ? p_edit_id then
    return jsonb_build_object('already_applied', true, 'expense_id', p_expense_id,
      'date', v_exp.date, 'amount', v_exp.amount, 'paid_amount', v_old->'paid_amount',
      'payment_status', v_old->>'payment_status', 'details', v_old);
  end if;

  if v_exp.shift_session_id is not null then
    select status into v_shift_status from cash_shifts where id = v_exp.shift_session_id;
    if v_shift_status in ('Closed', 'Force Closed') then
      raise exception 'Ye kharcha band shift ka hai; drawer ka hisaab ho chuka. Edit ki jagah ulti (reversal) entry karein.';
    end if;
  end if;
  perform app_private.assert_books_open(v_exp.date, v_exp.business_day_id);
  perform app_private.assert_books_open(v_date, null);

  if v_amount < 0 then raise exception 'Kharche ki raqam manfi nahi ho sakti.'; end if;
  v_paid := case when lower(coalesce(v_status, '')) = 'unpaid' then 0
                 else round(coalesce(nullif(p_payload->>'paid_amount', '')::numeric, v_amount), 2) end;
  if v_paid < 0 or v_paid > v_amount + 0.01 then
    raise exception 'Paid raqam (Rs %) kharche (Rs %) se zyada ya manfi nahi ho sakti.', v_paid, v_amount;
  end if;
  v_paid := least(v_paid, v_amount);
  v_status := case when v_paid <= 0 then 'Unpaid' when v_paid < v_amount then 'Partial' else 'Paid' end;
  -- A paid voucher with no account (a bad-debt write-off, an old entry) moves no money, as when it
  -- was recorded by record_expense_effects.
  if v_vendor_id is not null and not exists (select 1 from expense_vendors where id = v_vendor_id) then
    raise exception 'Vendor nahi mila.';
  end if;

  -- 1. Undo the old payment from the ledger rows that exist for this voucher.
  for v_btx in
    select id from bank_transactions
    where id = v_btx_id or reference_id = p_expense_id
    order by id
    for update
  loop
    perform app_private.reverse_bank_tx(v_btx.id);
  end loop;

  -- 2. Undo the old vendor figures (the same figures the loader shows for the old voucher).
  v_old_amount := round(coalesce(v_exp.amount, (v_old->>'amount')::numeric, 0), 2);
  v_old_paid := case
    when lower(coalesce(v_old->>'payment_status', v_old->>'paymentStatus', '')) = 'unpaid' then 0
    else round(coalesce((v_old->>'paid_amount')::numeric, (v_old->>'paidAmount')::numeric, v_old_amount), 2)
  end;
  v_old_vendor := nullif(v_old->>'vendor_id', '');
  if v_old_vendor is not null then
    perform public.adjust_expense_vendor_stats(v_old_vendor, -greatest(0, v_old_amount - v_old_paid), -v_old_amount, -v_old_paid);
  end if;

  -- 3. Save the edit. The camelCase copies an older client wrote are dropped so the loader cannot
  --    read a stale paidAmount; the shift tags stay the voucher's own.
  v_details := (v_old - 'paidAmount' - 'paymentStatus' - 'edit_ids')
    || (coalesce(p_payload, '{}'::jsonb) - 'expense_id' - 'edit_ids' - 'paidAmount' - 'paymentStatus'
        - 'business_day_id' - 'shift_session_id' - 'drawer_id' - 'cashier_id')
    || jsonb_build_object(
         'expense_id', p_expense_id,
         'date', v_date,
         'category', v_category,
         'amount', v_amount,
         'paid_amount', v_paid,
         'payment_status', v_status,
         'description', v_description,
         'account_id', case when v_paid > 0 then v_account_id end,
         'account_name', case when v_paid > 0 then p_payload->>'account_name' end,
         'vendor_id', v_vendor_id,
         'vendor_name', v_vendor_name,
         'business_day_id', v_exp.business_day_id,
         'shift_session_id', v_exp.shift_session_id,
         'drawer_id', v_exp.drawer_id,
         'cashier_id', v_exp.cashier_id,
         'edit_ids', coalesce(v_old->'edit_ids', '[]'::jsonb) || to_jsonb(p_edit_id),
         'edited_at', now()
       );

  update expenses
  set date = v_date,
      category = v_category,
      amount = v_amount,
      description = v_description,
      details = v_details
  where id = p_expense_id;

  -- 4. New vendor figures and payment.
  if v_vendor_id is not null then
    perform public.adjust_expense_vendor_stats(v_vendor_id, greatest(0, v_amount - v_paid), v_amount, v_paid);
  end if;
  if v_paid > 0 and v_account_id is not null then
    perform app_private.post_bank_tx(
      v_btx_id, v_account_id, 'Expense', v_paid, v_date, v_category,
      'Expense: ' || v_description || coalesce(' (' || v_vendor_name || ')', ''),
      p_expense_id, v_exp.business_day_id, v_exp.shift_session_id, v_exp.drawer_id, v_exp.cashier_id
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'expense_id', p_expense_id,
    'date', v_date,
    'amount', v_amount,
    'paid_amount', v_paid,
    'payment_status', v_status,
    'details', v_details
  );
end;
$$;

revoke all on function public.update_expense(text, text, jsonb) from public, anon;
grant execute on function public.update_expense(text, text, jsonb) to authenticated, service_role;
