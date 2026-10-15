# MOOCO Dairy ERP — Complete QA Test Plan & Verification Guide

> **Kaise use karein:** Yeh document poore app ka workflow-wise test plan hai. Har test case ke
> saath **steps**, **expected result** (exact toast/message jaisa app mein hai) aur ek checkbox
> `[ ]` diya gaya hai. Test karte waqt har case pass hone par `[x]` kar dein, fail hone par
> Bug Log (Section 12) mein note likhein. End-to-End Golden Path (Section 9) ek poori business
> day simulate karta hai jiska har balance table mein track kiya gaya hai — yeh sab se pehle
> follow karne wala scenario hai.

---

## Table of Contents

1. [Test Environment Setup](#1-test-environment-setup)
2. [Roles & Permission Matrix](#2-roles--permission-matrix)
3. [Test Data Setup (Master Data Order)](#3-test-data-setup-master-data-order)
4. [T01 — Login, Lock Screen & User Switching](#4-t01--login-lock-screen--user-switching)
5. [T02 — Settings (Company, Users, Roles, PIN, Danger Zone)](#5-t02--settings)
6. [T03 — Bank & Cash (Wallets)](#6-t03--bank--cash)
7. [T04 — Items (Product Catalog)](#7-t04--items)
8. [T05 — Inventory & Stock Audit](#8-t05--inventory--stock-audit)
9. [T06 — Suppliers & Ledger](#9-t06--suppliers--ledger)
10. [T07 — Purchase (Milk Intake, Supplies, Returns)](#10-t07--purchase)
11. [T08 — Allocation](#11-t08--allocation)
12. [T09 — Production](#12-t09--production)
13. [T10 — POS Counter Sales](#13-t10--pos-counter-sales)
14. [T11 — Sales History & Returns/Refunds](#14-t11--sales-history--returnsrefunds)
15. [T12 — Cash Control (Head Inbox, Business Days, Audit, Drawers)](#15-t12--cash-control)
16. [T13 — Customers & Khata](#16-t13--customers--khata)
17. [T14 — Expenses & Vendors](#17-t14--expenses--vendors)
18. [T15 — Accounts (Chart of Accounts + Journal)](#18-t15--accounts)
19. [T16 — Reports](#19-t16--reports)
20. [T17 — Dashboard](#20-t17--dashboard)
21. [E2E Golden Path — Full Business Day Simulation](#21-e2e-golden-path--full-business-day-simulation)
22. [Offline / Sync Test Suite](#22-offline--sync-test-suite)
23. [RBAC Test Suite (Role-wise Access)](#23-rbac-test-suite-role-wise-access)
24. [Known Quirks / Suspected Bugs — Verify & Confirm](#24-known-quirks--suspected-bugs--verify--confirm)
25. [Bug Log Template](#25-bug-log-template)
26. [Final Sign-off Checklist](#26-final-sign-off-checklist)

---

## 1. Test Environment Setup

### 1.1 Prerequisites

- [ ] **TC-SETUP-01** — Dependencies install hon:
  ```bash
  npm install
  ```
  Expected: `node_modules` ban jata hai, koi error na aaye.

- [ ] **TC-SETUP-02** — Environment variables set hon:
  `.env.local` mein `VITE_SUPABASE_URL` aur `VITE_SUPABASE_ANON_KEY` valid Supabase project ke
  saath maujood hon.

- [ ] **TC-SETUP-03** — App start karein:
  ```bash
  npm run dev
  ```
  Expected: `http://localhost:3000` par app khul jaye. Lock screen / login screen nazar aaye.

- [ ] **TC-SETUP-04** — **Database migrations applied hon** (Supabase dashboard/CLI se, order mein):
  1. `cash_control_foundation` (cash custody tables + RPCs)
  2. `secure_pin_auth` (**required** — hashed PINs, `app_login`/`app_verify_pin` RPCs, lockout)
  3. `atomic_financial_ops` (**required** — balance/stock delta RPCs)
  4. `drop_legacy_pin` (optional, sab se aakhir mein)

- [ ] **TC-SETUP-05** — **First login (fresh install):** seed owner account
  **Username: `admin` · PIN: `1234`** (README ke mutabiq migration se seed hota hai).
  Expected: Login kamyab ho, "Welcome, Admin!" toast aaye.

- [ ] **TC-SETUP-06** — Fresh state ke liye (optional): `Settings → System Maintenance →
  Test Mode Reset (Clear All Transactions)` use karein. Expected: confirm dialog aaye; reset ke
  baad sales/purchases/batches/expenses = 0 lekin customers, suppliers, items, accounts barqarar.

> **Test tools:** Browser DevTools (Network tab → "Offline" toggle for offline tests), do browser
> tabs (cross-tab tests), ek second browser profile (concurrent user tests).

---

## 2. Roles & Permission Matrix

Yeh 5 built-in roles hain (`DEFAULT_SYSTEM_ROLES`). Har route `ProtectedRoute` se guarded hai —
permission na hone par user **pehli allowed route par redirect** hota hai (fallback `/pos`).

| Module (route) | Super Admin (Owner) | Manager / Accountant | POS Cashier | Procurement Incharge | Production Supervisor |
|---|---|---|---|---|---|
| dashboard | ✅ | ✅ | ❌ | ❌ | ❌ |
| purchase | ✅ | ✅ | ❌ | ✅ | ❌ |
| allocation | ✅ | ✅ | ❌ | ✅ | ✅ |
| production | ✅ | ✅ | ❌ | ❌ | ✅ |
| pos | ✅ | ✅ | ✅ | ❌ | ❌ |
| sales_history | ✅ | ✅ | ✅ | ❌ | ❌ |
| cash_control | ✅ | ✅ | ✅ | ❌ | ❌ |
| items | ✅ | ✅ | ❌ | ❌ | ✅ |
| inventory | ✅ | ✅ | ❌ | ❌ | ✅ |
| customers | ✅ | ✅ | ✅ | ❌ | ❌ |
| suppliers | ✅ | ✅ | ❌ | ✅ | ❌ |
| expenses | ✅ | ✅ | ❌ | ❌ | ❌ |
| bank_cash | ✅ | ✅ | ❌ | ❌ | ❌ |
| accounts | ✅ | ✅ | ❌ | ❌ | ❌ |
| reports | ✅ | ✅ | ❌ | ❌ | ❌ |
| settings / users | ✅ | ❌ | ❌ | ❌ | ❌ |

Extra rules (verify in Section 23):
- Super Admin delete/disable **nahi** ho sakta; role dropdown mein nazar nahi aata.
- System roles delete nahi ho sakte; users-assigned role delete nahi ho sakta.
- Per-user "Extra Access" grants role ke upar merge hote hain (`module` ya `module:action` keys).
- `retail_stock` permission dene par `cash_control` ki sirf **view** access implied hai.
- Sirf Super Admin business day **reopen** kar sakta hai.

---

## 3. Test Data Setup (Master Data Order)

Yeh setup E2E Golden Path (Section 21) ke numbers ke sath match karta hai. **Isi order mein
banayein** taki balances sahi calculate hon.

### Step 1 — Financial Accounts (Bank & Cash page)

| # | Account Name | Type | Drawer? | Opening Balance |
|---|---|---|---|---|
| 1 | Main Cash Drawer | Cash | ✅ Enable as Cash Drawer | 5,000 |
| 2 | EasyPaisa | Wallet | ❌ | 10,000 |
| 3 | Meezan Bank | Bank | ❌ | 0 |

- [ ] Phir `Settings → Accounting & Ledger` mein set karein:
  - **Default Till / Counter Cash Drawer** = Main Cash Drawer
  - **Default Bank / Digital Wallet** = EasyPaisa

### Step 2 — Suppliers (Suppliers page)

| Field | Value |
|---|---|
| Name | Ghulam Farid Dairy |
| Phone | 0300-1111111 |
| Supply Category | Milk |
| Default Milk Variety | Buffalo Milk |
| Default Rate / Liter | 110 |
| Opening Balance | 0 |

### Step 3 — Items (Items page)

1. **Raw Milk (Buffalo)** — system milk item hota hai (System Core badge). Agar nahi hai to
   banayein: Usage Class = Raw material, Base Unit = Liter, Cost 110.
2. **Yogurt (Dahi)** — Sale product + In-House production:
   - Usage Class: `Sale product`
   - Production & Supply Source: `In-House`
   - Base Unit: Kilogram
   - Master Landed Cost: 220 / kg (40L milk @110 → 20 kg)
   - **Recipe:** Standard Input Quantity = **10 Liters**, Expected Output = **5 kg**
   - **Selling Options (variant):** Name = `Dahi 1kg Pack`, Pack Qty = 1, Deduct Stock 1 kg,
     Price = **300**
   - Default Sales Rate = 300, Allow Loose Sale = ON, Quick Amounts = 100, 300, 500

### Step 4 — Customer (Customers page)

| Field | Value |
|---|---|
| Name | Hassan Store |
| Phone | 0321-2222222 |
| City | Lahore |
| Initial Balance | 0 |

### Step 5 — Expense Vendor (Expenses → Vendors Directory)

| Field | Value |
|---|---|
| Name | WAPDA Electricity |
| Service / Type | Electricity & Utility |
| Phone | 0301-3333333 |

---

## 4. T01 — Login, Lock Screen & User Switching

**Page:** `components/UserSwitcherModal.tsx` · **RPCs:** `app_verify_pin`, `app_login_with_pin`, `app_login`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-AUTH-01 | Lock screen bina user band nahi hota | Logout karein, phir backdrop / X button click karein | Lock screen band nahi hoti (no session = no dismiss) | [ ] |
| TC-AUTH-02 | User tile → PIN flow | Tile click karein → PIN dots nazar aayein → PIN enter karein | 4th digit par auto-submit; "Welcome, {name}!" toast | [ ] |
| TC-AUTH-03 | Ghalat PIN | Tile select kar ke ghalat PIN enter karein | Toast **"Ghalat PIN code!"**, vibration, PIN clear ho jaye, wapas PIN screen | [ ] |
| TC-AUTH-04 | Username fallback | "Login with username" → username `admin` + PIN | Login ho jaye | [ ] |
| TC-AUTH-05 | Ghalat username | Bilkul ghalat username + PIN | Toast **"Ghalat Username ya PIN code!"** | [ ] |
| TC-AUTH-06 | Khali fields | Username login mein khali fields ke sath submit | Toast "Username enter karein" / "Password / PIN code enter karein" | [ ] |
| TC-AUTH-07 | Cashier auto-redirect | Cashier role wale user se login karein | ~120ms baad **/cash-control** par land ho (POS nahi) | [ ] |
| TC-AUTH-08 | Session restore | Login kar ke page hard-refresh karein | User logged-in rahe, "Loading module..." spinner ke baad seedha app, lock screen na aaye | [ ] |
| TC-AUTH-09 | Invalid saved session | DevTools → localStorage se `mooco_active_user_id` ki value corrupt karein → refresh | Lock screen khul jaye (kabhi bhi auto admin pick na ho) | [ ] |
| TC-AUTH-10 | Header user pill | Header mein user pill click karein | Name + role nazar aaye; dropdown: "Switch User / Lock" aur "Logout / Sign Out" | [ ] |
| TC-AUTH-11 | Switch user | "Switch User / Lock" karein → dusre user se login | Session switch ho jaye | [ ] |
| TC-AUTH-12 | Logout | "Logout / Sign Out" karein | Lock screen wapas aaye; refresh ke baad bhi locked rahe | [ ] |
| TC-AUTH-13 | Brute-force lockout | 8 dafa ghalat PIN enter karein (same user) | 15 min ke liye attempts block hon (server-side lockout) | [ ] |

---

## 5. T02 — Settings

**Page:** `pages/Settings.tsx` · Sirf Super Admin · Auto-save on change

### 5.1 Company Profile & Appearance

| ID | Test | Expected Result | ✓ |
|---|---|---|---|
| TC-SET-01 | Company name change karein | Header/dashboard/ receipt preview mein turant update ho; auto-save toast na bhi aaye to reload par persist ho | [ ] |
| TC-SET-02 | Shifts list | "Daily Milk Collection Shifts" mein shift add/remove. **Aakhri shift remove karne par** toast: "Kam az kam ek shift zaroori hai"; duplicate par "Shift already exists" | [ ] |
| TC-SET-03 | Zoom slider | 80%–250% set karein → page scale ho; reload par persist ho (`app_zoom_scale`) | [ ] |
| TC-SET-04 | Theme toggle | Dark/Light switch + reload par persist (`app_theme`) | [ ] |
| TC-SET-05 | "Save & Apply" button | Click par toast "All configuration changes are saved automatically." — kuch bhi extra save na karna chahiye (sab auto-save hota hai) | [ ] |

### 5.2 Accounting & Sales Settings

| ID | Test | Expected Result | ✓ |
|---|---|---|---|
| TC-SET-06 | Payment modes | POS payment modes toggle karein. **Aakhri mode disable karne par** toast: "Kam az kam ek payment mode active hona chahiye" | [ ] |
| TC-SET-07 | Bill prefix | Prefix `INV-` set karein → naye POS bills isi prefix se banein | [ ] |
| TC-SET-08 | Thermal preview | Footer greeting change karein → Live 80mm preview update ho | [ ] |
| TC-SET-09 | Default accounts | Default drawer/wallet change karein → naye sales/expenses naye accounts se route hon | [ ] |

### 5.3 Users & Roles (RBAC)

| ID | Test | Expected Result | ✓ |
|---|---|---|---|
| TC-SET-10 | Add Operator | "Add Operator" → Name/Username/PIN 1234/Role Cashier → "Create User". Naya user lock screen tile par nazar aaye | [ ] |
| TC-SET-11 | PIN validation | New user par khali/ghalat PIN → toast **"4-Digit PIN code enter karein (e.g. 1234)"** | [ ] |
| TC-SET-12 | Short PIN via context | 4-digit se kam PIN (agar page validation bypass ho) → context toast "Enter a PIN of 4 to 10 digits." | [ ] |
| TC-SET-13 | Edit user, PIN blank | Existing user edit karein, PIN **khali** chhorein → toast "PIN 4 se 10 digits ka hona chahiye." nahi aana chahiye, balki purana PIN barqarar rahe (placeholder: "Same rehne ke liye khali chhorein") | [ ] |
| TC-SET-14 | PIN change verify | User ka PIN change karein → purane PIN se login **fail**, naye se **pass** | [ ] |
| TC-SET-15 | Super Admin protection | Super admin row par delete button na ho, status toggle disabled ho, role dropdown mein "Super Admin / Owner (Locked)" | [ ] |
| TC-SET-16 | Disable user | Kisi user ko Inactive karein → wo lock screen tiles se gayab ho jaye | [ ] |
| TC-SET-17 | Delete current user | **Jo user logged-in hai** usko delete karein → confirm ke baad terminal lock ho jaye | [ ] |
| TC-SET-18 | New Role | "New Role" → sirf ek module select kar ke create. Bina permission → toast "Kam az kam ek permission action select karein" | [ ] |
| TC-SET-19 | Role presets | Select All / View-Only All / Clear presets kaam karein; kisi action ko tick karne par `{module}:view` khud add ho | [ ] |
| TC-SET-20 | Delete system role | Built-in role delete karein → toast "System Built-in role cannot be deleted" | [ ] |
| TC-SET-21 | Delete assigned role | Kisi user ko assign role delete karein → toast "This role is currently assigned to users. Reassign them first." | [ ] |
| TC-SET-22 | Extra Access | User ko role ke ilawa extra module grant karein → us module ka access page par mil jaye (Section 23 se verify) | [ ] |

### 5.4 Danger Zone (⚠️ destructive — test DB par hi karein)

| ID | Test | Expected Result | ✓ |
|---|---|---|---|
| TC-SET-23 | Test Mode Reset | Confirm text master data keep karne ka kehta hai; reset ke baad sales/purchases/batches/expenses/journal = 0; customers/suppliers/items/accounts **barqarar**; balances 0 | [ ] |
| TC-SET-24 | Selective reset | "Selective Module Data Reset" mein counts actual data se match karein; sirf selected module ka data jaye; Cancel par kuch na badle | [ ] |

---

## 6. T03 — Bank & Cash

**Page:** `pages/BankCash.tsx` · RPCs: `adjust_account_balance`, `transfer_between_accounts`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-BC-01 | Add wallet | Add → Name "Test Wallet", Type Wallet, Opening 0 → "Create Account" | Account card nazar aaye, Consolidated Total update ho | [ ] |
| TC-BC-02 | Drawer chip | Cash + drawer-enabled account par | **DRAWER** chip nazar aaye; Bank/Wallet par drawer checkbox hi na ho | [ ] |
| TC-BC-03 | Deposit | Deposit → account, amount 1000, date → Confirm Deposit | Balance +1000; ledger mein Inflow entry | [ ] |
| TC-BC-04 | Withdrawal | Withdraw → amount 500 → Confirm Withdrawal | Balance −500; Outflow entry | [ ] |
| TC-BC-05 | Transfer | Transfer: Source Main Cash Drawer, Dest EasyPaisa, 1000 → Process Transfer | Source −1000, Dest +1000, **2 ledger rows** (Transfer_Out + Transfer_In) | [ ] |
| TC-BC-06 | Same-account transfer | Source = Destination | Toast **"Source and Destination cannot be same"** | [ ] |
| TC-BC-07 | Contra account | Withdrawal par contra manual account select karein | Dono accounts ke balance adjust hon; category = contra account name | [ ] |
| TC-BC-08 | Edit account | Name change + Inactive toggle → Save Changes | Balance **change na ho** (read-only); inactive account doosre selectors (Expense/Transfer) se gayab ho | [ ] |
| TC-BC-09 | Delete clean account | Bina transactions wala test wallet delete karein | Delete ho jaye | [ ] |
| TC-BC-10 | Delete used account | Transactions wale account par delete try karein | Toast: `Cannot delete "{name}": {n} transaction(s) recorded on this account!` | [ ] |
| TC-BC-11 | Cash in Transit banner | Koi remittance pending ho (Section 15 ke baad) | Consolidated view par banner: "Cash in Transit: Rs X (N remittances pending receive)"; account-specific view par na ho | [ ] |
| TC-BC-12 | Unified ledger | POS sale, expense, customer payment kar ke ledger dekhein | Har source ki alag entry (POS Sale / Expense / Customer Receipt) bina duplication ke nazar aaye | [ ] |
| TC-BC-13 | Overdraft transfer | Jitna balance hai us se zyada transfer karein | Server behavior note karein (RPC allow karta hai ya block) — record karein | [ ] |

---

## 7. T04 — Items

**Page:** `pages/Items.tsx` · Permission: `items:create/edit/delete`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-ITM-01 | Create product | Basic Info: Name, Usage Class = Sale product, Base Unit, rates → "Save Master Record" | Item list mein nazar aaye; toast ke sath | [ ] |
| TC-ITM-02 | Required validations | Name khali chhor kar save | Toast **"Display Name is required"** (bina save) | [ ] |
| TC-ITM-03 | Usage class required | Usage Class khali → save | Toast "At least one Usage Class is required" | [ ] |
| TC-ITM-04 | Unit required | Base Unit khali → save | Toast "Primary Base Unit is required" | [ ] |
| TC-ITM-05 | Recipe tab | Source = In-House par Recipe tab nazar aaye; input 10L / yield 5kg + additive add karein | Save ke baad recipe persist ho | [ ] |
| TC-ITM-06 | Variant validation | Selling Options mein sirf Name dalein (qty khali) → Add | Toast "Name and Content Quantity are required" | [ ] |
| TC-ITM-07 | Variant add | `Dahi 1kg Pack`, Pack Qty 1, Price 300 → "Add to Sales Menu" | Variant list mein nazar aaye; POS card par "{n} Packs" | [ ] |
| TC-ITM-08 | Quick amounts | 50/100/…/1000 chips ya comma input se quick amounts set karein | POS quick-amount chips mein reflect hon | [ ] |
| TC-ITM-09 | System item protection | System milk item kholein | Name/category/unit/source disabled + "System Protected Milk Variety" banner; delete button na ho | [ ] |
| TC-ITM-10 | Delete blocked (recipe) | Recipe mein use hone wale raw item ko delete karein | **"Action Blocked"** modal: "cannot be deleted because it is a required ingredient." | [ ] |
| TC-ITM-11 | Delete with impact | Kisi unused item ko delete karein | Impact Analysis modal (inventory logs / purchase history counts) → Confirm Delete | [ ] |
| TC-ITM-12 | Filter tabs & search | All/Sale/Raw/Packaging tabs + search | Counts aur filtering sahi hon | [ ] |
| TC-ITM-13 | Sorting | Desktop table header click karein | Asc/desc sort ho | [ ] |
| TC-ITM-14 | ⚠️ Unit Manager | Custom unit create kar ke "Add Unit" | Toast success aata hai — **lekin verify karein ke unit actually list/reload mein persist karti hai ya nahi (expected: NO-OP BUG)** | [ ] |
| TC-ITM-15 | ⚠️ Category remove | Categories modal mein category remove karein | Verify: remove actually kaam karta hai ya sirf toast (expected: NO-OP BUG) | [ ] |

---

## 8. T05 — Inventory & Stock Audit

**Page:** `pages/Inventory.tsx` · RPC: `adjust_item_stock`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-INV-01 | KPIs | Total Items, Asset Valuation, Low Stock, Out of Stock counts | Sale products valuation **selling price** par, baqi **cost** par | [ ] |
| TC-INV-02 | Variant sub-rows | Variant wale item par packaged variants sub-rows mein | Har variant ka apna qty + audit button | [ ] |
| TC-INV-03 | Loose audit | Audit → item select → System Counter dikhaye → Actual count dalein → Reason "Stock Count Correction" → Confirm | Toast "Stock synchronized for {target}"; naya qty sahi; Audit History mein signed difference + reason + note | [ ] |
| TC-INV-04 | Variant audit | Target Scope = koi variant → count change karein | Sirf us **variant** ka stock badle, loose na ho | [ ] |
| TC-INV-05 | Invalid count | Negative / non-numeric count | Toast "Invalid quantity"; submit block | [ ] |
| TC-INV-06 | Status chips | Reorder level se kam stock | "Low" status; 0 par "Out" | [ ] |
| TC-INV-07 | Audit history | Koi adjustment ke baad history tab | Saari entries date + difference + notes ke sath | [ ] |

---

## 9. T06 — Suppliers & Ledger

**Page:** `pages/Suppliers.tsx` · RPC: `adjust_supplier_balance`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-SUP-01 | Add supplier | Section 3 wala Ghulam Farid banayein | List + KPIs update; rate chip "Rs 110/L" | [ ] |
| TC-SUP-02 | Required validation | Naam ya phone khali → Save | Toast **"Supplier name and phone are required"** | [ ] |
| TC-SUP-03 | Opening balance (+) | Positive opening balance 1000 | Ledger mein "Opening Balance" row; balance "Payable (Dena Hai)" | [ ] |
| TC-SUP-04 | Opening balance (−) | Negative (−500) | "Advance Paid" badge | [ ] |
| TC-SUP-05 | Payment | Record Payment → 1000, Cash, account select → Confirm Payment | Ledger mein "Payment Paid (Cash)" Debit row; balance kam; account balance −1000 | [ ] |
| TC-SUP-06 | No accounts case | Sab accounts inactive kar ke payment kholein | Warning **"Koi Cash / Bank account mojood nahi hy. Pehle 'Bank & Cash' module men account banayein."** + submit disabled | [ ] |
| TC-SUP-07 | Delete with history | Transactions wale supplier ko delete karein | Record karein — block hota hai ya nahi | [ ] |
| TC-SUP-08 | Ledger filters | Milk Supplies / Raw Materials / Payments filters + date ranges | Running balance har filter mein sahi | [ ] |
| TC-SUP-09 | WhatsApp statement | Phone ke sath WhatsApp button | Statement text (Total Purchases / Paid / Balance + last 5 rows) ke sath wa.me link khule (92-prefix normalized) | [ ] |

---

## 10. T07 — Purchase

**Page:** `pages/Purchase.tsx` · Tabs: Milk Intake / Supplies & Material

### 10.1 Milk Intake

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-PUR-01 | Full paid intake | 20 L @ 110, Paid = **Full**, Cash, account = Main Cash Drawer → Save Intake | Toast success; Total Bill 2200; supplier ledger Credit 2200; drawer −2200 | [ ] |
| TC-PUR-02 | Partial / Khata | 50 L @ 110 = 5500, Paid 3000 (Online/EasyPaisa) → Save | Status "Partial (Rs 3000)"; **Added to Khata 2500**; supplier due +2500; EasyPaisa −3000 | [ ] |
| TC-PUR-03 | Unpaid (On Khata) | Paid 0 → Save | Status "On Khata (Unpaid)"; poora amount supplier due | [ ] |
| TC-PUR-04 | Required validations | Supplier khali / qty 0 / rate 0 | Toasts: "Please select a supplier / farmer", "Please enter a valid volume (Liters) greater than 0" | [ ] |
| TC-SUP-AUTO | Auto-fill | Supplier select karte hi | Milk variety + default rate (110) auto-fill hon; balance badge "Rs X Due" | [ ] |
| TC-PUR-05 | Form reset behavior | Save ke baad | Supplier/qty/rate/rate reset, lekin **Date & Shift barqarar** (rapid intake) | [ ] |
| TC-PUR-06 | No accounts warning | Koi account na ho + paid > 0 | Amber banner "⚠️ Koi Cash Drawer ya Bank Account add nahi hy!…" | [ ] |
| TC-PUR-07 | Vendor Overview panel | Supplier select | Current Due, Projected Due, Recent Deliveries update hon | [ ] |

### 10.2 Supplies & Material (Invoice builder)

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-PUR-08 | Add lines | Product search se 2 products add karein | Qty 1, rate = cost price; re-add qty increment | [ ] |
| TC-PUR-09 | Edit line modal | Item name click → qty 5 / rate change / **Total Amount edit** → Update | Total edit karne par qty **back-compute** ho; toast "Product updated" | [ ] |
| TC-PUR-10 | Cash buy | **Vendor khali** + fully paid cash → Save | Button label **"Save Cash Buy"**; toast "Cash Purchase of Rs X logged!"; supplier_id null | [ ] |
| TC-PUR-11 | Vendor bill | Vendor select + partial payment → Save Purchase Bill | Due vendor khata mein; toast "Purchase bill of Rs X saved!" | [ ] |
| TC-PUR-12 | Clear invoice | "Clear" | `window.confirm("Clear current invoice?")` → sab reset | [ ] |
| TC-PUR-13 | ⚠️ Unsaved vendor + due | Vendor **khali**, payment incomplete → button "Select Vendor to Save" dikhaye par click karein | **BUG CANDIDATE:** kya save ho jata hai (supplier_id null)? Expected nahi, record karein | [ ] |

### 10.3 Returns

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-PUR-14 | Milk return | Log → Return → qty 5, Reason "Data Entry Error" → Confirm Return | Supplier ledger Reverse/adjust; **Allocation list mein "Return: {supplier}" amber badge row**; audit log "Returned" badge | [ ] |
| TC-PUR-15 | Milk return blocked | Jo milk already allocate ho chuka | Toast **"Cannot return milk: Already allocated to production stock."** — modal khule hi nahi | [ ] |
| TC-PUR-16 | Return qty > max | Max se zyada qty | Toast "Return quantity cannot exceed available limit of {max}" | [ ] |
| TC-PUR-17 | "Other" reason | Reason = Other | Text input required ho | [ ] |
| TC-PUR-18 | ⚠️ Material return over-stock | Material ka return qty **current stock se zyada** lekin **original qty se kam** | Kya allow hota hai? (max sirf original qty check karta hai) — record karein | [ ] |

---

## 11. T08 — Allocation

**Page:** `pages/Allocation.tsx`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-ALC-01 | Source lists | Unallocated (n) / Retail Stock (n) switch | Fresh purchases list hon; Return rows amber "Return" badge ke sath | [ ] |
| TC-ALC-02 | Add to cart + presets | Row + → qty modal: Max Available dikhaye; 5L/10L/50%/100% presets | Estimated Value = qty × rate live update | [ ] |
| TC-ALC-03 | Qty > max | Available se zyada qty | Toast "Quantity cannot exceed available {max} L" | [ ] |
| TC-ALC-04 | Weighted avg rate | Cart mein 20L @110 + 10L @120 | Avg Cost = **(2200+1200)/30 = Rs 113.33/L** | [ ] |
| TC-ALC-05 | Destination coupling | Source Retail Stock select karein | Destination **auto Production** set ho; Retail option hide ho | [ ] |
| TC-ALC-06 | Retail→Retail block | Retail stock source + Retail destination force karein | Toast **"Cannot allocate from Retail Stock back to Retail Counter."** | [ ] |
| TC-ALC-07 | Allocate → Retail | Unallocated milk → Retail → Confirm | Toast "Successfully allocated X L to Retail"; item stock +; `inventory_logs` entry; supplier allocation remaining kam | [ ] |
| TC-ALC-08 | Allocate → Production | 40 L → Production, Product "Yogurt (Dahi)" → Confirm | Production board par **naya batch** (In: 40 L); allocation remaining update | [ ] |
| TC-ALC-09 | Partial allocation | 50 L mein se sirf 10 L allocate karein | Row remaining 40 L dikahye; poora allocate hone par list se gayab | [ ] |
| TC-ALC-10 | ⚠️ Cart persistence | Cart mein items rakhi, page refresh | **Cart khali ho jati hai (in-memory only)** — expected, verify karein | [ ] |
| TC-ALC-11 | Empty cart submit | Confirm bina cart | Button disabled / toast "Allocation cart is empty" | [ ] |

---

## 12. T09 — Production

**Page:** `pages/Production.tsx` · Pipeline: Start → Processing → Finish → Completed/Cancelled

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-PRD-01 | Batch card | E2E ka 40L batch board par | Priority badge, batch #, "In: 40 L", Target: 20 kg | [ ] |
| TC-PRD-02 | Drag & drop | Card ko Start → Processing drag karein | Toast `Batch moved to "Processing"`; column counts update | [ ] |
| TC-PRD-03 | Move pills | Card expand → Move to Stage pills | Stage change ho; log "Moved to {stage}" | [ ] |
| TC-PRD-04 | Cost analysis | Batch modal kholein | Raw Milk Base = **40 × 110 = 4400** (avg rate); Total Est. Cost + recipe additives | [ ] |
| TC-PRD-05 | Default output | Finish stage par complete form | Loose qty default = **estimated output (20)** (ya input × 0.85 jab estimate na ho) | [ ] |
| TC-PRD-06 | Complete batch | Loose 10 kg + `Dahi 1kg Pack` = 10 units → Mark Batch Completed | Toast "Batch completed & added to inventory!"; **Inventory: Yogurt loose +10 kg, variant +10**; Yield 100% | [ ] |
| TC-PRD-07 | Yield > 100% | Output target se zyada dalein | Koi clamp nahi — Yield % 100 se upar (record karein intended ya not) | [ ] |
| TC-PRD-08 | Zero output | 0 output ke sath complete karein | Behavior record karein (allow/block) | [ ] |
| TC-PRD-09 | Complete before Finish | Start stage se "Complete Batch" | Option na mile / note: "Drag card to column or use card Move buttons" | [ ] |
| TC-PRD-10 | Cancel batch | "Cancel Batch" → reason khali → Confirm | Block ho; reason likh kar → toast "Batch cancelled"; History mein Cancelled badge | [ ] |
| TC-PRD-11 | History & Log | Search + date filter + row expand | Profit (colored), Yield % (≥95 emerald / ≥85 amber / < rose), lifecycle logs | [ ] |
| TC-PRD-12 | ⚠️ Rate fallback | Jab **koi allocation hi na ho** batch cost | Raw milk rate **120/L fallback** use hota hai (hardcoded) — verify | [ ] |
| TC-PRD-13 | Double-click guard | "Mark Batch Completed" par tezi se double click | Sirf ek dafa complete ho (inventory double na badle — deterministic log IDs) | [ ] |

---

## 13. T10 — POS Counter Sales

**Page:** `pages/POS.tsx` · Offline-first (Dexie) · RPC: `pos_sync_order_effects` (sync par)

### 13.1 Shift gating

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-POS-01 | Sale without shift | Bina shift cart bana kar checkout | Button label **"Start Shift First — Sale Blocked"**; toast "No active shift. Please start a shift first." + **PosShiftModal auto-open** | [ ] |
| TC-POS-02 | Context double-guard | (Agar UI bypass ho) | Toast "Start your shift in Cash Control before making a sale." — kuch record na ho | [ ] |
| TC-POS-03 | Start shift modal | "Start Shift" → drawer select (agar >1) → Opening Cash dikha kar "Start Shift" | Toast "Shift started — opening cash Rs X"; header shift chip (pulsing) "Float Rs X" | [ ] |
| TC-POS-04 | Handover opening | Pichli shift ne float chhora ho | Opening value = pending handover ka declared_amount; pill "Handover from {name}" | [ ] |
| TC-POS-05 | One shift per user/drawer | Doosri shift start karein jab already active | Toast "Another cashier's shift is active on this drawer." (ya second-shift guard) | [ ] |
| TC-POS-06 | Drawer non-cash block | Bank account ko drawer banane ki koshish | Drawer sirf **Cash-type** account ban sakta hai (checkbox hi Bank/Wallet par na ho) | [ ] |
| TC-POS-07 | No drawer warning | Koi drawer-enabled account na ho | Amber Urdu warning "Koi drawer-enabled Cash account nahi mila…" | [ ] |

### 13.2 Catalog & cart

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-POS-08 | Search & categories | Search + "All (n)" / category chips | Counts aur filtering sahi | [ ] |
| TC-POS-09 | Add to cart | Product click | Qty +1; in-cart badge; stock badge update | [ ] |
| TC-POS-10 | Variant dialog | Variant product click | Variant/Loose pills, qty stepper, quick chips | [ ] |
| TC-POS-11 | Amount mode | "Or Select by Amount (Rs)" mein 500 dalein | "= {qty} {unit}" conversion live (500/300 = 1.667 kg); Add to Cart label qty+amount dikhaye | [ ] |
| TC-POS-12 | Pre-packaged only | `allow_loose_sale` OFF item | Sirf variants choose hon, Loose option na ho | [ ] |
| TC-POS-13 | Long-press custom | 250ms long-press / right-click | Quick price/qty modal khule | [ ] |
| TC-POS-14 | Stock block | Stock se zyada qty | Toast "Insufficient stock for {name}" / "Max stock reached" | [ ] |
| TC-POS-15 | Negative stock setting | Settings mein "Allow Negative Stock Sales" ON | Ab stock se zyada sale ho jaye | [ ] |
| TC-POS-16 | Edit cart item | Item name click → rate/qty/total edit → Save Changes | Total edit qty back-compute; validations: "Please enter a valid rate/price", "Insufficient stock…" | [ ] |
| TC-POS-17 | Cart discount | Rs 100 flat + toggle % 10% | grandTotal = max(0, subtotal − discount); subtotal **0** par % discount NaN/0 na kare | [ ] |
| TC-POS-18 | Hold / recall (F8) | Cart bana kar Hold → Parked modal → Recall | Toast "Order held for {name}"; recall par cart wapas; **localStorage `pos_held_orders`** mein persist (refresh test) | [ ] |
| TC-POS-19 | ⚠️ Recall overwrites | Hold ke baad **naya cart** bana kar purana recall karein | **Current cart bina confirm replace ho jata hai** — bug candidate, record karein | [ ] |
| TC-POS-20 | Quick register customer | + button → naam "Test Buyer", Due opening 250 → Register & Select | Customer bane **aur cart mein auto-select** ho; ledger opening ctx row | [ ] |
| TC-POS-21 | Keyboard shortcuts | F2 search, F4 customer, F8 hold, F9 checkout, Esc modal | Sab kaam karein; shortcuts modal sahi listing dikhaye | [ ] |

### 13.3 Payment & checkout

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-POS-22 | Customer partial | Hassan Store: 2 kg loose Dahi @300 = 600; Paid **200** | Status "**Added to Customer Ledger: Rs 400**" | [ ] |
| TC-POS-23 | Customer full | Paid 600 | "Fully Settled (Rs 0 Added to Ledger)" | [ ] |
| TC-POS-24 | Customer overpay | Paid 700 | "Cash Change to Return: Rs 100" | [ ] |
| TC-POS-25 | Walk-in cash | 3 packs @300 = 900; Cash In 1000 | Chip **"Change: Rs 100"**; Exact/500/1000/2000/5000 chips; Cash In 800 → "Short: Rs 100" | [ ] |
| TC-POS-26 | Walk-in credit block | Walk-in par paid 0 | Due force 0 (walk-in par udhaar nahi) | [ ] |
| TC-POS-27 | Credit auto-revert | Customer select kar ke Credit mode, phir customer reset | Mode auto Cash par wapas | [ ] |
| TC-POS-28 | Online payment | Mode Online | Paid EasyPaisa (defaultDigitalAccount) se route ho; ledger "Online Sale" | [ ] |
| TC-POS-29 | Checkout + receipt | F9 / Confirm & Pay | "Sale Completed" receipt modal (Inv #, items, totals, change); Print Receipt kaam kare | [ ] |
| TC-POS-30 | Header counters | Sales ke baad | "Today: Rs X", "Bills: n", Cash/Online/Credit dots sahi | [ ] |
| TC-POS-31 | Day locked block | Business day close ke baad sale | Toast "Business Day has been closed & locked! Reopen day or contact Owner…" | [ ] |
| TC-POS-32 | Invoice numbering | 2 sales kar ke bill # dekhein | Prefix + unique suffix (e.g. `INV-260905-xxxxxx`); duplicates na hon | [ ] |

### 13.4 Shift close (POS modal)

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-POS-33 | Expected till math | Shift KPIs | Expected = **Float + Cash Sales + Collections − Expenses/Purchases** (E2E mein exact verify) | [ ] |
| TC-POS-34 | Match Expected | "Match Expected" click | Counted = expected; denominations clear | [ ] |
| TC-POS-35 | Denominations | "Count Denominations" → 2×1000 + 1×500 → Apply | Counted field **1500 override** kare; "2.9" notes count → parseInt → 2 (truncation) | [ ] |
| TC-POS-36 | Leave in drawer | Leave = 2000 (default) | Preview: Total Counted / Drawer Float / **Remit to Head** = counted − 2000 | [ ] |
| TC-POS-37 | Counted < leave | Counted 1000, leave 2000 → submit | Blocked: **"Counted cash cannot be less than the amount left in drawer."** | [ ] |
| TC-POS-38 | Variance reason required | Counted ≠ expected + khali reason | **"A difference reason is required when counted cash does not match expected cash."**; quick chips (Counting error…) fill karein | [ ] |
| TC-POS-39 | Exact match | Matched counted → Close Shift & Submit Cash | Green "Exact match!…"; shift Closed; remittance **Pending Receive** bane; drawer balance −remit | [ ] |
| TC-POS-40 | Shortage close | Counted expected − 50 | "Cash Shortage Rs 50" + reason; shift **Pending Review** jaye + variance record (Section 15) | [ ] |

---

## 14. T11 — Sales History & Returns/Refunds

**Page:** `pages/SalesHistory.tsx`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-SH-01 | KPIs | Filters ke sath | Invoices count, Gross (non-returned), Refunded, Net | [ ] |
| TC-SH-02 | ⚠️ Net KPI | Koi return kar ke Net dekhein | **Net = Gross (refund minus NAHI hota)** — bug candidate, confirm karein | [ ] |
| TC-SH-03 | ⚠️ Refunded KPI | Filter lag kar Refunded dekhein | Refunded **sab sales** ka total hai (filtered set ka nahi) — confirm | [ ] |
| TC-SH-04 | Filters | Search / date (Today/Month/Custom) / mode / status | Results sahi filter hon | [ ] |
| TC-SH-05 | Detail modal | Eye icon | Items, totals, refund info sahi | [ ] |
| TC-SH-06 | Receipt reprint | Printer icon → Print | Receipt preview (company header settings se) + window.print | [ ] |
| TC-SH-07 | Partial return (restock) | 2 items wale bill se 1 item return, Restock to Counter, Refund Money, reason default | Status **"Partially Returned"** (amber); refund amount update; item stock +restock; account −refund | [ ] |
| TC-SH-08 | Full return (spoilage) | "Defective / Spoiled Product" reason | **Dump as Spoilage auto-select** ho; stock restock NA ho | [ ] |
| TC-SH-09 | Replace Milk | Resolution = Replace Milk | Replacement Value Rs 0.00 + "(Fresh stock worth Rs X issued)"; disposal force spoilage | [ ] |
| TC-SH-10 | Return prefill | Return modal kholein | Returnable qty = sold − pehle returned (prefilled); fully returned item unchecked/0 | [ ] |
| TC-SH-11 | ⚠️ Name merge | **Same item 2 lines** mein ho to partial return | Prefill dono lines ko merge karta hai (name-based match) — bug candidate | [ ] |
| TC-SH-12 | Refund account | Payment mode Cash sale ka refund | Auto-prefill default cash account; manual change allowed | [ ] |
| TC-SH-13 | Credit sale refund | Credit mode sale ka refund | Deduct From Account section na ho (credit cash se nahi juda) | [ ] |
| TC-SH-14 | Validation | Koi item select kiye baghair Confirm | Toast "Please select at least one item to return" | [ ] |
| TC-SH-15 | ⚠️ Partial filter gap | Status filter | **"Partially Returned" filter option mein nahi** (list mein dikhta hai) — bug candidate | [ ] |
| TC-SH-16 | Permission gate | Cashier WITHOUT `sales_history:return` | Return button kahin na ho | [ ] |

---

## 15. T12 — Cash Control

**Page:** `pages/CashControl.tsx` · Head-only tabs; cashier ko redirect card dikhta hai

### 15.0 Role gating

| ID | Test | Expected Result | ✓ |
|---|---|---|---|
| TC-CC-00a | Cashier view | Cashier ko card "Cashier Shifts are on POS Counter" + "Go to POS Counter" button; 4 tabs na dikhein | [ ] |
| TC-CC-00b | Manager/Super Admin | Chaaron tabs (Head Inbox, Business Days, Audit Trail, Cash Drawers) dikhein | [ ] |

### 15.1 Head Inbox

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-CC-01 | Pending tiles | Remittance close hone ke baad | Pending count + In Transit amount + Handovers count sahi | [ ] |
| TC-CC-02 | Accept exact | Counted = declared (Match Expected) | Variance banner "Exact match with declared amount." | [ ] |
| TC-CC-03 | Accept blocked states | Bina count → disabled; count ke sath bina account → disabled + hint "Select a Head receiving account…" | [ ] |
| TC-CC-04 | Accept over | Counted = declared + 50 | "Over by Rs 50 — will be recorded as a variance."; accept par **destination sirf counted credit ho**, drawer dobara debit **na** ho, Open variance row bane | [ ] |
| TC-CC-05 | Accept short | Counted = declared − 30 | "Short by Rs 30…" — same checks | [ ] |
| TC-CC-06 | Destination rules | Source drawer ko destination select karein | Drawer khud destination list mein **na** ho | [ ] |
| TC-CC-07 | Denomination count | Banknote icon se "Head Physical Cash Count" | Total Apply amount field overwrite kare | [ ] |
| TC-CC-08 | Double deduction check | Accept ke baad drawer ledger dekhein | Drawer balance already close par cut ho chuka; accept par sirf destination +; **koi dobara drawer − nahi** | [ ] |
| TC-CC-09 | Handover accept | Pending handover row | Agli shift start par opening = handover amount; lock day par pending handovers **auto-accept** | [ ] |
| TC-CC-10 | Disputed handover resolve | Disputed handover → Resolve | Notes prompt (window.prompt) → status resolve ho jaye | [ ] |

### 15.2 Business Days

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-CC-11 | Day card | Date, Open/Closed chip, blockers chip, "Cash due/✓" & "Stock due/✓" chips | Sahi counts | [ ] |
| TC-CC-12 | Lock blockers | Active shift ke sath Lock Day | Button disabled (blockers > 0); har blocker type checklist mein amber count | [ ] |
| TC-CC-13 | Cash closing math | Cash Closing tab | Expected drawer = Opening + In (POS sales/collections) − Out (expenses/purchases/refunds) − Remitted; E2E numbers se match | [ ] |
| TC-CC-14 | Cash close validation | Counted khali → Close Cash | Toast **"Cash close se pehle actual counted cash enter karein."** | [ ] |
| TC-CC-15 | Stock closing | Har item par system qty match counts → Apply & Close Stock | "✓ Stock closed"; mismatch par chip "+n/−n" aur adjustment log | [ ] |
| TC-CC-16 | Lock Day | Dono closes ke baad Lock Day | Status Closed; POS us din ki date par block (TC-POS-31) | [ ] |
| TC-CC-17 | Lock w/o closes | Bina cash/stock close kiye Lock | Blockers 0 hon to **auto-backfill** stamps aur lock ho jaye | [ ] |
| TC-CC-18 | Reopen (Super Admin) | Closed day par Reopen → khali reason | Toast "Reopen reason likhein — ye audit record hota hai."; reason ke sath sirf Super Admin hi reopen kare; Manager ko button na dikhe | [ ] |

### 15.3 Audit Trail & Drawers

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-CC-19 | Shift cards | Latest 20 shifts | Status chips + variance amounts sahi | [ ] |
| TC-CC-20 | Variance approve | Open variance → note → Approve | Status Approved; agar koi shift Pending Review thi to **auto-close** ho jaye | [ ] |
| TC-CC-21 | Variance reject | Reject + note | Status Rejected | [ ] |
| TC-CC-22 | Drawers tab | Drawer-enabled accounts list | Sirf Cash+drawer accounts; Bank/Wallet kabhi nazar na aayein | [ ] |
| TC-CC-23 | Add Opening Cash | Amount 1000, Source = EasyPaisa → Add to Drawer | Preview "{source} −1000 → Drawer +1000"; dono taraf ledger; **same-account/insufficient balance block** ("Source mein sirf Rs X hai…") | [ ] |
| TC-CC-24 | Opening replaces handover | Pehle pending handover ho, phir nayi opening cash dalein | Purana handover **Cancelled** ("Replaced by new opening cash…"); sirf **net** amount source se jaye | [ ] |

---

## 16. T13 — Customers & Khata

**Page:** `pages/Customers.tsx` · RPC: `adjust_customer_balance`

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-CUS-01 | Add customer | Section 3 wala Hassan Store | List + KPIs update | [ ] |
| TC-CUS-02 | Required name | Naam khali → Save | Toast **"Customer name is required"** | [ ] |
| TC-CUS-03 | Opening due | Initial balance 250 (Due) | Balance "Due Rs 250"; ledger Opening row; Balance Sheet A/R mein count | [ ] |
| TC-CUS-04 | Opening advance | −300 | "Adv Rs 300"; Unearned Revenue mein | [ ] |
| TC-CUS-05 | Payment | Record Payment → 250, Cash, WhatsApp checkbox ON | Toast "Payment recorded successfully"; balance 0; WhatsApp receipt link khule; account +250 | [ ] |
| TC-CUS-06 | Charge (Debit) | Charge 150 manual | Balance due +150; ledger "Charge" row | [ ] |
| TC-CUS-07 | Delete txn | Manual txn delete | Confirm "This will revert the customer balance." → balance revert; running balance sahi | [ ] |
| TC-CUS-08 | POS bill immovable | POS sale wali entry delete | Delete option na ho (POS Bill not deletable) | [ ] |
| TC-CUS-09 | Delete with history | Sales wale customer delete | Toast "Cannot delete: this customer has sales/ledger history. Set them inactive instead." | [ ] |
| TC-CUS-10 | Filters & bulk | Due/Advance/Settled filter + bulk delete | Counts sahi; bulk confirm "{N} customers" | [ ] |
| TC-CUS-11 | WhatsApp reminder | Phone ke sath | "KHATA STATEMENT REMINDER" text + wa.me 92-prefix link | [ ] |
| TC-CUS-12 | Ledger filters | Invoices / Payments / Charges + search | Running balance chronological sahi | [ ] |

---

## 17. T14 — Expenses & Vendors

**Page:** `pages/Expenses.tsx`

### 17.1 Expense entries

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-EXP-01 | Full paid | 500, Full Paid, Cash, category "Electricity & Utilities", description | Toast; account −500; summary Cash card update | [ ] |
| TC-EXP-02 | Partial + vendor | 2500, Partial, Paid 1000, vendor WAPDA | Status "Partial + Rs 1500 Due"; drawer −1000; WAPDA dues +1500; toast "…Due to WAPDA: Rs 1500" | [ ] |
| TC-EXP-03 | Unpaid bill | 800, Unpaid, vendor select | Notice "…added to the vendor's pending dues ledger without deducting…"; account untouched | [ ] |
| TC-EXP-04 | Vendor required | Partial/Unpaid bina vendor | Toast "Please select a vendor to track unpaid dues in their Khata ledger" | [ ] |
| TC-EXP-05 | Required fields | Amount/description khali | Toast "Please enter valid amount and description"; category khali → "Please select an expense category" | [ ] |
| TC-EXP-06 | Account balance preview | Paid From Account par | "Account Balance: Rs X → Left: Rs Y" (negative red, par **block nahi** hota — record karein) | [ ] |
| TC-EXP-07 | New category inline | "New Category" se "Test Cat" banayein | Category select ho jaye; duplicate par `Category "Test Cat" already exists` | [ ] |
| TC-EXP-08 | New vendor inline | Quick create vendor | ⚠️ **Dues link check**: quick-created vendor ka temp id `ev_…` real vendor se match na ho sakta — expense ke baad vendor khata mein bill dikhna chahiye (bug candidate) | [ ] |
| TC-EXP-09 | Month filter gotcha | Pichle mahine ki date ke sath expense save karein jab filter current month par ho | Entry list mein **na dikhe** (month filter) — filter "All months" kar ke confirm karein | [ ] |
| TC-EXP-10 | Delete expense | Paid expense delete | Confirm "…paid amount will be refunded back to the account and vendor balance adjusted" → account re-credit, vendor due kam, toast | [ ] |
| TC-EXP-11 | Pay shortcut | Partial row par "Pay" | Payment modal **remaining amount prefill** ho | [ ] |
| TC-EXP-12 | ⚠️ Permission gap | Cashier (expenses:create na ho) desktop par | Desktop "Record Expense" button **gated nahi** (mobile gated hai) — bug candidate | [ ] |

### 17.2 Vendors directory & Pay/Receive

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-EXP-13 | Vendor khata | WAPDA kholein | Net Balance "Payable Dues 1500"; Total Billed/Paid stats | [ ] |
| TC-EXP-14 | Pay flow | Pay Vendor → auto amount 1500 → EasyPaisa → Pay | Dues 0; EasyPaisa −1500; overdraft par confirm "…less than payment amount… Proceed anyway?" | [ ] |
| TC-EXP-15 | Receive flow | Advance wale vendor (−balance) par modal | Auto **Receive** flow + "Deposit Into Account" label | [ ] |
| TC-EXP-16 | Category management | Categories modal: rename / disable / delete-used | Used category delete par toast "Cannot delete…: {n} transaction(s)…"; disable/rename kaam karein; rename ke baad purani entries mapping barqarar | [ ] |

---

## 18. T15 — Accounts

**Page:** `pages/Accounts.tsx` · Tabs: Chart of Accounts / Journal Entry

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-ACC-01 | COA hierarchy | Tab kholein | 1000 Assets (Cash & Bank = aapke 3 accounts), 2000 Liabilities (A/P suppliers, Customer Advances), 3000 Equity, 4000 Income (POS sales), 5000 Expenses (per category + COGS milk/materials) — sab **live computed** | [ ] |
| TC-ACC-02 | A/R & A/P math | Customer due 250 + supplier due 250 | 1200 A/R = 250; 2100 A/P = 250 | [ ] |
| TC-ACC-03 | ⚠️ Cash-named account | "New Account" → na me parent, type Asset, naam mein "cash" (e.g. "Petty Cash Box") | **Real Bank & Cash account** ban jaye (toast `Bank & Cash Account "Petty Cash Box" created successfully!`) — intentional but surprising | [ ] |
| TC-ACC-04 | Manual account | Parent none, type Expense, naam "Marketing Fund" → Create | Manual node; Manual badge; toast "New Ledger Account Created" | [ ] |
| TC-ACC-05 | Delete rules | System account / children wala / non-zero balance | Toasts: "Cannot delete system account." / "Cannot delete account with sub-accounts." / "Account has non-zero balance. Deactivate instead." | [ ] |
| TC-ACC-06 | Deactivate | Manual account toggle | 50% opacity; journal selector se gayab | [ ] |
| TC-ACC-07 | Journal balanced | 2 lines: Dr 500 / Cr 500 → Post | "Journal Entry Posted Successfully"; Recent Vouchers mein entry | [ ] |
| TC-ACC-08 | Journal unbalanced | Dr 500 / Cr 400 → Post | Button disabled; toast "Journal Entry must be balanced (Debit = Credit)" | [ ] |
| TC-ACC-09 | Journal min lines | 1 line par account na select | Toast "All lines must have an account selected" | [ ] |
| TC-ACC-10 | Debit/Credit exclusivity | Debit mein 500 dalein | Credit auto 0 (aur vice versa) | [ ] |
| TC-ACC-11 | ⚠️ Journal effect | Post ke baad COA balances | Posting se COA node balances **visibly change nahi hote** (computed from modules) — confirm & record | [ ] |

---

## 19. T16 — Reports

**Page:** `pages/Reports.tsx` · Date range + Print

| ID | Test | Report | Expected Result | ✓ |
|---|---|---|---|---|
| TC-REP-01 | Profit & Loss | Revenue = POS sales (non-Returned) + supply; COGS = milk + material purchases; Gross/Net Profit | E2E numbers se match (Section 21.8) | [ ] |
| TC-REP-02 | Balance Sheet | Assets = Cash & Bank + Inventory + A/R; Liab = A/P + Customer Advances; Equity = Capital + Retained (current P&L) | **Assets = Liab + Equity** (approx; equity sirf current-period P&L — known simplification) | [ ] |
| TC-REP-03 | Day Book | Saari events chronological (sales, purchases, payments, expenses) newest-first | E2E ke saare events nazar aayein | [ ] |
| TC-REP-04 | Customer Sales Analysis | Per-customer POS/Supply totals + Dr/Cr balance | Customer filter kaam kare | [ ] |
| TC-REP-05 | Item Stock Ledger | Item select kar ke | "Please select an item…" warn bina selection; movements (sales −, adjustments ±) sahi | [ ] |
| TC-REP-06 | Placeholders | Cash Flow / Item Performance / Low Stock / Purchase Register / Supplier Summary / Production Yield | Dashed placeholder: "Report Generation — Data is being collected…" (expected not implemented) | [ ] |
| TC-REP-07 | Empty range | Aisi date range jahan data nahi | Empty state gracefully | [ ] |
| TC-REP-08 | Print | Print Report | window.print preview | [ ] |
| TC-REP-09 | ⚠️ UTC boundary | (UTC+5) raat 12:30 baje ki sale | Dashboard/Reports date filters **UTC strings** use karte hain — sale pichle din par count ho sakti hai — verify & record | [ ] |

---

## 20. T17 — Dashboard

**Page:** `pages/Dashboard.tsx` (read-only aggregation)

| ID | Test | Expected Result | ✓ |
|---|---|---|---|
| TC-DSH-01 | Time range chips | today / yesterday / 7 Days / month — KPIs range ke sath change hon | [ ] |
| TC-DSH-02 | KPI Milk Procurement | Liters + Cost + Buffalo/Cow chips; **Cancelled/Returned purchases exclude** | [ ] |
| TC-DSH-03 | KPI Total Sales | Rs + units + Cash/Credit chips; Returned sales exclude | [ ] |
| TC-DSH-04 | KPI Available Liquidity | Cash + Bank chips; in-transit ho to "+ In-Transit: Rs X" button → /cash-control link | [ ] |
| TC-DSH-05 | KPI Outstanding Dues | Supplier payables + Receivables chip + View link | [ ] |
| TC-DSH-06 | Weekly chart | 7-day bars milk purchased vs sold | [ ] |
| TC-DSH-07 | Top Selling Items | Top 5 by qty | [ ] |
| TC-DSH-08 | Quick actions | New Sale / Milk Purchase / Counter Closing / Allocate Milk / Add Expense — sab sahi route par le jayein | [ ] |

---

## 21. E2E Golden Path — Full Business Day Simulation

> Yeh **sab se important scenario** hai. Section 3 ke master data ke sath, ek din ka poora
> cycle simulate karein. Har step ke baad **Running Balance** table apni values se compare karein.
> Har number Rs mein hai.

### 21.0 Starting state

| Account | Balance |
|---|---|
| Main Cash Drawer | 5,000 |
| EasyPaisa | 10,000 |
| Meezan Bank | 0 |
| Ghulam Farid (supplier) due | 0 |
| Hassan Store (customer) due | 0 |
| WAPDA (vendor) due | 0 |

### Phase A — Procurement (Purchase → Milk Intake)

- [ ] **A1.** Milk Intake: Date today, Shift Morning, Buffalo Milk, Ghulam Farid, **50 L @ 110**.
  Auto-check: Total Bill = **5,500**. Paid = 3,000 (Full button nahi — manually 3000), Mode **Online**
  → EasyPaisa auto-select. Status chip **"Partial (Rs 3,000)"**, Added to Khata = **2,500**. → Save Intake.
  - Expected: supplier due **2,500**; EasyPaisa **7,000**; audit log entry "XL • Buffalo Milk • Morning".

### Phase B — Allocation & Production

- [ ] **B1.** Allocation: Unallocated list mein 50 L row → Add → qty **40 L** → Add to Cart.
  Avg Cost = **Rs 110/L**, Total Volume 40 L.
- [ ] **B2.** Destination = **Production**, Product = "Yogurt (Dahi)" → Confirm Allocation.
  Expected toast "Successfully allocated 40 L to Production"; Production board par batch
  (In: 40 L, **Target: 20 kg**); Unallocated list ab **10 L**.
- [ ] **B3.** Production: batch Processing → Finish move karein → modal kholein:
  Cost check: Raw Milk Base = **40 × 110 = 4,400**.
- [ ] **B4.** Complete: Loose = **10**, `Dahi 1kg Pack` = **10**, remarks optional → Mark Batch Completed.
  Expected: toast "Batch completed & added to inventory!"; **Yield 100%**; profit = (10×300 + 10×300) − 4400 = **1,600**;
  Inventory: Yogurt loose **10 kg**, variant **10 packs**.

### Phase C — Shift + POS Sales

- [ ] **C1.** POS → "Start Shift": Opening Cash **5,000** (drawer balance) → Start Shift.
  Toast "Shift started — opening cash Rs 5,000".
- [ ] **C2.** Sale 1 (customer khata): Hassan Store select → Yogurt (Dahi) click → Loose qty **2** @300.
  Subtotal **600**. Amount Paid Now = **200** → status "**Added to Customer Ledger: Rs 400**".
  → Confirm & Pay (Cash). Receipt modal verify → Close.
  Expected: Hassan due **400**; drawer cash sales +200.
- [ ] **C3.** Sale 2 (walk-in cash): Customer reset to Walk-in → 3 × `Dahi 1kg Pack` = **900**.
  Cash In = **1000** → chip "Change: Rs 100". → Confirm & Pay.
  Expected: change 100; cash sales +900.
- [ ] **C4.** Expense: Expenses → 2,500, Partial, Paid Now 1,000, Cash (drawer), category
  Electricity, vendor WAPDA → Save. Expected: drawer −1,000; WAPDA due **1,500**.
- [ ] **C5.** Collection: Customers → Hassan Store → Record Payment **400**, Cash → Save.
  Expected: Hassan due **0**; drawer +400.

### Phase D — Shift Close

- [ ] **D1.** POS → shift chip → Control / Close:
  Expected KPIs: Bills **2**, POS Cash Sales **1,100** (200+900), Collections **400**,
  Expenses **−1,000** → **Expected Till Cash = 5,000 + 1,100 + 400 − 1,000 = 5,500**.
- [ ] **D2.** "Match Expected" → Counted 5,500. Leave in Drawer = **2,000**.
  Preview: Remit to Head = **3,500**. Variance: green "Exact match!".
- [ ] **D3.** "Close Shift & Submit Cash". Expected: shift Closed; drawer balance **5,500 − 3,500 = 2,000**;
  Cash Control → Head Inbox mein remittance **3,500 Pending**; **Cash in Transit = 3,500**.

### Phase E — Head Acceptance

- [ ] **E1.** Cash Control → Head Inbox: counted = declared (3,500), Receiving Account =
  **Meezan Bank** → Accept Remittance.
  Expected: Meezan Bank **3,500**; drawer **untouched** (2,000 hi rahe — no double deduction);
  in-transit **0**.

### Phase F — Vendor Payments

- [ ] **F1.** Expenses → WAPDA → Pay/Receive → 1,500, Online → EasyPaisa → Pay. Dues **0**; EasyPaisa **5,500**.
- [ ] **F2.** Suppliers → Ghulam Farid → Record Payment 2,500, Online → EasyPaisa → Confirm. Due **0**; EasyPaisa **3,000**.

### Phase G — Business Day Close

- [ ] **G1.** Cash Control → Business Days → today card → "Lock Day" modal → Cash Closing:
  Expected drawer cash = 5,000 + 1,100 + 400 − 1,000 − 3,500 = **2,000**. Counted = **2,000** → exact.
- [ ] **G2.** Stock Closing: sab items Match → Apply & Close Stock.
- [ ] **G3.** Lock Day (0 pending). Expected: day Closed. POS par nayi sale try karein →
  day-locked toast (kal ki date par shift kholein to sale ho).

### Phase H — Final Verification

- [ ] **H1. Account balances:**

| Account | Expected | Actual |
|---|---|---|
| Main Cash Drawer | 2,000 | |
| EasyPaisa | 3,000 | |
| Meezan Bank | 3,500 | |
| **Total money** | **8,500** | |

  Company cash identity: accounts total (8,500) + in-transit (0) = total money ✓

- [ ] **H2. Ledgers:** Ghulam Farid 0 · Hassan 0 · WAPDA 0.
- [ ] **H3.** Inventory: Yogurt loose **8 kg** (10 produced − 2 sold), variant packs **7**
  (10 produced − 3 sold).
- [ ] **H4. Reports:**
  - P&L: Revenue **1,500** (600+900); COGS **5,500**; Gross **−4,000**; Expenses **2,500**; Net **−6,500**.
  - Day Book: milk purchase, batch (optional), 2 sales, expense, 2 payments, remittance entries.
  - Balance Sheet approx: Cash & Bank 8,500 + Inventory (8×300 + 7×300 = 4,500) + A/R 0 =
    **13,000**; Liabilities **0**; Equity = capital (opening 15,000, agar accounts capital injection
    se bane) − 6,500 = 8,500 → Assets 13,000 vs L+E 8,500 — **agar mismatch aaye to note karein**
    (known simplification: equity sirf current-period retained earnings count karta hai).
- [ ] **H5.** Dashboard: Total Sales 1,500; Milk Procurement 50 L / Rs 5,500; Liquidity 8,500; Dues 0.

---

## 22. Offline / Sync Test Suite

**Files:** `lib/db.ts`, `lib/syncService.ts` · Sirf **POS sales + naye customers** offline queue hote hain;
baqi modules online maangte hain. Sync interval **25s**, retries **5**, phir **failed (dead-letter)**.

| ID | Test | Steps | Expected Result | ✓ |
|---|---|---|---|---|
| TC-OFF-01 | Offline sale | DevTools → Network Offline → POS sale | Sale turant complete ho (local); SyncStatusBadge **pending** count dikhaye | [ ] |
| TC-OFF-02 | Offline customer | Offline par naya customer POS quick-register | Local save; pending sync | [ ] |
| TC-OFF-03 | Refresh persistence | Offline sale ke baad refresh | Dexie merge: sale/customer aur pending state barqarar | [ ] |
| TC-OFF-04 | Auto-sync | Online wapas karein | ≤25s (ya turant `online` event par) sync; badge cleared; Supabase `sales` mein row; stock/khata/cash effects `pos_sync_order_effects` se apply | [ ] |
| TC-OFF-05 | Idempotency | Sync ke doran refresh / dobara sync | Effects **double apply na hon** (idempotent RPC); khata/stock ek hi dafa badle | [ ] |
| TC-OFF-06 | Dead-letter | Offline rehte hue 5 retry cycles | Row `failed`; badge failed count; `sync_error` stored | [ ] |
| TC-OFF-07 | Manual retry | Online aane par failed records retry karein (badge/retry option) | Retry_count reset → sync ho jayein | [ ] |
| TC-OFF-08 | Cross-tab mutex | 2 tabs POS kholein, dono offline sales | Sirf ek tab sync kare (Web Locks `mooco_pos_sync_lock`); duplicates na hon | [ ] |
| TC-OFF-09 | Offline module block | Offline par Purchase/Expense save | Kaam na kare / error (sirf POS+customers offline hain) — behavior record karein | [ ] |
| TC-OFF-10 | Opening balance idempotent | Offline customer with opening balance sync dobara | `ctx_op_` ledger row duplicate na bane | [ ] |

---

## 23. RBAC Test Suite (Role-wise Access)

**Setup:** Settings → Users mein har role ka ek test user banayein (PIN 1234). Ek-ek kar ke login
hokar verify karein.

| ID | Role | Checks | ✓ |
|---|---|---|---|
| TC-RBAC-01 | POS Cashier | ✅ pos, sales-history, cash-control (sirf redirect card), customers · ❌ dashboard/purchase/settings → direct URL `/settings` type karein → **pehli allowed route par redirect** | [ ] |
| TC-RBAC-02 | Cashier auto-land | Login par `/cash-control` par land ho | [ ] |
| TC-RBAC-03 | Procurement Incharge | ✅ purchase, allocation, suppliers · ❌ pos, expenses | [ ] |
| TC-RBAC-04 | Production Supervisor | ✅ allocation, production, inventory, items · ❌ purchase | [ ] |
| TC-RBAC-05 | Manager | Sab kuch ✅ **except** settings/users | [ ] |
| TC-RBAC-06 | Super Admin | Sab ✅; day reopen sirf isi ko; delete/disable protected | [ ] |
| TC-RBAC-07 | Extra Access | Cashier ko customers:delete extra grant karein → delete button visible; grant hatao → gayab | [ ] |
| TC-RBAC-08 | Granular action | Role mein sirf `{module}:view` → page dikhe par create/edit/delete buttons na hon | [ ] |
| TC-RBAC-09 | retail_stock implication | Sirf `retail_stock` grant | cash_control **view-only** mile | [ ] |
| TC-RBAC-10 | Deactivated user mid-session | Logged-in user ko doosre admin deactivate karein | Next action par session invalid ho / lock aaye — record karein | [ ] |
| TC-RBAC-11 | Permission UI | Settings → Roles accordion per-module matrix sahi dikahye (System Preset vs Custom) | [ ] |

---

## 24. Known Quirks / Suspected Bugs — Verify & Confirm

Yeh list code review mein mile hain. **Har item ko manually verify karein** aur Bug Log mein
confirmed/denied likhein:

| # | Area | Suspected Issue | Verified? (✅ bug / ❌ fine) |
|---|---|---|---|
| Q01 | Purchase | "Select Vendor to Save" button label ke bawajood unpaid invoice **save ho jati hai** (supplier_id null) | |
| Q02 | Purchase | Material return ka max **original qty** hai — current stock se zyada return possible | |
| Q03 | Purchase | Milk intake **Fat/SNF** fields hamesha 0 submit hoti hain (UI input nahi) | |
| Q04 | Sales History | **Net KPI refunds minus nahi karta** (Net = Gross) | |
| Q05 | Sales History | Refunded KPI **filtered set ka nahi**, sab ka total | |
| Q06 | Sales History | "Partially Returned" status **filter option missing** | |
| Q07 | Sales History | Return prefill **item name** se match — same-name 2 lines merge | |
| Q08 | POS | Held order **Recall current cart ko bina confirm replace** karta hai | |
| Q09 | Items | Unit Manager "Add Unit" — success toast par **persist nahi** (no-op) | |
| Q10 | Items | Categories "remove" — no-op | |
| Q11 | Production | Avg milk rate = **sab allocations** ka mean (sirf is batch ka nahi); no allocations → hardcoded **120/L** | |
| Q12 | Production | Yield **100% se upar** ja sakta hai (no clamp) | |
| Q13 | Allocation | Cart **refresh par lost** (in-memory only) | |
| Q14 | Cash Control | Disputed handover "Resolve" **window.prompt** use karta hai (kuch webviews mein nahi chalta) | |
| Q15 | Expenses | Quick-created vendor ka **temp id** dues se link na ho sakta | |
| Q16 | Expenses | Desktop "Record Expense" button **permission-gated nahi** (mobile gated) | |
| Q17 | Expenses | Delete buttons `expenses:delete` se **gated nahi** | |
| Q18 | Expenses | Month filter default current month — aaj ki entry doosre month ki date par **hide** | |
| Q19 | Accounts | Top-level Asset account jiske naam mein "cash"/"bank" ho **silently real Bank & Cash account** ban jata hai | |
| Q20 | Accounts | Journal post se **COA balances visibly change nahi** (COA modules se computed) | |
| Q21 | BankCash | Overdraft transfer/payment **front-end check nahi** (RPC behavior?) | |
| Q22 | Dashboard/Reports | Date filters **UTC strings** — local midnight se pehle/ki entries wrong day par | |
| Q23 | Inventory | Duplicate item names possible — inventory lookup name-based (merge risk) | |
| Q24 | Settings | "Add Unit"/unit + category remove no-ops (Q09/Q10 repeat cross-check) | |

---

## 25. Bug Log Template

Har fail hone wale test ke liye ek row:

```
BUG-###  | Date: ____ | Tester: ____
Module/Page: ____________      Test ID: TC-___-__
Severity: Critical / Major / Minor / Cosmetic
Steps to Reproduce:
  1.
  2.
  3.
Expected: ____________________
Actual:   ____________________
Screenshot/Console errors: ____
Environment: (browser, online/offline, user role)
Status: Open / In Progress / Fixed / Won't Fix
```

Severity guide:
- **Critical:** Paisa/data galat — balance mismatch, double deduction, sale lost, security bypass.
- **Major:** Feature block — save fail, workflow ruk jaye, permission bypass.
- **Minor:** Galat number display, filter gap, UX confusion.
- **Cosmetic:** Text/layout, koi functional asar nahi.

---

## 26. Final Sign-off Checklist

Release se pehle yeh core set **zaroor** pass hon:

- [ ] Login/lock + brute-force lockout kaam karta hai (TC-AUTH-01…13)
- [ ] PIN change purana PIN invalidate karta hai (TC-SET-14)
- [ ] Shift ke baghair POS sale **impossible** (TC-POS-01/02)
- [ ] Shift close math exact; variance reasons enforce (TC-POS-33…40)
- [ ] Remittance: drawer ek dafa debit, destination accept par credit, no double deduction (TC-CC-04…08)
- [ ] Cash identity: accounts total + in-transit = total money (E2E H1)
- [ ] E2E Golden Path ke **saare balances match** (Section 21)
- [ ] Business day close blockers + reopen sirf Super Admin (TC-CC-12…18)
- [ ] Offline sale → online sync → idempotent effects (TC-OFF-01…05)
- [ ] RBAC: har role sirf apne modules (Section 23)
- [ ] Khata math: purchase due, POS due, refunds, payments sab supplier/customer balances se match
- [ ] Inventory: sale deduction, return restock/spoilage, audit adjustments sahi bucket mein
- [ ] Reports P&L/Balance Sheet E2E numbers se cross-check
- [ ] Section 24 ke sab quirks verified aur logged
- [ ] Danger zone reset **sirf test DB par** chala kar verify

---

*Document version: 1.0 — Generated 2026-09-05 from codebase review (App.tsx, DairyContext,
all 16 pages, components, lib/sync). Jab bhi workflow change ho, yeh doc update karein —
siwaye Cash Control ke jiska reference doc `CASH_CONTROL_WORKFLOW.md` hai.*
