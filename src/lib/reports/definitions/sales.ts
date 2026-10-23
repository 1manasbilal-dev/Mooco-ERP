import type { ReportDefinition, ReportRow } from '../types';
import {
  autoGroup, cashierOf, COLOR, customerName, dayOf, findCustomer, groupSum, inRange, isFullyReturned, isVoidStatus, n, pct, r2, r3,
  reportSales, saleFigures, saleLines, saleMode, saleReturnEvents, sum, timeSeries, topSlices, weekdayOf
} from '../helpers';
import { reportingHour } from '../../dashboardAnalytics';
import type { POSBill } from '../../../types';

const matchesFilters = (sale: POSBill, f: { customerId?: string; paymentMode?: string; cashierId?: string }) =>
  (!f.customerId || sale.customer_id === f.customerId) &&
  (!f.paymentMode || saleMode(sale).toLowerCase().includes(f.paymentMode.toLowerCase())) &&
  (!f.cashierId || sale.cashier_id === f.cashierId);

export const salesReports: ReportDefinition[] = [
  {
    id: 'sales_summary',
    title: 'Sales Summary',
    subtitle: 'Daily, weekly or monthly sales with cash, online and credit split',
    category: 'sales',
    icon: 'TrendingUp',
    keywords: ['daily sales', 'monthly sales', 'revenue', 'bikri'],
    filters: ['groupBy', 'paymentMode', 'cashierId'],
    comparable: true,
    build: (data, f) => {
      const sales = reportSales(data, f).filter(s => matchesFilters(s, f));
      const figs = sales.map(s => ({ sale: s, ...saleFigures(s) }));
      const groupBy = autoGroup(f);
      const series = timeSeries(figs, row => row.sale.date, f, groupBy, (b, row) => {
        b.bills += 1; b.gross += row.gross; b.discount += row.discount; b.refund += row.refund;
        b.net += row.net; b.cash += row.cash; b.online += row.online; b.credit += row.credit;
      }, ['bills', 'gross', 'discount', 'refund', 'net', 'cash', 'online', 'credit']);
      const net = sum(figs, r => r.net);
      const bills = figs.length;
      // A fully returned bill keeps nothing, so it would only drag the average bill down.
      const returnedBills = figs.filter(isFullyReturned).length;
      const keptBills = bills - returnedBills;
      const best = [...series].sort((a: any, b: any) => b.net - a.net)[0] as any;
      const activeBuckets = series.filter((s: any) => s.bills > 0).length;
      return {
        kpis: [
          { key: 'net', label: 'Net sales', value: net, format: 'money', tone: 'good' },
          { key: 'bills', label: 'Bills', value: bills, format: 'number', hint: returnedBills ? `${returnedBills} fully returned` : undefined },
          { key: 'avg', label: 'Average bill', value: keptBills ? r2(net / keptBills) : 0, format: 'money' },
          { key: 'cash', label: 'Cash', value: sum(figs, r => r.cash), format: 'money' },
          { key: 'online', label: 'Online', value: sum(figs, r => r.online), format: 'money' },
          { key: 'credit', label: 'Credit (khata)', value: sum(figs, r => r.credit), format: 'money', inverse: true },
          { key: 'discount', label: 'Discounts', value: sum(figs, r => r.discount), format: 'money', inverse: true },
          { key: 'refund', label: 'Returns', value: sum(figs, r => r.refund), format: 'money', inverse: true },
        ],
        charts: [
          { id: 'trend', title: 'Net sales trend', type: 'area', data: series, xKey: 'label', series: [{ key: 'net', label: 'Net sales', color: COLOR.sales }], format: 'money', wide: true },
          { id: 'modes', title: 'Collection by mode', type: 'stacked', data: series, xKey: 'label', series: [
            { key: 'cash', label: 'Cash', color: COLOR.cash }, { key: 'online', label: 'Online', color: COLOR.online }, { key: 'credit', label: 'Credit', color: COLOR.credit },
          ], format: 'money', wide: true },
        ],
        tables: [{
          id: 'periods', title: `Sales by ${groupBy}`, showTotals: true,
          sort: { key: 'key', dir: 'desc' },
          columns: [
            { key: 'label', label: groupBy === 'day' ? 'Date' : groupBy === 'week' ? 'Week' : 'Month' },
            { key: 'bills', label: 'Bills', format: 'number', total: true },
            { key: 'gross', label: 'Gross', format: 'money', total: true },
            { key: 'discount', label: 'Discount', format: 'money', total: true },
            { key: 'refund', label: 'Returns', format: 'money', total: true },
            { key: 'net', label: 'Net sales', format: 'money', total: true },
            { key: 'cash', label: 'Cash', format: 'money', total: true },
            { key: 'online', label: 'Online', format: 'money', total: true },
            { key: 'credit', label: 'Credit', format: 'money', total: true },
          ],
          rows: series.map((row: any) => ({ ...row, _drill: groupBy === 'day' && row.bills ? { report: 'sale_register', filters: { from: row.key, to: row.key }, label: 'Open bills' } : undefined })),
        }],
        insights: [
          best && best.net > 0 ? `Best ${groupBy}: ${best.label} with Rs ${Math.round(best.net).toLocaleString('en-PK')}` : '',
          activeBuckets ? `Average per active ${groupBy}: Rs ${Math.round(net / activeBuckets).toLocaleString('en-PK')}` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'sale_register',
    title: 'Sale Register (All Bills)',
    subtitle: 'Every bill with customer, cashier, mode, discount and returns',
    category: 'sales',
    icon: 'ReceiptText',
    keywords: ['invoice', 'bill list', 'bills'],
    filters: ['customerId', 'paymentMode', 'cashierId'],
    defaultPreset: 'today',
    build: (data, f) => {
      const sales = reportSales(data, f).filter(s => matchesFilters(s, f));
      const rows: ReportRow[] = sales.map(s => {
        const fig = saleFigures(s);
        return {
          date: s.date, bill: s.bill_number, customer: customerName(data, s.customer_id, s.customer_name),
          cashier: cashierOf(s, data), mode: saleMode(s), items: (s.items || []).length,
          gross: fig.gross, discount: fig.discount, refund: fig.refund, net: fig.net, paid: fig.paid, credit: fig.credit,
          status: isFullyReturned(fig) ? 'Returned' : fig.refund > 0 ? 'Partly returned' : 'Completed',
          _tone: fig.refund > 0 ? 'warn' : undefined,
        };
      });
      const net = sum(rows, r => n(r.net));
      return {
        kpis: [
          { key: 'bills', label: 'Bills', value: rows.length, format: 'number' },
          { key: 'net', label: 'Net sales', value: net, format: 'money', tone: 'good' },
          { key: 'paid', label: 'Collected', value: sum(rows, r => n(r.paid)), format: 'money' },
          { key: 'credit', label: 'On khata', value: sum(rows, r => n(r.credit)), format: 'money' },
        ],
        tables: [{
          id: 'bills', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Date / time', format: 'datetime' },
            { key: 'bill', label: 'Bill #' },
            { key: 'customer', label: 'Customer' },
            { key: 'cashier', label: 'Cashier' },
            { key: 'mode', label: 'Mode', format: 'badge', tones: { Cash: 'good', Online: 'info', Credit: 'warn', 'Partial credit': 'warn' } },
            { key: 'items', label: 'Lines', format: 'number', hidden: true },
            { key: 'gross', label: 'Gross', format: 'money', total: true, hidden: true },
            { key: 'discount', label: 'Discount', format: 'money', total: true },
            { key: 'refund', label: 'Returned', format: 'money', total: true },
            { key: 'net', label: 'Net', format: 'money', total: true },
            { key: 'paid', label: 'Paid', format: 'money', total: true },
            { key: 'credit', label: 'Credit', format: 'money', total: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Completed: 'good', 'Partly returned': 'warn', Returned: 'bad' } },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'sales_by_item',
    title: 'Item-wise Sales & Profit',
    subtitle: 'Quantity, revenue, cost, gross profit and margin for every product',
    category: 'sales',
    icon: 'Package',
    keywords: ['product sales', 'item performance', 'margin', 'best seller'],
    filters: ['category', 'itemId', 'customerId'],
    comparable: true,
    build: (data, f) => {
      const sales = reportSales(data, f).filter(s => !f.customerId || s.customer_id === f.customerId);
      const map = new Map<string, any>();
      let costMissing = 0;
      sales.forEach(sale => saleLines(sale, data.items).forEach(line => {
        if (f.category && line.category !== f.category) return;
        if (f.itemId && line.itemId !== f.itemId) return;
        const row = map.get(line.itemId) || { item: line.name, itemId: line.itemId, category: line.category, unit: line.unit, qty: 0, returned: 0, bills: new Set(), revenue: 0, cost: 0, profit: 0 };
        // Both in base units: a returned pack of 12 is 12 base units, like the sold quantity next to it.
        row.qty += line.baseQty; row.returned += line.returnedBaseQty; row.bills.add(sale.id);
        row.revenue += line.revenue; row.cost += line.cost; row.profit += line.profit;
        if (!line.costKnown && line.qty > 0) costMissing++;
        map.set(line.itemId, row);
      }));
      const totalRevenue = [...map.values()].reduce((s, r) => s + r.revenue, 0);
      const rows: ReportRow[] = [...map.values()].map(r => ({
        item: r.item, category: r.category, qty: r3(r.qty), unit: r.unit, returned: r3(r.returned), bills: r.bills.size,
        revenue: r2(r.revenue), avgRate: r.qty ? r2(r.revenue / r.qty) : 0, cost: r2(r.cost), profit: r2(r.profit),
        margin: pct(r.profit, r.revenue), share: pct(r.revenue, totalRevenue),
        _tone: r.profit < 0 ? 'bad' : undefined,
        _drill: { report: 'item_sales_detail', filters: { itemId: r.itemId }, label: 'Bills for this item' },
      }));
      const profit = sum(rows, r => n(r.profit));
      const pie = topSlices(rows.map(r => ({ name: String(r.item), value: n(r.revenue) })));
      const byProfit = [...rows].sort((a, b) => n(b.profit) - n(a.profit)).slice(0, 10);
      return {
        kpis: [
          { key: 'revenue', label: 'Revenue', value: r2(totalRevenue), format: 'money', tone: 'good' },
          { key: 'cost', label: 'Cost of goods', value: sum(rows, r => n(r.cost)), format: 'money', inverse: true },
          { key: 'profit', label: 'Gross profit', value: profit, format: 'money', tone: profit >= 0 ? 'good' : 'bad' },
          { key: 'margin', label: 'Gross margin', value: pct(profit, totalRevenue), format: 'percent' },
          { key: 'items', label: 'Products sold', value: rows.length, format: 'number' },
        ],
        charts: [
          { id: 'share', title: 'Revenue share', type: 'pie', data: pie, xKey: 'name', series: [{ key: 'value', label: 'Revenue' }], format: 'money' },
          { id: 'profit', title: 'Top 10 by gross profit', type: 'bar', data: byProfit.map(r => ({ name: r.item, profit: r.profit, revenue: r.revenue })), xKey: 'name', series: [{ key: 'revenue', label: 'Revenue', color: COLOR.sales }, { key: 'profit', label: 'Profit', color: COLOR.profit }], format: 'money' },
        ],
        tables: [{
          id: 'items', showTotals: true, sort: { key: 'revenue', dir: 'desc' },
          columns: [
            { key: 'item', label: 'Product' },
            { key: 'category', label: 'Category' },
            { key: 'qty', label: 'Qty sold', format: 'qty', total: true },
            { key: 'unit', label: 'Unit' },
            { key: 'returned', label: 'Returned', format: 'qty', hidden: true },
            { key: 'bills', label: 'Bills', format: 'number', total: true, hidden: true },
            { key: 'avgRate', label: 'Avg rate', format: 'money' },
            { key: 'revenue', label: 'Revenue', format: 'money', total: true },
            { key: 'cost', label: 'Cost', format: 'money', total: true },
            { key: 'profit', label: 'Gross profit', format: 'money', total: true, signed: true },
            { key: 'margin', label: 'Margin', format: 'percent' },
            { key: 'share', label: 'Share', format: 'percent' },
          ],
          rows,
        }],
        notes: costMissing ? [{ tone: 'warn', text: `${costMissing} bill line(s) have no cost price, so their profit shows as full revenue. Set cost prices in Product Catalog.` }] : undefined,
      };
    },
  },
  {
    id: 'item_sales_detail',
    title: 'Item Sales Detail',
    subtitle: 'Every bill line of one product, with rate and customer',
    category: 'sales',
    icon: 'ScanSearch',
    keywords: ['product ledger', 'item bills'],
    filters: ['itemId', 'customerId'],
    requires: 'itemId',
    build: (data, f) => {
      const rows: ReportRow[] = [];
      reportSales(data, f).filter(s => !f.customerId || s.customer_id === f.customerId).forEach(sale => {
        saleLines(sale, data.items).forEach(line => {
          if (line.itemId !== f.itemId) return;
          rows.push({
            date: sale.date, bill: sale.bill_number, customer: customerName(data, sale.customer_id, sale.customer_name),
            variant: line.variant || 'Loose', qty: line.qty, baseQty: line.baseQty, returned: line.returnedQty,
            rate: line.qty ? r2(line.revenue / line.qty) : 0, revenue: line.revenue, profit: line.profit, mode: saleMode(sale),
          });
        });
      });
      const revenue = sum(rows, r => n(r.revenue));
      const qty = sum(rows, r => n(r.baseQty));
      return {
        kpis: [
          { key: 'qty', label: 'Quantity (base)', value: r3(qty), format: 'qty' },
          { key: 'revenue', label: 'Revenue', value: revenue, format: 'money', tone: 'good' },
          { key: 'avg', label: 'Avg rate / base unit', value: qty ? r2(revenue / qty) : 0, format: 'money' },
          { key: 'profit', label: 'Gross profit', value: sum(rows, r => n(r.profit)), format: 'money' },
        ],
        charts: [{
          id: 'trend', title: 'Daily quantity', type: 'bar', wide: true, xKey: 'label', format: 'qty',
          data: timeSeries(rows, r => String(r.date), f, autoGroup(f), (b, r) => { b.qty += n(r.baseQty); }, ['qty']),
          series: [{ key: 'qty', label: 'Quantity', color: COLOR.sales }],
        }],
        tables: [{
          id: 'lines', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Date / time', format: 'datetime' }, { key: 'bill', label: 'Bill #' },
            { key: 'customer', label: 'Customer' }, { key: 'variant', label: 'Unit / pack' },
            { key: 'qty', label: 'Qty', format: 'qty', total: true }, { key: 'baseQty', label: 'Base qty', format: 'qty', total: true },
            { key: 'returned', label: 'Returned', format: 'qty', total: true, hidden: true },
            { key: 'rate', label: 'Rate', format: 'money' }, { key: 'revenue', label: 'Amount', format: 'money', total: true },
            { key: 'profit', label: 'Profit', format: 'money', total: true, signed: true },
            { key: 'mode', label: 'Mode', format: 'badge' },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'sales_by_category',
    title: 'Category-wise Sales',
    subtitle: 'Milk, yogurt, sweets and other categories compared',
    category: 'sales',
    icon: 'LayoutGrid',
    keywords: ['category', 'department'],
    comparable: true,
    build: (data, f) => {
      const map = new Map<string, { revenue: number; cost: number; qty: number; items: Set<string> }>();
      reportSales(data, f).forEach(sale => saleLines(sale, data.items).forEach(line => {
        const row = map.get(line.category) || { revenue: 0, cost: 0, qty: 0, items: new Set<string>() };
        row.revenue += line.revenue; row.cost += line.cost; row.qty += line.baseQty; row.items.add(line.itemId);
        map.set(line.category, row);
      }));
      const total = [...map.values()].reduce((s, r) => s + r.revenue, 0);
      const rows: ReportRow[] = [...map.entries()].map(([category, r]) => ({
        category, items: r.items.size, revenue: r2(r.revenue), cost: r2(r.cost), profit: r2(r.revenue - r.cost),
        margin: pct(r.revenue - r.cost, r.revenue), share: pct(r.revenue, total),
        _drill: { report: 'sales_by_item', filters: { category }, label: 'Products in category' },
      }));
      return {
        kpis: [
          { key: 'revenue', label: 'Revenue', value: r2(total), format: 'money', tone: 'good' },
          { key: 'profit', label: 'Gross profit', value: sum(rows, r => n(r.profit)), format: 'money' },
          { key: 'categories', label: 'Categories', value: rows.length, format: 'number' },
        ],
        charts: [
          { id: 'pie', title: 'Revenue share', type: 'pie', data: topSlices(rows.map(r => ({ name: String(r.category), value: n(r.revenue) }))), xKey: 'name', series: [{ key: 'value', label: 'Revenue' }], format: 'money' },
          { id: 'bar', title: 'Revenue vs profit', type: 'bar', data: rows.map(r => ({ name: r.category, revenue: r.revenue, profit: r.profit })), xKey: 'name', series: [{ key: 'revenue', label: 'Revenue', color: COLOR.sales }, { key: 'profit', label: 'Profit', color: COLOR.profit }], format: 'money' },
        ],
        tables: [{
          id: 'cats', showTotals: true, sort: { key: 'revenue', dir: 'desc' },
          columns: [
            { key: 'category', label: 'Category' }, { key: 'items', label: 'Products', format: 'number' },
            { key: 'revenue', label: 'Revenue', format: 'money', total: true }, { key: 'cost', label: 'Cost', format: 'money', total: true },
            { key: 'profit', label: 'Gross profit', format: 'money', total: true, signed: true },
            { key: 'margin', label: 'Margin', format: 'percent' }, { key: 'share', label: 'Share', format: 'percent' },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'sales_by_customer',
    title: 'Customer-wise Sales',
    subtitle: 'Who buys the most: bills, value, average bill and credit',
    category: 'sales',
    icon: 'Users',
    keywords: ['top customers', 'customer sales'],
    comparable: true,
    build: (data, f) => {
      const map = new Map<string, any>();
      reportSales(data, f).forEach(sale => {
        const key = sale.customer_id || 'walkin';
        const fig = saleFigures(sale);
        const row = map.get(key) || { customerId: sale.customer_id, customer: sale.customer_id ? customerName(data, sale.customer_id, sale.customer_name) : 'Walk-in customers', bills: 0, net: 0, discount: 0, credit: 0, refund: 0, last: '' };
        row.bills++; row.net += fig.net; row.discount += fig.discount; row.credit += fig.credit; row.refund += fig.refund;
        if (dayOf(sale.date) > row.last) row.last = dayOf(sale.date);
        map.set(key, row);
      });
      const total = [...map.values()].reduce((s, r) => s + r.net, 0);
      const rows: ReportRow[] = [...map.values()].map(r => ({
        customer: r.customer, bills: r.bills, net: r2(r.net), avg: r.bills ? r2(r.net / r.bills) : 0,
        discount: r2(r.discount), refund: r2(r.refund), credit: r2(r.credit), share: pct(r.net, total), last: r.last,
        balance: r.customerId ? n(findCustomer(data, r.customerId)?.balance) : 0,
        _drill: r.customerId ? { report: 'customer_statement', filters: { customerId: r.customerId }, label: 'Customer statement' } : undefined,
      }));
      const named = rows.filter(r => r.customer !== 'Walk-in customers');
      return {
        kpis: [
          { key: 'customers', label: 'Buying customers', value: named.length, format: 'number' },
          { key: 'net', label: 'Net sales', value: r2(total), format: 'money', tone: 'good' },
          { key: 'walkin', label: 'Walk-in sales', value: n(rows.find(r => r.customer === 'Walk-in customers')?.net), format: 'money' },
          { key: 'credit', label: 'Sold on credit', value: sum(rows, r => n(r.credit)), format: 'money' },
        ],
        charts: [{
          id: 'top', title: 'Top 10 customers', type: 'bar', wide: true, xKey: 'name', format: 'money',
          data: [...named].sort((a, b) => n(b.net) - n(a.net)).slice(0, 10).map(r => ({ name: r.customer, net: r.net })),
          series: [{ key: 'net', label: 'Net sales', color: COLOR.sales }],
        }],
        tables: [{
          id: 'customers', showTotals: true, sort: { key: 'net', dir: 'desc' },
          columns: [
            { key: 'customer', label: 'Customer' }, { key: 'bills', label: 'Bills', format: 'number', total: true },
            { key: 'net', label: 'Net sales', format: 'money', total: true }, { key: 'avg', label: 'Avg bill', format: 'money' },
            { key: 'discount', label: 'Discount', format: 'money', total: true, hidden: true },
            { key: 'refund', label: 'Returns', format: 'money', total: true, hidden: true },
            { key: 'credit', label: 'Credit', format: 'money', total: true },
            { key: 'balance', label: 'Khata balance', format: 'money', signed: true },
            { key: 'share', label: 'Share', format: 'percent' }, { key: 'last', label: 'Last bill', format: 'date' },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'sales_by_cashier',
    title: 'Cashier Performance',
    subtitle: 'Sales, bills, discounts and returns per cashier',
    category: 'sales',
    icon: 'UserCheck',
    keywords: ['staff', 'operator', 'salesman'],
    comparable: true,
    build: (data, f) => {
      const map = new Map<string, any>();
      reportSales(data, f).forEach(sale => {
        const name = cashierOf(sale, data);
        const fig = saleFigures(sale);
        const row = map.get(name) || { cashier: name, cashierId: sale.cashier_id, bills: 0, net: 0, gross: 0, cash: 0, online: 0, credit: 0, discount: 0, refund: 0, days: new Set<string>() };
        row.bills++; row.net += fig.net; row.gross += fig.gross; row.cash += fig.cash; row.online += fig.online; row.credit += fig.credit;
        row.discount += fig.discount; row.refund += fig.refund; row.days.add(dayOf(sale.date));
        map.set(name, row);
      });
      // Discount % is of gross (before discount), as in the Discount Report; net after returns would inflate it.
      const rows: ReportRow[] = [...map.values()].map(r => ({
        cashier: r.cashier, days: r.days.size, bills: r.bills, net: r2(r.net), avg: r.bills ? r2(r.net / r.bills) : 0,
        cash: r2(r.cash), online: r2(r.online), credit: r2(r.credit), discount: r2(r.discount), refund: r2(r.refund),
        discountPct: pct(r.discount, r.gross),
        _tone: pct(r.discount, r.gross) > 5 ? 'warn' : undefined,
        _drill: r.cashierId ? { report: 'sale_register', filters: { cashierId: r.cashierId }, label: 'Bills by cashier' } : undefined,
      }));
      return {
        kpis: [
          { key: 'cashiers', label: 'Cashiers', value: rows.length, format: 'number' },
          { key: 'net', label: 'Net sales', value: sum(rows, r => n(r.net)), format: 'money', tone: 'good' },
          { key: 'discount', label: 'Discounts given', value: sum(rows, r => n(r.discount)), format: 'money', inverse: true },
          { key: 'refund', label: 'Returns', value: sum(rows, r => n(r.refund)), format: 'money', inverse: true },
        ],
        charts: [{
          id: 'cashiers', title: 'Sales by cashier', type: 'stacked', wide: true, xKey: 'cashier', format: 'money', data: rows,
          series: [{ key: 'cash', label: 'Cash', color: COLOR.cash }, { key: 'online', label: 'Online', color: COLOR.online }, { key: 'credit', label: 'Credit', color: COLOR.credit }],
        }],
        tables: [{
          id: 'cashiers', showTotals: true, sort: { key: 'net', dir: 'desc' },
          columns: [
            { key: 'cashier', label: 'Cashier' }, { key: 'days', label: 'Days', format: 'number' },
            { key: 'bills', label: 'Bills', format: 'number', total: true }, { key: 'net', label: 'Net sales', format: 'money', total: true },
            { key: 'avg', label: 'Avg bill', format: 'money' }, { key: 'cash', label: 'Cash', format: 'money', total: true },
            { key: 'online', label: 'Online', format: 'money', total: true }, { key: 'credit', label: 'Credit', format: 'money', total: true },
            { key: 'discount', label: 'Discount', format: 'money', total: true }, { key: 'discountPct', label: 'Disc %', format: 'percent' },
            { key: 'refund', label: 'Returns', format: 'money', total: true },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'sales_by_hour',
    title: 'Peak Hours & Weekdays',
    subtitle: 'When customers come: hourly and weekday sales heat',
    category: 'sales',
    icon: 'Clock',
    keywords: ['rush hour', 'busy time', 'heatmap', 'weekday'],
    defaultPreset: 'last_30',
    build: (data, f) => {
      const sales = reportSales(data, f).filter(s => String(s.date || '').includes('T'));
      const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${String(h).padStart(2, '0')}:00`, bills: 0, net: 0 }));
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({ day: d, bills: 0, net: 0, dates: new Set<string>() }));
      const heat: Record<string, Record<number, number>> = {};
      sales.forEach(sale => {
        const fig = saleFigures(sale);
        const h = reportingHour(sale.date);
        hours[h].bills++; hours[h].net += fig.net;
        const d = dayOf(sale.date);
        const wd = weekdayOf(d);
        const row = days.find(x => x.day === wd)!;
        row.bills++; row.net += fig.net; row.dates.add(d);
        heat[wd] = heat[wd] || {};
        heat[wd][h] = (heat[wd][h] || 0) + fig.net;
      });
      const open = hours.filter(h => h.bills > 0);
      const peak = [...hours].sort((a, b) => b.net - a.net)[0];
      const bestDay = [...days].sort((a, b) => b.net - a.net)[0];
      const span = open.length ? { from: open[0].hour, to: open[open.length - 1].hour } : { from: 6, to: 22 };
      const heatRows: ReportRow[] = days.map(d => {
        const row: ReportRow = { day: d.day };
        for (let h = span.from; h <= span.to; h++) row[`h${h}`] = r2(heat[d.day]?.[h] || 0);
        row.total = r2(d.net);
        return row;
      });
      return {
        kpis: [
          { key: 'peak', label: 'Peak hour', value: peak?.hour ?? 0, format: 'number', hint: peak?.net ? `${peak.label} · Rs ${Math.round(peak.net).toLocaleString('en-PK')}` : 'No timed bills' },
          { key: 'bestDay', label: 'Best weekday sales', value: r2(bestDay?.net || 0), format: 'money', hint: bestDay?.day },
          { key: 'bills', label: 'Timed bills', value: sales.length, format: 'number' },
        ],
        charts: [
          { id: 'hours', title: 'Sales by hour', type: 'bar', wide: true, xKey: 'label', format: 'money', data: hours.filter(h => h.hour >= span.from && h.hour <= span.to).map(h => ({ label: h.label, net: r2(h.net), bills: h.bills })), series: [{ key: 'net', label: 'Net sales', color: COLOR.sales }] },
          { id: 'days', title: 'Average sales per weekday', type: 'bar', xKey: 'day', format: 'money', data: days.map(d => ({ day: d.day, avg: d.dates.size ? r2(d.net / d.dates.size) : 0 })), series: [{ key: 'avg', label: 'Avg per day', color: COLOR.online }] },
        ],
        tables: [{
          id: 'heat', title: 'Weekday × hour heat map (net sales)', subtitle: 'Darker = busier', heat: true,
          columns: [{ key: 'day', label: 'Day' }, ...Array.from({ length: span.to - span.from + 1 }, (_, i) => ({ key: `h${span.from + i}`, label: `${span.from + i}`, format: 'money' as const, align: 'right' as const })), { key: 'total', label: 'Total', format: 'money' as const }],
          rows: heatRows,
        }],
        insights: [
          peak?.net ? `Busiest hour is ${peak.label} — keep stock and staff ready then.` : '',
          bestDay?.net ? `${bestDay.day} is the strongest weekday.` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'sales_returns',
    title: 'Sales Returns',
    subtitle: 'Returned bills, refunds, reasons and returned products',
    category: 'sales',
    icon: 'Undo2',
    keywords: ['refund', 'wapsi', 'return'],
    comparable: true,
    // One row per return event (bill + return day), dated when the goods came back, not when the bill
    // was made. A bill returned in parts on two days shows on both days with its own refund, so the
    // totals match the P&L "sales returns" line for the same dates.
    build: (data, f) => {
      const rows: ReportRow[] = [];
      const products = new Map<string, { qty: number; value: number }>();
      const reasons = new Map<string, number>();
      data.sales.forEach(sale => {
        if (isVoidStatus(sale.status)) return;
        const events = saleReturnEvents(sale);
        if (!events.length) return;
        const fig = saleFigures(sale);
        events.forEach(event => {
          if (!inRange(event.date, f)) return;
          const reason = event.reason || 'Not given';
          reasons.set(reason, (reasons.get(reason) || 0) + event.amount);
          event.lines.forEach(line => {
            const key = line.name;
            const p = products.get(key) || { qty: 0, value: 0 };
            p.qty += line.qty; p.value += line.amount;
            products.set(key, p);
          });
          rows.push({
            date: event.date, bill: sale.bill_number, billDate: sale.date, customer: customerName(data, sale.customer_id, sale.customer_name),
            total: fig.total, refund: event.amount, type: 'Refund',
            stock: event.restocked && event.scrapped ? 'Part scrapped' : event.scrapped ? 'Scrapped' : 'Restocked', reason,
          });
        });
      });
      const refund = sum(rows, r => n(r.refund));
      const salesNet = sum(reportSales(data, f).map(saleFigures), x => x.total);
      return {
        kpis: [
          { key: 'returns', label: 'Returns', value: rows.length, format: 'number', inverse: true },
          { key: 'refund', label: 'Returned value', value: refund, format: 'money', inverse: true, tone: 'bad' },
          { key: 'rate', label: 'Return rate', value: pct(refund, salesNet), format: 'percent', inverse: true },
        ],
        charts: [
          { id: 'reasons', title: 'By reason', type: 'pie', xKey: 'name', format: 'money', data: topSlices([...reasons.entries()].map(([name, value]) => ({ name, value: r2(value) }))), series: [{ key: 'value', label: 'Value' }] },
          { id: 'products', title: 'Most returned products', type: 'bar', xKey: 'name', format: 'money', data: [...products.entries()].map(([name, p]) => ({ name, value: r2(p.value) })).sort((a, b) => b.value - a.value).slice(0, 8), series: [{ key: 'value', label: 'Value', color: COLOR.returns }] },
        ],
        tables: [{
          id: 'returns', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Returned on', format: 'datetime' }, { key: 'bill', label: 'Bill #' },
            { key: 'billDate', label: 'Bill date', format: 'date', hidden: true }, { key: 'customer', label: 'Customer' },
            // Not totalled: a bill returned on two days has two rows, and its total would count twice.
            { key: 'total', label: 'Bill total', format: 'money' }, { key: 'refund', label: 'Returned', format: 'money', total: true },
            { key: 'type', label: 'Type', format: 'badge', tones: { Refund: 'warn', Replace: 'info' } },
            { key: 'stock', label: 'Stock', format: 'badge', tones: { Restocked: 'good', Scrapped: 'bad', 'Part scrapped': 'warn' } },
            { key: 'reason', label: 'Reason', wrap: true },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'discounts',
    title: 'Discount Report',
    subtitle: 'Every discounted bill and who gave it',
    category: 'sales',
    icon: 'BadgePercent',
    keywords: ['rebate', 'concession', 'riyayat'],
    comparable: true,
    build: (data, f) => {
      const sales = reportSales(data, f).filter(s => n(s.discount) > 0);
      const rows: ReportRow[] = sales.map(s => {
        const fig = saleFigures(s);
        return { date: s.date, bill: s.bill_number, customer: customerName(data, s.customer_id, s.customer_name), cashier: cashierOf(s, data), gross: fig.gross, discount: fig.discount, pct: pct(fig.discount, fig.gross), total: fig.total, _tone: pct(fig.discount, fig.gross) >= 10 ? 'warn' : undefined };
      });
      const byCashier = groupSum(rows, r => String(r.cashier), r => n(r.discount));
      const allGross = sum(reportSales(data, f).map(saleFigures), x => x.gross);
      return {
        kpis: [
          { key: 'total', label: 'Total discount', value: sum(rows, r => n(r.discount)), format: 'money', inverse: true, tone: 'warn' },
          { key: 'bills', label: 'Discounted bills', value: rows.length, format: 'number' },
          { key: 'pct', label: 'Of gross sales', value: pct(sum(rows, r => n(r.discount)), allGross), format: 'percent', inverse: true },
        ],
        charts: [{ id: 'cashier', title: 'Discount by cashier', type: 'bar', xKey: 'name', format: 'money', data: byCashier, series: [{ key: 'value', label: 'Discount', color: COLOR.returns }], wide: true }],
        tables: [{
          id: 'bills', showTotals: true, sort: { key: 'discount', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Date / time', format: 'datetime' }, { key: 'bill', label: 'Bill #' }, { key: 'customer', label: 'Customer' },
            { key: 'cashier', label: 'Cashier' }, { key: 'gross', label: 'Gross', format: 'money', total: true },
            { key: 'discount', label: 'Discount', format: 'money', total: true }, { key: 'pct', label: '%', format: 'percent' },
            { key: 'total', label: 'Billed', format: 'money', total: true },
          ],
          rows,
        }],
      };
    },
  },
  {
    id: 'payment_modes',
    title: 'Payment Mode Analysis',
    subtitle: 'Cash vs online vs khata over time',
    category: 'sales',
    icon: 'CreditCard',
    keywords: ['jazzcash', 'easypaisa', 'bank transfer', 'cash'],
    filters: ['groupBy'],
    comparable: true,
    build: (data, f) => {
      const figs = reportSales(data, f).map(s => ({ sale: s, ...saleFigures(s) }));
      const groupBy = autoGroup(f);
      const series = timeSeries(figs, r => r.sale.date, f, groupBy, (b, r) => { b.cash += r.cash; b.online += r.online; b.credit += r.credit; }, ['cash', 'online', 'credit']);
      const cash = sum(figs, r => r.cash), online = sum(figs, r => r.online), credit = sum(figs, r => r.credit);
      const total = cash + online + credit;
      const counts = { Cash: 0, Online: 0, Credit: 0, 'Partial credit': 0 } as Record<string, number>;
      figs.forEach(r => { counts[saleMode(r.sale)] = (counts[saleMode(r.sale)] || 0) + 1; });
      return {
        kpis: [
          { key: 'cash', label: 'Cash', value: cash, format: 'money', hint: `${pct(cash, total)}%` },
          { key: 'online', label: 'Online', value: online, format: 'money', hint: `${pct(online, total)}%` },
          { key: 'credit', label: 'Credit', value: credit, format: 'money', hint: `${pct(credit, total)}%`, inverse: true },
        ],
        charts: [
          { id: 'split', title: 'Mode split', type: 'pie', xKey: 'name', format: 'money', data: [{ name: 'Cash', value: cash }, { name: 'Online', value: online }, { name: 'Credit', value: credit }].filter(x => x.value > 0), series: [{ key: 'value', label: 'Amount' }] },
          { id: 'trend', title: 'Mode trend', type: 'stacked', xKey: 'label', format: 'money', data: series, series: [{ key: 'cash', label: 'Cash', color: COLOR.cash }, { key: 'online', label: 'Online', color: COLOR.online }, { key: 'credit', label: 'Credit', color: COLOR.credit }] },
        ],
        tables: [
          {
            id: 'modes', title: 'Summary',
            columns: [{ key: 'mode', label: 'Mode' }, { key: 'bills', label: 'Bills', format: 'number', total: true }, { key: 'amount', label: 'Amount', format: 'money', total: true }, { key: 'share', label: 'Share', format: 'percent' }],
            showTotals: true,
            rows: [
              { mode: 'Cash', bills: counts.Cash, amount: cash, share: pct(cash, total) },
              { mode: 'Online', bills: counts.Online, amount: online, share: pct(online, total) },
              { mode: 'Credit / partial', bills: counts.Credit + counts['Partial credit'], amount: credit, share: pct(credit, total) },
            ],
          },
          {
            id: 'periods', title: `By ${groupBy}`, showTotals: true, sort: { key: 'key', dir: 'desc' },
            columns: [{ key: 'label', label: 'Period' }, { key: 'cash', label: 'Cash', format: 'money', total: true }, { key: 'online', label: 'Online', format: 'money', total: true }, { key: 'credit', label: 'Credit', format: 'money', total: true }],
            rows: series as ReportRow[],
          },
        ],
      };
    },
  },
];
