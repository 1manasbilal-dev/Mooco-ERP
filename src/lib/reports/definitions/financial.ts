import type { ReportData, ReportDefinition, ReportFilters, ReportRow, ReportSectionLine, Tone } from '../types';
import {
  accountName, autoGroup, bankTxEffect, bucketKey, bucketKeys, bucketLabel, cashInTransit, chronological, COLOR, customerName, dayOf, fmtRupees,
  groupSum, inRange, isCustomerReceipt, isNonCashCustomerTx, isPurchaseVoid, isSupplierWaiver, isVoidExpense, itemStock, lower, n,
  pct, r2, r3, reportSales, saleFigures, saleLines, saleMode, sum, supplierName, timeSeries, topSlices
} from '../helpers';
import { isOpenStart } from '../presets';
import {
  bankTxCategory, expenseCashPaid, isInternalCashTransfer, isPurchaseReturnTx, isSalesRefundTx, isSpotSupplierPayment,
  materialCashPaid, purchaseCashPaid
} from '../../moneyFlow';
import { buildStockProfitReport, type StockProfitSource } from '../../stockProfit';
import type { BankTransaction, ExpenseEntry, FinancialAccount } from '../../../types';

const rs = (value: number) => `Rs ${fmtRupees(value)}`;

const activeExpenses = (data: ReportData, f: Pick<ReportFilters, 'from' | 'to'>) =>
  data.expenses.filter(e => inRange(e.date, f) && !isVoidExpense(e));
const milkPurchases = (data: ReportData, f: Pick<ReportFilters, 'from' | 'to'>) =>
  data.purchases.filter(p => inRange(p.date, f) && !isPurchaseVoid(p.status));
// Fully returned material bills keep their amount, so they are left out like returned milk slips.
const materialPurchases = (data: ReportData, f: Pick<ReportFilters, 'from' | 'to'>) =>
  data.materialPurchases.filter(p => inRange(p.date, f) && !isPurchaseVoid(p.status));

const txEffect = (tx: BankTransaction) => bankTxEffect(tx.type, tx.amount);
const supplierBalance = (s: { pending_balance?: number; balance?: number }) => n(s.pending_balance ?? s.balance);

const TYPE_LABEL: Record<string, string> = {
  deposit: 'Deposit', withdrawal: 'Withdrawal', income: 'Other income', expense: 'Other payment',
  transfer_in: 'Transfer in', transfer_out: 'Transfer out', journal: 'Journal',
};
const txCategory = (tx: BankTransaction) => bankTxCategory(tx) || TYPE_LABEL[lower(tx.type)] || 'Other';

/** Balance of the chosen accounts at the start and end of the range, worked back from today's balance. */
function balanceWindow(data: ReportData, accounts: FinancialAccount[], f: Pick<ReportFilters, 'from' | 'to'>) {
  const ids = new Set(accounts.map(a => a.id));
  const txs = data.bankTransactions.filter(t => ids.has(t.account_id));
  const current = sum(accounts, a => n(a.balance));
  const opening = r2(current - sum(txs.filter(t => dayOf(t.date) >= f.from), txEffect));
  const closing = r2(current - sum(txs.filter(t => dayOf(t.date) > f.to), txEffect));
  return { txs, current, opening, closing };
}

/**
 * Stock at cost today, valued exactly like the Stock Valuation report: loose plus every pack pile
 * (hidden packs too) at cost, negative piles at zero, inactive items still holding stock included.
 */
function stockAtCost(data: ReportData) {
  let missing = 0;
  let negative = 0;
  const value = sum(data.items, item => {
    const v = itemStock(data, item);
    if (v.costMissing) missing++;
    if (v.reading.status === 'minus') negative++;
    return v.costValue;
  });
  return { value, missing, negative };
}

const unallocatedMilkValue = (data: ReportData) => sum(
  data.allocations.filter(a => lower(a.status) !== 'fully allocated'),
  a => {
    const remaining = a.remaining_quantity !== null && a.remaining_quantity !== undefined ? n(a.remaining_quantity) : n(a.original_quantity);
    return Math.max(0, remaining) * n(a.average_rate ?? a.details?.average_rate);
  }
);

const expenseLabel = (e: ExpenseEntry) => e.category || 'General';

export const financialReports: ReportDefinition[] = [
  {
    id: 'business_overview',
    title: 'Business Overview',
    subtitle: 'Sales, profit, expenses, milk, cash and dues at a glance',
    category: 'overview',
    icon: 'LayoutDashboard',
    keywords: ['dashboard', 'summary', 'kpi', 'overview', 'khulasa'],
    financial: true,
    filters: ['groupBy'],
    comparable: true,
    build: (data, f) => {
      const sales = reportSales(data, f);
      const figs = sales.map(saleFigures);
      const netSales = sum(figs, x => x.net);
      let revenue = 0, cost = 0;
      sales.forEach(s => saleLines(s, data.items).forEach(l => { revenue += l.revenue; cost += l.cost; }));
      const grossProfit = r2(revenue - cost);
      const expenses = activeExpenses(data, f);
      const expenseTotal = sum(expenses, e => n(e.amount));
      const netProfit = r2(grossProfit - expenseTotal);
      const milk = milkPurchases(data, f);
      const milkLitres = r3(milk.reduce((s, p) => s + n(p.quantity), 0));
      const milkCost = sum(milk, p => n(p.total_amount));
      const materials = materialPurchases(data, f);
      const collected = sum(figs, x => x.cash + x.online);
      // Opening balances and bad-debt write-offs are khata rows, not money received.
      const recoveries = sum(data.customerTransactions.filter(t => isCustomerReceipt(t) && inRange(t.date, f)), t => n(t.amount));
      // Delivery sales the dashboard counts: not pending, not cancelled.
      const supply = sum(data.dailySupplyEntries.filter(e => inRange(e.date, f) && !['pending', 'cancelled'].includes(lower((e as any).status))), e => n(e.total_amount));
      const receivables = sum(data.customers, c => Math.max(0, n(c.balance)));
      const supplierDue = sum(data.suppliers, s => Math.max(0, supplierBalance(s)));
      const vendorDue = sum(data.expenseVendors, v => Math.max(0, n(v.pending_balance)));
      // Same "money we have" as the dashboard: account balances plus cash on its way to the head.
      const transit = cashInTransit(data);
      const cashBank = r2(sum(data.accounts, a => n(a.balance)) + transit);

      const groupBy = autoGroup(f);
      type Ev = { date: string; sales: number; expenses: number; purchases: number };
      const events: Ev[] = [
        ...sales.map((s, i) => ({ date: s.date, sales: figs[i].net, expenses: 0, purchases: 0 })),
        ...expenses.map(e => ({ date: e.date, sales: 0, expenses: n(e.amount), purchases: 0 })),
        ...milk.map(p => ({ date: p.date, sales: 0, expenses: 0, purchases: n(p.total_amount) })),
        ...materials.map(p => ({ date: p.date, sales: 0, expenses: 0, purchases: n(p.total_amount) })),
      ];
      const series = timeSeries(events, e => e.date, f, groupBy, (b, e) => {
        b.sales += e.sales; b.expenses += e.expenses; b.purchases += e.purchases;
      }, ['sales', 'expenses', 'purchases']);
      const byCategory = groupSum(expenses, expenseLabel, e => n(e.amount));
      const topExpense = byCategory[0];
      const margin = pct(grossProfit, revenue);

      return {
        kpis: [
          { key: 'net', label: 'Net sales', value: netSales, format: 'money', tone: 'good' },
          { key: 'gross', label: 'Gross profit', value: grossProfit, format: 'money', tone: grossProfit >= 0 ? 'good' : 'bad', hint: `${margin}% margin` },
          { key: 'expenses', label: 'Expenses', value: expenseTotal, format: 'money', inverse: true },
          { key: 'profit', label: 'Net profit (est.)', value: netProfit, format: 'money', tone: netProfit >= 0 ? 'good' : 'bad' },
          { key: 'milk', label: 'Milk collected', value: milkLitres, format: 'qty', unit: 'L', hint: rs(milkCost) },
          { key: 'milkCost', label: 'Milk cost', value: milkCost, format: 'money', inverse: true },
          { key: 'collected', label: 'Collected on bills', value: collected, format: 'money' },
          { key: 'recoveries', label: 'Customer recoveries', value: recoveries, format: 'money' },
          { key: 'receivables', label: 'Receivables today', value: receivables, format: 'money', tone: 'warn', hint: 'Customers owe' },
          { key: 'payables', label: 'Payables today', value: r2(supplierDue + vendorDue), format: 'money', inverse: true, hint: 'Suppliers and vendors' },
          { key: 'cashBank', label: 'Cash & bank today', value: cashBank, format: 'money', tone: 'info', hint: transit > 0 ? `Incl. ${rs(transit)} in transit` : undefined },
        ],
        charts: [
          {
            id: 'trend', title: 'Sales vs purchases vs expenses', type: 'combo', data: series, xKey: 'label', format: 'money', wide: true,
            series: [
              { key: 'sales', label: 'Sales', color: COLOR.sales },
              { key: 'purchases', label: 'Purchases', color: COLOR.purchase },
              { key: 'expenses', label: 'Expenses', color: COLOR.expense, asLine: true },
            ],
          },
          { id: 'expenses', title: 'Expenses by category', type: 'pie', data: topSlices(byCategory), xKey: 'name', series: [{ key: 'value', label: 'Expenses' }], format: 'money' },
        ],
        tables: [{
          id: 'periods', title: `By ${groupBy}`, showTotals: true, sort: { key: 'key', dir: 'desc' },
          columns: [
            { key: 'label', label: 'Period' },
            { key: 'sales', label: 'Net sales', format: 'money', total: true },
            { key: 'purchases', label: 'Purchases', format: 'money', total: true },
            { key: 'expenses', label: 'Expenses', format: 'money', total: true },
          ],
          rows: series.map((row: any) => ({ ...row, _drill: groupBy === 'day' && row.sales ? { report: 'sale_register', filters: { from: row.key, to: row.key }, label: 'Open bills' } : undefined })),
        }],
        insights: [
          revenue > 0 ? `Gross margin on bills is ${margin}%.` : '',
          topExpense ? `Biggest expense: ${topExpense.name} (${rs(topExpense.value)}).` : '',
          milkLitres > 0 ? `Average milk rate: ${rs(milkCost / milkLitres)} per litre.` : '',
          supply > 0 ? `Milk supply (delivery) sales of ${rs(supply)} are not in net sales above.` : '',
          receivables > 0 || supplierDue + vendorDue > 0 ? `Customers owe ${rs(receivables)}; you owe ${rs(supplierDue + vendorDue)}.` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'profit_loss',
    title: 'Profit & Loss Statement',
    subtitle: 'Revenue, cost of goods from stock movement, expenses and net profit',
    category: 'financial',
    icon: 'FileBarChart',
    keywords: ['p&l', 'pnl', 'income statement', 'munafa', 'profit'],
    financial: true,
    comparable: true,
    build: (data, f) => {
      try {
        const source: StockProfitSource = {
          items: data.items as any[], sales: data.sales as any[], purchases: data.purchases as any[],
          materialPurchases: data.materialPurchases as any[], allocations: data.allocations as any[],
          productionBatches: data.productionBatches as any[], dailySupplyEntries: data.dailySupplyEntries as any[],
          expenses: data.expenses as any[], inventoryLogs: data.inventoryLogs as any[],
          supplierTransactions: data.supplierTransactions as any[], retailClosings: data.retailClosings as any[],
        };
        const p = buildStockProfitReport(source, f.from, f.to);
        const margin = r2(p.margin);
        const cats = [...p.expenseCategories].sort((a, b) => b.amount - a.amount);
        const lines = (rows: ReportSectionLine[]) => rows;
        return {
          kpis: [
            { key: 'netSales', label: 'Net sales', value: p.netSales, format: 'money', tone: 'good' },
            { key: 'cogs', label: 'Cost of goods', value: p.consumedCost, format: 'money', inverse: true },
            { key: 'gross', label: 'Gross profit', value: p.grossProfit, format: 'money', tone: p.grossProfit >= 0 ? 'good' : 'bad', hint: `${pct(p.grossProfit, p.netSales)}% of sales` },
            { key: 'expenses', label: 'Expenses', value: p.expenses, format: 'money', inverse: true },
            { key: 'net', label: 'Net profit', value: p.netProfit, format: 'money', tone: p.netProfit >= 0 ? 'good' : 'bad' },
            { key: 'margin', label: 'Net margin', value: margin, format: 'percent' },
          ],
          statements: [
            {
              id: 'revenue', title: 'Revenue', lines: lines([
                { label: 'POS sales', value: p.posSales, format: 'money', indent: 1 },
                { label: 'Milk supply sales', value: p.supplySales, format: 'money', indent: 1 },
                { label: 'Gross sales', value: p.grossSales, format: 'money' },
                { label: 'Less: sales returns', value: -p.salesReturns, format: 'money', indent: 1, tone: p.salesReturns > 0 ? 'bad' : undefined },
                { label: 'Net sales', value: p.netSales, format: 'money', strong: true },
              ]),
            },
            {
              id: 'cogs', title: 'Cost of sales', lines: lines([
                { label: 'Opening stock', value: p.openingStock, format: 'money', indent: 1 },
                { label: 'Net purchases', value: p.netPurchases, format: 'money', indent: 1, note: `Gross ${rs(p.grossPurchases)} less returns ${rs(p.purchaseReturns)}` },
                { label: 'Conversion cost', value: p.conversionCost, format: 'money', indent: 1 },
                { label: 'Stock adjustments', value: p.stockAdjustments, format: 'money', indent: 1 },
                { label: 'Less: closing stock', value: -p.closingStock, format: 'money', indent: 1 },
                { label: 'Cost of goods consumed', value: p.consumedCost, format: 'money', strong: true },
                ...(p.stockLoss ? [{ label: 'of which stock loss', value: p.stockLoss, format: 'money' as const, indent: 2, tone: 'bad' as Tone }] : []),
              ]),
            },
            {
              id: 'expenses', title: 'Operating expenses', lines: lines([
                ...cats.map(c => ({ label: c.name, value: c.amount, format: 'money' as const, indent: 1 })),
                { label: 'Total expenses', value: p.expenses, format: 'money', strong: true },
              ]),
            },
            {
              id: 'result', title: 'Profit', lines: lines([
                { label: 'Gross profit', value: p.grossProfit, format: 'money', strong: true, tone: p.grossProfit >= 0 ? 'good' : 'bad' },
                { label: 'Less: expenses', value: -p.expenses, format: 'money', indent: 1 },
                { label: 'Net profit', value: p.netProfit, format: 'money', strong: true, tone: p.netProfit >= 0 ? 'good' : 'bad' },
                { label: 'Net margin', value: margin, format: 'percent' },
              ]),
            },
          ],
          charts: [
            { id: 'expenses', title: 'Expenses by category', type: 'pie', xKey: 'name', format: 'money', data: topSlices(cats.map(c => ({ name: c.name, value: c.amount }))), series: [{ key: 'value', label: 'Expenses' }] },
            {
              id: 'waterfall', title: 'Sales to net profit', type: 'bar', xKey: 'name', format: 'money',
              data: [
                { name: 'Net sales', value: p.netSales }, { name: 'Cost of goods', value: p.consumedCost },
                { name: 'Gross profit', value: p.grossProfit }, { name: 'Expenses', value: p.expenses }, { name: 'Net profit', value: p.netProfit },
              ],
              series: [{ key: 'value', label: 'Amount', color: COLOR.profit }],
            },
          ],
          tables: [{
            id: 'stock', title: 'Stock movement at cost', subtitle: 'Opening and closing stock used for cost of goods', showTotals: true,
            sort: { key: 'closingValue', dir: 'desc' },
            columns: [
              { key: 'name', label: 'Stock' }, { key: 'location', label: 'Location', hidden: true }, { key: 'unit', label: 'Unit' },
              { key: 'openingQty', label: 'Opening qty', format: 'qty' }, { key: 'openingRate', label: 'Opening rate', format: 'money', hidden: true },
              { key: 'openingValue', label: 'Opening value', format: 'money', total: true },
              { key: 'closingQty', label: 'Closing qty', format: 'qty' }, { key: 'closingRate', label: 'Closing rate', format: 'money', hidden: true },
              { key: 'closingValue', label: 'Closing value', format: 'money', total: true },
              { key: 'change', label: 'Change', format: 'money', total: true, signed: true },
            ],
            rows: p.rows.map(r => ({ ...r, change: r2(r.closingValue - r.openingValue), _tone: r.closingQty < 0 ? 'bad' : undefined })),
          }],
          notes: [
            ...(!p.validRange ? [{ tone: 'bad' as Tone, text: 'The date range is not valid for the stock replay.' }] : []),
            ...p.issues.slice(0, 12).map(i => ({ tone: 'warn' as Tone, text: i.item ? `${i.message} (${i.item})` : i.message })),
            ...(p.issues.length > 12 ? [{ tone: 'warn' as Tone, text: `${p.issues.length - 12} more stock issue(s) not shown.` }] : []),
          ],
          insights: [
            p.netSales > 0 ? `Every Rs 100 of sales left Rs ${Math.round(margin)} as net profit.` : '',
            cats[0] ? `Largest expense: ${cats[0].name} (${rs(cats[0].amount)}).` : '',
          ].filter(Boolean),
        };
      } catch (error) {
        return { notes: [{ tone: 'bad', text: `Profit & Loss could not be built: ${error instanceof Error ? error.message : 'unknown error'}` }] };
      }
    },
  },
  {
    id: 'cash_flow',
    title: 'Cash Flow (Cash & Bank)',
    subtitle: 'Money in and out of all cash, bank and wallet accounts by category',
    category: 'financial',
    icon: 'ArrowLeftRight',
    keywords: ['cash flow', 'money in', 'money out', 'inflow', 'outflow'],
    financial: true,
    filters: ['accountId', 'groupBy'],
    comparable: true,
    build: (data, f) => {
      const accounts = data.accounts.filter(a => !f.accountId || a.id === f.accountId);
      const { txs, opening, closing } = balanceWindow(data, accounts, f);
      const inRangeTx = txs.filter(t => inRange(t.date, f)).sort(chronological);
      const flows = inRangeTx.filter(t => !isInternalCashTransfer(t) && txEffect(t) !== 0);
      const transfersNet = sum(inRangeTx.filter(t => isInternalCashTransfer(t)), txEffect);
      const inflows = groupSum(flows.filter(t => txEffect(t) > 0), txCategory, txEffect);
      const outflows = groupSum(flows.filter(t => txEffect(t) < 0), txCategory, t => -txEffect(t));
      const totalIn = sum(inflows, x => x.value);
      const totalOut = sum(outflows, x => x.value);
      const net = r2(totalIn - totalOut);
      const groupBy = autoGroup(f);
      const series = timeSeries(flows, t => t.date, f, groupBy, (b, t) => {
        const e = txEffect(t);
        if (e > 0) b.in += e; else b.out += -e;
        b.net += e;
      }, ['in', 'out', 'net']);
      const cats = new Map<string, { in: number; out: number; count: number }>();
      flows.forEach(t => {
        const row = cats.get(txCategory(t)) || { in: 0, out: 0, count: 0 };
        const e = txEffect(t);
        if (e > 0) row.in += e; else row.out += -e;
        row.count++;
        cats.set(txCategory(t), row);
      });
      return {
        kpis: [
          { key: 'opening', label: 'Opening balance', value: opening, format: 'money' },
          { key: 'in', label: 'Money in', value: totalIn, format: 'money', tone: 'good' },
          { key: 'out', label: 'Money out', value: totalOut, format: 'money', inverse: true, tone: 'bad' },
          { key: 'net', label: 'Net change', value: net, format: 'money', tone: net >= 0 ? 'good' : 'bad' },
          { key: 'closing', label: 'Closing balance', value: closing, format: 'money', tone: 'info' },
        ],
        statements: [{
          id: 'flow', title: f.accountId ? `Cash flow: ${accountName(data, f.accountId)}` : 'Cash flow: all accounts',
          lines: [
            { label: 'Opening balance', value: opening, format: 'money', strong: true },
            ...inflows.map(x => ({ label: x.name, value: x.value, format: 'money' as const, indent: 1 })),
            { label: 'Total money in', value: totalIn, format: 'money', strong: true, tone: 'good' },
            ...outflows.map(x => ({ label: x.name, value: -x.value, format: 'money' as const, indent: 1 })),
            { label: 'Total money out', value: -totalOut, format: 'money', strong: true, tone: 'bad' },
            { label: 'Net change', value: net, format: 'money', strong: true, tone: net >= 0 ? 'good' : 'bad' },
            ...(Math.abs(transfersNet) > 0.009 ? [{ label: 'Transfers between accounts (net)', value: transfersNet, format: 'money' as const, indent: 1, note: 'Moves money between your own accounts' }] : []),
            { label: 'Closing balance', value: closing, format: 'money', strong: true },
          ],
        }],
        charts: [{
          id: 'daily', title: `Net cash flow by ${groupBy}`, type: 'combo', data: series, xKey: 'label', format: 'money', wide: true,
          series: [
            { key: 'in', label: 'Money in', color: COLOR.cash },
            { key: 'out', label: 'Money out', color: COLOR.expense },
            { key: 'net', label: 'Net', color: COLOR.profit, asLine: true },
          ],
        }],
        tables: [
          {
            id: 'categories', title: 'By category', showTotals: true, sort: { key: 'out', dir: 'desc' },
            columns: [
              { key: 'category', label: 'Category' }, { key: 'count', label: 'Entries', format: 'number', total: true },
              { key: 'in', label: 'Money in', format: 'money', total: true }, { key: 'out', label: 'Money out', format: 'money', total: true },
              { key: 'net', label: 'Net', format: 'money', total: true, signed: true },
            ],
            rows: [...cats.entries()].map(([category, r]) => ({ category, count: r.count, in: r2(r.in), out: r2(r.out), net: r2(r.in - r.out) })),
          },
          {
            id: 'tx', title: 'Transactions', showTotals: true, sort: { key: 'date', dir: 'desc' },
            columns: [
              { key: 'date', label: 'Date / time', format: 'datetime' }, { key: 'account', label: 'Account' },
              { key: 'category', label: 'Category' }, { key: 'description', label: 'Description', wrap: true },
              { key: 'in', label: 'In', format: 'money', total: true }, { key: 'out', label: 'Out', format: 'money', total: true },
            ],
            rows: flows.map(t => {
              const e = txEffect(t);
              return {
                date: t.date, account: accountName(data, t.account_id), category: txCategory(t), description: t.description,
                in: e > 0 ? r2(e) : 0, out: e < 0 ? r2(-e) : 0,
                _drill: { report: 'account_ledger', filters: { accountId: t.account_id }, label: 'Account ledger' },
              };
            }),
          },
        ],
        notes: Math.abs(transfersNet) > 0.009 && !f.accountId
          ? [{ tone: 'info', text: 'Some transfers have only one side recorded, so they change the total balance. Cash sent to the head leaves the drawer at shift close and reaches an account only when it is accepted.' }]
          : undefined,
      };
    },
  },
  {
    id: 'account_ledger',
    title: 'Account Ledger (Bank / Cash Book)',
    subtitle: 'Every entry of one account with running balance',
    category: 'financial',
    icon: 'BookOpen',
    keywords: ['cash book', 'bank book', 'statement', 'ledger', 'running balance'],
    financial: true,
    filters: ['accountId'],
    requires: 'accountId',
    build: (data, f) => {
      const account = data.accounts.find(a => a.id === f.accountId);
      if (!account) return { notes: [{ tone: 'warn', text: 'Choose an account to see its ledger.' }] };
      const { txs, opening, closing } = balanceWindow(data, [account], f);
      const entries = txs.filter(t => inRange(t.date, f)).sort(chronological);
      const groupBy = autoGroup(f);
      let balance = opening;
      // Balance at the end of each day / week / month: the last running balance inside that bucket.
      const daily = new Map<string, number>();
      const rows: ReportRow[] = entries.map((t, index) => {
        const e = txEffect(t);
        balance = r2(balance + e);
        daily.set(bucketKey(dayOf(t.date), groupBy), balance);
        const transfer = isInternalCashTransfer(t);
        return {
          seq: index + 1, date: t.date, description: t.description, category: txCategory(t),
          type: transfer ? 'Transfer' : e > 0 ? 'In' : e < 0 ? 'Out' : 'Note',
          other: t.related_account_id ? accountName(data, t.related_account_id) : '',
          in: e > 0 ? r2(e) : 0, out: e < 0 ? r2(-e) : 0, balance,
          _tone: balance < 0 ? 'bad' : undefined,
        };
      });
      const totalIn = sum(rows, r => n(r.in));
      const totalOut = sum(rows, r => n(r.out));
      // "All time" starts at the first entry; it used to draw (and cut off at) daily points from the year 2000.
      const seriesFrom = isOpenStart(f.from) ? (entries.length ? dayOf(entries[0].date) : f.to) : f.from;
      const keys = bucketKeys(seriesFrom, f.to, groupBy);
      let last = opening;
      const balanceSeries = (keys.length ? keys : [...daily.keys()]).map(key => {
        if (daily.has(key)) last = daily.get(key)!;
        return { key, label: bucketLabel(key, groupBy), balance: last };
      });
      return {
        kpis: [
          { key: 'opening', label: 'Opening balance', value: opening, format: 'money' },
          { key: 'in', label: 'Money in', value: totalIn, format: 'money', tone: 'good' },
          { key: 'out', label: 'Money out', value: totalOut, format: 'money', inverse: true },
          { key: 'closing', label: 'Closing balance', value: closing, format: 'money', tone: closing < 0 ? 'bad' : 'info' },
          { key: 'entries', label: 'Entries', value: rows.length, format: 'number' },
        ],
        charts: [{
          id: 'balance', title: `Balance by ${groupBy}`, type: 'line', data: balanceSeries, xKey: 'label', format: 'money', wide: true,
          series: [{ key: 'balance', label: 'Balance', color: COLOR.online }],
        }],
        tables: [{
          id: 'ledger', title: `${account.name} (${account.type})`, showTotals: true, sort: { key: 'seq', dir: 'asc' },
          columns: [
            { key: 'seq', label: '#', format: 'number' },
            { key: 'date', label: 'Date / time', format: 'datetime' },
            { key: 'description', label: 'Description', wrap: true },
            { key: 'category', label: 'Category' },
            { key: 'type', label: 'Type', format: 'badge', tones: { In: 'good', Out: 'bad', Transfer: 'info', Note: 'neutral' } },
            { key: 'other', label: 'Other account', hidden: true },
            { key: 'in', label: 'In', format: 'money', total: true },
            { key: 'out', label: 'Out', format: 'money', total: true },
            { key: 'balance', label: 'Balance', format: 'money', signed: true },
          ],
          rows,
          footer: [
            { description: 'Opening balance', balance: opening, _strong: true },
            { description: 'Closing balance', balance: closing, _strong: true },
          ],
          emptyText: 'No entries for this account in the selected dates.',
        }],
        notes: Math.abs(closing - balance) > 0.01
          ? [{ tone: 'warn', text: 'Some entries have no date or an unknown type, so the running balance may not match the closing balance.' }]
          : undefined,
      };
    },
  },
  {
    id: 'accounts_summary',
    title: 'Cash & Bank Balances',
    subtitle: 'Balance of every cash, bank and wallet account with period activity',
    category: 'financial',
    icon: 'Landmark',
    keywords: ['bank balance', 'cash in hand', 'wallet', 'accounts'],
    financial: true,
    snapshot: true,
    build: (data, f) => {
      // One pass over the bank ledger instead of one pass per account.
      const activity = new Map<string, { inflow: number; outflow: number; last: string }>();
      data.bankTransactions.forEach(t => {
        if (!t?.account_id) return;
        const row = activity.get(t.account_id) || { inflow: 0, outflow: 0, last: '' };
        const day = dayOf(t.date);
        if (day > row.last) row.last = day;
        if (inRange(t.date, f)) {
          const e = txEffect(t);
          if (e > 0) row.inflow += e; else row.outflow -= e;
        }
        activity.set(t.account_id, row);
      });
      const rows: ReportRow[] = data.accounts.map(a => {
        const act = activity.get(a.id);
        const inflow = r2(act?.inflow || 0);
        const outflow = r2(act?.outflow || 0);
        const last = act?.last || '';
        return {
          account: a.name, type: a.type, bank: [a.bank_name, a.account_number].filter(Boolean).join(' · '),
          status: a.isActive === false ? 'Inactive' : a.isDrawer ? 'Drawer' : 'Active',
          inflow, outflow, net: r2(inflow - outflow), balance: r2(n(a.balance)), last,
          _tone: n(a.balance) < 0 ? 'bad' : undefined,
          _drill: { report: 'account_ledger', filters: { accountId: a.id }, label: 'Account ledger' },
        };
      });
      const byType = (type: string) => sum(data.accounts.filter(a => a.type === type), a => n(a.balance));
      return {
        kpis: [
          { key: 'total', label: 'Total balance', value: sum(rows, r => n(r.balance)), format: 'money', tone: 'info' },
          { key: 'cash', label: 'Cash', value: byType('Cash'), format: 'money' },
          { key: 'bank', label: 'Bank', value: byType('Bank'), format: 'money' },
          { key: 'wallet', label: 'Wallets', value: byType('Wallet'), format: 'money' },
          { key: 'accounts', label: 'Accounts', value: rows.length, format: 'number' },
        ],
        charts: [{
          id: 'balances', title: 'Balance by account', type: 'pie', xKey: 'name', format: 'money',
          data: topSlices(rows.map(r => ({ name: String(r.account), value: n(r.balance) })).sort((a, b) => b.value - a.value)),
          series: [{ key: 'value', label: 'Balance' }],
        }],
        tables: [{
          id: 'accounts', showTotals: true, sort: { key: 'balance', dir: 'desc' },
          columns: [
            { key: 'account', label: 'Account' },
            { key: 'type', label: 'Type', format: 'badge', tones: { Cash: 'good', Bank: 'info', Wallet: 'warn' } },
            { key: 'bank', label: 'Bank / number', hidden: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Active: 'good', Drawer: 'info', Inactive: 'neutral' } },
            { key: 'inflow', label: 'In (period)', format: 'money', total: true },
            { key: 'outflow', label: 'Out (period)', format: 'money', total: true },
            { key: 'net', label: 'Net (period)', format: 'money', total: true, signed: true, hidden: true },
            { key: 'balance', label: 'Balance today', format: 'money', total: true, signed: true },
            { key: 'last', label: 'Last activity', format: 'date' },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'day_book',
    title: 'Day Book',
    subtitle: 'Every sale, payment, purchase, expense and bank entry in order',
    category: 'financial',
    icon: 'NotebookText',
    keywords: ['roznamcha', 'journal', 'daily register', 'day book'],
    defaultPreset: 'today',
    build: (data, f) => {
      const rows: ReportRow[] = [];
      const covered = new Set<string>();
      const add = (id: string, row: ReportRow) => { covered.add(id); rows.push(row); };

      reportSales(data, f).forEach(s => {
        const fig = saleFigures(s);
        add(s.id, {
          time: s.date, type: 'Sale', ref: s.bill_number, party: customerName(data, s.customer_id, s.customer_name),
          description: `${saleMode(s)} bill · net ${rs(fig.net)}${fig.credit > 0 ? ` · khata ${rs(fig.credit)}` : ''}`,
          in: fig.paid, out: 0, moved: 0,
          _drill: { report: 'sale_register', filters: { from: dayOf(s.date), to: dayOf(s.date) }, label: 'Bills of the day' },
        });
      });
      // Opening-balance and bad-debt write-off rows are khata entries: listed, but no money came in.
      data.customerTransactions.filter(t => t.type === 'Payment' && inRange(t.date, f)).forEach(t => {
        const money = !isNonCashCustomerTx(t);
        add(t.id, {
          time: t.created_at && dayOf(t.created_at) === dayOf(t.date) ? t.created_at : t.date, type: money ? 'Customer payment' : 'Khata adjustment', ref: t.mode || '',
          party: customerName(data, t.customer_id, 'Customer'), description: t.note || (money ? 'Payment received' : 'No money received'),
          in: money ? r2(n(t.amount)) : 0, out: 0, moved: 0,
          _drill: { report: 'customer_statement', filters: { customerId: t.customer_id }, label: 'Customer statement' },
        });
      });
      // A supplier waiver settles the khata without paying anything.
      data.supplierTransactions.filter(t => (t.type === 'Payment' || t.type === 'Advance') && inRange(t.date, f) && !isSpotSupplierPayment(t)).forEach(t => {
        const waiver = isSupplierWaiver(t);
        add(t.id, {
          time: t.created_at && dayOf(t.created_at) === dayOf(t.date) ? t.created_at : t.date, type: waiver ? 'Supplier waiver' : 'Supplier payment', ref: t.mode || '',
          party: supplierName(data, t.supplier_id), description: t.note || (waiver ? 'Settled by waiver, nothing paid' : t.type === 'Advance' ? 'Advance paid' : 'Payment made'),
          in: 0, out: waiver ? 0 : r2(n(t.amount)), moved: 0,
          _drill: { report: 'supplier_statement', filters: { supplierId: t.supplier_id }, label: 'Supplier statement' },
        });
      });
      milkPurchases(data, f).forEach(p => add(p.id, {
        time: p.created_at && dayOf(p.created_at) === dayOf(p.date) ? p.created_at : p.date, type: 'Milk purchase', ref: String(p.shift || ''),
        party: supplierName(data, p.supplier_id, p.supplier_name),
        description: `${r3(n(p.quantity))} L ${p.milk_type || ''} @ ${r2(n(p.rate))} · bill ${rs(n(p.total_amount))}`,
        in: 0, out: purchaseCashPaid(p), moved: 0,
        _drill: p.supplier_id ? { report: 'supplier_statement', filters: { supplierId: p.supplier_id }, label: 'Supplier statement' } : undefined,
      }));
      materialPurchases(data, f).forEach(p => add(p.id, {
        time: p.created_at && dayOf(p.created_at) === dayOf(p.date) ? p.created_at : p.date, type: 'Material purchase', ref: String(p.purchase_type || ''),
        party: supplierName(data, p.supplier_id, 'Spot purchase'),
        description: `${p.item_name} · ${r3(n(p.quantity))} ${p.unit || ''} · bill ${rs(n(p.total_amount))}`,
        in: 0, out: materialCashPaid(p), moved: 0,
        _drill: p.supplier_id ? { report: 'supplier_statement', filters: { supplierId: p.supplier_id }, label: 'Supplier statement' } : undefined,
      }));
      activeExpenses(data, f).forEach(e => add(e.id, {
        time: e.created_at && dayOf(e.created_at) === dayOf(e.date) ? e.created_at : e.date, type: 'Expense', ref: e.referenceNo || '',
        party: e.vendor_name || '', description: [e.category, e.description].filter(Boolean).join(' · '),
        // Bad-debt write-offs ('Adjustment') move no cash.
        in: 0, out: e.paymentMode === 'Adjustment' ? 0 : expenseCashPaid(e), moved: 0,
        _drill: { report: 'expense_register', filters: { category: e.category }, label: 'Expenses in category' },
      }));

      const isCovered = (t: BankTransaction) => {
        if (isSalesRefundTx(t) || isPurchaseReturnTx(t)) return false;
        const refs = String(t.reference_id || '').split(',').map(x => x.trim()).filter(Boolean);
        if (refs.some(ref => covered.has(ref))) return true;
        const id = String(t.id || '');
        return covered.has(id.replace(/^btx_(pur_|mp_|ds_)?/, '')) || covered.has(id);
      };
      data.bankTransactions.filter(t => inRange(t.date, f) && !isCovered(t)).forEach(t => {
        const e = txEffect(t);
        const transfer = isInternalCashTransfer(t);
        if (transfer && e >= 0) return; // show each transfer once, on its paying side
        if (!transfer && e === 0) return;
        const type = transfer ? 'Transfer' : isSalesRefundTx(t) ? 'Refund' : isPurchaseReturnTx(t) ? 'Purchase return' : e > 0 ? 'Deposit' : 'Withdrawal';
        rows.push({
          time: t.created_at && dayOf(t.created_at) === dayOf(t.date) ? t.created_at : t.date, type, ref: txCategory(t),
          party: transfer && t.related_account_id ? `${accountName(data, t.account_id)} → ${accountName(data, t.related_account_id)}` : accountName(data, t.account_id),
          description: t.description, in: !transfer && e > 0 ? r2(e) : 0, out: !transfer && e < 0 ? r2(-e) : 0, moved: transfer ? r2(-e) : 0,
          _drill: { report: 'account_ledger', filters: { accountId: t.account_id }, label: 'Account ledger' },
        });
      });

      const moneyIn = sum(rows, r => n(r.in));
      const moneyOut = sum(rows, r => n(r.out));
      const net = r2(moneyIn - moneyOut);
      return {
        kpis: [
          { key: 'entries', label: 'Entries', value: rows.length, format: 'number' },
          { key: 'in', label: 'Money in', value: moneyIn, format: 'money', tone: 'good' },
          { key: 'out', label: 'Money out', value: moneyOut, format: 'money', inverse: true, tone: 'bad' },
          { key: 'net', label: 'Net', value: net, format: 'money', tone: net >= 0 ? 'good' : 'bad' },
        ],
        tables: [{
          id: 'daybook', showTotals: true, sort: { key: 'time', dir: 'asc' },
          columns: [
            { key: 'time', label: 'Date / time', format: 'datetime' },
            {
              key: 'type', label: 'Type', format: 'badge', tones: {
                Sale: 'good', 'Customer payment': 'good', Deposit: 'good', 'Purchase return': 'good',
                'Supplier payment': 'warn', Refund: 'warn', 'Milk purchase': 'info', 'Material purchase': 'info',
                Expense: 'bad', Withdrawal: 'bad', Transfer: 'neutral', 'Khata adjustment': 'neutral', 'Supplier waiver': 'neutral',
              },
            },
            { key: 'ref', label: 'Reference' },
            { key: 'party', label: 'Party / account' },
            { key: 'description', label: 'Description', wrap: true },
            { key: 'in', label: 'Money in', format: 'money', total: true },
            { key: 'out', label: 'Money out', format: 'money', total: true },
            { key: 'moved', label: 'Transferred', format: 'money', total: true, hidden: true },
          ],
          rows,
          emptyText: 'Nothing was recorded in these dates.',
        }],
        notes: [{ tone: 'info', text: 'Sales show cash and online taken at the counter. Credit bills add to khata, not to money in.' }],
      };
    },
  },
  {
    id: 'balance_snapshot',
    title: 'Balance Sheet (Snapshot)',
    subtitle: 'What the business owns and owes today',
    category: 'financial',
    icon: 'Scale',
    keywords: ['balance sheet', 'assets', 'liabilities', 'equity', 'net worth'],
    financial: true,
    snapshot: true,
    build: data => {
      const accountLines = [...data.accounts].sort((a, b) => n(b.balance) - n(a.balance))
        .map(a => ({ label: `${a.name} (${a.type})`, value: r2(n(a.balance)), format: 'money' as const, indent: 2, tone: n(a.balance) < 0 ? 'bad' as Tone : undefined }));
      const cashBank = sum(data.accounts, a => n(a.balance));
      // Cash remitted to the head leaves the drawer account at shift close and reaches no account until
      // it is accepted (docs/cash-control.md): it is still the business's money, in transit.
      const transit = cashInTransit(data);
      const receivables = sum(data.customers, c => Math.max(0, n(c.balance)));
      const supplierAdvances = sum(data.suppliers, s => Math.max(0, -supplierBalance(s)));
      const stock = stockAtCost(data);
      const milk = unallocatedMilkValue(data);
      const assets = r2(cashBank + transit + receivables + supplierAdvances + stock.value + milk);
      const payables = sum(data.suppliers, s => Math.max(0, supplierBalance(s)));
      const advances = sum(data.customers, c => Math.max(0, -n(c.balance)));
      const vendorDue = sum(data.expenseVendors, v => Math.max(0, n(v.pending_balance)));
      const liabilities = r2(payables + advances + vendorDue);
      const equity = r2(assets - liabilities);
      return {
        kpis: [
          { key: 'assets', label: 'Total assets', value: assets, format: 'money', tone: 'good' },
          { key: 'liabilities', label: 'Total liabilities', value: liabilities, format: 'money', inverse: true, tone: 'warn' },
          { key: 'equity', label: "Owner's equity", value: equity, format: 'money', tone: equity >= 0 ? 'good' : 'bad' },
          { key: 'cash', label: 'Cash & bank', value: r2(cashBank + transit), format: 'money', hint: transit > 0 ? `Incl. ${rs(transit)} in transit` : undefined },
          { key: 'stock', label: 'Stock at cost', value: r2(stock.value + milk), format: 'money' },
        ],
        statements: [
          {
            id: 'assets', title: 'Assets', lines: [
              { label: 'Cash & bank', value: cashBank, format: 'money', indent: 1 },
              ...accountLines,
              ...(transit > 0 ? [{ label: 'Cash in transit (sent to head, not yet received)', value: transit, format: 'money' as const, indent: 1 }] : []),
              { label: 'Receivables (customers owe)', value: receivables, format: 'money', indent: 1 },
              { label: 'Advances to suppliers', value: supplierAdvances, format: 'money', indent: 1 },
              { label: 'Stock at cost', value: stock.value, format: 'money', indent: 1 },
              { label: 'Unallocated raw milk', value: milk, format: 'money', indent: 1 },
              { label: 'Total assets', value: assets, format: 'money', strong: true, tone: 'good' },
            ],
          },
          {
            id: 'liabilities', title: 'Liabilities', lines: [
              { label: 'Supplier payables', value: payables, format: 'money', indent: 1 },
              { label: 'Customer advances', value: advances, format: 'money', indent: 1 },
              { label: 'Expense vendors pending', value: vendorDue, format: 'money', indent: 1 },
              { label: 'Total liabilities', value: liabilities, format: 'money', strong: true, tone: 'warn' },
            ],
          },
          {
            id: 'equity', title: "Owner's equity", lines: [
              { label: 'Total assets', value: assets, format: 'money', indent: 1 },
              { label: 'Less: total liabilities', value: -liabilities, format: 'money', indent: 1 },
              { label: "Owner's equity", value: equity, format: 'money', strong: true, tone: equity >= 0 ? 'good' : 'bad' },
            ],
          },
        ],
        charts: [{
          id: 'assets', title: 'Assets mix', type: 'pie', xKey: 'name', format: 'money',
          data: [
            { name: 'Cash & bank', value: cashBank }, { name: 'Cash in transit', value: transit }, { name: 'Receivables', value: receivables },
            { name: 'Stock', value: stock.value }, { name: 'Raw milk', value: milk }, { name: 'Supplier advances', value: supplierAdvances },
          ].filter(x => x.value > 0),
          series: [{ key: 'value', label: 'Value' }],
        }],
        notes: [
          { tone: 'info', text: 'Equity here is assets minus liabilities. Fixed assets and loans are not included.' },
          ...(stock.missing ? [{ tone: 'warn' as Tone, text: `${stock.missing} product(s) have stock but no cost price, so they are valued at zero.` }] : []),
          ...(stock.negative ? [{ tone: 'warn' as Tone, text: `${stock.negative} product(s) show minus stock, valued at zero (same as Stock Valuation). Fix them with a stock count.` }] : []),
        ],
      };
    },
  },
];
