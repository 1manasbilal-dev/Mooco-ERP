-- Two money-posting fixes (2026-10-23).
--
-- 1. change_sale_payment_mode moved the bill's money from the "old" account the client named,
--    whether or not that account had ever received it. When the bill's receipt (btx_<sale>) was
--    not on the server yet (the sale row synced, its effects not yet / never applied) the old
--    account was debited for cash it never got, and the later pos_sync_order_effects skipped the
--    receipt because the function had just created btx_<sale> on the new account: the old
--    account ended short by the bill amount. The function now takes the source account and amount
--    from the receipt row itself (locked) and, when there is no receipt yet, only credits the new
--    account. The client's p_old_account_id is no longer trusted.
-- 2. post_customer_order_advance used the client's tx id, built from the client's copy of
--    advance_paid. A counter with a stale copy (advance raised on another counter) sent the id of
--    an advance level that was already posted; record_customer_payment_effects then returned
--    "already_applied" and did nothing, yet advance_posted was still raised, so the extra advance
--    never reached the khata or the cash account. The id is now derived from the server's
--    advance_paid (the same format the client uses, so a retry stays idempotent), and an
--    "already applied" answer aborts instead of marking the advance posted.
--
-- CREATE OR REPLACE keeps the existing grants.

create or replace function public.change_sale_payment_mode(
  p_sale_id text,
  p_new_mode text,
  p_old_account_id text,
  p_new_account_id text,
  p_amount numeric,
  p_btx_id text default null::text,
  p_btx jsonb default '{}'::jsonb,
  p_event jsonb default null::jsonb,
  p_details jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales;
  v_btx public.bank_transactions;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_moved numeric;
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

  -- The bill's own receipt row says where its money is now. Refund rows (btx_ret_*) also point
  -- at the sale, so only an Income row counts. The client's p_btx_id only breaks a tie.
  select * into v_btx
  from public.bank_transactions b
  where b.id = 'btx_' || p_sale_id
     or (b.reference_id = p_sale_id and b.type = 'Income' and b.id not like 'btx\_ret%')
  order by (b.id = p_btx_id) desc nulls last, (b.id = 'btx_' || p_sale_id) desc, b.created_at
  limit 1
  for update;

  if v_btx.id is not null then
    v_moved := round(coalesce(v_btx.amount, 0), 2);

    if p_new_account_id is not null and v_moved > 0
       and v_btx.account_id is distinct from p_new_account_id then
      perform 1 from public.financial_accounts
      where id in (v_btx.account_id, p_new_account_id)
      order by id
      for update;

      if v_btx.account_id is not null then
        update public.financial_accounts set balance = round(coalesce(balance, 0) - v_moved, 2)
        where id = v_btx.account_id;
        if not found then raise exception 'Purana account nahi mila.'; end if;
      end if;

      update public.financial_accounts set balance = round(coalesce(balance, 0) + v_moved, 2)
      where id = p_new_account_id;
      if not found then raise exception 'Naya account nahi mila.'; end if;
    end if;

    if p_new_account_id is not null then
      update public.bank_transactions
      set account_id = p_new_account_id,
          category = coalesce(p_btx->>'category', category),
          description = coalesce(p_btx->>'description', description)
      where id = v_btx.id;
    end if;
  elsif v_amount > 0 and p_new_account_id is not null then
    -- No receipt on the server yet: the money never reached any account, so it only goes into
    -- the new one. pos_sync_order_effects will find btx_<sale> and not post it again.
    if not exists (select 1 from public.financial_accounts where id = p_new_account_id) then
      raise exception 'Naya account nahi mila.';
    end if;
    insert into public.bank_transactions (
      id, account_id, amount, date, type, category, description, reference_id,
      business_day_id, shift_session_id, drawer_id, cashier_id
    ) values (
      'btx_' || p_sale_id, p_new_account_id, v_amount,
      coalesce(v_sale.date, now()), 'Income',
      p_btx->>'category', p_btx->>'description', p_sale_id,
      nullif(p_btx->>'business_day_id', ''), nullif(p_btx->>'shift_session_id', ''),
      nullif(p_btx->>'drawer_id', ''), nullif(p_btx->>'cashier_id', '')
    );
    perform public.adjust_account_balance(p_new_account_id, v_amount);
    v_moved := v_amount;
  end if;

  -- Audit trail only; expected drawer cash follows the bill's mode and ignores payment_correction events.
  if p_event is not null and coalesce(v_moved, 0) > 0 then
    insert into public.shift_cash_events (
      id, business_day_id, shift_id, drawer_id, event_type, direction, amount,
      payment_mode, source_type, source_id, description, occurred_at, created_by
    ) values (
      p_event->>'id', p_event->>'business_day_id', nullif(p_event->>'shift_id', ''),
      p_event->>'drawer_id', 'Payment Mode Correction', p_event->>'direction', v_moved,
      'Cash', 'payment_correction', p_sale_id, p_event->>'description', now(),
      nullif(p_event->>'created_by', '')
    )
    on conflict (id) do nothing;
  end if;

  update public.sales
  set payment_mode = p_new_mode,
      details = coalesce(p_details, details)
  where id = p_sale_id;

  return jsonb_build_object('success', true, 'amount', coalesce(v_moved, 0));
end;
$function$;

create or replace function public.post_customer_order_advance(
  p_order_id text,
  p_tx_id text,
  p_account_id text,
  p_business_day_id text default null::text,
  p_shift_session_id text default null::text,
  p_drawer_id text default null::text,
  p_cashier_id text default null::text
)
returns customer_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.customer_orders;
  v_delta numeric;
  v_tx_id text;
  v_result jsonb;
begin
  select * into v_order from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Customer order not found.'; end if;

  v_delta := round(coalesce(v_order.advance_paid, 0) - coalesce(v_order.advance_posted, 0), 2);
  if v_delta <= 0 then
    return v_order;
  end if;
  if v_order.status in ('Completed', 'Cancelled') then
    raise exception 'Completed or cancelled orders cannot take an advance.';
  end if;
  if p_account_id is null or not exists (
    select 1 from public.financial_accounts where id = p_account_id and type in ('Cash', 'Bank', 'Wallet')
  ) then
    raise exception 'Choose a valid account to receive the advance.';
  end if;

  -- One id per advance level, taken from the locked row (advance_posted only ever rises to
  -- advance_paid, so a level is posted at most once). p_tx_id is kept for the signature.
  v_tx_id := 'ctx_adv_' || v_order.id || '_' || round(coalesce(v_order.advance_paid, 0) * 100)::bigint;

  v_result := public.record_customer_payment_effects(
    v_tx_id, v_order.customer_id, v_delta, now()::text, 'Payment',
    jsonb_build_object(
      'mode', coalesce(nullif(v_order.payment_mode, 'Unpaid'), 'Cash'),
      'note', 'Advance for order ' || v_order.order_number || coalesce(' · ' || nullif(v_order.payment_notes, ''), ''),
      'account_id', p_account_id,
      'description', 'Order advance: ' || v_order.customer_name || ' (' || v_order.order_number || ')',
      'customer_order_id', v_order.id,
      'source', 'customer_order_advance'
    ),
    p_account_id, p_business_day_id, p_shift_session_id, p_drawer_id, p_cashier_id
  );
  if coalesce((v_result->>'already_applied')::boolean, false) then
    raise exception 'Advance entry % pehle se mojood hai. Order dobara kholein aur phir koshish karein.', v_tx_id;
  end if;

  perform set_config('mooco.posting_advance', 'on', true);
  update public.customer_orders set advance_posted = advance_paid where id = p_order_id
  returning * into v_order;
  perform set_config('mooco.posting_advance', 'off', true);
  return v_order;
end;
$function$;
