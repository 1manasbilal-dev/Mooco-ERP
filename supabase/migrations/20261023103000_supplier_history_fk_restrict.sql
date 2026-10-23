-- Deleting a supplier must not delete its books (2026-10-23).
--
-- purchases, material_purchases and supplier_transactions referenced suppliers ON DELETE
-- CASCADE. Deleting a supplier therefore silently deleted every milk purchase, material purchase
-- and payment of that supplier, while the matching bank_transactions, allocations and stock stayed,
-- leaving the cash book and stock with no source documents. The app already expects the
-- database to refuse (deleteSupplier shows "has purchase/ledger history" on error 23503), but it
-- decides from its local cache, which can be incomplete. Customers were switched to RESTRICT
-- earlier (customer_fk_restrict_no_cascade); suppliers now match.
--
-- Factory reset is unaffected: it deletes these ledgers before the suppliers.

alter table public.purchases
  drop constraint purchases_supplier_id_fkey,
  add constraint purchases_supplier_id_fkey
    foreign key (supplier_id) references public.suppliers(id) on delete restrict;

alter table public.material_purchases
  drop constraint material_purchases_supplier_id_fkey,
  add constraint material_purchases_supplier_id_fkey
    foreign key (supplier_id) references public.suppliers(id) on delete restrict;

alter table public.supplier_transactions
  drop constraint supplier_transactions_supplier_id_fkey,
  add constraint supplier_transactions_supplier_id_fkey
    foreign key (supplier_id) references public.suppliers(id) on delete restrict;
