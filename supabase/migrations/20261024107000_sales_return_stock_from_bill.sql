-- process_sales_return: the server works out the stock moves itself (2026-10-24).
-- Requires 20261023111000_sales_return_server_checks.sql and 20261024105000_sale_line_stock_helper.sql.
--
-- 20261023111000 checks rights, quantities and money, but still moved stock exactly as the
-- browser's p_payload.stock_moves said and inserted the browser's p_payload.logs verbatim. A move
-- could be any size, on any pile, unrelated to the returned lines; and two lines of the same
-- product in one request each passed the "sold - already returned" check on their own (sold 2,
-- return 2 + 2 was accepted).
--
-- Now:
--   * returned lines are added up per bill line (product + pack) before the cap check, so one
--     request can never return more than was sold minus what already came back;
--   * every move comes from the SOLD line's own snapshot (stockDeduction, deductFromBase,
--     variantId) through app_private.sale_line_stock, checked against the locked catalog row:
--     a dozen goes back to loose as 12, a pack to its pack count, a pack deleted since the sale to
--     loose at its size. Quantities are the capped returned quantities, never the client's;
--   * direction: a replacement issues fresh units (out of the same pile); a restocked return puts
--     them back; a scrapped return ('scrap_spoilage', or a client that sends no stock moves and no
--     "restock" flag, as the live build does for a spoiled item) moves nothing and logs the scrap;
--   * the server writes the stock logs (loose columns + details.variant_deltas, the one log shape);
--     p_payload.logs and the amounts in p_payload.stock_moves are ignored;
--   * a returned product that no longer exists moves no stock (the client did the same) instead
--     of failing the whole return;
--   * the result lists the moves it applied (stock_moves) so the screen can mirror them exactly.
-- Same signature and payload, so the live client keeps working.

create or replace function public.process_sales_return(p_sale_id text, p_return_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales;
  v_item public.items;
  v_group record;
  v_sold_line jsonb;
  v_item_id text;
  v_move jsonb;
  v_sold numeric;
  v_back numeric;
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
  v_dir integer;
  v_n integer := 0;
  v_loose_delta numeric;
  v_pack_deltas jsonb;
  v_label text;
  v_applied jsonb := '[]'::jsonb;
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

  -- Every bill line in its own sold unit, with all of this request's lines for it added up: earlier
  -- returns and replacements plus this one cannot exceed what was sold.
  for v_group in
    -- Same key the return screen uses: the sold line's itemId (copied onto the returned line), else its name.
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') as k,
           sum(coalesce((x->>'qty')::numeric, 0)) as qty,
           min(coalesce((x->>'qty')::numeric, 0)) as min_qty,
           min(x->>'name') as name
    from jsonb_array_elements(v_new_items) x
    group by 1
  loop
    if v_group.min_qty <= 0 then raise exception 'Return qty 0 se zyada honi chahiye.'; end if;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0), coalesce(max(coalesce((x->>'price')::numeric, 0)), 0)
    into v_sold, v_price
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_group.k;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0) into v_back
    from jsonb_array_elements(coalesce(v_sale.details->'returned_items', '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_group.k;

    if v_back + v_group.qty > v_sold + 0.0005 then
      raise exception '% ki sirf % qty wapas ho sakti hai.', coalesce(v_group.name, 'Item'), greatest(0, v_sold - v_back);
    end if;
    -- Priced at what the bill charged, not at what the client sends.
    v_gross := v_gross + v_group.qty * v_price;
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

  -- Stock: out of the pile for a replacement, back into it for a restocked return, nothing for a scrap.
  v_dir := case
    when v_is_replace then -1
    when coalesce(p_payload->>'restock_action', '') = 'scrap_spoilage' then 0
    when jsonb_typeof(p_payload->'restock') = 'boolean' then case when (p_payload->>'restock')::boolean then 1 else 0 end
    when jsonb_typeof(p_payload->'stock_moves') = 'array' and jsonb_array_length(p_payload->'stock_moves') > 0 then 1
    else 0
  end;

  for v_group in
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') as k,
           min(nullif(x->>'itemId', '')) as item_id,
           min(x->>'name') as name,
           sum(coalesce((x->>'qty')::numeric, 0)) as qty
    from jsonb_array_elements(v_new_items) x
    group by 1
    order by 1
  loop
    v_n := v_n + 1;
    -- The sold line this one came from: its snapshot decides the pile and the size.
    select x into v_sold_line
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_group.k
    limit 1;

    v_item_id := coalesce(nullif(v_sold_line->>'itemId', ''), nullif(v_sold_line->>'id', ''), v_group.item_id);
    if v_item_id is null then
      -- Old bill lines without an id: only an exact, unambiguous product name.
      select min(i.id) into v_item_id from public.items i
      where lower(btrim(i.name)) = lower(btrim(coalesce(v_sold_line->>'name', v_group.name)))
      having count(*) = 1;
    end if;
    select * into v_item from public.items where id = v_item_id for update;
    -- A product deleted since the sale: nothing to move.
    continue when not found;

    v_move := app_private.sale_line_stock(coalesce(v_sold_line, '{}'::jsonb) || jsonb_build_object('qty', v_group.qty), v_item.variants);
    v_loose_delta := case when (v_move->>'from_base')::boolean then v_dir * (v_move->>'base_qty')::numeric else 0 end;
    v_pack_deltas := case when (v_move->>'from_base')::boolean or v_dir = 0 then '{}'::jsonb
                          else jsonb_build_object(v_move->>'variant_id', v_dir * (v_move->>'stock_qty')::numeric) end;

    if v_loose_delta <> 0 or v_pack_deltas <> '{}'::jsonb then
      perform public.adjust_item_stock(v_item.id, v_loose_delta, case when v_pack_deltas = '{}'::jsonb then null else v_pack_deltas end);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'loose_delta', v_loose_delta, 'variant_deltas', v_pack_deltas));
    end if;

    v_label := case when (v_move->>'from_base')::boolean and (v_move->>'contains')::numeric = 1
                    then btrim(trim_scale(round(v_group.qty, 3))::text || ' ' || coalesce(v_item.unit, ''))
                    else trim_scale(round(v_group.qty, 3))::text || ' x ' || coalesce(v_sold_line->>'name', v_group.name, v_item.name) end;

    insert into public.inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
    values (
      'log_ret_' || p_return_id || '_' || v_n,
      now(),
      v_item.id,
      v_item.name,
      coalesce(v_item.stock, 0),
      round(coalesce(v_item.stock, 0) + v_loose_delta, 3),
      v_loose_delta,
      case when v_dir = 1 then 'Sales Return' else 'Spoilage / Wastage' end,
      case
        when v_dir = 1 then 'Returned to counter stock from Invoice #' || coalesce(v_sale.bill_number, '') || ': ' || v_label
                            || coalesce(' (' || nullif(p_payload->>'return_reason', '') || ')', '')
        when v_dir = -1 then 'Customer Replacement: ' || v_label || ' spoiled item returned and a fresh one issued for Invoice #' || coalesce(v_sale.bill_number, '')
        else 'Customer Return (Scrapped Spoilage): ' || v_label || ' from #' || coalesce(v_sale.bill_number, '') || ' discarded'
      end,
      jsonb_build_object('loose_delta', v_loose_delta, 'variant_deltas', v_pack_deltas, 'sale_id', p_sale_id, 'return_id', p_return_id)
        || case when v_dir = 0 then jsonb_build_object('scrapped_qty', (v_move->>'stock_qty')::numeric) else '{}'::jsonb end
        -- The scrapped pack's size is read from details.variant_id (reports: scrappedBaseQty).
        || case when v_dir = 0 and not (v_move->>'from_base')::boolean then jsonb_build_object('variant_id', v_move->>'variant_id') else '{}'::jsonb end
    )
    on conflict (id) do nothing;
  end loop;

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
    'refund_amount', round(coalesce(v_sale.refund_amount, 0) + v_refund, 2),
    'stock_moves', v_applied
  );
end;
$function$;

revoke all on function public.process_sales_return(text, text, jsonb) from public, anon;
grant execute on function public.process_sales_return(text, text, jsonb) to authenticated, service_role;
