import type { POSBill, PurchaseEntry, ExpenseEntry } from '../types';
import { businessDate, offsetDate, reportingHalfHour, getDashboardPeriod, DashboardRange } from './dashboardAnalytics';

export type PerformanceMetric = 'sales' | 'milk' | 'expenses' | 'products';

export function buildPerformanceSeries({ sales, purchases, expenses, metric, selectedProduct, period, range }: {
  sales: POSBill[];
  purchases: PurchaseEntry[];
  expenses: ExpenseEntry[];
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
  const entries = metric === 'milk' ? purchases.filter(p => !['Returned', 'Cancelled'].includes(p.status || ''))
    : metric === 'expenses' ? expenses : sales.filter(s => s.status !== 'Returned');
  entries.forEach(entry => {
    const date = businessDate(entry.date);
    const current = date >= period.start && date <= period.end;
    const previous = date >= period.previousStart && date <= period.previousEnd;
    if (!current && !previous) return;
    const index = intraday ? reportingHalfHour(entry.date)
      : Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${current ? period.start : period.previousStart}T00:00:00Z`)) / 86400000);
    if (!rows[index]) return;
    const value = metric === 'milk' ? Number((entry as PurchaseEntry).quantity) || 0
      : metric === 'expenses' ? Number((entry as ExpenseEntry).amount) || 0
      : metric === 'products' ? (entry as POSBill).items.filter(i => i.name === selectedProduct).reduce((sum, i) => sum + (Number(i.total) || Number(i.qty) * Number(i.price) || 0), 0)
      : Number((entry as POSBill).total) || 0;
    rows[index][current ? 'current' : 'previous'] += value;
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
