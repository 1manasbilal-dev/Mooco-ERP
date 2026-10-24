-- pos_sync_order_effects: stock follows the saved bill, not the payload (2026-10-24).
-- Requires 20261024105000_sale_line_stock_helper.sql.
--
-- Before: the browser sent its own stock lines ({item_id, qty, variant_id}) and the server moved
-- exactly that. The bill row (what reports, returns and the khata read) and the stock move could
-- disagree: a dozen line without a flag left a phantom pack count, a pack deleted since the sale
-- left a count no pile owns, and any client bug moved the wrong pile.
--
-- Now the server reads the bill's own lines (sales.items, saved just before this call by the POS
-- sync and by checkout_customer_order) and works out every line's pile with
-- app_private.sale_line_stock against the locked catalog row. The payload lines are used only when
-- no bill row exists, and they are checked against the catalog the same way. Same signature, same
-- one-guard-row-per-order+item idempotency, same payment and khata steps; the log now carries
-- details.variant_deltas for packs (one shape, docs/stock-model.md) and the bill id.

create or replace function public.pos_sync_order_effects(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id text := p_payload ->> 'order_id';
  v_btx_id text := 'btx_' || v_order_id;
  v_ctx_id text := 'ctx_' || v_order_id;
  v_bill_items jsonb;
  v_lines jsonb;
  v_from_bill boolean := false;
  v_item_id text;
  v_log_id text;
  v_line jsonb;
  v_move jsonb;
  v_loose numeric;
  v_variants jsonb;
  v_pack text;
  v_old_stock numeric;
  v_item_name text;
  v_item_variants jsonb;
  v_stock_result jsonb;
  v_received numeric;
  v_due numeric;
  v_result jsonb := jsonb_build_object(
    'inventory_applied', false,
    'payment_applied', false,
    'ledger_applied', false
  );
begin
  if v_order_id is null or v_order_id = '' then
    raise exception 'order_id zaroori hai.';
  end if;

  -- 1. Stock, from the bill's own lines (their snapshot decides the pile), one guard row per order+item.
  select items into v_bill_items from sales where id = v_order_id;
  if found and jsonb_typeof(v_bill_items) = 'array' then
    v_from_bill := true;
    select coalesce(jsonb_agg(x || jsonb_build_object('item_id', coalesce(nullif(x->>'itemId', ''), nullif(x->>'id', '')))), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(v_bill_items) x
    where jsonb_typeof(x) = 'object';
  else
    -- No bill row: the payload lines are already in pile units (loose base qty, or a pack count).
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', x->>'item_id',
             'qty', x->'qty',
             'variantId', nullif(x->>'variant_id', ''),
             'deductFromBase', case when nullif(x->>'variant_id', '') is null then null else false end
           )), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'items') = 'array' then p_payload -> 'items' else '[]'::jsonb end) x
    where jsonb_typeof(x) = 'object';
  end if;

  for v_item_id in
    select distinct l->>'item_id'
    from jsonb_array_elements(v_lines) l
    where nullif(l->>'item_id', '') is not null
  loop
    v_log_id := 'log_' || v_order_id || '_' || v_item_id;
    continue when exists (select 1 from inventory_logs where id = v_log_id);

    select stock, name, coalesce(variants, '[]'::jsonb)
    into v_old_stock, v_item_name, v_item_variants
    from items
    where id = v_item_id
    for update;
    -- A product deleted since the sale: nothing to move (as before).
    continue when v_old_stock is null;

    v_loose := 0;
    v_variants := '{}'::jsonb;
    for v_line in select l from jsonb_array_elements(v_lines) l where l->>'item_id' = v_item_id loop
      v_move := app_private.sale_line_stock(v_line, v_item_variants);
      if (v_move->>'from_base')::boolean then
        v_loose := v_loose + (v_move->>'base_qty')::numeric;
      else
        v_pack := v_move->>'variant_id';
        -- Variant deltas are NEGATIVE pack counts, summed per pack so repeated lines all count.
        v_variants := v_variants || jsonb_build_object(v_pack,
          round(coalesce((v_variants->>v_pack)::numeric, 0) - (v_move->>'stock_qty')::numeric, 3));
      end if;
    end loop;
    v_loose := round(v_loose, 3);

    v_stock_result := public.adjust_item_stock(v_item_id, -v_loose, case when v_variants = '{}'::jsonb then null else v_variants end);

    insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
    values (
      v_log_id,
      coalesce((p_payload ->> 'date')::timestamptz, now()),
      v_item_id,
      v_item_name,
      v_old_stock,
      (v_stock_result ->> 'stock')::numeric,
      -v_loose,
      'Sale',
      'POS #' || coalesce(p_payload ->> 'bill_number', '') || ': ' || coalesce(v_item_name, v_item_id)
        || case when v_variants <> '{}'::jsonb then ' (packs)' else '' end,
      jsonb_build_object('loose_delta', -v_loose, 'variant_deltas', v_variants, 'sale_id', v_order_id,
                         'stock_from', case when v_from_bill then 'bill' else 'payload' end)
    );

    v_result := jsonb_set(v_result, '{inventory_applied}', 'true');
  end loop;

  -- 2. Idempotent payment receipt (cash/online portion of the bill)
  v_received := round(least(
                 coalesce((p_payload ->> 'paid_amount')::numeric, 0),
                 coalesce((p_payload ->> 'total')::numeric, 0)
               ), 2);

  if v_received > 0
     and p_payload ->> 'account_id' is not null
     and not exists (select 1 from bank_transactions where id = v_btx_id) then
    insert into bank_transactions (id, account_id, amount, date, type, category, description, reference_id,
                                   business_day_id, shift_session_id, drawer_id, cashier_id)
    values (v_btx_id,
            p_payload ->> 'account_id',
            v_received,
            (p_payload ->> 'date')::timestamptz,
            'Income',
            case when p_payload ->> 'payment_mode' = 'Cash' then 'POS Sale' else 'Online Sale' end,
            'POS ' || coalesce(p_payload ->> 'payment_mode', 'Sale') || ' Sale #' || coalesce(p_payload ->> 'bill_number', ''),
            v_order_id,
            p_payload ->> 'business_day_id',
            p_payload ->> 'shift_session_id',
            p_payload ->> 'drawer_id',
            p_payload ->> 'cashier_id');

    perform public.adjust_account_balance(p_payload ->> 'account_id', v_received);
    v_result := jsonb_set(v_result, '{payment_applied}', 'true');
  end if;

  -- 3. Idempotent customer khata charge (credit portion)
  v_due := round(coalesce((p_payload ->> 'due_amount')::numeric, 0), 2);

  if v_due > 0
     and p_payload ->> 'customer_id' is not null
     and not exists (select 1 from customer_transactions where id = v_ctx_id) then
    insert into customer_transactions (id, customer_id, date, type, amount, details)
    values (v_ctx_id,
            p_payload ->> 'customer_id',
            (p_payload ->> 'date')::timestamptz,
            'Charge',
            v_due,
            jsonb_build_object(
              'mode', case when coalesce((p_payload ->> 'paid_amount')::numeric, 0) > 0
                           then coalesce(p_payload ->> 'payment_mode', '') || ' + Ledger Due'
                           else 'Credit Sale' end,
              'note', 'Sale #' || coalesce(p_payload ->> 'bill_number', '')
                      || ' (Total: Rs ' || coalesce((p_payload ->> 'total')::numeric, 0)
                      || ', Paid: Rs ' || coalesce((p_payload ->> 'paid_amount')::numeric, 0)
                      || ', Due: Rs ' || v_due || ')',
              'business_day_id', p_payload ->> 'business_day_id',
              'shift_session_id', p_payload ->> 'shift_session_id',
              'drawer_id', p_payload ->> 'drawer_id',
              'cashier_id', p_payload ->> 'cashier_id'
            ));

    perform public.adjust_customer_balance(p_payload ->> 'customer_id', v_due);
    v_result := jsonb_set(v_result, '{ledger_applied}', 'true');
  end if;

  return v_result || jsonb_build_object('stock_from_bill', v_from_bill);
end;
$function$;
