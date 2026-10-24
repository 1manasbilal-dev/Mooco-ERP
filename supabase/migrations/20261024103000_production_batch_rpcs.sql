-- Production batch completion and cancel in one locked transaction each (2026-10-24).
-- Requires 20261023110000_money_rpc_helpers.sql and 20261024100000_stock_inbound_helpers.sql.
--
-- Before: updateBatchStage did it all from the browser, one write at a time: materials were taken
-- only from loose stock (packs of sugar or cups were never opened), a recipe unit that could not be
-- converted to the material's unit was deducted as the raw number (500 "g" off a stock in pcs),
-- material moves were not error-checked, the product's average cost was written back as an
-- absolute number, a product missing from the catalog was invented as a new kg item, and the batch
-- status was written last, so a failure left stock moved on a batch still "in progress". Cancel
-- returned counter milk item by item with a delete as its undo, and two counter lines of the same
-- item returned only the first.
--
-- complete_production_batch: the product comes from the catalog (exact name, or a single close
-- match, or the id the screen sends). Materials (recipe x batch input / recipe base, converted to
-- each material's unit; packaging per pack produced) come from loose stock first, then whole packs
-- (smallest first) with the opened remainder back to loose; a shortfall leaves loose below zero
-- and is reported back. A recipe unit that can't be converted, or a material missing from the
-- catalog, refuses the completion. Outputs go to loose (3 decimals) and to the pack piles; a
-- multi-unit output (dozen, tray) goes to loose at its size. Cost snapshot, moving-average cost,
-- stock logs and the batch status move together. A completed batch answers "already done".
-- Refused on a locked day / closed books. Needs production:edit.
--
-- cancel_production_batch: counter milk goes back to the counter item it came from (litres
-- converted to the item's unit, one log per item), the rest back to the milk pool as a return
-- lot; then the batch is marked Cancelled. A cancelled batch answers "already done"; a completed
-- one is refused. Needs production:edit.

create or replace function public.complete_production_batch(p_batch_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch production_batches;
  v_det jsonb;
  v_now timestamptz := now();
  v_message text := coalesce(nullif(p_payload ->> 'message', ''), 'Batch completed');
  v_output jsonb := p_payload -> 'output';
  v_name text;
  v_product items;
  v_variants jsonb;
  v_pack jsonb;
  v_variant jsonb;
  v_count numeric;
  v_size numeric;
  v_loose numeric;
  v_packed_base numeric := 0;
  v_total_out numeric;
  v_pack_deltas jsonb := '{}'::jsonb;
  v_out_variants jsonb := '[]'::jsonb;
  v_pack_summary text[] := '{}';
  v_input numeric;
  v_scale numeric;
  v_ing jsonb;
  v_mat items;
  v_mat_unit text;
  v_mat_qty numeric;
  v_conv numeric;
  v_recipe_inputs jsonb := '[]'::jsonb;
  v_pack_inputs jsonb := '[]'::jsonb;
  v_need jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_milk_rate numeric;
  v_milk_cost numeric;
  v_ing_cost numeric := 0;
  v_pack_cost numeric := 0;
  v_total_cost numeric;
  v_remaining numeric;
  v_take numeric;
  v_loose_delta numeric;
  v_mat_packs jsonb;
  v_opened text[];
  v_p record;
  v_n numeric;
  v_short jsonb := '[]'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_on_hand numeric;
  v_new_cost numeric;
  v_unit text;
begin
  perform app_private.assert_can('production', 'edit', 'production batch complete karne');
  select * into v_batch from production_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch nahi mila. Page reload karein.'; end if;
  if v_batch.status = 'Completed' then
    return jsonb_build_object('already_applied', true, 'batch', to_jsonb(v_batch));
  end if;
  if v_batch.status = 'Cancelled' then
    raise exception 'Batch #% cancel ho chuka hai; complete nahi ho sakta.', coalesce(v_batch.batch_number, v_batch.id);
  end if;
  perform app_private.assert_stock_day_open(v_now);

  v_det := case when jsonb_typeof(v_batch.details) = 'object' then v_batch.details else '{}'::jsonb end;

  -- An older browser run already put this batch's output in stock: only the status is left.
  if exists (select 1 from inventory_logs where id = 'log_prod_' || v_batch.id) then
    update production_batches
    set status = 'Completed', completed_date = coalesce(completed_date, v_now),
        logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('stage', 'Completed', 'message', v_message, 'timestamp', v_now))
    where id = v_batch.id
    returning * into v_batch;
    return jsonb_build_object('applied', true, 'stock_already_posted', true, 'batch', to_jsonb(v_batch));
  end if;

  -- The product.
  v_name := lower(btrim(coalesce(v_batch.product_name, '')));
  if nullif(p_payload ->> 'product_item_id', '') is not null then
    select * into v_product from items where id = p_payload ->> 'product_item_id' for update;
    if not found then raise exception 'Product nahi mila. Page reload karein.'; end if;
  else
    select * into v_product from items where v_name <> '' and lower(btrim(name)) = v_name order by id limit 1 for update;
    if not found and v_name <> '' and (
      select count(*) from items i
      where btrim(coalesce(i.name, '')) <> ''
        and (strpos(lower(i.name), v_name) > 0 or strpos(v_name, lower(btrim(i.name))) > 0)
    ) = 1 then
      select * into v_product from items i
      where btrim(coalesce(i.name, '')) <> ''
        and (strpos(lower(i.name), v_name) > 0 or strpos(v_name, lower(btrim(i.name))) > 0)
      for update;
    end if;
    if v_product.id is null then
      raise exception 'Product "%" catalog mein nahi mila. Pehle ye product banayein (ya naam theek karein), phir batch complete karein.', v_batch.product_name;
    end if;
  end if;
  v_unit := coalesce(nullif(btrim(v_product.unit), ''), 'kg');
  v_variants := case when jsonb_typeof(v_product.variants) = 'array' then v_product.variants else '[]'::jsonb end;
  v_input := round(coalesce(v_batch.quantity_input, 0), 3);

  -- Output: loose quantity and pack counts. No output sent: the estimate goes to loose.
  if jsonb_typeof(v_output) is distinct from 'object' then
    v_loose := round(coalesce(nullif(v_batch.quantity_output_estimated, 0), v_input * 0.85), 3);
  else
    v_loose := round(coalesce(app_private.jnum(v_output -> 'loose_qty'), 0), 3);
    if v_loose < 0 then raise exception 'Loose output minus nahi ho sakta.'; end if;
    for v_pack in select value from jsonb_array_elements(case when jsonb_typeof(v_output -> 'packs') = 'array' then v_output -> 'packs' else '[]'::jsonb end) loop
      v_count := app_private.jnum(v_pack -> 'count');
      if v_count is null or v_count < 0 or v_count <> trunc(v_count) then
        raise exception 'Packs ki ginti poori (0, 1, 2 ...) honi chahiye.';
      end if;
      if v_count = 0 then continue; end if;
      v_variant := null;
      select v.value into v_variant from jsonb_array_elements(v_variants) v where v.value ->> 'id' = v_pack ->> 'variant_id' limit 1;
      if v_variant is null then
        raise exception '% ka ye pack ab catalog mein nahi. Page reload karke dobara complete karein.', v_product.name;
      end if;
      v_size := app_private.pack_size(v_variant);
      if app_private.is_pack(v_variant) then
        v_pack_deltas := v_pack_deltas || jsonb_build_object(v_variant ->> 'id',
          round(coalesce(app_private.jnum(v_pack_deltas -> (v_variant ->> 'id')), 0) + v_count, 3));
        v_packed_base := v_packed_base + v_count * v_size;
      else
        v_loose := round(v_loose + v_count * v_size, 3);
      end if;
      v_pack_summary := v_pack_summary || (v_count || 'x ' || coalesce(v_variant ->> 'name', 'pack'));
      v_out_variants := v_out_variants || jsonb_build_array(jsonb_build_object(
        'variantId', v_variant ->> 'id',
        'variant_name', coalesce(v_variant ->> 'name', 'Unknown'),
        'count', v_count,
        'base_qty_each', v_size,
        'total_base_qty', round(v_count * v_size, 3),
        'stocked_as', case when app_private.is_pack(v_variant) then 'packs' else 'loose' end
      ));

      -- Packaging used by these packs.
      if nullif(v_variant ->> 'packaging_item_id', '') is not null and coalesce(app_private.jnum(v_variant -> 'packaging_qty'), 0) > 0 then
        select * into v_mat from items where id = v_variant ->> 'packaging_item_id';
        if not found then
          raise exception '% ki packaging ka material catalog mein nahi mila. Pack ki packaging theek karein.', coalesce(v_variant ->> 'name', 'pack');
        end if;
        v_mat_qty := round(v_count * app_private.jnum(v_variant -> 'packaging_qty'), 3);
        v_pack_inputs := v_pack_inputs || jsonb_build_array(jsonb_build_object(
          'item_id', v_mat.id, 'name', v_mat.name, 'quantity', v_mat_qty, 'unit', v_mat.unit, 'unit_cost', coalesce(v_mat.cost_price, 0)));
        v_pack_cost := v_pack_cost + v_mat_qty * coalesce(v_mat.cost_price, 0);
        v_need := v_need || jsonb_build_object(v_mat.id, round(coalesce(app_private.jnum(v_need -> v_mat.id), 0) + v_mat_qty, 3));
      end if;
    end loop;
  end if;
  v_total_out := round(v_loose + v_packed_base, 3);

  -- Recipe materials, in each material's own stock unit.
  if jsonb_typeof(v_product.recipe) = 'array' and coalesce(v_product.recipe_base_quantity, 0) > 0 then
    v_scale := v_input / v_product.recipe_base_quantity;
    for v_ing in select value from jsonb_array_elements(v_product.recipe) loop
      if nullif(v_ing ->> 'item_id', '') is null then continue; end if;
      v_mat_qty := coalesce(app_private.jnum(v_ing -> 'quantity'), 0) * v_scale;
      if v_mat_qty <= 0 then continue; end if;
      select * into v_mat from items where id = v_ing ->> 'item_id';
      if not found then
        raise exception 'Recipe ka material "%" catalog mein nahi mila. % ki recipe theek karein.', coalesce(v_ing ->> 'item_name', v_ing ->> 'item_id'), v_product.name;
      end if;
      v_mat_unit := coalesce(nullif(btrim(v_mat.unit), ''), nullif(btrim(v_ing ->> 'unit'), ''));
      if nullif(btrim(v_ing ->> 'unit'), '') is not null and v_mat_unit is not null then
        v_conv := app_private.convert_qty(v_mat_qty, v_ing ->> 'unit', v_mat_unit);
        if v_conv is null then
          raise exception '%: recipe mein "%" likha hai lekin stock "%" mein hai; ye badla nahi ja sakta. % ki recipe theek karein.',
            v_mat.name, v_ing ->> 'unit', v_mat_unit, v_product.name;
        end if;
        v_mat_qty := v_conv;
      end if;
      v_mat_qty := round(v_mat_qty, 3);
      if v_mat_qty <= 0 then continue; end if;
      v_recipe_inputs := v_recipe_inputs || jsonb_build_array(jsonb_build_object(
        'item_id', v_mat.id, 'name', v_mat.name, 'quantity', v_mat_qty, 'unit', v_mat_unit, 'unit_cost', coalesce(v_mat.cost_price, 0)));
      v_ing_cost := v_ing_cost + v_mat_qty * coalesce(v_mat.cost_price, 0);
      v_need := v_need || jsonb_build_object(v_mat.id, round(coalesce(app_private.jnum(v_need -> v_mat.id), 0) + v_mat_qty, 3));
    end loop;
  end if;

  -- Take each material: loose first, then whole packs (smallest first), opened remainder back to loose.
  for v_key, v_val in select key, value from jsonb_each(v_need) order by key loop
    select * into v_mat from items where id = v_key for update;
    v_remaining := round(app_private.jnum(v_val), 3);
    v_take := least(v_remaining, greatest(0, coalesce(v_mat.stock, 0)));
    v_loose_delta := -v_take;
    v_remaining := round(v_remaining - v_take, 3);
    v_mat_packs := '{}'::jsonb;
    v_opened := '{}';
    if v_remaining > 0 then
      for v_p in
        select v.value ->> 'id' as id, coalesce(v.value ->> 'name', 'pack') as name, app_private.pack_size(v.value) as size,
               floor(coalesce(app_private.jnum(v_mat.variant_stocks -> (v.value ->> 'id')), 0)) as cnt
        from jsonb_array_elements(case when jsonb_typeof(v_mat.variants) = 'array' then v_mat.variants else '[]'::jsonb end) v
        where app_private.is_pack(v.value)
          and coalesce(app_private.jnum(v_mat.variant_stocks -> (v.value ->> 'id')), 0) >= 1
        order by app_private.pack_size(v.value), v.value ->> 'id'
      loop
        exit when v_remaining <= 0;
        v_n := least(v_p.cnt, ceil(v_remaining / v_p.size));
        if v_n <= 0 then continue; end if;
        v_mat_packs := v_mat_packs || jsonb_build_object(v_p.id, -v_n);
        v_opened := v_opened || (v_n || ' x ' || v_p.name);
        v_remaining := round(v_remaining - v_n * v_p.size, 3);
      end loop;
    end if;
    -- v_remaining < 0: opened packs held more than needed, the rest goes to loose.
    -- v_remaining > 0: not enough stock; loose goes below zero by the shortfall.
    v_loose_delta := round(v_loose_delta - v_remaining, 3);
    if v_remaining > 0 then
      v_short := v_short || jsonb_build_array(jsonb_build_object('item_id', v_mat.id, 'name', v_mat.name, 'short', v_remaining, 'unit', v_mat.unit));
    end if;
    perform app_private.move_item_stock(
      v_mat.id, v_loose_delta, v_mat_packs,
      'log_prod_mat_' || v_batch.id || '_' || v_mat.id,
      v_now,
      'Production Usage',
      'Consumed in Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' (' || coalesce(v_batch.product_name, '') || ')'
        || case when cardinality(v_opened) > 0 then ' [opened ' || array_to_string(v_opened, ', ') || ']' else '' end,
      jsonb_build_object('batch_id', v_batch.id, 'used', app_private.jnum(v_val))
    );
    v_items := v_items || jsonb_build_object(v_mat.id, app_private.item_state(v_mat.id));
  end loop;

  -- Costs, and the product's moving average over what it held before this output.
  v_milk_rate := coalesce(nullif(v_batch.input_cost_per_unit, 0), app_private.jnum(v_det -> 'input_cost_per_unit'), 0);
  v_milk_cost := round(v_input * v_milk_rate, 2);
  v_ing_cost := round(v_ing_cost, 2);
  v_pack_cost := round(v_pack_cost, 2);
  v_total_cost := round(v_milk_cost + v_ing_cost + v_pack_cost, 2);

  select * into v_product from items where id = v_product.id;
  v_on_hand := app_private.on_hand_base(v_product.stock, v_product.variant_stocks, v_product.variants);
  v_new_cost := case when v_total_out > 0 and v_total_cost > 0
    then app_private.average_cost_after_intake(v_on_hand, v_product.cost_price, v_total_out, v_total_cost)
    else coalesce(v_product.cost_price, 0) end;

  perform app_private.move_item_stock(
    v_product.id, v_loose, v_pack_deltas,
    'log_prod_' || v_batch.id,
    v_now,
    'Production',
    'Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' (' || coalesce(v_batch.product_name, '') || ') Completed: '
      || case when v_loose > 0 then v_loose || v_unit || ' loose' else '' end
      || case when cardinality(v_pack_summary) > 0 then ' [Packaged: ' || array_to_string(v_pack_summary, ', ') || ']' else '' end
      || ' (Total: ' || v_total_out || v_unit || ')',
    jsonb_build_object('batch_id', v_batch.id)
  );
  if v_new_cost > 0 and v_new_cost is distinct from v_product.cost_price then
    update items set cost_price = v_new_cost where id = v_product.id;
  end if;
  v_items := v_items || jsonb_build_object(v_product.id, app_private.item_state(v_product.id));

  update production_batches
  set status = 'Completed',
      completed_date = v_now,
      quantity_output_actual = v_total_out,
      logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('stage', 'Completed', 'message', v_message, 'timestamp', v_now)),
      details = v_det || jsonb_build_object(
        'product_item_id', v_product.id,
        'output_breakdown', jsonb_build_object('loose_qty', v_loose, 'variants', v_out_variants),
        'cost_snapshot', jsonb_build_object(
          'saved_at', v_now,
          'milk_cost', v_milk_cost,
          'ingredients', v_recipe_inputs,
          'packaging', v_pack_inputs,
          'recipe_inputs', v_recipe_inputs,
          'packaging_inputs', v_pack_inputs,
          'ingredients_cost', v_ing_cost,
          'packaging_cost', v_pack_cost,
          'total_cost', v_total_cost,
          'materials_posted', true,
          'external_conversion_cost', 0
        )
      )
  where id = v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'applied', true,
    'batch', to_jsonb(v_batch),
    'product_id', v_product.id,
    'total_output', v_total_out,
    'unit', v_unit,
    'total_cost', v_total_cost,
    'short_materials', v_short,
    'items', v_items
  );
end;
$$;

create or replace function public.cancel_production_batch(p_batch_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch production_batches;
  v_det jsonb;
  v_now timestamptz := now();
  v_message text := coalesce(nullif(p_payload ->> 'message', ''), 'Batch Cancelled');
  v_input numeric;
  v_part record;
  v_item items;
  v_stock_qty numeric;
  v_retail_back numeric := 0;
  v_missing numeric := 0;
  v_pool numeric := 0;
  v_raw text;
  v_milk_type text := 'Mixed';
  v_has_cow boolean;
  v_has_buffalo boolean;
  v_text text;
  v_alloc allocations;
  v_items jsonb := '{}'::jsonb;
begin
  perform app_private.assert_can('production', 'edit', 'production batch cancel karne');
  select * into v_batch from production_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch nahi mila. Page reload karein.'; end if;
  if v_batch.status = 'Cancelled' then
    return jsonb_build_object('already_applied', true, 'batch', to_jsonb(v_batch));
  end if;
  if v_batch.status = 'Completed' then
    raise exception 'Completed batch cancel nahi ho sakta. Stock adjustment se correction karein.';
  end if;

  v_det := case when jsonb_typeof(v_batch.details) = 'object' then v_batch.details else '{}'::jsonb end;
  v_input := round(coalesce(v_batch.quantity_input, 0), 3);

  if v_input > 0 then
    -- Counter milk back to the counter item it came from, all lines of one item together.
    for v_part in
      select regexp_replace(coalesce(m.value ->> 'allocationId', ''), '^inv_', '') as item_id,
             round(sum(app_private.jnum(m.value -> 'quantity')), 3) as litres
      from jsonb_array_elements(case when jsonb_typeof(v_det -> 'milk_breakdown') = 'array' then v_det -> 'milk_breakdown' else '[]'::jsonb end) m
      where m.value ->> 'source' = 'retail' and coalesce(app_private.jnum(m.value -> 'quantity'), 0) > 0
      group by 1
      order by 1
    loop
      -- An older browser run already returned this item's milk.
      if exists (select 1 from inventory_logs where id = 'log_batch_cancel_' || v_batch.id || '_' || v_part.item_id) then
        v_retail_back := v_retail_back + v_part.litres;
        continue;
      end if;
      select * into v_item from items where id = v_part.item_id for update;
      if not found then
        -- The counter item is gone: its litres go back to the pool with the rest.
        v_missing := v_missing + v_part.litres;
        continue;
      end if;
      v_stock_qty := app_private.convert_qty(v_part.litres, 'L', coalesce(nullif(btrim(v_item.unit), ''), 'L'));
      if v_stock_qty is null then
        raise exception '%: litre ko "%" mein badla nahi ja sakta; batch cancel nahi hua.', v_item.name, v_item.unit;
      end if;
      perform app_private.move_item_stock(
        v_item.id, round(v_stock_qty, 3), '{}'::jsonb,
        'log_batch_cancel_' || v_batch.id || '_' || v_item.id,
        v_now,
        'Production Cancellation',
        'Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' cancelled: counter milk returned (' || v_part.litres || ' L)',
        jsonb_build_object('batch_id', v_batch.id, 'litres', v_part.litres)
      );
      v_items := v_items || jsonb_build_object(v_item.id, app_private.item_state(v_item.id));
      v_retail_back := v_retail_back + v_part.litres;
    end loop;

    v_pool := round(greatest(0, v_input - v_retail_back), 3);
    if v_pool > 0 and not exists (select 1 from allocations where id = 'alloc_ret_batch_' || v_batch.id) then
      -- The lot keeps the batch's milk type: its own type, else one type across the breakdown, else Mixed.
      v_raw := lower(coalesce(v_det ->> 'milk_type', ''));
      if v_raw <> '' then
        v_milk_type := case when v_raw like '%buffalo%' then 'Buffalo' when v_raw like '%cow%' then 'Cow' else 'Mixed' end;
      elsif jsonb_typeof(v_det -> 'milk_breakdown') = 'array' and jsonb_array_length(v_det -> 'milk_breakdown') > 0 then
        select bool_or(lower(coalesce(m.value ->> 'milkType', '')) like '%cow%'),
               bool_or(lower(coalesce(m.value ->> 'milkType', '')) like '%buffalo%')
        into v_has_cow, v_has_buffalo
        from jsonb_array_elements(v_det -> 'milk_breakdown') m;
        v_milk_type := case when v_has_cow and not v_has_buffalo then 'Cow' when v_has_buffalo and not v_has_cow then 'Buffalo' else 'Mixed' end;
      else
        select lower(coalesce(string_agg(l.value ->> 'message', ' '), '')) into v_text
        from jsonb_array_elements(case when jsonb_typeof(v_batch.logs) = 'array' then v_batch.logs else '[]'::jsonb end) l;
        v_milk_type := case
          when v_text like '%cow milk%' or lower(coalesce(v_batch.product_name, '')) like '%cow%' then 'Cow'
          when v_text like '%buffalo milk%' or lower(coalesce(v_batch.product_name, '')) like '%buffalo%' then 'Buffalo'
          else 'Mixed' end;
      end if;

      insert into allocations (
        id, purchase_id, date, supplier_name, milk_type, original_quantity, allocated_quantity, remaining_quantity,
        status, average_rate, details
      ) values (
        'alloc_ret_batch_' || v_batch.id, 'ret_batch_' || v_batch.id, v_now,
        'Return: Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' (' || coalesce(v_batch.product_name, '') || ')',
        v_milk_type, v_pool, 0, v_pool, 'Unallocated', coalesce(v_batch.input_cost_per_unit, 0),
        jsonb_strip_nulls(jsonb_build_object(
          'returned_from_batch_id', v_batch.id,
          'batch_number', v_batch.batch_number,
          'product_name', v_batch.product_name,
          'milk_type', v_milk_type,
          'cancel_reason', v_message,
          'counter_milk_without_item', case when v_missing > 0 then v_missing end
        ))
      )
      returning * into v_alloc;
    end if;
  end if;

  update production_batches
  set status = 'Cancelled',
      completed_date = v_now,
      logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('stage', 'Cancelled', 'message', v_message, 'timestamp', v_now))
  where id = v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'applied', true,
    'batch', to_jsonb(v_batch),
    'returned_litres', v_input,
    'counter_litres', round(v_retail_back, 3),
    'pool_litres', v_pool,
    'allocation', case when v_alloc.id is not null then to_jsonb(v_alloc) end,
    'items', v_items
  );
end;
$$;

revoke all on function public.complete_production_batch(text, jsonb) from public, anon;
revoke all on function public.cancel_production_batch(text, jsonb) from public, anon;
grant execute on function public.complete_production_batch(text, jsonb) to authenticated, service_role;
grant execute on function public.cancel_production_batch(text, jsonb) to authenticated, service_role;
