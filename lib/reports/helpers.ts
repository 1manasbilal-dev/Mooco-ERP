import { businessDate, offsetDate } from '../dashboardAnalytics';
import { saleNetCollection, salePaidAmount } from '../moneyFlow';
import { saleLineStock, saleLineCostPerBase } from '../sellUnits';
import { returnedQtyForLine } from '../stockProfit';
import type { GroupBy, ReportData, ReportFilters } from './types';
import type { ItemDefinition, POSBill } from '../../types';

export { businessDate, offsetDate };

export const n = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
export const r2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const r3 = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;
export const pct = (part: number, whole: number) => (whole ? r2((part / whole) * 100) : 0);
export const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const CHART_COLORS = ['#65a30d', '#0891b2', '#f59e0b', '#7c3aed', '#e11d48', '#2563eb', '#14b8a6', '#f97316', '#64748b', '#db2777'];
export const COLOR = {
  sales: '#65a30d', cash: '#16a34a', online: '#2563eb', credit: '#f59e0b', expense: '#e11d48',
  purchase: '#0891b2', profit: '#7c3aed', returns: '#f97316', neutral: '#64748b',
} as const;

/* ------------------------------------------------------------------ dates */

/** Business day of any stored date or timestamp, in Pakistan time. */
export const dayOf = (value?: string | null): string => (value ? businessDate(value) : '');

export const inRange = (value: string | undefined | null, f: Pick<ReportFilters, 'from' | 'to'>): boolean => {
  const d = dayOf(value);
  if (!d) return false;
  return (!f.from || d >= f.from) && (!f.to || d <= f.to);
};

export const daysBetween = (from: string, to: string) =>
  Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);

/** The same number of days immediately before the range. */
export function previousRange(from: string, to: string) {
  const days = daysBetween(from, to);
  return { from: offsetDate(from, -days), to: offsetDate(from, -1) };
}

const weekStart = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return offsetDate(date, -dow);
};

export function bucketKey(date: string, groupBy: GroupBy): string {
  if (!date) return '';
  if (groupBy === 'month') return date.slice(0, 7);
  if (groupBy === 'week') return weekStart(date);
  return date;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function bucketLabel(key: string, groupBy: GroupBy): string {
  if (!key) return '';
  if (groupBy === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const label = `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
  return groupBy === 'week' ? `Wk ${label}` : label;
}

export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Every bucket in the range, so charts show quiet days as zero instead of skipping them. */
export function eachBucket(from: string, to: string, groupBy: GroupBy, limit = 400): string[] {
  if (!from || !to || from > to) return [];
  const keys: string[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 4000) {
    const key = bucketKey(cursor, groupBy);
    if (keys[keys.length - 1] !== key) keys.push(key);
    cursor = offsetDate(cursor, 1);
    guard++;
  }
  return keys.slice(-limit);
}

/** Picks day/week/month so a chart never draws hundreds of thin bars. */
export function autoGroup(f: ReportFilters): GroupBy {
  const days = daysBetween(f.from, f.to);
  if (f.groupBy && f.groupBy !== 'day') return f.groupBy;
  if (days > 120) return 'month';
  if (days > 45) return 'week';
  return 'day';
}

/** Builds a zero-filled time series: one row per bucket with the given numeric keys. */
export function timeSeries<T>(
  rows: T[], dateOf: (row: T) => string, f: ReportFilters, groupBy: GroupBy,
  add: (bucket: Record<string, number>, row: T) => void, keys: string[]
) {
  const buckets = new Map<string, Record<string, number>>();
  eachBucket(f.from, f.to, groupBy).forEach(key => buckets.set(key, Object.fromEntries(keys.map(k => [k, 0]))));
  rows.forEach(row => {
    const key = bucketKey(dayOf(dateOf(row)), groupBy);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, Object.fromEntries(keys.map(k => [k, 0])));
    add(buckets.get(key)!, row);
  });
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => ({
    key, label: bucketLabel(key, groupBy), ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, r2(v)])),
  }));
}

/* ------------------------------------------------------------- grouping */

export function groupSum<T>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => number) {
  const map = new Map<string, number>();
  rows.forEach(row => {
    const key = keyOf(row) || 'Other';
    map.set(key, (map.get(key) || 0) + valueOf(row));
  });
  return [...map.entries()].map(([name, value]) => ({ name, value: r2(value) })).sort((a, b) => b.value - a.value);
}

/** Top N slices plus an "Others" slice, for pie charts. */
export function topSlices(rows: { name: string; value: number }[], limit = 7) {
  const positive = rows.filter(row => row.value > 0);
  if (positive.length <= limit) return positive;
  const others = positive.slice(limit).reduce((sum, row) => sum + row.value, 0);
  return [...positive.slice(0, limit), { name: 'Others', value: r2(others) }];
}

export const sum = <T>(rows: T[], valueOf: (row: T) => number) => r2(rows.reduce((total, row) => total + (valueOf(row) || 0), 0));

/* ---------------------------------------------------------------- sales */

export const isVoidStatus = (status?: string) => /void|cancel|delete/i.test(String(status || ''));

/** Bills that count as sales: everything except voided ones. Fully returned bills stay so returns can be shown. */
export const reportSales = (data: ReportData, f: Pick<ReportFilters, 'from' | 'to'>) =>
  data.sales.filter(sale => !isVoidStatus(sale.status) && inRange(sale.date, f));

export interface SaleFigures {
  gross: number;      // before discount
  discount: number;
  total: number;      // billed after discount
  refund: number;     // returned value
  net: number;        // kept after returns
  cash: number;
  online: number;
  credit: number;     // still on khata
  paid: number;       // collected at the counter
}

export function saleFigures(sale: POSBill): SaleFigures {
  const total = Math.max(0, n(sale.total));
  const discount = Math.max(0, n(sale.discount));
  const gross = n(sale.subtotal) > 0 ? n(sale.subtotal) : total + discount;
  const split = saleNetCollection(sale);
  return {
    gross: r2(gross), discount: r2(discount), total: r2(total),
    refund: r2(Math.min(total, Math.max(0, n(sale.refund_amount)))),
    net: split.net, cash: split.cash, online: split.online, credit: split.credit,
    paid: salePaidAmount(sale),
  };
}

export const saleMode = (sale: POSBill) => {
  const mode = lower(sale.payment_mode);
  if (mode === 'online') return 'Online';
  if (mode === 'credit') return n(sale.paid_amount) > 0 ? 'Partial credit' : 'Credit';
  return 'Cash';
};

export interface SaleLineFigures {
  itemId: string;
  name: string;
  category: string;
  unit: string;
  variant?: string;
  qty: number;         // sold units after returns
  baseQty: number;     // base units after returns
  returnedQty: number;
  revenue: number;     // after bill discount and returns
  cost: number;
  profit: number;
  costKnown: boolean;
}

const itemIndex = new WeakMap<ItemDefinition[], Map<string, ItemDefinition>>();
export function itemsById(items: ItemDefinition[]) {
  let index = itemIndex.get(items);
  if (!index) {
    index = new Map(items.map(item => [item.id, item]));
    itemIndex.set(items, index);
  }
  return index;
}
export const findItem = (items: ItemDefinition[], id?: string, name?: string) =>
  (id ? itemsById(items).get(id) : undefined) || (name ? items.find(item => lower(item.name) === lower(name)) : undefined);

export const itemCategory = (item?: ItemDefinition) => {
  const cats = Array.isArray(item?.category) ? item!.category : item?.category ? [String(item.category)] : [];
  return cats.find(Boolean) || 'Uncategorised';
};

/** Every bill line with its share of the bill discount, its returns and its cost. */
export function saleLines(sale: POSBill, items: ItemDefinition[]): SaleLineFigures[] {
  const lines = Array.isArray(sale.items) ? sale.items : [];
  const subtotal = n(sale.subtotal) || lines.reduce((s, l) => s + n(l.total), 0);
  const ratio = subtotal > 0 ? n(sale.total) / subtotal : 1;
  return lines.map((line: any, index) => {
    const item = findItem(items, line.itemId, line.name);
    const soldQty = n(line.qty);
    const returnedQty = Math.min(soldQty, returnedQtyForLine(sale as any, line, index));
    const keptQty = Math.max(0, soldQty - returnedQty);
    const keepShare = soldQty > 0 ? keptQty / soldQty : 0;
    const stock = saleLineStock(line, item as any);
    const fallback = n(item?.cost_price);
    const costPerBase = saleLineCostPerBase(line, stock, fallback);
    const baseQty = stock.baseQty * keepShare;
    const revenue = n(line.total) * ratio * keepShare;
    const cost = costPerBase * baseQty;
    return {
      itemId: item?.id || line.itemId || line.name,
      name: item?.name || line.name || 'Item',
      category: itemCategory(item),
      unit: item?.unit || line.baseUnit || 'unit',
      variant: line.variantName || undefined,
      qty: r3(keptQty),
      baseQty: r3(baseQty),
      returnedQty: r3(returnedQty),
      revenue: r2(revenue),
      cost: r2(cost),
      profit: r2(revenue - cost),
      costKnown: costPerBase > 0,
    };
  });
}

export const cashierOf = (sale: POSBill, data: ReportData) =>
  sale.cashier_name || data.shiftSessions.find(s => s.id === sale.shift_session_id)?.user_name || 'Unassigned';

/* ------------------------------------------------------------- parties */

export const customerName = (data: ReportData, id?: string, fallback?: string) =>
  data.customers.find(c => c.id === id)?.name || fallback || 'Walk-in';
export const supplierName = (data: ReportData, id?: string, fallback?: string) =>
  data.suppliers.find(s => s.id === id)?.name || fallback || 'Unknown supplier';
export const accountName = (data: ReportData, id?: string) =>
  data.accounts.find(a => a.id === id)?.name || (id ? 'Other account' : '—');

/** Customer ledger effect: charges raise what they owe, payments and returns lower it. */
export const customerTxEffect = (type: string, amount: number) => (lower(type) === 'charge' ? n(amount) : -n(amount));

/** Bank ledger effect on the account balance. */
export const bankTxEffect = (type: string, amount: number) =>
  ['deposit', 'transfer_in', 'income'].includes(lower(type)) ? n(amount)
    : ['withdrawal', 'transfer_out', 'expense'].includes(lower(type)) ? -n(amount)
      : 0;

/** Sorting by date, then created time, then id, so same-day entries stay in a stable order. */
export const chronological = <T extends { date?: string; created_at?: string; id?: string }>(a: T, b: T) =>
  String(a.date || '').localeCompare(String(b.date || '')) ||
  String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
  String(a.id || '').localeCompare(String(b.id || ''));

export const isMilkPurchaseVoid = (status?: string) => /void|cancel|delete|returned/i.test(String(status || '')) && !/partial/i.test(String(status || ''));
