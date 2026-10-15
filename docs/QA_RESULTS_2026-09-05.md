# Mooco ERP: hands-on QA results

Tested on 5 September 2026 using the running local app at http://127.0.0.1:5173, connected to its configured Supabase backend. Browser testing used the existing owner account and existing records. This was an initial targeted QA pass, not full release sign-off.

## Confirmed findings

### QA-01 — High: terminal lock can be dismissed without authentication

Steps: sign in; open the header user menu; select **Switch User / Lock**; click **Close**; open **Purchase**.

Actual: the modal disappears and the procurement screen is accessible without entering a PIN. Expected: an action presented as locking the terminal should require authentication before access resumes.

Cause: `App.tsx:91` opens the switcher without clearing the current identity. `components/UserSwitcherModal.tsx:209` renders Close when a current user exists; its handler at line 212 simply hides the modal. Backdrop dismissal at line 174 uses the same condition.

Suggested fix: separate user switching from terminal locking. Persist a locked state and require PIN verification to clear it; retain optional cancellation only for an explicitly named switch-user action.

### QA-02 — High: dashboard omits outstanding supplier dues

Steps: open **Suppliers**, note total **Payable Dues Rs 4.4k** and a supplier balance of **Rs 4,400**; return to **Dashboard**.

Actual: **Outstanding Dues / Payable to Milk Suppliers** displays **Rs 0**. The Balance Sheet independently displays **Accounts Payable (Milk Suppliers) Rs 4,400**. Expected: the dashboard shows the same outstanding payable balance.

Cause: `pages/Dashboard.tsx` sums `supplier.total_due`, while the context maps the balance into `pending_balance` and `pages/Suppliers.tsx:92` sums that field.

Suggested fix: use the canonical supplier balance field and reconcile dashboard, supplier list and balance sheet totals.

### QA-03 — High: monthly report presets shift dates backward

Steps on 5 September 2026: open **Reports**; select **This Month**, then **Last Month**.

| Preset | Actual dates | Expected dates |
| --- | --- | --- |
| This Month | 2026-08-31 to 2026-09-05 | 2026-09-01 to 2026-09-05 |
| Last Month | 2026-07-31 to 2026-08-30 | 2026-08-01 to 2026-08-31 |

Impact: monthly reporting includes the wrong boundary day and last-month reporting excludes the final day of that month. The default report range has the same error. **This Year** showed the correct start date of 2026-01-01.

Cause: `pages/Reports.tsx:99`, `136`, `139`, and `140` construct local-midnight dates, then convert them to UTC with `toISOString()` before extracting the date. This moves local midnight to the preceding UTC date in Pakistan.

Suggested fix: format calendar dates using local year/month/day fields consistently.

### QA-04 — Medium: global quick search does nothing

Steps: on Dashboard, enter **milk** in **Quick search...**, then press Enter.

Actual: input text changes but there are no results, filtering, or navigation. Expected: a usable search response.

Cause: the input at `App.tsx:234` has no search handler or state integration. The adjacent shortcut hint also advertises functionality this input does not implement.

Suggested fix: implement global search or remove the unfinished control until it is functional. The keyboard shortcut itself was not independently exercised.

### QA-05 — Medium: TypeScript validation fails in Reports

Command: `npx tsc --noEmit`.

Actual: exit code 1 with:

```text
pages/Reports.tsx(646,82): TS2365: Operator '+' cannot be applied to types 'unknown' and 'number'.
pages/Reports.tsx(1679,131): TS2345: Argument of type 'unknown' is not assignable to parameter of type 'number'.
```

Expected: clean type validation. `npm run build` passed, because the current Vite build does not run this type check. These errors are confirmed validation failures; a runtime crash from them was not observed.

Suggested fix: type the numeric aggregation and category entries explicitly and include type validation in the build/CI checks.

## Checks that passed

- Documented username/PIN login opened the dashboard.
- Empty username submission displayed **Username enter karein**.
- Empty PIN submission displayed **Password / PIN code enter karein**.
- Logout displayed the login screen and reload remained locked.
- Dashboard, Purchase, POS, Suppliers, Profit & Loss and Balance Sheet loaded.
- Purchase with an empty form disabled Save Intake.
- Purchase quantity -1 with rate 100 kept Save Intake disabled; no transaction was submitted.
- POS empty cart disabled Confirm & Pay.
- Adding 1 L Cow Milk at Rs 180 produced the correct Rs 180 cart total.
- Editing a negative POS rate clamped it to zero; removing the draft item cleared the cart.
- Production build completed successfully.

## Observations requiring further investigation

- Balance Sheet displayed a variance of **Rs 23,360**. This is not classified as a confirmed software defect because opening capital and the existing transaction history were not reconciled in this pass.
- Browser logs contained Recharts warnings about transient negative chart dimensions; no corresponding crash was observed.
- POS accepted a draft quantity of 35 L while showing 34 L in stock. This is not classified as a bug because the configured negative-stock policy was not independently verified and checkout was not submitted.

## Scope and remaining coverage

No sale, purchase, payment, refund, stock adjustment, user change or configuration change was submitted. The POS draft was removed and this test browser was logged out. Authentication may update its normal login metadata. Application source files were not changed; the production build regenerated `dist/` and this report was added.

Offline sync/retry, concurrency, full role matrix, refunds, business-day close, production posting, exports, mobile layouts and a complete accounting reconciliation remain untested. Posting these workflows should use a designated test database with controlled opening balances.
