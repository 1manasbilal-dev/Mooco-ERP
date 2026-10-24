-- Milk allocation in one locked transaction per action (2026-10-24).
-- Requires 20261023110000_money_rpc_helpers.sql and 20261024100000_stock_inbound_helpers.sql.
--
-- Before: allocateBulkMilk updated each pool row, read the counter item, added the litres, wrote the
-- average cost back and logged, line by line from the browser. A failure halfway left pool rows
-- allocated with no counter stock; the litres were added as-is to a milk item stocked in ml (2 L
-- became 2 ml); and when no counter milk item was found the milk left the pool and went nowhere.
-- allocateFromRetailStock checked stock, then moved each line separately.
--
-- allocate_milk_pool: every pool line (checked against what is left on the locked row) and, for
-- the retail counter, the counter item's loose stock (litres converted to its unit; a unit that
-- can't take litres is refused), its moving-average cost and the stock log move together.
--
-- take_counter_milk: counter milk sent to production. All lines are converted to each item's unit,
-- checked against loose stock on the locked rows, then taken out with one log per item.
--
-- p_request_id makes a resend after a lost response a no-op. Both need allocation:create.

create or replace function public.allocate_milk_pool(p_request_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text := nullif(btrim(coalesce(p_payload ->> 'destination', '')), '');
  v_retail boolean;
  v_lines jsonb := p_payload -> 'lines';
  v_line jsonb;
  v_idx int := 0;
  v_alloc allocations;
  v_left numeric;
  v_qty numeric;
  v_new_remaining numeric;
  v_full boolean;
  v_details jsonb;
  v_item items;
  v_stock_qty numeric;
  v_rate numeric;
  v_value numeric;
  v_on_hand numeric;
  v_new_cost numeric;
  v_rows jsonb := '[]'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_ref text;
begin
  perform app_private.assert_can('allocation', 'create', 'doodh allocate karne');
  if nullif(p_request_id, '') is null then raise exception 'request id zaroori hai.'; end if;
  if v_dest is null then raise exception 'Doodh kahan bhejna hai (destination) zaroori hai.'; end if;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Allocation mein koi line nahi.';
  end if;
  v_retail := v_dest = 'Retail Counter';

  perform pg_advisory_xact_lock(hashtext('allocate_milk_pool:' || p_request_id));
  if exists (
    select 1 from allocations a
    where (a.id in (select l.value ->> 'allocation_id' from jsonb_array_elements(v_lines) l)
           or a.purchase_id in (select l.value ->> 'allocation_id' from jsonb_array_elements(v_lines) l))
      and coalesce(a.details -> 'request_ids', '[]'::jsonb) ? p_request_id
  ) then
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_rows
    from allocations a where coalesce(a.details -> 'request_ids', '[]'::jsonb) ? p_request_id;
    return jsonb_build_object('already_applied', true, 'rows', v_rows);
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_idx := v_idx + 1;
    v_ref := v_line ->> 'allocation_id';
    select * into v_alloc from allocations
    where id = v_ref or purchase_id = v_ref
    order by (id = v_ref) desc
    limit 1
    for update;
    if not found then raise exception 'Doodh ka lot nahi mila (%). Page reload karein.', v_ref; end if;

    v_qty := round(app_private.jnum(v_line -> 'quantity'), 3);
    if v_qty is null or v_qty <= 0 then raise exception 'Allocate karne ki miqdar 0 se zyada honi chahiye.'; end if;
    v_left := round(greatest(0, coalesce(v_alloc.remaining_quantity,
      coalesce(v_alloc.original_quantity, 0) - coalesce(v_alloc.allocated_quantity, 0))), 3);
    if v_qty > v_left + 0.001 then
      raise exception 'Sirf % L doodh baqi hai (%), % L allocate nahi ho sakta.', v_left, coalesce(v_alloc.supplier_name, 'lot'), v_qty;
    end if;
    v_new_remaining := round(greatest(0, v_left - v_qty), 3);
    v_full := v_new_remaining <= 0.01;

    v_details := case when jsonb_typeof(v_alloc.details) = 'object' then v_alloc.details else '{}'::jsonb end;
    v_details := v_details || jsonb_build_object(
      'allocation_history',
        (case when jsonb_typeof(v_details -> 'allocation_history') = 'array' then v_details -> 'allocation_history' else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object(
             'allocated_at', now(), 'quantity', v_qty, 'destination', v_dest,
             'rate', coalesce(v_alloc.average_rate, app_private.jnum(p_payload -> 'rate')), 'request_id', p_request_id)),
      'last_allocated_at', now(),
      'last_destination', v_dest,
      'request_ids', coalesce(v_details -> 'request_ids', '[]'::jsonb) || to_jsonb(p_request_id)
    );

    update allocations
    set remaining_quantity = case when v_full then 0 else v_new_remaining end,
        allocated_quantity = round(coalesce(allocated_quantity, 0) + v_qty, 3),
        status = case when v_full then 'Fully Allocated' else 'Partially Allocated' end,
        destination = case when v_full then v_dest else coalesce(destination, v_dest) end,
        details = v_details
    where id = v_alloc.id
    returning * into v_alloc;
    v_rows := v_rows || to_jsonb(v_alloc);

    if v_retail then
      select * into v_item from items where id = v_line ->> 'item_id' for update;
      if not found then
        raise exception 'Counter ka doodh item nahi mila (% milk). Catalog mein L ya ml wala milk item banayein.', coalesce(v_alloc.milk_type, 'Mixed');
      end if;
      v_stock_qty := app_private.convert_qty(v_qty, 'L', coalesce(nullif(btrim(v_item.unit), ''), 'L'));
      if v_stock_qty is null then
        raise exception '%: litre ko "%" mein badla nahi ja sakta. Counter doodh ke liye L ya ml wala item chahiye.', v_item.name, v_item.unit;
      end if;
      v_stock_qty := round(v_stock_qty, 3);

      -- Average cost per stock unit: the lot's litre rate spread over the converted quantity.
      v_rate := coalesce(nullif(v_alloc.average_rate, 0), nullif(app_private.jnum(p_payload -> 'rate'), 0));
      v_value := case when v_rate is not null then v_qty * v_rate else v_stock_qty * coalesce(v_item.cost_price, 0) end;
      v_on_hand := app_private.on_hand_base(v_item.stock, v_item.variant_stocks, v_item.variants);
      v_new_cost := app_private.average_cost_after_intake(v_on_hand, v_item.cost_price, v_stock_qty, v_value);

      perform app_private.move_item_stock(
        v_item.id, v_stock_qty, '{}'::jsonb,
        'log_alloc_' || p_request_id || '_' || v_idx,
        now(),
        'Allocation',
        'Allocated to Counter from ' || coalesce(v_alloc.supplier_name, 'Milk Tank') || ' (Purchase #' || coalesce(v_alloc.purchase_id, 'N/A') || ')',
        jsonb_build_object('allocation_id', v_alloc.id, 'purchase_id', v_alloc.purchase_id, 'litres', v_qty, 'request_id', p_request_id)
      );
      if v_new_cost > 0 then
        update items set cost_price = v_new_cost where id = v_item.id;
      end if;
      v_items := v_items || jsonb_build_object(v_item.id, app_private.item_state(v_item.id));
    end if;
  end loop;

  return jsonb_build_object('applied', true, 'rows', v_rows, 'items', v_items);
end;
$$;

create or replace function public.take_counter_milk(p_request_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text := coalesce(nullif(btrim(coalesce(p_payload ->> 'destination', '')), ''), 'Production');
  v_lines jsonb := p_payload -> 'lines';
  v_line jsonb;
  v_item items;
  v_qty numeric;
  v_unit text;
  v_stock_qty numeric;
  v_need jsonb := '{}'::jsonb;
  v_key text;
  v_entry jsonb;
  v_idx int := 0;
  v_items jsonb := '{}'::jsonb;
begin
  perform app_private.assert_can('allocation', 'create', 'counter ka doodh allocate karne');
  if nullif(p_request_id, '') is null then raise exception 'request id zaroori hai.'; end if;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Allocation mein koi line nahi.';
  end if;

  perform pg_advisory_xact_lock(hashtext('take_counter_milk:' || p_request_id));
  if exists (select 1 from inventory_logs where id = 'log_alloc_ret_' || p_request_id || '_1') then
    return jsonb_build_object('already_applied', true);
  end if;

  -- Every line in the item's own unit, summed per item, before anything moves.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    select * into v_item from items where id = v_line ->> 'item_id' for update;
    if not found then raise exception 'Counter item "%" nahi mila. Page reload karein.', v_line ->> 'item_id'; end if;
    v_qty := round(app_private.jnum(v_line -> 'quantity'), 3);
    if v_qty is null or v_qty <= 0 then raise exception '%: miqdar 0 se zyada honi chahiye.', v_item.name; end if;
    v_unit := coalesce(nullif(btrim(v_line ->> 'unit'), ''), 'L');
    v_stock_qty := app_private.convert_qty(v_qty, v_unit, coalesce(nullif(btrim(v_item.unit), ''), v_unit));
    if v_stock_qty is null then
      raise exception '%: % ko % mein badla nahi ja sakta. Ye item yahan allocate nahi ho sakta.', v_item.name, v_unit, v_item.unit;
    end if;
    v_entry := coalesce(v_need -> v_item.id, jsonb_build_object('qty', 0, 'litres', 0));
    v_need := v_need || jsonb_build_object(v_item.id, jsonb_build_object(
      'qty', round((v_entry ->> 'qty')::numeric + v_stock_qty, 3),
      'litres', round((v_entry ->> 'litres')::numeric + coalesce(app_private.convert_qty(v_qty, v_unit, 'L'), v_qty), 3)
    ));
  end loop;

  for v_key, v_entry in select key, value from jsonb_each(v_need) order by key loop
    select * into v_item from items where id = v_key;
    if round(coalesce(v_item.stock, 0), 3) + 0.001 < (v_entry ->> 'qty')::numeric then
      raise exception '%: sirf % % stock hai, % allocate nahi ho sakta.', v_item.name, round(coalesce(v_item.stock, 0), 3), coalesce(v_item.unit, ''), v_entry ->> 'qty';
    end if;
  end loop;

  for v_key, v_entry in select key, value from jsonb_each(v_need) order by key loop
    v_idx := v_idx + 1;
    perform app_private.move_item_stock(
      v_key, -(v_entry ->> 'qty')::numeric, '{}'::jsonb,
      'log_alloc_ret_' || p_request_id || '_' || v_idx,
      now(),
      'Allocation',
      'Leftover Milk Allocated to ' || v_dest,
      jsonb_build_object('litres', -(v_entry ->> 'litres')::numeric, 'request_id', p_request_id)
    );
    v_items := v_items || jsonb_build_object(v_key, app_private.item_state(v_key));
  end loop;

  return jsonb_build_object('applied', true, 'items', v_items);
end;
$$;

revoke all on function public.allocate_milk_pool(text, jsonb) from public, anon;
revoke all on function public.take_counter_milk(text, jsonb) from public, anon;
grant execute on function public.allocate_milk_pool(text, jsonb) to authenticated, service_role;
grant execute on function public.take_counter_milk(text, jsonb) to authenticated, service_role;
