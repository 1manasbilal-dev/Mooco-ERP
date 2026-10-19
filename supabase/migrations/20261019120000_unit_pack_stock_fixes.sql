-- Unit / pack stock fixes (Product Catalog audit, 2026-10-19).
-- 1. pos_sync_order_effects: two bill lines of the same pack used to collapse into one
--    (jsonb_object_agg keeps the last key), so only one line left stock. Packs are now summed,
--    and the log records the pack movement in details instead of a silent 0.
-- 2. checkout_customer_order: stock is checked per product/pack across all lines, and the saved
--    bill lines carry stockDeduction, deductFromBase, baseUnit and cost_price like POS bills.
-- 3. sync_delivery_order: a dozen/tray (deduct_from_base) now leaves loose stock as qty x contains
--    instead of a phantom pack count; products match by exact name (a partial name only when it is
--    unambiguous); rows are locked; bill lines carry the same stock snapshot; stock logs use
--    reason 'Sale' with the bill id, so reports no longer count a delivery sale twice.

create or replace function public.pos_sync_order_effects(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order_id text := p_payload ->> 'order_id';
  v_btx_id text := 'btx_' || v_order_id;
  v_ctx_id text := 'ctx_' || v_order_id;
  v_item_id text;
  v_log_id text;
  v_loose numeric;
  v_variants jsonb;
  v_old_stock numeric;
  v_item_name text;
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

  -- 1. Idempotent inventory deduction (one guard row per order+item)
  for v_item_id in
    select distinct item_id
    from jsonb_to_recordset(coalesce(p_payload -> 'items', '[]'::jsonb)) as x(item_id text)
    where item_id is not null
  loop
    v_log_id := 'log_' || v_order_id || '_' || v_item_id;

    if not exists (select 1 from inventory_logs where id = v_log_id) then
      select coalesce(sum(qty) filter (where variant_id is null), 0)
      into v_loose
      from jsonb_to_recordset(coalesce(p_payload -> 'items', '[]'::jsonb)) as x(item_id text, variant_id text, qty numeric)
      where item_id = v_item_id;

      -- Variant deltas are NEGATIVE quantities, summed per pack so repeated lines all count.
      select coalesce(jsonb_object_agg(variant_id, -round(total_qty, 3)), '{}'::jsonb)
      into v_variants
      from (
        select variant_id, sum(qty) as total_qty
        from jsonb_to_recordset(coalesce(p_payload -> 'items', '[]'::jsonb)) as x(item_id text, variant_id text, qty numeric)
        where item_id = v_item_id and variant_id is not null
        group by variant_id
      ) packs;

      select stock, name
      into v_old_stock, v_item_name
      from items
      where id = v_item_id
      for update;

      if v_old_stock is not null then
        v_stock_result := public.adjust_item_stock(v_item_id, -coalesce(v_loose, 0), v_variants);

        insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
        values (
          v_log_id,
          (p_payload ->> 'date')::timestamptz,
          v_item_id,
          v_item_name,
          v_old_stock,
          (v_stock_result ->> 'stock')::numeric,
          -coalesce(v_loose, 0),
          'Sale',
          'POS #' || coalesce(p_payload ->> 'bill_number', '') || ': ' || coalesce(v_item_name, v_item_id)
            || case when v_variants <> '{}'::jsonb then ' (packs)' else '' end,
          jsonb_build_object('loose_delta', -coalesce(v_loose, 0), 'variant_deltas', v_variants)
        );

        v_result := jsonb_set(v_result, '{inventory_applied}', 'true');
      end if;
    end if;
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

  return v_result;
end;
$$;


create or replace function public.checkout_customer_order(p_order_id text, p_revision integer, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  booking public.customer_orders%rowtype;
  shift public.cash_shifts%rowtype;
  day public.business_days%rowtype;
  product public.items%rowtype;
  sale public.sales%rowtype;
  line jsonb;
  need record;
  v_variant jsonb;
  v_sale_items jsonb;
  v_effect_items jsonb;
  v_mode text := p_payload->>'payment_mode';
  v_paid numeric := round((p_payload->>'paid_amount')::numeric,2);
  v_account text := nullif(p_payload->>'account_id','');
  v_allow_negative boolean := false;
  v_sale_id text := 'co_sale_' || p_order_id;
  v_bill text;
  v_advance numeric := 0;
  v_due numeric := 0;
begin
  select * into booking from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Customer order not found.'; end if;
  if booking.status = 'Completed' then
    select * into sale from public.sales where id = booking.sale_id;
    return to_jsonb(sale);
  end if;
  if booking.revision <> p_revision then raise exception 'This order changed at another counter. Reload it before billing.'; end if;
  if booking.status not in ('Confirmed', 'Ready') then raise exception 'Confirm this order before billing. Cancelled orders cannot be billed.'; end if;
  if not exists(select 1 from public.customers where id = booking.customer_id and is_active) then raise exception 'This customer is inactive.'; end if;
  select * into shift from public.cash_shifts where id = p_payload->>'shift_session_id' for update;
  if not found or shift.status <> 'Active' or shift.drawer_id is null then raise exception 'Start an active cash shift before billing.'; end if;
  select * into day from public.business_days where id = shift.business_day_id for update;
  if not found or day.status = 'Closed' or shift.business_date <> (now() at time zone 'Asia/Karachi')::date then raise exception 'The business day is closed or the shift is stale.'; end if;
  if v_mode is null or v_mode not in ('Cash','Online','Credit') or v_paid is null or v_paid < 0 or v_paid::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment details.'; end if;

  v_advance := coalesce(booking.advance_paid, 0);
  v_paid := least(v_paid, greatest(0, booking.total - v_advance));
  v_due := greatest(0, round(booking.total - (v_paid + v_advance), 2));

  if v_mode = 'Credit' and v_paid > 0 then v_mode := 'Cash'; end if;
  if v_paid > 0 and not exists(select 1 from public.financial_accounts where id=v_account and type in ('Cash','Bank','Wallet')) then raise exception 'Choose a valid payment account.'; end if;
  select coalesce((inventory->>'allowNegativeStock')::boolean, (settings->'inventory'->>'allowNegativeStock')::boolean, false) into v_allow_negative from public.app_settings where id='global_settings';
  v_allow_negative := coalesce(v_allow_negative,false);
  perform 1 from public.items where id in (select x->>'itemId' from jsonb_array_elements(booking.items) x) order by id for update;

  -- Validate every line (product, pack, loose sale allowed, positive qty).
  for line in select value from jsonb_array_elements(booking.items) loop
    select * into product from public.items where id = line->>'itemId' and is_active and 'Sale product' = any(type) and not ('Packaging material' = any(type));
    if not found then raise exception 'An ordered product is inactive or missing.'; end if;
    if coalesce((line->>'qty')::numeric, 0) <= 0 then raise exception 'Quantity must be more than zero for %.', product.name; end if;
    if nullif(line->>'variantId','') is not null then
      v_variant := null;
      select v into v_variant from jsonb_array_elements(coalesce(product.variants,'[]'::jsonb)) v
        where v->>'id' = line->>'variantId' and coalesce((v->>'isActive')::boolean, true)
        limit 1;
      if v_variant is null then raise exception 'An ordered pack is inactive or missing.'; end if;
    elsif product.allow_loose_sale = false then
      raise exception 'Loose sale is disabled for %.', product.name;
    end if;
  end loop;

  select jsonb_agg(enriched.sale_line), jsonb_agg(enriched.effect_line)
    into v_sale_items, v_effect_items
  from (
    select
      x || jsonb_build_object(
        'total', round((x->>'qty')::numeric * (x->>'price')::numeric, 2),
        'isLoose', nullif(x->>'variantId','') is null,
        'stockDeduction', calc.contains,
        'deductFromBase', calc.from_base or nullif(x->>'variantId','') is null,
        'baseUnit', itm.unit
      ) || case when coalesce(itm.cost_price, 0) > 0
                then jsonb_build_object('cost_price', round(itm.cost_price * calc.contains, 4))
                else '{}'::jsonb end as sale_line,
      jsonb_build_object(
        'item_id', x->>'itemId',
        'qty', case when calc.from_base then round((x->>'qty')::numeric * calc.contains, 3) else (x->>'qty')::numeric end,
        'variant_id', case when calc.from_base then null else nullif(x->>'variantId','') end
      ) as effect_line
    from jsonb_array_elements(booking.items) x
    join public.items itm on itm.id = x->>'itemId'
    left join lateral (
      select v
      from jsonb_array_elements(coalesce(itm.variants, '[]'::jsonb)) v
      where v->>'id' = nullif(x->>'variantId','')
      limit 1
    ) found on true
    cross join lateral (
      select
        coalesce((found.v->>'deduct_from_base')::boolean, false) and nullif(x->>'variantId','') is not null as from_base,
        case when nullif(x->>'variantId','') is not null and coalesce((found.v->>'quantity_in_base_unit')::numeric, 1) > 0
             then coalesce((found.v->>'quantity_in_base_unit')::numeric, 1)
             else 1 end as contains
    ) calc
  ) enriched;

  -- Stock is checked once per pile with every line added up (20 loose + 1 dozen = 32 eggs).
  if not v_allow_negative then
    for need in
      select e->>'item_id' as item_id, nullif(e->>'variant_id','') as variant_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(v_effect_items) e
      group by 1, 2
    loop
      select * into product from public.items where id = need.item_id;
      if need.variant_id is null then
        if coalesce(product.stock, 0) < round(need.qty, 3) then raise exception 'Insufficient stock for %.', product.name; end if;
      else
        if coalesce((product.variant_stocks->>need.variant_id)::numeric, 0) < need.qty then raise exception 'Insufficient pack stock for %.', product.name; end if;
      end if;
    end loop;
  end if;

  v_bill := 'INV-' || booking.order_number;
  insert into public.sales(id,bill_number,date,customer_id,customer_name,subtotal,discount,total,payment_mode,status,items,details,business_day_id,shift_session_id,drawer_id,cashier_id,cashier_name)
  values(v_sale_id,v_bill,now(),booking.customer_id,booking.customer_name,booking.subtotal,booking.discount,booking.total,v_mode,'Completed',v_sale_items,
    jsonb_build_object('customer_order_id',booking.id,'customer_order_number',booking.order_number,'customer_phone',booking.customer_phone,'advance_paid',v_advance,'paid_amount',v_paid+v_advance,'counter_paid',v_paid,'due_amount',v_due,'cash_given',coalesce((p_payload->>'cash_given')::numeric,v_paid),'change_return',coalesce((p_payload->>'change_return')::numeric,0)),
    shift.business_day_id,shift.id,shift.drawer_id,shift.user_id,shift.user_name) returning * into sale;
  perform public.pos_sync_order_effects(jsonb_build_object('order_id',v_sale_id,'bill_number',v_bill,'date',sale.date,'payment_mode',v_mode,'customer_id',booking.customer_id,'paid_amount',v_paid+v_advance,'total',booking.total,'due_amount',v_due,'account_id',v_account,'business_day_id',shift.business_day_id,'shift_session_id',shift.id,'drawer_id',shift.drawer_id,'cashier_id',shift.user_id,'items',v_effect_items));
  update public.customer_orders set status='Completed',sale_id=v_sale_id where id=booking.id;
  return to_jsonb(sale);
end;
$$;
revoke all on function public.checkout_customer_order(text,integer,jsonb) from public;
grant execute on function public.checkout_customer_order(text,integer,jsonb) to anon, authenticated;


create or replace function public.sync_delivery_order(p_api_key text, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
DECLARE
  v_key_record RECORD;
  v_order_id text;
  v_customer_id text;
  v_customer_name text;
  v_customer_phone text;
  v_clean_phone text;
  v_order_date timestamptz;
  v_order_total numeric;
  v_paid_amount numeric;
  v_due_amount numeric;
  v_payment_mode text;
  v_rider_name text;
  v_sale_id text;
  v_item jsonb;
  v_item_record public.items%rowtype;
  v_item_found boolean;
  v_match_count integer;
  v_variant jsonb;
  v_variant_id text;
  v_variant_name text;
  v_from_base boolean;
  v_contains numeric;
  v_move numeric;
  v_qty numeric;
  v_stock_result jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_cash_account_id text;
  v_digital_account_id text;
  v_settings jsonb;
BEGIN
  -- Generated up front so every stock log can point at its bill (reports skip logs a bill already counts).
  v_sale_id := 'sale_' || gen_random_uuid()::text;
  -- 1. Validate API Key
  SELECT * INTO v_key_record
  FROM public.app_api_keys
  WHERE secret_key = p_api_key AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication failed: Invalid or inactive API Key'
    );
  END IF;

  -- Update last_used_at
  UPDATE public.app_api_keys SET last_used_at = now() WHERE id = v_key_record.id;

  -- 2. Extract Order Parameters
  v_order_id := coalesce(trim(p_order->>'order_id'), '');
  IF v_order_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order_id in payload');
  END IF;

  -- Check Duplicate (Idempotency)
  IF EXISTS (
    SELECT 1 FROM public.sales
    WHERE bill_number = v_order_id
       OR details->>'delivery_order_id' = v_order_id
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Order #' || v_order_id || ' is already synced in Mooco',
      'order_id', v_order_id
    );
  END IF;

  v_customer_name := coalesce(nullif(trim(p_order->>'customer_name'), ''), 'Delivery Customer');
  v_customer_phone := coalesce(trim(p_order->>'customer_phone'), '');
  v_clean_phone := regexp_replace(v_customer_phone, '\D', '', 'g');

  IF p_order->>'date' IS NOT NULL AND trim(p_order->>'date') <> '' THEN
    v_order_date := (p_order->>'date')::timestamptz;
  ELSE
    v_order_date := now();
  END IF;

  v_order_total := coalesce((p_order->>'order_total')::numeric, 0);
  v_paid_amount := coalesce((p_order->>'paid_amount')::numeric, v_order_total);
  v_payment_mode := coalesce(nullif(trim(p_order->>'payment_mode'), ''), 'Cash');
  v_rider_name := coalesce(trim(p_order->>'rider_name'), 'Delivery Rider');

  IF lower(v_payment_mode) IN ('credit', 'khata', 'udhar') THEN
    v_paid_amount := coalesce((p_order->>'paid_amount')::numeric, 0);
    v_due_amount := v_order_total - v_paid_amount;
  ELSE
    v_due_amount := greatest(0, v_order_total - v_paid_amount);
  END IF;

  -- 3. Match or Create Customer
  v_customer_id := NULL;
  IF v_clean_phone <> '' THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_clean_phone
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE lower(trim(name)) = lower(trim(v_customer_name))
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    v_customer_id := 'cust_' || gen_random_uuid()::text;
    INSERT INTO public.customers (
      id, name, phone, address, route, balance, is_active, type, data
    ) VALUES (
      v_customer_id,
      v_customer_name,
      v_customer_phone,
      coalesce(p_order->>'customer_address', ''),
      coalesce(p_order->>'customer_route', ''),
      0,
      true,
      'Delivery Customer',
      jsonb_build_object('created_via', 'realtime_api_sync')
    );
  END IF;

  -- 4. Process Items & Deduct Stock
  IF p_order->'items' IS NOT NULL AND jsonb_typeof(p_order->'items') = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_order->'items')
    LOOP
      v_qty := coalesce((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
      v_variant_name := coalesce(trim(v_item->>'variant_name'), '');

      -- Exact name first. A partial name is used only when it points at exactly one product,
      -- so "Dawn Bread" never lands on "Dawn Bread Large" by chance.
      SELECT * INTO v_item_record
      FROM public.items
      WHERE lower(trim(name)) = lower(trim(v_item->>'name'))
      LIMIT 1
      FOR UPDATE;
      v_item_found := FOUND;

      IF NOT v_item_found THEN
        SELECT count(*) INTO v_match_count
        FROM public.items
        WHERE name ILIKE '%' || trim(v_item->>'name') || '%';
        IF v_match_count = 1 THEN
          SELECT * INTO v_item_record
          FROM public.items
          WHERE name ILIKE '%' || trim(v_item->>'name') || '%'
          FOR UPDATE;
          v_item_found := FOUND;
        END IF;
      END IF;

      IF v_item_found THEN
        v_variant := NULL;
        v_variant_id := NULL;
        IF v_variant_name <> '' AND v_item_record.variants IS NOT NULL THEN
          SELECT elem INTO v_variant
          FROM jsonb_array_elements(v_item_record.variants) elem
          WHERE lower(trim(elem->>'name')) = lower(trim(v_variant_name))
          LIMIT 1;
          v_variant_id := v_variant->>'id';
        END IF;

        v_from_base := v_variant_id IS NULL OR coalesce((v_variant->>'deduct_from_base')::boolean, false);
        v_contains := CASE WHEN v_variant_id IS NOT NULL AND coalesce((v_variant->>'quantity_in_base_unit')::numeric, 0) > 0
                           THEN (v_variant->>'quantity_in_base_unit')::numeric ELSE 1 END;

        IF v_variant_id IS NOT NULL AND NOT v_from_base THEN
          -- Ready-made pack: its own count goes down.
          v_stock_result := public.adjust_item_stock(v_item_record.id, 0, jsonb_build_object(v_variant_id, -v_qty));
          INSERT INTO public.inventory_logs (
            id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details
          ) VALUES (
            'log_' || gen_random_uuid()::text,
            now(),
            v_item_record.id,
            v_item_record.name,
            coalesce(v_item_record.stock, 0),
            coalesce(v_item_record.stock, 0),
            0,
            'Sale',
            'Live Delivery API: Order #' || v_order_id || ' (' || v_qty || ' x ' || v_variant_name || ')',
            jsonb_build_object('variant_id', v_variant_id, 'variant_delta', -v_qty, 'loose_delta', 0, 'sale_id', v_sale_id)
          );
        ELSE
          -- Loose, or a dozen/tray view of loose stock: base units = qty x contains.
          v_move := round(v_qty * v_contains, 3);
          v_stock_result := public.adjust_item_stock(v_item_record.id, -v_move, NULL);
          INSERT INTO public.inventory_logs (
            id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details
          ) VALUES (
            'log_' || gen_random_uuid()::text,
            now(),
            v_item_record.id,
            v_item_record.name,
            coalesce(v_item_record.stock, 0),
            (v_stock_result->>'stock')::numeric,
            -v_move,
            'Sale',
            'Live Delivery API: Order #' || v_order_id
              || CASE WHEN v_variant_id IS NOT NULL THEN ' (' || v_qty || ' x ' || v_variant_name || ')' ELSE '' END,
            jsonb_build_object('loose_delta', -v_move, 'sale_id', v_sale_id)
          );
        END IF;

        v_lines := v_lines || jsonb_build_array(v_item || jsonb_build_object(
          'itemId', v_item_record.id,
          'qty', v_qty,
          'variantId', v_variant_id,
          'variantName', nullif(v_variant_name, ''),
          'isLoose', v_variant_id IS NULL,
          'stockDeduction', v_contains,
          'deductFromBase', v_from_base,
          'baseUnit', v_item_record.unit
        ) || CASE WHEN coalesce(v_item_record.cost_price, 0) > 0
                  THEN jsonb_build_object('cost_price', round(v_item_record.cost_price * v_contains, 4))
                  ELSE '{}'::jsonb END);
      ELSE
        v_lines := v_lines || jsonb_build_array(v_item || jsonb_build_object('qty', v_qty, 'unmatched', true));
      END IF;
    END LOOP;
  END IF;

  -- 5. Insert Sale Invoice
  INSERT INTO public.sales (
    id,
    bill_number,
    date,
    customer_id,
    customer_name,
    subtotal,
    discount,
    total,
    payment_mode,
    status,
    items,
    details
  ) VALUES (
    v_sale_id,
    v_order_id,
    v_order_date,
    v_customer_id,
    v_customer_name,
    v_order_total,
    0,
    v_order_total,
    v_payment_mode,
    'Completed',
    v_lines,
    jsonb_build_object(
      'source', 'delivery_app_realtime_api',
      'delivery_order_id', v_order_id,
      'rider_name', v_rider_name,
      'paid_amount', v_paid_amount,
      'due_amount', v_due_amount,
      'customer_phone', v_customer_phone
    )
  );

  -- 6. Customer Khata Charge if due
  IF v_due_amount > 0 THEN
    UPDATE public.customers
    SET balance = coalesce(balance, 0) + v_due_amount
    WHERE id = v_customer_id;

    INSERT INTO public.customer_transactions (
      id, customer_id, date, type, amount, mode, note
    ) VALUES (
      'ctx_' || gen_random_uuid()::text,
      v_customer_id,
      v_order_date,
      'Charge',
      v_due_amount,
      'Credit Sale',
      'Live Delivery Order #' || v_order_id
    );
  END IF;

  -- 7. Update Financial Accounts & Bank Ledger
  SELECT general, financial INTO v_settings FROM public.app_settings LIMIT 1;

  IF v_paid_amount > 0 THEN
    IF lower(v_payment_mode) = 'online' THEN
      v_digital_account_id := coalesce(v_settings->>'defaultDigitalAccountId', '');
      IF v_digital_account_id = '' THEN
        SELECT id INTO v_digital_account_id
        FROM public.financial_accounts
        WHERE type IN ('Bank', 'Wallet') AND is_active = true
        LIMIT 1;
      END IF;

      IF v_digital_account_id IS NOT NULL AND v_digital_account_id <> '' THEN
        UPDATE public.financial_accounts
        SET balance = coalesce(balance, 0) + v_paid_amount
        WHERE id = v_digital_account_id;

        INSERT INTO public.bank_transactions (
          id, account_id, amount, date, type, details
        ) VALUES (
          'btx_api_' || gen_random_uuid()::text,
          v_digital_account_id,
          v_paid_amount,
          v_order_date,
          'Deposit',
          jsonb_build_object(
            'category', 'Delivery Online Collection',
            'description', 'Live Delivery Order #' || v_order_id || ' via Online'
          )
        );
      END IF;

    ELSE
      -- Cash collection
      v_cash_account_id := coalesce(v_settings->>'defaultCashAccountId', '');
      IF v_cash_account_id = '' THEN
        SELECT id INTO v_cash_account_id
        FROM public.financial_accounts
        WHERE type = 'Cash' AND is_active = true
        LIMIT 1;
      END IF;

      IF v_cash_account_id IS NOT NULL AND v_cash_account_id <> '' THEN
        UPDATE public.financial_accounts
        SET balance = coalesce(balance, 0) + v_paid_amount
        WHERE id = v_cash_account_id;

        INSERT INTO public.bank_transactions (
          id, account_id, amount, date, type, details
        ) VALUES (
          'btx_api_' || gen_random_uuid()::text,
          v_cash_account_id,
          v_paid_amount,
          v_order_date,
          'Deposit',
          jsonb_build_object(
            'category', 'Delivery Cash Collection',
            'description', 'Live Delivery Order #' || v_order_id || ' collected by ' || v_rider_name
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Order synced and stock deducted successfully',
    'order_id', v_order_id,
    'sale_id', v_sale_id,
    'customer_id', v_customer_id,
    'order_total', v_order_total,
    'paid_amount', v_paid_amount,
    'due_amount', v_due_amount,
    'stock_deducted', true
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Database execution error: ' || SQLERRM
  );
END;
$$;
