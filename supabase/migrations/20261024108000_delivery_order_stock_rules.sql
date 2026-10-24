-- sync_delivery_order: delivery lines follow the POS stock rule (2026-10-24).
-- Requires 20261023105000_sync_delivery_order_fixes.sql (the body this is copied from; it matched the
-- live function on 2026-10-24) and 20261024105000_sale_line_stock_helper.sql.
--
-- Only step 4 (items and stock) and the result change:
--   * the pile comes from app_private.sale_line_stock, the rule POS bills use on the server, so a
--     pack line and a dozen line from the delivery app move the same piles as at the counter;
--   * a pack named (variant_name) or given by id (variant_id, new) that the product does not have
--     no longer takes 1 base unit per qty from loose stock: the line is kept on the bill as
--     unmatched ("unmatched_reason": "pack") and moves nothing. "Loose", "base" or the product's own
--     unit name still mean loose stock;
--   * a quantity that is zero, negative or not a number no longer adds stock back (negative) or
--     fails the whole order (text): the line is kept as unmatched ("unmatched_reason": "quantity");
--   * pack sale logs use details.variant_deltas (the one log shape in docs/stock-model.md);
--   * the result also returns unmatched_lines.
-- Same signature, grants and API-key check.

create or replace function public.sync_delivery_order(p_api_key text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_receipt_account_id text;
  v_settings jsonb;
  v_variant_key text;
  v_line_move jsonb;
  v_unmatched integer := 0;
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

  -- One call per order at a time, so a retry that overlaps the first call sees its sale.
  PERFORM pg_advisory_xact_lock(hashtextextended('mooco_delivery:' || v_order_id, 0));

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

  v_order_total := round(coalesce((p_order->>'order_total')::numeric, 0), 2);
  v_paid_amount := round(coalesce((p_order->>'paid_amount')::numeric, v_order_total), 2);
  v_payment_mode := coalesce(nullif(trim(p_order->>'payment_mode'), ''), 'Cash');
  v_rider_name := coalesce(trim(p_order->>'rider_name'), 'Delivery Rider');

  IF lower(v_payment_mode) IN ('credit', 'khata', 'udhar') THEN
    v_paid_amount := round(coalesce((p_order->>'paid_amount')::numeric, 0), 2);
  END IF;
  v_due_amount := greatest(0, round(v_order_total - v_paid_amount, 2));

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
  -- Each line's pile follows the catalog through the same rule as POS bills (app_private.sale_line_stock):
  -- loose, a dozen/tray view of loose (qty x size), or a ready-made pack's own count. A quantity that is
  -- not a positive number, or a pack name / id the product does not have, moves no stock: the line is
  -- kept on the bill as unmatched.
  IF p_order->'items' IS NOT NULL AND jsonb_typeof(p_order->'items') = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_order->'items')
    LOOP
      v_qty := CASE WHEN v_item ? 'quantity' OR v_item ? 'qty'
                    THEN coalesce(app_private.json_num(v_item->'quantity'), app_private.json_num(v_item->'qty'))
                    ELSE 1 END;
      v_variant_name := coalesce(trim(v_item->>'variant_name'), '');
      v_variant_key := coalesce(trim(v_item->>'variant_id'), '');

      IF v_qty IS NULL OR v_qty <= 0 THEN
        v_lines := v_lines || jsonb_build_array(v_item || jsonb_build_object('qty', coalesce(v_qty, 0), 'unmatched', true, 'unmatched_reason', 'quantity'));
        v_unmatched := v_unmatched + 1;
        CONTINUE;
      END IF;

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
        -- "Loose", "base" or the product's own unit name mean the loose pile, not a pack.
        IF v_variant_key = '' AND lower(v_variant_name) IN ('loose', 'base', lower(coalesce(v_item_record.unit, ''))) THEN
          v_variant_name := '';
        END IF;
        IF v_variant_key <> '' OR v_variant_name <> '' THEN
          SELECT elem INTO v_variant
          FROM jsonb_array_elements(coalesce(v_item_record.variants, '[]'::jsonb)) elem
          WHERE (v_variant_key <> '' AND elem->>'id' = v_variant_key)
             OR (v_variant_key = '' AND lower(trim(elem->>'name')) = lower(v_variant_name))
          LIMIT 1;
          v_variant_id := v_variant->>'id';
          IF v_variant_id IS NULL THEN
            v_lines := v_lines || jsonb_build_array(v_item || jsonb_build_object(
              'qty', v_qty, 'unmatched', true, 'unmatched_reason', 'pack', 'product_name', v_item_record.name));
            v_unmatched := v_unmatched + 1;
            CONTINUE;
          END IF;
          v_variant_name := coalesce(nullif(v_variant->>'name', ''), v_variant_name);
        END IF;

        v_line_move := app_private.sale_line_stock(jsonb_build_object(
          'qty', v_qty,
          'variantId', v_variant_id,
          'deductFromBase', CASE WHEN v_variant_id IS NULL THEN NULL ELSE coalesce(v_variant->>'deduct_from_base', '') = 'true' END
        ), v_item_record.variants);
        v_from_base := (v_line_move->>'from_base')::boolean;
        v_contains := (v_line_move->>'contains')::numeric;
        v_move := (v_line_move->>'base_qty')::numeric;

        IF NOT v_from_base THEN
          -- Ready-made pack: its own count goes down.
          v_stock_result := public.adjust_item_stock(v_item_record.id, 0, jsonb_build_object(v_variant_id, -(v_line_move->>'stock_qty')::numeric));
        ELSE
          -- Loose, or a dozen/tray view of loose stock: base units = qty x contains.
          v_stock_result := public.adjust_item_stock(v_item_record.id, -v_move, NULL);
        END IF;
        INSERT INTO public.inventory_logs (
          id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details
        ) VALUES (
          'log_' || gen_random_uuid()::text,
          now(),
          v_item_record.id,
          v_item_record.name,
          coalesce(v_item_record.stock, 0),
          (v_stock_result->>'stock')::numeric,
          CASE WHEN v_from_base THEN -v_move ELSE 0 END,
          'Sale',
          'Live Delivery API: Order #' || v_order_id
            || CASE WHEN v_variant_id IS NOT NULL THEN ' (' || v_qty || ' x ' || v_variant_name || ')' ELSE '' END,
          jsonb_build_object(
            'loose_delta', CASE WHEN v_from_base THEN -v_move ELSE 0 END,
            'variant_deltas', CASE WHEN v_from_base THEN '{}'::jsonb
                                   ELSE jsonb_build_object(v_variant_id, -(v_line_move->>'stock_qty')::numeric) END,
            'sale_id', v_sale_id)
        );

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
        v_unmatched := v_unmatched + 1;
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
    PERFORM public.adjust_customer_balance(v_customer_id, v_due_amount);

    INSERT INTO public.customer_transactions (
      id, customer_id, date, type, amount, details
    ) VALUES (
      'ctx_' || v_sale_id,
      v_customer_id,
      v_order_date,
      'Charge',
      v_due_amount,
      jsonb_build_object(
        'mode', 'Credit Sale',
        'note', 'Live Delivery Order #' || v_order_id,
        'sale_id', v_sale_id,
        'source', 'delivery_app_realtime_api'
      )
    );
  END IF;

  -- 7. Update Financial Accounts & Bank Ledger
  SELECT financial INTO v_settings FROM public.app_settings LIMIT 1;

  IF v_paid_amount > 0 THEN
    IF lower(v_payment_mode) = 'online' THEN
      v_digital_account_id := coalesce(v_settings->>'defaultDigitalAccountId', '');
      IF v_digital_account_id = '' THEN
        SELECT id INTO v_digital_account_id
        FROM public.financial_accounts
        WHERE type IN ('Bank', 'Wallet') AND is_active = true
        LIMIT 1;
      END IF;
      v_receipt_account_id := nullif(v_digital_account_id, '');
    ELSE
      -- Cash collection
      v_cash_account_id := coalesce(v_settings->>'defaultCashAccountId', '');
      IF v_cash_account_id = '' THEN
        SELECT id INTO v_cash_account_id
        FROM public.financial_accounts
        WHERE type = 'Cash' AND is_active = true
        LIMIT 1;
      END IF;
      v_receipt_account_id := nullif(v_cash_account_id, '');
    END IF;

    IF v_receipt_account_id IS NOT NULL THEN
      PERFORM public.adjust_account_balance(v_receipt_account_id, v_paid_amount);

      INSERT INTO public.bank_transactions (
        id, account_id, amount, date, type, category, description, reference_id, details
      ) VALUES (
        'btx_api_' || gen_random_uuid()::text,
        v_receipt_account_id,
        v_paid_amount,
        v_order_date,
        'Deposit',
        CASE WHEN lower(v_payment_mode) = 'online' THEN 'Delivery Online Collection' ELSE 'Delivery Cash Collection' END,
        CASE WHEN lower(v_payment_mode) = 'online'
             THEN 'Live Delivery Order #' || v_order_id || ' via Online'
             ELSE 'Live Delivery Order #' || v_order_id || ' collected by ' || v_rider_name END,
        v_sale_id,
        jsonb_build_object(
          'category', CASE WHEN lower(v_payment_mode) = 'online' THEN 'Delivery Online Collection' ELSE 'Delivery Cash Collection' END,
          'description', CASE WHEN lower(v_payment_mode) = 'online'
                              THEN 'Live Delivery Order #' || v_order_id || ' via Online'
                              ELSE 'Live Delivery Order #' || v_order_id || ' collected by ' || v_rider_name END
        )
      );
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
    'stock_deducted', true,
    'unmatched_lines', v_unmatched
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Database execution error: ' || SQLERRM
  );
END;
$function$;
