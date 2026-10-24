// Checks the outbound stock migrations (20261024105000 .. 20261024109000) on a PGlite copy of the
// live schema: sale-line pile rule, POS sync from the bill, sales returns, delivery API, day close.
// Same set-up as run.mjs (base schema, the repo migrations the live functions come from, the
// 2026-10-23 migrations), then the new files. Nothing here talks to Supabase.
//
//   node supabase/tests/pglite/stock-outbound.mjs <pglite dir> supabase/migrations supabase/tests/pglite
// (PGlite 0.4.6 installed outside the repo, see run.mjs.)
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
const run = async (dir, name) => {
  try { await db.exec(file(dir, name)); console.log('applied ' + name); }
  catch (e) { failures++; console.log('ERROR applying ' + name + ': ' + e.message); throw e; }
};

// Set-up (as run.mjs) --------------------------------------------------------------------------
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
]) await run(migDir, m);
await db.exec(`create trigger customer_order_validation before insert or update on public.customer_orders
  for each row execute function public.validate_customer_order();`);
await db.exec(`
  insert into app_roles (id, name, permissions) values ('role_super_admin', 'Super Admin', '[]'), ('role_cashier', 'Cashier', '["pos"]'),
    ('role_manager', 'Manager', '["user_management","pos","sales"]');
  insert into app_users (id, name, username, role_id, pin_salt, pin_hash, auth_user_id) values
    ('user_a', 'Owner', 'owner', 'role_super_admin', 's1', 'h1', '11111111-1111-1111-1111-111111111111'),
    ('user_b', 'Cashier', 'cashier', 'role_cashier', 's2', 'h2', '22222222-2222-2222-2222-222222222222'),
    ('user_m', 'Manager', 'manager', 'role_manager', 's3', 'h3', '33333333-3333-3333-3333-333333333333');
  insert into financial_accounts (id, name, type, balance) values ('acc_cash', 'Main Cash', 'Cash', 1000), ('acc_bank', 'Bank', 'Bank', 5000);
  insert into customers (id, name, balance) values ('cust_1', 'Ali', 0);
  insert into app_settings (id, financial) values ('global_settings', '{"defaultCashAccountId": "acc_cash", "defaultDigitalAccountId": "acc_bank"}');
  insert into app_api_keys (name, secret_key) values ('delivery', 'secret-key');
`);
for (const m of [
  '20261023100000_pin_lockout_hardening.sql',
  '20261023101000_tighten_table_and_function_grants.sql',
  '20261023102000_indexes_for_sync_and_foreign_keys.sql',
  '20261023103000_supplier_history_fk_restrict.sql',
  '20261023104000_payment_mode_and_order_advance_fixes.sql',
  '20261023105000_sync_delivery_order_fixes.sql',
  '20261023106000_user_admin_self_escalation_guards.sql',
]) await run(migDir, m);
await db.exec(`grant usage on schema app_private to authenticated;`);
for (const m of [
  '20261023110000_money_rpc_helpers.sql',
  '20261023111000_sales_return_server_checks.sql',
  '20261023112000_return_milk_purchase.sql',
  '20261023113000_write_off_and_settle_balances.sql',
  '20261023114000_update_expense.sql',
  '20261023115000_close_business_day.sql',
  '20261023116000_journal_and_bank_entries.sql',
  '20261023117000_create_financial_account.sql',
  '20261023118000_record_daily_supply_effects.sql',
  '20261023119000_app_roles_owner_only.sql',
]) await run(migDir, m);

const asOwner = `select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false)`;
const asCashier = `select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)`;
const asManager = `select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false)`;
const asNobody = `select set_config('request.jwt.claims', '', false)`;

// Catalog: eggs in pcs with a dozen / tray (multi-units, views of loose) and a ready-made 6-pack;
// curd in kg with a 500 g tub pack and a hidden 1 kg tub; milk in L.
const EGG_VARIANTS = JSON.stringify([
  { id: 'dz', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true, isActive: true },
  { id: 'tray', name: 'Tray', quantity_in_base_unit: 30, deduct_from_base: true, isActive: true },
  { id: 'p6', name: '6 Pack', quantity_in_base_unit: 6, deduct_from_base: false, isActive: true },
]);
const CURD_VARIANTS = JSON.stringify([
  { id: 'tub', name: '500 g tub', quantity_in_base_unit: 0.5, isActive: true },
  { id: 'tub1', name: '1 kg tub', quantity_in_base_unit: 1, isActive: false },
]);
const resetCatalog = async () => db.exec(`
  delete from items;
  insert into items (id, name, unit, stock, type, is_active, cost_price, variants, variant_stocks) values
    ('eggs', 'Eggs', 'pcs', 100, '{Sale product}', true, 20, '${EGG_VARIANTS}', '{"p6": 10}'),
    ('curd', 'Curd', 'kg', 20, '{Sale product}', true, 300, '${CURD_VARIANTS}', '{"tub": 8, "tub1": 3}'),
    ('milk', 'Milk', 'L', 50, '{Sale product}', true, 180, '[]', '{}');
`);
const pile = async id => {
  const r = await one(`select stock, variant_stocks from items where id = $1`, [id]);
  return { loose: Number(r.stock), packs: Object.fromEntries(Object.entries(r.variant_stocks || {}).map(([k, v]) => [k, Number(v)])) };
};
const helper = async (line, variants = EGG_VARIANTS) => (await one(`select app_private.sale_line_stock($1::jsonb, $2::jsonb) as r`, [JSON.stringify(line), variants])).r;

await db.exec(asNobody);
const mine = [
  '20261024105000_sale_line_stock_helper.sql',
  '20261024106000_pos_sync_stock_from_bill.sql',
  '20261024107000_sales_return_stock_from_bill.sql',
  '20261024108000_delivery_order_stock_rules.sql',
  '20261024109000_dayclose_count_every_pile.sql',
];
for (const m of mine) await run(migDir, m);
// Applying them twice must work (CREATE OR REPLACE only).
for (const m of mine) await db.exec(file(migDir, m));
ok(true, 'migrations re-apply cleanly');

// 1. Sale line rule -----------------------------------------------------------------------------
console.log('\n[sale_line_stock]');
let r = await helper({ qty: 5, itemId: 'eggs' });
ok(r.from_base && Number(r.base_qty) === 5 && Number(r.stock_qty) === 5, 'loose line: qty in the base unit', r);
r = await helper({ qty: 2, variantId: 'dz', deductFromBase: true, stockDeduction: 12 });
ok(r.from_base && Number(r.base_qty) === 24 && r.variant_id === null, 'dozen (snapshot multi-unit): 2 x 12 from loose', r);
r = await helper({ qty: 2, variantId: 'dz', deductFromBase: true, stockDeduction: 10 });
ok(Number(r.base_qty) === 20, 'snapshot size wins over a later catalog size', r);
r = await helper({ qty: 3, variantId: 'p6', deductFromBase: false, stockDeduction: 6 });
ok(!r.from_base && r.variant_id === 'p6' && Number(r.stock_qty) === 3 && Number(r.base_qty) === 18, 'ready-made pack: its own count', r);
r = await helper({ qty: 2, variantId: 'tray' });
ok(r.from_base && Number(r.base_qty) === 60, 'no flag: the catalog says tray is a multi-unit', r);
r = await helper({ qty: 2, variantId: 'p6' });
ok(!r.from_base && Number(r.stock_qty) === 2, 'no flag: the catalog says p6 is a pack', r);
r = await helper({ qty: 2, variantId: 'gone', deductFromBase: false, stockDeduction: 6 });
ok(r.from_base && r.fallback && Number(r.base_qty) === 12, 'pack deleted since the sale: its size from loose, no stray count', r);
r = await helper({ qty: 1, variantId: 'dz', deductFromBase: false, stockDeduction: 12 });
ok(r.from_base && r.fallback && Number(r.base_qty) === 12, 'snapshot says pack but the catalog has no such pack pile: loose', r);
r = await helper({ qty: -4, itemId: 'eggs' });
ok(Number(r.base_qty) === 0, 'negative qty counts as 0', r);
r = await helper({ qty: 2, variantId: 'loose', deductFromBase: false });
ok(r.from_base && Number(r.base_qty) === 2, "'loose' variant id is the loose pile", r);
r = await helper({ qty: 2, variantId: 'p6', isLoose: true });
ok(r.from_base && Number(r.base_qty) === 2, 'isLoose wins over a variant id (saleLineStock)', r);
r = await helper({ qty: '2.5', itemId: 'milk' }, '[]');
ok(Number(r.base_qty) === 2.5, 'numeric string qty', r);
r = await helper({ qty: 'abc', itemId: 'milk' }, '[]');
ok(Number(r.base_qty) === 0, 'junk qty is 0, not an error', r);
r = await helper({ qty: 0.3333333, itemId: 'milk' }, '[]');
ok(Number(r.base_qty) === 0.333, 'rounded to 3 decimals', r);
ok((await one(`select has_function_privilege('authenticated', 'app_private.sale_line_stock(jsonb, jsonb)', 'execute') x`)).x === false, 'helper not callable by authenticated');

// 2. POS sync: stock from the bill ------------------------------------------------------------------
console.log('\n[pos_sync_order_effects]');
await resetCatalog();
const bill = (id, items, extra = {}) => db.query(
  `insert into sales (id, bill_number, date, customer_id, subtotal, discount, total, payment_mode, status, items, details)
   values ($1, $2, now(), $3, $4, 0, $4, 'Cash', 'Completed', $5::jsonb, '{}')`,
  [id, 'B-' + id, extra.customer || null, extra.total || 100, JSON.stringify(items)]);
const effects = (id, items, extra = {}) => one(`select pos_sync_order_effects($1::jsonb) as r`, [JSON.stringify({
  order_id: id, bill_number: 'B-' + id, date: new Date().toISOString(), payment_mode: 'Cash', paid_amount: extra.paid ?? 0,
  total: extra.total || 100, due_amount: 0, account_id: extra.account || null, items,
})]);
await bill('s1', [
  { itemId: 'eggs', name: 'Eggs', qty: 5, price: 20, isLoose: true, deductFromBase: true, stockDeduction: 1 },
  { itemId: 'eggs', name: 'Eggs', qty: 2, price: 230, variantId: 'dz', deductFromBase: true, stockDeduction: 12 },
  { itemId: 'eggs', name: 'Eggs', qty: 3, price: 110, variantId: 'p6', deductFromBase: false, stockDeduction: 6 },
  { itemId: 'eggs', name: 'Eggs', qty: 1, price: 110, variantId: 'p6', deductFromBase: false, stockDeduction: 6 },
  { itemId: 'milk', name: 'Milk', qty: 1.5, price: 220, isLoose: true },
]);
// The payload says something else entirely: the server must not follow it.
r = (await effects('s1', [{ item_id: 'eggs', qty: 1, variant_id: null }, { item_id: 'milk', qty: 99, variant_id: 'p6' }], { paid: 100, account: 'acc_cash' })).r;
let eggs = await pile('eggs');
ok(eggs.loose === 71 && eggs.packs.p6 === 6, 'bill lines decide: 5 loose + 2 dozen = 29 from loose, 3 + 1 six-packs from the pack pile', eggs);
ok((await pile('milk')).loose === 48.5 && !('p6' in (await pile('milk')).packs), 'milk: 1.5 L loose, the payload\'s fake pack ignored');
ok(r.stock_from_bill === true && r.inventory_applied === true && r.payment_applied === true, 'result says stock came from the bill', r);
let log = await one(`select * from inventory_logs where id = 'log_s1_eggs'`);
ok(log && Number(log.difference) === -29 && log.details.variant_deltas.p6 === -4 && log.details.sale_id === 's1', 'one log per item, loose columns + details.variant_deltas', log);
r = (await effects('s1', [], { paid: 100, account: 'acc_cash' })).r;
eggs = await pile('eggs');
ok(eggs.loose === 71 && eggs.packs.p6 === 6 && r.inventory_applied === false && r.payment_applied === false, 'same order twice: nothing moves again', { eggs, r });
ok(Number((await one(`select balance from financial_accounts where id = 'acc_cash'`)).balance) === 1100, 'payment posted once');

await bill('s2', [
  { itemId: 'eggs', name: 'Eggs', qty: 1, price: 230, variantId: 'tray' },
  { itemId: 'eggs', name: 'Eggs', qty: 2, price: 110, variantId: 'gone', deductFromBase: false, stockDeduction: 6 },
  { itemId: 'eggs', name: 'Eggs', qty: 1, price: 230, variantId: 'dz', deductFromBase: false, stockDeduction: 12 },
]);
await effects('s2', [{ item_id: 'eggs', qty: 1, variant_id: 'tray' }]);
eggs = await pile('eggs');
ok(eggs.loose === 71 - 30 - 12 - 12 && eggs.packs.p6 === 6 && !('tray' in eggs.packs) && !('gone' in eggs.packs) && !('dz' in eggs.packs),
  'flagless tray, deleted pack and a dozen saved as "pack" all leave loose; no phantom counts', eggs);

await bill('s3', [{ itemId: 'curd', name: 'Curd', qty: 2, price: 160, variantId: 'tub1', deductFromBase: false, stockDeduction: 1 }]);
await effects('s3', []);
ok((await pile('curd')).packs.tub1 === 1, 'a hidden pack still sells from its own pile');

// No bill row: the payload lines, checked against the catalog.
await effects('s4', [{ item_id: 'eggs', qty: 2, variant_id: 'p6' }, { item_id: 'eggs', qty: 1, variant_id: 'dz' }, { item_id: 'eggs', qty: 3, variant_id: null }]);
eggs = await pile('eggs');
ok(eggs.packs.p6 === 4 && eggs.loose === 17 - 12 - 3, 'no bill row: payload pack -> pack pile, payload multi-unit id -> loose at its size', eggs);
await effects('s5', [{ item_id: 'item_gone', qty: 2, variant_id: null }]);
ok((await one(`select count(*)::int c from inventory_logs where item_id = 'item_gone'`)).c === 0, 'unknown product: nothing moved, no error');

// Customer order checkout still goes through pos_sync_order_effects with its own enriched lines.
await bill('s6', [
  { itemId: 'milk', name: 'Milk', qty: 2, price: 220, isLoose: true, deductFromBase: true, stockDeduction: 1 },
  { itemId: 'eggs', name: 'Eggs', qty: 1, price: 230, variantId: 'dz', isLoose: false, deductFromBase: true, stockDeduction: 12 },
]);
await effects('s6', [{ item_id: 'milk', qty: 2, variant_id: null }, { item_id: 'eggs', qty: 12, variant_id: null }]);
ok((await pile('milk')).loose === 46.5 && (await pile('eggs')).loose === -10, 'checkout-style lines: loose 2 L, dozen 12 pcs (2 - 12 = -10, minus stock allowed)', await pile('eggs'));

// 3. Sales return: moves from the bill -----------------------------------------------------------
console.log('\n[process_sales_return]');
await resetCatalog();
await db.exec(`insert into customers (id, name, balance) values ('cust_r', 'Return Cust', 0)`);
await db.query(`insert into sales (id, bill_number, date, customer_id, subtotal, discount, total, payment_mode, status, items, details)
  values ('r1', 'R1', now(), 'cust_r', 1290, 0, 1290, 'Credit', 'Completed', $1::jsonb, '{"paid_amount": 0}')`, [JSON.stringify([
  { itemId: 'eggs', name: 'Eggs', qty: 2, price: 230, variantId: 'dz', deductFromBase: true, stockDeduction: 12 },
  { itemId: 'eggs', name: 'Eggs', qty: 3, price: 110, variantId: 'p6', deductFromBase: false, stockDeduction: 6 },
  { itemId: 'milk', name: 'Milk', qty: 2, price: 250, isLoose: true },
])]);
const ret = (o) => JSON.stringify({
  return_type: o.replace ? 'replace' : 'refund', restock_action: o.scrap ? 'scrap_spoilage' : 'restock', return_reason: 'test (Restocked)',
  returned_items: o.lines,
  stock_moves: o.moves ?? [{ item_id: 'milk', variant_id: 'p6', delta: 999 }],
  logs: [{ id: 'client_log_' + (o.id || 'x'), item_id: 'milk', difference: 999, reason: 'Sales Return' }],
  refund_amount: o.refund || 0,
  khata: o.refund ? { amount: o.refund, tx_id: 'ctx_ret_' + o.id, details: {} } : null,
  cash: null,
  ...(o.restock !== undefined ? { restock: o.restock } : {}),
});
const dz = (qty) => ({ itemId: 'eggs', name: 'Eggs', qty, price: 230, variantId: 'dz', action: 'refund' });
const p6 = (qty) => ({ itemId: 'eggs', name: 'Eggs', qty, price: 110, variantId: 'p6', action: 'refund' });
const milkLine = (qty) => ({ itemId: 'milk', name: 'Milk', qty, price: 250, action: 'refund' });
await db.exec(asOwner);
r = (await one(`select process_sales_return('r1', 'rt1', $1::jsonb) as r`, [ret({ id: 1, lines: [dz(1), p6(2), milkLine(0.5)], refund: 575 })])).r;
eggs = await pile('eggs');
ok(eggs.loose === 112 && eggs.packs.p6 === 12 && (await pile('milk')).loose === 50.5, 'dozen back to loose as 12, packs to their pile, 0.5 L loose; the fake 999 move ignored', { eggs, milk: await pile('milk') });
ok(Array.isArray(r.stock_moves) && r.stock_moves.length === 3, 'result lists the applied moves (one per returned bill line)', r);
ok((await one(`select count(*)::int c from inventory_logs where id = 'client_log_1'`)).c === 0, 'client-sent logs are not inserted');
const retLogs = await q(`select * from inventory_logs where id like 'log_ret_rt1_%' order by id`);
ok(retLogs.length === 3 && retLogs.every(l => l.reason === 'Sales Return' && l.details.sale_id === 'r1'), 'server writes one log per returned bill line', retLogs.map(l => l.id));
const p6Log = retLogs.find(l => l.details.variant_deltas.p6);
ok(p6Log && Number(p6Log.difference) === 0 && p6Log.details.variant_deltas.p6 === 2 && Number(p6Log.old_quantity) === Number(p6Log.new_quantity), 'pack return log: loose columns unchanged, pack in variant_deltas', p6Log);
r = (await one(`select process_sales_return('r1', 'rt1', $1::jsonb) as r`, [ret({ id: 1, lines: [dz(1), p6(2), milkLine(0.5)], refund: 575 })])).r;
ok(r.already_applied && (await pile('eggs')).loose === 112, 'same return id twice: stock moved once');
let e = await err(`select process_sales_return('r1', 'rt2', $1::jsonb)`, [ret({ id: 2, lines: [dz(1), dz(1)] })]);
ok(e && e.includes('sirf 1'), 'two lines of the same dozen in one request are added up before the cap (1 left)', e);
e = await err(`select process_sales_return('r1', 'rt3', $1::jsonb)`, [ret({ id: 3, lines: [p6(2)] })]);
ok(e && e.includes('sirf 1'), 'pack return above sold - returned refused', e);
ok((await pile('eggs')).packs.p6 === 12, 'refused returns moved nothing');
// Scrapped: logged, nothing restocked.
r = (await one(`select process_sales_return('r1', 'rt4', $1::jsonb) as r`, [ret({ id: 4, scrap: true, lines: [p6(1)], moves: [] })])).r;
const scrapLog = await one(`select * from inventory_logs where id like 'log_ret_rt4_%'`);
ok((await pile('eggs')).packs.p6 === 12 && scrapLog.reason === 'Spoilage / Wastage' && Number(scrapLog.details.scrapped_qty) === 1 && scrapLog.details.variant_id === 'p6',
  'scrap: no stock back; log has scrapped_qty and the pack id for its size', scrapLog);
// The live build marks a spoiled return by sending no stock moves (restock_action stays 'restock').
r = (await one(`select process_sales_return('r1', 'rt5', $1::jsonb) as r`, [ret({ id: 5, lines: [milkLine(0.5)], moves: [] })])).r;
ok((await pile('milk')).loose === 50.5 && r.stock_moves.length === 0, 'live-build spoiled return (no moves sent): nothing restocked');
// Replacement: a fresh unit leaves the same pile.
r = (await one(`select process_sales_return('r1', 'rt6', $1::jsonb) as r`, [ret({ id: 6, replace: true, lines: [{ ...dz(1), action: 'replace' }] })])).r;
ok((await pile('eggs')).loose === 100 && r.status === 'Partially Returned', 'replacement takes a fresh dozen (12) from loose', { eggs: await pile('eggs'), r });
// Explicit restock flag from the new build.
await db.query(`insert into sales (id, bill_number, date, subtotal, discount, total, payment_mode, status, items, details)
  values ('r2', 'R2', now(), 330, 0, 330, 'Cash', 'Completed', $1::jsonb, '{"paid_amount": 330}')`, [JSON.stringify([
  { itemId: 'eggs', name: 'Eggs', qty: 3, price: 110, variantId: 'gone', deductFromBase: false, stockDeduction: 6 },
  { itemId: 'curd', name: 'Curd', qty: 1, price: 330, variantId: 'tub1', deductFromBase: false, stockDeduction: 1 },
])]);
r = (await one(`select process_sales_return('r2', 'rt7', $1::jsonb) as r`, [ret({ id: 7, restock: false, lines: [{ itemId: 'eggs', name: 'Eggs', qty: 1, price: 110, variantId: 'gone' }] })])).r;
ok((await pile('eggs')).loose === 100, 'restock: false -> nothing moves even with stock_moves sent');
r = (await one(`select process_sales_return('r2', 'rt8', $1::jsonb) as r`, [ret({ id: 8, restock: true, moves: [], lines: [{ itemId: 'eggs', name: 'Eggs', qty: 2, price: 110, variantId: 'gone' }, { itemId: 'curd', name: 'Curd', qty: 1, price: 330, variantId: 'tub1' }] })])).r;
eggs = await pile('eggs');
ok(eggs.loose === 112 && !('gone' in eggs.packs) && (await pile('curd')).packs.tub1 === 4, 'pack deleted since the sale returns to loose at its size; hidden pack to its pile', { eggs, curd: await pile('curd') });
// A product deleted since the sale: the return still goes through, no stock moves.
await db.query(`insert into sales (id, bill_number, date, subtotal, discount, total, payment_mode, status, items, details)
  values ('r3', 'R3', now(), 100, 0, 100, 'Cash', 'Completed', '[{"itemId":"item_deleted","name":"Old","qty":1,"price":100}]', '{"paid_amount": 100}')`);
r = (await one(`select process_sales_return('r3', 'rt9', $1::jsonb) as r`, [ret({ id: 9, lines: [{ itemId: 'item_deleted', name: 'Old', qty: 1, price: 100 }], moves: [{ item_id: 'item_deleted', variant_id: null, delta: 1 }] })])).r;
ok(r.applied && r.status === 'Returned' && r.stock_moves.length === 0, 'deleted product: return applied, nothing moved', r);
await db.exec(asCashier);
e = await err(`select process_sales_return('r2', 'rt10', $1::jsonb)`, [ret({ id: 10, lines: [{ itemId: 'curd', name: 'Curd', qty: 1, price: 330, variantId: 'tub1' }] })]);
ok(e && e.includes('ijazat'), 'cashier without sales_history:return still refused', e);
await db.exec(asNobody);

// 4. Delivery API ---------------------------------------------------------------------------------
console.log('\n[sync_delivery_order]');
await resetCatalog();
const deliver = async (order) => (await one(`select sync_delivery_order('secret-key', $1::jsonb) as r`, [JSON.stringify(order)])).r;
r = await deliver({ order_id: 'D-10', order_total: 1000, items: [
  { name: 'Eggs', variant_name: 'Dozen', quantity: 2 },
  { name: 'Eggs', variant_name: '6 pack', quantity: 3 },
  { name: 'Eggs', variant_name: 'Loose', quantity: 4 },
  { name: 'Milk', variant_name: 'L', quantity: 1.5 },
  { name: 'Curd', variant_id: 'tub', quantity: 2 },
] });
eggs = await pile('eggs');
ok(r.success && eggs.loose === 100 - 24 - 4 && eggs.packs.p6 === 7 && (await pile('milk')).loose === 48.5 && (await pile('curd')).packs.tub === 6,
  'dozen 24 + loose 4 from loose, 6-pack count, milk "L" is loose, curd tub by variant_id', { r, eggs });
const packLog = await one(`select * from inventory_logs where notes like 'Live Delivery%' and details->'variant_deltas' ? 'p6'`);
ok(packLog && packLog.details.variant_deltas.p6 === -3 && Number(packLog.difference) === 0, 'pack log uses details.variant_deltas', packLog);
const dLines = (await one(`select items from sales where bill_number = 'D-10'`)).items;
ok(dLines[0].deductFromBase === true && Number(dLines[0].stockDeduction) === 12 && dLines[1].deductFromBase === false && dLines[1].variantId === 'p6', 'bill lines carry the same snapshot as POS bills', dLines.slice(0, 2));
r = await deliver({ order_id: 'D-11', order_total: 300, items: [
  { name: 'Eggs', variant_name: 'Crate', quantity: 2 },
  { name: 'Milk', quantity: -3 },
  { name: 'Milk', quantity: 'abc' },
  { name: 'Milk', quantity: 0 },
] });
ok(r.success && r.unmatched_lines === 4 && (await pile('eggs')).loose === 72 && (await pile('milk')).loose === 48.5, 'unknown pack, negative / text / zero qty: order saved, no stock moved', r);
const d11 = (await one(`select items from sales where bill_number = 'D-11'`)).items;
ok(d11[0].unmatched_reason === 'pack' && d11[1].unmatched_reason === 'quantity', 'unmatched lines say why', d11);
r = await deliver({ order_id: 'D-10', order_total: 1000, items: [{ name: 'Eggs', variant_name: 'Dozen', quantity: 2 }] });
ok(r.duplicate === true && (await pile('eggs')).loose === 72, 'same order twice: duplicate, stock moved once');
r = await deliver({ order_id: 'D-12', order_total: 100, items: [{ name: 'Milk' }] });
ok(r.success && (await pile('milk')).loose === 47.5, 'no quantity at all still means 1 (as before)');

// 5. Day close count ------------------------------------------------------------------------------
console.log('\n[dayclose_stock_count]');
await resetCatalog();
// Stray counts: on the dozen (a multi-unit) and on a pack that no longer exists.
await db.exec(`update items set variant_stocks = '{"p6": 10, "dz": 5, "old_pack": 2}' where id = 'eggs'`);
const count = (day, counts) => one(`select dayclose_stock_count($1, $2::jsonb) as r`, [day, JSON.stringify(counts)]);
await db.exec(asCashier);
e = await err(`select dayclose_stock_count('bd_1', '[]'::jsonb)`);
ok(e && e.includes('manager'), 'cashier cannot apply the day-close count', e);
await db.exec(asManager);
e = await err(`select dayclose_stock_count('bd_1', $1::jsonb)`, [JSON.stringify([{ item_id: 'eggs', counted: 90 }, { item_id: 'eggs', variant_id: 'dz', counted: 3 }])]);
ok(e && e.includes('sirf 0'), 'a stray count can only be set to 0', e);
ok((await pile('eggs')).loose === 100, 'refused count moved nothing');
e = await err(`select dayclose_stock_count('bd_1', $1::jsonb)`, [JSON.stringify([{ item_id: 'milk', counted: -1 }])]);
ok(e && e.includes('ghalat'), 'negative count refused', e);
e = await err(`select dayclose_stock_count('bd_1', $1::jsonb)`, [JSON.stringify([{ item_id: 'milk', counted: 'x' }])]);
ok(e && e.includes('ghalat'), 'non-numeric count refused (no cast error)', e);
r = (await count('bd_1', [
  { item_id: 'eggs', counted: 90 },
  { item_id: 'eggs', variant_id: 'p6', counted: 12 },
  { item_id: 'eggs', variant_id: 'dz', counted: 0 },
  { item_id: 'eggs', variant_id: 'old_pack', counted: 0 },
  { item_id: 'curd', variant_id: 'tub1', counted: 1 },
  { item_id: 'curd', variant_id: 'loose', counted: 18.5 },
  { item_id: 'milk', counted: 50 },
])).r;
eggs = await pile('eggs');
const curd = await pile('curd');
ok(r.adjusted === 2 && r.no_change === 1, 'eggs and curd adjusted, milk unchanged', r);
ok(eggs.loose === 90 && eggs.packs.p6 === 12 && eggs.packs.dz === 0 && eggs.packs.old_pack === 0, 'loose and pack counted, stray dozen / deleted-pack counts cleared', eggs);
ok(curd.loose === 18.5 && curd.packs.tub1 === 1 && curd.packs.tub === 8, "hidden pack counted; 'loose' variant id is the loose pile; uncounted pack untouched", curd);
const dcLog = await one(`select * from inventory_logs where id = 'log_dayclose_bd_1_eggs'`);
ok(dcLog && Number(dcLog.difference) === -10 && dcLog.details.variant_deltas.p6 === 2 && dcLog.details.variant_deltas.dz === -5 && dcLog.details.variant_deltas.old_pack === -2,
  'log carries loose columns + details.variant_deltas', dcLog);
ok((await one(`select details from inventory_logs where id = 'log_dayclose_bd_1_milk'`)).details.loose_delta === 0, 'no-change guard row has details too');
r = (await count('bd_1', [{ item_id: 'eggs', counted: 50 }])).r;
ok(r.skipped === 1 && (await pile('eggs')).loose === 90, 'same day + item twice: skipped');
await db.exec(asNobody);
r = (await count('bd_2', [{ item_id: 'milk', counted: 49 }])).r;
ok(r.adjusted === 1, 'direct database session (no JWT) is trusted');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
