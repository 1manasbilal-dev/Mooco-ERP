import type { POSBill, PurchaseEntry, ExpenseEntry } from '../types';
import { businessDate, offsetDate, reportingHalfHour, getDashboardPeriod, DashboardRange } from './dashboardAnalytics';
import { returnedQtyForLine } from './stockProfit';

export type PerformanceMetric = 'sales' | 'milk' | 'expenses' | 'products';

/** A home-delivery supply slip, as loaded (details may be spread on the row or still nested). */
export interface PerformanceSupply {
  date?: string;
  total_amount?: number;
  status?: string;
  details?: { status?: string };
}

/** Same rule as the dashboard sales card: dated, not cancelled and not pending. */
export function isCountedSupply(entry: PerformanceSupply | null | undefined): boolean {
  const status = entry?.status ?? entry?.details?.status;
  return Boolean(entry?.date) && status !== 'Cancelled' && status !== 'Pending';
}

/**
 * The product a bill line belongs to, so every pack size of one product charts together.
 * POS lines already carry the product name; counter-closing and booking lines may be saved as
 * "Milk (1L Pouch)" with the pack in brackets.
 */
export function performanceProductName(line: { name?: string; variantId?: string; variantName?: string }): string {
  const name = String(line?.name || '').trim();
  const variant = String(line?.variantName || '').trim();
  if (variant && name.endsWith(` (${variant})`)) return name.slice(0, -(variant.length + 3)).trim();
  if (line?.variantId && line.variantId !== 'loose' && line.variantId !== 'base') {
    const match = name.match(/^(.+?) \(([^()]+)\)$/);
    if (match) return match[1].trim();
  }
  return name;
}

/** Products sold in these bills (returned bills excluded), one entry per product, sorted. */
export function performanceProducts(sales: POSBill[]): string[] {
  return [...new Set(sales
    .filter(s => s.status !== 'Returned' && (s.status as any) !== 'Cancelled')
    .flatMap(s => (s.items || []).map(line => performanceProductName(line as any)))
    .filter(Boolean))].sort();
}

export function buildPerformanceSeries({ sales, purchases, expenses, supplies = [], metric, selectedProduct, period, range }: {
  sales: POSBill[];
  purchases: PurchaseEntry[];
  expenses: ExpenseEntry[];
  /** Delivery supply slips; the sales card counts them as sales, so the sales chart does too. */
  supplies?: PerformanceSupply[];
  metric: PerformanceMetric;
  selectedProduct: string;
  period: ReturnType<typeof getDashboardPeriod>;
  range: DashboardRange;
}) {
  const intraday = period.days === 1;
  const rows = Array.from({ length: intraday ? 48 : period.days }, (_, index) => ({
    label: intraday ? `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`
      : new Date(`${offsetDate(period.start, index)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: range === '7days' ? 'short' : undefined }),
    current: 0, previous: 0, currentTotal: 0, previousTotal: 0,
  }));
  type Entry = { date?: string; value: () => number };
  const entries: Entry[] = metric === 'milk'
    ? purchases.filter(p => !['Returned', 'Cancelled'].includes(p.status || '')).map(p => ({ date: p.date, value: () => Number(p.quantity) || 0 }))
    : metric === 'expenses'
      ? expenses.filter(e => !['Cancelled', 'Returned'].includes((e as any).status || '')).map(e => ({ date: e.date, value: () => Number(e.amount) || 0 }))
      : [
        ...sales.filter(s => s.status !== 'Returned' && (s.status as any) !== 'Cancelled').map(bill => ({ date: bill.date, value: () => billValue(bill) })),
        ...(metric === 'sales' ? supplies.filter(isCountedSupply).map(s => ({ date: s.date, value: () => Number(s.total_amount) || 0 })) : [])
      ];

  function billValue(bill: POSBill): number {
    if (metric !== 'products') return Math.max(0, (Number(bill.total) || 0) - (Number(bill.refund_amount) || 0));
    const lines = bill.items || [];
    const subtotal = lines.reduce((s, it) => s + (Number(it.total) || Number(it.qty) * Number(it.price) || 0), 0);
    const discountRatio = subtotal > 0 ? (Number(bill.total) || 0) / subtotal : 1;
    return lines.reduce((sum, i, lineIndex) => {
      // A pack line still matches its exact old name, so an older product picker keeps working.
      if (performanceProductName(i as any) !== selectedProduct && i.name !== selectedProduct) return sum;
      // Two lines of the same product must not both lose the same returned quantity.
      const netQty = Math.max(0, (Number(i.qty) || 0) - returnedQtyForLine(bill as any, i as any, lineIndex));
      const grossLine = (Number(i.qty) || 0) > 0 ? ((Number(i.total) || Number(i.qty) * Number(i.price) || 0) * (netQty / Number(i.qty))) : 0;
      return sum + grossLine * discountRatio;
    }, 0);
  }

  entries.forEach(entry => {
    // A record without a date belongs to no day: it is left out, never counted as today.
    const date = businessDate(entry.date);
    if (!date) return;
    const current = date >= period.start && date <= period.end;
    const previous = date >= period.previousStart && date <= period.previousEnd;
    if (!current && !previous) return;
    const index = intraday ? reportingHalfHour(entry.date as string)
      : Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${current ? period.start : period.previousStart}T00:00:00Z`)) / 86400000);
    if (!rows[index]) return;
    rows[index][current ? 'current' : 'previous'] += entry.value();
  });
  let currentTotal = 0;
  let previousTotal = 0;
  rows.forEach(row => {
    currentTotal += row.current;
    previousTotal += row.previous;
    row.currentTotal = currentTotal;
    row.previousTotal = previousTotal;
  });
  return rows;
}
