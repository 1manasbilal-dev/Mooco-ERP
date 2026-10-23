// Pure aggregation for the owner dashboard. Every function here is called from a
// useMemo in pages/Dashboard.tsx, so it must not read the clock or the context.
import type { CustomerOrder, ExpenseEntry, ItemDefinition, POSBill, PurchaseEntry } from '../../types';
import { businessDate, getDashboardPeriod, percentageChange, type DashboardRange } from '../../lib/dashboardAnalytics';
import { cleanNumber, formatCurrency, formatQty } from '../../lib/formatters';
import { isSpotSupplierPayment, saleCashCollected, saleNetCollection, saleOnlineCollected } from '../../lib/moneyFlow';
import { availableSellUnits, saleLineStock } from '../../lib/sellUnits';
import { returnedQtyForLine } from '../../lib/stockProfit';

export type DashboardPeriod = ReturnType<typeof getDashboardPeriod>;

/* ------------------------------------------------------------------ dates */

// businessDate() goes through Intl.formatToParts, which is slow when it runs for every
// record on every refresh. Timestamps never change, so their Pakistan day is cached.
const dayCache = new Map<string, string>();
export function dayKey(value: string | null | undefined): string {
  if (!value) return '';
  let key = dayCache.get(value);
  if (key === undefined) {
    if (dayCache.size > 50_000) dayCache.clear();
    key = businessDate(value);
    dayCache.set(value, key);
  }
  return key;
}

const clockFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Minute of the Pakistan day for a moment in time. */
export function pakistanMinute(date: Date): number | null {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = clockFormatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

/** Minute of the Pakistan day a record was made, or null for date-only records (no time was saved). */
export const minuteOfDay = (value: string | null | undefined): number | null =>
  value && value.includes('T') ? pakistanMinute(new Date(value)) : null;

export const clockLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** "23 Oct" for a YYYY-MM-DD business day; noon keeps the calendar day in every device time zone. */
export const shortDay = (day: string) => day ? new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

/**
 * The previous period is compared at the same point in time. "Today" at 10:40 is compared with
 * yesterday up to 10:40, not with all of yesterday, which made every morning look like a loss.
 * Only the last day of the previous window is cut; date-only records have no time and count in full.
 */
export interface Comparison {
  start: string;
  end: string;
  /** Minute of `end` after which timestamped records are left out; null = whole day. */
  cutoff: number | null;
}

/** The cut applies only while the selected period is still running (it ends today). */
export const comparisonCutoff = (period: DashboardPeriod, nowMinute: number | null) => (period.end === period.todayStr ? nowMinute : null);

/** Drops timestamped records made after the cutoff on the comparison's last day. */
export function cutAtComparison<T extends { date?: string }>(rows: T[], comparison: Comparison): T[] {
  const { cutoff, end } = comparison;
  if (cutoff === null) return rows;
  return rows.filter(row => {
    if (dayKey(row.date) !== end) return true;
    const minute = minuteOfDay(row.date);
    return minute === null || minute <= cutoff;
  });
}

/** "yesterday", "the day before", "previous 7 days". */
export function comparisonPhrase(range: DashboardRange, days: number): string {
  if (range === 'today') return 'yesterday';
  if (range === 'yesterday') return 'the day before';
  return `previous ${days} days`;
}

/**
 * StatCard trend props. No previous activity means there is nothing to divide by, and a
 * 4,900% badge says less than "12x", so very large changes are shown as a multiple.
 */
export function trendFor(current: number, previous: number, phrase: string): { trend: number | null; trendLabel: string } {
  const change = percentageChange(current, previous);
  if (change === null) return { trend: null, trendLabel: current > 0 ? 'First activity' : 'No activity yet' };
  if (Math.abs(change) >= 1000) return { trend: null, trendLabel: `${formatQty(current / previous, 0)}x vs ${phrase}` };
  return { trend: change, trendLabel: `vs ${phrase}` };
}

/* ---------------------------------------------------------------- records */

/** Supply rows are loaded with their details spread onto the row; older rows may still nest them. */
export const isCountedSupply = (ds: any) => {
  const status = ds?.status ?? ds?.details?.status;
  return Boolean(ds?.date) && status !== 'Cancelled' && status !== 'Pending';
};
export const isLiveSale = (s: POSBill) => Boolean(s.date) && s.status !== 'Returned' && (s.status as string) !== 'Cancelled';
export const isLivePurchase = (p: PurchaseEntry) => Boolean(p.date) && p.status !== 'Cancelled' && p.status !== 'Returned';
export const isLiveExpense = (e: ExpenseEntry) => Boolean(e.date) && (e as any).status !== 'Cancelled' && (e as any).status !== 'Returned';

/** Live records whose Pakistan business day is between `start` and `end` (inclusive). */
export function rowsBetween<T extends { date?: string }>(rows: T[], keep: (row: T) => boolean, start: string, end: string): T[] {
  return rows.filter(row => {
    if (!keep(row)) return false;
    const day = dayKey(row.date);
    return day !== '' && day >= start && day <= end;
  });
}

export interface ItemIndex {
  byId: Map<string, ItemDefinition>;
  byName: Map<string, ItemDefinition>;
}

/** Same lookup order as `items.find(id) || items.find(name)`, without scanning the catalogue per bill line. */
export function indexItems(items: ItemDefinition[]): ItemIndex {
  const byId = new Map<string, ItemDefinition>();
  const byName = new Map<string, ItemDefinition>();
  for (const item of items) {
    if (item.id && !byId.has(item.id)) byId.set(item.id, item);
    if (item.name && !byName.has(item.name)) byName.set(item.name, item);
  }
  return { byId, byName };
}
const masterFor = (index: ItemIndex, line: any) => (line.itemId && index.byId.get(line.itemId)) || index.byName.get(line.name);

/* ------------------------------------------------------------------ sales */

export interface SalesSummary {
  total: number;
  cash: number;
  online: number;
  credit: number;
  billCount: number;
  supplyCount: number;
  avgBill: number;
  /** kg, L and pcs are never added together: sold quantity is kept per base unit. */
  soldByUnit: Record<string, number>;
}

export function summariseSales(sales: POSBill[], supplies: any[], index: ItemIndex): SalesSummary {
  let total = 0, cash = 0, online = 0, credit = 0;
  const soldByUnit: Record<string, number> = {};
  const addSold = (unit: string, qty: number) => { soldByUnit[unit] = cleanNumber((soldByUnit[unit] || 0) + qty, 3); };
  for (const sale of sales) {
    // Net of returns: a refund first reverses khata, then the cash/online that was paid back.
    const kept = saleNetCollection(sale);
    total += kept.net;
    cash += kept.cash;
    online += kept.online;
    credit += kept.credit;
    for (const line of (sale.items || []) as any[]) {
      const netQty = Math.max(0, (Number(line.qty) || 0) - returnedQtyForLine(sale as any, line));
      const master = masterFor(index, line);
      const unit = master?.unit || line.baseUnit || (!line.variantId ? line.unit : '') || 'units';
      addSold(unit, saleLineStock({ ...line, qty: netQty }, master).baseQty);
    }
  }
  for (const ds of supplies) {
    const amount = Number(ds.total_amount) || 0;
    const received = Number(ds.payment_received ?? ds.details?.payment_received) || 0;
    total += amount;
    cash += received;
    credit += Math.max(0, amount - received);
    addSold('L', Number(ds.net_qty ?? ds.quantity ?? ds.details?.net_qty) || 0);
  }
  const entries = sales.length + supplies.length;
  return { total, cash, online, credit, billCount: sales.length, supplyCount: supplies.length, avgBill: entries > 0 ? total / entries : 0, soldByUnit };
}

/** Same basis as the current period: bills net of returns plus delivery supply. */
export const salesNetTotal = (sales: POSBill[], supplies: any[]) =>
  sales.reduce((sum, sale) => sum + saleNetCollection(sale).net, 0) + supplies.reduce((sum, ds) => sum + (Number(ds.total_amount) || 0), 0);

/* ------------------------------------------------------------------- milk */

export interface MilkSummary {
  liters: number;
  cost: number;
  buffalo: number;
  cow: number;
  mixed: number;
  avgRate: number;
  avgFat: number;
  count: number;
}

/** Buffalo, cow, everything else ("mixed"); the procurement modal uses the same split. */
export const milkVariety = (milkType: string | undefined): 'buffalo' | 'cow' | 'mixed' => {
  const type = (milkType || '').toLowerCase();
  return type.includes('buffalo') ? 'buffalo' : type.includes('cow') ? 'cow' : 'mixed';
};

export function summariseMilk(purchases: PurchaseEntry[]): MilkSummary {
  let liters = 0, cost = 0, buffalo = 0, cow = 0, mixed = 0, fatPoints = 0, fatLiters = 0;
  for (const p of purchases) {
    const qty = Number(p.quantity) || 0;
    liters += qty;
    cost += Number(p.total_amount) || 0;
    const variety = milkVariety(p.milk_type);
    if (variety === 'buffalo') buffalo += qty;
    else if (variety === 'cow') cow += qty;
    else mixed += qty;
    if (p.fat && Number(p.fat) > 0) { fatPoints += Number(p.fat) * qty; fatLiters += qty; }
  }
  return { liters, cost, buffalo, cow, mixed, avgRate: liters > 0 ? cost / liters : 0, avgFat: fatLiters > 0 ? fatPoints / fatLiters : 0, count: purchases.length };
}

export const milkLiters = (purchases: PurchaseEntry[]) => purchases.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);

/* --------------------------------------------------------------- expenses */

export interface ExpenseSummary {
  total: number;
  cashPaid: number;
  bankPaid: number;
  pending: number;
  count: number;
  categories: { name: string; amount: number; count: number; percent: number }[];
}

export function summariseExpenses(expenses: ExpenseEntry[]): ExpenseSummary {
  let total = 0, cashPaid = 0, bankPaid = 0, pending = 0;
  const byCategory: Record<string, { amount: number; count: number }> = {};
  for (const e of expenses) {
    const amount = Number(e.amount) || 0;
    const paid = Number(e.paidAmount ?? (e.paymentStatus === 'Unpaid' ? 0 : amount));
    total += amount;
    pending += Math.max(0, amount - paid);
    const mode = (e.paymentMode || 'Cash').toLowerCase();
    // Non-cash settlements (bad-debt write-off) are fully "paid" but no money left any account.
    if (mode !== 'adjustment') {
      if (mode.includes('bank') || mode.includes('online') || mode.includes('digital')) bankPaid += paid;
      else cashPaid += paid;
    }
    const category = (e.category || 'General Overhead').trim();
    const row = byCategory[category] || (byCategory[category] = { amount: 0, count: 0 });
    row.amount += amount;
    row.count += 1;
  }
  const categories = Object.entries(byCategory)
    .map(([name, row]) => ({ name, amount: row.amount, count: row.count, percent: total > 0 ? Math.round((row.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { total, cashPaid, bankPaid, pending, count: expenses.length, categories };
}

export const expenseTotal = (expenses: ExpenseEntry[]) => expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

/** Outstanding on every live expense, whatever its date. */
export const unpaidExpenses = (expenses: ExpenseEntry[]) => expenses.filter(isLiveExpense)
  .reduce((sum, e) => sum + Math.max(0, Number(e.amount || 0) - Number(e.paidAmount ?? (e.paymentStatus === 'Unpaid' ? 0 : e.amount))), 0);

/* --------------------------------------------------------------- products */

export interface TopProduct { key: string; name: string; qty: number; revenue: number; unit: string; share: number; barWidth: number; }

export function topProducts(sales: POSBill[], index: ItemIndex, totalSales: number): TopProduct[] {
  const byProduct: Record<string, Omit<TopProduct, 'share' | 'barWidth'>> = {};
  for (const sale of sales) {
    const lines = (sale.items || []) as any[];
    const billSubtotal = lines.reduce((sum, line) => sum + (Number(line.total) || (Number(line.qty) * Number(line.price)) || 0), 0);
    const discountRatio = billSubtotal > 0 ? Math.max(0, 1 - ((Number(sale.discount) || 0) / billSubtotal)) : 1;
    for (const line of lines) {
      const master = masterFor(index, line);
      // Group by product (not line name, which differs per pack size); quantity in the base unit.
      const key = master?.id || line.itemId || (line.name || '').trim();
      if (!key) continue;
      const qty = Math.max(0, (Number(line.qty) || 0) - returnedQtyForLine(sale as any, line));
      if (qty <= 0) continue;
      const unit = master?.unit || line.baseUnit || (!line.variantId ? line.unit : '') || 'units';
      const baseQty = saleLineStock({ ...line, qty }, master).baseQty;
      const lineTotal = (line.total || (Number(line.qty) * (line.price || 0)) || 0) * discountRatio;
      const revenue = (lineTotal / (Number(line.qty) || 1)) * qty;
      const row = byProduct[key] || (byProduct[key] = { key, name: master?.name || (line.name || '').trim(), qty: 0, revenue: 0, unit });
      row.qty = cleanNumber(row.qty + baseQty, 2);
      row.revenue += revenue;
    }
  }
  const sorted = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue);
  const maxRevenue = sorted[0]?.revenue || 1;
  return sorted.slice(0, 5).map(row => ({
    ...row,
    share: Math.round((row.revenue / (totalSales || 1)) * 100),
    barWidth: Math.round((row.revenue / maxRevenue) * 100),
  }));
}

/* --------------------------------------------------------------- balances */

export interface BalanceSummary {
  cash: number;
  bank: number;
  inTransit: number;
  supplierPayables: number;
  customerReceivables: number;
  vendorPayables: number;
}

export function summariseBalances(accounts: any[], cashInTransit: any, suppliers: any[], customers: any[], expenseVendors: any[]): BalanceSummary {
  let cash = 0, bank = 0, supplierPayables = 0, customerReceivables = 0, vendorPayables = 0;
  for (const account of accounts) {
    const balance = Number(account.balance) || 0;
    if (account.type === 'Cash') cash += balance;
    else if (account.type === 'Bank' || account.type === 'Wallet') bank += balance;
  }
  for (const supplier of suppliers) {
    const due = Number(supplier.pending_balance ?? supplier.total_due ?? supplier.balance ?? 0);
    if (due > 0) supplierPayables += due;
  }
  for (const customer of customers) {
    const balance = Number(customer.balance) || 0;
    if (balance > 0) customerReceivables += balance;
  }
  for (const vendor of expenseVendors) {
    const balance = cleanNumber(vendor.pending_balance);
    if (balance > 0) vendorPayables += balance;
  }
  return { cash, bank, inTransit: Number(cashInTransit?.amount) || 0, supplierPayables, customerReceivables, vendorPayables };
}

/* --------------------------------------------------------------- milk flow */

export interface MilkFlow { retailAllocated: number; productionInput: number; unallocated: number; }

export function summariseMilkFlow(inventoryLogs: any[], productionBatches: any[], allocations: any[], period: DashboardPeriod): MilkFlow {
  const inRange = (value: string | undefined) => { const day = dayKey(value); return day !== '' && day >= period.start && day <= period.end; };

  // Counter: milk allocated to the retail counter in the selected range.
  let counterLogLiters = 0;
  for (const log of inventoryLogs) {
    if (!log.date || log.reason !== 'Allocation' || !inRange(log.date)) continue;
    const name = (log.item_name || '').toLowerCase();
    const isMilk = name.includes('milk') || name.includes('doodh') || name.includes('buffalo') || name.includes('cow');
    if (isMilk && Number(log.difference) > 0) counterLogLiters += Number(log.difference);
  }

  // Production: milk used in processing batches in the selected range.
  const batchLiters = productionBatches
    .filter(b => b.start_date && b.status !== 'Cancelled' && inRange(b.start_date))
    .reduce((sum, b) => sum + (Number(b.quantity_input) || 0), 0);

  let productionAllocLiters = 0;
  let retailAllocLiters = 0;
  for (const a of allocations) {
    if (!a.date || !inRange(a.date)) continue;
    const destination = String(a.destination || '').toLowerCase();
    const liters = Number(a.allocated_quantity ?? a.original_quantity ?? 0);
    if (destination.includes('prod') || destination.includes('processing')) productionAllocLiters += liters;
    // Counter fallback: milk allocated to the retail counter, from allocation records.
    if (destination.includes('retail') || destination.includes('counter') || destination.includes('pos')) retailAllocLiters += liters;
  }

  // Unallocated raw milk still in storage / chilling tanks (current, not period based).
  const unallocated = allocations.reduce((sum, a) => {
    const status = String(a.status || '').toLowerCase();
    if (status.includes('fully') || status.includes('completed') || status.includes('supply')) return sum;
    const remaining = a.remaining_quantity !== null && a.remaining_quantity !== undefined
      ? Number(a.remaining_quantity)
      : Number(a.original_quantity) - Number(a.allocated_quantity || 0);
    return sum + Math.max(0, remaining || 0);
  }, 0);

  return {
    retailAllocated: counterLogLiters > 0 ? counterLogLiters : Math.max(0, retailAllocLiters),
    productionInput: Math.max(batchLiters, productionAllocLiters),
    unallocated,
  };
}

export function lowStockCount(inventory: any[], index: ItemIndex): number {
  let count = 0;
  for (const row of inventory) {
    const master = (row.item_id && index.byId.get(row.item_id)) || index.byId.get(row.id);
    const threshold = master?.reorder_level ?? 10;
    if ((Number(row.quantity) || 0) <= threshold && threshold > 0) count += 1;
  }
  return count;
}

/* ------------------------------------------------------ party cash flows */

export interface PartyFlows { customersReceived: number; suppliersPaid: number; vendorsPaid: number; }

export function summarisePartyFlows(input: {
  sales: POSBill[];
  purchases: PurchaseEntry[];
  expenses: ExpenseEntry[];
  customerTransactions: any[];
  supplierTransactions: any[];
  materialPurchases: any[];
  expenseVendorTransactions: any[];
  period: DashboardPeriod;
}): PartyFlows {
  const { sales, purchases, expenses, customerTransactions, supplierTransactions, materialPurchases, expenseVendorTransactions, period } = input;
  const inRange = (value: string | undefined) => { const day = dayKey(value); return day !== '' && day >= period.start && day <= period.end; };

  // Received from customers (wasooli).
  let customersReceived = 0;
  const posSaleIds = new Set<string>();
  for (const sale of sales) {
    posSaleIds.add(sale.id);
    const collected = saleCashCollected(sale) + saleOnlineCollected(sale);
    if (collected > 0) customersReceived += collected;
  }
  for (const tx of customerTransactions) {
    if (!tx.date || !inRange(tx.date)) continue;
    // Skip duplicate POS sale entries.
    if (tx.id && tx.id.startsWith('ctx_') && posSaleIds.has(tx.id.replace('ctx_', ''))) continue;
    const type = String(tx.type || '').toLowerCase();
    if (type === 'payment' || type === 'credit') {
      const amount = cleanNumber(tx.amount);
      if (amount > 0) customersReceived += amount;
    }
  }

  // Paid to milk suppliers (doodh adaigi).
  let suppliersPaid = 0;
  for (const p of purchases) {
    const paid = cleanNumber(p.paid_amount ?? (p.status === 'Paid' ? p.total_amount : 0));
    if (paid > 0) suppliersPaid += paid;
  }
  for (const tx of supplierTransactions) {
    if (!tx.date || isSpotSupplierPayment(tx) || !inRange(tx.date)) continue;
    const type = String(tx.type || '').toLowerCase();
    if (type === 'payment' || type === 'advance') {
      const amount = cleanNumber(tx.amount);
      if (amount > 0) suppliersPaid += amount;
    }
  }

  // Paid to material, feed and expense vendors.
  let vendorsPaid = 0;
  for (const mp of materialPurchases) {
    if (!mp.date || !inRange(mp.date)) continue;
    const paid = cleanNumber(mp.paid_amount ?? (mp.status === 'Paid' ? mp.total_amount : 0));
    if (paid > 0) vendorsPaid += paid;
  }
  for (const tx of expenseVendorTransactions) {
    if (!tx.date || !inRange(tx.date) || tx.type !== 'Payment') continue;
    const amount = cleanNumber(tx.amount || tx.paid_amount);
    if (amount > 0) vendorsPaid += amount;
  }
  for (const e of expenses) {
    const vendor = (e as any).vendor;
    if (typeof vendor !== 'string' || vendor.trim() === '') continue;
    if (!e.vendor_id || expenseVendorTransactions.length === 0) {
      const amount = cleanNumber(e.paidAmount ?? (e.paymentStatus === 'Unpaid' ? 0 : e.amount));
      if (amount > 0) vendorsPaid += amount;
    }
  }

  return { customersReceived, suppliersPaid, vendorsPaid };
}

/* ------------------------------------------------------- activity, alerts */

export type ActivityKind = 'sale' | 'milk' | 'expense';
export interface ActivityEntry { id: string; kind: ActivityKind; date: string; title: string; detail: string; amount: number; mode: string; module: string; }

export function recentActivity(sales: POSBill[], purchases: PurchaseEntry[], expenses: ExpenseEntry[]): ActivityEntry[] {
  const time = (value: string) => { const t = new Date(value).getTime(); return Number.isFinite(t) ? t : 0; };
  return [
    // Net of refunds, like every other sales figure on the dashboard.
    ...sales.map(s => ({ id: `s-${s.id}`, kind: 'sale' as const, date: s.date, title: s.customer_name || 'Walk-in customer', detail: `Sale · ${s.bill_number || s.id}`, amount: saleNetCollection(s).net, mode: s.payment_mode, module: 'sales-history' })),
    ...purchases.map(p => ({ id: `p-${p.id}`, kind: 'milk' as const, date: p.date, title: p.supplier_name || 'Milk supplier', detail: `Milk collection · ${formatQty(p.quantity)} L`, amount: Number(p.total_amount || 0), mode: p.status || 'Recorded', module: 'purchase' })),
    ...expenses.map(e => ({ id: `e-${e.id}`, kind: 'expense' as const, date: e.date, title: e.category || 'Expense', detail: e.description || 'Operating expense', amount: Number(e.amount || 0), mode: e.paymentStatus || 'Recorded', module: 'expenses' })),
  ].sort((a, b) => time(b.date) - time(a.date)).slice(0, 5);
}

export type AlertIcon = 'late' | 'today' | 'order' | 'stock' | 'delivery' | 'ready' | 'milk' | 'cash' | 'bills' | 'error';
export interface DashboardAlert { id: string; title: string; detail: string; module: string; icon: AlertIcon; path?: string; tone: 'danger' | 'warning' | 'info' | 'neutral'; }

export function orderAlerts(input: {
  orders: CustomerOrder[];
  error: string;
  todayKey: string;
  inventory: any[];
  index: ItemIndex;
  canCompleteOrder: boolean;
}): DashboardAlert[] {
  const { orders, error, todayKey, inventory, index, canCompleteOrder } = input;
  if (error) return [{ id: 'orders-error', title: 'Orders could not be checked', detail: 'Open orders and try again', module: 'customer-orders', icon: 'error', path: '/customer-orders', tone: 'warning' }];
  const horizon = new Date(`${todayKey}T12:00:00`);
  horizon.setDate(horizon.getDate() + 2);
  const horizonKey = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;
  const stockById = new Map<string, any>();
  for (const row of inventory) if (row.item_id && !stockById.has(row.item_id)) stockById.set(row.item_id, row);
  const available = (line: CustomerOrder['items'][number]) => {
    const stock = stockById.get(line.itemId);
    const product = index.byId.get(line.itemId);
    const variant = line.variantId ? product?.variants?.find(row => row.id === line.variantId) : undefined;
    return availableSellUnits(Number(stock?.quantity) || 0, Number(stock?.variant_stocks?.[line.variantId || ''] || 0), variant);
  };
  const late = orders.filter(order => order.due_date < todayKey);
  const today = orders.filter(order => order.due_date === todayKey);
  const near = orders.filter(order => order.due_date > todayKey && order.due_date <= horizonKey);
  const soon = orders.filter(order => order.due_date <= horizonKey);
  const short = soon.filter(order => order.items.some(line => line.qty > available(line)));
  const deliveries = orders.filter(order => order.fulfillment === 'Delivery' && order.due_date <= todayKey);
  const pending = soon.filter(order => order.status === 'Pending');
  const ready = orders.filter(order => order.status === 'Ready' || (order.status === 'Confirmed' && order.due_date <= todayKey));
  const nameOf = (list: CustomerOrder[], single: (order: CustomerOrder) => string, many: (count: number) => string) => list.length === 1 ? single(list[0]) : many(list.length);
  const alerts: DashboardAlert[] = [];
  if (late.length) alerts.push({ id: 'orders-late', title: nameOf(late, o => `${o.customer_name}'s order is late`, n => `${n} orders are late`), detail: 'Serve these before newer bookings', module: 'customer-orders', icon: 'late', path: '/customer-orders', tone: 'danger' });
  if (today.length) alerts.push({ id: 'orders-today', title: nameOf(today, o => `${o.customer_name}'s order is due today`, n => `${n} orders are due today`), detail: 'Pickup and delivery for today', module: 'customer-orders', icon: 'today', path: '/customer-orders', tone: 'warning' });
  if (near.length) alerts.push({ id: 'orders-near', title: nameOf(near, o => `${o.customer_name}'s order is near`, n => `${n} orders are near`), detail: near.length === 1 ? `Due ${shortDay(near[0].due_date)}` : 'Due in the next 2 days', module: 'customer-orders', icon: 'order', path: '/customer-orders', tone: 'info' });
  if (short.length) {
    const missing = short.length === 1 ? short[0].items.find(line => line.qty > available(line))?.name : '';
    alerts.push({ id: 'orders-stock', title: nameOf(short, o => `Complete stock for ${o.customer_name}`, n => `Complete stock for ${n} orders`), detail: missing || 'Prepare the booked items first', module: 'inventory', icon: 'stock', path: '/inventory', tone: 'warning' });
  }
  if (deliveries.length) alerts.push({ id: 'orders-delivery', title: nameOf(deliveries, o => `Send ${o.customer_name}'s delivery`, n => `${n} deliveries to send`), detail: 'Due today or already late', module: 'customer-orders', icon: 'delivery', path: '/customer-orders', tone: 'warning' });
  if (pending.length) alerts.push({ id: 'orders-pending', title: nameOf(pending, o => `Confirm ${o.customer_name}'s booking`, n => `${n} bookings need confirm`), detail: 'Still pending', module: 'customer-orders', icon: 'order', path: '/customer-orders', tone: 'info' });
  if (ready.length) {
    const direct = ready.length === 1 && canCompleteOrder;
    alerts.push({ id: 'orders-ready', title: nameOf(ready, o => `${o.customer_name}'s order is ready to complete`, n => `${n} orders ready to complete`), detail: 'Open the bill when the customer arrives', module: direct ? 'pos' : 'customer-orders', icon: 'ready', path: direct ? `/pos?order=${encodeURIComponent(ready[0].id)}` : '/customer-orders', tone: 'info' });
  }
  return alerts;
}

export function operationalAlerts(input: { unallocatedLiters: number; lowStock: number; inTransit: number; unpaidExpenses: number }): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  if (input.unallocatedLiters > 0) alerts.push({ id: 'milk', title: 'Milk ready to allocate', detail: `${formatQty(input.unallocatedLiters)} L in your tank`, module: 'allocation', icon: 'milk', tone: 'info' });
  if (input.lowStock > 0) alerts.push({ id: 'stock', title: 'Stock needs attention', detail: `${input.lowStock} items at reorder level`, module: 'inventory', icon: 'stock', tone: 'warning' });
  if (input.inTransit > 0) alerts.push({ id: 'transit', title: 'Cash awaiting receipt', detail: `${formatCurrency(input.inTransit)} in transit`, module: 'cash-control', icon: 'cash', tone: 'warning' });
  if (input.unpaidExpenses > 0) alerts.push({ id: 'bills', title: 'Expenses to settle', detail: `${formatCurrency(input.unpaidExpenses)} outstanding`, module: 'expenses', icon: 'bills', tone: 'neutral' });
  return alerts;
}
