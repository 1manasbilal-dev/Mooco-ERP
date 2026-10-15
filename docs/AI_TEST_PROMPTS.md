# MOOCO Dairy ERP — AI Agent Testing Prompts

> **Kaise use karein (Roman Urdu):**
> 1. Har prompt **self-contained** hai — naya agent kuch nahi janta, is liye har prompt mein
>    poora context diya gaya hai. Bas copy karein, kisi bhi AI coding/browser agent ko paste karein.
> 2. **Prompt 0 sab se pehle chalayein** (setup + master data). Us ke baad modules ki order
>    "Execution Order" table ke mutabiq chalayein — kyunke kuch tests pehle ke tests ke data par
>    depend karte hain (e.g. POS sale ke baad hi Sales History return test ho sakta hai).
> 3. Har agent ka result ek standard **RESULT BLOCK** mein aayega. Aakhri mein
>    **Prompt C (Consolidation)** chala kar saare results merge karein.
> 4. Universal preamble (Section 1) har prompt ke aage paste karein — yeh agent ko app ka URL,
>    credentials, guardrails aur reporting format deta hai.

---

## Execution Order (Dependency-aware)

| Order | Prompt | Kya test hoga | Kis par depend karta hai |
|---|---|---|---|
| 1 | **Prompt 0** | Environment + Master Data Setup | Kuch nahi (fresh start) |
| 2 | **Prompt 1** | Login / Lock Screen (T01) | Prompt 0 |
| 3 | **Prompt 2** | Settings / Users / Roles (T02) | Prompt 0 |
| 4 | **Prompt 3** | Bank & Cash (T03) | Prompt 0 |
| 5 | **Prompt 4** | Items (T04) | Prompt 0 |
| 6 | **Prompt 5** | Suppliers (T06) | Prompt 0 |
| 7 | **Prompt 6** | Purchase (T07) | Prompt 0 + Prompt 4/5 |
| 8 | **Prompt 7** | Allocation (T08) | Prompt 6 (milk intake data) |
| 9 | **Prompt 8** | Production (T09) | Prompt 7 (allocated batch) |
| 10 | **Prompt 9** | POS (T10) | Prompt 0 (shift, sales) |
| 11 | **Prompt 10** | Sales History & Returns (T11) | Prompt 9 (bills ban chuki hon) |
| 12 | **Prompt 11** | Cash Control (T12) | Prompt 9 (pending remittance chahiye) |
| 13 | **Prompt 12** | Customers (T13) | Prompt 0 |
| 14 | **Prompt 13** | Expenses & Vendors (T14) | Prompt 0 |
| 15 | **Prompt 14** | Accounts + Reports + Dashboard (T15/T16/T17) | Prompt 6–13 (data maujood ho) |
| 16 | **Prompt 15** | E2E Golden Path (Section 21) | Sab se pehle data reset (andar instruction hai) |
| 17 | **Prompt 16** | Offline / Sync Suite | Prompt 0 |
| 18 | **Prompt 17** | RBAC Suite | Prompt 0 (test users Prompt 2 mein bante hain) |
| 19 | **Prompt 18** | Quirks Verification (Q01–Q24) | Modules ka data |
| 20 | **Prompt C** | Saare results consolidate | Saare prompts ke RESULT BLOCKs |

> **E2E (Prompt 15) ka raaz:** Agar waqt kam hai to sirf **Prompt 0 → Prompt 15** chalayein.
> E2E Golden Path akela hi 90% critical workflow cover karta hai.

---

## 1. Universal Preamble (HAR prompt ke sath paste karein)

```
=== UNIVERSAL CONTEXT (read first) ===
You are a manual QA tester executing black-box GUI tests on a web app.

APP: Mooco Dairy ERP (dairy management & accounting: POS, milk procurement, production,
cash custody/shifts, khata ledgers, double-entry accounts).
URL: http://localhost:3000  (if not running, start it: cd "D:\Vibe Coding\mooco-dairy-accounting-app" && npm run dev)
FULL TEST PLAN FILE: "D:\Vibe Coding\mooco-dairy-accounting-app\docs\TEST_PLAN.md" — read the
relevant section(s) FIRST before testing. The plan has exact expected results, toasts and numbers.

LOGIN: On first run a lock screen appears. Tap the "Admin" tile, enter PIN 1234.
(If PIN 1234 fails, report and stop — do not guess more than 3 times, the account locks.)

HOW TO TEST:
- Act like a real user: click, type, navigate. Read toasts, badges and on-screen numbers.
- EXACT expected results are in TEST_PLAN.md — compare what the app shows against them.
- Take a screenshot (or note exact on-screen text) as evidence for every test case.
- A test PASSES only if the actual result matches the plan's expected result.

GUARDRAILS:
- NEVER run destructive actions (Settings → Danger Zone resets, deleting master data, deleting
  the currently logged-in user) unless the prompt explicitly says to.
- If the app is in a broken/unexpected state (error boundary, blank page), screenshot it, log a
  bug, and refresh/recover before continuing.
- If a prerequisite is missing (e.g. no data), run the minimum setup described in the prompt
  instead of skipping silently.

REPORTING (mandatory at the end):
Return a RESULT BLOCK in exactly this format:

=== RESULT BLOCK: <Prompt name> ===
SUMMARY: X passed / Y failed / Z blocked out of N test cases
ENVIRONMENT: browser, date, online/offline, logged-in user & role
PER TEST:
  TC-ID | PASS/FAIL/BLOCKED | one-line actual vs expected | evidence (screenshot name or quoted UI text)
BUGS FOUND:
  BUG-<n>: <title> | severity Critical/Major/Minor/Cosmetic | steps | expected vs actual | test ID
DATA LEFT BEHIND: what records you created (so the next agent knows)
=== END RESULT BLOCK ===
=== END UNIVERSAL CONTEXT ===
```

---

## 2. Prompt 0 — Environment + Master Data Setup

```
=== UNIVERSAL CONTEXT (see Section 1 — paste here) ===

TASK: Prepare the test environment and seed master data. You are setting the stage for all
future test agents. Follow docs/TEST_PLAN.md Section 1 (Test Environment Setup) and Section 3
(Test Data Setup) EXACTLY — the numbers there are used by later tests.

STEPS:
1. Verify the app is reachable at http://localhost:3000. If not, report BLOCKED (do not try to
   fix the server beyond one restart attempt).
2. Log in as Admin (PIN 1234).
3. Bank & Cash page → create these 3 accounts (exact names, they are referenced later):
   - "Main Cash Drawer" | Type: Cash | ✅ enable as Cash Drawer | Opening balance: 5000
   - "EasyPaisa" | Type: Wallet | Opening balance: 10000
   - "Meezan Bank" | Type: Bank | Opening balance: 0
4. Settings → Accounting & Ledger:
   - Default Till / Counter Cash Drawer = Main Cash Drawer
   - Default Bank / Digital Wallet = EasyPaisa
5. Suppliers page → add supplier: Name "Ghulam Farid Dairy", Phone 0300-1111111,
   Supply Category: Milk, Default Variety: Buffalo Milk, Default Rate/Liter: 110, Opening 0.
6. Items page → verify the system milk item exists (Raw/buffalo milk, "System Core" badge).
   Create product "Yogurt (Dahi)": Usage Class = Sale product, Source = In-House,
   Base Unit = Kilogram, Cost 220, Default Sales Rate 300, Allow Loose Sale ON.
   Recipe tab: Standard Input 10 Liters → Expected Output 5 kg.
   Selling Options tab: variant "Dahi 1kg Pack", Pack Qty 1, Deduct 1 kg, Price 300.
7. Customers page → add "Hassan Store", Phone 0321-2222222, City Lahore, Initial Balance 0.
8. Expenses → Vendors Directory → add "WAPDA Electricity", Type: Electricity & Utility,
   Phone 0301-3333333.
9. sanity-check: Dashboard loads, sidebar shows all modules, no console errors.

VERIFY (report actual vs expected for each): accounts' consolidated total = 15000;
Ghulam Farid appears with "Rs 110/L" chip; Yogurt appears in Items with 1 variant.
```

---

## 3. Prompt 1 — Login, Lock Screen & User Switching (T01)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T01 from docs/TEST_PLAN.md Section 4 (test IDs TC-AUTH-01 to
TC-AUTH-13). Read that section first.

FOCUS:
- Lock screen cannot be dismissed without a session; wrong PIN shows "Ghalat PIN code!" and
  clears; username fallback login; cashier auto-redirects to /cash-control on login.
- Session restore: log in, hard-refresh, user must stay logged in (no lock screen).
- Header user pill: Switch User / Lock, Logout / Sign Out.

⚠️ IMPORTANT ORDER NOTES:
- TC-AUTH-07 (cashier auto-redirect) needs a cashier user. If none exists, create one first in
  Settings → Users & Roles: Name "Test Cashier", username "testcashier", PIN 1234,
  Role: POS Cashier. Then logout and log in as that cashier.
- TC-AUTH-13 (brute-force lockout): enter a WRONG PIN 8 times on the username-login path
  (not the admin tile) so you do not lock the admin account you need later. Then wait/observe
  the lock message and note exact wording.
- End the session logged back in as Admin.

DO NOT delete any users.
```

---

## 4. Prompt 2 — Settings, Users & Roles (T02)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T02 from docs/TEST_PLAN.md Section 5 (TC-SET-01 to TC-SET-22).
Read Section 5.1–5.3 first. SKIP Section 5.4 (Danger Zone) entirely — destructive.

FOCUS:
- Auto-save: change company name → reload → persists. "Save & Apply" button only shows the
  auto-save toast.
- Last-item guards: removing the last milk shift and the last payment mode must be blocked
  with exact Urdu toasts quoted in the plan.
- Users & Roles CRUD: create "Test Manager" (username testmanager, PIN 1234, Role: Manager /
  Accountant) and "Test Procurement" (username testproc, PIN 1234, Role: Milk Procurement
  Incharge) — later RBAC tests need them.
- PIN flows (TC-SET-13/14): edit a user with blank PIN → old PIN keeps working; change the
  Test Cashier PIN to 4321 → old PIN 1234 must FAIL, 4321 must PASS. Afterwards change it
  back to 1234.
- Super Admin protections (TC-SET-15): no delete button, disabled status toggle, locked role.
- Role tests (TC-SET-18..21): create a custom role with 1 permission; try deleting a system
  role and a role that has users — capture exact toasts.

KEEP: the users Test Cashier / Test Manager / Test Procurement and any custom role you make —
list them in DATA LEFT BEHIND.
```

---

## 5. Prompt 3 — Bank & Cash (T03)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T03 from docs/TEST_PLAN.md Section 6 (TC-BC-01 to TC-BC-13).
Master data (Main Cash Drawer 5000 / EasyPaisa 10000 / Meezan Bank 0) should already exist —
if not, recreate per Section 3 first and note it.

FOCUS:
- Transfer TC-BC-05: Main Cash Drawer → EasyPaisa 1000 → BOTH sides move (+1000 / −1000) and
  TWO ledger rows appear (Transfer_Out + Transfer_In). Afterwards transfer 1000 BACK so
  balances return to 5000 / 10000 — later tests depend on exact balances.
- TC-BC-06 same-account transfer blocked with toast "Source and Destination cannot be same".
- TC-BC-08: edit an account → balance must NOT be editable; set your test wallet Inactive →
  it disappears from other selectors → set Active again.
- TC-BC-10: try deleting "Main Cash Drawer" (has transactions/transactions will exist) — must
  be blocked with the exact toast; NEVER force it.
- TC-BC-12: check the unified ledger shows entries from different sources (POS Sale, Expense,
  Customer Receipt) without duplication.
- Record TC-BC-13 (overdraft transfer) behavior — does the server allow negative balances?
```

---

## 6. Prompt 4 — Items (T04)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T04 from docs/TEST_PLAN.md Section 7 (TC-ITM-01 to TC-ITM-15).

FOCUS:
- Validation toasts exactly as quoted ("Display Name is required", etc.).
- Variant flow: verify "Yogurt (Dahi)" already has variant "Dahi 1kg Pack" @ Rs 300 (Prompt 0
  created it). Add a second variant "Dahi 500g Pack", Pack Qty 0.5, Price 160.
- System item protection (TC-ITM-09): open the milk system item — fields disabled, delete
  hidden. Try deleting via any path — must be blocked.
- TC-ITM-10: create a disposable raw material "Test Additive" and add it as an ingredient to
  the Yogurt recipe, then try deleting it → "Action Blocked" modal. Remove it from the recipe
  afterwards and then delete it successfully (TC-ITM-11 impact analysis modal).
- ⚠️ Q09/Q10 checks: Unit Manager → create custom unit → "Add Unit" → reload page → does the
  unit survive? Categories modal → remove a category → does it actually disappear? These are
  suspected no-op bugs — record evidence.
```

---

## 7. Prompt 5 — Suppliers & Ledger (T06)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T06 from docs/TEST_PLAN.md Section 9 (TC-SUP-01 to TC-SUP-09).
"Ghulam Farid Dairy" (rate 110) should exist — if not, create per Section 3.

FOCUS:
- Create ONE extra disposable supplier "Test Supplier" for the destructive checks:
  - TC-SUP-03: opening balance +1000 → "Payable (Dena Hai)" badge + Opening Balance ledger row.
  - TC-SUP-04: another "Test Advance" supplier with −500 → "Advance Paid" badge.
- TC-SUP-05: record a 1000 Cash payment to Test Supplier from Main Cash Drawer → ledger shows
  "Payment Paid (Cash)" Debit row, balance drops to 0, drawer balance drops by 1000.
  NOTE THE DRAWER BALANCE afterwards and report it (later agents need to know).
- TC-SUP-06: temporarily set ALL accounts inactive → open payment modal → warning
  "Koi Cash / Bank account mojood nahi hy…" + submit disabled. Re-activate accounts after.
- TC-SUP-09: WhatsApp statement button builds a wa.me link (check the URL text, do not send).
- Leave Ghulam Farid's balance at 0.
```

---

## 8. Prompt 6 — Purchase: Milk Intake, Supplies, Returns (T07)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T07 from docs/TEST_PLAN.md Section 10 (TC-PUR-01 to TC-PUR-18).
Requires: supplier "Ghulam Farid Dairy" (rate 110), accounts Main Cash Drawer + EasyPaisa.

⚠️ These purchases feed Allocation/Production tests. Record exact numbers.

STEPS (do them in this order):
1. TC-PUR-02 (KEY): Milk Intake — Ghulam Farid, Buffalo, Shift Morning, 50 L @ 110.
   Auto-check Total Bill 5500. Pay 3000 via Online → EasyPaisa auto-selected.
   Verify: "Partial (Rs 3,000)" chip, "Added to Khata 2,500", supplier due becomes 2500,
   EasyPaisa drops to 7000.
2. TC-PUR-01: another intake 20 L @ 110, FULL paid Cash (Main Cash Drawer) → drawer −2200.
3. TC-PUR-03: a third intake 10 L @ 110 with Paid 0 → "On Khata (Unpaid)" → supplier due 4700 total.
   Afterwards use Suppliers page to record a 2200 payment (Online, EasyPaisa) so Ghulam Farid's
   due returns to 2500. (2500 must REMAIN for later agents.)
4. Validations TC-PUR-04: submit with no supplier / qty 0 → capture exact toasts.
5. TC-SUP-AUTO: select Ghulam Farid → variety + rate 110 auto-fill + due badge visible.
6. TC-PUR-05: after save, Date & Shift are PRESERVED while supplier/qty/rate reset.
7. Supplies & Material tab (TC-PUR-08/09/12): build a 2-line invoice, edit a line's TOTAL and
   verify quantity back-computes; Clear asks window.confirm.
8. TC-PUR-13 (suspected bug Q01): leave vendor EMPTY with an unpaid balance → button says
   "Select Vendor to Save" → click it anyway → does it save with no supplier? Capture evidence.
9. Returns (TC-PUR-14/15): from the Audit Log return 5 L of the FIRST intake (reason: Data
   Entry Error) → verify "Returned" badge and that an amber "Return: Ghulam Farid Dairy" row
   appears in the Allocation page's Unallocated list. Then try returning milk that is already
   allocated later — blocked with "Cannot return milk: Already allocated to production stock."
   (do this AFTER the Allocation agent has allocated, or note as deferred).

REPORT the exact balances of Main Cash Drawer, EasyPaisa, and Ghulam Farid due at the end —
and how many liters remain UNALLOCATED (expected: 50−5 returned... compute from what you did,
list each intake's remaining unallocated liters individually).
```

---

## 9. Prompt 7 — Allocation (T08)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T08 from docs/TEST_PLAN.md Section 11 (TC-ALC-01 to TC-ALC-11).
Requires: unallocated fresh milk from the Purchase agent (Ghulam Farid @ 110/L).

⚠️ The Production agent NEEDS a 40 L batch of Yogurt (Dahi). Do this FIRST:
1. TC-ALC-08: allocate exactly 40 L of Ghulam Farid's milk → Destination Production →
   Product "Yogurt (Dahi)" → Confirm. Verify toast, batch appears in Production board
   (In: 40 L), Unallocated list decreases.

THEN the rest:
2. TC-ALC-02/03: open qty modal on another row — check presets (5L/10L/50%/100%), enter more
   than available → toast "Quantity cannot exceed available {max} L".
3. TC-ALC-04 (weighted avg): add 20 L @110 and 10 L @120 (any suppliers) to the cart →
   Avg Cost tile must show Rs 113.33/L (=(2200+1200)/30). Screenshot the tile. Then Clear.
4. TC-ALC-05/06: switch source to Retail Stock → destination auto-sets Production and the
   Retail option hides; confirm the "Cannot allocate from Retail Stock back to Retail
   Counter." rule.
5. TC-ALC-07: allocate a small amount (5 L) → Retail destination → verify the milk item's
   stock increases (Inventory page) and an inventory log row appears.
6. TC-ALC-10 (suspected Q13): put something in the cart → hard refresh → is the cart lost?
7. TC-ALC-11: empty-cart submit blocked.

REPORT: exact remaining unallocated liters per supplier, and whether the 40 L production
batch exists (Production board card text).
```

---

## 10. Prompt 8 — Production (T09)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T09 from docs/TEST_PLAN.md Section 12 (TC-PRD-01 to TC-PRD-13).
Requires: ONE batch on the Production board with Input 40 L (from the Allocation agent).

⚠️ POS tests later need EXACT stock: complete the 40 L batch with Loose = 10 kg AND
"Dahi 1kg Pack" = 10 units. Do not complete any other batch.

STEPS:
1. TC-PRD-01/02/03: verify the batch card (In: 40 L, Target: 20 kg); drag it Start →
   Processing (toast + counts), then move to Finish via pills.
2. TC-PRD-04: open the batch modal → Raw Milk Base must be 40 × 110 = Rs 4,400 (rate from the
   allocation). Screenshot the Cost & Yield Analysis table.
3. TC-PRD-05/06: in the completion form check the Loose Quantity default (= estimated 20),
   then set Loose = 10 and variant = 10 units → Mark Batch Completed.
   Verify: toast "Batch completed & added to inventory!", Yield 100%, profit 1,600
   ((10×300 + 10×300) − 4400), History row with green Profit Rs 1,600 and Yield 100%.
4. Inventory check: Yogurt (Dahi) loose stock 10 kg, variant "Dahi 1kg Pack" 10 units.
5. TC-PRD-10: create a tiny second batch (allocate 2 L to Production of any remaining milk)
   and CANCEL it with reason "Test cancellation" → History shows Cancelled badge.
6. TC-PRD-07 (suspected Q12): on a THIRD tiny batch (if milk remains; otherwise skip and note)
   complete with output above target → is Yield >100% allowed? Record.
7. TC-PRD-13: double-click "Mark Batch Completed" rapidly on any batch → confirm only ONE
   completion applies (stock must not double).
8. Q11 note: check whether the batch cost used the allocation rate (110) not the 120 fallback.

REPORT: exact Yogurt stock (loose kg + variant packs) — POS agents depend on these numbers.
```

---

## 11. Prompt 9 — POS Counter Sales (T10)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T10 from docs/TEST_PLAN.md Section 13 (TC-POS-01 to TC-POS-40).
Requires: Yogurt (Dahi) in stock (loose 10 kg, "Dahi 1kg Pack" 10 units), customer
"Hassan Store", drawer "Main Cash Drawer" (balance 5000), NO active shift.

⚠️ The Sales History and Cash Control agents need these EXACT sales. Do not deviate.

STEPS:
1. TC-POS-01 (KEY): with no active shift, build any cart → checkout button must read
   "Start Shift First — Sale Blocked"; click → toast "No active shift. Please start a shift
   first." + shift modal auto-opens. Screenshot.
2. TC-POS-03: in the modal verify Opening Cash shows 5000 → Start Shift → toast + pulsing
   shift chip in the header.
3. TC-POS-22 (Sale 1): customer Hassan Store → Yogurt → Loose qty 2 @ 300 = 600 →
   Amount Paid Now 200 → status "Added to Customer Ledger: Rs 400" → Confirm & Pay (Cash).
   Receipt modal: verify invoice #, total 600. Hassan due becomes 400.
4. TC-POS-25 (Sale 2): reset to Walk-in → 3 × Dahi 1kg Pack = 900 → Cash In 1000 →
   "Change: Rs 100" chip → Confirm. Test the Exact/500/1000/2000/5000 quick chips too.
5. TC-POS-17: cart discount — add an item, apply Rs 100 flat then 10% → grandTotal math
   correct; also try % discount on a 0 subtotal (must not NaN).
6. TC-POS-18/19: Hold the current cart (F8) → recall it; then build a NEW cart and recall the
   held one → does it replace without confirmation? (suspected bug Q08 — evidence).
7. TC-POS-20: Quick Register "Test Buyer" with Due opening 250 → auto-selected in cart.
8. TC-POS-21: keyboard shortcuts F2/F4/F8/F9/Esc (desktop).
9. TC-POS-15/14: stock block "Insufficient stock…" (try selling more packs than 7 left after
   Sale 2); then Settings → Allow Negative Stock ON → retry works → turn it back OFF.
10. TC-POS-11: amount mode — type 500 in "Or Select by Amount" → qty ≈ 1.667 kg conversion.
11. ⚠️ DO NOT close the shift. Leave the shift ACTIVE with: Sale 1 (600, cash paid 200) and
    Sale 2 (900, cash 1000, change 100) in it. Report the header KPIs (Today revenue,
    Bills count) and the shift chip float text.
```

---

## 12. Prompt 10 — Sales History & Returns (T11)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T11 from docs/TEST_PLAN.md Section 14 (TC-SH-01 to TC-SH-16).
Requires: the 2 POS sales from the POS agent (600 w/ Hassan Store, 900 walk-in).

⚠️ Do ONE controlled partial return so Cash Control's numbers stay predictable: on the 900
walk-in bill return 1 pack (refund Rs 300), Restock to Counter, reason "Customer Changed Mind",
refund from Main Cash Drawer. Verify stock +1 pack and drawer −300.

STEPS:
1. TC-SH-01/02/03 (suspected Q04/Q05): note the KPI cards — Gross vs Net. Does Net subtract
   the 300 refund? Is Refunded KPI affected by filters or is it global? Record evidence.
2. TC-SH-04: filters (search, Today, Cash/Online/Credit, status) — does "Partially Returned"
   appear as a status chip after your partial return but is MISSING from the filter dropdown?
   (suspected Q06 — evidence.)
3. TC-SH-07: after the partial return the bill shows "Partially Returned" amber chip; open
   Return again → returnable qty prefilled = sold − already returned (2 remaining of 3).
4. TC-SH-10: try returning an already fully-returned bill → no returnable items / blocked.
5. TC-SH-08: full-return path on a THROWAWAY sale — first create a small extra cash sale in
   POS (any item, then come back), then return it fully with reason "Defective / Spoiled
   Product" → verify "Dump as Spoilage" got auto-selected and stock was NOT restocked.
6. TC-SH-09: Replace Milk flow — verify "Replacement Value Rs 0.00 (Fresh stock worth Rs X
   issued)".
7. TC-SH-05/06: detail modal + receipt reprint (print preview opens).
8. TC-SH-16: log in as Test Cashier (PIN 1234) — are Return buttons hidden without the
   sales_history:return permission? Log back in as Admin.
9. Q07 note: if any bill has the same item on 2 lines, test the name-merge prefill issue
   (skip if not reproducible with current data — note as NOT TESTED).

REPORT: the exact refund totals, bill statuses, current Yogurt stock (loose kg + packs), and
Main Cash Drawer balance — Cash Control agent depends on these.
```

---

## 13. Prompt 11 — Cash Control: Head Inbox, Days, Audit, Drawers (T12)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T12 from docs/TEST_PLAN.md Section 15 (TC-CC-00a to TC-CC-24).
Requires: an ACTIVE POS shift with sales (from the POS agent) OR at minimum a PENDING
remittance. Read current state first: Cash Control → Head Inbox. If no active shift exists,
start one in POS (float = current drawer balance) and make one small cash sale first.

PHASE 1 — Role gate (TC-CC-00a/b): log in as Test Cashier → Cash Control shows the
"Cashier Shifts are on POS Counter" card, no tabs. Log back as Admin.

PHASE 2 — Shift close with EXACT numbers (do this in POS, not Cash Control):
- Expected Till Cash = Opening Float + Cash Sales + Collections − Expenses/Purchases.
  Read the modal's own "Expected Till Cash" number and independently recompute it from the
  sales you know about. If they differ, that is a BUG — capture both numbers.
- TC-POS-36/39: Match Expected → Leave in Drawer 2000 → Remit preview = counted − 2000 →
  Close Shift & Submit Cash → exact-match green state. Drawer balance must drop by the remit.
- TC-POS-40 (separate tiny shift if feasible): close with counted 50 SHORT → reason required
  (try submitting without reason — must block), shift goes "Pending Review" + variance row.

PHASE 3 — Head Inbox (TC-CC-01..08):
- Accept the pending remittance into "Meezan Bank": first try Accept with no count (disabled),
  then count but no account (disabled), then counted = declared + 50 → "Over by Rs 50 — will
  be recorded as a variance." Confirm: Meezan Bank credited the COUNTED amount, the drawer was
  NOT debited again, and an Open variance row appeared in Audit Trail.
- TC-CC-08 is the CRITICAL money-safety check: quote drawer balance before and after acceptance.

PHASE 4 — Variance (TC-CC-20/21): Approve the over-age variance with a note; if a shift sits
in Pending Review it should auto-close.

PHASE 5 — Business Day (TC-CC-11..18):
- Lock Day with an active shift present → button disabled with blocker count.
- Cash Closing: verify Expected drawer cash = Opening + In − Out − Remitted (compute yourself
  from known numbers). Try Close Cash with empty counted → toast. Then counted = expected → close.
- Stock Closing: leave everything blank (no adjustments) → Apply & Close Stock.
- Lock Day (blockers should now be 0). Then TC-CC-18: Reopen — verify only Super Admin sees
  the button (check as Test Manager: no Reopen), empty reason blocked ("Reopen reason
  likhein…"), then reopen with a reason so POS keeps working.

PHASE 6 — Drawers (TC-CC-22..24): Add Opening Cash 1000 from EasyPaisa → both ledger sides;
try source = the drawer itself (blocked) and amount > source balance (blocked, exact toast).

REPORT: final balances of Main Cash Drawer, EasyPaisa, Meezan Bank; cash-in-transit value;
open variances count. This is the money-critical suite — be precise.
```

---

## 14. Prompt 12 — Customers & Khata (T13)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T13 from docs/TEST_PLAN.md Section 16 (TC-CUS-01 to TC-CUS-12).
"Hassan Store" exists (due may be 400 from POS tests or 0 — note the starting balance).

STEPS (use a disposable customer "Test Client" for most checks; leave Hassan Store clean):
1. TC-CUS-02: empty name → toast "Customer name is required".
2. TC-CUS-03/04: Test Client with opening +250 → "Due Rs 250"; another with −300 → "Adv Rs 300".
3. TC-CUS-05: record 250 Cash payment with the WhatsApp checkbox ON → balance 0, wa.me link
   opens with the receipt text (read the URL, cancel the send), account (Main Cash Drawer)
   +250. Revert the drawer effect by recording a 250 Charge (TC-CUS-06) — that also tests
   manual Charge rows.
4. TC-CUS-07: delete the manual Charge → confirm dialog warns balance revert → balance math
   checks. TC-CUS-08: POS-bill entries show NO delete option.
5. TC-CUS-09: try deleting Hassan Store (has sales) → exact toast "Cannot delete: this
   customer has sales/ledger history. Set them inactive instead." NEVER bypass.
6. TC-CUS-10: filter pills Due/Advance/Settled counts vs KPI cards.
7. TC-CUS-11: WhatsApp reminder link builds with 92-prefixed number.
8. TC-CUS-12: ledger type filters + search; running balance correct after the deletes.
Leave Test Client balance 0 at the end (or delete it if it has no history).
```

---

## 15. Prompt 13 — Expenses & Vendors (T14)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite T14 from docs/TEST_PLAN.md Section 17 (TC-EXP-01 to TC-EXP-16).
"WAPDA Electricity" vendor exists.

STEPS:
1. TC-EXP-01: expense 500 Full Paid Cash (Main Cash Drawer), category "Electricity & Utilities".
2. TC-EXP-02 (KEY for Cash Control math): expense 2,500 Partial, Paid 1,000 Cash, vendor WAPDA
   → status "Partial + Rs 1,500 Due", drawer −1000, WAPDA dues 1500, toast mentions
   "Due to WAPDA: Rs 1500".
3. TC-EXP-03: 800 Unpaid with vendor → no account deduction.
4. TC-EXP-04/05 validation toasts exactly as in the plan.
5. TC-EXP-08 (suspected Q15): quick-create a NEW vendor inline from the expense form ("Quick
   Vendor") → save a 300 Unpaid expense → open Vendors Directory → does the 300 due show on
   that vendor's khata? If not, temp-id bug confirmed — evidence.
6. TC-EXP-09 (suspected Q18): save an expense dated the LAST day of the previous month while
   the month filter is on the current month → is it hidden? Change filter and confirm.
7. TC-EXP-10: delete the 500 paid expense → confirm text says paid amount is refunded →
   verify drawer +500 back.
8. TC-EXP-11: the partial WAPDA row's "Pay" button → modal prefills 1500. Complete the payment
   via EasyPaisa → WAPDA dues 0, EasyPaisa −1500.
9. TC-EXP-13/14/15: vendor khata hero balance, Pay flow with overdraft confirm (try paying
   more than the account has → "…Proceed anyway?" — cancel it), Receive flow on an advance
   vendor (use Test Advance supplier-style negative vendor if one exists in Expenses vendors;
   else create one with opening −500).
10. TC-EXP-16: categories modal — try deleting a USED category (blocked with exact toast),
    rename "General Overhead" to "General Overhead (Ops)", disable + re-enable a category.
11. Q16/Q17 note: log in as a user WITHOUT expenses:create (Test Cashier) — is the desktop
    "Record Expense" button gated? Are delete buttons gated? Log back as Admin.

REPORT: WAPDA dues (should be 0), Main Cash Drawer and EasyPaisa balances.
```

---

## 16. Prompt 14 — Accounts, Reports & Dashboard (T15/T16/T17)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suites T15, T16, T17 from docs/TEST_PLAN.md Sections 18, 19, 20
(TC-ACC-*, TC-REP-*, TC-DSH-*). By now the system has real transactions — good for报表 checks.

ACCOUNTS:
1. TC-ACC-01/02: Chart of Accounts — verify 1100 Cash & Bank lists the 3 real accounts with
   correct balances; 1200 A/R equals the sum of positive customer dues; 2100 A/P equals
   supplier dues; 4101 POS Sales equals known sales total; 5201 COGS-Milk equals milk
   purchases total. Screenshot the tree.
2. TC-ACC-03 (suspected Q19): New Account → no parent, type Asset, name "Petty Cash Box" →
   does it become a REAL Bank & Cash account (toast wording)? Note where it appears.
3. TC-ACC-05: delete attempts on a system account / an account with children / non-zero
   balance → the 3 exact toasts.
4. TC-ACC-07..10: Journal Entry — post a balanced 2-line JV (Dr 500 Cash / Cr 500 Sales via
   manual accounts), then try unbalanced (button disabled + toast), single line, and the
   Debit/Credit mutual-zero behavior. TC-ACC-11 (suspected Q20): after posting, do ANY COA
   balances visibly change? Record.

REPORTS:
5. TC-REP-01 P&L: write down Revenue, COGS, Gross, Expenses, Net from the report AND compute
   the same from the known transactions — compare. (Sales total = 600+900 + any throwaway
   sale the Sales History agent made; milk purchases = 5500+2200+1100 − returned 550 —
   recompute from actual data you find.)
6. TC-REP-02 Balance Sheet: Assets = Liab + Equity? Note the known simplification (equity
   only counts current-period P&L). Record whether it balances and the gap.
7. TC-REP-03 Day Book: all of today's events present, newest first.
8. TC-REP-06: open all 6 placeholder reports (Cash Flow, Item Performance, Low Stock,
   Purchase Register, Supplier Summary, Production Yield) — each shows the dashed
   "Report Generation" placeholder.
9. TC-REP-05 Item Stock Ledger with an item selected.

DASHBOARD:
10. TC-DSH-01..08: time-range chips change numbers; KPI cards vs known totals; weekly chart
    renders; Top Selling Items lists Yogurt; quick action buttons navigate correctly.
11. Q22 note: if the local time is past midnight UTC+5…, check whether today's early sales
    land on the wrong day in the Dashboard date filter (record only; hard to force).
```

---

## 17. Prompt 15 — E2E Golden Path (Full Business Day) ⭐ MOST IMPORTANT

```
=== UNIVERSAL CONTEXT ===

TASK: Execute the END-TO-END Golden Path from docs/TEST_PLAN.md Section 21 — a full business
day simulation with EXACT expected balances at every step. This single scenario covers ~90%
of the critical workflow. Read Section 21 fully first.

STEP 0 — CLEAN STATE: Settings → System Maintenance → Test Mode Reset (Clear All
Transactions) → confirm. This is EXPLICITLY AUTHORIZED by this prompt. Verify afterwards:
sales/purchases/batches/expenses = 0, but customers/suppliers/items/accounts SURVIVE, and all
balances are 0. THEN re-anchor balances: Bank & Cash → edit is not possible, so recreate the
opening amounts via Deposit: Main Cash Drawer deposit 5000 (Direct Entry), EasyPaisa deposit
10000, Meezan Bank stays 0. (If Test Mode Reset is unavailable/broken, note it as a Critical
bug and continue on whatever state exists, recomputing expectations from actual starting
balances — report which path you took.)

THEN EXECUTE PHASES A–H EXACTLY AS WRITTEN IN SECTION 21, ticking every checkbox:
A. Purchase 50 L @ 110 from Ghulam Farid, pay 3000 Online (EasyPaisa). Expected: supplier due
   2500, EasyPaisa 7000.
B. Allocate 40 L → Production "Yogurt (Dahi)" → batch In: 40 L Target 20 kg → complete with
   Loose 10 + 10 packs → Yield 100%, profit 1,600, stock 10 kg + 10 packs.
C. Start shift (opening float 5000) → Sale 1 Hassan Store 2 kg loose @300, paid 200 (khata
   +400) → Sale 2 walk-in 3 packs @900, cash 1000 change 100 → Expense 2500 partial paid 1000
   cash (WAPDA +1500 due) → Customer payment 400 cash (Hassan 0).
D. Close shift: Expected Till = 5500 (verify the app computes the same!) → Match Expected →
   leave 2000 → remit 3500 → exact match → submit. Drawer must show 2000, in-transit 3500.
E. Head Inbox: accept 3500 into Meezan Bank. Drawer untouched (2000), transit 0.
F. Pay WAPDA 1500 (EasyPaisa) and Ghulam Farid 2500 (EasyPaisa) → both dues 0, EasyPaisa 3000.
G. Business Day close: Cash Closing expected drawer = 2000 (compute it in the modal and
   compare), counted 2000, Stock Closing all match, Lock Day. Then verify POS blocks a sale
   on the closed day.
H. FINAL BALANCES (report actual vs expected in a table):
   Main Cash Drawer 2000 | EasyPaisa 3000 | Meezan Bank 3500 | TOTAL 8500 | transit 0
   Yogurt stock: 8 kg loose, 7 packs | All khata dues 0
   P&L: Revenue 1500, COGS 5500, Net −6500.
   Balance Sheet: record whether Assets = Liab + Equity (known simplification may cause a gap —
   report the gap amount).

Any mismatch at ANY step = BUG (Critical if money-related). Include the exact numbers.
```

---

## 18. Prompt 16 — Offline / Sync Suite

```
=== UNIVERSAL CONTEXT ===

TASK: Execute test suite Section 22 of docs/TEST_PLAN.md (TC-OFF-01 to TC-OFF-10) — the
offline-first behavior. Use browser DevTools Network throttling set to "Offline".

STEPS:
1. TC-OFF-01: go Offline → start a POS shift → make ONE cash sale (any cheap item/qty) →
   the sale completes instantly from local storage; SyncStatusBadge shows a pending count.
   Screenshot the badge.
2. TC-OFF-02: Offline → quick-register a new customer "Offline Test Buyer" → pending sync.
3. TC-OFF-03: hard refresh WHILE STILL OFFLINE → the offline sale/customer survive (Dexie).
4. TC-OFF-04: go Online → wait up to 30s → badge clears; verify in Sales History the bill
   exists; verify side effects applied exactly once: stock deducted once, khata charged once,
   drawer/cash account credited once.
5. TC-OFF-05 (idempotency): trigger a second manual sync (reload the page) → stock/khata/cash
   must NOT change again. Quote before/after numbers.
6. TC-OFF-06 (dead-letter): go Offline again, make another sale, keep offline through ~5 sync
   cycles (25s interval — wait ~2.5 min or use notifyPendingChange triggers) → status becomes
   'failed'. Screenshot the badge/failed count.
7. TC-OFF-07: back Online → trigger the retry (SyncStatusBadge retry action if present; else
   reload and wait) → the failed sale syncs.
8. TC-OFF-08: open POS in TWO tabs offline, make a sale in each, go online → no duplicates,
   only one tab syncs at a time (Web Locks mutex). Verify final totals.
9. TC-OFF-09: Offline → try saving a Purchase or Expense → expected: blocked/error (only POS
   sales + customers are offline-capable). Record actual behavior.
10. Note the bill number format of offline-created invoices (prefix + date + hex suffix).

REPORT: every before/after balance you compared for idempotency.
```

---

## 19. Prompt 17 — RBAC Suite (Role-wise Access)

```
=== UNIVERSAL CONTEXT ===

TASK: Execute Section 23 of docs/TEST_PLAN.md (TC-RBAC-01 to TC-RBAC-11).
Test users needed (create any that are missing in Settings → Users, PIN 1234):
"Test Cashier" (POS Cashier), "Test Manager" (Manager / Accountant), "Test Procurement"
(Milk Procurement Incharge), "Test Production" (Production Supervisor).

METHOD: for EACH user — log out, log in, then manually type each restricted URL
(/dashboard, /settings, /purchase, /pos, /expenses, /reports, /accounts, /bank-cash) into the
address bar and record: allowed (page renders) or redirected (to which route). Compare against
the matrix in Section 2 of the plan. DO NOT rely on the sidebar alone (hidden menu ≠ blocked).

KEY CHECKS:
- Cashier: allowed pos/sales-history/customers; /cash-control renders the "Cashier Shifts are
  on POS Counter" card (no tabs); /dashboard and /settings REDIRECT — note the redirect target.
- Manager: everything EXCEPT /settings (redirects to first allowed route — note which).
- Procurement: purchase/allocation/suppliers only.
- Production Supervisor: allocation/production/inventory/items only.
- TC-RBAC-07: as Admin, give Test Cashier an Extra Access grant (customers:delete) → log in
  as cashier → delete button visible on Customers → remove the grant → hidden.
- TC-RBAC-09: create a user whose role has ONLY retail_stock → verify cash_control is
  view-only for them.
- TC-RBAC-06: only Super Admin sees Reopen on a closed business day (check as Test Manager).
- TC-RBAC-10: while logged in as Test Cashier in tab A, disable that user from tab B (Admin),
  then act in tab A → note what happens.

Always END logged in as Admin. List every redirect target you observed — inconsistent
redirects are bugs.
```

---

## 20. Prompt 18 — Known Quirks Verification (Q01–Q24)

```
=== UNIVERSAL CONTEXT ===

TASK: docs/TEST_PLAN.md Section 24 lists 24 SUSPECTED bugs found in code review (Q01–Q24).
For EACH, perform the minimal reproduction and return a verdict line:
  Q<n> | CONFIRMED (bug) / REFUTED (works fine) / NOT TESTABLE (why) | 1-line evidence

Many may already be confirmed by earlier agents' result blocks — if you have those results
available, reuse their verdicts and only test the gaps. Priority order (money first):
Q01 (unpaid invoice saves without vendor), Q02 (material return over stock), Q04/Q05 (Net &
Refunded KPIs), Q06 (partial-return filter), Q07 (same-item return merge), Q08 (held-order
recall clobbers cart), Q11 (production rate fallback 120), Q15 (quick vendor dues link),
Q16/Q17 (expense permission gates), Q19 (cash-named account auto-creates wallet), Q21
(overdraft transfer), Q22 (UTC date boundary — check around midnight local, else NOT TESTABLE),
Q09/Q10 (unit/category no-ops), Q03 (fat/SNF always 0), Q12 (yield >100%), Q13 (allocation
cart lost on refresh), Q14 (handover Resolve prompt), Q18 (month filter), Q20 (journal no COA
effect), Q23 (duplicate item names), Q24.
```

---

## 21. Prompt C — Consolidate All Results

```
TASK: You are the QA coordinator. You will be given several RESULT BLOCKs produced by test
agents that tested the Mooco Dairy ERP (plan: "D:\Vibe Coding\mooco-dairy-accounting-app\docs\TEST_PLAN.md").

INPUT (paste below or attach files): all RESULT BLOCKs from Prompts 0–18.

PRODUCE:
1. A combined QA REPORT (markdown) with:
   - Executive summary: total passed/failed/blocked, overall release-readiness verdict
     (GO / GO AFTER FIXES / NO-GO) with a 3-line justification.
   - One table per module suite (T01–T17, Offline, RBAC, E2E) with TC-ID, verdict, note.
   - A consolidated BUG LIST sorted by severity: ID, title, module, severity, reproducing
     test ID, evidence. Deduplicate bugs reported by multiple agents (merge evidence).
   - The Q01–Q24 quirks verdict table.
   - Money-safety section: every check related to balances/double-application/cash custody
     and its verdict (from E2E Phase D–H, Cash Control suite, Offline idempotency).
   - OPEN QUESTIONS: anything blocked or untestable with the reason.
2. Save the report to "D:\Vibe Coding\mooco-dairy-accounting-app\docs\QA_REPORT.md".
3. List the top 5 fixes to do first.

Do not re-run tests; only consolidate what the result blocks say. If a result block is
missing, list that suite as NOT REPORTED.
```

---

## 22. Practical Tips (Roman Urdu)

- **Sequential chalayein, parallel nahi:** POS → Sales History → Cash Control chain ek hi
  dataset par chalti hai. Agar alag agents parallel chalein to balances confuse ho jayenge.
- **Ek lambi session mein dependent prompts:** Prompt 9 + 10 + 11 (POS → History → Cash
  Control) **ek hi agent** ko dene behtar hai (combine kar ke paste karein) kyunke wo ek hi
  shift/remittance chain test karte hain.
- **Har agent ke baad RESULT BLOCK save karein** (copy kar ke ek file mein) — aakhir mein
  Prompt C ko sab paste karein.
- **Agar agent ruk jaye** ("prerequisite missing"): usse bolein `"Continue: recreate the
  missing prerequisite per TEST_PLAN.md Section 3 and carry on."`
- **Screenshot evidence folder:** `screenshots/qa/` banwa lein — har BUG ke saath screenshot.
