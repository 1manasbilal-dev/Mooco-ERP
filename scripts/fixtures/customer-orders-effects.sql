CREATE OR REPLACE FUNCTION public.adjust_account_balance(p_account_id text, p_delta numeric)
 RETURNS numeric
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update financial_accounts
  set balance = round(balance + p_delta, 2)
  where id = p_account_id
  returning balance;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_customer_balance(p_customer_id text, p_delta numeric)
 RETURNS numeric
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update customers
  set balance = round(balance + p_delta, 2)
  where id = p_customer_id
  returning balance;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_item_stock(p_item_id text, p_loose_delta numeric DEFAULT 0, p_variant_deltas jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old_loose numeric;
  v_old_variants jsonb;
  v_new_variants jsonb;
  v_new_loose numeric;
begin
  select stock, coalesce(variant_stocks, '{}'::jsonb)
  into v_old_loose, v_old_variants
  from items
  where id = p_item_id;

  if v_old_loose is null then
    return null;
  end if;

  -- Only the keys in p_variant_deltas change (old + delta); all other
  -- variant keys are carried over untouched.
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
$function$
;

CREATE OR REPLACE FUNCTION public.pos_sync_order_effects(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Variant deltas are NEGATIVE quantities (stock deduction).
      select coalesce(sum(qty) filter (where variant_id is null), 0),
             coalesce(jsonb_object_agg(variant_id, -round(qty, 3))
                      filter (where variant_id is not null), '{}'::jsonb)
      into v_loose, v_variants
      from jsonb_to_recordset(coalesce(p_payload -> 'items', '[]'::jsonb)) as x(item_id text, variant_id text, qty numeric)
      where item_id = v_item_id;

      select stock, name
      into v_old_stock, v_item_name
      from items
      where id = v_item_id
      for update;

      if v_old_stock is not null then
        -- Atomic stock deduction (loose + variant packs) in a single UPDATE
        v_stock_result := public.adjust_item_stock(v_item_id, -coalesce(v_loose, 0), v_variants);

        insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes)
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
$function$
;
