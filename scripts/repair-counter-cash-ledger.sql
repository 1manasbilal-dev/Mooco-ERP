-- One-off repair: make the Counter Cash statement (bank_transactions) add up to its stored balance.
-- Balances are NOT changed; only the missing / stale ledger rows are corrected.
--
-- Findings (2026-10-20), Counter Cash acc_1788155761454: balance - ledger = Rs 24,300.04
--   +23,700.04  4 cash sales whose cash reached the balance but never got a bank row
--   +   600.00  2 expenses deleted later: balance was restored, but their bank rows stayed
--               (deleteExpense filtered on a column that does not exist, so the delete failed)
--
-- Left as-is on purpose (books already agree with each other, they need a human decision):
--   * INV-260921-F3A214 credit bill: Rs 230 down payment never reached the balance or the ledger.
--   * btx_f6337655-...: Rs 10,820 receipt of a sale that was later deleted (INV-260919-8BD749).
--
-- Corrections are inserted rows (audit trail), not deletes. Run as one transaction; it aborts if
-- the account does not reconcile afterwards. Safe to re-run: every row has a fixed id.

begin;

insert into public.bank_transactions
  (id, date, created_at, account_id, amount, type, category, description, reference_id,
   business_day_id, shift_session_id, drawer_id, cashier_id)
select 'btx_' || s.id, s.date, s.date, 'acc_1788155761454', s.total, 'Income', 'POS Sale',
       'POS Cash Sale #' || s.bill_number || ' (ledger repair 2026-10-20)', s.id,
       s.business_day_id, s.shift_session_id, s.drawer_id, s.cashier_id
from public.sales s
where s.id in (
  'a2915265-a63b-4f7b-bc89-24b9df4194b2',  -- INV-260926-AH5000  5,000.04
  'c094bae1-e909-49fc-b0bd-664866ff2cea',  -- INV-260926-JB6200  6,200.00
  '1d98208d-2cc8-476e-a708-3820f215548c',  -- INV-260927-AH4600  4,600.00
  'fbdca5f3-cfdb-408a-97ef-9f0d3b840fe6'   -- INV-260927-JB7900  7,900.00
)
on conflict (id) do nothing;

insert into public.bank_transactions
  (id, date, created_at, account_id, amount, type, category, description, reference_id)
select 'btx_fix_' || b.reference_id, b.date, b.date, b.account_id, b.amount, 'Income', 'Ledger Correction',
       'Reverses bank row of deleted expense (' || b.description || ')', b.reference_id
from public.bank_transactions b
where b.id in (
  'btx_exp_b14de824-c43b-460a-bfd4-4bd0a497c91c',  -- 300.00, 2026-09-29
  'btx_exp_2f9ec7c3-5a45-45a7-8566-b12ca97dd998'   -- 300.00, 2026-10-10
)
and not exists (select 1 from public.expenses e where e.id = b.reference_id)
on conflict (id) do nothing;

do $$
declare
  v_gap numeric;
begin
  select round(a.balance - coalesce(sum(case when t.type in ('Deposit', 'Income', 'Transfer_In') then t.amount else -t.amount end), 0), 2)
    into v_gap
  from public.financial_accounts a
  left join public.bank_transactions t on t.account_id = a.id
  where a.id = 'acc_1788155761454'
  group by a.balance;
  if abs(v_gap) >= 0.01 then
    raise exception 'Counter Cash still off by Rs % — rolled back', v_gap;
  end if;
end
$$;

commit;
