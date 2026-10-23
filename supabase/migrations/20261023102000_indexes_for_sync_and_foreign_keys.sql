-- Indexes for the app's sync reads and for every foreign key (2026-10-23).
--
-- The app downloads each ledger table page by page with ORDER BY <date> DESC [, id DESC]
-- LIMIT/OFFSET. Most of those tables had no index on the sort column, so every page was a full
-- scan plus a sort: bank_transactions alone saw 21k sequential scans reading 72M rows, and one
-- page (offset 4000) took ~100 ms with the sort spilling to disk. A (date DESC, id DESC) index
-- serves both orderings and lets each page stop after the rows it returns.
--
-- The advisor also lists 18 foreign keys without a covering index (0001). Where the app reads a
-- party's ledger, the FK index also carries the date so a khata/statement read is one range scan.
--
-- All tables are small (largest 19 MB), so plain CREATE INDEX holds its lock for well under a
-- second. Inside a migration transaction CONCURRENTLY is not available anyway.

-- 1. Sort columns of the paged sync reads ---------------------------------------------------
create index if not exists bank_transactions_date_desc_idx on public.bank_transactions (date desc, id desc);
create index if not exists inventory_logs_date_desc_idx on public.inventory_logs (date desc, id desc);
create index if not exists purchases_date_desc_idx on public.purchases (date desc, id desc);
create index if not exists expenses_date_desc_idx on public.expenses (date desc, id desc);
create index if not exists allocations_date_desc_idx on public.allocations (date desc, id desc);
create index if not exists customer_transactions_date_desc_idx on public.customer_transactions (date desc, id desc);
create index if not exists supplier_transactions_date_desc_idx on public.supplier_transactions (date desc, id desc);
create index if not exists material_purchases_date_desc_idx on public.material_purchases (date desc, id desc);
create index if not exists production_batches_start_date_desc_idx on public.production_batches (start_date desc, id desc);
create index if not exists cash_shifts_started_at_desc_idx on public.cash_shifts (started_at desc, id desc);
create index if not exists drawer_handovers_declared_at_desc_idx on public.drawer_handovers (declared_at desc, id desc);
create index if not exists cash_remittances_declared_at_desc_idx on public.cash_remittances (declared_at desc, id desc);
create index if not exists shift_cash_events_occurred_at_desc_idx on public.shift_cash_events (occurred_at desc, id desc);

-- 2. Foreign keys (advisor 0001) ------------------------------------------------------------
create index if not exists bank_transactions_account_date_idx on public.bank_transactions (account_id, date desc);
create index if not exists customer_transactions_customer_date_idx on public.customer_transactions (customer_id, date desc);
create index if not exists supplier_transactions_supplier_date_idx on public.supplier_transactions (supplier_id, date desc);
create index if not exists purchases_supplier_date_idx on public.purchases (supplier_id, date desc);
create index if not exists sales_customer_date_idx on public.sales (customer_id, date desc);
create index if not exists material_purchases_supplier_idx on public.material_purchases (supplier_id);
create index if not exists daily_supply_customer_idx on public.daily_supply (customer_id);
create index if not exists app_users_role_idx on public.app_users (role_id);
create index if not exists attendance_employee_idx on public.attendance (employee_id);
create index if not exists employee_transactions_employee_idx on public.employee_transactions (employee_id);
create index if not exists cash_remittances_drawer_idx on public.cash_remittances (drawer_id);
create index if not exists cash_remittances_shift_idx on public.cash_remittances (shift_id);
create index if not exists cash_variances_shift_idx on public.cash_variances (shift_id);
create index if not exists cash_variances_handover_idx on public.cash_variances (handover_id);
create index if not exists cash_variances_remittance_idx on public.cash_variances (remittance_id);
create index if not exists drawer_handovers_from_shift_idx on public.drawer_handovers (from_shift_id);
create index if not exists drawer_handovers_to_shift_idx on public.drawer_handovers (to_shift_id);
create index if not exists shift_cash_events_drawer_idx on public.shift_cash_events (drawer_id);

-- 3. Cash drawer sync trigger: only when the account's identity changes ----------------------
-- trg_sync_cash_drawer_from_account fired on every financial_accounts UPDATE, so each sale,
-- payment or expense that moved a balance also rewrote (and row-locked) the cash_drawers row.
-- Balance-only updates now skip it; inserts, deletes and changes of name / type / active flag
-- behave exactly as before. Every Cash account already has its drawer row.
drop trigger if exists trg_sync_cash_drawer_from_account on public.financial_accounts;

create trigger trg_sync_cash_drawer_from_account
  after insert or delete on public.financial_accounts
  for each row execute function public.sync_cash_drawer_from_account();

create trigger trg_sync_cash_drawer_from_account_update
  after update on public.financial_accounts
  for each row
  when (old.id is distinct from new.id
        or old.name is distinct from new.name
        or old.type is distinct from new.type
        or old.is_active is distinct from new.is_active)
  execute function public.sync_cash_drawer_from_account();

analyze public.bank_transactions, public.inventory_logs, public.purchases, public.expenses,
  public.allocations, public.customer_transactions, public.supplier_transactions, public.sales;
