# Actual Profit (Stock Based)

Open **Reports → Financial Statements → Actual Profit (Stock Based)** and select a date range. Refresh history after recording a purchase, sale, production batch or stock correction.

The report calculates accrual profit in PKR:

```
Net purchases = purchases − supplier returns
Consumed cost = opening stock + net purchases + additional conversion cost
                + stock corrections − closing stock
Net sales = POS invoices + completed delivery sales − sales returns
Net profit = net sales − consumed cost − operating expenses
```

Stock is valued at moving weighted average purchase cost. Opening is immediately before the start date, closing is at the end of the selected end date; for today it is the balance recorded so far. Pakistan business dates are used for timestamps. A date-only business date is preserved. All records are paginated and checked against the server's exact count; incomplete reads fail instead of showing a partial profit.

Raw unallocated milk, warehouse/counter stock, packed variants, delivery stock and work in progress are separate inventory balances. Milk allocation and production move their cost between balances without charging a second purchase. Production output cost is spread across loose output and packs by their base quantity. Unfinished production remains an asset. Cancelled batches return their milk to the allocation pool.

Purchase returns and customer refunds use their actual return dates, preserving earlier-period invoices. Partial supplier returns restore the original purchase quantity before applying return vouchers. Good customer returns restore the original sold cost; scrapped returns do not restore stock. Replacement deductions are owned by the stock log. Wastage, theft and internal consumption are included once in consumed cost. Stock count corrections appear separately in the cost bridge.

Expenses use the full bill, including unpaid amounts. Customer collections, supplier payments, customer booking advances, bank transfers and opening cash are not revenue or operating costs. Revenue comes from billed sales, including credit sales and completed delivery entries.

## Data quality

The report labels its net result **provisional** whenever it encounters incomplete or inconsistent stock/cost history. It never claims exactness merely because the formula balances. Check the item-level opening/closing audit and data-check list before relying on the result.

Existing limitations detected by the report include:

- Stock present before the first recorded movement: quantity is recovered from current stock but historical opening cost requires confirmation.
- Missing allocation timestamps, milk sources, production output or pack sizes.
- Negative balances caused by missing movements or timing.
- Ingredient/packaging consumption not posted by the existing production workflow.
- Missing historical return dates, unlinked supplier returns and unposted closing sales.
- Pending offline transactions or a future end date.

New production completions preserve the output breakdown, pack sizes and ingredient/packaging cost snapshot in the existing batch `details` field. This needs no schema migration and does not retroactively rewrite old records. The snapshot explicitly records whether material consumption was posted; it does not pretend that a preview cost was an inventory transaction.

CSV exports include the full formula, all stock balances, expenses, movements and data checks, regardless of table search. Printing includes the same data-check status.

The cost approach follows [IAS 2's purchase/conversion cost and weighted-average principles](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/). Unrecorded costs, depreciation, tax and inventory write-downs require their own recorded entries before final accounting profit can be determined; the app cannot infer them from cash movements.

Validation: `node scripts/verify-stock-profit.mjs`, `node scripts/verify-stock-profit-ui.mjs`, `npx tsc --noEmit`, and `npm run build`.
