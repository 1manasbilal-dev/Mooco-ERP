import { businessDate, offsetDate } from '../dashboardAnalytics';
import { saleNetCollection, salePaidAmount } from '../moneyFlow';
import { saleLineStock, saleLineCostPerBase } from '../sellUnits';
import { itemStockValue, returnedQtyForLine } from '../stockProfit';
import { isOpenStart } from './presets';
import type { GroupBy, ReportData, ReportFilters } from './types';
import type {
  Customer, CustomerTransaction, ExpenseEntry, FinancialAccount, InventoryItem, ItemDefinition, POSBill, ShiftSession,
  Supplier, SupplierTransaction
} from '../../types';

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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const PKT_OFFSET_MS = 5 * 3600000;
/** Pakistan has kept UTC+5 with no daylight saving since 2010; older timestamps go through Intl. */
const FIXED_OFFSET_SINCE = Date.UTC(2010, 0, 1);
const dayTexts = new Map<number, string>();

/**
 * Business day of any stored date or timestamp, in Pakistan time. Same answer as businessDate(),
 * but plain arithmetic instead of Intl, because reports call it for every row on every run.
 */
export const dayOf = (value?: string | null): string => {
  if (!value) return '';
  if (typeof value !== 'string') return businessDate(value as unknown as Date);
  if (value.length === 10 && DATE_ONLY.test(value)) return value;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  if (time < FIXED_OFFSET_SINCE) return businessDate(value);
  const index = Math.floor((time + PKT_OFFSET_MS) / DAY_MS);
  let text = dayTexts.get(index);
  if (!text) {
    text = new Date(index * DAY_MS).toISOString().slice(0, 10);
    dayTexts.set(index, text);
  }
  return text;
};

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

/** Bucket of a business day: the day itself, the Monday of its week, or YYYY-MM. */
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

const nextBucket = (key: string, groupBy: GroupBy) => {
  if (groupBy === 'month') {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return offsetDate(key, groupBy === 'week' ? 7 : 1);
};

/** Too many empty buckets to be useful: only buckets with data are drawn then. */
const MAX_FILLED_BUCKETS = 1000;

/** Every bucket key from the bucket of `from` to the bucket of `to`, so quiet days show as zero. */
export function bucketKeys(from: string, to: string, groupBy: GroupBy): string[] {
  if (!from || !to || from > to) return [];
  const last = bucketKey(to, groupBy);
  const keys: string[] = [];
  for (let key = bucketKey(from, groupBy); key <= last; key = nextBucket(key, groupBy)) {
    keys.push(key);
    if (keys.length > MAX_FILLED_BUCKETS) return [];
  }
  return keys;
}

/** Picks day/week/month so a chart never draws hundreds of thin bars. */
export function autoGroup(f: ReportFilters): GroupBy {
  const days = daysBetween(f.from, f.to);
  if (f.groupBy && f.groupBy !== 'day') return f.groupBy;
  if (days > 120) return 'month';
  if (days > 45) return 'week';
  return 'day';
}

/**
 * Builds a zero-filled time series: one row per bucket with the given numeric keys.
 * An "All time" range starts at the first record instead of zero-filling every month since 2000.
 */
export function timeSeries<T>(
  rows: T[], dateOf: (row: T) => string, f: ReportFilters, groupBy: GroupBy,
  add: (bucket: Record<string, number>, row: T) => void, keys: string[]
) {
  const days = rows.map(row => dayOf(dateOf(row)));
  let start = f.from;
  if (isOpenStart(f.from)) {
    start = '';
    days.forEach(day => { if (day && (!start || day < start) && (!f.to || day <= f.to)) start = day; });
  }
  const empty = () => Object.fromEntries(keys.map(k => [k, 0])) as Record<string, number>;
  const buckets = new Map<string, Record<string, number>>();
  if (start) bucketKeys(start, f.to, groupBy).forEach(key => buckets.set(key, empty()));
  rows.forEach((row, i) => {
    const key = bucketKey(days[i], groupBy);
    if (!key) return;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = empty(); buckets.set(key, bucket); }
    add(bucket, row);
  });
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, values]) => {
    const point: Record<string, unknown> & { key: string; label: string } = { key, label: bucketLabel(key, groupBy) };
    for (const k in values) point[k] = r2(values[k]);
    return point as { key: string; label: string; [k: string]: any };
  });
}

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

/* ---------- Lookups ----------
 * Reports used to call list.find() once per row (bills × customers, lines × items ...).
 * These indexes are built once per data array and reused until the array itself changes. */

const idIndexes = new WeakMap<object, Map<string, unknown>>();
function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  let index = idIndexes.get(list) as Map<string, T> | undefined;
  if (!index) {
    index = new Map();
    for (const row of list) if (row && !index.has(row.id)) index.set(row.id, row);
    idIndexes.set(list, index);
  }
  return index;
}

const nameIndexes = new WeakMap<ItemDefinition[], Map<string, ItemDefinition>>();
function itemsByName(items: ItemDefinition[]) {
  let index = nameIndexes.get(items);
  if (!index) {
    index = new Map();
    for (const item of items) { const key = lower(item?.name); if (key && !index.has(key)) index.set(key, item); }
    nameIndexes.set(items, index);
  }
  return index;
}

export const findItem = (items: ItemDefinition[], id?: string, name?: string) =>
  (id ? byId(items).get(id) : undefined) || (name ? itemsByName(items).get(lower(name)) : undefined);

export const findCustomer = (data: ReportData, id?: string): Customer | undefined => (id ? byId(data.customers).get(id) : undefined);
export const findSupplier = (data: ReportData, id?: string): Supplier | undefined => (id ? byId(data.suppliers).get(id) : undefined);
export const findAccount = (data: ReportData, id?: string): FinancialAccount | undefined => (id ? byId(data.accounts).get(id) : undefined);

export const itemCategory = (item?: ItemDefinition) => {
  const cats = Array.isArray(item?.category) ? item!.category : item?.category ? [String(item.category)] : [];
  return cats.find(Boolean) || 'Uncategorised';
};

interface InventoryIndex { byItem: Map<string, InventoryItem>; byId: Map<string, InventoryItem>; byName: Map<string, InventoryItem> }
const inventoryIndexes = new WeakMap<InventoryItem[], InventoryIndex>();
/** The live inventory row of an item: by item id, then row id, then name. */
export function inventoryRowOf(data: ReportData, item: ItemDefinition): InventoryItem | undefined {
  let index = inventoryIndexes.get(data.inventory);
  if (!index) {
    index = { byItem: new Map(), byId: new Map(), byName: new Map() };
    for (const row of data.inventory) {
      if (!row) continue;
      if (row.item_id && !index.byItem.has(row.item_id)) index.byItem.set(row.item_id, row);
      if (row.id && !index.byId.has(row.id)) index.byId.set(row.id, row);
      const name = lower(row.name);
      if (name && !index.byName.has(name)) index.byName.set(name, row);
    }
    inventoryIndexes.set(data.inventory, index);
  }
  return index.byItem.get(item.id) || index.byId.get(item.id) || index.byName.get(lower(item.name));
}

/**
 * Stock on hand of one item, valued at cost and retail. Loose stock and pack counts come from the
 * live inventory row when there is one (returns, audits and purchases update it first), so Stock
 * Valuation, Low Stock and the Balance Sheet all show the same quantity.
 */
export function itemStock(data: ReportData, item: ItemDefinition) {
  const inv = inventoryRowOf(data, item);
  const loose = inv && inv.quantity !== undefined && inv.quantity !== null ? n(inv.quantity) : n((item as any).stock);
  const variants = inv?.variant_stocks && Object.keys(inv.variant_stocks).length
    ? inv.variant_stocks
    : item.variant_stocks || inv?.variant_stocks || {};
  return itemStockValue(item as any, loose, variants);
}

/* ---------- Status rules shared by every report ---------- */

export const isVoidStatus = (status?: string) => /void|cancel|delete/i.test(String(status || ''));

/** Purchases (milk or material) that no longer count: voided, cancelled, or fully returned to the supplier. */
export const isPurchaseVoid = (status?: string) => /void|cancel|delete|returned/i.test(String(status || '')) && !/partial/i.test(String(status || ''));
/** Expenses that no longer count. Same rule as the dashboard: cancelled, returned, voided or deleted. */
export const isVoidExpense = (e: ExpenseEntry) => {
  const status = String((e as any).status || (e as any).details?.status || '');
  return /void|cancel|delete/i.test(status) || lower(status) === 'returned';
};

/* ---------- Sales ---------- */

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

const figureCache = new WeakMap<POSBill, SaleFigures>();
/** Money figures of one bill. Cached per bill object: a changed bill is a new object in app state. */
export function saleFigures(sale: POSBill): SaleFigures {
  const cached = figureCache.get(sale);
  if (cached) return cached;
  const total = Math.max(0, n(sale.total));
  const discount = Math.max(0, n(sale.discount));
  const gross = n(sale.subtotal) > 0 ? n(sale.subtotal) : total + discount;
  const split = saleNetCollection(sale);
  const figures: SaleFigures = {
    gross: r2(gross), discount: r2(discount), total: r2(total),
    refund: r2(Math.min(total, Math.max(0, n(sale.refund_amount)))),
    net: split.net, cash: split.cash, online: split.online, credit: split.credit,
    paid: salePaidAmount(sale),
  };
  figureCache.set(sale, figures);
  return figures;
}

/** Every bill item came back (refund covers the whole bill). */
export const isFullyReturned = (fig: SaleFigures) => fig.total > 0 && fig.refund >= fig.total;

export const saleMode = (sale: POSBill) => {
  const mode = lower(sale.payment_mode);
  if (mode === 'online') return 'Online';
  if (mode === 'credit') return salePaidAmount(sale) > 0 ? 'Partial credit' : 'Credit';
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
  returnedBaseQty: number;
  revenue: number;     // after bill discount and returns
  cost: number;
  profit: number;
  costKnown: boolean;
}

const lineCache = new WeakMap<POSBill, { items: ItemDefinition[]; lines: SaleLineFigures[] }>();

/** Every bill line with its share of the bill discount, its returns and its cost. Cached per bill and catalog. */
export function saleLines(sale: POSBill, items: ItemDefinition[]): SaleLineFigures[] {
  const cached = lineCache.get(sale);
  if (cached && cached.items === items) return cached.lines;
  const lines = Array.isArray(sale.items) ? sale.items : [];
  const subtotal = n(sale.subtotal) || lines.reduce((s, l) => s + n(l.total), 0);
  const ratio = subtotal > 0 ? n(sale.total) / subtotal : 1;
  const result = lines.map((line: any, index) => {
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
      returnedBaseQty: r3(soldQty > 0 ? stock.baseQty * (returnedQty / soldQty) : 0),
      revenue: r2(revenue),
      cost: r2(cost),
      profit: r2(revenue - cost),
      costKnown: costPerBase > 0,
    };
  });
  lineCache.set(sale, { items, lines: result });
  return result;
}

export interface ReturnEvent {
  /** Stored return timestamp (or date). */
  date: string;
  amount: number;
  restocked: boolean;
  scrapped: boolean;
  reason: string;
  lines: { itemId?: string; name: string; qty: number; amount: number }[];
}

/**
 * The refunds of one bill, one event per return date. Bills keep each returned line with its own
 * returnDate, so two partial returns on different days land on their own days (the P&L does the
 * same). The bill's refund_amount is spread over the lines by their discounted value; older bills
 * that saved no lines put the whole refund on returned_at. Replacements move no money and are left out.
 */
export function saleReturnEvents(sale: POSBill): ReturnEvent[] {
  const refund = saleFigures(sale).refund;
  if (refund <= 0) return [];
  const raw = sale as any;
  const stored: any[] = Array.isArray(raw.returned_items) ? raw.returned_items : Array.isArray(raw.details?.returned_items) ? raw.details.returned_items : [];
  const fallbackDate = raw.returned_at || raw.details?.returned_at || '';
  const lines = stored.filter(line => line && line.action !== 'replace');
  const billLines = Array.isArray(sale.items) ? sale.items : [];
  const beforeDiscount = billLines.reduce((s, l: any) => s + n(l.total ?? n(l.qty) * n(l.price)), 0);
  const factor = beforeDiscount > 0 ? n(sale.total) / beforeDiscount : 0;
  const lineValue = (line: any) => n(line.qty) * n(line.price) * factor;
  const valued = lines.reduce((s, line) => s + lineValue(line), 0);
  const restockOf = (value: unknown) => lower(value) !== 'scrap_spoilage';
  if (!lines.length || valued <= 0) {
    return [{
      date: fallbackDate || sale.date, amount: refund, restocked: restockOf(raw.restock_action), scrapped: !restockOf(raw.restock_action),
      reason: raw.return_reason || raw.details?.return_reason || '', lines: [],
    }];
  }
  const events = new Map<string, ReturnEvent>();
  lines.forEach(line => {
    const date = String(line.returnDate || line.return_date || fallbackDate || sale.date);
    const key = dayOf(date) || date;
    const amount = refund * (lineValue(line) / valued);
    const event = events.get(key) || { date, amount: 0, restocked: false, scrapped: false, reason: '', lines: [] };
    event.amount += amount;
    if (restockOf(line.restock)) event.restocked = true; else event.scrapped = true;
    if (!event.reason && line.reason) event.reason = String(line.reason);
    event.lines.push({ itemId: line.itemId || line.item_id, name: String(line.name || 'Item'), qty: n(line.qty), amount });
    events.set(key, event);
  });
  return [...events.values()].map(e => ({ ...e, amount: r2(e.amount), reason: e.reason || raw.return_reason || raw.details?.return_reason || '' }));
}

export const cashierOf = (sale: POSBill, data: ReportData) =>
  sale.cashier_name || (sale.shift_session_id ? byId<ShiftSession>(data.shiftSessions).get(sale.shift_session_id)?.user_name : undefined) || 'Unassigned';

export const customerName = (data: ReportData, id?: string, fallback?: string) =>
  findCustomer(data, id)?.name || fallback || 'Walk-in';
export const supplierName = (data: ReportData, id?: string, fallback?: string) =>
  findSupplier(data, id)?.name || fallback || 'Unknown supplier';
export const accountName = (data: ReportData, id?: string) =>
  findAccount(data, id)?.name || (id ? 'Other account' : '—');

/* ---------- Khata ---------- */

/**
 * Customer ledger effect, the same rule as the customer khata screen: charges and debit adjustments
 * raise what the customer owes, payments and returns lower it. Unknown types move nothing.
 */
export const customerTxEffect = (type: string, amount: number) => {
  const t = lower(type);
  if (t === 'charge' || t === 'debit') return n(amount);
  if (t === 'payment' || t === 'return') return -n(amount);
  return 0;
};
export const isCustomerCharge = (type: string) => customerTxEffect(type, 1) > 0;

const customerMode = (tx: CustomerTransaction) => lower(tx.mode ?? (tx as any).details?.mode);

/** Opening balance rows (ctx_op_*): khata brought forward, no money moved. */
export const isOpeningCustomerTx = (tx: CustomerTransaction) => String(tx.id || '').startsWith('ctx_op_') || customerMode(tx) === 'opening balance';
/** Bad-debt write-offs and forfeited advances (ctx_wo_*): settle the khata without money. */
export const isWriteOffCustomerTx = (tx: CustomerTransaction) => {
  const raw = tx as any;
  return Boolean(raw.is_write_off || raw.details?.is_write_off) || String(tx.id || '').startsWith('ctx_wo_') || /write.?off|forfeit/.test(customerMode(tx));
};
/** Khata rows that move no money: opening balances, write-offs, forfeits and manual balance adjustments. */
export const isNonCashCustomerTx = (tx: CustomerTransaction) =>
  isOpeningCustomerTx(tx) || isWriteOffCustomerTx(tx) || lower(tx.type) === 'debit' || customerMode(tx) === 'balance adjustment';
/** Money actually received from a customer against the khata (wasooli). */
export const isCustomerReceipt = (tx: CustomerTransaction) => lower(tx.type) === 'payment' && !isNonCashCustomerTx(tx);

/** Supplier waiver / discount: settles the khata, no money leaves an account. */
export const isSupplierWaiver = (tx: SupplierTransaction) => {
  const raw = tx as any;
  return Boolean(raw.waiver || raw.details?.waiver) || /waiver|discount/i.test(String(tx.mode || raw.details?.mode || ''));
};

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

/** Cash remitted to the head that has left the drawer but is not received in any account yet. */
export const cashInTransit = (data: ReportData) =>
  sum(data.cashRemittances.filter(r => r?.status === 'Pending'), r => n(r.declared_amount));
