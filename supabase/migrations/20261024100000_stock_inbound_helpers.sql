-- Shared helpers for the inbound stock RPCs that follow (20261024101000 .. 20261024104000).
-- Requires 20261023110000_money_rpc_helpers.sql (app_private schema, assert_can, post_bank_tx).
--
-- Why: material purchases, their returns, counter milk allocation and production completion /
-- cancel ran as many separate browser writes (stock, average cost, log, khata, cash). A failure in
-- the middle left stock moved without a log or a payment, and the average cost was read in the
-- browser and written back later, so two purchases at once overwrote each other's cost. The flows
-- now run in one Postgres function each; these helpers are what they share (docs/stock-model.md):
--
--   * jnum / pack_size / on_hand_base / average_cost_after_intake: the client's sellUnits rules
--     (stockOnHandBase, averageCostAfterIntake) on the locked items row.
--   * unit_def / convert_qty: the client's convertQuantity (lib/unitConversion.ts): built-in units,
--     aliases and Settings > Units custom units. null when the units can't be converted.
--   * move_item_stock: the one way these RPCs move stock. Locks the item, applies the loose and
--     pack deltas through adjust_item_stock (3-decimal rounding) and writes one inventory_logs row
--     with details { loose_delta, variant_deltas } (difference / old / new hold the loose pile only).
--   * assert_stock_day_open: closed books or a locked business day refuse a stock entry.
--
-- Nothing here is callable by anon or authenticated.

create schema if not exists app_private;

-- A jsonb number (or numeric string) as numeric; anything else is null.
create or replace function app_private.jnum(p jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
    when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p #>> '{}')::numeric
    else null
  end
$$;

-- Base units inside one sell unit (sellUnitContains): quantity_in_base_unit, else 1.
create or replace function app_private.pack_size(p_variant jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when app_private.jnum(p_variant -> 'quantity_in_base_unit') > 0
              then app_private.jnum(p_variant -> 'quantity_in_base_unit') else 1 end
$$;

-- A ready-made pack holds its own count; a multi-unit (deduct_from_base = true) is a view of loose stock.
create or replace function app_private.is_pack(p_variant jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_variant is not null and coalesce(p_variant -> 'deduct_from_base', 'false'::jsonb) <> 'true'::jsonb
$$;

-- Base units physically on hand (stockOnHandBase): loose plus every ready-made pack pile at its size.
-- Negative piles count as zero, so a shortfall never dilutes the average cost.
create or replace function app_private.on_hand_base(p_stock numeric, p_variant_stocks jsonb, p_variants jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(greatest(0, coalesce(p_stock, 0)) + coalesce((
    select sum(greatest(0, coalesce(app_private.jnum(vs.value), 0)) * app_private.pack_size(v.value))
    from jsonb_each(case when jsonb_typeof(p_variant_stocks) = 'object' then p_variant_stocks else '{}'::jsonb end) vs
    join jsonb_array_elements(case when jsonb_typeof(p_variants) = 'array' then p_variants else '[]'::jsonb end) v
      on v.value ->> 'id' = vs.key
    where app_private.is_pack(v.value)
  ), 0), 3)
$$;

-- Moving average cost per base unit after stock comes in (averageCostAfterIntake), 4 decimals.
create or replace function app_private.average_cost_after_intake(p_on_hand numeric, p_cost numeric, p_in_base numeric, p_in_value numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when greatest(0, coalesce(p_in_base, 0)) <= 0 then coalesce(p_cost, 0)
    when greatest(0, coalesce(p_on_hand, 0)) > 0 and coalesce(p_cost, 0) > 0
      then round((greatest(0, p_on_hand) * p_cost + coalesce(p_in_value, 0)) / (greatest(0, p_on_hand) + p_in_base), 4)
    else round(coalesce(p_in_value, 0) / p_in_base, 4)
  end
$$;

-- One unit definition {type, factor} the way lib/unitConversion.ts finds it, or null.
create or replace function app_private.unit_def(p_symbol text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(p_symbol, ''));
  v_key text := lower(btrim(coalesce(p_symbol, '')));
  v_sym text;
  v_custom jsonb;
  v_def jsonb;
  v_sys jsonb := '[
    {"id":"u_sys_l","name":"Liter","symbol":"L","factor":1,"type":"Volume"},
    {"id":"u_sys_ml","name":"Milliliter","symbol":"ml","factor":0.001,"type":"Volume"},
    {"id":"u_sys_maund_vol","name":"Maund (Milk Vol)","symbol":"man-vol","factor":40,"type":"Volume"},
    {"id":"u_sys_500ml","name":"Half Liter (500ml)","symbol":"500ml","factor":0.5,"type":"Volume"},
    {"id":"u_sys_250ml","name":"Quarter Liter (250ml)","symbol":"250ml","factor":0.25,"type":"Volume"},
    {"id":"u_sys_kg","name":"Kilogram","symbol":"kg","factor":1,"type":"Mass"},
    {"id":"u_sys_g","name":"Gram","symbol":"g","factor":0.001,"type":"Mass"},
    {"id":"u_sys_pao","name":"Pao (250g)","symbol":"pao","factor":0.25,"type":"Mass"},
    {"id":"u_sys_500g","name":"Aadha Kilo (500g)","symbol":"500g","factor":0.5,"type":"Mass"},
    {"id":"u_sys_maund","name":"Maund / Mann (40kg)","symbol":"maund","factor":40,"type":"Mass"},
    {"id":"u_sys_tola","name":"Tola","symbol":"tola","factor":0.01166,"type":"Mass"},
    {"id":"u_sys_pcs","name":"Piece / Piece","symbol":"pcs","factor":1,"type":"Count"},
    {"id":"u_sys_unit","name":"Unit / Piece","symbol":"unit","factor":1,"type":"Count"},
    {"id":"u_sys_pack","name":"Pack / Packet","symbol":"pack","factor":1,"type":"Count"},
    {"id":"u_sys_dz","name":"Dozen","symbol":"dz","factor":12,"type":"Count"},
    {"id":"u_sys_hdz","name":"Half Dozen","symbol":"h-dz","factor":6,"type":"Count"},
    {"id":"u_sys_btl","name":"Bottle","symbol":"btl","factor":1,"type":"Count"},
    {"id":"u_sys_box","name":"Box / Dabba","symbol":"box","factor":1,"type":"Count"},
    {"id":"u_sys_ctn","name":"Carton (24 pcs)","symbol":"ctn","factor":24,"type":"Count"},
    {"id":"u_sys_crate","name":"Crate (12 pcs)","symbol":"crate","factor":12,"type":"Count"},
    {"id":"u_sys_cup","name":"Cup / Bowl","symbol":"cup","factor":1,"type":"Count"},
    {"id":"u_sys_bag","name":"Bag / Bori","symbol":"bag","factor":1,"type":"Count"},
    {"id":"u_sys_roll","name":"Roll","symbol":"roll","factor":1,"type":"Count"}
  ]'::jsonb;
begin
  if v_key = '' then return null; end if;
  v_sym := case
    when v_key in ('liter', 'liters', 'litre', 'litres', 'l') then 'l'
    when v_key in ('milliliter', 'milliliters', 'mls') then 'ml'
    when v_key in ('kilogram', 'kilograms', 'kilo', 'kilos') then 'kg'
    when v_key in ('gram', 'grams', 'gm', 'gms') then 'g'
    when v_key in ('paao', 'paw', 'paaon') then 'pao'
    when v_key in ('man', 'mun', 'mon') then 'maund'
    when v_key in ('piece', 'pieces', 'pc') then 'pcs'
    when v_key = 'units' then 'unit'
    when v_key in ('packet', 'packets', 'pkt', 'pkts') then 'pack'
    when v_key in ('dozen', 'dozens') then 'dz'
    when v_key in ('bottles', 'bottle') then 'btl'
    when v_key = 'boxes' then 'box'
    when v_key = 'cartons' then 'ctn'
    when v_key = 'crates' then 'crate'
    when v_key = 'cups' then 'cup'
    when v_key = 'bags' then 'bag'
    when v_key = 'rolls' then 'roll'
    else v_key
  end;

  select s.inventory -> 'customUnits' into v_custom
  from public.app_settings s
  order by (s.id = 'global_settings') desc
  limit 1;
  if jsonb_typeof(v_custom) is distinct from 'array' then v_custom := '[]'::jsonb; end if;

  -- By symbol: a custom unit overrides the built-in one with the same symbol.
  select coalesce(sys.value, '{}'::jsonb) || cu.value into v_def
  from jsonb_array_elements(v_custom) cu
  left join jsonb_array_elements(v_sys) sys on lower(sys.value ->> 'symbol') = lower(btrim(cu.value ->> 'symbol'))
  where lower(btrim(cu.value ->> 'symbol')) = v_sym
  limit 1;
  if v_def is null then
    select sys.value into v_def from jsonb_array_elements(v_sys) sys where lower(sys.value ->> 'symbol') = v_sym limit 1;
  end if;
  -- Then by id, then by name.
  if v_def is null then
    select u.value into v_def from jsonb_array_elements(v_sys || v_custom) u where u.value ->> 'id' = v_raw limit 1;
  end if;
  if v_def is null then
    select u.value into v_def from jsonb_array_elements(v_sys || v_custom) u where lower(u.value ->> 'name') = v_key limit 1;
  end if;
  if v_def is null then return null; end if;

  return jsonb_build_object(
    'type', v_def ->> 'type',
    'factor', coalesce(nullif(app_private.jnum(v_def -> 'factor'), 0), 1)
  );
end;
$$;

-- p_qty in p_from expressed in p_to (convertQuantity), or null when the units can't be converted.
create or replace function app_private.convert_qty(p_qty numeric, p_from text, p_to text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from jsonb;
  v_to jsonb;
begin
  if p_qty is null then return 0; end if;
  if lower(btrim(coalesce(p_from, ''))) = lower(btrim(coalesce(p_to, ''))) then return p_qty; end if;
  v_from := app_private.unit_def(p_from);
  v_to := app_private.unit_def(p_to);
  if v_from is null or v_to is null or (v_from ->> 'type') is distinct from (v_to ->> 'type') then
    return null;
  end if;
  return round(p_qty * (v_from ->> 'factor')::numeric / (v_to ->> 'factor')::numeric, 4);
end;
$$;

-- Closed books (security.lockDate) or a locked business day refuse a stock entry dated p_at.
create or replace function app_private.assert_stock_day_open(p_at timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := (coalesce(p_at, now()) at time zone 'Asia/Karachi')::date;
  v_lock text;
begin
  select s.security ->> 'lockDate' into v_lock
  from public.app_settings s
  order by (s.id = 'global_settings') desc
  limit 1;
  if v_lock ~ '^\d{4}-\d{2}-\d{2}$' and v_date <= v_lock::date then
    raise exception 'Books % tak band hain. Is tareekh (%) ki stock entry nahi ho sakti.',
      v_lock, to_char(v_date, 'DD-Mon-YYYY');
  end if;
  if exists (select 1 from public.business_days d where d.business_date = v_date and d.status = 'Closed') then
    raise exception 'Din % band (locked) hai. Band din mein stock ki entry nahi ho sakti; pehle din dobara kholein.',
      to_char(v_date, 'DD-Mon-YYYY');
  end if;
end;
$$;

-- The client's view of one item after a move.
create or replace function app_private.item_state(p_item_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'stock', i.stock, 'variant_stocks', coalesce(i.variant_stocks, '{}'::jsonb), 'cost_price', i.cost_price)
  from public.items i
  where i.id = p_item_id
$$;

-- Moves one item's piles and writes its stock log. Raises when the item does not exist (the old
-- browser code silently moved nothing). Zero pack deltas are dropped; all deltas are rounded to 3.
create or replace function app_private.move_item_stock(
  p_item_id text,
  p_loose_delta numeric,
  p_variant_deltas jsonb,
  p_log_id text,
  p_date timestamptz,
  p_reason text,
  p_notes text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_loose numeric := round(coalesce(p_loose_delta, 0), 3);
  v_packs jsonb;
  v_result jsonb;
begin
  if nullif(p_log_id, '') is null then raise exception 'Stock log ki id zaroori hai.'; end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception 'Item "%" catalog mein nahi mila; stock nahi hila.', p_item_id;
  end if;
  -- adjust_item_stock skips a row whose stock is null.
  if v_item.stock is null then
    update public.items set stock = 0 where id = p_item_id;
    v_item.stock := 0;
  end if;

  select coalesce(jsonb_object_agg(d.key, round(app_private.jnum(d.value), 3)), '{}'::jsonb)
  into v_packs
  from jsonb_each(case when jsonb_typeof(p_variant_deltas) = 'object' then p_variant_deltas else '{}'::jsonb end) d
  where coalesce(round(app_private.jnum(d.value), 3), 0) <> 0;

  v_result := public.adjust_item_stock(p_item_id, v_loose, v_packs);

  insert into public.inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
  values (
    p_log_id, coalesce(p_date, now()), p_item_id, v_item.name,
    round(v_item.stock, 3), (v_result ->> 'stock')::numeric, v_loose, p_reason, p_notes,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('loose_delta', v_loose, 'variant_deltas', v_packs)
  );

  return jsonb_build_object(
    'id', p_item_id,
    'old_stock', v_item.stock,
    'stock', (v_result ->> 'stock')::numeric,
    'variant_stocks', v_result -> 'variant_stocks',
    'loose_delta', v_loose,
    'variant_deltas', v_packs
  );
end;
$$;

revoke all on function app_private.jnum(jsonb) from public, anon, authenticated;
revoke all on function app_private.pack_size(jsonb) from public, anon, authenticated;
revoke all on function app_private.is_pack(jsonb) from public, anon, authenticated;
revoke all on function app_private.on_hand_base(numeric, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.average_cost_after_intake(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function app_private.unit_def(text) from public, anon, authenticated;
revoke all on function app_private.convert_qty(numeric, text, text) from public, anon, authenticated;
revoke all on function app_private.assert_stock_day_open(timestamptz) from public, anon, authenticated;
revoke all on function app_private.item_state(text) from public, anon, authenticated;
revoke all on function app_private.move_item_stock(text, numeric, jsonb, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
