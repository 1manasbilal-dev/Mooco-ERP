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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
