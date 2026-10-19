-- Sales returns in one locked transaction.
--
-- Before: the client marked the bill returned first, then moved stock, khata and cash in separate
-- calls whose inserts were never error-checked, with no lock and no server check of quantity. A
-- failure halfway left a returned bill with stock or money not moved; two counters could refund the
-- same bill twice.
--
-- process_sales_return locks the bill, checks every returned line against what was sold minus what
-- already came back, caps the refund at the bill total, and applies stock, logs, khata, refund and
-- the drawer event together. p_return_id makes a retry after a lost response a no-op.
--
-- adjust_item_stock now locks the item row before reading it, so two concurrent adjustments can no
-- longer overwrite each other.

create or replace function public.adjust_item_stock(p_item_id text, p_loose_delta numeric default 0, p_variant_deltas jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_loose numeric;
  v_old_variants jsonb;
  v_new_variants jsonb;
  v_new_loose numeric;
begin
  select stock, coalesce(variant_stocks, '{}'::jsonb)
  into v_old_loose, v_old_variants
  from items
  where id = p_item_id
  for update;

  if v_old_loose is null then
    return null;
  end if;

  -- Only the keys in p_variant_deltas change (old + delta); all other variant keys are carried over.
  select coalesce(v_old_variants, '{}'::jsonb)
         || coalesce(
              jsonb_object_agg(
                k,
                round(coalesce((v_old_variants ->> k)::numeric, 0) + (p_variant_deltas ->> k)::numeric, 3)
              ),
              '{}'::jsonb
            )
  into v_new_variants
  from jsonb_object_keys(coalesce(p_variant_deltas, '{}'::jsonb)) as t(k);

  v_new_loose := round(v_old_loose + coalesce(p_loose_delta, 0), 3);

  update items
  set stock = v_new_loose,
      variant_stocks = coalesce(v_new_variants, '{}'::jsonb)
  where id = p_item_id;

  return jsonb_build_object('stock', v_new_loose, 'variant_stocks', coalesce(v_new_variants, '{}'::jsonb));
end;
$function$;

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
  v_refund numeric := round(coalesce((p_payload->>'refund_amount')::numeric, 0), 2);
  v_khata numeric := round(coalesce((p_payload #>> '{khata,amount}')::numeric, 0), 2);
  v_cash numeric := round(coalesce((p_payload #>> '{cash,amount}')::numeric, 0), 2);
  v_new_items jsonb := coalesce(p_payload->'returned_items', '[]'::jsonb);
  v_all_items jsonb;
begin
  if p_return_id is null or p_return_id = '' then raise exception 'return id zaroori hai.'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Bill server par nahi mila. Sync mukammal hone ke baad return karein.';
  end if;
  if coalesce(v_sale.details->'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true);
  end if;
  if v_sale.status = 'Returned' then
    raise exception 'Ye bill pehle hi poora return ho chuka hai.';
  end if;
  if jsonb_typeof(v_new_items) <> 'array' or jsonb_array_length(v_new_items) = 0 then
    raise exception 'Return ke liye koi item select nahi hua.';
  end if;
  if v_refund < 0 or v_khata < 0 or v_cash < 0 or round(v_khata + v_cash, 2) > v_refund + 0.01 then
    raise exception 'Refund ki raqam ghalat hai.';
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

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0) into v_sold
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_key;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0) into v_back
    from jsonb_array_elements(coalesce(v_sale.details->'returned_items', '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_key;

    if v_back + v_new > v_sold + 0.0005 then
      raise exception '% ki sirf % qty wapas ho sakti hai.', coalesce(v_line->>'name', 'Item'), greatest(0, v_sold - v_back);
    end if;
  end loop;

  -- Stock back to (or, for a replacement, out of) the pile the sale used.
  for v_move in select value from jsonb_array_elements(coalesce(p_payload->'stock_moves', '[]'::jsonb)) loop
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
    if not exists (select 1 from public.financial_accounts where id = p_payload #>> '{cash,account_id}') then
      raise exception 'Refund ka account nahi mila.';
    end if;
    perform public.adjust_account_balance(p_payload #>> '{cash,account_id}', -v_cash);
    insert into public.bank_transactions (id, account_id, amount, date, type, category, description, reference_id, business_day_id, shift_session_id, drawer_id, cashier_id)
    values (
      p_payload #>> '{cash,btx_id}', p_payload #>> '{cash,account_id}', v_cash, now(), 'Expense',
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
  update public.sales
  set status = coalesce(p_payload->>'status', status),
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

  return jsonb_build_object('applied', true, 'refund_amount', round(coalesce(v_sale.refund_amount, 0) + v_refund, 2));
end;
$function$;

revoke all on function public.process_sales_return(text, text, jsonb) from public;
grant execute on function public.process_sales_return(text, text, jsonb) to anon, authenticated;
