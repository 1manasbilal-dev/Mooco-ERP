# Mooco ERP — Dairy Management & Accounting

Point-of-sale + accounting system for a dairy business: milk procurement, allocation, production batches, POS with offline support, cash custody (shifts/drawers/day close), khata ledgers, double-entry style accounts, and reports.

**Stack:** React 19 · TypeScript · Vite 6 · Tailwind CSS 3 (build-time) · Supabase (Postgres) · Dexie (IndexedDB offline store) · Recharts · Framer Motion.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase project URL + anon key
npm run dev                  # http://localhost:3000
```

Environment variables (in `.env.local`, never committed):

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |

## Build & package

```bash
npm run build          # production bundle in dist/
node package_dist.cjs  # optional: creates mooco_erp_hostinger_build.zip from dist/
```

## Database migrations

SQL lives in `supabase/migrations/`. Apply in order with the Supabase CLI (`supabase db push`) or the dashboard SQL editor:

1. `20260902150236_cash_control_foundation.sql` — cash custody tables + RPCs
2. `20260902220000_secure_pin_auth.sql` — **required**: hashed PINs (`pin_hash` + per-user salt), auth RPCs (`app_login`, `app_verify_pin`, `app_list_users`, `app_create_user`, `app_update_user`, `app_delete_user`), brute-force lockout, and RLS lockdown of `app_users`
3. `20260902221000_atomic_financial_ops.sql` — **required**: atomic balance/stock delta RPCs (`adjust_account_balance`, `adjust_customer_balance`, `adjust_supplier_balance`, `adjust_item_stock`, `transfer_between_accounts`, `adjust_expense_vendor_stats`, `pos_sync_order_effects`)
4. `20260902230000_drop_legacy_pin.sql` — **optional, deploy LAST**: drops the legacy plaintext `pin` column once the new build is confirmed live

> Deploy order matters: apply migrations 2–3 **before** shipping the updated client, and only run 4 after the new client is in use everywhere.

## Security model (current)

- PINs are salted-hashed server-side (pgcrypto) and never leave the database; login/unlock go through `security definer` RPCs with basic rate limiting (8 failed attempts / 15 min).
- `app_users` has RLS enabled with **no direct client policies** — all access flows through the auth RPCs.
- **First login (fresh installs):** the auth migration seeds one owner account — username `admin`, PIN `1234`. Change this PIN immediately in Settings → Users & Roles.
- **Known limitation:** business tables (sales, purchases, khata, …) are still reachable with the anon key because the app does not use Supabase Auth sessions yet. This is appropriate only for trusted/local network deployments. Migrating operator identity to Supabase Auth (and tightening table policies to `authenticated`) is the next security milestone.

## Offline behavior

POS sales and new customers are written to IndexedDB first and synced in the background (25 s interval, 5 retries, dead-letter on failure, cross-tab lock). All other modules require connectivity. Order side effects (inventory deduction, cash receipt, khata charge) are applied by the idempotent `pos_sync_order_effects` RPC, so retries never double-apply.

## Customer Orders

**Sales & POS → Customer Orders** supports pickup/delivery bookings, products and packs, agreed prices, discount, preparation statuses, printing, and billing through POS. Apply `20261002153153_customer_orders.sql` before activating the feature. Bookings require connectivity and do not change stock or balances until billed. See [Customer Orders workflow, access model and verification](docs/customer-orders.md).
