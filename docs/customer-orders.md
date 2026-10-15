# Customer Orders

Customer Orders is available under **Sales & POS → Customer Orders**, from quick search, and from the customer profile. It is loaded separately so it does not slow the initial workspace.

Choose an active customer, add loose dairy quantities or whole product packs, set rates and a flat discount, and choose a pickup/delivery date and optional time. Delivery requires an address. Orders support notes, printable summaries, search, due-date filters and status filters. Customer-specific loose product prices are applied when adding a product; changing the customer does not overwrite agreed prices already entered.

The workflow is **Pending → Confirmed → Ready → Completed**. Confirmed orders can also be billed directly. Any unbilled order can be cancelled; cancelled and completed orders retain their history. Booking does not reserve or deduct inventory, accept advance payments, or change customer balances. Current stock is shown as a preparation reminder. Bookings can exceed current stock; POS checks actual stock at billing.

**Bill in POS** opens a bill with the saved customer, products, prices and discount. Edit these in Customer Orders before billing. The existing counter cart is restored when leaving the order bill. Choose cash, online or khata, including partial payment. Orders require an internet connection; normal offline POS remains available.

The `checkout_customer_order` RPC locks the booking, checks its revision, validates current stock and the active shift/day, inserts the real invoice, invokes the existing atomic POS financial effects, and completes the booking in one transaction. Failures roll back every effect. Retrying a completed booking returns its original invoice and does not post another sale. Returns are handled against that invoice in Sales History; they do not reopen the original booking.

## Database activation

Apply `supabase/migrations/20261002153153_customer_orders.sql` before using orders on the deployed app. It creates the bookings table, validation trigger, indexes, and checkout RPC. The existing sale and balance RPCs must already be installed. At implementation time the live migration was **not applied**: automatic approval review rejected the live change. Owner approval is required before applying it.

This deployment uses PIN operators and a trusted-terminal database access model, without Supabase Auth sessions. The migration follows the existing business-table model: RLS is enabled, `anon`/`authenticated` can read/create/update bookings, and deletion is denied. UI permissions control operator actions; they are not database authentication. The migration also grants the Customer Orders module to standard owner, manager and cashier roles, while leaving custom roles unchanged. Settings → Users & Roles supports separate view, create, edit and cancel actions; billing additionally requires POS checkout permission. Migrating the application's identity and business-table policies to Supabase Auth is a separate prerequisite for a public multi-tenant deployment.

The customer and invoice references prevent deleting records that are needed for order history. Product names, units and prices are saved as snapshots.

## Verification

`node scripts/verify-customer-orders-ui.mjs` runs the actual React screens against sample customers and a mocked transport. All live business requests are blocked. It covers bookings, agreed prices, edits, search, delivery, desktop/mobile themes, cancellation, invoice linking, duplicate submits, preservation of the counter cart, view-only permissions and loading recovery. Screenshots and the check report are saved in `screenshots/customer-orders/`.

`node scripts/verify-customer-orders-db.mjs` runs the migration in isolated local Postgres using PGlite and copies of the existing financial RPCs. It checks totals, transitions, revision conflicts, stock/cash/khata effects, atomic rollback after ledger failure, retries, locked days and payment accounts. It does not access Supabase. To install its temporary test runtime:

```powershell
npm install --prefix .qa-customer-orders --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
```

TypeScript validation, production build, and the existing POS UX regression suite also pass. Local tests do not replace a live end-to-end verification after the approved migration is applied.
