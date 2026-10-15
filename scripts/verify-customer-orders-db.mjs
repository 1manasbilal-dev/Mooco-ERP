// Runs entirely in a temporary local Postgres (PGlite), never against Supabase.
// Install the temporary runtime with: npm install --prefix .qa-customer-orders --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
import { PGlite } from '../.qa-customer-orders/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const pg = new PGlite();
const checks = [];
await pg.exec(`
  create role anon; create role authenticated;
  create table customers(id text primary key,name text,phone text,address text,is_active boolean,balance numeric default 0);
  create table items(id text primary key,name text,is_active boolean,type text[],stock numeric,variant_stocks jsonb,variants jsonb,allow_loose_sale boolean);
  create table financial_accounts(id text primary key,type text,balance numeric default 0);
  create table business_days(id text primary key,status text,cash_closed_at timestamptz);
  create table cash_shifts(id text primary key,business_day_id text,business_date date,drawer_id text,user_id text,user_name text,status text);
  create table app_settings(id text primary key,settings jsonb,inventory jsonb);
  create table app_roles(id text primary key,permissions jsonb);
  create table sales(id text primary key,bill_number text,date timestamptz,customer_id text,customer_name text,subtotal numeric,discount numeric,total numeric,payment_mode text,status text,items jsonb,details jsonb,business_day_id text,shift_session_id text,drawer_id text,cashier_id text,cashier_name text);
  create table inventory_logs(id text primary key,date timestamptz,item_id text,item_name text,old_quantity numeric,new_quantity numeric,difference numeric,reason text,notes text);
  create table bank_transactions(id text primary key,account_id text,amount numeric,date timestamptz,type text,category text,description text,reference_id text,business_day_id text,shift_session_id text,drawer_id text,cashier_id text);
  create table customer_transactions(id text primary key,customer_id text,date timestamptz,type text,amount numeric,details jsonb);
  insert into customers values('c1','Test customer','03001234567','Test address',true,100);
  insert into items values('milk','Milk',true,array['Sale product'],20,'{"pack":8}', '[{"id":"pack","name":"1L bottle","isActive":true}]',true);
  insert into financial_accounts values('cash','Cash',1000),('bank','Bank',2000);
  insert into business_days values('day','Open',null);
  insert into cash_shifts values('shift','day',(now() at time zone 'Asia/Karachi')::date,'cash','cashier','Test cashier','Active');
  insert into app_settings values('global_settings',null,'{"allowNegativeStock":false}');
  insert into app_roles values('role_cashier','["pos"]'),('custom_role','["pos:view"]');
`);
await pg.exec(fs.readFileSync('scripts/fixtures/customer-orders-effects.sql','utf8'));
await pg.exec(fs.readFileSync('supabase/migrations/20261002153153_customer_orders.sql','utf8'));
await pg.exec(fs.readFileSync('supabase/migrations/20261003133000_day_lock_ignores_cash_close.sql','utf8'));
checks.push('Migration compiles in local Postgres with the existing financial RPCs');
const rows = async (sql, params = []) => (await pg.query(sql,params)).rows;
const insert = async (id, patch = {}) => {
  const value = { customer_id:'c1',customer_name:'Test customer',customer_phone:'03001234567',fulfillment:'Pickup',due_date:'2026-10-03',due_time:'09:00',address:'',notes:'QA only',items:[{itemId:'milk',name:'Milk',qty:2.5,price:200,unit:'L'},{itemId:'milk',name:'Milk',qty:2,price:250,unit:'Bottle',variantId:'pack',variantName:'1L bottle'}],subtotal:0,discount:50,total:0,status:'Pending',created_by:'cashier',...patch };
  const keys = ['id','order_number',...Object.keys(value)];
  const values = [id,`ORD-${id}`,...Object.values(value).map(v => typeof v==='object'?JSON.stringify(v):v)];
  return (await rows(`insert into customer_orders(${keys.join(',')}) values(${values.map((_,i)=>`$${i+1}`).join(',')}) returning *`,values))[0];
};
const snapshot = async () => ({
  customer: (await rows("select balance from customers where id='c1'"))[0].balance,
  cash: (await rows("select balance from financial_accounts where id='cash'"))[0].balance,
  item: (await rows("select stock,variant_stocks from items where id='milk'"))[0],
  sales: (await rows('select count(*)::int as count from sales'))[0].count,
  logs: (await rows('select count(*)::int as count from inventory_logs'))[0].count
});
const before = await snapshot();
const order = await insert('main');
assert.equal(Number(order.subtotal),1000); assert.equal(Number(order.total),950);
assert.deepEqual(await snapshot(),before);
checks.push('Booking computes totals and never changes stock, cash or khata');
const payload={payment_mode:'Cash',paid_amount:400,account_id:'cash',shift_session_id:'shift',cash_given:400,change_return:0};
const checkout = (id,revision,payloadValue=payload) => rows('select checkout_customer_order($1,$2,$3) as sale',[id,revision,JSON.stringify(payloadValue)]);
await assert.rejects(checkout('main',1),/Confirm this order/);
await rows("update customer_orders set status='Confirmed' where id='main' and revision=1");
await assert.rejects(checkout('main',1),/changed at another counter/);
await rows("update customer_orders set status='Ready' where id='main' and revision=2");
assert.equal((await rows("update customer_orders set notes='stale' where id='main' and revision=1 returning id")).length,0);
checks.push('Pending checkout is blocked; stale edits and checkout revisions are rejected');
const sale = (await checkout('main',3))[0].sale;
assert.equal(sale.id,'co_sale_main');assert.equal(Number(sale.details.paid_amount),400);assert.equal(Number(sale.details.due_amount),550);
const after = await snapshot();
assert.equal(Number(after.customer),650);assert.equal(Number(after.cash),1400);assert.equal(Number(after.item.stock),17.5);assert.equal(after.item.variant_stocks.pack,6);assert.equal(after.sales,1);assert.equal(after.logs,1);
assert.equal((await rows("select status from customer_orders where id='main'"))[0].status,'Completed');
checks.push('Checkout atomically posts loose/pack stock, cash, customer due and linked invoice');
const retry = (await checkout('main',3))[0].sale;
assert.equal(retry.id,sale.id); assert.deepEqual(await snapshot(),after);
await assert.rejects(rows("update customer_orders set notes='changed' where id='main'"),/cannot be changed/);
checks.push('Lost-response retry returns one invoice without duplicate effects; completed bookings are immutable');
await insert('cancelled'); await rows("update customer_orders set status='Cancelled' where id='cancelled'");
await assert.rejects(checkout('cancelled',2),/Cancelled orders/);
assert.deepEqual(await snapshot(),after);
checks.push('Cancellation retains the booking and posts no accounting effects');
await assert.rejects(insert('fractional',{items:[{itemId:'milk',name:'Milk',qty:1.5,price:100,unit:'Bottle',variantId:'pack'}]}),/whole numbers/);
await assert.rejects(insert('duplicate',{items:[{itemId:'milk',qty:1,price:100},{itemId:'milk',qty:2,price:100}]}),/duplicate/);
await assert.rejects(insert('invalid-delivery',{fulfillment:'Delivery'}),/violates check/);
checks.push('Fractional packs, duplicate lines and missing delivery address are rejected');
await insert('short-stock',{items:[{itemId:'milk',name:'Milk',qty:100,price:200,unit:'L'}]});await rows("update customer_orders set status='Confirmed' where id='short-stock'");
await assert.rejects(checkout('short-stock',2),/Insufficient stock/);
assert.deepEqual(await snapshot(),after);
checks.push('Future bookings can exceed current stock; checkout rejects shortages without partial writes');
await insert('account-failure');await rows("update customer_orders set status='Confirmed' where id='account-failure'");
await assert.rejects(checkout('account-failure',2,{...payload,account_id:'missing'}),/valid payment account/);
await rows("update cash_shifts set status='Closed' where id='shift'");
await assert.rejects(checkout('account-failure',2),/active cash shift/);
await rows("update cash_shifts set status='Active' where id='shift'");
await rows("update business_days set status='Closed' where id='day'");
await assert.rejects(checkout('account-failure',2),/business day is closed/);
await rows("update business_days set status='Open', cash_closed_at=now() where id='day'");
const checkoutDef = (await rows("select pg_get_functiondef('checkout_customer_order(text,integer,jsonb)'::regprocedure) as src"))[0].src;
assert.equal(checkoutDef.includes('cash_closed_at'), false);
await rows("update business_days set cash_closed_at=null where id='day'");
assert.deepEqual(await snapshot(),after);
checks.push('Invalid accounts and closed shifts block checkout; only a locked day blocks billing, not a cash closing record');
await pg.exec("create function qa_fail_customer_charge() returns trigger language plpgsql as $$ begin raise exception 'simulated ledger failure'; end $$; create trigger qa_fail_charge before insert on customer_transactions for each row execute function qa_fail_customer_charge();");
await assert.rejects(checkout('account-failure',2),/simulated ledger failure/);
assert.deepEqual(await snapshot(),after);assert.equal((await rows("select status from customer_orders where id='account-failure'"))[0].status,'Confirmed');
await pg.exec('drop trigger qa_fail_charge on customer_transactions; drop function qa_fail_customer_charge();');
checks.push('Failure after stock and cash work rolls back the entire sale and booking completion');
const policies=await rows("select count(*)::int as count from pg_policies where tablename='customer_orders'");assert.equal(policies[0].count,3);
assert.equal((await rows("select has_table_privilege('anon','customer_orders','DELETE') as allowed"))[0].allowed,false);
assert.equal((await rows("select permissions from app_roles where id='custom_role'"))[0].permissions[0],'pos:view');
checks.push('RLS is enabled, deletion is denied, and custom role permissions are preserved');
await insert('credit-partial');await rows("update customer_orders set status='Confirmed' where id='credit-partial'");
const partial=(await checkout('credit-partial',2,{...payload,payment_mode:'Credit',paid_amount:250}))[0].sale;
assert.equal(partial.payment_mode,'Cash');assert.equal(Number(partial.details.due_amount),700);
assert.equal((await rows("select category from bank_transactions where reference_id='co_sale_credit-partial'"))[0].category,'POS Sale');
checks.push('Cash contributed against a credit booking posts to cash custody and only the remainder enters khata');
await insert('online');await rows("update customer_orders set status='Confirmed' where id='online'");
const online=(await checkout('online',2,{...payload,payment_mode:'Online',paid_amount:950,account_id:'bank'}))[0].sale;
assert.equal(Number(online.details.due_amount),0);assert.equal(Number((await rows("select balance from financial_accounts where id='bank'"))[0].balance),2950);
checks.push('Fully paid online orders credit the selected bank with no customer due');
await pg.close();
console.log(JSON.stringify({passed:checks.length,checks},null,2));
