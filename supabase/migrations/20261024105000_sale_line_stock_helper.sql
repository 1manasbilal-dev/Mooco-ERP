-- One server rule for "which pile does a bill line move" (docs/stock-model.md, 2026-10-24).
-- Requires 20261023110000_money_rpc_helpers.sql (app_private schema).
--
-- Until now each stock RPC trusted the browser to say which pile a line took and how much:
-- pos_sync_order_effects moved whatever qty / variant_id the payload carried, process_sales_return
-- moved whatever stock_moves it was sent. A stale or buggy client could move the wrong pile
-- (a dozen line as a pack count, ml read as L) or the wrong amount, and the bill said otherwise.
--
-- app_private.sale_line_stock reads ONE saved bill line the way the client's saleLineStock does
-- (src/lib/sellUnits.ts), plus a catalog check:
--   * no variant (or 'loose' / 'base' / isLoose) -> loose pile, qty in the base unit;
--   * a variant line whose snapshot says deductFromBase = true -> loose pile, qty x stockDeduction
--     (the dozen / tray / scoop size saved on the bill; the catalog size only when the bill has none);
--   * deductFromBase = false -> the pack's own count, qty packs;
--   * no flag (bills saved before the snapshot) -> the catalog variant decides;
--   * catalog check: a pack pile is moved only while the product still has that ready-made pack.
--     A pack that was deleted or turned into a multi-unit has no pile any more, so its base
--     quantity (qty x size) moves the loose pile instead of leaving a count no pile owns.
-- Quantities below zero count as zero; results are rounded to 3 decimals.
--
-- app_private.json_num reads a JSON number (or a numeric string) without raising on junk.

create or replace function app_private.json_num(p_value jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric
    when jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_value #>> '{}')::numeric
    else null
  end
$$;

create or replace function app_private.sale_line_stock(p_line jsonb, p_variants jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_qty numeric := greatest(coalesce(app_private.json_num(p_line->'qty'), 0), 0);
  v_raw text := coalesce(nullif(p_line->>'variantId', ''), nullif(p_line->>'variant_id', ''));
  v_flag_json jsonb := coalesce(nullif(p_line->'deductFromBase', 'null'::jsonb), p_line->'deduct_from_base');
  v_flag boolean;
  v_variant_id text;
  v_variant jsonb;
  v_contains numeric := 1;
  v_from_base boolean;
  v_fallback boolean := false;
  v_base numeric;
begin
  if v_raw is not null and v_raw not in ('loose', 'base') and coalesce(p_line->>'isLoose', '') <> 'true' then
    v_variant_id := v_raw;
    select v into v_variant
    from jsonb_array_elements(case when jsonb_typeof(p_variants) = 'array' then p_variants else '[]'::jsonb end) v
    where v->>'id' = v_variant_id
    limit 1;
    v_contains := case
      when coalesce(app_private.json_num(p_line->'stockDeduction'), 0) > 0 then app_private.json_num(p_line->'stockDeduction')
      when coalesce(app_private.json_num(v_variant->'quantity_in_base_unit'), 0) > 0 then app_private.json_num(v_variant->'quantity_in_base_unit')
      else 1
    end;
  end if;

  v_flag := case
    when v_flag_json in ('true'::jsonb, '"true"'::jsonb) then true
    when v_flag_json in ('false'::jsonb, '"false"'::jsonb) then false
    else null
  end;
  v_from_base := v_variant_id is null
    or v_flag is true
    or (v_flag is null and coalesce(v_variant->>'deduct_from_base', '') = 'true');

  if not v_from_base and (v_variant is null or coalesce(v_variant->>'deduct_from_base', '') = 'true') then
    v_from_base := true;
    v_fallback := true;
  end if;

  v_base := round(v_qty * v_contains, 3);
  return jsonb_build_object(
    'from_base', v_from_base,
    'variant_id', case when v_from_base then null else v_variant_id end,
    'contains', v_contains,
    'stock_qty', case when v_from_base then v_base else round(v_qty, 3) end,
    'base_qty', v_base,
    'fallback', v_fallback
  );
end;
$$;

revoke all on function app_private.json_num(jsonb) from public, anon, authenticated;
revoke all on function app_private.sale_line_stock(jsonb, jsonb) from public, anon, authenticated;
