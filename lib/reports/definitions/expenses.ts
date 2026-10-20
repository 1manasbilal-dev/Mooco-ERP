import type { ReportData, ReportDefinition, ReportFilters, ReportRow } from '../types';
import {
  accountName, autoGroup, CHART_COLORS, COLOR, dayOf, groupSum, inRange, lower, n, pct, r2, sum, timeSeries, topSlices
} from '../helpers';
import { expenseCashPaid } from '../../moneyFlow';
import type { ExpenseEntry } from '../../../types';

/* ------------------------------------------------------------- local helpers */

const categoryOf = (e: ExpenseEntry) => String(e.category || '').trim() || 'Uncategorised';
const subcategoryOf = (e: ExpenseEntry) => String(e.subcategory || (e as any).details?.subcategory || '').trim() || 'General';

const isVoidExpense = (e: ExpenseEntry) => /void|cancel|delete/i.test(String((e as any).status || (e as any).details?.status || ''));

const expensesInRange = (data: ReportData, f: Pick<ReportFilters, 'from' | 'to' | 'category' | 'accountId'>) =>
  data.expenses.filter(e => !isVoidExpense(e) && inRange(e.date, f)
    && (!f.category || categoryOf(e) === f.category)
    && (!f.accountId || e.account_id === f.accountId || (e as any).details?.account_id === f.accountId));

interface ExpenseFigures { amount: number; paid: number; unpaid: number; status: 'Paid' | 'Partial' | 'Unpaid' }

function expenseFigures(e: ExpenseEntry): ExpenseFigures {
  const amount = r2(Math.max(0, n(e.amount)));
  const paid = r2(Math.min(amount, expenseCashPaid(e)));
  const unpaid = r2(Math.max(0, amount - paid));
  const status = unpaid <= 0.005 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
  return { amount, paid, unpaid, status };
}

const STATUS_TONES = { Paid: 'good', Partial: 'warn', Unpaid: 'bad' } as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

/** The `count` month keys (YYYY-MM) ending with the month of `to`. */
function lastMonths(to: string, count: number): string[] {
  const y = Number(to.slice(0, 4));
  const m = Number(to.slice(5, 7)) - 1;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1, 12));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

const vendorMatches = (e: ExpenseEntry, vendorId: string, vendorName: string) =>
  e.vendor_id === vendorId || (!e.vendor_id && Boolean(e.vendor_name) && lower(e.vendor_name) === vendorName);

/* ---------------------------------------------------------------- reports */

export const expenseReports: ReportDefinition[] = [
  {
    id: 'expense_summary',
    title: 'Expense Summary',
    subtitle: 'Spending by category and subcategory, paid and unpaid',
    category: 'expenses',
    icon: 'Receipt',
    keywords: ['kharcha', 'overheads', 'spending', 'costs'],
    financial: true,
    filters: ['category', 'groupBy'],
    comparable: true,
    build: (data, f) => {
      const list = expensesInRange(data, f).map(e => ({ e, ...expenseFigures(e) }));
      const total = sum(list, x => x.amount);
      const cats = new Map<string, { amount: number; paid: number; unpaid: number; count: number; subs: number }>();
      const subs = new Map<string, { category: string; subcategory: string; amount: number; paid: number; unpaid: number; count: number }>();
      list.forEach(x => {
        const cat = categoryOf(x.e);
        const sub = subcategoryOf(x.e);
        const c = cats.get(cat) || { amount: 0, paid: 0, unpaid: 0, count: 0, subs: 0 };
        c.amount += x.amount; c.paid += x.paid; c.unpaid += x.unpaid; c.count++;
        cats.set(cat, c);
        const key = `${cat}\u0000${sub}`;
        const s = subs.get(key) || { category: cat, subcategory: sub, amount: 0, paid: 0, unpaid: 0, count: 0 };
        s.amount += x.amount; s.paid += x.paid; s.unpaid += x.unpaid; s.count++;
        subs.set(key, s);
      });
      [...subs.values()].forEach(s => { const c = cats.get(s.category); if (c) c.subs++; });
      const catRows: ReportRow[] = [...cats.entries()].map(([category, c]) => ({
        category, subs: c.subs, count: c.count, amount: r2(c.amount), paid: r2(c.paid), unpaid: r2(c.unpaid), share: pct(c.amount, total),
        _tone: c.unpaid > 0 ? 'warn' : undefined,
        _drill: { report: 'expense_register', filters: { category }, label: 'Expenses in category' },
      }));
      const subRows: ReportRow[] = [...subs.values()].map(s => ({
        category: s.category, subcategory: s.subcategory, count: s.count, amount: r2(s.amount), paid: r2(s.paid), unpaid: r2(s.unpaid),
        share: pct(s.amount, total), catShare: pct(s.amount, n(cats.get(s.category)?.amount)),
        _drill: { report: 'expense_register', filters: { category: s.category }, label: 'Expenses in category' },
      }));
      const groupBy = autoGroup(f);
      const series = timeSeries(list, x => x.e.date, f, groupBy, (b, x) => { b.amount += x.amount; b.paid += x.paid; b.unpaid += x.unpaid; }, ['amount', 'paid', 'unpaid']);
      const biggest = [...catRows].sort((a, b) => n(b.amount) - n(a.amount))[0];
      const peak = [...series].sort((a: any, b: any) => b.amount - a.amount)[0] as any;
      const unpaid = sum(list, x => x.unpaid);
      return {
        kpis: [
          { key: 'total', label: 'Total expenses', value: total, format: 'money', tone: 'bad', inverse: true },
          { key: 'paid', label: 'Paid', value: sum(list, x => x.paid), format: 'money', inverse: true },
          { key: 'unpaid', label: 'Unpaid', value: unpaid, format: 'money', tone: unpaid > 0 ? 'warn' : 'good', inverse: true },
          { key: 'count', label: 'Entries', value: list.length, format: 'number' },
          { key: 'categories', label: 'Categories', value: catRows.length, format: 'number' },
        ],
        charts: [
          { id: 'cats', title: 'By category', type: 'pie', xKey: 'name', format: 'money', data: topSlices(groupSum(catRows, r => String(r.category), r => n(r.amount))), series: [{ key: 'value', label: 'Amount' }] },
          { id: 'trend', title: `Expenses by ${groupBy}`, type: 'stacked', xKey: 'label', format: 'money', data: series, series: [{ key: 'paid', label: 'Paid', color: COLOR.expense }, { key: 'unpaid', label: 'Unpaid', color: COLOR.credit }] },
        ],
        tables: [
          {
            id: 'categories', title: 'By category', showTotals: true, sort: { key: 'amount', dir: 'desc' },
            columns: [
              { key: 'category', label: 'Category' },
              { key: 'subs', label: 'Subcategories', format: 'number', hidden: true },
              { key: 'count', label: 'Entries', format: 'number', total: true },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'paid', label: 'Paid', format: 'money', total: true },
              { key: 'unpaid', label: 'Unpaid', format: 'money', total: true },
              { key: 'share', label: 'Share', format: 'percent' },
            ],
            rows: catRows,
            emptyText: 'No expenses in this period.',
          },
          {
            id: 'subcategories', title: 'By subcategory', showTotals: true, sort: { key: 'amount', dir: 'desc' },
            columns: [
              { key: 'category', label: 'Category' },
              { key: 'subcategory', label: 'Subcategory' },
              { key: 'count', label: 'Entries', format: 'number', total: true },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'paid', label: 'Paid', format: 'money', total: true, hidden: true },
              { key: 'unpaid', label: 'Unpaid', format: 'money', total: true },
              { key: 'catShare', label: 'Of category', format: 'percent' },
              { key: 'share', label: 'Of total', format: 'percent' },
            ],
            rows: subRows,
            emptyText: 'No expenses in this period.',
          },
        ],
        insights: [
          biggest && n(biggest.amount) > 0 ? `Biggest category: ${biggest.category} (${biggest.share}% of spending)` : '',
          peak && peak.amount > 0 ? `Highest ${groupBy}: ${peak.label} with Rs ${Math.round(peak.amount).toLocaleString('en-PK')}` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'expense_register',
    title: 'Expense Register',
    subtitle: 'Every expense with vendor, payment mode, account and status',
    category: 'expenses',
    icon: 'ListChecks',
    keywords: ['expense list', 'voucher', 'bills paid'],
    financial: true,
    filters: ['category', 'accountId'],
    build: (data, f) => {
      const rows: ReportRow[] = expensesInRange(data, f).map(e => {
        const fig = expenseFigures(e);
        const accountId = e.account_id || (e as any).details?.account_id;
        return {
          date: e.date, category: categoryOf(e), subcategory: e.subcategory || '', description: e.description || '',
          vendor: e.vendor_name || '', mode: e.paymentMode || (e as any).payment_mode || '',
          account: e.account_name || (accountId ? accountName(data, accountId) : ''), ref: e.referenceNo || '',
          amount: fig.amount, paid: fig.paid, unpaid: fig.unpaid, status: fig.status, due: e.dueDate || null,
          _tone: fig.status === 'Unpaid' ? 'bad' : fig.status === 'Partial' ? 'warn' : undefined,
        };
      });
      const unpaid = sum(rows, r => n(r.unpaid));
      return {
        kpis: [
          { key: 'count', label: 'Entries', value: rows.length, format: 'number' },
          { key: 'amount', label: 'Total', value: sum(rows, r => n(r.amount)), format: 'money', inverse: true },
          { key: 'paid', label: 'Paid', value: sum(rows, r => n(r.paid)), format: 'money', inverse: true },
          { key: 'unpaid', label: 'Unpaid', value: unpaid, format: 'money', tone: unpaid > 0 ? 'warn' : 'good', inverse: true },
        ],
        tables: [{
          id: 'expenses', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Date', format: 'date' },
            { key: 'category', label: 'Category' },
            { key: 'subcategory', label: 'Subcategory' },
            { key: 'description', label: 'Description', wrap: true },
            { key: 'vendor', label: 'Vendor' },
            { key: 'mode', label: 'Mode', format: 'badge' },
            { key: 'account', label: 'Account' },
            { key: 'ref', label: 'Ref #', hidden: true },
            { key: 'amount', label: 'Amount', format: 'money', total: true },
            { key: 'paid', label: 'Paid', format: 'money', total: true },
            { key: 'unpaid', label: 'Unpaid', format: 'money', total: true, hidden: true },
            { key: 'due', label: 'Due date', format: 'date', hidden: true },
            { key: 'status', label: 'Status', format: 'badge', tones: STATUS_TONES },
          ],
          rows,
          emptyText: 'No expenses in this period.',
        }],
      };
    },
  },
  {
    id: 'vendor_payables',
    title: 'Expense Vendor Balances',
    subtitle: 'What is owed to each expense vendor, with bills and payments',
    category: 'expenses',
    icon: 'Store',
    keywords: ['vendor dues', 'payable', 'udhaar', 'service providers'],
    financial: true,
    snapshot: true,
    build: (data, f) => {
      const period = (date?: string) => Boolean(f.from && f.to) && inRange(date, f);
      const rows: ReportRow[] = data.expenseVendors.filter(v => v.isActive !== false || n(v.pending_balance) !== 0).map(v => {
        const name = lower(v.name);
        const bills = data.expenses.filter(e => !isVoidExpense(e) && vendorMatches(e, v.id, name));
        const billIds = new Set(bills.map(e => e.id));
        // Ledger rows tied to an expense are already counted from that expense.
        const txs = data.expenseVendorTransactions.filter(t => t.vendor_id === v.id && !(t.expense_id && billIds.has(t.expense_id)));
        const billTx = txs.filter(t => t.type === 'Bill');
        const payTx = txs.filter(t => t.type === 'Payment');
        const refundTx = txs.filter(t => t.type === 'Refund');
        const billedAll = sum(bills, e => n(e.amount)) + sum(billTx, t => n(t.amount));
        const paidAll = sum(bills, e => expenseCashPaid(e)) + sum(payTx, t => n(t.amount));
        const billed = v.total_billed !== undefined && v.total_billed !== null ? n(v.total_billed) : billedAll;
        const paid = v.total_paid !== undefined && v.total_paid !== null ? n(v.total_paid) : paidAll;
        const pending = v.pending_balance !== undefined && v.pending_balance !== null
          ? n(v.pending_balance)
          : n(v.opening_balance) + billed - paid + sum(refundTx, t => n(t.amount));
        const dates = [...bills.map(e => dayOf(e.date)), ...txs.map(t => dayOf(t.date))].filter(Boolean).sort();
        const periodBilled = sum(bills.filter(e => period(e.date)), e => n(e.amount)) + sum(billTx.filter(t => period(t.date)), t => n(t.amount));
        const periodPaid = sum(bills.filter(e => period(e.date)), e => expenseCashPaid(e)) + sum(payTx.filter(t => period(t.date)), t => n(t.amount));
        return {
          vendor: v.name, service: v.service_type || '', phone: v.phone || '', opening: r2(n(v.opening_balance)),
          billed: r2(billed), paid: r2(paid), pending: r2(pending), periodBilled: r2(periodBilled), periodPaid: r2(periodPaid),
          last: dates[dates.length - 1] || null,
          _tone: pending > 0 ? 'warn' : pending < 0 ? 'info' : undefined,
        };
      });
      const owed = sum(rows.filter(r => n(r.pending) > 0), r => n(r.pending));
      const advance = sum(rows.filter(r => n(r.pending) < 0), r => -n(r.pending));
      const top = [...rows].filter(r => n(r.pending) > 0).sort((a, b) => n(b.pending) - n(a.pending)).slice(0, 10);
      const periodText = f.from && f.to ? `${f.from} to ${f.to}` : 'the selected period';
      return {
        kpis: [
          { key: 'owed', label: 'We owe vendors', value: owed, format: 'money', tone: owed > 0 ? 'warn' : 'good', inverse: true },
          { key: 'vendors', label: 'Vendors with dues', value: rows.filter(r => n(r.pending) > 0).length, format: 'number' },
          { key: 'advance', label: 'Advances paid', value: advance, format: 'money' },
          { key: 'periodBilled', label: 'Billed in period', value: sum(rows, r => n(r.periodBilled)), format: 'money', hint: periodText },
          { key: 'periodPaid', label: 'Paid in period', value: sum(rows, r => n(r.periodPaid)), format: 'money', hint: periodText },
        ],
        charts: top.length ? [{
          id: 'dues', title: 'Top vendor dues', type: 'bar', wide: true, xKey: 'name', format: 'money',
          data: top.map(r => ({ name: r.vendor, pending: r.pending })), series: [{ key: 'pending', label: 'Pending', color: COLOR.credit }],
        }] : undefined,
        tables: [{
          id: 'vendors', showTotals: true, sort: { key: 'pending', dir: 'desc' },
          subtitle: `Bills and payments in period: ${periodText}`,
          columns: [
            { key: 'vendor', label: 'Vendor' },
            { key: 'service', label: 'Service' },
            { key: 'phone', label: 'Phone', hidden: true },
            { key: 'opening', label: 'Opening', format: 'money', total: true, hidden: true },
            { key: 'billed', label: 'Total billed', format: 'money', total: true },
            { key: 'paid', label: 'Total paid', format: 'money', total: true },
            { key: 'pending', label: 'Pending', format: 'money', total: true, signed: true },
            { key: 'periodBilled', label: 'Billed in period', format: 'money', total: true },
            { key: 'periodPaid', label: 'Paid in period', format: 'money', total: true },
            { key: 'last', label: 'Last activity', format: 'date' },
          ],
          rows,
          emptyText: 'No expense vendors yet.',
        }],
        notes: advance > 0 ? [{ tone: 'info', text: 'A negative pending balance means we paid the vendor in advance.' }] : undefined,
      };
    },
  },
  {
    id: 'expense_trend',
    title: 'Expense Trend (Month on Month)',
    subtitle: 'Each category over the last 12 months',
    category: 'expenses',
    icon: 'CalendarRange',
    keywords: ['monthly expenses', 'expense growth', 'mahana kharcha'],
    financial: true,
    filters: ['category'],
    build: (data, f) => {
      const to = f.to || data.today;
      const months = lastMonths(to, 12);
      const from = `${months[0]}-01`;
      const list = expensesInRange(data, { from, to, category: f.category });
      const pivot = new Map<string, Record<string, number>>();
      const monthTotals: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));
      list.forEach(e => {
        const m = dayOf(e.date).slice(0, 7);
        if (!(m in monthTotals)) return;
        const amount = Math.max(0, n(e.amount));
        const cat = categoryOf(e);
        const row = pivot.get(cat) || Object.fromEntries(months.map(k => [k, 0]));
        row[m] += amount;
        pivot.set(cat, row);
        monthTotals[m] += amount;
      });
      const total = Object.values(monthTotals).reduce((s, v) => s + v, 0);
      const rows: ReportRow[] = [...pivot.entries()].map(([category, values]) => {
        const row: ReportRow = { category };
        months.forEach((m, i) => { row[`m${i}`] = r2(values[m]); });
        const rowTotal = months.reduce((s, m) => s + values[m], 0);
        row.total = r2(rowTotal);
        row.avg = r2(rowTotal / 12);
        row.share = pct(rowTotal, total);
        row._drill = { report: 'expense_register', filters: { category, from, to }, label: 'Expenses in category' };
        return row;
      }).sort((a, b) => n(b.total) - n(a.total));

      // Chart: top 6 categories stacked, the rest as "Others".
      const topCats = rows.slice(0, 6).map(r => String(r.category));
      const chartData = months.map(m => {
        const point: Record<string, unknown> = { label: monthLabel(m) };
        let others = monthTotals[m];
        topCats.forEach((cat, i) => { const v = n(pivot.get(cat)?.[m]); point[`c${i}`] = r2(v); others -= v; });
        if (rows.length > topCats.length) point.others = r2(Math.max(0, others));
        return point;
      });
      const chartSeries = topCats.map((cat, i) => ({ key: `c${i}`, label: cat, color: CHART_COLORS[i % CHART_COLORS.length] }));
      if (rows.length > topCats.length) chartSeries.push({ key: 'others', label: 'Others', color: COLOR.neutral });

      const current = monthTotals[months[11]];
      const previous = monthTotals[months[10]];
      const active = months.filter(m => monthTotals[m] > 0).length;
      const peak = months.reduce((best, m) => (monthTotals[m] > monthTotals[best] ? m : best), months[0]);
      return {
        kpis: [
          { key: 'total', label: '12-month total', value: r2(total), format: 'money', inverse: true },
          { key: 'avg', label: 'Monthly average', value: active ? r2(total / active) : 0, format: 'money', hint: `${active} month(s) with expenses`, inverse: true },
          { key: 'current', label: monthLabel(months[11]), value: r2(current), format: 'money', inverse: true },
          { key: 'change', label: 'Change vs last month', value: previous ? r2(((current - previous) / previous) * 100) : 0, format: 'percent', tone: current > previous ? 'bad' : 'good', inverse: true },
        ],
        charts: [{ id: 'trend', title: 'Monthly expenses by category', type: 'stacked', wide: true, xKey: 'label', format: 'money', data: chartData, series: chartSeries }],
        tables: [{
          id: 'pivot', title: 'Category × month', showTotals: true, sort: { key: 'total', dir: 'desc' },
          columns: [
            { key: 'category', label: 'Category' },
            ...months.map((m, i) => ({ key: `m${i}`, label: monthLabel(m), format: 'money' as const, total: true, align: 'right' as const })),
            { key: 'total', label: 'Total', format: 'money', total: true },
            { key: 'avg', label: 'Avg / month', format: 'money', hidden: true },
            { key: 'share', label: 'Share', format: 'percent' },
          ],
          rows,
          emptyText: 'No expenses in the last 12 months.',
        }],
        insights: [
          monthTotals[peak] > 0 ? `Highest month: ${monthLabel(peak)} with Rs ${Math.round(monthTotals[peak]).toLocaleString('en-PK')}` : '',
          rows[0] ? `Biggest category over 12 months: ${rows[0].category}` : '',
        ].filter(Boolean),
        notes: [{ tone: 'info', text: `Covers ${monthLabel(months[0])} to ${monthLabel(months[11])}, ending with the month of the selected end date.` }],
      };
    },
  },
];
