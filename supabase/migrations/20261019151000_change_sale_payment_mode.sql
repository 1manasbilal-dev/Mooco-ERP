-- Atomic Cash <-> Online correction for a POS bill.
-- Before this, the client ran two balance RPCs, a bank_transactions write, a shift event insert and the
-- sales update as separate calls with no error checks, so a failure in the middle moved money without
-- moving the bill (or the other way round). This locks the bill, refuses returned bills, and does every
-- write in one transaction. Idempotent: a retry after success sees the new mode and returns unchanged.

create or replace function public.change_sale_payment_mode(
  p_sale_id text,
  p_new_mode text,
  p_old_account_id text,
  p_new_account_id text,
  p_amount numeric,
  p_btx_id text default null,
  p_btx jsonb default '{}'::jsonb,
  p_event jsonb default null,
  p_details jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale public.sales;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  if p_new_mode not in ('Cash', 'Online') then
    raise exception 'Payment mode sirf Cash ya Online ho sakta hai.';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Bill server par nahi mila. Sync mukammal hone ke baad koshish karein.';
  end if;
  if coalesce(v_sale.payment_mode, 'Cash') = p_new_mode then
    return jsonb_build_object('success', true, 'unchanged', true);
  end if;
  if v_sale.status in ('Returned', 'Partially Returned') or coalesce(v_sale.refund_amount, 0) > 0 then
    raise exception 'Returned bill ka payment mode nahi badla ja sakta.';
  end if;

  if v_amount > 0 and p_old_account_id is not null and p_new_account_id is not null
     and p_old_account_id <> p_new_account_id then
    perform 1 from public.financial_accounts
    where id in (p_old_account_id, p_new_account_id)
    order by id
    for update;

    update public.financial_accounts set balance = round(coalesce(balance, 0) - v_amount, 2)
    where id = p_old_account_id;
    if not found then raise exception 'Purana account nahi mila.'; end if;

    update public.financial_accounts set balance = round(coalesce(balance, 0) + v_amount, 2)
    where id = p_new_account_id;
    if not found then raise exception 'Naya account nahi mila.'; end if;
  end if;

  if v_amount > 0 and p_new_account_id is not null then
    if p_btx_id is not null and exists (select 1 from public.bank_transactions where id = p_btx_id) then
      update public.bank_transactions
      set account_id = p_new_account_id,
          category = coalesce(p_btx->>'category', category),
          description = coalesce(p_btx->>'description', description)
      where id = p_btx_id;
    else
      insert into public.bank_transactions (
        id, account_id, amount, date, type, category, description, reference_id,
        business_day_id, shift_session_id, drawer_id, cashier_id
      ) values (
        'btx_' || p_sale_id, p_new_account_id, v_amount,
        coalesce(v_sale.date, now()), 'Income',
        p_btx->>'category', p_btx->>'description', p_sale_id,
        nullif(p_btx->>'business_day_id', ''), nullif(p_btx->>'shift_session_id', ''),
        nullif(p_btx->>'drawer_id', ''), nullif(p_btx->>'cashier_id', '')
      )
      on conflict (id) do update
      set account_id = excluded.account_id,
          category = excluded.category,
          description = excluded.description;
    end if;
  end if;

  -- Audit trail only; expected drawer cash follows the bill's mode and ignores payment_correction events.
  if p_event is not null and v_amount > 0 then
    insert into public.shift_cash_events (
      id, business_day_id, shift_id, drawer_id, event_type, direction, amount,
      payment_mode, source_type, source_id, description, occurred_at, created_by
    ) values (
      p_event->>'id', p_event->>'business_day_id', nullif(p_event->>'shift_id', ''),
      p_event->>'drawer_id', 'Payment Mode Correction', p_event->>'direction', v_amount,
      'Cash', 'payment_correction', p_sale_id, p_event->>'description', now(),
      nullif(p_event->>'created_by', '')
    )
    on conflict (id) do nothing;
  end if;

  update public.sales
  set payment_mode = p_new_mode,
      details = coalesce(p_details, details)
  where id = p_sale_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.change_sale_payment_mode(text, text, text, text, numeric, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.change_sale_payment_mode(text, text, text, text, numeric, text, jsonb, jsonb, jsonb) to anon, authenticated;
