-- process_sales_return: the server decides what the client used to (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- 20261019153000 already locks the bill and applies the whole return in one transaction, and
-- refuses a returned qty above "sold - already returned" per line. It still trusted the client for:
--   * the bill's new status (a stale or buggy client could mark a half-returned bill 'Returned',
--     which then refuses every later return and payment-mode change),
--   * the refund size (only capped at the bill total, not at the value of the returned lines),
--   * the cash part (a client could pay out cash for a credit bill that was never collected),
--   * stock moves on unknown items (adjust_item_stock silently skips them),
--   * rights and the day lock (any operator, any day).
-- Now: the status comes from the bill's lines; the refund is capped at the returned lines' sold
-- value after the bill discount; cash/online refund never exceeds what was actually collected and
-- not yet refunded (khata is reversed first, the client's splitRefund rule); unknown items and
-- wrong-direction stock moves raise; the operator needs sales_history:return; a locked day or
-- closed books refuse. Same signature, so the live client keeps working.

create or replace function public.process_sales_return(p_sale_id text, p_return_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales;
  v_line jsonb;
  v_move jsonb;
  v_key text;
  v_sold numeric;
  v_back numeric;
  v_new numeric;
  v_price numeric;
  v_gross numeric := 0;
  v_ratio numeric;
  v_max_refund numeric;
  v_total numeric;
  v_collected numeric;
  v_khata_charged numeric;
  v_prior_refund numeric;
  v_khata_left numeric;
  v_cash_cap numeric;
  v_is_replace boolean := coalesce(p_payload->>'return_type', '') = 'replace';
  v_refund numeric := round(coalesce((p_payload->>'refund_amount')::numeric, 0), 2);
  v_khata numeric := round(coalesce((p_payload #>> '{khata,amount}')::numeric, 0), 2);
  v_cash numeric := round(coalesce((p_payload #>> '{cash,amount}')::numeric, 0), 2);
  v_new_items jsonb := coalesce(p_payload->'returned_items', '[]'::jsonb);
  v_all_items jsonb;
  v_status text;
  v_full boolean;
  v_any_back boolean;
begin
  perform app_private.assert_can('sales_history', 'return', 'sales return karne');
  if p_return_id is null or p_return_id = '' then raise exception 'return id zaroori hai.'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Bill server par nahi mila. Sync mukammal hone ke baad return karein.';
  end if;
  if coalesce(v_sale.details->'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true, 'status', v_sale.status, 'refund_amount', coalesce(v_sale.refund_amount, 0));
  end if;
  if v_sale.status = 'Returned' then
    raise exception 'Ye bill pehle hi poora return ho chuka hai.';
  end if;
  perform app_private.assert_books_open(now(), nullif(p_payload->>'business_day_id', ''));
  if jsonb_typeof(v_new_items) <> 'array' or jsonb_array_length(v_new_items) = 0 then
    raise exception 'Return ke liye koi item select nahi hua.';
  end if;
  if v_refund < 0 or v_khata < 0 or v_cash < 0 or round(v_khata + v_cash, 2) > v_refund + 0.01 then
    raise exception 'Refund ki raqam ghalat hai.';
  end if;
  if v_is_replace and v_refund > 0 then
    raise exception 'Replacement mein raqam wapas nahi hoti.';
  end if;
  if round(coalesce(v_sale.refund_amount, 0) + v_refund, 2) > coalesce(v_sale.total, 0) + 0.01 then
    raise exception 'Refund bill ki raqam se zyada nahi ho sakta.';
  end if;

  -- Every line in its own sold unit: earlier returns and replacements plus this one cannot exceed what was sold.
  for v_line in select value from jsonb_array_elements(v_new_items) loop
    -- Same key the return screen uses: the sold line's itemId (copied onto the returned line), else its name.
    v_key := coalesce(nullif(v_line->>'itemId', ''), lower(v_line->>'name')) || '|' || coalesce(nullif(v_line->>'variantId', ''), '');
    v_new := coalesce((v_line->>'qty')::numeric, 0);
    if v_new <= 0 then raise exception 'Return qty 0 se zyada honi chahiye.'; end if;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0), coalesce(max(coalesce((x->>'price')::numeric, 0)), 0)
    into v_sold, v_price
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_key;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0) into v_back
    from jsonb_array_elements(coalesce(v_sale.details->'returned_items', '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_key;

    if v_back + v_new > v_sold + 0.0005 then
      raise exception '% ki sirf % qty wapas ho sakti hai.', coalesce(v_line->>'name', 'Item'), greatest(0, v_sold - v_back);
    end if;
    -- Priced at what the bill charged, not at what the client sends.
    v_gross := v_gross + v_new * v_price;
  end loop;

  -- Line prices are before the bill discount (proportionalRefund).
  v_total := greatest(0, coalesce(v_sale.total, 0));
  v_ratio := case when coalesce(v_sale.subtotal, 0) > 0 then v_total / v_sale.subtotal else 1 end;
  v_max_refund := round(greatest(0, v_gross * v_ratio), 2);
  if v_refund > v_max_refund + 0.01 then
    raise exception 'Refund (Rs %) wapas aane wale items ki qeemat (Rs %) se zyada hai.', v_refund, v_max_refund;
  end if;

  -- Khata is reversed first; cash/online goes back only for money that was collected (splitRefund).
  v_collected := case
    when nullif(coalesce(v_sale.details->>'paid_amount', ''), '') is not null
      then least(greatest(0, (v_sale.details->>'paid_amount')::numeric), v_total)
    when lower(coalesce(v_sale.payment_mode, '')) = 'credit' then 0
    else v_total
  end;
  v_khata_charged := round(greatest(0, v_total - v_collected), 2);
  v_prior_refund := round(coalesce(v_sale.refund_amount, 0), 2);
  v_khata_left := round(greatest(0, v_khata_charged - least(v_prior_refund, v_khata_charged)), 2);
  v_cash_cap := round(greatest(0, v_refund - least(v_refund, v_khata_left)), 2);
  if v_cash > v_cash_cap + 0.01 then
    raise exception 'Is bill par sirf Rs % cash/online wapas ho sakta hai; baqi khaate se kam hoga.', v_cash_cap;
  end if;

  -- Stock back to (or, for a replacement, out of) the pile the sale used.
  for v_move in select value from jsonb_array_elements(coalesce(p_payload->'stock_moves', '[]'::jsonb)) loop
    if not exists (select 1 from public.items where id = v_move->>'item_id') then
      raise exception 'Item "%" nahi mila; stock wapas nahi ho saka.', v_move->>'item_id';
    end if;
    if coalesce((v_move->>'delta')::numeric, 0) = 0
       or sign((v_move->>'delta')::numeric) <> (case when v_is_replace then -1 else 1 end) then
      raise exception 'Stock ki tabdeeli ghalat hai.';
    end if;
    if nullif(v_move->>'variant_id', '') is not null then
      perform public.adjust_item_stock(v_move->>'item_id', 0, jsonb_build_object(v_move->>'variant_id', (v_move->>'delta')::numeric));
    else
      perform public.adjust_item_stock(v_move->>'item_id', (v_move->>'delta')::numeric, null);
    end if;
  end loop;

  insert into public.inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
  select r.id, r.date, r.item_id, r.item_name, r.old_quantity, r.new_quantity, r.difference, r.reason, r.notes, r.details
  from jsonb_populate_recordset(null::public.inventory_logs, coalesce(p_payload->'logs', '[]'::jsonb)) r
  on conflict (id) do nothing;

  if v_khata > 0 then
    if v_sale.customer_id is null then raise exception 'Walk-in bill ka khata nahi hota.'; end if;
    if nullif(p_payload #>> '{khata,tx_id}', '') is null then raise exception 'Khata entry ki id zaroori hai.'; end if;
    perform public.adjust_customer_balance(v_sale.customer_id, -v_khata);
    insert into public.customer_transactions (id, customer_id, date, type, amount, details, business_day_id, shift_session_id, drawer_id, cashier_id)
    values (
      p_payload #>> '{khata,tx_id}', v_sale.customer_id, now(), 'Return', v_khata,
      coalesce(p_payload #> '{khata,details}', '{}'::jsonb),
      nullif(p_payload->>'business_day_id', ''), nullif(p_payload->>'shift_session_id', ''),
      nullif(p_payload->>'drawer_id', ''), nullif(p_payload->>'cashier_id', '')
    );
  end if;

  if v_cash > 0 then
    perform app_private.post_bank_tx(
      p_payload #>> '{cash,btx_id}', p_payload #>> '{cash,account_id}', 'Expense', v_cash, now(),
      p_payload #>> '{cash,category}', p_payload #>> '{cash,description}', p_sale_id,
      nullif(p_payload->>'business_day_id', ''), nullif(p_payload->>'shift_session_id', ''),
      nullif(p_payload #>> '{cash,drawer_id}', ''), nullif(p_payload->>'cashier_id', '')
    );
    if p_payload #> '{cash,event}' is not null and jsonb_typeof(p_payload #> '{cash,event}') = 'object' then
      insert into public.shift_cash_events (id, business_day_id, shift_id, drawer_id, event_type, direction, amount, payment_mode, source_type, source_id, description, occurred_at, created_by)
      values (
        p_payload #>> '{cash,event,id}', p_payload #>> '{cash,event,business_day_id}', p_payload #>> '{cash,event,shift_id}',
        p_payload #>> '{cash,event,drawer_id}', 'Cash Refund', 'Out', v_cash, 'Cash', 'sales_return',
        p_payload #>> '{cash,event,source_id}', p_payload #>> '{cash,event,description}', now(),
        nullif(p_payload #>> '{cash,event,created_by}', '')
      );
    end if;
  end if;

  v_all_items := coalesce(v_sale.details->'returned_items', '[]'::jsonb) || v_new_items;

  -- Full return = every sold line came back (replacements do not count); a replacement alone
  -- leaves the bill as it was.
  select bool_and(coalesce(b.qty, 0) >= s.qty - 0.0005), bool_or(coalesce(b.qty, 0) > 0)
  into v_full, v_any_back
  from (
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') k,
           sum(coalesce((x->>'qty')::numeric, 0)) qty
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    group by 1
  ) s
  left join (
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') k,
           sum(coalesce((x->>'qty')::numeric, 0)) qty
    from jsonb_array_elements(v_all_items) x
    where coalesce(x->>'action', '') <> 'replace'
    group by 1
  ) b on b.k = s.k;
  v_status := case
    when coalesce(v_full, false) then 'Returned'
    when coalesce(v_any_back, false) then 'Partially Returned'
    else coalesce(v_sale.status, 'Completed')
  end;

  update public.sales
  set status = v_status,
      return_reason = p_payload->>'return_reason',
      returned_at = now(),
      refund_amount = round(coalesce(refund_amount, 0) + v_refund, 2),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'return_type', p_payload->>'return_type',
        'restock_action', p_payload->>'restock_action',
        'returned_items', v_all_items,
        'return_ids', coalesce(details->'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
      )
  where id = p_sale_id;

  return jsonb_build_object(
    'applied', true,
    'status', v_status,
    'refund_amount', round(coalesce(v_sale.refund_amount, 0) + v_refund, 2)
  );
end;
$function$;

revoke all on function public.process_sales_return(text, text, jsonb) from public, anon;
grant execute on function public.process_sales_return(text, text, jsonb) to authenticated, service_role;
