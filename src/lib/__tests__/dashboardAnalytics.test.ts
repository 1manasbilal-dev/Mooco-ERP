import { describe, expect, it } from 'vitest';
import { businessDate, getDashboardPeriod, offsetDate, percentageChange, reportingHalfHour, reportingHour } from '../dashboardAnalytics';
import { buildPerformanceSeries, isCountedSupply, performanceProductName, performanceProducts } from '../dashboardPerformanceData';
import type { ExpenseEntry, POSBill, PurchaseEntry } from '../../types';

describe('businessDate', () => {
  it('keeps date-only values and converts timestamps to the Pakistan day', () => {
    expect(businessDate('2026-10-22')).toBe('2026-10-22');
    expect(businessDate('2026-10-22T18:59:59Z')).toBe('2026-10-22');
    expect(businessDate('2026-10-22T19:00:00Z')).toBe('2026-10-23');
    expect(businessDate(new Date('2026-12-31T19:30:00Z'))).toBe('2027-01-01');
    expect(businessDate('rubbish')).toBe('');
  });

  it('is today when called without a value, but empty for a record with no date', () => {
    expect(businessDate()).toBe(businessDate(new Date()));
    expect(businessDate(undefined)).toBe('');
    expect(businessDate(null)).toBe('');
    expect(businessDate('')).toBe('');
    expect(businessDate(new Date('nope'))).toBe('');
  });

  it('gives the same answer on repeated calls (cached)', () => {
    expect(businessDate('2026-10-22T19:00:00Z')).toBe('2026-10-23');
    expect(businessDate('2026-10-22T19:00:00Z')).toBe('2026-10-23');
  });
});

describe('offsetDate and periods', () => {
  it('moves across month and leap-year ends', () => {
    expect(offsetDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(offsetDate('2028-03-01', -1)).toBe('2028-02-29');
    expect(offsetDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('builds inclusive ranges with an equal-length previous period', () => {
    const now = new Date('2026-10-22T20:00:00Z'); // 01:00 on the 23rd in Pakistan
    expect(getDashboardPeriod('today', now)).toEqual({
      start: '2026-10-23', end: '2026-10-23', todayStr: '2026-10-23', ydayStr: '2026-10-22',
      days: 1, previousStart: '2026-10-22', previousEnd: '2026-10-22'
    });
    expect(getDashboardPeriod('yesterday', now)).toMatchObject({ start: '2026-10-22', end: '2026-10-22', days: 1 });
    expect(getDashboardPeriod('7days', now)).toMatchObject({ start: '2026-10-17', end: '2026-10-23', days: 7, previousStart: '2026-10-10', previousEnd: '2026-10-16' });
    expect(getDashboardPeriod('month', now)).toMatchObject({ start: '2026-10-01', end: '2026-10-23', days: 23, previousStart: '2026-09-08', previousEnd: '2026-09-30' });
  });

  it('reports change only against a positive base', () => {
    expect(percentageChange(150, 100)).toBe(50);
    expect(percentageChange(50, 0)).toBeNull();
    expect(percentageChange(50, -10)).toBeNull();
  });
});

describe('reporting hours', () => {
  it('buckets timestamps by Pakistan time', () => {
    expect(reportingHour('2026-10-22T04:30:00Z')).toBe(9);
    expect(reportingHalfHour('2026-10-22T04:30:00Z')).toBe(19);
    expect(reportingHalfHour('2026-10-22T18:59:00Z')).toBe(47);
    expect(reportingHalfHour('2026-10-22T19:00:00Z')).toBe(0);
  });

  it('puts records without a real time at noon, not at a phantom 05:00', () => {
    expect(reportingHour('2026-10-22')).toBe(12);
    expect(reportingHalfHour('2026-10-22')).toBe(24);
    expect(reportingHour('2026-10-22T00:00:00+00:00')).toBe(12);
    expect(reportingHalfHour('2026-10-22T00:00:00.000Z')).toBe(24);
    expect(reportingHalfHour('2026-10-22T00:00:00.250Z')).toBe(10);
    expect(reportingHalfHour('not a date T')).toBe(24);
  });
});

describe('buildPerformanceSeries', () => {
  const period = getDashboardPeriod('7days', new Date('2026-10-23T06:00:00Z'));
  const bill = (id: string, date: string, total: number, extra: Partial<POSBill> = {}) => ({
    id, bill_number: id, date, subtotal: total, discount: 0, total, payment_mode: 'Cash', status: 'Completed', items: [], ...extra
  }) as POSBill;

  it('adds net sales per day and keeps running totals', () => {
    const rows = buildPerformanceSeries({
      sales: [
        bill('a', '2026-10-17T05:00:00Z', 1000),
        bill('b', '2026-10-17T19:30:00Z', 500), // already the 18th in Pakistan
        bill('c', '2026-10-23T03:00:00Z', 800, { refund_amount: 300 }),
        bill('d', '2026-10-12T05:00:00Z', 400),
        bill('e', '2026-10-20T05:00:00Z', 999, { status: 'Returned' })
      ],
      purchases: [], expenses: [], metric: 'sales', selectedProduct: '', period, range: '7days'
    });
    expect(rows).toHaveLength(7);
    expect(rows.map(r => r.current)).toEqual([1000, 500, 0, 0, 0, 0, 500]);
    expect(rows[6].currentTotal).toBe(2000);
    expect(rows[2].previous).toBe(400);
    expect(rows[6].previousTotal).toBe(400);
  });

  it('nets returned quantity and the bill discount for one product', () => {
    const rows = buildPerformanceSeries({
      sales: [bill('a', '2026-10-23T05:00:00Z', 900, {
        subtotal: 1000,
        items: [
          { name: 'Milk', qty: 4, price: 200, total: 800 },
          { name: 'Dahi', qty: 1, price: 200, total: 200 }
        ] as any,
        returned_items: [{ name: 'Milk', qty: 1 }]
      } as any)],
      purchases: [], expenses: [], metric: 'products', selectedProduct: 'Milk', period, range: '7days'
    });
    // 3 of 4 litres kept, at the bill's 10% discount: 600 x 0.9.
    expect(rows[6].current).toBe(540);
  });

  it('charts milk litres and expenses, skipping cancelled ones', () => {
    const purchases = [
      { id: 'p1', date: '2026-10-23', quantity: 120, status: 'Completed' },
      { id: 'p2', date: '2026-10-23', quantity: 50, status: 'Returned' }
    ] as PurchaseEntry[];
    const expenses = [
      { id: 'e1', date: '2026-10-22', amount: 700 },
      { id: 'e2', date: '2026-10-22', amount: 900, status: 'Cancelled' }
    ] as unknown as ExpenseEntry[];
    const milk = buildPerformanceSeries({ sales: [], purchases, expenses, metric: 'milk', selectedProduct: '', period, range: '7days' });
    const spend = buildPerformanceSeries({ sales: [], purchases, expenses, metric: 'expenses', selectedProduct: '', period, range: '7days' });
    expect(milk[6].current).toBe(120);
    expect(spend[5].current).toBe(700);
  });

  it('counts delivery supply as sales, like the sales card', () => {
    const supplies = [
      { date: '2026-10-23', total_amount: 600, status: 'Delivered' },
      { date: '2026-10-23', total_amount: 50, details: { status: 'Pending' } },
      { date: '2026-10-22', total_amount: 900, status: 'Cancelled' },
      { total_amount: 999, status: 'Delivered' }
    ];
    const rows = buildPerformanceSeries({
      sales: [bill('a', '2026-10-23T05:00:00Z', 1000)], purchases: [], expenses: [], supplies,
      metric: 'sales', selectedProduct: '', period, range: '7days'
    });
    expect(rows[6].current).toBe(1600);
    expect(rows[6].currentTotal).toBe(1600);
    const products = buildPerformanceSeries({
      sales: [], purchases: [], expenses: [], supplies, metric: 'products', selectedProduct: 'Milk', period, range: '7days'
    });
    expect(products[6].current).toBe(0);
    expect(isCountedSupply(supplies[0])).toBe(true);
    expect(isCountedSupply(supplies[1])).toBe(false);
    expect(isCountedSupply(supplies[3])).toBe(false);
  });

  it('leaves out records without a date instead of counting them as today', () => {
    const today = getDashboardPeriod('today', new Date());
    const rows = buildPerformanceSeries({
      sales: [bill('a', undefined as any, 1000), bill('b', '', 500)],
      purchases: [{ id: 'p', quantity: 40, status: 'Completed' } as PurchaseEntry],
      expenses: [{ id: 'e', amount: 300 } as unknown as ExpenseEntry],
      metric: 'sales', selectedProduct: '', period: today, range: 'today'
    });
    expect(rows.reduce((sum, r) => sum + r.current + r.previous, 0)).toBe(0);
    const milk = buildPerformanceSeries({
      sales: [], purchases: [{ id: 'p', quantity: 40, status: 'Completed' } as PurchaseEntry], expenses: [],
      metric: 'milk', selectedProduct: '', period: today, range: 'today'
    });
    expect(milk.reduce((sum, r) => sum + r.current, 0)).toBe(0);
  });

  it('charts every pack size of a product together', () => {
    const sales = [
      bill('a', '2026-10-23T05:00:00Z', 700, {
        subtotal: 700,
        items: [
          { name: 'Milk', qty: 2, price: 200, total: 400 },
          { name: 'Milk (1L Pouch)', qty: 1, price: 220, total: 220, variantId: 'pouch' },
          { name: 'Dahi', qty: 1, price: 80, total: 80, variantId: 'cup', variantName: 'Cup' }
        ] as any
      })
    ];
    expect(performanceProducts(sales)).toEqual(['Dahi', 'Milk']);
    const rows = buildPerformanceSeries({ sales, purchases: [], expenses: [], metric: 'products', selectedProduct: 'Milk', period, range: '7days' });
    expect(rows[6].current).toBe(620);
    // An older picker that still offers the pack name keeps working.
    const pack = buildPerformanceSeries({ sales, purchases: [], expenses: [], metric: 'products', selectedProduct: 'Milk (1L Pouch)', period, range: '7days' });
    expect(pack[6].current).toBe(220);
  });

  it('finds the product of a pack line', () => {
    expect(performanceProductName({ name: 'Milk (1L Pouch)', variantId: 'p1' })).toBe('Milk');
    expect(performanceProductName({ name: 'Eggs (Dozen)', variantName: 'Dozen' })).toBe('Eggs');
    expect(performanceProductName({ name: 'Kheer (Small) (Cup)', variantId: 'c' })).toBe('Kheer (Small)');
    expect(performanceProductName({ name: 'Yogurt (Plain)' })).toBe('Yogurt (Plain)');
    expect(performanceProductName({ name: 'Milk (Loose)', variantId: 'loose' })).toBe('Milk (Loose)');
    expect(performanceProductName({ name: '  Dahi ', variantId: 'cup', variantName: 'Cup' })).toBe('Dahi');
  });

  it('uses 48 half-hour slots for a single day', () => {
    const today = getDashboardPeriod('today', new Date('2026-10-23T06:00:00Z'));
    const rows = buildPerformanceSeries({
      sales: [bill('a', '2026-10-23T04:40:00Z', 250), bill('b', '2026-10-23', 100), bill('c', '2026-10-22T04:40:00Z', 75)],
      purchases: [], expenses: [], metric: 'sales', selectedProduct: '', period: today, range: 'today'
    });
    expect(rows).toHaveLength(48);
    expect(rows[19].current).toBe(250);
    expect(rows[24].current).toBe(100);
    expect(rows[19].previous).toBe(75);
  });
});
