// Checks the inbound stock RPCs (20261024100000 .. 20261024104000) on a copy of the live schema in
// PGlite (Postgres 17 in WASM). Nothing here talks to Supabase. Same setup as run.mjs:
//   mkdir %TEMP%\pgl && cd %TEMP%\pgl && npm init -y && npm i @electric-sql/pglite@0.4.6
//   node supabase/tests/pglite/stock-inbound.mjs <pglite dir> supabase/migrations supabase/tests/pglite
// Each function: happy path, the same request twice (nothing moves twice), a failure at the last
// write leaves nothing behind, a user without the right is refused, packs vs loose, an ml item.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [pgliteDir, migDir, testDir] = process.argv.slice(2);
const { PGlite } = await import(pathToFileURL(join(pgliteDir, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
const { pgcrypto } = await import(pathToFileURL(join(pgliteDir, 'node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js')).href);
const db = new PGlite({ extensions: { pgcrypto } });
const file = (dir, name) => readFileSync(join(dir, name), 'utf8');
let failures = 0;
let passes = 0;
const ok = (cond, label, extra) => {
  if (cond) { passes++; console.log('  ok   ' + label); }
  else { failures++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const near = (a, b, eps = 0.0006) => Math.abs(Number(a) - Number(b)) < eps;
const run = async (dir, name) => {
  try { await db.exec(file(dir, name)); console.log('applied ' + name); }
  catch (e) { console.log('ERROR applying ' + name + ': ' + e.message); process.exit(1); }
};

// Live functions the new ones build on, replayed in the order they went live (as in run.mjs).
await run(testDir, 'base_schema.sql');
await db.exec('set search_path = public, extensions');
for (const m of [
  '20261019120000_unit_pack_stock_fixes.sql',
  '20261019151000_change_sale_payment_mode.sql',
  '20261019152000_customer_order_advance_posting.sql',
  '20261019153000_atomic_sales_return.sql',
  '20261019170000_operator_auth_prep.sql',
  '20261020130000_settings_security_and_approvals.sql',
  '20261021120000_audit_fixes.sql',
  '20261023100000_pin_lockout_hardening.sql',
  '20261023101000_tighten_table_and_function_grants.sql',
  '20261023106000_user_admin_self_escalation_guards.sql',
  '20261023110000_money_rpc_helpers.sql',
  '20261023112000_return_milk_purchase.sql',
]) await run(migDir, m);
for (const m of [
  '20261024100000_stock_inbound_helpers.sql',
  '20261024101000_material_purchase_rpcs.sql',
  '20261024102000_milk_allocation_rpcs.sql',
  '20261024103000_production_batch_rpcs.sql',
  '20261024104000_return_milk_purchase_no_raw_log.sql',
]) await run(migDir, m);

// Seed --------------------------------------------------------------------------------------------
await db.exec(`
  insert into app_roles (id, name, permissions) values
    ('role_super_admin', 'Super Admin', '[]'),
    ('role_cashier', 'Cashier', '["pos"]'),
    ('role_procurement', 'Procurement', '["purchase","allocation","suppliers"]');
  insert into app_users (id, name, username, role_id, auth_user_id) values
    ('user_a', 'Owner', 'owner', 'role_super_admin', '11111111-1111-1111-1111-111111111111'),
    ('user_b', 'Cashier', 'cashier', 'role_cashier', '22222222-2222-2222-2222-222222222222'),
    ('user_p', 'Buyer', 'buyer', 'role_procurement', '44444444-4444-4444-4444-444444444444');
  insert into app_settings (id, financial, inventory, security) values ('global_settings', '{}',
    '{"customUnits":[{"id":"u_seer","name":"Seer","symbol":"seer","factor":0.933,"type":"Mass"}]}', '{}');
  insert into financial_accounts (id, name, type, balance) values ('acc_cash', 'Main Cash', 'Cash', 10000), ('acc_bank', 'Bank', 'Bank', 5000);
  insert into suppliers (id, name, balance) values ('sup_1', 'Ahmed Traders', 0);
  insert into items (id, name, unit, stock, cost_price, variants, variant_stocks, recipe, recipe_base_quantity, type) values
    ('item_sugar', 'Sugar', 'kg', 10, 100, '[{"id":"v_bag","name":"Bag 5kg","quantity_in_base_unit":5,"isActive":true}]', '{"v_bag":2}', '[]', null, '{Raw material}'),
    ('item_cup', 'Dahi Cup', 'pcs', 100, 5,
      '[{"id":"v_dz","name":"Dozen","quantity_in_base_unit":12,"deduct_from_base":true,"isActive":true},{"id":"v_ctn","name":"Carton","quantity_in_base_unit":50,"isActive":true}]',
      '{}', '[]', null, '{Packaging material}'),
    ('item_culture', 'Culture', 'kg', 0.05, 2000, '[{"id":"v_sachet","name":"Sachet 10g","quantity_in_base_unit":0.01,"isActive":true}]', '{"v_sachet":5}', '[]', null, '{Raw material}'),
    ('item_cow_milk', 'Cow Milk', 'L', 10, 150, '[]', '{}', '[]', null, '{Sale product}'),
    ('item_ml_milk', 'Mixed Milk', 'ml', 1000, 0.2, '[]', '{}', '[]', null, '{Sale product}'),
    ('item_paneer', 'Paneer', 'kg', 5, 900, '[]', '{}', '[]', null, '{Sale product}'),
    ('item_box', 'Box', 'pcs', 50, 10, '[]', '{}', '[]', null, '{Packaging material}'),
    ('item_dahi', 'Dahi', 'kg', 0, 0,
      '[{"id":"v_500","name":"500 g tub","quantity_in_base_unit":0.5,"packaging_item_id":"item_cup","packaging_qty":1,"isActive":true},
        {"id":"v_1kg","name":"1 kg tub","quantity_in_base_unit":1,"isActive":true},
        {"id":"v_pao","name":"Pao","quantity_in_base_unit":0.25,"deduct_from_base":true,"isActive":true}]',
      '{}',
      '[{"item_id":"item_sugar","item_name":"Sugar","quantity":500,"unit":"g"},{"item_id":"item_culture","item_name":"Culture","quantity":10,"unit":"g"}]',
      10, '{Sale product}'),
    ('item_khoa', 'Khoa', 'kg', 0, 0, '[]', '{}', '[{"item_id":"item_box","item_name":"Box","quantity":1,"unit":"kg"}]', 10, '{Sale product}');
  insert into allocations (id, purchase_id, date, supplier_name, milk_type, original_quantity, remaining_quantity, allocated_quantity, status, average_rate, details) values
    ('alloc_1', 'pur_1', now(), 'Gawala 1', 'Cow', 100, 100, 0, 'Unallocated', 150, '{}'),
    ('alloc_2', 'pur_2', now(), 'Gawala 2', 'Mixed', 50, 50, 0, 'Unallocated', 200, null);
`);

const asOwner = `select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false)`;
const asCashier = `select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)`;
const asBuyer = `select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false)`;
const item = async id => one(`select stock::float8 stock, cost_price::float8 cost, variant_stocks vs from items where id = $1`, [id]);
const bal = async id => Number((await one(`select balance from financial_accounts where id = $1`, [id])).balance);
const supBal = async id => Number((await one(`select balance from suppliers where id = $1`, [id])).balance);
const count = async (sql, params) => (await one(`select count(*)::int c from (${sql}) x`, params)).c;
const log = async id => one(`select difference::float8 difference, old_quantity::float8 old_q, new_quantity::float8 new_q, reason, details from inventory_logs where id = $1`, [id]);
// Makes one write of a flow fail, to prove the earlier writes roll back with it.
const failOn = async (table, when = 'true') => db.exec(`
  create or replace function public.zz_fail() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
  create trigger zz_fail before insert or update on public.${table} for each row when (${when}) execute function public.zz_fail();`);
const unfail = async table => db.exec(`drop trigger if exists zz_fail on public.${table}`);
let r;
let e;

// Grants and helpers ---------------------------------------------------------------------------------
console.log('\n[grants / helpers]');
for (const sig of [
  'public.record_material_purchase(text, jsonb)', 'public.return_material_purchase(text, text, jsonb)',
  'public.allocate_milk_pool(text, jsonb)', 'public.take_counter_milk(text, jsonb)',
  'public.complete_production_batch(text, jsonb)', 'public.cancel_production_batch(text, jsonb)',
  'public.return_milk_purchase(text, text, jsonb)',
]) {
  const g = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u`, [sig]);
  ok(g.a === false && g.u === true, `${sig.split('(')[0]}: authenticated only`, g);
}
for (const sig of ['app_private.move_item_stock(text, numeric, jsonb, text, timestamptz, text, text, jsonb)', 'app_private.convert_qty(numeric, text, text)']) {
  ok((await one(`select has_function_privilege('authenticated', $1, 'execute') x`, [sig])).x === false, `${sig.split('(')[0]} not executable by authenticated`);
}
const conv = async (qty, from, to) => (await one(`select app_private.convert_qty($1, $2, $3)::float8 v`, [qty, from, to])).v;
ok(await conv(2, 'L', 'ml') === 2000, 'convert: 2 L = 2000 ml');
ok(await conv(500, 'g', 'kg') === 0.5, 'convert: 500 g = 0.5 kg');
ok(await conv(3, 'litres', 'ML') === 3000, 'convert: aliases and case (litres -> ML)');
ok(await conv(2, 'dozen', 'pcs') === 24, 'convert: dozen alias = 12 pcs');
ok(near(await conv(1, 'seer', 'kg'), 0.933), 'convert: Settings custom unit');
ok(await conv(1, 'kg', 'pcs') === null, 'convert: kg -> pcs cannot convert (null)');
ok(await conv(1, 'tub', 'kg') === null, 'convert: unknown unit is null');
ok(Number((await one(`select app_private.on_hand_base(-3, '{"v_bag":2,"v_dz":5,"v_gone":4,"v_neg":-1}', '[{"id":"v_bag","quantity_in_base_unit":5},{"id":"v_dz","quantity_in_base_unit":12,"deduct_from_base":true},{"id":"v_neg","quantity_in_base_unit":2}]') v`)).v) === 10,
  'on hand: negative loose = 0, packs at size, multi-units / deleted packs / negative packs add nothing');
ok(Number((await one(`select app_private.average_cost_after_intake(20, 100, 10, 1200) v`)).v) === 106.6667, 'average cost: (20 x 100 + 1200) / 30');
ok(Number((await one(`select app_private.average_cost_after_intake(0, 100, 10, 1200) v`)).v) === 120, 'average cost: nothing on hand takes the incoming rate');
e = await err(`select app_private.move_item_stock('item_gone', 1, null, 'log_x', now(), 'Test', null)`);
ok(e && e.includes('item_gone'), 'move on an unknown item raises (the old code moved nothing silently)', e);

// record_material_purchase -------------------------------------------------------------------------
console.log('\n[record_material_purchase]');
const purchase = (o = {}) => JSON.stringify({
  supplier_id: 'sup_1', date: new Date().toISOString(), purchase_type: 'Raw Material',
  paid_amount: 1000, payment_mode: 'Cash', account_id: 'acc_cash', business_day_id: 'bd_1',
  shift_session_id: 'shift_1', drawer_id: 'drawer_1', cashier_id: 'user_a', drawer_account_ids: ['acc_cash'],
  lines: [
    { item_id: 'item_sugar', item_name: 'Sugar', quantity: 10, unit: 'kg', rate: 120, conversion_factor: 1 },
    // The browser says 1 per carton; the catalog says 50. The catalog wins.
    { item_id: 'item_cup', item_name: 'Dahi Cup', quantity: 2, unit: 'Carton', rate: 250, conversion_factor: 1 },
    { item_id: 'item_cup', item_name: 'Dahi Cup', quantity: 3, unit: 'dozen', rate: 60, conversion_factor: 12 },
  ],
  ...o,
});
await db.exec(asCashier);
e = await err(`select record_material_purchase('mp1', $1::jsonb)`, [purchase()]);
ok(e && e.includes('ijazat'), 'cashier without purchase:create refused', e);
await db.exec(asOwner);
r = (await one(`select record_material_purchase('mp1', $1::jsonb) as r`, [purchase()])).r;
let sugar = await item('item_sugar');
let cup = await item('item_cup');
ok(r.applied && r.purchase_ids.length === 3 && r.total === 1880 && r.paid === 1000 && r.unpaid === 880, 'bill saved: 3 lines, total 1880, paid 1000', r);
ok(sugar.stock === 20 && sugar.vs.v_bag === 2, 'kg line -> sugar loose +10, bags untouched', sugar);
ok(sugar.cost === 106.6667, 'sugar average cost over everything on hand (10 loose + 2 bags x 5 = 20 kg @ 100, +10 @ 120)', sugar);
ok(cup.vs.v_ctn === 2 && cup.stock === 136, 'carton (ready-made pack) -> pack pile +2; dozen (multi-unit) -> loose +36', cup);
ok(cup.cost === 5, 'cup cost stays 5 (bought at 5 per piece)', cup);
let rows = await q(`select id, quantity::float8 quantity, total_amount::float8 total, details from material_purchases order by id`);
ok(rows.length === 3 && rows[1].details.conversion_factor === 50 && rows[1].details.stocked_as === 'packs' && rows[1].details.variant_id === 'v_ctn'
  && rows[1].details.base_quantity === 100, 'carton line: conversion 50 from the catalog, stocked as packs', rows[1]);
ok(rows[2].details.conversion_factor === 12 && rows[2].details.stocked_as === 'loose' && rows[2].details.base_quantity === 36, 'dozen line: loose x 12', rows[2]);
ok(rows.reduce((s, x) => s + x.details.paid_amount, 0) === 1000 && rows.every(x => near(x.details.paid_amount + x.details.due_amount, x.total, 0.011)), 'paid split over lines adds up to the payment');
let l = await log('log_purch_mp1_2');
ok(l && l.difference === 0 && l.details.loose_delta === 0 && l.details.variant_deltas.v_ctn === 2 && l.details.purchase_id === 'mp_mp1_2', 'pack log: loose_delta 0, variant_deltas { v_ctn: 2 }', l);
l = await log('log_purch_mp1_1');
ok(l && l.difference === 10 && l.old_q === 10 && l.new_q === 20 && l.details.loose_delta === 10 && Object.keys(l.details.variant_deltas).length === 0, 'loose log: difference = loose delta, variant_deltas {}', l);
ok(await bal('acc_cash') === 9000 && await supBal('sup_1') === 880, 'cash -1000, supplier khata +880');
const btx = await one(`select amount::float8 amount, type, shift_session_id, drawer_id, reference_id from bank_transactions where id = 'btx_mp_mp1'`);
ok(btx && btx.amount === 1000 && btx.type === 'Expense' && btx.shift_session_id === 'shift_1' && btx.reference_id.split(',').length === 3, 'one bank row for the bill, tagged to the open drawer', btx);
const stx = await one(`select amount::float8 amount, details from supplier_transactions where id = 'stx_mp_mp1'`);
ok(stx && stx.amount === 1000 && stx.details.purchase_ids.length === 3, 'supplier ledger payment row lists every line', stx);
r = (await one(`select record_material_purchase('mp1', $1::jsonb) as r`, [purchase()])).r;
ok(r.already_applied && r.rows.length === 3 && (await item('item_sugar')).stock === 20 && await bal('acc_cash') === 9000 && await supBal('sup_1') === 880,
  'same request twice: nothing posted again');

await failOn('supplier_transactions');
e = await err(`select record_material_purchase('mp2', $1::jsonb)`, [purchase()]);
await unfail('supplier_transactions');
ok(e && e.includes('injected') && (await item('item_sugar')).stock === 20 && (await item('item_sugar')).cost === 106.6667 && await bal('acc_cash') === 9000
  && await supBal('sup_1') === 880 && await count(`select 1 from material_purchases where id like 'mp_mp2%'`) === 0 && await count(`select 1 from inventory_logs where id like 'log_purch_mp2%'`) === 0,
  'failure at the last write: no line, stock, cost, cash or khata moved', e);

e = await err(`select record_material_purchase('mp3', $1::jsonb)`, [purchase({ paid_amount: 5000 })]);
ok(e && e.includes('se zyada'), 'paid above the bill refused', e);
e = await err(`select record_material_purchase('mp4', $1::jsonb)`, [purchase({ supplier_id: null, paid_amount: 100 })]);
ok(e && e.includes('supplier chunein'), 'spot purchase with an unpaid part refused', e);
e = await err(`select record_material_purchase('mp5', $1::jsonb)`, [purchase({ lines: [{ item_id: 'item_sugar', quantity: 2, unit: 'pcs', rate: 10 }], paid_amount: 0 })]);
ok(e && e.includes('badla nahi'), 'a unit that cannot convert to the stock unit is refused', e);
e = await err(`select record_material_purchase('mp6', $1::jsonb)`, [purchase({ lines: [{ item_id: 'item_gone', item_name: 'Ghost', quantity: 2, unit: 'kg', rate: 10 }], paid_amount: 0 })]);
ok(e && e.includes('Ghost'), 'unknown item refused', e);
r = (await one(`select record_material_purchase('mp7', $1::jsonb) as r`, [purchase({ supplier_id: null, paid_amount: undefined, account_id: 'acc_bank', drawer_account_ids: ['acc_cash'],
  lines: [{ item_id: 'item_sugar', quantity: 500, unit: 'g', rate: 0.12 }] })])).r;
sugar = await item('item_sugar');
ok(r.applied && sugar.stock === 20.5 && await bal('acc_bank') === 4940, 'spot purchase in grams: loose +0.5 kg, paid in full from the bank', { r, sugar });
ok((await one(`select shift_session_id from bank_transactions where id = 'btx_mp_mp7'`)).shift_session_id === null, 'bank payment is not tagged to the cash drawer shift');
r = (await one(`select record_material_purchase('mp8', $1::jsonb) as r`, [purchase({ paid_amount: 0, lines: [{ item_id: 'item_ml_milk', quantity: 2, unit: 'L', rate: 150 }] })])).r;
const mlMilk = await item('item_ml_milk');
ok(mlMilk.stock === 3000 && near(mlMilk.cost, 0.1667), 'ml item bought in L: +2000 ml, cost per ml (1000 @ 0.2 + 2 L @ 150)', mlMilk);
ok(await supBal('sup_1') === 1180, 'khata-only purchase adds the whole bill to the supplier');
await db.exec(asBuyer);
r = (await one(`select record_material_purchase('mp9', $1::jsonb) as r`, [purchase({ paid_amount: 0, lines: [{ item_id: 'item_box', quantity: 1, unit: 'pcs', rate: 10 }] })])).r;
ok(r.applied, 'procurement role (purchase module) may buy');
await db.exec(asOwner);

// return_material_purchase -------------------------------------------------------------------------
console.log('\n[return_material_purchase]');
const ret = (qty, o = {}) => JSON.stringify({ return_qty: qty, reason: 'Damaged', refund_as: 'cash', business_day_id: 'bd_1', shift_session_id: 'shift_1', drawer_id: 'drawer_1', drawer_account_ids: ['acc_cash'], ...o });
await db.exec(asCashier);
e = await err(`select return_material_purchase('mp_mp1_2', 'rt1', $1::jsonb)`, [ret(1)]);
ok(e && e.includes('ijazat'), 'cashier without purchase:delete refused', e);
await db.exec(asOwner);
const cashBefore = await bal('acc_cash');
const supBefore = await supBal('sup_1');
r = (await one(`select return_material_purchase('mp_mp1_2', 'rt1', $1::jsonb) as r`, [ret(1)])).r;
cup = await item('item_cup');
const cartonPaid = rows[1].details.paid_amount;
const expectRefund = Math.round(Math.min(cartonPaid, 250 * cartonPaid / 500) * 100) / 100;
ok(r.applied && !r.is_full && r.return_amount === 250 && r.cash_refund === expectRefund, 'partial return of 1 carton: Rs 250, paid share refunded', r);
ok(cup.vs.v_ctn === 1 && cup.stock === 136, 'carton goes back out of the carton pile, loose untouched', cup);
ok(near(await bal('acc_cash'), cashBefore + expectRefund, 0.001) && near(await supBal('sup_1'), supBefore - (250 - expectRefund), 0.001), 'refund to the paying account, rest off the khata');
l = await log('log_mp_ret_rt1');
ok(l && l.reason === 'Supply Return' && l.details.variant_deltas.v_ctn === -1 && l.details.loose_delta === 0, 'return log: variant_deltas { v_ctn: -1 }', l);
let mp = await one(`select quantity::float8 quantity, total_amount::float8 total, status, details from material_purchases where id = 'mp_mp1_2'`);
ok(mp.quantity === 1 && mp.total === 250 && mp.status === 'Completed' && mp.details.base_quantity === 50 && mp.details.return_ids[0] === 'rt1', 'bill line now 1 carton', mp);
r = (await one(`select return_material_purchase('mp_mp1_2', 'rt1', $1::jsonb) as r`, [ret(1)])).r;
ok(r.already_applied && (await item('item_cup')).vs.v_ctn === 1 && near(await bal('acc_cash'), cashBefore + expectRefund, 0.001), 'same return id twice: nothing moved again');
e = await err(`select return_material_purchase('mp_mp1_2', 'rt2', $1::jsonb)`, [ret(3)]);
ok(e && e.includes('tak honi'), 'more than the line holds refused', e);

const sugarBefore = await item('item_sugar');
const supBefore2 = await supBal('sup_1');
await failOn('supplier_transactions');
e = await err(`select return_material_purchase('mp_mp1_1', 'rt3', $1::jsonb)`, [ret(null, { refund_as: 'khata' })]);
await unfail('supplier_transactions');
ok(e && e.includes('injected') && (await item('item_sugar')).stock === sugarBefore.stock && (await item('item_sugar')).cost === sugarBefore.cost
  && (await one(`select status from material_purchases where id = 'mp_mp1_1'`)).status === 'Completed' && await supBal('sup_1') === supBefore2
  && await count(`select 1 from inventory_logs where id = 'log_mp_ret_rt3'`) === 0, 'failure at the last write: stock, cost, bill and khata untouched', e);

r = (await one(`select return_material_purchase('mp_mp1_1', 'rt3', $1::jsonb) as r`, [ret(null, { refund_as: 'khata' })])).r;
sugar = await item('item_sugar');
ok(r.is_full && r.status === 'Returned' && r.cash_refund === 0 && near(await supBal('sup_1'), supBefore2 - 1200, 0.001), 'full return on khata: no cash, khata -1200', r);
ok(sugar.stock === sugarBefore.stock - 10, 'sugar loose -10', sugar);
// Before: 20.5 loose + 2 bags = 30.5 kg. 10 kg leave at 120: the rest keeps the older cost.
const expectCost = Math.round(((30.5 * sugarBefore.cost - 10 * 120) / 20.5) * 10000) / 10000;
ok(near(sugar.cost, expectCost, 0.0002), 'returned goods leave the average at the rate they came in', { sugar, expectCost });
e = await err(`select return_material_purchase('mp_mp1_1', 'rt4', $1::jsonb)`, [ret(null)]);
ok(e && e.includes('pehle hi'), 'a returned line cannot be returned again', e);

r = (await one(`select return_material_purchase('mp_mp1_3', 'rt5', $1::jsonb) as r`, [ret(null, { reason: 'Deleted by user' })])).r;
ok(r.is_full && (await item('item_cup')).stock === 100, 'delete = full return: the 3 dozen (36 pcs) leave loose', r);

// A pack that was deleted from the catalog afterwards: out of loose at the size it was bought at.
await one(`select record_material_purchase('mp10', $1::jsonb) as r`, [purchase({ paid_amount: 0, lines: [{ item_id: 'item_cup', quantity: 1, unit: 'Carton', rate: 250 }] })]);
await db.exec(`update items set variants = '[{"id":"v_dz","name":"Dozen","quantity_in_base_unit":12,"deduct_from_base":true}]' where id = 'item_cup'`);
cup = await item('item_cup');
r = (await one(`select return_material_purchase('mp_mp10_1', 'rt6', $1::jsonb) as r`, [ret(null, { refund_as: 'khata' })])).r;
const cupAfter = await item('item_cup');
ok(cupAfter.stock === cup.stock - 50 && cupAfter.vs.v_ctn === cup.vs.v_ctn, 'deleted pack: 50 pcs out of loose, no stray pack count created', { cup, cupAfter });

// allocate_milk_pool --------------------------------------------------------------------------------
console.log('\n[allocate_milk_pool]');
const alloc = (lines, dest = 'Retail Counter') => JSON.stringify({ destination: dest, rate: 160, lines });
await db.exec(asCashier);
e = await err(`select allocate_milk_pool('al1', $1::jsonb)`, [alloc([{ allocation_id: 'alloc_1', quantity: 30, item_id: 'item_cow_milk' }])]);
ok(e && e.includes('ijazat'), 'cashier without allocation:create refused', e);
await db.exec(asOwner);
r = (await one(`select allocate_milk_pool('al1', $1::jsonb) as r`, [alloc([{ allocation_id: 'alloc_1', quantity: 30, item_id: 'item_cow_milk' }])])).r;
let cow = await item('item_cow_milk');
let a1 = await one(`select remaining_quantity::float8 rem, allocated_quantity::float8 alloc, status, destination, details from allocations where id = 'alloc_1'`);
ok(r.applied && cow.stock === 40 && cow.cost === 150, '30 L to the counter: cow milk 10 -> 40 L, cost stays 150', { r, cow });
ok(a1.rem === 70 && a1.alloc === 30 && a1.status === 'Partially Allocated' && a1.details.request_ids[0] === 'al1', 'pool row: 70 L left', a1);
l = await log('log_alloc_al1_1');
ok(l && l.reason === 'Allocation' && l.difference === 30 && l.details.litres === 30 && l.details.loose_delta === 30, 'counter log with litres', l);
r = (await one(`select allocate_milk_pool('al1', $1::jsonb) as r`, [alloc([{ allocation_id: 'alloc_1', quantity: 30, item_id: 'item_cow_milk' }])])).r;
ok(r.already_applied && (await item('item_cow_milk')).stock === 40 && Number((await one(`select remaining_quantity from allocations where id = 'alloc_1'`)).remaining_quantity) === 70,
  'same request twice: no double allocation');

r = (await one(`select allocate_milk_pool('al2', $1::jsonb) as r`, [alloc([{ allocation_id: 'pur_2', quantity: 2, item_id: 'item_ml_milk' }])])).r;
const ml = await item('item_ml_milk');
l = await log('log_alloc_al2_1');
ok(ml.stock === 5000 && l.difference === 2000 && l.details.litres === 2, 'ml milk item: 2 L arrive as 2000 ml (was +2)', { ml, l });
// 3000 ml @ 0.1667 + 2 L @ Rs 200/L (= 0.2 per ml)
ok(near(ml.cost, Math.round(((3000 * mlMilk.cost + 400) / 5000) * 10000) / 10000), 'ml cost: the litre rate spread over ml', ml);

e = await err(`select allocate_milk_pool('al3', $1::jsonb)`, [alloc([{ allocation_id: 'alloc_2', quantity: 5, item_id: 'item_paneer' }])]);
ok(e && e.includes('badla nahi') && Number((await one(`select remaining_quantity from allocations where id = 'alloc_2'`)).remaining_quantity) === 48,
  'a kg item cannot take litres: refused, pool untouched', e);
e = await err(`select allocate_milk_pool('al4', $1::jsonb)`, [alloc([{ allocation_id: 'alloc_2', quantity: 5 }])]);
ok(e && e.includes('doodh item nahi mila'), 'retail line without a counter item refused (the old code took the milk out of the pool anyway)', e);
e = await err(`select allocate_milk_pool('al5', $1::jsonb)`, [alloc([{ allocation_id: 'alloc_1', quantity: 10, item_id: 'item_cow_milk' }, { allocation_id: 'alloc_2', quantity: 60, item_id: 'item_cow_milk' }])]);
ok(e && e.includes('Sirf 48') && (await item('item_cow_milk')).stock === 40 && Number((await one(`select remaining_quantity from allocations where id = 'alloc_1'`)).remaining_quantity) === 70,
  'second line over the pool: the first line rolls back too', e);
await failOn('inventory_logs');
e = await err(`select allocate_milk_pool('al6', $1::jsonb)`, [alloc([{ allocation_id: 'alloc_1', quantity: 10, item_id: 'item_cow_milk' }])]);
await unfail('inventory_logs');
ok(e && e.includes('injected') && (await item('item_cow_milk')).stock === 40 && Number((await one(`select remaining_quantity from allocations where id = 'alloc_1'`)).remaining_quantity) === 70,
  'failure at the stock log: pool and counter untouched', e);
r = (await one(`select allocate_milk_pool('al7', $1::jsonb) as r`, [alloc([{ allocation_id: 'alloc_1', quantity: 70 }], 'Production')])).r;
a1 = await one(`select remaining_quantity::float8 rem, status, destination from allocations where id = 'alloc_1'`);
ok(r.applied && a1.rem === 0 && a1.status === 'Fully Allocated' && a1.destination === 'Production' && (await item('item_cow_milk')).stock === 40,
  'to production: pool only, no counter stock', a1);

// take_counter_milk ---------------------------------------------------------------------------------
console.log('\n[take_counter_milk]');
const take = lines => JSON.stringify({ destination: 'Production', lines });
await db.exec(asCashier);
e = await err(`select take_counter_milk('tk1', $1::jsonb)`, [take([{ item_id: 'item_cow_milk', quantity: 2 }])]);
ok(e && e.includes('ijazat'), 'cashier refused', e);
await db.exec(asOwner);
e = await err(`select take_counter_milk('tk0', $1::jsonb)`, [take([{ item_id: 'item_cow_milk', quantity: 2 }, { item_id: 'item_ml_milk', quantity: 6 }])]);
ok(e && e.includes('sirf 5000') && (await item('item_cow_milk')).stock === 40, 'short on one item: nothing moves', e);
r = (await one(`select take_counter_milk('tk1', $1::jsonb) as r`, [take([{ item_id: 'item_ml_milk', quantity: 1 }, { item_id: 'item_ml_milk', quantity: 0.5 }, { item_id: 'item_cow_milk', quantity: 2 }])])).r;
ok(r.applied && (await item('item_ml_milk')).stock === 3500 && (await item('item_cow_milk')).stock === 38, '1.5 L out of the ml item (1500 ml), 2 L out of the L item', r);
const tkLogs = await q(`select item_id, difference::float8 d, details from inventory_logs where id like 'log_alloc_ret_tk1_%' order by id`);
ok(tkLogs.length === 2 && tkLogs.find(x => x.item_id === 'item_ml_milk').d === -1500 && tkLogs.find(x => x.item_id === 'item_ml_milk').details.litres === -1.5, 'one log per item, in its own unit, litres kept', tkLogs);
r = (await one(`select take_counter_milk('tk1', $1::jsonb) as r`, [take([{ item_id: 'item_ml_milk', quantity: 1.5 }])])).r;
ok(r.already_applied && (await item('item_ml_milk')).stock === 3500, 'same request twice: nothing moves again');
e = await err(`select take_counter_milk('tk2', $1::jsonb)`, [take([{ item_id: 'item_paneer', quantity: 1 }])]);
ok(e && e.includes('badla nahi'), 'a kg item cannot be taken in litres', e);
await failOn('inventory_logs', `new.item_id = 'item_ml_milk'`);
e = await err(`select take_counter_milk('tk3', $1::jsonb)`, [take([{ item_id: 'item_cow_milk', quantity: 1 }, { item_id: 'item_ml_milk', quantity: 1 }])]);
await unfail('inventory_logs');
ok(e && e.includes('injected') && (await item('item_cow_milk')).stock === 38, 'failure on the second item: the first item rolls back', e);

// complete_production_batch ------------------------------------------------------------------------
console.log('\n[complete_production_batch]');
await db.exec(`
  update items set stock = 0.3, variant_stocks = '{"v_bag":2}', cost_price = 100 where id = 'item_sugar';
  update items set stock = 100, variants = '[{"id":"v_ctn","name":"Carton","quantity_in_base_unit":50}]', variant_stocks = '{}' where id = 'item_cup';
  insert into production_batches (id, batch_number, product_name, status, quantity_input, quantity_output_estimated, input_cost_per_unit, details, logs) values
    ('batch_1', 'B-1', 'Dahi', 'Packaging', 20, 18, 150, '{"milk_type":"Cow"}', '[]'),
    ('batch_2', 'B-2', 'Dahi', 'Processing', 60, 50, 150, '{}', '[]'),
    ('batch_3', 'B-3', 'Khoa', 'Packaging', 10, 3, 150, '{}', '[]'),
    ('batch_4', 'B-4', 'Rasmalai', 'Packaging', 10, 3, 150, '{}', '[]'),
    ('batch_5', 'B-5', 'Dahi', 'Cancelled', 10, 9, 150, '{}', '[]');
`);
const output = JSON.stringify({ message: 'Done', output: { loose_qty: 3, packs: [{ variant_id: 'v_500', count: 10 }, { variant_id: 'v_1kg', count: 4 }] } });
await db.exec(asBuyer);
e = await err(`select complete_production_batch('batch_1', $1::jsonb)`, [output]);
ok(e && e.includes('ijazat'), 'procurement role without production refused', e);
await db.exec(asOwner);
await failOn('production_batches');
e = await err(`select complete_production_batch('batch_1', $1::jsonb)`, [output]);
await unfail('production_batches');
ok(e && e.includes('injected') && (await item('item_sugar')).stock === 0.3 && (await item('item_dahi')).stock === 0 && (await item('item_cup')).stock === 100
  && await count(`select 1 from inventory_logs where details->>'batch_id' = 'batch_1'`) === 0, 'failure at the batch status write: no material or output moved', e);

r = (await one(`select complete_production_batch('batch_1', $1::jsonb) as r`, [output])).r;
sugar = await item('item_sugar');
const culture = await item('item_culture');
cup = await item('item_cup');
const dahi = await item('item_dahi');
ok(r.applied && r.total_output === 12 && r.short_materials.length === 0, 'completed: 3 kg loose + 10 x 0.5 + 4 x 1 = 12 kg', r);
ok(sugar.stock === 4.3 && sugar.vs.v_bag === 1, 'sugar: 1 kg needed, 0.3 loose used, one 5 kg bag opened, 4.3 kg back to loose', sugar);
ok(near(culture.stock, 0.03) && culture.vs.v_sachet === 5, 'culture: 20 g (recipe in g, stock in kg) from loose, sachets untouched', culture);
ok(cup.stock === 90, 'packaging: 10 cups for 10 tubs', cup);
ok(dahi.stock === 3 && dahi.vs.v_500 === 10 && dahi.vs.v_1kg === 4, 'dahi: loose 3, packs counted per pack', dahi);
const totalCost = 20 * 150 + 1 * 100 + 0.02 * 2000 + 10 * 5;
ok(near(dahi.cost, Math.round((totalCost / 12) * 10000) / 10000), 'dahi cost = batch cost / output', { cost: dahi.cost, expect: totalCost / 12 });
l = await log('log_prod_batch_1');
ok(l && l.reason === 'Production' && l.difference === 3 && l.details.loose_delta === 3 && l.details.variant_deltas.v_500 === 10 && l.details.variant_deltas.v_1kg === 4, 'output log: loose 3 + variant_deltas', l);
l = await log('log_prod_mat_batch_1_item_sugar');
ok(l && l.reason === 'Production Usage' && l.details.loose_delta === 4 && l.details.variant_deltas.v_bag === -1 && l.details.used === 1, 'sugar log: loose +4 (remainder), bag -1, used 1 kg', l);
let b = await one(`select status, quantity_output_actual::float8 q, details, logs from production_batches where id = 'batch_1'`);
ok(b.status === 'Completed' && b.q === 12 && b.details.cost_snapshot.materials_posted === true && b.details.cost_snapshot.recipe_inputs.length === 2
  && b.details.cost_snapshot.packaging_inputs[0].quantity === 10 && b.details.output_breakdown.variants.length === 2 && b.details.product_item_id === 'item_dahi'
  && b.logs.at(-1).stage === 'Completed', 'batch: status, output, cost snapshot and log line saved together', b);
r = (await one(`select complete_production_batch('batch_1', $1::jsonb) as r`, [output])).r;
ok(r.already_applied && (await item('item_dahi')).stock === 3 && (await item('item_sugar')).stock === 4.3, 'completing again: already done, nothing moved');

// Not enough culture: loose goes below zero by the shortfall and the screen is told.
await db.exec(`update items set stock = 0.01, variant_stocks = '{"v_sachet":2}' where id = 'item_culture'`);
r = (await one(`select complete_production_batch('batch_2', $1::jsonb) as r`, [JSON.stringify({ message: 'Done', output: { loose_qty: 50, packs: [{ variant_id: 'v_pao', count: 4 }] } })])).r;
const cul2 = await item('item_culture');
ok(r.applied && r.short_materials.length === 1 && r.short_materials[0].item_id === 'item_culture' && near(r.short_materials[0].short, 0.03), 'shortfall reported (60 g needed, 30 g on hand)', r.short_materials);
ok(near(cul2.stock, -0.03) && cul2.vs.v_sachet === 0, 'culture: loose 10 g and both sachets used, loose -30 g', cul2);
ok((await item('item_dahi')).stock === 54 && r.total_output === 51, 'multi-unit output (4 pao) goes to loose at its size: 50 + 1', r);

const boxBefore = (await item('item_box')).stock;
e = await err(`select complete_production_batch('batch_3', $1::jsonb)`, [JSON.stringify({ message: 'Done', output: { loose_qty: 3, packs: [] } })]);
ok(e && e.includes('badla nahi') && (await item('item_box')).stock === boxBefore &&(await one(`select status from production_batches where id = 'batch_3'`)).status === 'Packaging',
  'recipe unit kg for a pcs material: clear error, nothing deducted (was: 1 pcs deducted as a raw number)', e);
e = await err(`select complete_production_batch('batch_4', $1::jsonb)`, [JSON.stringify({ message: 'Done', output: { loose_qty: 3, packs: [] } })]);
ok(e && e.includes('catalog mein nahi'), 'a product missing from the catalog is refused (was: a new kg item was invented)', e);
e = await err(`select complete_production_batch('batch_5', $1::jsonb)`, [output]);
ok(e && e.includes('cancel ho chuka'), 'a cancelled batch cannot be completed', e);
await db.exec(`update production_batches set product_name = 'Dahi', status = 'Packaging' where id = 'batch_4'`);
e = await err(`select complete_production_batch('batch_4', $1::jsonb)`, [JSON.stringify({ output: { loose_qty: 1, packs: [{ variant_id: 'v_500', count: 1.5 }] } })]);
ok(e && e.includes('poori'), 'half packs refused', e);
await db.exec(`insert into business_days (id, business_date, status) values ('bd_today', (now() at time zone 'Asia/Karachi')::date, 'Closed')`);
e = await err(`select complete_production_batch('batch_4', $1::jsonb)`, [output]);
ok(e && e.includes('band (locked)'), 'locked day refuses completion', e);
await db.exec(`delete from business_days where id = 'bd_today'`);

// cancel_production_batch --------------------------------------------------------------------------
console.log('\n[cancel_production_batch]');
await db.exec(`
  insert into production_batches (id, batch_number, product_name, status, quantity_input, input_cost_per_unit, details, logs) values
    ('batch_c1', 'C-1', 'Dahi', 'Processing', 10, 160, '{"milk_breakdown":[
      {"allocationId":"inv_item_ml_milk","source":"retail","quantity":1,"milkType":"Cow"},
      {"allocationId":"inv_item_ml_milk","source":"retail","quantity":1,"milkType":"Cow"},
      {"allocationId":"item_cow_milk","source":"retail","quantity":3,"milkType":"Cow"},
      {"allocationId":"alloc_1","source":"fresh","quantity":5,"milkType":"Cow"}]}', '[]'),
    ('batch_c2', 'C-2', 'Dahi', 'Processing', 4, 160, '{"milk_breakdown":[{"allocationId":"item_paneer","source":"retail","quantity":4}]}', '[]');
`);
await db.exec(asCashier);
e = await err(`select cancel_production_batch('batch_c1', '{"message":"x"}'::jsonb)`);
ok(e && e.includes('ijazat'), 'cashier refused', e);
await db.exec(asOwner);
const mlBefore = (await item('item_ml_milk')).stock;
const cowBefore = (await item('item_cow_milk')).stock;
await failOn('production_batches');
e = await err(`select cancel_production_batch('batch_c1', '{"message":"Cancelled: spoilt"}'::jsonb)`);
await unfail('production_batches');
ok(e && e.includes('injected') && (await item('item_ml_milk')).stock === mlBefore && await count(`select 1 from allocations where id = 'alloc_ret_batch_batch_c1'`) === 0,
  'failure at the status write: no milk returned anywhere', e);
r = (await one(`select cancel_production_batch('batch_c1', '{"message":"Cancelled: spoilt"}'::jsonb) as r`)).r;
const pool = await one(`select original_quantity::float8 q, milk_type, average_rate::float8 rate, status from allocations where id = 'alloc_ret_batch_batch_c1'`);
ok(r.applied && r.counter_litres === 5 && r.pool_litres === 5, '5 L back to the counter, 5 L back to the pool', r);
ok((await item('item_ml_milk')).stock === mlBefore + 2000 && (await item('item_cow_milk')).stock === cowBefore + 3, 'both counter lines of the ml item come back (2000 ml), 3 L to the L item');
ok(pool && pool.q === 5 && pool.milk_type === 'Cow' && pool.rate === 160 && pool.status === 'Unallocated', 'pool return lot: 5 L Cow at the batch rate', pool);
l = await log('log_batch_cancel_batch_c1_item_ml_milk');
ok(l && l.reason === 'Production Cancellation' && l.difference === 2000 && l.details.litres === 2 && l.details.loose_delta === 2000, 'cancel log: one per item, in its unit', l);
ok((await one(`select status from production_batches where id = 'batch_c1'`)).status === 'Cancelled', 'batch cancelled');
r = (await one(`select cancel_production_batch('batch_c1', '{}'::jsonb) as r`)).r;
ok(r.already_applied && (await item('item_ml_milk')).stock === mlBefore + 2000, 'cancelling again: nothing returned twice');
e = await err(`select cancel_production_batch('batch_1', '{}'::jsonb)`);
ok(e && e.includes('Completed batch'), 'a completed batch cannot be cancelled', e);
e = await err(`select cancel_production_batch('batch_c2', '{}'::jsonb)`);
ok(e && e.includes('badla nahi') && (await one(`select status from production_batches where id = 'batch_c2'`)).status === 'Processing', 'counter milk on a kg item: clear error, batch unchanged', e);

// return_milk_purchase: no milk_raw log ------------------------------------------------------------
console.log('\n[return_milk_purchase]');
await db.exec(`
  insert into purchases (id, supplier_id, date, milk_type, quantity, rate, total_amount, status, details)
    values ('pur_m1', 'sup_1', now(), 'Cow', 20, 150, 3000, 'Completed', '{}');
  insert into allocations (id, purchase_id, date, supplier_name, milk_type, original_quantity, remaining_quantity, allocated_quantity, status, average_rate)
    values ('alloc_pur_m1', 'pur_m1', now(), 'Ahmed', 'Cow', 20, 20, 0, 'Unallocated', 150);
`);
r = (await one(`select return_milk_purchase('pur_m1', 'mret1', '{"return_qty":5,"refund_as":"khata"}'::jsonb) as r`)).r;
ok(r.applied && Number((await one(`select remaining_quantity from allocations where id = 'alloc_pur_m1'`)).remaining_quantity) === 15, 'milk return still moves the pool', r);
ok(await count(`select 1 from inventory_logs where item_id = 'milk_raw'`) === 0, 'no fake milk_raw stock log');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
