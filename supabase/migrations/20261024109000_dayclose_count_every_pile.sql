-- dayclose_stock_count: every pile can be counted, stray counts can be cleared (2026-10-24).
-- Requires 20261023110000_money_rpc_helpers.sql and 20261024105000_sale_line_stock_helper.sql.
--
-- Before (20261021120000): any signed-in operator could call it; any variant key was written, so a
-- count on a dozen/tray (a view of loose stock, docs/stock-model.md) became a phantom pack count;
-- a negative or non-numeric count was applied or failed with a cast error; and the log kept only
-- the loose move ("3 variant adjustment(s)" in the notes), so reports and the stock history could
-- not see which packs moved.
--
-- Now:
--   * only a manager / owner (the client's canApproveCashControl, app_private.can_approve_cash)
--     may apply it; a service_role call stays trusted;
--   * every count must be a number of 0 or more, else nothing is applied;
--   * a ready-made pack is counted whether it is active or hidden (hidden packs still hold stock);
--   * a count stored on a multi-unit (dozen, tray) or on a pack the product no longer has belongs
--     to no pile: it can be counted to 0 (cleared), any other number is refused;
--   * 'loose' as variant_id means the loose pile;
--   * the log carries details.loose_delta and details.variant_deltas (the one log shape) and the day.
-- Same signature, same one-guard-row-per-day+item idempotency, same result.

create or replace function public.dayclose_stock_count(p_business_day_id text, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry jsonb;
  v_item_id text;
  v_log_id text;
  v_item public.items;
  v_counted numeric;
  v_pack_id text;
  v_variant jsonb;
  v_delta numeric;
  v_loose_delta numeric;
  v_variant_delta jsonb;
  v_adjusted int := 0;
  v_skipped int := 0;
  v_nochange int := 0;
begin
  if not app_private.can_approve_cash() then
    raise exception 'Day close stock count sirf manager / owner laga sakta hai.' using errcode = '42501';
  end if;
  if p_business_day_id is null or p_business_day_id = '' then
    raise exception 'business_day_id zaroori hai.';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    raise exception 'counts array hona chahiye.';
  end if;
  for v_entry in select value from jsonb_array_elements(p_counts) loop
    if jsonb_typeof(v_entry) <> 'object'
       or app_private.json_num(v_entry->'counted') is null
       or app_private.json_num(v_entry->'counted') < 0 then
      raise exception 'Stock count ghalat hai (%): 0 ya us se zyada number likhein.', coalesce(v_entry->>'item_id', '?');
    end if;
  end loop;

  for v_item_id in
    select distinct coalesce(entry ->> 'item_id', '')
    from jsonb_array_elements(p_counts) entry
  loop
    if v_item_id = '' then continue; end if;
    v_log_id := 'log_dayclose_' || p_business_day_id || '_' || v_item_id;

    if exists (select 1 from inventory_logs where id = v_log_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Locked: a sale posting between this read and the adjustment would otherwise be overwritten.
    select * into v_item from items where id = v_item_id for update;
    if not found or v_item.stock is null then continue; end if;

    -- Loose stock: the entry without a variant (or with 'loose').
    select min(app_private.json_num(entry -> 'counted'))
    into v_counted
    from jsonb_array_elements(p_counts) entry
    where coalesce(entry ->> 'item_id', '') = v_item_id
      and coalesce(nullif(entry ->> 'variant_id', ''), 'loose') = 'loose';

    v_loose_delta := case when v_counted is null then 0 else round(v_counted - v_item.stock, 3) end;

    -- Packs: each counted pile moves by its difference.
    v_variant_delta := '{}'::jsonb;
    for v_pack_id, v_counted in
      select entry ->> 'variant_id', min(app_private.json_num(entry -> 'counted'))
      from jsonb_array_elements(p_counts) entry
      where coalesce(entry ->> 'item_id', '') = v_item_id
        and coalesce(nullif(entry ->> 'variant_id', ''), 'loose') <> 'loose'
      group by 1
    loop
      v_variant := null;
      select v into v_variant
      from jsonb_array_elements(case when jsonb_typeof(v_item.variants) = 'array' then v_item.variants else '[]'::jsonb end) v
      where v ->> 'id' = v_pack_id
      limit 1;
      if (v_variant is null or coalesce(v_variant ->> 'deduct_from_base', '') = 'true') and v_counted <> 0 then
        raise exception '% (%) ka apna count nahi hota: purana count sirf 0 kiya ja sakta hai. Stock loose % mein ginein.',
          coalesce(v_variant ->> 'name', 'Purana pack'), v_item.name, coalesce(v_item.unit, '');
      end if;
      v_delta := round(v_counted - coalesce(app_private.json_num(coalesce(v_item.variant_stocks, '{}'::jsonb) -> v_pack_id), 0), 3);
      if v_delta <> 0 then
        v_variant_delta := v_variant_delta || jsonb_build_object(v_pack_id, v_delta);
      end if;
    end loop;

    if v_loose_delta = 0 and v_variant_delta = '{}'::jsonb then
      -- No difference: still write the guard row so the day's count is marked applied.
      insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
      values (v_log_id, now(), v_item_id, v_item.name, v_item.stock, v_item.stock, 0,
              'Stock Count Correction', 'Day Close Stock Count (' || p_business_day_id || ') — no difference',
              jsonb_build_object('loose_delta', 0, 'variant_deltas', '{}'::jsonb, 'business_day_id', p_business_day_id));
      v_nochange := v_nochange + 1;
      continue;
    end if;

    perform public.adjust_item_stock(
      v_item_id,
      v_loose_delta,
      case when v_variant_delta = '{}'::jsonb then null else v_variant_delta end
    );

    insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
    values (v_log_id, now(), v_item_id, v_item.name, v_item.stock, round(v_item.stock + v_loose_delta, 3), v_loose_delta,
            'Stock Count Correction',
            'Day Close Stock Count (' || p_business_day_id || ')'
            || case when v_variant_delta <> '{}'::jsonb
                    then ' · ' || (select count(*) from jsonb_object_keys(v_variant_delta))::text || ' pack count(s)'
                    else '' end,
            jsonb_build_object('loose_delta', v_loose_delta, 'variant_deltas', v_variant_delta, 'business_day_id', p_business_day_id));
    v_adjusted := v_adjusted + 1;
  end loop;

  return jsonb_build_object('adjusted', v_adjusted, 'skipped', v_skipped, 'no_change', v_nochange);
end;
$function$;
