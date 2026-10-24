-- Supplies (material) purchase and its return / delete in one locked transaction each (2026-10-24).
-- Requires 20261023110000_money_rpc_helpers.sql and 20261024100000_stock_inbound_helpers.sql.
--
-- Before: addBulkMaterialPurchase read each item in the browser, inserted the bill line, moved
-- stock, wrote the average cost back as an absolute number and logged, line by line, then posted
-- khata, cash and the supplier ledger in more calls. A failure halfway left stock without payment
-- (or the reverse); two bills at once overwrote each other's average cost; the conversion factor
-- and the stock pile came from the browser. returnMaterialPurchase had the same shape.
--
-- record_material_purchase: every line, its stock pile, the moving-average cost (from total on
-- hand, read on the locked item row), the stock log, the supplier khata, the cash / bank payment
-- and the supplier ledger row move together. The pile and the conversion come from the catalog:
-- the item's base unit -> loose; a ready-made pack -> that pack pile (count); a multi-unit
-- (dozen, tray) or a convertible unit (g -> kg) -> loose x conversion; anything else is refused.
-- p_request_id makes a resend after a lost response a no-op. Needs purchase:create.
--
-- return_material_purchase: reverses exactly the pile the purchase added (the pack it was stocked
-- as, else loose at the purchase's own conversion), takes the goods out of the average at the rate
-- they came in, refunds the paid share in cash or lowers the khata, and writes the ledger row.
-- p_return_id makes a resend a no-op. A delete is a full return with reason 'Deleted by user'
-- and is also refused inside closed books. Needs purchase:delete.

create or replace function public.record_material_purchase(p_request_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_lines jsonb := p_payload -> 'lines';
  v_line jsonb;
  v_idx int := 0;
  v_count int;
  v_date timestamptz := coalesce(nullif(p_payload ->> 'date', '')::timestamptz, now());
  v_supplier_id text := nullif(p_payload ->> 'supplier_id', '');
  v_supplier suppliers;
  v_supplier_name text;
  v_purchase_type text := coalesce(nullif(p_payload ->> 'purchase_type', ''), 'Raw Material');
  v_payment_mode text := coalesce(nullif(p_payload ->> 'payment_mode', ''), 'Cash');
  v_account_id text := nullif(p_payload ->> 'account_id', '');
  v_in_drawer boolean;
  v_total numeric := 0;
  v_requested_paid numeric;
  v_paid numeric;
  v_unpaid numeric;
  v_paid_left numeric;
  v_line_total numeric;
  v_line_paid numeric;
  v_line_due numeric;
  v_item items;
  v_unit text;
  v_item_unit text;
  v_variant jsonb;
  v_factor numeric;
  v_pack_id text;
  v_qty numeric;
  v_rate numeric;
  v_base_qty numeric;
  v_on_hand numeric;
  v_new_cost numeric;
  v_move jsonb;
  v_ids text[] := '{}';
  v_line_paid_map jsonb := '{}'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_row material_purchases;
  v_note_lines text[] := '{}';
  v_supplier_balance numeric;
begin
  perform app_private.assert_can('purchase', 'create', 'supplies purchase karne');
  if nullif(p_request_id, '') is null then raise exception 'request id zaroori hai.'; end if;
  v_prefix := 'mp_' || p_request_id || '_';

  -- Same request twice (Save pressed again after a lost response): answer with what was saved.
  perform pg_advisory_xact_lock(hashtext('record_material_purchase:' || p_request_id));
  if exists (select 1 from material_purchases where id = v_prefix || '1') then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_rows
    from material_purchases m where left(m.id, length(v_prefix)) = v_prefix;
    return jsonb_build_object('already_applied', true, 'rows', v_rows);
  end if;

  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Bill mein koi item nahi.';
  end if;
  v_count := jsonb_array_length(v_lines);

  perform app_private.assert_books_open(v_date, p_payload ->> 'business_day_id');

  -- Bill total and the paid share, the way the purchase screen shows them.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_qty := app_private.jnum(v_line -> 'quantity');
    v_rate := app_private.jnum(v_line -> 'rate');
    if v_qty is null or v_qty <= 0 or v_rate is null or v_rate < 0 then
      raise exception '"%" ki quantity 0 se zyada aur rate minus ke baghair hona chahiye.', coalesce(v_line ->> 'item_name', v_line ->> 'item_id');
    end if;
    v_total := v_total + v_qty * v_rate;
  end loop;
  v_total := round(v_total, 2);

  v_requested_paid := round(greatest(0, coalesce(app_private.jnum(p_payload -> 'paid_amount'),
    case when v_supplier_id is null then v_total else 0 end)), 2);
  if v_requested_paid > v_total + 0.01 then
    raise exception 'Paid (Rs %) bill (Rs %) se zyada hai. Zyada raqam supplier ko alag Advance payment ke taur par dein.', v_requested_paid, v_total;
  end if;
  v_paid := least(v_requested_paid, v_total);
  v_unpaid := round(greatest(0, v_total - v_paid), 2);
  if v_supplier_id is null and v_unpaid > 0.01 then
    raise exception 'Khata (udhaar) purchase ke liye supplier chunein, ya poori raqam ada karein.';
  end if;
  if v_paid > 0 and v_account_id is null then
    raise exception 'Payment account nahi mila! Pehle ''Bank & Cash'' mein account banayein ya bill ko Khata per save karein.';
  end if;

  if v_supplier_id is not null then
    select * into v_supplier from suppliers where id = v_supplier_id for update;
    if not found then raise exception 'Supplier nahi mila. Page reload karein.'; end if;
    v_supplier_name := v_supplier.name;
  end if;

  v_paid_left := v_paid;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_idx := v_idx + 1;
    v_qty := round(app_private.jnum(v_line -> 'quantity'), 3);
    v_rate := app_private.jnum(v_line -> 'rate');
    v_line_total := round(v_qty * v_rate, 2);
    if v_idx = v_count then
      v_line_paid := round(greatest(0, v_paid_left), 2);
    else
      v_line_paid := case when v_total > 0 then round(v_line_total / v_total * v_paid, 2) else 0 end;
      v_paid_left := round(v_paid_left - v_line_paid, 2);
    end if;
    v_line_due := round(greatest(0, v_line_total - v_line_paid), 2);

    select * into v_item from items where id = v_line ->> 'item_id' for update;
    if not found then
      raise exception '"%" catalog mein nahi mila. Bill save nahi hua.', coalesce(v_line ->> 'item_name', v_line ->> 'item_id');
    end if;

    -- Which pile, from the catalog (the browser's conversion factor is not trusted).
    v_item_unit := coalesce(nullif(btrim(v_item.unit), ''), 'pcs');
    v_unit := coalesce(nullif(btrim(v_line ->> 'unit'), ''), v_item_unit);
    v_pack_id := null;
    v_variant := null;
    if lower(v_unit) = lower(v_item_unit) then
      v_factor := 1;
    else
      select v.value into v_variant
      from jsonb_array_elements(case when jsonb_typeof(v_item.variants) = 'array' then v_item.variants else '[]'::jsonb end) v
      where lower(btrim(v.value ->> 'name')) = lower(v_unit)
      order by (coalesce(v.value -> 'isActive', 'true'::jsonb) <> 'false'::jsonb) desc
      limit 1;
      if v_variant is not null then
        v_factor := app_private.pack_size(v_variant);
        if app_private.is_pack(v_variant) then v_pack_id := v_variant ->> 'id'; end if;
      else
        v_factor := app_private.convert_qty(1, v_unit, v_item_unit);
        if v_factor is null or v_factor <= 0 then
          raise exception '%: unit "%" ko "%" mein badla nahi ja sakta. Product ke Units & Packaging mein ye unit banayein.', v_item.name, v_unit, v_item_unit;
        end if;
      end if;
    end if;
    v_base_qty := round(v_qty * v_factor, 3);

    -- Average cost over everything on hand before this intake, on the locked row.
    v_on_hand := app_private.on_hand_base(v_item.stock, v_item.variant_stocks, v_item.variants);
    v_new_cost := app_private.average_cost_after_intake(v_on_hand, v_item.cost_price, v_base_qty, v_line_total);

    insert into material_purchases (
      id, date, supplier_id, item_id, item_name, quantity, unit, rate, total_amount, purchase_type, status,
      business_day_id, shift_session_id, drawer_id, cashier_id, details
    ) values (
      v_prefix || v_idx, v_date, v_supplier_id, v_item.id, coalesce(nullif(v_line ->> 'item_name', ''), v_item.name),
      v_qty, v_unit, v_rate, v_line_total, v_purchase_type, 'Completed',
      nullif(p_payload ->> 'business_day_id', ''), nullif(p_payload ->> 'shift_session_id', ''),
      nullif(p_payload ->> 'drawer_id', ''), nullif(p_payload ->> 'cashier_id', ''),
      jsonb_strip_nulls(jsonb_build_object(
        'paid_amount', v_line_paid,
        'due_amount', v_line_due,
        'payment_mode', case when v_line_paid > 0 then v_payment_mode end,
        'account_id', case when v_line_paid > 0 then v_account_id end,
        'conversion_factor', v_factor,
        'base_quantity', v_base_qty,
        'base_unit', v_item_unit,
        'variant_id', v_pack_id,
        'stocked_as', case when v_pack_id is not null then 'packs' else 'loose' end,
        'request_id', p_request_id
      ))
    ) returning * into v_row;
    v_ids := v_ids || v_row.id;
    v_line_paid_map := v_line_paid_map || jsonb_build_object(v_row.id, v_line_paid);
    v_rows := v_rows || to_jsonb(v_row);
    v_note_lines := v_note_lines || (v_qty || ' ' || v_unit || ' ' || v_row.item_name);

    v_move := app_private.move_item_stock(
      v_item.id,
      case when v_pack_id is null then v_base_qty else 0 end,
      case when v_pack_id is not null then jsonb_build_object(v_pack_id, v_qty) else '{}'::jsonb end,
      'log_purch_' || p_request_id || '_' || v_idx,
      now(),
      'Purchase',
      case when v_supplier_id is not null then 'Vendor: ' || coalesce(v_supplier_name, v_supplier_id) else 'Spot Cash Purchase' end
        || case when v_factor <> 1 or v_pack_id is not null
             then ' (' || v_qty || ' ' || v_unit || ' = ' || v_base_qty || ' ' || v_item_unit
                  || case when v_pack_id is not null then ', stocked as packs' else '' end || ')'
             else '' end,
      jsonb_build_object('purchase_id', v_row.id, 'request_id', p_request_id)
    );
    if v_new_cost > 0 then
      update items set cost_price = v_new_cost where id = v_item.id;
    end if;
    v_items := v_items || jsonb_build_object(v_item.id, app_private.item_state(v_item.id));
  end loop;

  if v_supplier_id is not null and v_unpaid > 0 then
    v_supplier_balance := public.adjust_supplier_balance(v_supplier_id, v_unpaid);
  end if;

  if v_paid > 0 then
    v_in_drawer := v_account_id = any(array(select jsonb_array_elements_text(coalesce(p_payload -> 'drawer_account_ids', '[]'::jsonb))));
    perform app_private.post_bank_tx(
      'btx_mp_' || p_request_id, v_account_id, 'Expense', v_paid, v_date, 'Purchase',
      'Material Purchase (' || v_purchase_type || ') - ' || coalesce(v_supplier_name, 'Spot Vendor'),
      array_to_string(v_ids, ','),
      p_payload ->> 'business_day_id',
      case when v_in_drawer then p_payload ->> 'shift_session_id' end,
      case when v_in_drawer then p_payload ->> 'drawer_id' end,
      p_payload ->> 'cashier_id'
    );
    if v_supplier_id is not null then
      insert into supplier_transactions (id, supplier_id, date, type, amount, details)
      values (
        'stx_mp_' || p_request_id, v_supplier_id, v_date, 'Payment', v_paid,
        jsonb_build_object(
          'mode', v_payment_mode,
          'note', 'Spot Payment for Material Purchase (' || array_to_string(v_note_lines, ', ') || ')',
          'account_id', v_account_id,
          'purchase_ids', to_jsonb(v_ids),
          'line_paid', v_line_paid_map
        )
      );
    end if;
  end if;

  if v_supplier_id is not null and v_supplier_balance is null then
    select balance into v_supplier_balance from suppliers where id = v_supplier_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'rows', v_rows,
    'purchase_ids', to_jsonb(v_ids),
    'total', v_total,
    'paid', v_paid,
    'unpaid', v_unpaid,
    'account_id', case when v_paid > 0 then v_account_id end,
    'account_balance', case when v_paid > 0 then (select balance from financial_accounts where id = v_account_id) end,
    'bank_tx_id', case when v_paid > 0 then 'btx_mp_' || p_request_id end,
    'supplier_tx_id', case when v_paid > 0 and v_supplier_id is not null then 'stx_mp_' || p_request_id end,
    'supplier_id', v_supplier_id,
    'supplier_balance', v_supplier_balance,
    'items', v_items
  );
end;
$$;

create or replace function public.return_material_purchase(p_purchase_id text, p_return_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mp material_purchases;
  v_det jsonb;
  v_now timestamptz := now();
  v_reason text := coalesce(nullif(p_payload ->> 'reason', ''), 'Material Return to Supplier');
  v_refund_as text := coalesce(nullif(p_payload ->> 'refund_as', ''), 'cash');
  v_req_qty numeric := round(app_private.jnum(p_payload -> 'return_qty'), 3);
  v_total_qty numeric;
  v_qty numeric;
  v_full boolean;
  v_rate numeric;
  v_return_amount numeric;
  v_remaining_qty numeric;
  v_remaining_amount numeric;
  v_orig_paid numeric;
  v_account_id text;
  v_bill numeric;
  v_cash_refund numeric := 0;
  v_remaining_paid numeric;
  v_credit numeric;
  v_conversion numeric;
  v_base_qty numeric;
  v_item items;
  v_has_item boolean := false;
  v_variant jsonb;
  v_pack_id text;
  v_on_hand numeric;
  v_base_rate numeric;
  v_left numeric;
  v_revised numeric;
  v_supplier suppliers;
  v_has_supplier boolean := false;
  v_supplier_balance numeric;
  v_new_details jsonb;
  v_in_drawer boolean;
  v_item_state jsonb;
begin
  perform app_private.assert_can('purchase', 'delete', 'supplies wapas karne');
  if nullif(p_return_id, '') is null then raise exception 'return id zaroori hai.'; end if;
  if v_refund_as not in ('cash', 'khata') then raise exception 'Refund ka tareeqa ghalat hai.'; end if;

  select * into v_mp from material_purchases where id = p_purchase_id for update;
  if not found then raise exception 'Material purchase nahi mili. Page reload karein.'; end if;
  v_det := coalesce(v_mp.details, '{}'::jsonb);
  if coalesce(v_det -> 'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true, 'purchase_id', p_purchase_id, 'row', to_jsonb(v_mp));
  end if;
  if v_mp.status = 'Returned' then raise exception 'Ye material purchase pehle hi wapas ho chuki hai.'; end if;

  perform app_private.assert_books_open(v_now, p_payload ->> 'business_day_id');
  if v_reason = 'Deleted by user' then
    perform app_private.assert_books_open(v_mp.date, null);
  end if;

  v_total_qty := round(coalesce(v_mp.quantity, 0), 3);
  if v_req_qty is not null and (v_req_qty <= 0 or v_req_qty > v_total_qty + 0.0005) then
    raise exception 'Wapsi ki miqdar 0 se zyada aur % % tak honi chahiye.', v_total_qty, coalesce(v_mp.unit, '');
  end if;
  v_qty := least(coalesce(v_req_qty, v_total_qty), v_total_qty);
  if v_qty <= 0 then raise exception 'Is entry mein wapas karne ko kuch nahi.'; end if;
  v_full := v_qty >= v_total_qty;
  v_rate := coalesce(v_mp.rate, 0);
  v_return_amount := round(v_qty * v_rate, 2);
  v_remaining_qty := round(v_total_qty - v_qty, 3);
  v_remaining_amount := round(v_remaining_qty * v_rate, 2);

  v_orig_paid := round(coalesce(app_private.jnum(v_det -> 'paid_amount'), 0), 2);
  v_account_id := nullif(v_det ->> 'account_id', '');
  v_bill := coalesce(nullif(v_mp.total_amount, 0), v_total_qty * v_rate);
  if v_refund_as = 'cash' and v_orig_paid > 0 and v_account_id is not null and v_bill > 0 then
    v_cash_refund := round(least(v_orig_paid, v_return_amount * (v_orig_paid / v_bill)), 2);
  end if;
  v_remaining_paid := round(greatest(0, v_orig_paid - v_cash_refund), 2);

  -- The goods leave the pile the purchase put them in.
  v_conversion := coalesce(nullif(app_private.jnum(v_det -> 'conversion_factor'), 0), 1);
  v_base_qty := round(v_qty * v_conversion, 3);
  select * into v_item from items where id = v_mp.item_id for update;
  v_has_item := found;
  if not v_has_item and nullif(v_mp.item_name, '') is not null then
    select * into v_item from items where lower(name) = lower(v_mp.item_name) order by id limit 1 for update;
    v_has_item := found;
  end if;

  if v_has_item then
    if nullif(v_det ->> 'variant_id', '') is not null then
      select v.value into v_variant
      from jsonb_array_elements(case when jsonb_typeof(v_item.variants) = 'array' then v_item.variants else '[]'::jsonb end) v
      where v.value ->> 'id' = v_det ->> 'variant_id'
      limit 1;
      -- Still a ready-made pack: back out of that pack pile. Deleted or turned into a multi-unit:
      -- out of loose at the size it was bought at.
      if app_private.is_pack(v_variant) then v_pack_id := v_det ->> 'variant_id'; end if;
    end if;

    v_on_hand := app_private.on_hand_base(v_item.stock, v_item.variant_stocks, v_item.variants);
    perform app_private.move_item_stock(
      v_item.id,
      case when v_pack_id is null then -v_base_qty else 0 end,
      case when v_pack_id is not null then jsonb_build_object(v_pack_id, -v_qty) else '{}'::jsonb end,
      'log_mp_ret_' || p_return_id,
      v_now,
      'Supply Return',
      case when v_full then 'Full' else 'Partial' end || ' Material Return to Supplier: ' || v_qty || ' ' || coalesce(v_mp.unit, '') || ' (' || v_reason || ')',
      jsonb_build_object('purchase_id', v_mp.id, 'return_id', p_return_id)
    );

    -- Take the returned goods out of the average at the rate they came in at.
    v_base_rate := case when v_conversion > 0 then v_rate / v_conversion else 0 end;
    v_left := v_on_hand - v_base_qty;
    if v_left > 0.0005 and v_base_rate > 0 and coalesce(v_item.cost_price, 0) > 0 then
      v_revised := round((v_on_hand * v_item.cost_price - v_base_qty * v_base_rate) / v_left, 4);
      if v_revised > 0 then
        update items set cost_price = v_revised where id = v_item.id;
      end if;
    end if;
    v_item_state := app_private.item_state(v_item.id);
  end if;

  if v_full then
    v_new_details := v_det || jsonb_build_object(
      'returned', true,
      'return_reason', v_reason,
      'returned_at', v_now,
      'returned_quantity', round(coalesce(app_private.jnum(v_det -> 'returned_quantity'), 0) + v_qty, 3),
      'original_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'original_intake_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'original_paid_amount', coalesce(v_det -> 'original_paid_amount', to_jsonb(v_orig_paid)),
      'paid_amount', v_remaining_paid,
      'cash_refund', round(coalesce(app_private.jnum(v_det -> 'cash_refund'), 0) + v_cash_refund, 2),
      'return_ids', coalesce(v_det -> 'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
    );
    if v_account_id is not null then v_new_details := v_new_details || jsonb_build_object('account_id', v_account_id); end if;
    update material_purchases set status = 'Returned', details = v_new_details where id = p_purchase_id
    returning * into v_mp;
  else
    v_new_details := v_det || jsonb_build_object(
      'partial_returned', true,
      'returned_quantity', round(coalesce(app_private.jnum(v_det -> 'returned_quantity'), 0) + v_qty, 3),
      'original_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'original_intake_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'return_reason', v_reason,
      'base_quantity', round(v_remaining_qty * v_conversion, 3),
      'returned_at', v_now,
      'original_paid_amount', coalesce(v_det -> 'original_paid_amount', to_jsonb(v_orig_paid)),
      'paid_amount', v_remaining_paid,
      'due_amount', round(greatest(0, v_remaining_amount - v_remaining_paid), 2),
      'cash_refund', round(coalesce(app_private.jnum(v_det -> 'cash_refund'), 0) + v_cash_refund, 2),
      'return_ids', coalesce(v_det -> 'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
    );
    if v_account_id is not null then v_new_details := v_new_details || jsonb_build_object('account_id', v_account_id); end if;
    update material_purchases
    set quantity = v_remaining_qty, total_amount = v_remaining_amount, status = 'Completed', details = v_new_details
    where id = p_purchase_id
    returning * into v_mp;
  end if;

  if v_cash_refund > 0 then
    -- Only cash coming back into the open drawer belongs to that shift's count.
    v_in_drawer := v_account_id = any(array(select jsonb_array_elements_text(coalesce(p_payload -> 'drawer_account_ids', '[]'::jsonb))));
    perform app_private.post_bank_tx(
      'btx_mpret_' || p_return_id, v_account_id, 'Income', v_cash_refund, v_now, 'Purchase Return',
      'Material Return Cash Refund: ' || coalesce(v_mp.item_name, '') || ' (' || v_qty || ' ' || coalesce(v_mp.unit, '') || ')',
      v_mp.id,
      p_payload ->> 'business_day_id',
      case when v_in_drawer then p_payload ->> 'shift_session_id' end,
      case when v_in_drawer then p_payload ->> 'drawer_id' end,
      p_payload ->> 'cashier_id'
    );
  end if;

  v_credit := round(greatest(0, v_return_amount - v_cash_refund), 2);
  if v_mp.supplier_id is not null then
    select * into v_supplier from suppliers where id = v_mp.supplier_id for update;
    v_has_supplier := found;
  end if;
  if v_has_supplier then
    if v_credit > 0 then
      v_supplier_balance := public.adjust_supplier_balance(v_supplier.id, -v_credit);
    else
      v_supplier_balance := v_supplier.balance;
    end if;
    insert into supplier_transactions (id, supplier_id, date, type, amount, details)
    values (
      'stx_mpret_' || p_return_id, v_supplier.id, v_now, 'Return', v_return_amount,
      jsonb_build_object(
        'note', case when v_full then 'Full' else 'Partial' end || ' Material Return: ' || v_qty || ' ' || coalesce(v_mp.unit, '')
                || ' of ' || coalesce(v_mp.item_name, '') || ' (' || v_reason || ')'
                || case when v_cash_refund > 0 then ' (Cash Refunded: Rs ' || v_cash_refund || ')' else '' end,
        'purchase_id', v_mp.id,
        'cash_refund', v_cash_refund,
        'account_id', v_account_id
      )
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'purchase_id', p_purchase_id,
    'row', to_jsonb(v_mp),
    'status', v_mp.status,
    'is_full', v_full,
    'return_qty', v_qty,
    'return_amount', v_return_amount,
    'cash_refund', v_cash_refund,
    'supplier_credit', case when v_has_supplier then v_credit else 0 end,
    'supplier_id', case when v_has_supplier then v_supplier.id end,
    'supplier_balance', v_supplier_balance,
    'account_id', v_account_id,
    'remaining_qty', v_remaining_qty,
    'remaining_amount', v_remaining_amount,
    'remaining_paid', v_remaining_paid,
    'item', v_item_state
  );
end;
$$;

revoke all on function public.record_material_purchase(text, jsonb) from public, anon;
revoke all on function public.return_material_purchase(text, text, jsonb) from public, anon;
grant execute on function public.record_material_purchase(text, jsonb) to authenticated, service_role;
grant execute on function public.return_material_purchase(text, text, jsonb) to authenticated, service_role;
