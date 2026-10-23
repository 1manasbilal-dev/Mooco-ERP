// Loads a copy of the live schema into PGlite (Postgres 17 in WASM), replays the repo migrations
// the live functions come from, applies the new migrations and checks their behaviour.
// Nothing here talks to Supabase.
//
// PGlite is not a project dependency; install it anywhere outside the repo, e.g.
//   mkdir %TEMP%\pgl && cd %TEMP%\pgl && npm init -y && npm i @electric-sql/pglite@0.4.6
// (0.3.x cannot raise SQL errors under Node 24 and has no pgcrypto), then from the repo root:
//   node supabase/tests/pglite/run.mjs <pglite dir> supabase/migrations supabase/tests/pglite
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [pgliteDir, migDir, testDir] = process.argv.slice(2);
const { PGlite } = await import(pathToFileURL(join(pgliteDir, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
const { pgcrypto } = await import(pathToFileURL(join(pgliteDir, 'node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js')).href);
const db = new PGlite({ extensions: { pgcrypto } });
const file = (dir, name) => readFileSync(join(dir, name), 'utf8');
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };

const run = async (dir, name) => {
  try { await db.exec(file(dir, name)); console.log('applied ' + name); }
  catch (e) { failures++; console.log('ERROR applying ' + name + ': ' + e.message); throw e; }
};

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

// Seed -------------------------------------------------------------------------------------
await db.exec(`
  insert into app_roles (id, name, permissions) values ('role_super_admin', 'Super Admin', '[]'), ('role_cashier', 'Cashier', '["pos"]');
  insert into app_users (id, name, username, role_id, pin_salt, pin_hash, auth_user_id) values
    ('user_a', 'Owner', 'owner', 'role_super_admin', 'salt1', encode(digest('salt1' || '4321', 'sha256'), 'hex'), '11111111-1111-1111-1111-111111111111'),
    ('user_b', 'Cashier', 'cashier', 'role_cashier', 'salt2', encode(digest('salt2' || '1234', 'sha256'), 'hex'), '22222222-2222-2222-2222-222222222222');
  insert into financial_accounts (id, name, type, balance) values ('acc_cash', 'Main Cash', 'Cash', 1000), ('acc_bank', 'Bank', 'Bank', 5000);
  insert into customers (id, name, balance) values ('cust_1', 'Ali', 0);
  insert into suppliers (id, name, balance) values ('sup_1', 'Gawala', 0);
  insert into items (id, name, stock, type, is_active) values ('item_milk', 'Milk', 100, '{Sale product}', true);
  insert into app_settings (id, financial) values ('global_settings', '{"defaultCashAccountId": "acc_cash", "defaultDigitalAccountId": "acc_bank"}');
  insert into app_api_keys (name, secret_key) values ('delivery', 'secret-key');
`);

// New migrations -----------------------------------------------------------------------------
const newMigrations = [
  '20261023100000_pin_lockout_hardening.sql',
  '20261023101000_tighten_table_and_function_grants.sql',
  '20261023102000_indexes_for_sync_and_foreign_keys.sql',
  '20261023103000_supplier_history_fk_restrict.sql',
  '20261023104000_payment_mode_and_order_advance_fixes.sql',
  '20261023105000_sync_delivery_order_fixes.sql',
  '20261023106000_user_admin_self_escalation_guards.sql',
  ...process.argv.slice(5),
];

// Capture old behaviour first where the test compares before/after.
console.log('\n[before] change_sale_payment_mode with no receipt on the server');
await db.exec(`insert into sales (id, bill_number, date, customer_id, total, payment_mode, status, details)
  values ('sale_x', 'B1', now(), null, 300, 'Cash', 'Completed', '{"paid_amount": 300}')`);
await q(`select change_sale_payment_mode('sale_x', 'Online', 'acc_cash', 'acc_bank', 300, null, '{}'::jsonb, null, null)`);
const beforeCash = await one(`select balance from financial_accounts where id = 'acc_cash'`);
ok(Number(beforeCash.balance) === 700, 'old code debits the cash account that never got the money (bug reproduced)', beforeCash);
await db.exec(`update financial_accounts set balance = 1000 where id = 'acc_cash'; update financial_accounts set balance = 5000 where id = 'acc_bank';
  delete from bank_transactions; delete from sales;`);

for (const m of newMigrations) await run(migDir, m);

// 1. PIN lockout ----------------------------------------------------------------------------
console.log('\n[pin lockout]');
ok((await one(`select app_login('owner', '4321') as r`)).r?.id === 'user_a', 'correct PIN logs in');
ok((await one(`select app_login('owner', '4321') as r`)).r?.pin_hash === undefined, 'pin hash not returned');
for (let i = 0; i < 4; i++) ok((await one(`select app_login('owner', '0000') as r`)).r === null, `wrong PIN via username #${i + 1} returns null`);
for (let i = 0; i < 4; i++) ok((await one(`select app_verify_pin('user_a', '0000') as r`)).r === null, `wrong PIN via user id #${i + 1} returns null`);
let e = await err(`select app_login('owner', '4321')`);
ok(e && e.includes('15 minute'), 'after 8 failures across both modes the username login is locked', e);
e = await err(`select app_verify_pin('user_a', '4321')`);
ok(e && e.includes('15 minute'), 'and the user-id login is locked too', e);
ok((await one(`select count(*)::int c from app_login_attempts where username = 'uid_user_a' and success = false`)).c === 8, 'failures recorded under one bucket');
ok((await one(`select app_verify_pin('user_b', '1234') as r`)).r?.id === 'user_b', 'other operator unaffected');
// daily cap: age the 8 failures past 15 minutes, add more
await db.exec(`update app_login_attempts set attempted_at = now() - interval '2 hours' where username = 'uid_user_a'`);
for (let i = 0; i < 7; i++) await q(`select app_verify_pin('user_a', '0000')`);
await db.exec(`update app_login_attempts set attempted_at = now() - interval '3 hours' where username = 'uid_user_a'`);
for (let i = 0; i < 5; i++) await q(`select app_login('owner', '0000')`);
e = await err(`select app_login('owner', '4321')`);
ok(e && e.includes('Aaj bohat zyada'), '20 failures in 24h lock even though the 15-minute window is clear', e);
await db.exec(`update app_login_attempts set attempted_at = now() - interval '25 hours' where username = 'uid_user_a'`);
ok((await one(`select app_login('owner', '4321') as r`)).r?.id === 'user_a', 'lock clears after 24h');
ok((await one(`select count(*)::int c from app_login_attempts where attempted_at < now() - interval '1 day'`)).c === 0, 'old attempts are cleaned');
// unknown username is still throttled
for (let i = 0; i < 8; i++) await q(`select app_login('nobody', '1111')`);
e = await err(`select app_login('nobody', '1111')`);
ok(e && e.includes('15 minute'), 'unknown username throttled', e);
// pin-only and approval buckets
for (let i = 0; i < 8; i++) await q(`select app_login_with_pin('9999')`);
e = await err(`select app_login_with_pin('1234')`);
ok(e && e.includes('15 minute'), 'pin-only bucket locks', e);
await db.exec(`select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)`);
ok((await one(`select app_approve_override('user_a', '0000', 'sales:return') as r`)).r?.approved === false, 'approval wrong PIN -> approved false');
ok((await one(`select app_approve_override('user_a', '4321', 'sales:return') as r`)).r?.approved === true, 'approval right PIN -> approved');
await db.exec(`select set_config('request.jwt.claims', '', false)`);
ok((await one(`select has_function_privilege('anon', 'app_private.pin_lockout_message(text[])', 'execute') as x`)).x === false, 'lockout helper not executable by anon');
ok((await one(`select has_function_privilege('authenticated', 'app_private.pin_lockout_message(text[])', 'execute') as x`)).x === false, 'lockout helper not executable by authenticated');

// 2. Grants ---------------------------------------------------------------------------------
console.log('\n[grants]');
ok((await one(`select has_table_privilege('authenticated', 'public.sales', 'truncate') as x`)).x === false, 'authenticated cannot truncate');
ok((await one(`select has_table_privilege('authenticated', 'public.sales', 'select, insert, update, delete') as x`)).x === true, 'authenticated keeps CRUD');
ok((await one(`select has_function_privilege('authenticated', 'public.validate_customer_order()', 'execute') as x`)).x === false, 'trigger function not callable');
await db.exec(`create table public.zz_new (id int)`);
ok((await one(`select has_table_privilege('authenticated', 'public.zz_new', 'truncate') as x`)).x === false, 'future tables: no truncate for authenticated');

// 3. Indexes and drawer trigger --------------------------------------------------------------
console.log('\n[indexes / trigger]');
ok((await one(`select count(*)::int c from pg_indexes where schemaname = 'public' and indexname like '%date_desc_idx'`)).c >= 8, 'date indexes created');
const drawerBefore = await one(`select updated_at from cash_drawers where id = 'acc_cash'`);
ok(!!drawerBefore, 'cash account has its drawer row');
await db.exec(`update cash_drawers set updated_at = '2000-01-01' where id = 'acc_cash'`);
await q(`select adjust_account_balance('acc_cash', 10)`);
ok((await one(`select updated_at::date::text d from cash_drawers where id = 'acc_cash'`)).d === '2000-01-01', 'balance-only update does not touch the drawer');
await db.exec(`update financial_accounts set name = 'Counter Cash' where id = 'acc_cash'`);
ok((await one(`select name from cash_drawers where id = 'acc_cash'`)).name === 'Counter Cash', 'rename still syncs the drawer');
await db.exec(`update financial_accounts set is_active = false where id = 'acc_cash'`);
ok((await one(`select is_active from cash_drawers where id = 'acc_cash'`)).is_active === false, 'deactivation still syncs');
await db.exec(`update financial_accounts set is_active = true, balance = 1000 where id = 'acc_cash'`);
await db.exec(`insert into financial_accounts (id, name, type, balance) values ('acc_cash2', 'Cash 2', 'Cash', 0)`);
ok(!!(await one(`select 1 x from cash_drawers where id = 'acc_cash2'`)), 'insert still creates a drawer');

// 4. Supplier FK restrict ---------------------------------------------------------------------
console.log('\n[supplier fk]');
await db.exec(`insert into supplier_transactions (id, supplier_id, type, amount) values ('stx_1', 'sup_1', 'Payment', 10)`);
e = await err(`delete from suppliers where id = 'sup_1'`);
ok(e && e.includes('foreign key'), 'supplier with history cannot be deleted', e);
ok((await one(`select count(*)::int c from supplier_transactions`)).c === 1, 'history kept');
await db.exec(`insert into suppliers (id, name) values ('sup_2', 'Empty')`);
ok((await err(`delete from suppliers where id = 'sup_2'`)) === null, 'supplier without history can be deleted');

// 5a. change_sale_payment_mode ---------------------------------------------------------------
console.log('\n[change_sale_payment_mode]');
const bal = async id => Number((await one(`select balance from financial_accounts where id = $1`, [id])).balance);
await db.exec(`insert into sales (id, bill_number, date, total, payment_mode, status, details)
  values ('sale_x', 'B1', now(), 300, 'Cash', 'Completed', '{"paid_amount": 300}')`);
let r = (await one(`select change_sale_payment_mode('sale_x', 'Online', 'acc_cash', 'acc_bank', 300, null, '{"category":"Online Sale"}'::jsonb, null, null) as r`)).r;
ok(await bal('acc_cash') === 1000 && await bal('acc_bank') === 5300, 'no receipt yet: only the new account is credited', { r, cash: await bal('acc_cash'), bank: await bal('acc_bank') });
await q(`select pos_sync_order_effects('{"order_id":"sale_x","bill_number":"B1","date":"2026-10-23T10:00:00Z","payment_mode":"Online","paid_amount":300,"total":300,"account_id":"acc_cash","items":[]}'::jsonb)`);
ok(await bal('acc_cash') === 1000 && await bal('acc_bank') === 5300, 'late pos effects do not post the receipt again');
// normal case: receipt exists on the cash account
await db.exec(`insert into sales (id, bill_number, date, total, payment_mode, status, details)
  values ('sale_y', 'B2', now(), 200, 'Cash', 'Completed', '{"paid_amount": 200}')`);
await q(`select pos_sync_order_effects('{"order_id":"sale_y","bill_number":"B2","date":"2026-10-23T10:00:00Z","payment_mode":"Cash","paid_amount":200,"total":200,"account_id":"acc_cash","items":[]}'::jsonb)`);
ok(await bal('acc_cash') === 1200, 'pos effects credited cash');
await q(`select change_sale_payment_mode('sale_y', 'Online', 'acc_bank', 'acc_bank', 999, 'btx_sale_y', '{"category":"Online Sale"}'::jsonb,
  '{"id":"sce_1","business_day_id":"bd_1","drawer_id":"acc_cash","direction":"Out"}'::jsonb, null)`);
ok(await bal('acc_cash') === 1000 && await bal('acc_bank') === 5500, 'receipt exists: moves the receipt amount from its real account (client old/amount ignored)', { cash: await bal('acc_cash'), bank: await bal('acc_bank') });
ok((await one(`select account_id from bank_transactions where id = 'btx_sale_y'`)).account_id === 'acc_bank', 'receipt row moved');
ok(Number((await one(`select amount from shift_cash_events where id = 'sce_1'`)).amount) === 200, 'audit event carries the moved amount');
r = (await one(`select change_sale_payment_mode('sale_y', 'Online', 'acc_bank', 'acc_bank', 200, null, '{}'::jsonb, null, null) as r`)).r;
ok(r.unchanged === true && await bal('acc_bank') === 5500, 'retry is a no-op');
await q(`select change_sale_payment_mode('sale_y', 'Cash', null, 'acc_cash', 200, null, '{}'::jsonb, null, null)`);
ok(await bal('acc_cash') === 1200 && await bal('acc_bank') === 5300, 'and back again');
e = await err(`select change_sale_payment_mode('sale_y', 'Online', null, 'acc_nope', 200, null, '{}'::jsonb, null, null)`);
ok(e && e.includes('Naya account'), 'unknown new account refused', e);
ok(await bal('acc_cash') === 1200, 'refused change rolled back');

// 5b. post_customer_order_advance ---------------------------------------------------------------
console.log('\n[post_customer_order_advance]');
await db.exec(`insert into customer_orders (id, order_number, customer_id, customer_name, fulfillment, due_date, items, subtotal, total, created_by, advance_paid, payment_mode)
  values ('co_1', 'CO-1', 'cust_1', 'Ali', 'Pickup', current_date, '[{"itemId":"item_milk","qty":5,"price":200}]', 1000, 1000, 'user_a', 500, 'Cash')`);
let o = (await one(`select (post_customer_order_advance('co_1', 'ctx_adv_co_1_50000', 'acc_cash')).advance_posted as advance_posted`));
ok(Number(o.advance_posted) === 500 && await bal('acc_cash') === 1700, 'advance 500 posted', { o, cash: await bal('acc_cash') });
await db.exec(`update customer_orders set advance_paid = 800 where id = 'co_1'`);
// stale client still thinks advance_paid = 500 and sends the old level id
o = (await one(`select (post_customer_order_advance('co_1', 'ctx_adv_co_1_50000', 'acc_cash')).advance_posted as advance_posted`));
ok(Number(o.advance_posted) === 800 && await bal('acc_cash') === 2000, 'stale client id: the extra 300 is still posted', { o, cash: await bal('acc_cash') });
ok(!!(await one(`select 1 x from customer_transactions where id = 'ctx_adv_co_1_80000' and amount = 300`)), 'server-derived id used');
ok(Number((await one(`select balance from customers where id = 'cust_1'`)).balance) === -800, 'khata credited 800 in total');
o = (await one(`select (post_customer_order_advance('co_1', 'whatever', 'acc_cash')).advance_posted as advance_posted`));
ok(Number(o.advance_posted) === 800 && await bal('acc_cash') === 2000, 'retry after success posts nothing');

// 6. sync_delivery_order --------------------------------------------------------------------
console.log('\n[sync_delivery_order]');
r = (await one(`select sync_delivery_order('secret-key', '{"order_id":"D-1","customer_name":"Bilal","customer_phone":"0300-1234567","order_total":"450.555","paid_amount":"100","payment_mode":"Credit","items":[{"name":"milk","qty":2}]}'::jsonb) as r`)).r;
ok(r.success === true, 'credit order now succeeds', r);
ok(Number(r.due_amount) === 350.56 && Number(r.order_total) === 450.56, 'amounts rounded', r);
const ctx = await one(`select * from customer_transactions where id = 'ctx_' || $1`, [r.sale_id]);
ok(ctx && ctx.details.mode === 'Credit Sale' && Number(ctx.amount) === 350.56, 'khata charge recorded with details', ctx);
ok(Number((await one(`select balance from customers where id = $1`, [r.customer_id])).balance) === 350.56, 'customer balance charged');
ok(Number((await one(`select stock from items where id = 'item_milk'`)).stock) === 98, 'stock deducted');
const btx = await one(`select * from bank_transactions where reference_id = $1`, [r.sale_id]);
ok(btx && btx.category === 'Delivery Cash Collection' && Number(btx.amount) === 100 && btx.account_id === 'acc_cash', 'receipt row has category / reference', btx);
r = (await one(`select sync_delivery_order('secret-key', '{"order_id":"D-1","order_total":450}'::jsonb) as r`)).r;
ok(r.duplicate === true, 'duplicate detected');
r = (await one(`select sync_delivery_order('secret-key', '{"order_id":"D-2","customer_name":"Bilal","order_total":100,"paid_amount":150,"payment_mode":"udhar"}'::jsonb) as r`)).r;
ok(r.success === true && Number(r.due_amount) === 0, 'overpaid credit order: due never negative', r);
r = (await one(`select sync_delivery_order('wrong', '{"order_id":"D-3"}'::jsonb) as r`)).r;
ok(r.success === false, 'bad key refused');
r = (await one(`select sync_delivery_order('secret-key', '{"order_id":"D-4","order_total":250,"payment_mode":"Online"}'::jsonb) as r`)).r;
ok(r.success === true && await bal('acc_bank') === 5550, 'online order credits the digital account', { r, bank: await bal('acc_bank') });
ok((await one(`select has_function_privilege('anon', 'public.sync_delivery_order(text, jsonb)', 'execute') as x`)).x === true, 'anon grant kept');

// 7. User admin self-escalation guards ---------------------------------------------------------
console.log('\n[user admin guards]');
await db.exec(`
  insert into app_roles (id, name, permissions) values ('role_manager', 'Manager', '["user_management","pos","sales"]');
  insert into app_users (id, name, username, role_id, permissions, pin_salt, pin_hash, auth_user_id) values
    ('user_m', 'Manager', 'manager', 'role_manager', '["reports","pos"]', 's', 'h', '33333333-3333-3333-3333-333333333333');
  grant usage on schema app_private to authenticated;
  alter table app_roles enable row level security;
  create policy app_roles_operator_read on app_roles for select to authenticated using ((select app_private.is_operator()));
`);
const asManager = `select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', false)`;
const asOwner = `select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false)`;
await db.exec(asManager);
ok((await one(`select app_update_user('user_m', '{"name":"Manager 2","role_id":"role_manager","is_active":true,"permissions":["pos","reports"]}'::jsonb) as r`)).r?.name === 'Manager 2', 'manager can edit own name while resending same role/perms (any order)');
e = await err(`select app_update_user('user_m', '{"permissions":["pos","reports","cash_control"]}'::jsonb)`);
ok(e && e.includes('khud nahi'), 'manager cannot add permissions to self', e);
e = await err(`select app_update_user('user_m', '{"role_id":"role_cashier"}'::jsonb)`);
ok(e && e.includes('khud nahi'), 'manager cannot change own role', e);
e = await err(`select app_update_user('user_m', '{"is_active":false}'::jsonb)`);
ok(e && e.includes('khud nahi'), 'manager cannot deactivate self', e);
ok((await one(`select app_update_user('user_b', '{"permissions":["pos","sales"]}'::jsonb) as r`)).r?.permissions?.length === 2, 'manager can still edit another user');
await db.exec(`set role authenticated`);
await db.exec(`update app_roles set permissions = '["user_management","pos","sales","everything"]' where id = 'role_manager'`);
await db.exec(`update app_roles set description = 'edited' where id = 'role_cashier'`);
await db.exec(`reset role`);
ok((await one(`select permissions from app_roles where id = 'role_manager'`)).permissions.length === 3, 'manager cannot edit the role they hold (RLS filters the row)');
ok((await one(`select description from app_roles where id = 'role_cashier'`)).description === 'edited', 'manager can edit other roles');
await db.exec(asOwner);
ok((await one(`select app_update_user('user_a', '{"permissions":["x"]}'::jsonb) as r`)).r?.id === 'user_a', 'super admin may still edit self');
await db.exec(`set role authenticated`);
await db.exec(`update app_roles set description = 'owner edit' where id = 'role_super_admin'`);
await db.exec(`reset role`);
ok((await one(`select description from app_roles where id = 'role_super_admin'`)).description === 'owner edit', 'super admin may edit own role');
await db.exec(`select set_config('request.jwt.claims', '', false)`);

// All-or-nothing money RPCs (2026-10-23) ------------------------------------------------------------
// Each function: happy path, the same id twice (no double posting), a failure in the middle leaves
// nothing posted, and a cashier without the right is refused.
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

const asCashier = `select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)`;
const asNobody = `select set_config('request.jwt.claims', '', false)`;
const custBal = async id => Number((await one(`select balance from customers where id = $1`, [id])).balance);
const supBal = async id => Number((await one(`select balance from suppliers where id = $1`, [id])).balance);
const manBal = async id => Number((await one(`select balance from manual_accounts where id = $1`, [id])).balance);
const stockOf = async id => Number((await one(`select stock from items where id = $1`, [id])).stock);
const count = async (sql, params) => (await one(`select count(*)::int c from (${sql}) x`, params)).c;
// Makes the last write of a flow fail, to prove the earlier writes roll back with it.
const failOn = async (table, when = 'true') => db.exec(`
  create or replace function public.zz_fail() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
  create trigger zz_fail before insert or update on public.${table} for each row when (${when}) execute function public.zz_fail();`);
const unfail = async table => db.exec(`drop trigger if exists zz_fail on public.${table}`);

console.log('\n[money rpc grants / helpers]');
for (const sig of [
  'public.process_sales_return(text, text, jsonb)', 'public.return_milk_purchase(text, text, jsonb)',
  'public.write_off_customer_balance(text, text, boolean)', 'public.settle_supplier_balance(text, text, boolean)',
  'public.update_expense(text, text, jsonb)', 'public.close_business_day(text, jsonb)',
  'public.post_journal_entry(text, jsonb)', 'public.record_bank_transaction_effects(jsonb)',
  'public.create_financial_account(jsonb)', 'public.record_daily_supply_effects(jsonb)',
]) {
  const g = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u`, [sig]);
  ok(g.a === false && g.u === true, `${sig.split('(')[0]}: authenticated only`, g);
}
ok((await one(`select has_function_privilege('authenticated', 'app_private.post_bank_tx(text, text, text, numeric, timestamptz, text, text, text, text, text, text, text, jsonb)', 'execute') x`)).x === false, 'posting helper not executable by authenticated');
await db.exec(asCashier);
ok((await one(`select app_private.can_perform('pos', 'create') x`)).x === true, 'can_perform: cashier has pos');
ok((await one(`select app_private.can_perform('expenses', 'edit') x`)).x === false, 'can_perform: cashier has no expenses');
await db.exec(asManager);
ok((await one(`select app_private.can_perform('reports', 'view') x`)).x === true, 'can_perform: user-level module grant');
ok((await one(`select app_private.can_perform('sales', 'delete') x`)).x === true, 'can_perform: role module grant');
await db.exec(asNobody);

// process_sales_return -------------------------------------------------------------------------
console.log('\n[process_sales_return]');
await db.exec(`
  insert into customers (id, name, balance) values ('cust_r', 'Return Cust', 600);
  insert into financial_accounts (id, name, type, balance) values ('acc_r', 'Return Till', 'Bank', 1000);
  insert into sales (id, bill_number, date, customer_id, subtotal, discount, total, payment_mode, status, items, details)
  values ('sale_r1', 'R1', now(), 'cust_r', 1000, 100, 900, 'Credit', 'Completed',
    '[{"itemId":"item_milk","name":"Milk","qty":5,"price":200}]', '{"paid_amount":300}');
`);
const retPayload = (o) => JSON.stringify({
  return_type: 'refund', restock_action: 'restock', return_reason: 'test', status: 'Returned',
  returned_items: [{ itemId: 'item_milk', name: 'Milk', qty: o.qty, price: 200, action: 'refund' }],
  stock_moves: [{ item_id: o.moveItem || 'item_milk', variant_id: null, delta: o.qty }],
  logs: [], refund_amount: o.refund,
  khata: o.khata ? { amount: o.khata, tx_id: 'ctx_ret_' + o.id, details: {} } : null,
  cash: o.cash ? { amount: o.cash, account_id: o.account || 'acc_r', btx_id: 'btx_ret_' + o.id, category: 'Sales Return', description: 'refund' } : null,
});
await db.exec(asOwner);
let stock0 = await stockOf('item_milk');
r = (await one(`select process_sales_return('sale_r1', 'ret_1', $1::jsonb) as r`, [retPayload({ id: 1, qty: 2, refund: 360, khata: 360 })])).r;
let sale = await one(`select status, refund_amount from sales where id = 'sale_r1'`);
ok(r.applied && sale.status === 'Partially Returned', 'status from the bill lines, not the client ("Returned" sent)', { r, sale });
ok(await custBal('cust_r') === 240 && await stockOf('item_milk') === stock0 + 2 && Number(sale.refund_amount) === 360, 'khata, stock and refund moved together');
r = (await one(`select process_sales_return('sale_r1', 'ret_1', $1::jsonb) as r`, [retPayload({ id: 1, qty: 2, refund: 360, khata: 360 })])).r;
ok(r.already_applied && await custBal('cust_r') === 240 && await stockOf('item_milk') === stock0 + 2, 'same return id twice: posted once');
e = await err(`select process_sales_return('sale_r1', 'ret_2', $1::jsonb)`, [retPayload({ id: 2, qty: 4, refund: 0 })]);
ok(e && e.includes('sirf 3'), 'qty above sold - returned refused', e);
e = await err(`select process_sales_return('sale_r1', 'ret_3', $1::jsonb)`, [retPayload({ id: 3, qty: 1, refund: 500, khata: 240, cash: 260 })]);
ok(e && e.includes('qeemat'), 'refund above the returned lines value refused', e);
e = await err(`select process_sales_return('sale_r1', 'ret_4', $1::jsonb)`, [retPayload({ id: 4, qty: 3, refund: 540, khata: 140, cash: 400 })]);
ok(e && e.includes('sirf Rs 300'), 'cash refund above money collected refused', e);
e = await err(`select process_sales_return('sale_r1', 'ret_5', $1::jsonb)`, [retPayload({ id: 5, qty: 3, refund: 540, khata: 240, cash: 300, account: 'acc_nope' })]);
ok(e && e.includes('nahi mila'), 'missing refund account fails at the last step', e);
ok(await custBal('cust_r') === 240 && await stockOf('item_milk') === stock0 + 2 && (await one(`select status from sales where id = 'sale_r1'`)).status === 'Partially Returned',
  'failure in the middle: stock, khata and bill untouched');
e = await err(`select process_sales_return('sale_r1', 'ret_6', $1::jsonb)`, [retPayload({ id: 6, qty: 1, refund: 0, moveItem: 'item_gone' })]);
ok(e && e.includes('item_gone'), 'stock move on an unknown item refused', e);
r = (await one(`select process_sales_return('sale_r1', 'ret_7', $1::jsonb) as r`, [retPayload({ id: 7, qty: 3, refund: 540, khata: 240, cash: 300 })])).r;
ok(r.status === 'Returned' && await bal('acc_r') === 700 && await custBal('cust_r') === 0, 'rest returned: Returned, cash out of the till, khata cleared', { r, acc: await bal('acc_r') });
await db.exec(asCashier);
e = await err(`select process_sales_return('sale_r1', 'ret_8', $1::jsonb)`, [retPayload({ id: 8, qty: 1, refund: 0 })]);
ok(e && e.includes('ijazat'), 'cashier without sales_history:return refused', e);
await db.exec(asNobody);

// return_milk_purchase ---------------------------------------------------------------------------
console.log('\n[return_milk_purchase]');
await db.exec(`
  insert into suppliers (id, name, balance) values ('sup_r', 'Gawala R', 6000);
  insert into financial_accounts (id, name, type, balance) values ('acc_r2', 'Pay Till', 'Cash', 1000);
  insert into purchases (id, supplier_id, date, milk_type, quantity, rate, total_amount, status, details)
  values ('pur_r1', 'sup_r', now(), 'Buffalo', 100, 100, 10000, 'Completed', '{"paid_amount":4000,"due_amount":6000,"account_id":"acc_r2"}');
  insert into allocations (id, purchase_id, original_quantity, remaining_quantity, allocated_quantity, status)
  values ('alloc_pur_r1', 'pur_r1', 100, 100, 0, 'Unallocated');
`);
const milkRet = (qty, as = 'cash') => JSON.stringify({ return_qty: qty, reason: 'Khatta', refund_as: as });
await db.exec(asOwner);
r = (await one(`select return_milk_purchase('pur_r1', 'mr_1', $1::jsonb) as r`, [milkRet(30)])).r;
let pur = await one(`select quantity, total_amount, details from purchases where id = 'pur_r1'`);
ok(r.applied && Number(pur.quantity) === 70 && Number(pur.total_amount) === 7000 && Number(pur.details.paid_amount) === 2800 && Number(pur.details.due_amount) === 4200,
  '30 L back: intake 70 L, paid share 2800, due 4200', { r, pur });
ok(await bal('acc_r2') === 2200 && await supBal('sup_r') === 4200, 'refund 1200 back on the paying account, khata down 1800', { acc: await bal('acc_r2'), sup: await supBal('sup_r') });
ok(Number((await one(`select remaining_quantity from allocations where id = 'alloc_pur_r1'`)).remaining_quantity) === 70, 'milk pool follows');
ok(await count(`select 1 from supplier_transactions where id = 'stx_ret_mr_1' and amount = 3000`) === 1 && await count(`select 1 from bank_transactions where id = 'btx_purret_mr_1' and amount = 1200`) === 1, 'supplier ledger and bank row written');
r = (await one(`select return_milk_purchase('pur_r1', 'mr_1', $1::jsonb) as r`, [milkRet(30)])).r;
ok(r.already_applied && await bal('acc_r2') === 2200 && Number((await one(`select quantity from purchases where id = 'pur_r1'`)).quantity) === 70, 'same return id twice: posted once');
await db.exec(`update allocations set remaining_quantity = 10 where id = 'alloc_pur_r1'`);
e = await err(`select return_milk_purchase('pur_r1', 'mr_2', $1::jsonb)`, [milkRet(20)]);
ok(e && e.includes('sirf 10'), 'allocated milk cannot go back', e);
await db.exec(`update allocations set remaining_quantity = 70 where id = 'alloc_pur_r1'`);
await failOn('inventory_logs');
e = await err(`select return_milk_purchase('pur_r1', 'mr_3', $1::jsonb)`, [milkRet(null)]);
await unfail('inventory_logs');
pur = await one(`select status, quantity from purchases where id = 'pur_r1'`);
ok(e && e.includes('injected') && pur.status === 'Completed' && Number(pur.quantity) === 70 && await bal('acc_r2') === 2200 && await supBal('sup_r') === 4200
  && await count(`select 1 from allocations where id = 'alloc_pur_r1'`) === 1, 'failure at the last step: intake, pool, refund and khata untouched', { e, pur });
await db.exec(asCashier);
e = await err(`select return_milk_purchase('pur_r1', 'mr_4', $1::jsonb)`, [milkRet(5)]);
ok(e && e.includes('ijazat'), 'cashier without purchase:delete refused', e);
await db.exec(asOwner);
r = (await one(`select return_milk_purchase('pur_r1', 'mr_5', $1::jsonb) as r`, [milkRet(null, 'khata')])).r;
ok(r.is_full && (await one(`select status from purchases where id = 'pur_r1'`)).status === 'Returned' && await supBal('sup_r') === -2800
  && await count(`select 1 from allocations where id = 'alloc_pur_r1'`) === 0 && await bal('acc_r2') === 2200, 'full return to khata: Returned, pool row gone, no cash', r);
e = await err(`select return_milk_purchase('pur_r1', 'mr_6', $1::jsonb)`, [milkRet(1)]);
ok(e && e.includes('poori wapas'), 'returned intake refused');
await db.exec(asNobody);

// write_off_customer_balance / settle_supplier_balance --------------------------------------------
console.log('\n[write_off_customer_balance]');
await db.exec(`insert into customers (id, name, balance) values ('cust_w', 'Owes', 500), ('cust_w2', 'Advance', -200), ('cust_w3', 'Fail', 50);`);
await db.exec(asOwner);
r = (await one(`select write_off_customer_balance('cust_w', 'wo1') as r`)).r;
let cust = await one(`select balance, is_active from customers where id = 'cust_w'`);
ok(r.kind === 'bad_debt' && Number(cust.balance) === 0 && cust.is_active === false, 'bad debt written off and customer archived', { r, cust });
const woExp = await one(`select amount, details from expenses where id = 'exp_wo_wo1'`);
ok(Number(woExp.amount) === 500 && woExp.details.payment_mode === 'Adjustment' && await count(`select 1 from customer_transactions where id = 'ctx_wo_wo1' and amount = 500`) === 1, 'khata row and non-cash expense written');
r = (await one(`select write_off_customer_balance('cust_w', 'wo1') as r`)).r;
ok(r.already_applied && await count(`select 1 from expenses where id like 'exp_wo_%'`) === 1, 'same write-off id twice: posted once');
r = (await one(`select write_off_customer_balance('cust_w2', 'wo2') as r`)).r;
ok(r.kind === 'advance_forfeit' && await custBal('cust_w2') === 0, 'advance forfeited with a Charge', r);
await failOn('customers', 'new.is_active = false');
e = await err(`select write_off_customer_balance('cust_w3', 'wo3')`);
await unfail('customers');
ok(e && e.includes('injected') && await custBal('cust_w3') === 50 && await count(`select 1 from customer_transactions where id = 'ctx_wo_wo3'`) === 0
  && await count(`select 1 from expenses where id = 'exp_wo_wo3'`) === 0, 'failure at the last step: no khata row, no expense, balance kept', e);
await db.exec(asCashier);
e = await err(`select write_off_customer_balance('cust_w3', 'wo4')`);
ok(e && e.includes('ijazat') && await custBal('cust_w3') === 50, 'cashier without customers:delete refused', e);

console.log('\n[settle_supplier_balance]');
await db.exec(asNobody);
await db.exec(`insert into suppliers (id, name, balance) values ('sup_s', 'Owed', 700), ('sup_s2', 'Advance', -150), ('sup_s3', 'Fail', 90);`);
await db.exec(asOwner);
r = (await one(`select settle_supplier_balance('sup_s', 'st1') as r`)).r;
let sup = await one(`select balance, is_active from suppliers where id = 'sup_s'`);
ok(r.kind === 'waiver' && Number(sup.balance) === 0 && sup.is_active === false && await count(`select 1 from supplier_transactions where id = 'stx_wo_st1' and type = 'Payment' and (details->>'waiver')::boolean`) === 1,
  'payable settled by a waiver and supplier archived', { r, sup });
r = (await one(`select settle_supplier_balance('sup_s', 'st1') as r`)).r;
ok(r.already_applied && await count(`select 1 from supplier_transactions where supplier_id = 'sup_s'`) === 1, 'same settle id twice: posted once');
r = (await one(`select settle_supplier_balance('sup_s2', 'st2') as r`)).r;
ok(r.kind === 'advance_written_off' && await supBal('sup_s2') === 0, 'advance written off with a Charge', r);
await failOn('suppliers', 'new.is_active = false');
e = await err(`select settle_supplier_balance('sup_s3', 'st3')`);
await unfail('suppliers');
ok(e && e.includes('injected') && await supBal('sup_s3') === 90 && await count(`select 1 from supplier_transactions where id = 'stx_wo_st3'`) === 0, 'failure at the last step: nothing settled', e);
await db.exec(asCashier);
e = await err(`select settle_supplier_balance('sup_s3', 'st4')`);
ok(e && e.includes('ijazat'), 'cashier without suppliers:delete refused', e);
await db.exec(asNobody);

// update_expense -----------------------------------------------------------------------------------
console.log('\n[update_expense]');
await db.exec(`
  insert into expense_vendors (id, name, details) values ('ven_1', 'Bijli', '{"pending_balance":0,"total_billed":1000,"total_paid":1000}');
  insert into financial_accounts (id, name, type, balance) values ('acc_e1', 'Exp Bank 1', 'Bank', 4000), ('acc_e2', 'Exp Bank 2', 'Bank', 2000);
  -- What record_expense_effects leaves for a paid Rs 1000 bill from acc_e1.
  insert into expenses (id, date, category, amount, description, details) values ('exp_t1', '2026-10-22T10:00:00Z', 'Bills', 1000, 'Bill',
    '{"expense_id":"exp_t1","amount":1000,"paid_amount":1000,"payment_status":"Paid","account_id":"acc_e1","vendor_id":"ven_1","vendor_name":"Bijli","paidAmount":1000}');
  insert into bank_transactions (id, account_id, amount, date, type, category, reference_id) values ('btx_exp_t1', 'acc_e1', 1000, '2026-10-22T10:00:00Z', 'Expense', 'Bills', 'exp_t1');
`);
const venStats = async () => (await one(`select details from expense_vendors where id = 'ven_1'`)).details;
const expEdit = (o) => JSON.stringify({ date: '2026-10-22T10:00:00Z', category: 'Bills', amount: o.amount, paid_amount: o.paid, payment_status: o.status, description: 'Bill', account_id: o.account, account_name: 'x', vendor_id: 'ven_1', vendor_name: 'Bijli', paidAmount: 999 });
await db.exec(asOwner);
r = (await one(`select update_expense('exp_t1', 'ed1', $1::jsonb) as r`, [expEdit({ amount: 1500, paid: 500, status: 'Partial', account: 'acc_e2' })])).r;
let ven = await venStats();
ok(r.payment_status === 'Partial' && await bal('acc_e1') === 5000 && await bal('acc_e2') === 1500, 'old payment back on acc_e1, new 500 from acc_e2', { r, e1: await bal('acc_e1'), e2: await bal('acc_e2') });
ok(Number(ven.pending_balance) === 1000 && Number(ven.total_billed) === 1500 && Number(ven.total_paid) === 500, 'vendor figures swapped', ven);
ok((await one(`select account_id, amount from bank_transactions where id = 'btx_exp_t1'`)).account_id === 'acc_e2' && r.details.paidAmount === undefined, 'one bank row on the new account; stale camelCase dropped', r.details);
r = (await one(`select update_expense('exp_t1', 'ed1', $1::jsonb) as r`, [expEdit({ amount: 1500, paid: 500, status: 'Partial', account: 'acc_e2' })])).r;
ok(r.already_applied && await bal('acc_e2') === 1500 && Number((await venStats()).total_billed) === 1500, 'same edit id twice: moved once');
e = await err(`select update_expense('exp_t1', 'ed2', $1::jsonb)`, [expEdit({ amount: 800, paid: 800, status: 'Paid', account: 'acc_missing' })]);
ven = await venStats();
ok(e && e.includes('acc_missing') && await bal('acc_e2') === 1500 && Number((await one(`select amount from expenses where id = 'exp_t1'`)).amount) === 1500
  && Number(ven.total_billed) === 1500 && (await one(`select account_id from bank_transactions where id = 'btx_exp_t1'`)).account_id === 'acc_e2',
  'missing new account fails at the last step: old payment, vendor and voucher untouched', { e, ven });
e = await err(`select update_expense('exp_t1', 'ed3', $1::jsonb)`, [expEdit({ amount: 100, paid: 200, status: 'Paid', account: 'acc_e2' })]);
ok(e && e.includes('zyada'), 'paid above the amount refused', e);
await db.exec(asCashier);
e = await err(`select update_expense('exp_t1', 'ed4', $1::jsonb)`, [expEdit({ amount: 10, paid: 0, status: 'Unpaid', account: null })]);
ok(e && e.includes('ijazat') && await bal('acc_e2') === 1500, 'cashier without expenses:edit refused', e);
await db.exec(asNobody);

// close_business_day ------------------------------------------------------------------------------
console.log('\n[close_business_day]');
await db.exec(`
  insert into business_days (id, business_date, status, summary) values ('bd_t', '2026-10-20', 'Open', '{"cash":{"counted":1}}'), ('bd_t2', '2026-10-19', 'Open', '{}');
  insert into cash_shifts (id, business_day_id, business_date, drawer_id, user_id, user_name, status) values ('sh_t', 'bd_t', '2026-10-20', 'acc_cash', 'user_b', 'Cashier', 'Active');
  insert into drawer_handovers (id, business_day_id, drawer_id, from_user_id, from_user_name, declared_amount, status) values
    ('ho_t', 'bd_t', 'acc_cash', 'user_b', 'Cashier', 500, 'Pending'), ('ho_t2', 'bd_t2', 'acc_cash', 'user_b', 'Cashier', 300, 'Pending');
`);
await db.exec(asManager);
e = await err(`select close_business_day('bd_t', '{"notes":"x"}'::jsonb)`);
ok(e && e.includes('1 shift') && (await one(`select status from business_days where id = 'bd_t'`)).status === 'Open', 'open shift on the server blocks the close', e);
await db.exec(`update cash_shifts set status = 'Closed' where id = 'sh_t'`);
r = (await one(`select close_business_day('bd_t', '{"notes":"done","summary":{"gross_sales":10}}'::jsonb) as r`)).r;
let day = await one(`select status, closed_by, summary from business_days where id = 'bd_t'`);
const ho = await one(`select status, accepted_by_user_id from drawer_handovers where id = 'ho_t'`);
ok(r.closed && day.status === 'Closed' && day.closed_by === 'user_m' && day.summary.cash?.counted === 1 && day.summary.gross_sales === 10, 'day closed; earlier cash closing kept', { r, day });
ok(ho.status === 'Accepted' && ho.accepted_by_user_id === 'user_m' && r.handovers_accepted === 1, 'pending handover accepted with the close', ho);
r = (await one(`select close_business_day('bd_t', '{}'::jsonb) as r`)).r;
ok(r.already_closed === true, 'second close: already_closed');
await failOn('day_closings');
e = await err(`select close_business_day('bd_t2', '{"cash_close":{"counted":5}}'::jsonb)`);
await unfail('day_closings');
ok(e && e.includes('injected') && (await one(`select status from business_days where id = 'bd_t2'`)).status === 'Open'
  && (await one(`select status from drawer_handovers where id = 'ho_t2'`)).status === 'Pending', 'failure at the snapshot: day stays open, handover stays pending', e);
r = (await one(`select close_business_day('bd_t2', '{"cash_close":{"counted":5}}'::jsonb) as r`)).r;
ok(r.closed && (await one(`select details from day_closings where id = 'eod_bd_t2'`)).details.counted === 5, 'Z-report written with the close');
await db.exec(asCashier);
await db.exec(`update business_days set status = 'Open' where id = 'bd_t2'`);
e = await err(`select close_business_day('bd_t2', '{}'::jsonb)`);
ok(e && e.includes('ijazat') && (await one(`select status from business_days where id = 'bd_t2'`)).status === 'Open', 'cashier cannot close the day', e);
await db.exec(asNobody);
await db.exec(`update business_days set status = 'Closed' where id = 'bd_t2'`);

// post_journal_entry / record_bank_transaction_effects ---------------------------------------------
console.log('\n[post_journal_entry]');
await db.exec(`
  insert into manual_accounts (id, name, type, balance) values ('ma_cap', 'Owner Capital', 'Equity', 0), ('ma_rent', 'Rent', 'Expense', 0), ('ma_loan', 'Loan', 'Liability', 0);
  insert into financial_accounts (id, name, type, balance) values ('acc_j', 'Journal Bank', 'Bank', 0);
`);
const je = (lines, date = '2026-10-22T09:00:00Z') => JSON.stringify({ date, narration: 'test', referenceNo: 'JV-1', lines });
await db.exec(asOwner);
r = (await one(`select post_journal_entry('je_1', $1::jsonb) as r`, [je([{ account_id: 'acc_j', debit: 1000, credit: 0 }, { account_id: 'ma_cap', debit: 0, credit: 1000 }])])).r;
ok(r.applied && await bal('acc_j') === 1000 && await manBal('ma_cap') === 1000 && await count(`select 1 from bank_transactions where id = 'btx_je_1_0' and type = 'Deposit'`) === 1,
  'capital in: bank +1000 with its row, equity credit raises capital', r);
r = (await one(`select post_journal_entry('je_1', $1::jsonb) as r`, [je([{ account_id: 'acc_j', debit: 1000, credit: 0 }, { account_id: 'ma_cap', debit: 0, credit: 1000 }])])).r;
ok(r.already_applied && await bal('acc_j') === 1000 && await manBal('ma_cap') === 1000, 'same voucher id twice: posted once');
e = await err(`select post_journal_entry('je_2', $1::jsonb)`, [je([{ account_id: 'ma_rent', debit: 300, credit: 0 }, { account_id: 'acc_j', debit: 0, credit: 200 }])]);
ok(e && e.includes('unbalance'), 'unbalanced voucher refused', e);
e = await err(`select post_journal_entry('je_3', $1::jsonb)`, [je([{ account_id: 'ma_rent', debit: 300, credit: 0 }, { account_id: 'acc_j', debit: 0, credit: 200 }, { account_id: 'cust_r', debit: 0, credit: 100 }])]);
ok(e && e.includes('cust_r') && await manBal('ma_rent') === 0 && await bal('acc_j') === 1000 && await count(`select 1 from journal_entries where id = 'je_3'`) === 0,
  'unknown account on line 3: lines 1-2 rolled back, no voucher', e);
e = await err(`select post_journal_entry('je_4', $1::jsonb)`, [je([{ account_id: 'ma_rent', debit: 50, credit: 0 }, { account_id: 'acc_j', debit: 0, credit: 50 }], '2026-10-20T09:00:00Z')]);
ok(e && e.includes('band'), 'voucher dated on a locked day refused', e);
await db.exec(`update app_settings set security = '{"lockDate":"2026-10-21"}' where id = 'global_settings'`);
e = await err(`select post_journal_entry('je_5', $1::jsonb)`, [je([{ account_id: 'ma_rent', debit: 50, credit: 0 }, { account_id: 'acc_j', debit: 0, credit: 50 }], '2026-10-21T09:00:00Z')]);
ok(e && e.includes('Books 2026-10-21'), 'voucher inside the closed books refused', e);
await db.exec(`update app_settings set security = '{}' where id = 'global_settings'`);
await db.exec(asCashier);
e = await err(`select post_journal_entry('je_6', $1::jsonb)`, [je([{ account_id: 'ma_rent', debit: 50, credit: 0 }, { account_id: 'acc_j', debit: 0, credit: 50 }])]);
ok(e && e.includes('ijazat'), 'cashier without accounts:create refused', e);

console.log('\n[record_bank_transaction_effects]');
const bankEntry = (o) => JSON.stringify({ id: o.id, account_id: o.account || 'acc_j', type: o.type, amount: o.amount, date: o.date || '2026-10-22T11:00:00Z', category: 'x', description: 'y', related_account_id: o.contra });
await db.exec(asOwner);
r = (await one(`select record_bank_transaction_effects($1::jsonb) as r`, [bankEntry({ id: 'btx_be1', type: 'Deposit', amount: 500, contra: 'ma_cap' })])).r;
ok(await bal('acc_j') === 1500 && await manBal('ma_cap') === 1500 && Number(r.related_account_balance) === 1500, 'deposit with capital: both sides moved as deltas', r);
await db.exec(`update manual_accounts set balance = balance + 250 where id = 'ma_cap'`); // a posting from another device
r = (await one(`select record_bank_transaction_effects($1::jsonb) as r`, [bankEntry({ id: 'btx_be2', type: 'Withdrawal', amount: 200, contra: 'ma_cap' })])).r;
ok(await bal('acc_j') === 1300 && await manBal('ma_cap') === 1550, 'withdrawal against capital keeps the other device\'s posting (no lost update)', { j: await bal('acc_j'), cap: await manBal('ma_cap') });
r = (await one(`select record_bank_transaction_effects($1::jsonb) as r`, [bankEntry({ id: 'btx_be3', type: 'Deposit', amount: 400, contra: 'ma_loan' })])).r;
ok(await manBal('ma_loan') === 400, 'loan received: liability rises');
r = (await one(`select record_bank_transaction_effects($1::jsonb) as r`, [bankEntry({ id: 'btx_be3', type: 'Deposit', amount: 400, contra: 'ma_loan' })])).r;
ok(r.already_applied && await bal('acc_j') === 1700 && await manBal('ma_loan') === 400, 'same entry id twice: posted once');
await failOn('manual_accounts', `new.id = 'ma_loan'`);
e = await err(`select record_bank_transaction_effects($1::jsonb)`, [bankEntry({ id: 'btx_be4', type: 'Withdrawal', amount: 100, contra: 'ma_loan' })]);
await unfail('manual_accounts');
ok(e && e.includes('injected') && await bal('acc_j') === 1700 && await count(`select 1 from bank_transactions where id = 'btx_be4'`) === 0, 'contra fails: bank side rolled back too', e);
e = await err(`select record_bank_transaction_effects($1::jsonb)`, [bankEntry({ id: 'btx_be5', type: 'Deposit', amount: 100, contra: 'ma_cap', date: '2026-10-20T11:00:00Z' })]);
ok(e && e.includes('band'), 'entry on a locked day refused', e);
e = await err(`select record_bank_transaction_effects($1::jsonb)`, [bankEntry({ id: 'btx_be6', type: 'Transfer_In', amount: 100 })]);
ok(e && e.includes('Transfer'), 'transfers go through transfer_between_accounts', e);
await db.exec(asCashier);
e = await err(`select record_bank_transaction_effects($1::jsonb)`, [bankEntry({ id: 'btx_be7', type: 'Deposit', amount: 100 })]);
ok(e && e.includes('ijazat'), 'cashier without bank_cash:create refused', e);
await db.exec(asNobody);

// create_financial_account -------------------------------------------------------------------------
console.log('\n[create_financial_account]');
await db.exec(asOwner);
r = (await one(`select create_financial_account('{"id":"acc_new","name":"Shop Cash","type":"Cash","opening_balance":2500,"details":{"isDrawer":true}}'::jsonb) as r`)).r;
ok(r.applied && await bal('acc_new') === 2500 && await count(`select 1 from bank_transactions where id = 'btx_op_acc_new' and type = 'Deposit' and amount = 2500`) === 1, 'account opens through its ledger row', r);
ok(await count(`select 1 from cash_drawers where id = 'acc_new'`) === 1, 'cash account gets its drawer');
r = (await one(`select create_financial_account('{"id":"acc_new","name":"Shop Cash","type":"Cash","opening_balance":2500}'::jsonb) as r`)).r;
ok(r.already_applied && await bal('acc_new') === 2500 && await count(`select 1 from bank_transactions where account_id = 'acc_new'`) === 1, 'same account id twice: opened once');
await db.exec(`insert into bank_transactions (id, account_id, amount, type) values ('btx_op_acc_new2', 'acc_j', 1, 'Deposit')`);
e = await err(`select create_financial_account('{"id":"acc_new2","name":"Clash","type":"Bank","opening_balance":100}'::jsonb)`);
ok(e && await count(`select 1 from financial_accounts where id = 'acc_new2'`) === 0, 'opening row fails: no account without its ledger', e);
await db.exec(`delete from bank_transactions where id = 'btx_op_acc_new2'`);
e = await err(`select create_financial_account('{"id":"acc_new3","name":"Odd","type":"Crypto"}'::jsonb)`);
ok(e && e.includes('Cash, Bank ya Wallet'), 'unknown account type refused', e);
await db.exec(asCashier);
e = await err(`select create_financial_account('{"id":"acc_new4","name":"Mine","type":"Bank","opening_balance":100}'::jsonb)`);
ok(e && e.includes('ijazat') && await count(`select 1 from financial_accounts where id = 'acc_new4'`) === 0, 'cashier cannot open accounts', e);
await db.exec(asNobody);

// record_daily_supply_effects ----------------------------------------------------------------------
console.log('\n[record_daily_supply_effects]');
await db.exec(`
  insert into customers (id, name, balance) values ('cust_d1', 'Hotel', 0);
  insert into financial_accounts (id, name, type, balance) values ('acc_d', 'Route Cash', 'Cash', 0);
`);
const supply = (entries, account = 'acc_d') => JSON.stringify({ account_id: account, drawer_account_ids: ['acc_d'], shift_session_id: 'sh_x', drawer_id: 'acc_d', entries });
const batch1 = supply([
  { id: 'ds_1', date: '2026-10-22T06:00:00Z', customer_id: 'cust_d1', total_amount: 500, details: { payment_received: 200, customer_name: 'Hotel' } },
  { id: 'ds_2', date: '2026-10-22T06:00:00Z', customer_id: 'cust_d1', total_amount: 400, details: { status: 'Pending' } },
]);
await db.exec(asOwner);
r = (await one(`select record_daily_supply_effects($1::jsonb) as r`, [batch1])).r;
ok(r.applied === 2 && await custBal('cust_d1') === 300 && await bal('acc_d') === 200, 'due on the khata, cash in the route account, pending entry has no effect', r);
ok(await count(`select 1 from customer_transactions where id = 'ctx_ds_ds_1' and amount = 300`) === 1 && await count(`select 1 from bank_transactions where id = 'btx_ds_ds_1' and shift_session_id = 'sh_x'`) === 1, 'khata row and tagged receipt row written');
r = (await one(`select record_daily_supply_effects($1::jsonb) as r`, [batch1])).r;
ok(r.applied === 0 && r.already_applied === 2 && await custBal('cust_d1') === 300 && await bal('acc_d') === 200, 'same batch twice: posted once', r);
e = await err(`select record_daily_supply_effects($1::jsonb)`, [supply([
  { id: 'ds_3', date: '2026-10-22T06:00:00Z', customer_id: 'cust_d1', total_amount: 100, details: {} },
  { id: 'ds_4', date: '2026-10-22T06:00:00Z', customer_id: 'cust_missing', total_amount: 100, details: {} },
])]);
ok(e && e.includes('cust_missing') && await count(`select 1 from daily_supply where id = 'ds_3'`) === 0 && await custBal('cust_d1') === 300, 'entry 2 fails: entry 1 not saved either', e);
e = await err(`select record_daily_supply_effects($1::jsonb)`, [supply([{ id: 'ds_5', customer_id: 'cust_d1', total_amount: 100, details: { payment_received: 100 } }], null)]);
ok(e && e.includes('Cash account') && await count(`select 1 from daily_supply where id = 'ds_5'`) === 0, 'cash with no account refused', e);
await db.exec(asCashier);
e = await err(`select record_daily_supply_effects($1::jsonb)`, [supply([{ id: 'ds_6', customer_id: 'cust_d1', total_amount: 100, details: {} }])]);
ok(e && e.includes('ijazat'), 'cashier without customers:edit refused', e);
await db.exec(asNobody);

// app_roles: owner only ----------------------------------------------------------------------------
console.log('\n[app_roles owner only]');
await db.exec(`insert into app_roles (id, name) values ('role_procurement', 'Procurement') on conflict do nothing`);
await db.exec(asManager);
await db.exec(`set role authenticated`);
const managerUpdate = await q(`update app_roles set description = 'manager edit' where id = 'role_cashier' returning id`);
const managerInsert = await err(`insert into app_roles (id, name, permissions) values ('role_x', 'X', '["everything"]')`);
const managerDelete = await q(`delete from app_roles where id = 'role_procurement' returning id`);
await db.exec(`reset role`);
ok(managerUpdate.length === 0 && (await one(`select description from app_roles where id = 'role_cashier'`)).description === 'edited', 'user manager can no longer edit another role');
ok(managerInsert && managerInsert.includes('row-level security'), 'user manager cannot create a role', managerInsert);
ok(managerDelete.length === 0 && await count(`select 1 from app_roles where id = 'role_procurement'`) === 1, 'user manager cannot delete a role');
await db.exec(asOwner);
await db.exec(`set role authenticated`);
const ownerUpdate = await q(`update app_roles set description = 'owner edit 2' where id = 'role_cashier' returning id`);
const ownerInsert = await err(`insert into app_roles (id, name, permissions) values ('role_y', 'Y', '[]')`);
const ownerDelete = await q(`delete from app_roles where id = 'role_y' returning id`);
const ownerDeleteSelf = await q(`delete from app_roles where id = 'role_super_admin' returning id`);
await db.exec(`reset role`);
ok(ownerUpdate.length === 1 && ownerInsert === null && ownerDelete.length === 1, 'owner can create, edit and delete roles');
ok(ownerDeleteSelf.length === 0, 'the owner role itself cannot be deleted');
await db.exec(asNobody);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
