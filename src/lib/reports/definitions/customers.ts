import type { ReportData, ReportDefinition, ReportRow } from '../types';
import {
  autoGroup, chronological, COLOR, customerName, customerTxEffect, dayOf, findCustomer, groupSum, inRange, isCustomerCharge,
  isCustomerReceipt, isNonCashCustomerTx, isOpeningCustomerTx, isVoidStatus, isWriteOffCustomerTx, lower, n, pct, r2, r3,
  saleFigures, saleMode, sum, timeSeries, topSlices
} from '../helpers';
import type { Customer, CustomerTransaction, DailySupplyEntry } from '../../../types';

/** Whole days from `date` to `today` (0 for today or a future date). */
const ageDays = (date: string, today: string) => {
  if (!date || !today) return 0;
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
};

const txMode = (tx: CustomerTransaction) => String(tx.mode || (tx as any).details?.mode || 'Cash');
const txNote = (tx: CustomerTransaction) => String(tx.note || (tx as any).details?.note || '');
const isActiveCustomer = (c: Customer) => c.isActive !== false;
const fmt = (value: number) => Math.round(value).toLocaleString('en-PK');

const AGE_BUCKETS = [
  { key: 'b7', label: '0–7 days', max: 7 },
  { key: 'b15', label: '8–15 days', max: 15 },
  { key: 'b30', label: '16–30 days', max: 30 },
  { key: 'b60', label: '31–60 days', max: 60 },
  { key: 'b60p', label: '60+ days', max: Infinity },
] as const;

const bucketFor = (days: number) => AGE_BUCKETS.find(b => days <= b.max)!.key;

const txByCustomer = (txs: CustomerTransaction[]) => {
  const map = new Map<string, CustomerTransaction[]>();
  txs.forEach(tx => {
    if (!tx?.customer_id) return;
    const list = map.get(tx.customer_id) || [];
    list.push(tx);
    map.set(tx.customer_id, list);
  });
  return map;
};

const supplyStatus = (e: DailySupplyEntry) => lower((e as any).status ?? (e as any).details?.status);
/** Delivery entries that moved the khata: recordDailySupply skips Pending and Cancelled ones. */
const isPostedSupply = (e: DailySupplyEntry) => Boolean(e?.date) && !['pending', 'cancelled'].includes(supplyStatus(e));
const supplyPaid = (e: DailySupplyEntry) => n((e as any).payment_received ?? (e as any).details?.payment_received);
/** Unpaid part of a delivery, exactly what recordDailySupply added to the customer balance. */
const supplyDue = (e: DailySupplyEntry) => {
  const due = (e as any).balance_due ?? (e as any).details?.balance_due;
  return r2(due !== undefined && due !== null && due !== '' ? n(due) : Math.max(0, n(e.total_amount) - supplyPaid(e)));
};

/**
 * Home-delivery dues raise the customer balance directly (no khata row is written for them), so
 * statements and aging read them from the delivery entries as khata charges of their own.
 */
function supplyChargesByCustomer(data: ReportData) {
  const map = new Map<string, CustomerTransaction[]>();
  data.dailySupplyEntries.forEach(e => {
    if (!e?.customer_id || !isPostedSupply(e)) return;
    const due = supplyDue(e);
    if (due <= 0) return;
    const litres = r3(n(e.net_qty) || Math.max(0, n(e.delivered_qty) - n(e.returned_qty)));
    const paid = supplyPaid(e);
    const list = map.get(e.customer_id) || [];
    list.push({
      id: `supply_${e.id}`, customer_id: e.customer_id, date: e.date, type: 'Charge', amount: due, mode: 'Home delivery',
      note: `Home delivery ${litres} L × ${r2(n(e.rate))}${e.route ? ` (${e.route})` : ''}${paid ? ` · Rs ${Math.round(paid).toLocaleString('en-PK')} paid on delivery` : ''}`,
    });
    map.set(e.customer_id, list);
  });
  return map;
}

/** What a khata row is, for the statement badge. */
const txKind = (tx: CustomerTransaction) => {
  if (isOpeningCustomerTx(tx)) return 'Opening';
  if (isWriteOffCustomerTx(tx)) return 'Write-off';
  if (String(tx.id || '').startsWith('supply_')) return 'Delivery';
  const type = lower(tx.type);
  if (type === 'charge') return 'Charge';
  if (type === 'return') return 'Return';
  if (type === 'payment') return isNonCashCustomerTx(tx) ? 'Adjustment' : 'Payment';
  return 'Adjustment';
};

const statusTones = { New: 'info', Active: 'good', 'At risk': 'warn', Lost: 'bad', Never: 'neutral' } as const;

export const customerReports: ReportDefinition[] = [
  {
    id: 'receivables_aging',
    title: 'Receivables Aging (Udhaar)',
    subtitle: 'Who owes how much and for how long, aged by the oldest unpaid charges',
    category: 'customers',
    icon: 'Hourglass',
    keywords: ['udhaar', 'receivable', 'aging', 'outstanding', 'baqaya', 'khata', 'debtors'],
    financial: false,
    snapshot: true,
    // FIFO aging: payments clear the oldest dues first, so what is still owed is the newest charges.
    // The balance is spread over charges from the newest back; whatever is left is older than every
    // recorded charge. Charges include debit adjustments and home-delivery dues (both raise the balance).
    build: (data) => {
      const today = data.today;
      const byCustomer = txByCustomer(data.customerTransactions);
      const deliveries = supplyChargesByCustomer(data);
      let unexplained = 0;
      const rows: ReportRow[] = data.customers.filter(c => n(c.balance) > 0.5).map(c => {
        const balance = r2(n(c.balance));
        const txs = byCustomer.get(c.id) || [];
        const charges = [...txs.filter(t => isCustomerCharge(t.type)), ...(deliveries.get(c.id) || [])].sort(chronological).reverse();
        const buckets: Record<string, number> = { b7: 0, b15: 0, b30: 0, b60: 0, b60p: 0 };
        let left = balance;
        let oldest = '';
        for (const charge of charges) {
          if (left <= 0.005) break;
          const take = Math.min(left, Math.max(0, n(charge.amount)));
          if (take <= 0) continue;
          const day = dayOf(charge.date);
          buckets[bucketFor(ageDays(day, today))] += take;
          oldest = day || oldest;
          left -= take;
        }
        // Balance older than every recorded charge (opening balance): treat as the oldest bucket.
        if (left > 0.5) { buckets.b60p += left; unexplained++; }
        const lastPayment = txs.filter(isCustomerReceipt).map(t => dayOf(t.date)).sort().pop() || '';
        const limit = n(c.credit_limit);
        const over = limit > 0 && balance > limit;
        return {
          customer: c.name, phone: c.phone || '', route: c.route || '', balance,
          b7: r2(buckets.b7), b15: r2(buckets.b15), b30: r2(buckets.b30), b60: r2(buckets.b60), b60p: r2(buckets.b60p),
          oldest, lastPayment, limit, over: over ? 'Over limit' : limit > 0 ? 'Within' : 'No limit',
          _tone: buckets.b60p > 0.5 ? 'bad' : over ? 'warn' : undefined,
          _drill: { report: 'customer_statement', filters: { customerId: c.id }, label: 'Customer statement' },
        };
      });
      const total = sum(rows, r => n(r.balance));
      const over30 = sum(rows, r => n(r.b60) + n(r.b60p));
      const overLimit = rows.filter(r => r.over === 'Over limit').length;
      const bucketChart = AGE_BUCKETS.map(b => ({ name: b.label, value: sum(rows, r => n(r[b.key])) }));
      const top = [...rows].sort((a, b) => n(b.balance) - n(a.balance)).slice(0, 10);
      const oldestBucket = bucketChart[bucketChart.length - 1];
      return {
        kpis: [
          { key: 'total', label: 'Total receivable', value: total, format: 'money', tone: total > 0 ? 'warn' : 'good' },
          { key: 'customers', label: 'Customers owing', value: rows.length, format: 'number' },
          { key: 'over30', label: 'Over 30 days', value: over30, format: 'money', tone: over30 > 0 ? 'bad' : 'good', hint: `${pct(over30, total)}% of total` },
          { key: 'overLimit', label: 'Over credit limit', value: overLimit, format: 'number', tone: overLimit ? 'bad' : 'good' },
        ],
        charts: [
          { id: 'buckets', title: 'Receivable by age', type: 'bar', xKey: 'name', format: 'money', data: bucketChart, series: [{ key: 'value', label: 'Amount', color: COLOR.credit }] },
          { id: 'top', title: 'Top 10 debtors', type: 'bar', xKey: 'name', format: 'money', data: top.map(r => ({ name: r.customer, balance: r.balance })), series: [{ key: 'balance', label: 'Balance', color: COLOR.expense }] },
        ],
        tables: [{
          id: 'aging', showTotals: true, sort: { key: 'balance', dir: 'desc' },
          emptyText: 'No customer owes anything right now.',
          columns: [
            { key: 'customer', label: 'Customer' },
            { key: 'phone', label: 'Phone' },
            { key: 'route', label: 'Route', hidden: true },
            { key: 'balance', label: 'Balance', format: 'money', total: true },
            { key: 'b7', label: '0–7 d', format: 'money', total: true },
            { key: 'b15', label: '8–15 d', format: 'money', total: true },
            { key: 'b30', label: '16–30 d', format: 'money', total: true },
            { key: 'b60', label: '31–60 d', format: 'money', total: true },
            { key: 'b60p', label: '60+ d', format: 'money', total: true },
            { key: 'oldest', label: 'Oldest due', format: 'date' },
            { key: 'lastPayment', label: 'Last payment', format: 'date' },
            { key: 'limit', label: 'Credit limit', format: 'money', hidden: true },
            { key: 'over', label: 'Limit', format: 'badge', tones: { 'Over limit': 'bad', Within: 'good', 'No limit': 'neutral' } },
          ],
          rows,
        }],
        notes: unexplained ? [{ tone: 'info', text: `${unexplained} customer(s) have balance older than their recorded charges (opening balance). It is shown as 60+ days.` }] : undefined,
        insights: [
          oldestBucket.value > 0 ? `Rs ${fmt(oldestBucket.value)} is older than 60 days — follow up first.` : '',
          top[0] ? `Biggest debtor: ${top[0].customer} with Rs ${fmt(n(top[0].balance))}` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'customer_statement',
    title: 'Customer Statement (Khata)',
    subtitle: 'Opening balance, every charge and payment, and running balance for one customer',
    category: 'customers',
    icon: 'BookUser',
    keywords: ['khata', 'ledger', 'statement', 'account'],
    financial: false,
    filters: ['customerId'],
    requires: 'customerId',
    // Opening balance is worked back from today's balance: balance today minus every khata movement
    // on or after the start date. Movements = khata rows (charge / debit adjustment up; payment /
    // return down) plus home-delivery dues, which change the balance without a khata row.
    build: (data, f) => {
      const customer = findCustomer(data, f.customerId);
      if (!customer) return { notes: [{ tone: 'warn', text: 'Choose a customer to see the statement.' }] };
      const txs = [
        ...data.customerTransactions.filter(t => t.customer_id === customer.id),
        ...(supplyChargesByCustomer(data).get(customer.id) || []),
      ];
      const fromDay = f.from || '';
      const afterFrom = txs.filter(t => !fromDay || dayOf(t.date) >= fromDay);
      const opening = r2(n(customer.balance) - afterFrom.reduce((s, t) => s + customerTxEffect(t.type, n(t.amount)), 0));
      const inPeriod = txs.filter(t => inRange(t.date, f)).sort(chronological);
      let running = opening;
      const rows: ReportRow[] = inPeriod.map(t => {
        const effect = customerTxEffect(t.type, n(t.amount));
        running = r2(running + effect);
        const type = txKind(t);
        return {
          date: t.date, type,
          description: txNote(t) || (type === 'Charge' ? 'Charge' : type === 'Return' ? 'Sale return' : type === 'Payment' ? 'Payment received' : type),
          mode: effect > 0 ? '' : txMode(t),
          debit: effect > 0 ? r2(effect) : 0, credit: effect < 0 ? r2(-effect) : 0, balance: running,
        };
      });
      const closing = running;
      const charges = sum(rows, r => n(r.debit));
      const payments = sum(rows.filter(r => r.type === 'Payment'), r => n(r.credit));
      const returns = sum(rows.filter(r => r.type === 'Return'), r => n(r.credit));
      // Opening-advance, write-off and adjustment credits: they lower the khata, but no money came in.
      const otherCredits = r2(sum(rows, r => n(r.credit)) - payments - returns);
      const bills: ReportRow[] = data.sales
        .filter(s => s.customer_id === customer.id && !isVoidStatus(s.status) && inRange(s.date, f))
        .map(s => {
          const fig = saleFigures(s);
          return {
            date: s.date, bill: s.bill_number, mode: saleMode(s), net: fig.net, paid: fig.paid, credit: fig.credit,
            _drill: { report: 'sale_register', filters: { customerId: customer.id, from: dayOf(s.date), to: dayOf(s.date) }, label: 'Open bill' },
          };
        });
      return {
        kpis: [
          { key: 'opening', label: 'Opening balance', value: opening, format: 'money' },
          { key: 'charges', label: 'Charges', value: charges, format: 'money' },
          { key: 'payments', label: 'Payments received', value: payments, format: 'money', tone: 'good' },
          { key: 'returns', label: 'Returns', value: returns, format: 'money' },
          ...(otherCredits > 0.009 ? [{ key: 'adjusted', label: 'Written off / adjusted', value: otherCredits, format: 'money' as const, hint: 'No money received' }] : []),
          { key: 'closing', label: closing < 0 ? 'Closing (advance)' : 'Closing balance', value: closing, format: 'money', tone: closing > 0.5 ? 'warn' : 'good' },
          { key: 'current', label: 'Balance today', value: r2(n(customer.balance)), format: 'money', hint: [customer.phone, customer.route].filter(Boolean).join(' · ') || undefined },
        ],
        tables: [
          {
            id: 'ledger', title: customer.name, subtitle: 'Debit = charged to customer, Credit = received or returned',
            sort: { key: 'date', dir: 'asc' }, showTotals: true,
            emptyText: 'No khata entries in this period.',
            columns: [
              { key: 'date', label: 'Date', format: 'date' },
              { key: 'type', label: 'Type', format: 'badge', tones: { Charge: 'warn', Delivery: 'warn', Payment: 'good', Return: 'info', Opening: 'neutral', 'Write-off': 'bad', Adjustment: 'neutral' } },
              { key: 'description', label: 'Details', wrap: true },
              { key: 'mode', label: 'Mode' },
              { key: 'debit', label: 'Debit', format: 'money', total: true },
              { key: 'credit', label: 'Credit', format: 'money', total: true },
              { key: 'balance', label: 'Balance', format: 'money', signed: true },
            ],
            rows,
            footer: [
              { date: '', type: '', description: 'Opening balance', balance: opening, _strong: true },
              { date: '', type: '', description: 'Closing balance', balance: closing, _strong: true },
            ],
          },
          {
            id: 'bills', title: 'Bills in this period', showTotals: true, sort: { key: 'date', dir: 'desc' },
            emptyText: 'No bills in this period.',
            columns: [
              { key: 'date', label: 'Date / time', format: 'datetime' },
              { key: 'bill', label: 'Bill #' },
              { key: 'mode', label: 'Mode', format: 'badge', tones: { Cash: 'good', Online: 'info', Credit: 'warn', 'Partial credit': 'warn' } },
              { key: 'net', label: 'Net', format: 'money', total: true },
              { key: 'paid', label: 'Paid', format: 'money', total: true },
              { key: 'credit', label: 'On khata', format: 'money', total: true },
            ],
            rows: bills,
          },
        ],
      };
    },
  },
  {
    id: 'customer_activity',
    title: 'Customer Activity & Churn',
    subtitle: 'New, active, at-risk and lost customers by their last purchase',
    category: 'customers',
    icon: 'Activity',
    keywords: ['churn', 'inactive', 'lost customers', 'retention', 'new customers'],
    financial: false,
    build: (data, f) => {
      const today = data.today;
      const first = new Map<string, string>();
      const last = new Map<string, string>();
      const bills = new Map<string, number>();
      const net = new Map<string, number>();
      const charged = new Map<string, number>();
      const seen = (id: string, day: string) => {
        if (!id || !day) return;
        if (!first.has(id) || day < first.get(id)!) first.set(id, day);
        if (!last.has(id) || day > last.get(id)!) last.set(id, day);
      };
      data.sales.forEach(s => {
        if (!s.customer_id || isVoidStatus(s.status)) return;
        const day = dayOf(s.date);
        seen(s.customer_id, day);
        if (inRange(s.date, f)) {
          bills.set(s.customer_id, (bills.get(s.customer_id) || 0) + 1);
          net.set(s.customer_id, (net.get(s.customer_id) || 0) + saleFigures(s).net);
        }
      });
      // Opening balances and adjustments are not purchases: they must not make a customer "new" or "active".
      data.customerTransactions.forEach(t => {
        if (lower(t.type) !== 'charge' || !t.customer_id || isNonCashCustomerTx(t)) return;
        seen(t.customer_id, dayOf(t.date));
        if (inRange(t.date, f)) charged.set(t.customer_id, (charged.get(t.customer_id) || 0) + n(t.amount));
      });
      // Home-delivery customers buy through delivery entries, not POS bills.
      const delivered = new Set<string>();
      data.dailySupplyEntries.forEach(e => {
        if (!e?.customer_id || !isPostedSupply(e) || n(e.total_amount) <= 0) return;
        seen(e.customer_id, dayOf(e.date));
        if (inRange(e.date, f)) delivered.add(e.customer_id);
      });
      const rows: ReportRow[] = data.customers.filter(isActiveCustomer).map(c => {
        const firstDay = first.get(c.id) || '';
        const lastDay = last.get(c.id) || '';
        const billCount = bills.get(c.id) || 0;
        const boughtInRange = billCount > 0 || (charged.get(c.id) || 0) > 0 || delivered.has(c.id);
        const days = lastDay ? ageDays(lastDay, today) : null;
        let status: keyof typeof statusTones;
        if (!firstDay) status = 'Never';
        else if ((!f.from || firstDay >= f.from) && (!f.to || firstDay <= f.to)) status = 'New';
        else if (boughtInRange) status = 'Active';
        else if ((days ?? 0) > 45) status = 'Lost';
        else if ((days ?? 0) >= 15) status = 'At risk';
        else status = 'Active';
        return {
          customer: c.name, phone: c.phone || '', route: c.route || '', first: firstDay, last: lastDay,
          bills: billCount, net: r2(net.get(c.id) || 0), charged: r2(charged.get(c.id) || 0),
          days: days ?? '', balance: r2(n(c.balance)), status,
          _tone: status === 'Lost' ? 'bad' : status === 'At risk' ? 'warn' : undefined,
          _drill: { report: 'customer_statement', filters: { customerId: c.id }, label: 'Customer statement' },
        };
      });
      const count = (s: string) => rows.filter(r => r.status === s).length;
      const pie = (['New', 'Active', 'At risk', 'Lost', 'Never'] as const).map(name => ({ name, value: count(name) })).filter(x => x.value > 0);
      const atRiskBalance = sum(rows.filter(r => r.status === 'At risk' || r.status === 'Lost'), r => Math.max(0, n(r.balance)));
      return {
        kpis: [
          { key: 'new', label: 'New', value: count('New'), format: 'number', tone: 'info' },
          { key: 'active', label: 'Active', value: count('Active'), format: 'number', tone: 'good' },
          { key: 'risk', label: 'At risk (15–45 days)', value: count('At risk'), format: 'number', tone: 'warn', inverse: true },
          { key: 'lost', label: 'Lost (45+ days)', value: count('Lost'), format: 'number', tone: 'bad', inverse: true },
          { key: 'never', label: 'Never bought', value: count('Never'), format: 'number' },
        ],
        charts: [
          { id: 'status', title: 'Customers by status', type: 'pie', xKey: 'name', format: 'number', data: pie, series: [{ key: 'value', label: 'Customers' }] },
          { id: 'top', title: 'Top 10 by net sales in period', type: 'bar', xKey: 'name', format: 'money', data: [...rows].sort((a, b) => n(b.net) - n(a.net)).slice(0, 10).filter(r => n(r.net) > 0).map(r => ({ name: r.customer, net: r.net })), series: [{ key: 'net', label: 'Net sales', color: COLOR.sales }] },
        ],
        tables: [{
          id: 'customers', showTotals: true, sort: { key: 'days', dir: 'desc' },
          columns: [
            { key: 'customer', label: 'Customer' },
            { key: 'phone', label: 'Phone', hidden: true },
            { key: 'route', label: 'Route', hidden: true },
            { key: 'first', label: 'First purchase', format: 'date' },
            { key: 'last', label: 'Last purchase', format: 'date' },
            { key: 'days', label: 'Days since', format: 'number' },
            { key: 'bills', label: 'Bills', format: 'number', total: true },
            { key: 'net', label: 'Net sales', format: 'money', total: true },
            { key: 'charged', label: 'Charged (khata)', format: 'money', total: true, hidden: true },
            { key: 'balance', label: 'Balance', format: 'money', signed: true, hidden: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { ...statusTones } },
          ],
          rows,
        }],
        insights: [
          count('At risk') ? `${count('At risk')} customer(s) have not bought for 15–45 days. Call them before they are lost.` : '',
          atRiskBalance > 0 ? `At-risk and lost customers still owe Rs ${fmt(atRiskBalance)}.` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'daily_supply',
    title: 'Home Delivery (Daily Supply)',
    subtitle: 'Delivered, returned and net milk by route and customer, with payments',
    category: 'customers',
    icon: 'Truck',
    keywords: ['delivery', 'route', 'supply', 'doodh wala', 'gawala'],
    financial: false,
    filters: ['customerId', 'groupBy'],
    build: (data, f) => {
      // Cancelled entries never reached the khata; pending ones are kept and flagged in a note.
      const entries = data.dailySupplyEntries.filter(e => inRange(e.date, f) && supplyStatus(e) !== 'cancelled' && (!f.customerId || e.customer_id === f.customerId));
      const netQty = (e: typeof entries[number]) => n(e.net_qty) || Math.max(0, n(e.delivered_qty) - n(e.returned_qty));
      const byCustomer = new Map<string, any>();
      const byRoute = new Map<string, any>();
      entries.forEach(e => {
        const route = e.route || 'No route';
        const cKey = e.customer_id || e.customer_name || 'unknown';
        const c = byCustomer.get(cKey) || { customerId: e.customer_id, customer: customerName(data, e.customer_id, e.customer_name), route, days: new Set<string>(), delivered: 0, returned: 0, net: 0, amount: 0, received: 0 };
        const r = byRoute.get(route) || { route, customers: new Set<string>(), delivered: 0, returned: 0, net: 0, amount: 0, received: 0 };
        [c, r].forEach(x => {
          x.delivered += n(e.delivered_qty); x.returned += n(e.returned_qty); x.net += netQty(e);
          x.amount += n(e.total_amount); x.received += n(e.payment_received);
        });
        c.days.add(dayOf(e.date));
        r.customers.add(cKey);
        byCustomer.set(cKey, c);
        byRoute.set(route, r);
      });
      const customerRows: ReportRow[] = [...byCustomer.values()].map(c => ({
        customer: c.customer, route: c.route, days: c.days.size, delivered: r3(c.delivered), returned: r3(c.returned), net: r3(c.net),
        amount: r2(c.amount), received: r2(c.received), due: r2(Math.max(0, c.amount - c.received)),
        rate: c.net ? r2(c.amount / c.net) : 0,
        balance: c.customerId ? r2(n(findCustomer(data, c.customerId)?.balance)) : 0,
        _drill: c.customerId ? { report: 'customer_statement', filters: { customerId: c.customerId }, label: 'Customer statement' } : undefined,
      }));
      const routeRows: ReportRow[] = [...byRoute.values()].map(r => ({
        route: r.route, customers: r.customers.size, delivered: r3(r.delivered), returned: r3(r.returned), net: r3(r.net),
        amount: r2(r.amount), received: r2(r.received), due: r2(Math.max(0, r.amount - r.received)),
      }));
      const groupBy = autoGroup(f);
      const series = timeSeries(entries, e => e.date, f, groupBy, (b, e) => {
        b.delivered += n(e.delivered_qty); b.returned += n(e.returned_qty); b.net += netQty(e); b.amount += n(e.total_amount);
      }, ['delivered', 'returned', 'net', 'amount']);
      const delivered = sum(entries, e => n(e.delivered_qty));
      const returned = sum(entries, e => n(e.returned_qty));
      const pending = entries.filter(e => supplyStatus(e) === 'pending').length;
      return {
        kpis: [
          { key: 'delivered', label: 'Delivered', value: r3(delivered), format: 'qty', unit: 'L' },
          { key: 'returned', label: 'Returned', value: r3(returned), format: 'qty', unit: 'L', inverse: true, hint: `${pct(returned, delivered)}% of delivered` },
          { key: 'net', label: 'Net supplied', value: r3(sum(entries, netQty)), format: 'qty', unit: 'L', tone: 'good' },
          { key: 'amount', label: 'Amount', value: sum(entries, e => n(e.total_amount)), format: 'money' },
          { key: 'received', label: 'Payment received', value: sum(entries, e => n(e.payment_received)), format: 'money', tone: 'good' },
          { key: 'customers', label: 'Customers served', value: customerRows.length, format: 'number' },
        ],
        charts: [
          { id: 'trend', title: 'Delivered litres', type: 'stacked', wide: true, xKey: 'label', format: 'qty', data: series, series: [{ key: 'net', label: 'Net', color: COLOR.sales }, { key: 'returned', label: 'Returned', color: COLOR.returns }] },
          { id: 'routes', title: 'Net litres by route', type: 'bar', xKey: 'route', format: 'qty', data: [...routeRows].sort((a, b) => n(b.net) - n(a.net)).slice(0, 12), series: [{ key: 'net', label: 'Net litres', color: COLOR.online }] },
        ],
        tables: [
          {
            id: 'customers', title: 'By customer', showTotals: true, sort: { key: 'route', dir: 'asc' },
            emptyText: 'No deliveries in this period.',
            columns: [
              { key: 'customer', label: 'Customer' },
              { key: 'route', label: 'Route' },
              { key: 'days', label: 'Days', format: 'number' },
              { key: 'delivered', label: 'Delivered', format: 'qty', unit: 'L', total: true },
              { key: 'returned', label: 'Returned', format: 'qty', unit: 'L', total: true },
              { key: 'net', label: 'Net', format: 'qty', unit: 'L', total: true },
              { key: 'rate', label: 'Avg rate', format: 'money', hidden: true },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'received', label: 'Received', format: 'money', total: true },
              { key: 'due', label: 'Unpaid', format: 'money', total: true },
              { key: 'balance', label: 'Khata balance', format: 'money', signed: true, hidden: true },
            ],
            rows: customerRows,
          },
          {
            id: 'routes', title: 'By route', showTotals: true, sort: { key: 'net', dir: 'desc' },
            columns: [
              { key: 'route', label: 'Route' },
              { key: 'customers', label: 'Customers', format: 'number', total: true },
              { key: 'delivered', label: 'Delivered', format: 'qty', unit: 'L', total: true },
              { key: 'returned', label: 'Returned', format: 'qty', unit: 'L', total: true },
              { key: 'net', label: 'Net', format: 'qty', unit: 'L', total: true },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'received', label: 'Received', format: 'money', total: true },
              { key: 'due', label: 'Unpaid', format: 'money', total: true },
            ],
            rows: routeRows,
          },
        ],
        notes: pending ? [{ tone: 'warn', text: `${pending} delivery entr${pending === 1 ? 'y is' : 'ies are'} still pending and may change.` }] : undefined,
      };
    },
  },
  {
    id: 'customer_recoveries',
    title: 'Recoveries (Wasooli)',
    subtitle: 'Payments received from customers against their khata',
    category: 'customers',
    icon: 'HandCoins',
    keywords: ['wasooli', 'recovery', 'collection', 'payment received', 'receipts'],
    financial: false,
    filters: ['customerId', 'paymentMode', 'groupBy'],
    comparable: true,
    build: (data, f) => {
      // Money received only: opening-balance advances and bad-debt write-offs are "Payment" rows too,
      // but nothing was collected, so they are listed in a note instead of counted as wasooli.
      const forCustomer = (t: CustomerTransaction) => inRange(t.date, f) && (!f.customerId || t.customer_id === f.customerId);
      const txs = data.customerTransactions.filter(t =>
        isCustomerReceipt(t) && forCustomer(t) &&
        (!f.paymentMode || lower(txMode(t)).includes(lower(f.paymentMode)))
      );
      const writtenOff = sum(data.customerTransactions.filter(t => lower(t.type) === 'payment' && isWriteOffCustomerTx(t) && forCustomer(t)), t => n(t.amount));
      const rows: ReportRow[] = txs.map(t => ({
        date: t.date, customer: customerName(data, t.customer_id, 'Unknown customer'), mode: txMode(t), amount: r2(n(t.amount)), note: txNote(t),
        _drill: t.customer_id ? { report: 'customer_statement', filters: { customerId: t.customer_id }, label: 'Customer statement' } : undefined,
      }));
      const total = sum(rows, r => n(r.amount));
      const byMode = groupSum(rows, r => String(r.mode), r => n(r.amount));
      const byCustomer = groupSum(rows, r => String(r.customer), r => n(r.amount));
      const top = byCustomer[0];
      const groupBy = autoGroup(f);
      const series = timeSeries(txs, t => t.date, f, groupBy, (b, t) => { b.amount += n(t.amount); b.count += 1; }, ['amount', 'count']);
      return {
        kpis: [
          { key: 'total', label: 'Total recovered', value: total, format: 'money', tone: 'good' },
          { key: 'count', label: 'Payments', value: rows.length, format: 'number' },
          { key: 'avg', label: 'Average payment', value: rows.length ? r2(total / rows.length) : 0, format: 'money' },
          { key: 'top', label: 'Top payer', value: top?.value || 0, format: 'money', hint: top?.name },
          { key: 'customers', label: 'Customers paid', value: byCustomer.length, format: 'number' },
        ],
        charts: [
          { id: 'trend', title: 'Recoveries trend', type: 'bar', wide: true, xKey: 'label', format: 'money', data: series, series: [{ key: 'amount', label: 'Recovered', color: COLOR.cash }] },
          { id: 'modes', title: 'By mode', type: 'pie', xKey: 'name', format: 'money', data: topSlices(byMode), series: [{ key: 'value', label: 'Amount' }] },
          { id: 'customers', title: 'Top 10 payers', type: 'bar', xKey: 'name', format: 'money', data: byCustomer.slice(0, 10), series: [{ key: 'value', label: 'Paid', color: COLOR.online }] },
        ],
        tables: [{
          id: 'payments', showTotals: true, sort: { key: 'date', dir: 'desc' },
          emptyText: 'No payments received in this period.',
          columns: [
            { key: 'date', label: 'Date', format: 'date' },
            { key: 'customer', label: 'Customer' },
            { key: 'mode', label: 'Mode', format: 'badge' },
            { key: 'amount', label: 'Amount', format: 'money', total: true },
            { key: 'note', label: 'Note', wrap: true },
          ],
          rows,
        }],
        notes: writtenOff > 0 ? [{ tone: 'info', text: `Rs ${fmt(writtenOff)} of khata was written off as bad debt in this period. It is not counted as recovered.` }] : undefined,
      };
    },
  },
];
