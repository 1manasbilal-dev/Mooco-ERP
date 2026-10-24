import type { ReportDefinition, ReportRow } from '../types';
import {
  autoGroup, COLOR, dayOf, groupSum, inRange, isPurchaseVoid, isSupplierWaiver, lower, n, r2, r3, sum, supplierName,
  timeSeries, topSlices
} from '../helpers';
import { buildSupplierStatement } from '../../supplierStatement';
import { isSpotSupplierPayment, materialCashPaid } from '../../moneyFlow';
import type { Supplier, SupplierTransaction } from '../../../types';

/** Positive = we owe the supplier, negative = advance given. */
const balanceOf = (s: Supplier) => r2(n(s.pending_balance ?? s.balance));
const isPayment = (tx: SupplierTransaction) => ['payment', 'advance'].includes(lower(tx.type));
const txMode = (tx: SupplierTransaction) => String(tx.mode || (tx as any).details?.mode || 'Cash');
const txNote = (tx: SupplierTransaction) => String(tx.note || (tx as any).details?.note || '');
const isWaiver = isSupplierWaiver;
const fmt = (value: number) => Math.round(value).toLocaleString('en-PK');
const statusOf = (balance: number) => (balance > 0.5 ? 'Payable' : balance < -0.5 ? 'Advance' : 'Settled');

export const supplierReports: ReportDefinition[] = [
  {
    id: 'supplier_payables',
    title: 'Supplier Payables',
    subtitle: 'What we owe each supplier today, with recent purchases and payments',
    category: 'suppliers',
    icon: 'Wallet',
    keywords: ['payable', 'dues', 'creditors', 'supplier balance', 'lena dena'],
    snapshot: true,
    build: (data, f) => {
      const lastPurchase = new Map<string, string>();
      const lastPayment = new Map<string, string>();
      const bought = new Map<string, number>();
      const paid = new Map<string, number>();
      const later = (map: Map<string, string>, id: string, day: string) => {
        if (id && day && (!map.has(id) || day > map.get(id)!)) map.set(id, day);
      };
      const add = (map: Map<string, number>, id: string, value: number) => { if (id) map.set(id, (map.get(id) || 0) + value); };
      data.purchases.forEach(p => {
        if (!p || isPurchaseVoid(p.status)) return;
        later(lastPurchase, p.supplier_id, dayOf(p.date));
        if (inRange(p.date, f)) add(bought, p.supplier_id, n(p.total_amount));
      });
      data.materialPurchases.forEach(m => {
        if (!m || isPurchaseVoid(m.status)) return;
        later(lastPurchase, m.supplier_id, dayOf(m.date));
        if (inRange(m.date, f)) add(bought, m.supplier_id, n(m.total_amount));
      });
      // A waiver settles the balance but pays nothing, so it is neither "paid" nor the last payment.
      data.supplierTransactions.forEach(t => {
        if (!t || !isPayment(t) || isWaiver(t)) return;
        later(lastPayment, t.supplier_id, dayOf(t.date));
        if (inRange(t.date, f)) add(paid, t.supplier_id, n(t.amount));
      });
      const rows: ReportRow[] = data.suppliers
        .filter(s => s && (s.isActive !== false || Math.abs(balanceOf(s)) > 0.5))
        .map(s => {
          const balance = balanceOf(s);
          return {
            supplier: s.name, types: (Array.isArray(s.supplier_types) ? s.supplier_types : []).filter(Boolean).join(', ') || '—',
            phone: s.phone || '', balance, status: statusOf(balance),
            lastPurchase: lastPurchase.get(s.id) || s.last_purchase_date || '', lastPayment: lastPayment.get(s.id) || '',
            bought: r2(bought.get(s.id) || 0), paid: r2(paid.get(s.id) || 0),
            _tone: balance < -0.5 ? 'info' : undefined,
            _drill: { report: 'supplier_statement', filters: { supplierId: s.id }, label: 'Supplier statement' },
          };
        });
      const payable = sum(rows.filter(r => n(r.balance) > 0), r => n(r.balance));
      const advances = sum(rows.filter(r => n(r.balance) < 0), r => -n(r.balance));
      const owed = rows.filter(r => r.status === 'Payable').length;
      const top = [...rows].filter(r => n(r.balance) > 0).sort((a, b) => n(b.balance) - n(a.balance)).slice(0, 10);
      return {
        kpis: [
          { key: 'payable', label: 'Total payable', value: payable, format: 'money', tone: payable > 0 ? 'warn' : 'good', inverse: true },
          { key: 'advances', label: 'Advances given', value: advances, format: 'money', tone: 'info' },
          { key: 'net', label: 'Net payable', value: r2(payable - advances), format: 'money', inverse: true },
          { key: 'owed', label: 'Suppliers owed', value: owed, format: 'number' },
          { key: 'bought', label: 'Bought in period', value: sum(rows, r => n(r.bought)), format: 'money' },
          { key: 'paid', label: 'Paid in period', value: sum(rows, r => n(r.paid)), format: 'money' },
        ],
        charts: [{
          id: 'top', title: 'Top 10 payables', type: 'bar', wide: true, xKey: 'name', format: 'money',
          data: top.map(r => ({ name: r.supplier, balance: r.balance })),
          series: [{ key: 'balance', label: 'Payable', color: COLOR.purchase }],
        }],
        tables: [{
          id: 'suppliers', showTotals: true, sort: { key: 'balance', dir: 'desc' },
          emptyText: 'No suppliers yet.',
          columns: [
            { key: 'supplier', label: 'Supplier' },
            { key: 'types', label: 'Type' },
            { key: 'phone', label: 'Phone', hidden: true },
            { key: 'balance', label: 'Balance', format: 'money', total: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Payable: 'warn', Advance: 'info', Settled: 'good' } },
            { key: 'lastPurchase', label: 'Last purchase', format: 'date' },
            { key: 'lastPayment', label: 'Last payment', format: 'date' },
            { key: 'bought', label: 'Bought (period)', format: 'money', total: true },
            { key: 'paid', label: 'Paid (period)', format: 'money', total: true },
          ],
          rows,
        }],
        insights: [
          top[0] ? `Largest payable: ${top[0].supplier} — Rs ${fmt(n(top[0].balance))}` : '',
          advances > 0 ? `Rs ${fmt(advances)} given as advance is still to be adjusted against supply.` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'supplier_statement',
    title: 'Supplier Statement',
    subtitle: 'Opening balance, every purchase and payment, and running balance for one supplier',
    category: 'suppliers',
    icon: 'BookOpen',
    keywords: ['khata', 'ledger', 'statement', 'supplier account'],
    filters: ['supplierId'],
    requires: 'supplierId',
    build: (data, f) => {
      const supplier = data.suppliers.find(s => s.id === f.supplierId);
      if (!supplier) return { notes: [{ tone: 'warn', text: 'Choose a supplier to see the statement.' }] };
      const accountNames = Object.fromEntries(data.accounts.map(a => [a.id, a.name]));
      const st = buildSupplierStatement({
        supplier: {
          id: supplier.id, name: supplier.name, phone: supplier.phone, whatsapp: supplier.whatsapp,
          village: supplier.village, city: supplier.city, address: supplier.address,
          pendingBalance: balanceOf(supplier),
        },
        purchases: data.purchases as any,
        materialPurchases: data.materialPurchases as any,
        transactions: data.supplierTransactions as any,
        from: f.from,
        to: f.to,
        accountNames,
      });
      const rows: ReportRow[] = st.printRows.map(e => ({
        date: e.date, description: e.description, kind: e.kind === 'Payment' && e.subtype === 'Advance' ? 'Advance' : e.kind,
        litres: e.litres ? r3(e.litres) : 0, mode: e.mode || '', account: e.accountName || '', note: e.note || '',
        debit: r2(e.debit), credit: r2(e.credit), balance: r2(e.runningBalance),
      }));
      const ms = st.milkStats;
      const closing = st.closingBalance;
      return {
        kpis: [
          { key: 'opening', label: 'Opening balance', value: st.openingBalance, format: 'money' },
          { key: 'purchases', label: 'Purchases', value: st.totalCredit, format: 'money' },
          { key: 'paid', label: 'Paid (net)', value: st.netPaid, format: 'money', tone: 'good' },
          { key: 'closing', label: closing < 0 ? 'Closing (advance)' : 'Closing payable', value: closing, format: 'money', tone: closing > 0.5 ? 'warn' : 'good' },
          { key: 'litres', label: 'Milk received', value: r3(st.totalMilkLitres), format: 'qty', unit: 'L' },
          { key: 'today', label: 'Balance today', value: balanceOf(supplier), format: 'money', hint: supplier.phone || undefined },
        ],
        statements: ms && ms.totalLitres > 0 ? [{
          id: 'milk', title: 'Milk in this period',
          lines: [
            { label: 'Total litres', value: ms.totalLitres, format: 'qty', strong: true },
            { label: 'Morning', value: ms.morningLitres, format: 'qty', indent: 1 },
            { label: 'Evening', value: ms.eveningLitres, format: 'qty', indent: 1 },
            { label: 'Milk amount', value: ms.totalAmount, format: 'money' },
            { label: 'Average rate / L', value: ms.avgRate, format: 'money' },
            ...(ms.avgFat > 0 ? [{ label: 'Average fat', value: ms.avgFat, format: 'number' as const }] : []),
            ...(ms.avgSnf > 0 ? [{ label: 'Average SNF', value: ms.avgSnf, format: 'number' as const }] : []),
          ],
        }, {
          id: 'cash', title: 'Money paid',
          lines: [
            { label: 'Cash paid', value: st.cashPaid, format: 'money' },
            { label: 'Bank / online paid', value: st.otherPaid, format: 'money' },
            { label: 'Refunds received', value: st.refunds, format: 'money' },
            { label: 'Payments', value: st.paymentCount, format: 'number' },
          ],
        }] : undefined,
        tables: [{
          id: 'ledger', title: supplier.name, subtitle: 'Credit = bought from supplier (we owe more), Debit = paid to supplier',
          sort: { key: 'date', dir: 'asc' }, showTotals: true,
          emptyText: 'No ledger entries in this period.',
          columns: [
            { key: 'date', label: 'Date', format: 'date' },
            { key: 'description', label: 'Details', wrap: true },
            { key: 'kind', label: 'Type', format: 'badge', tones: { Milk: 'info', Material: 'neutral', Payment: 'good', Advance: 'good', Refund: 'warn', Charge: 'bad', Opening: 'neutral' } },
            { key: 'litres', label: 'Litres', format: 'qty', unit: 'L', total: true },
            { key: 'mode', label: 'Mode', hidden: true },
            { key: 'account', label: 'Account', hidden: true },
            { key: 'note', label: 'Note', hidden: true, wrap: true },
            { key: 'debit', label: 'Debit (paid)', format: 'money', total: true },
            { key: 'credit', label: 'Credit (bought)', format: 'money', total: true },
            { key: 'balance', label: 'Balance', format: 'money' },
          ],
          rows,
          footer: [
            { date: '', description: 'Opening balance', balance: st.openingBalance, _strong: true },
            { date: '', description: 'Closing balance', balance: closing, _strong: true },
          ],
        }],
      };
    },
  },
  {
    id: 'material_purchases',
    title: 'Material & Supplies Purchases',
    subtitle: 'Feed, packaging and other material bought, by item and by supplier',
    category: 'suppliers',
    icon: 'ShoppingCart',
    keywords: ['material', 'packaging', 'feed', 'supplies', 'raw material', 'saman'],
    filters: ['supplierId', 'itemId', 'groupBy'],
    comparable: true,
    build: (data, f) => {
      const list = data.materialPurchases.filter(m =>
        m && !isPurchaseVoid(m.status) && inRange(m.date, f) &&
        (!f.supplierId || m.supplier_id === f.supplierId) &&
        (!f.itemId || m.item_id === f.itemId)
      );
      const nameOf = (m: typeof list[number]) => m.supplier_id ? supplierName(data, m.supplier_id) : 'No supplier (cash)';
      const lines: ReportRow[] = list.map(m => {
        const amount = r2(n(m.total_amount));
        const paid = Math.min(amount, materialCashPaid(m));
        return {
          date: m.date, supplier: nameOf(m), item: m.item_name || 'Item', qty: r3(n(m.quantity)), unit: m.unit || '',
          rate: n(m.rate) || (n(m.quantity) ? r2(amount / n(m.quantity)) : 0), amount, paid: r2(paid), due: r2(Math.max(0, amount - paid)),
          type: String(m.purchase_type || 'Raw Material'),
          _drill: m.supplier_id ? { report: 'supplier_statement', filters: { supplierId: m.supplier_id }, label: 'Supplier statement' } : undefined,
        };
      });
      const byItem = new Map<string, any>();
      list.forEach((m, i) => {
        const line = lines[i];
        const key = `${m.item_id || m.item_name}|${m.unit || ''}`;
        const row = byItem.get(key) || { item: line.item, unit: line.unit, itemId: m.item_id, lines: 0, qty: 0, amount: 0, paid: 0 };
        row.lines++; row.qty += n(line.qty); row.amount += n(line.amount); row.paid += n(line.paid);
        byItem.set(key, row);
      });
      const itemRows: ReportRow[] = [...byItem.values()].map(r => ({
        item: r.item, unit: r.unit, lines: r.lines, qty: r3(r.qty), rate: r.qty ? r2(r.amount / r.qty) : 0,
        amount: r2(r.amount), paid: r2(r.paid), due: r2(Math.max(0, r.amount - r.paid)),
      }));
      const bySupplier = new Map<string, any>();
      list.forEach((m, i) => {
        const line = lines[i];
        const key = m.supplier_id || 'none';
        const row = bySupplier.get(key) || { supplier: line.supplier, supplierId: m.supplier_id, lines: 0, items: new Set<string>(), amount: 0, paid: 0 };
        row.lines++; row.items.add(String(line.item)); row.amount += n(line.amount); row.paid += n(line.paid);
        bySupplier.set(key, row);
      });
      const supplierRows: ReportRow[] = [...bySupplier.values()].map(r => ({
        supplier: r.supplier, lines: r.lines, items: r.items.size, amount: r2(r.amount), paid: r2(r.paid), due: r2(Math.max(0, r.amount - r.paid)),
        _drill: r.supplierId ? { report: 'supplier_statement', filters: { supplierId: r.supplierId }, label: 'Supplier statement' } : undefined,
      }));
      const amount = sum(lines, r => n(r.amount));
      const paid = sum(lines, r => n(r.paid));
      const groupBy = autoGroup(f);
      const series = timeSeries(lines, r => String(r.date), f, groupBy, (b, r) => { b.amount += n(r.amount); b.paid += n(r.paid); }, ['amount', 'paid']);
      const topItems = groupSum(lines, r => String(r.item), r => n(r.amount));
      return {
        kpis: [
          { key: 'amount', label: 'Purchased', value: amount, format: 'money', inverse: true },
          { key: 'paid', label: 'Cash paid', value: paid, format: 'money' },
          { key: 'due', label: 'On credit', value: r2(Math.max(0, amount - paid)), format: 'money', inverse: true },
          { key: 'lines', label: 'Purchase lines', value: lines.length, format: 'number' },
          { key: 'items', label: 'Items', value: itemRows.length, format: 'number' },
        ],
        charts: [
          { id: 'items', title: 'Top items by amount', type: 'bar', xKey: 'name', format: 'money', data: topItems.slice(0, 10), series: [{ key: 'value', label: 'Amount', color: COLOR.purchase }] },
          { id: 'trend', title: 'Purchases trend', type: 'bar', xKey: 'label', format: 'money', data: series, series: [{ key: 'amount', label: 'Purchased', color: COLOR.purchase }, { key: 'paid', label: 'Paid', color: COLOR.cash }] },
        ],
        tables: [
          {
            id: 'items', title: 'By item', showTotals: true, sort: { key: 'amount', dir: 'desc' },
            emptyText: 'No material bought in this period.',
            columns: [
              { key: 'item', label: 'Item' }, { key: 'unit', label: 'Unit' },
              { key: 'lines', label: 'Lines', format: 'number', total: true },
              { key: 'qty', label: 'Qty', format: 'qty' },
              { key: 'rate', label: 'Avg rate', format: 'money' },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'paid', label: 'Cash paid', format: 'money', total: true },
              { key: 'due', label: 'On credit', format: 'money', total: true },
            ],
            rows: itemRows,
          },
          {
            id: 'suppliers', title: 'By supplier', showTotals: true, sort: { key: 'amount', dir: 'desc' },
            columns: [
              { key: 'supplier', label: 'Supplier' },
              { key: 'lines', label: 'Lines', format: 'number', total: true },
              { key: 'items', label: 'Items', format: 'number' },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'paid', label: 'Cash paid', format: 'money', total: true },
              { key: 'due', label: 'On credit', format: 'money', total: true },
            ],
            rows: supplierRows,
          },
          {
            id: 'lines', title: 'All purchases', showTotals: true, sort: { key: 'date', dir: 'desc' },
            columns: [
              { key: 'date', label: 'Date', format: 'date' },
              { key: 'supplier', label: 'Supplier' },
              { key: 'item', label: 'Item' },
              { key: 'type', label: 'Type', hidden: true },
              { key: 'qty', label: 'Qty', format: 'qty' },
              { key: 'unit', label: 'Unit' },
              { key: 'rate', label: 'Rate', format: 'money' },
              { key: 'amount', label: 'Amount', format: 'money', total: true },
              { key: 'paid', label: 'Cash paid', format: 'money', total: true },
              { key: 'due', label: 'On credit', format: 'money', total: true },
            ],
            rows: lines,
          },
        ],
      };
    },
  },
  {
    id: 'supplier_payments',
    title: 'Supplier Payments Register',
    subtitle: 'Every payment and advance given to suppliers, at intake or separately',
    category: 'suppliers',
    icon: 'Banknote',
    keywords: ['supplier payment', 'advance', 'paid to supplier', 'adaigi'],
    filters: ['supplierId', 'paymentMode', 'groupBy'],
    comparable: true,
    build: (data, f) => {
      const txs = data.supplierTransactions.filter(t =>
        t && isPayment(t) && inRange(t.date, f) &&
        (!f.supplierId || t.supplier_id === f.supplierId) &&
        (!f.paymentMode || lower(txMode(t)).includes(lower(f.paymentMode)))
      );
      const rows: ReportRow[] = txs.map(t => {
        const source = isWaiver(t) ? 'Waiver' : isSpotSupplierPayment(t) ? 'At intake' : 'Separate';
        return {
          date: t.date, supplier: supplierName(data, t.supplier_id), type: lower(t.type) === 'advance' ? 'Advance' : 'Payment',
          source, mode: txMode(t), amount: r2(n(t.amount)), note: txNote(t),
          _drill: t.supplier_id ? { report: 'supplier_statement', filters: { supplierId: t.supplier_id }, label: 'Supplier statement' } : undefined,
        };
      });
      const money = rows.filter(r => r.source !== 'Waiver');
      const total = sum(money, r => n(r.amount));
      const waived = sum(rows.filter(r => r.source === 'Waiver'), r => n(r.amount));
      const byMode = groupSum(money, r => String(r.mode), r => n(r.amount));
      const bySupplier = groupSum(money, r => String(r.supplier), r => n(r.amount));
      const groupBy = autoGroup(f);
      const series = timeSeries(money, r => String(r.date), f, groupBy, (b, r) => {
        if (r.source === 'At intake') b.intake += n(r.amount); else b.separate += n(r.amount);
      }, ['intake', 'separate']);
      return {
        kpis: [
          { key: 'total', label: 'Total paid', value: total, format: 'money' },
          { key: 'count', label: 'Payments', value: money.length, format: 'number' },
          { key: 'intake', label: 'Paid at intake', value: sum(money.filter(r => r.source === 'At intake'), r => n(r.amount)), format: 'money' },
          { key: 'separate', label: 'Paid separately', value: sum(money.filter(r => r.source === 'Separate'), r => n(r.amount)), format: 'money' },
          { key: 'advance', label: 'Advances', value: sum(money.filter(r => r.type === 'Advance'), r => n(r.amount)), format: 'money', tone: 'info' },
          ...(waived > 0 ? [{ key: 'waived', label: 'Settled by waiver', value: waived, format: 'money' as const, hint: 'No money paid' }] : []),
        ],
        charts: [
          { id: 'trend', title: 'Payments trend', type: 'stacked', wide: true, xKey: 'label', format: 'money', data: series, series: [{ key: 'intake', label: 'At intake', color: COLOR.purchase }, { key: 'separate', label: 'Separate', color: COLOR.cash }] },
          { id: 'modes', title: 'By mode', type: 'pie', xKey: 'name', format: 'money', data: topSlices(byMode), series: [{ key: 'value', label: 'Amount' }] },
          { id: 'suppliers', title: 'Top 10 suppliers paid', type: 'bar', xKey: 'name', format: 'money', data: bySupplier.slice(0, 10), series: [{ key: 'value', label: 'Paid', color: COLOR.online }] },
        ],
        tables: [{
          id: 'payments', showTotals: true, sort: { key: 'date', dir: 'desc' },
          emptyText: 'No supplier payments in this period.',
          columns: [
            { key: 'date', label: 'Date', format: 'date' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'type', label: 'Type', format: 'badge', tones: { Payment: 'good', Advance: 'info' } },
            { key: 'source', label: 'Paid', format: 'badge', tones: { 'At intake': 'neutral', Separate: 'good', Waiver: 'warn' } },
            { key: 'mode', label: 'Mode' },
            { key: 'amount', label: 'Amount', format: 'money', total: true },
            { key: 'note', label: 'Note', wrap: true },
          ],
          rows,
        }],
        notes: waived > 0 ? [{ tone: 'info', text: `Rs ${fmt(waived)} was settled by waiver or discount. It is listed but not counted as money paid.` }] : undefined,
      };
    },
  },
];
