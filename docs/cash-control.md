# Cash Control: Cashier Shifts and Day Close

This is the workflow the Cash Control module implements. Update it whenever cash-control
behaviour changes.

## 1. Workflow

Cashiers change multiple times a day, and each cashier works under their **own login**.
The system tracks cash custody per cashier through **shifts** — so every rupee is
accountable from the moment a drawer opens until the day is closed.

### End-to-end flow

1. **Login → Shift Start (custody begins)**
   - Cashier taps their tile on the lock screen and enters their 4-digit PIN.
   - Cash Control opens automatically for cashiers.
   - The drawer's opening cash (change float, e.g. Rs 5,000) or the previous
     cashier's pending **handover** is shown; the cashier **counts the physical
     cash and accepts** it. Count ≠ declared → a variance record is created
     automatically.
   - A shift can run for any duration; a cashier may start/close several shifts a day.
   - Business rules enforced server-side: one active shift per drawer, one active
     shift per user.

2. **During shift (every rupee is tagged)**
   - Sales, customer payments (khata), expenses, purchases and refunds are stamped
     with `business_day_id / shift_session_id / drawer_id / cashier_id`.
   - POS checkout is blocked without an active shift, and blocked when the business
     day is closed.

3. **Shift Close (cash split)**
   - Cashier counts the drawer, then submits the split:
     - **Leave in drawer** → change float; becomes the **next shift's opening cash**
       and is declared as a *pending handover*.
     - **Remit to head** → goes to the **Head Inbox** as a *pending remittance*
       and the amount **leaves the drawer account at submit time** (drawer balance
       −remit + `Transfer_Out` ledger row, done inside `cash_control_close_shift`).
   - Count ≠ expected → difference reason is mandatory (a bare "Other" is
     not accepted); shift goes to `Pending Review` and an open variance is created.
   - There is no "use expected" shortcut: the closing cash must be counted.
   - "Keep in drawer" defaults to the drawer's default float, capped at the count.
   - A confirm step lists the split, the difference, and anything that will not be
     part of the shift (cart lines, parked bills, entries not yet synced).
   - **Head closing a shift**: the remitted cash is received straight into the
     chosen account (`cash_control_accept_remittance` right after the close), so it
     never waits in Head Inbox for the same person. "Keep pending in Head Inbox"
     is still an option. The **Owner** closing their own shift can also approve
     the difference in the same step, so the day is not left blocked.

   **Whose shift a user sells on**: their own open shift only. The Owner (Super
   Admin) may sell on another cashier's shift that is open today; POS shows
   "<name>'s shift" in that case. A cashier never posts bills into a colleague's drawer.

4. **Head acceptance (next actions)**
   - Head/Manager recounts a remittance in the Head Inbox, selects a receiving
     account and accepts it. **Accept credits ONLY the chosen destination
     account** (`Transfer_In`, done inside `cash_control_accept_remittance`);
     the drawer is never touched again — no double deduction is possible.
     Mismatch → `Disputed` + variance for resolution.
   - Between submit and accept the remitted cash is **in transit ("darmiyan")**:
     out of the drawer and in **no account**. It surfaces as
     `cashInTransit` (context) in Head Inbox, Dashboard (Available Liquidity)
     and Bank & Cash. Company cash identity:
     `Bank & Cash accounts total + in-transit = total money`.
   - Pending drawer handovers are visible in the Head Inbox; the next cashier
     accepts them by counting at shift start.
   - Open variances are approved/rejected with notes in the Audit Trail;
     resolution auto-closes a `Pending Review` shift.

5. **Business Day Close (independent of shifts)**
   - Day close is **not required on the same calendar day**. When work passes
     midnight, the new day opens automatically with the first shift; the previous
     day simply stays **pending** (a banner in Cash Control reminds the head).
   - Day can be closed only when it has no active shifts, no pending/disputed
     remittances or handovers, and no open variances.
   - Closed day blocks POS for that date; Super Admin can reopen with a reason.

## 2. Module Map (where everything lives)

| Concern | Module | Notes |
|---|---|---|
| Login / quick switch | Lock screen (`src/components/UserSwitcherModal.tsx`) | User tiles → PIN (`app_verify_pin`); username fallback (`app_login`). PINs hashed server-side, brute-force lockout 8/15min. |
| Shift start/close, handover accept | **Cash Control → My Shift** (`src/pages/CashControl.tsx`) | RPCs: `cash_control_start_shift`, `cash_control_close_shift`. |
| Remittance accept, handover visibility | **Cash Control → Head Inbox** (head-only) | RPC: `cash_control_accept_remittance`. |
| Day close/reopen | **Cash Control → Business Days** (head-only) | Client guards + `business_days` status machine. |
| Variances / audit | **Cash Control → Audit Trail** (head-only) | `cash_variances` lifecycle. |
| Drawer setup | **Cash Control → Drawers** (head-only) | `upsertCashDrawer` in `src/context/DairyContext.tsx`. |
| Day/shift tagging of money | `src/context/DairyContext.tsx` write paths + `src/lib/syncService.ts` | Offline POS orders replay effects via `pos_sync_order_effects`. |
| Atomic balances/stock | `src/lib/atomic.ts` wrappers over Postgres RPCs | No client read-modify-write on balances. |

## 3. Server objects (already applied via Supabase migrations)

- Tables: `business_days`, `cash_drawers`, `cash_shifts`, `drawer_handovers`,
  `cash_remittances`, `cash_variances`, `shift_cash_events`, `app_login_attempts`.
- RPCs: `cash_control_start_shift`, `cash_control_close_shift`,
  `cash_control_accept_remittance`, `pos_sync_order_effects`,
  `adjust_account_balance`, `adjust_customer_balance`, `adjust_supplier_balance`,
  `adjust_item_stock`, `transfer_between_accounts`, `adjust_expense_vendor_stats`,
  `app_login`, `app_login_with_pin`, `app_verify_pin`, `app_list_users`,
  `app_create_user`, `app_update_user`, `app_delete_user`.

## 4. Balance invariants (guaranteed by the 2026-09 cash-in-transit migration)

- Drawer account balance **== physical cash in the drawer** at all times:
  - "Add Opening Cash" **always transfers from another tracked Bank & Cash
    account** (source −X, drawer +X, ledger both sides) — there is no
    outside-cash injection option; fresh head float (shift start **without**
    handover) credits the drawer account as the fallback for cash handed over
    physically without a pre-load;
  - handover-based openings move nothing (that cash never left the account);
  - sales/collections credit it, expenses/purchases/refunds debit it;
  - remit-to-head debits it **at shift-close submit time**.
- Remitted cash between submit and head-receive lives in **no account** — the
  pending remittance row is the custody record (Head Inbox shows it as
  In Transit / Pending Receive).
- Head accept credits **only** the destination account. Reject/re-dispute paths
  must never re-debit the drawer.
- One-time data repair (2026-09-04): `acc_1788155761454` (Cash Drawer) was
  re-anchored from −16,450 to the physical 5,000 with a `Journal` correction
  row `btx_correction_custody_20260904` — the old model deducted remittances at
  accept time while floats were never credited, which had drifted the balance.

## 5. Known limitations (documented, by design for now)

- Cash-control actions (shift start/close, remittance accept, day close) need
  internet; only POS sales & customers queue offline in Dexie.
- Shift totals shown live are computed from app state (incl. not-yet-synced offline
  orders); the close RPC receives the cashier's submitted totals.
- Business tables are anon-writable until full Supabase Auth integration
  (see README security note); `app_users`/`app_login_attempts` are locked down.
