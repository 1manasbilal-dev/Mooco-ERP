// Checks 20261024110000_english_server_messages.sql on a PGlite copy of the live schema: every
// function it replaces keeps the same code (only string literals and comments differ), no function
// is left raising Roman Urdu, and a few refusals now read in English. Nothing here talks to Supabase.
//
//   node supabase/tests/pglite/english-messages.mjs <pglite dir> supabase/migrations supabase/tests/pglite
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
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const run = async (dir, name) => {
  try { await db.exec(file(dir, name)); console.log('applied ' + name); }
  catch (e) { console.log('ERROR applying ' + name + ': ' + e.message); process.exit(1); }
};

// Set-up: every migration the live functions come from, then the stock files, in repo order ------
await run(testDir, 'base_schema.sql');
await db.exec('set search_path = public, extensions');
// 20261019171000 sets a PostgREST hook on this Supabase role.
await db.exec('create role authenticator nologin');
for (const m of [
  '20261019120000_unit_pack_stock_fixes.sql',
  '20261019151000_change_sale_payment_mode.sql',
  '20261019152000_customer_order_advance_posting.sql',
  '20261019153000_atomic_sales_return.sql',
  '20261019154000_delete_supplier_transaction_effects.sql',
  '20261019170000_operator_auth_prep.sql',
  '20261019171000_operator_auth_lockdown.sql',
  '20261020130000_settings_security_and_approvals.sql',
  '20261021120000_audit_fixes.sql',
  '20261021130000_request_gate_401.sql',
]) await run(migDir, m);
await db.exec(`create trigger customer_order_validation before insert or update on public.customer_orders
  for each row execute function public.validate_customer_order();`);
await db.exec(`
  insert into app_roles (id, name, permissions) values ('role_super_admin', 'Super Admin', '[]'), ('role_cashier', 'Cashier', '["pos"]');
  insert into app_users (id, name, username, role_id, pin_salt, pin_hash, auth_user_id) values
    ('user_a', 'Owner', 'owner', 'role_super_admin', 's1', 'h1', '11111111-1111-1111-1111-111111111111'),
    ('user_b', 'Cashier', 'cashier', 'role_cashier', 's2', 'h2', '22222222-2222-2222-2222-222222222222');
  insert into financial_accounts (id, name, type, balance) values ('acc_cash', 'Main Cash', 'Cash', 1000), ('acc_bank', 'Bank', 'Bank', 5000);
  insert into customers (id, name, balance) values ('cust_1', 'Ali', 0);
  insert into app_settings (id, financial) values ('global_settings', '{"defaultCashAccountId": "acc_cash", "defaultDigitalAccountId": "acc_bank"}');
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
  '20261024100000_stock_inbound_helpers.sql',
  '20261024101000_material_purchase_rpcs.sql',
  '20261024102000_milk_allocation_rpcs.sql',
  '20261024103000_production_batch_rpcs.sql',
  '20261024104000_return_milk_purchase_no_raw_log.sql',
  '20261024105000_sale_line_stock_helper.sql',
  '20261024106000_pos_sync_stock_from_bill.sql',
  '20261024107000_sales_return_stock_from_bill.sql',
  '20261024108000_delivery_order_stock_rules.sql',
  '20261024109000_dayclose_count_every_pile.sql',
]) await run(migDir, m);
await run(testDir, 'live_only_functions.sql');

// The functions the new migration replaces, and their code before it ---------------------------
const MIGRATION = '20261024110000_english_server_messages.sql';
const names = [...file(migDir, MIGRATION).matchAll(/create or replace function\s+([\w.]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
const snapshot = async () => Object.fromEntries((await q(`
  select n.nspname || '.' || p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosrc,
         p.prosecdef, p.proconfig::text as config, p.provolatile, pg_get_function_result(p.oid) as result,
         coalesce(p.proacl::text, '') as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')`)).map((r) => [r.name + '(' + r.args + ')', r]));
const stripLiterals = (s) => s.replace(/\r/g, '').replace(/(?<![A-Za-z0-9_$])'((?:[^']|'')*)'/g, "''").replace(/--[^\n]*/g, '--');
const before = await snapshot();
const countBefore = Object.keys(before).length;

console.log('\n[apply]');
await run(migDir, MIGRATION);
await db.exec(file(migDir, MIGRATION));
ok(true, 'migration re-applies cleanly (CREATE OR REPLACE only)');
const after = await snapshot();
ok(Object.keys(after).length === countBefore, 'no function added or dropped', { before: countBefore, after: Object.keys(after).length });

console.log('\n[same code, same settings]');
ok(names.length === 44, '44 functions in the migration', names.length);
for (const name of names) {
  const keys = Object.keys(after).filter((k) => k.startsWith(name + '('));
  ok(keys.length === 1, `${name}: exactly one overload`, keys);
  const k = keys[0];
  const a = after[k];
  const b = before[k];
  if (!a || !b) { ok(false, `${name}: present before and after`); continue; }
  ok(a.prosrc !== b.prosrc && stripLiterals(a.prosrc) === stripLiterals(b.prosrc), `${name}: only text changed`);
  ok(a.prosecdef === b.prosecdef && a.config === b.config && a.provolatile === b.provolatile && a.result === b.result && a.acl === b.acl,
    `${name}: security, settings, result type and grants unchanged`, { before: [b.prosecdef, b.config, b.acl], after: [a.prosecdef, a.config, a.acl] });
}

console.log('\n[no Roman Urdu left]');
const ROMAN = /\m(nahi|hai|hain|karein|zaroori|chahiye|mojood|ijazat|raqam|baqi|udhaar|hisaab|wapas|wapsi|sirf|pehle|mila|hua|hui|sakta|sakti|koshish|dobara|mein|karne|badalne|ghalat|zyada|jagah|ulti|honi|hona|doodh|kharcha|kharche|miqdar|manfi)\M/;
const left = [];
for (const r of Object.values(after)) {
  for (const m of r.prosrc.matchAll(/(?<![A-Za-z0-9_$])'((?:[^']|'')*)'/g)) {
    if (new RegExp(ROMAN.source.replace(/\\m|\\M/g, '\\b'), 'i').test(m[1]) && /\s/.test(m[1])) left.push(r.name + ': ' + m[1]);
  }
}
ok(left.length === 0, 'no function has a Roman Urdu message', left);

console.log('\n[refusals read in English]');
const asCashier = `select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)`;
const asNobody = `select set_config('request.jwt.claims', '', false)`;
await db.exec(asNobody);
ok(await err(`select transfer_between_accounts('acc_cash', 'acc_cash', 10)`) === 'Source and destination accounts must be different.', 'transfer_between_accounts');
ok(await err(`select record_customer_payment_effects('', 'cust_1', 10, now()::text, 'Payment')`) === 'tx_id is required.', 'record_customer_payment_effects');
ok(await err(`select app_private.bank_tx_sign('Bogus')`) === 'Bank transaction type "Bogus" is not valid.', 'bank_tx_sign keeps its value in the message');
await db.exec(asCashier);
const denied = await err(`select app_private.assert_can('purchase', 'delete', 'return milk')`);
ok(denied === 'You do not have permission to return milk.', 'assert_can names the action in English', denied);
const fragment = await err(`select return_milk_purchase('pur_x', 'ret_x', '{}'::jsonb)`);
ok(fragment === 'You do not have permission to return milk.' || !new RegExp(ROMAN.source.replace(/\\m|\\M/g, '\\b'), 'i').test(fragment || ''), 'return_milk_purchase refusal is English', fragment);
await db.exec(asNobody);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
