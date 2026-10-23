import { describe, expect, it } from 'vitest';
import { buildStockProfitReport, itemStockValue, returnedQtyForLine, type StockProfitSource } from '../stockProfit';

/** 100 L buffalo milk bought at Rs 150 on 1 Oct, all sent to the counter, 30 L sold at Rs 240. */
const source = (patch: Partial<StockProfitSource> = {}): StockProfitSource => ({
  items: [{ id: 'buf', name: 'Buffalo Milk', unit: 'L', stock: 70, cost_price: 150, selling_price: 240, variants: [] }],
  purchases: [{ id: 'p1', date: '2026-10-01', milk_type: 'Buffalo', quantity: 100, rate: 150, total_amount: 15000, status: 'Completed' }],
  materialPurchases: [],
  allocations: [{
    id: 'a1', purchase_id: 'p1', milk_type: 'Buffalo', original_quantity: 100, allocated_quantity: 100, remaining_quantity: 0,
    allocation_history: [{ destination: 'Retail Counter', quantity: 100, allocated_at: '2026-10-01T05:00:00Z' }]
  }],
  productionBatches: [],
  dailySupplyEntries: [],
  expenses: [
    { id: 'e1', date: '2026-10-03', amount: 500, category: 'Electricity' },
    { id: 'e2', date: '2026-10-04', amount: 900, category: 'Fuel', status: 'Cancelled' }
  ],
  inventoryLogs: [
    // POS writes one 'Sale' log per bill line; the invoice owns the stock movement.
    { id: 'log_s1_buf', date: '2026-10-02T06:00:00Z', item_id: 'buf', item_name: 'Buffalo Milk', difference: -10, reason: 'Sale' }
  ],
  supplierTransactions: [],
  retailClosings: [],
  sales: [
    { id: 's1', bill_number: 'B1', date: '2026-10-02T06:00:00Z', total: 2400, items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 10, price: 240 }] },
    { id: 's2', bill_number: 'B2', date: '2026-10-05T19:30:00Z', total: 4800, items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 20, price: 240 }] }
  ],
  ...patch
});

describe('buildStockProfitReport', () => {
  it('charges sold milk at its purchase cost for the whole month', () => {
    const report = buildStockProfitReport(source(), '2026-10-01', '2026-10-20');
    expect(report.validRange).toBe(true);
    expect(report.openingStock).toBe(0);
    expect(report.grossPurchases).toBe(15000);
    expect(report.closingStock).toBe(10500);
    expect(report.consumedCost).toBe(4500);
    expect(report.netSales).toBe(7200);
    expect(report.grossProfit).toBe(2700);
    expect(report.expenses).toBe(500);
    expect(report.netProfit).toBe(2200);
    expect(report.issues.map(i => i.code)).toEqual([]);
    expect(report.rows).toEqual([expect.objectContaining({ id: 'item:buf:loose', openingQty: 0, closingQty: 70, closingRate: 150, closingValue: 10500 })]);
  });

  it('opens a later period with the stock left after earlier movements', () => {
    const report = buildStockProfitReport(source(), '2026-10-03', '2026-10-20');
    expect(report.openingStock).toBe(13500);
    expect(report.grossPurchases).toBe(0);
    // s2 was billed at 19:30 UTC on the 5th: 00:30 on the 6th in Pakistan, still inside the range.
    expect(report.posSales).toBe(4800);
    expect(report.consumedCost).toBe(3000);
    expect(report.netProfit).toBe(1300);
  });

  it('keeps stock and value unchanged for a period with no movements', () => {
    const report = buildStockProfitReport(source(), '2026-10-10', '2026-10-20');
    expect(report.openingStock).toBe(10500);
    expect(report.closingStock).toBe(10500);
    expect(report.consumedCost).toBe(0);
    expect(report.movements).toEqual([]);
  });

  it('puts the PKT day boundary at midnight Pakistan time', () => {
    const onlyFifth = buildStockProfitReport(source(), '2026-10-05', '2026-10-05');
    expect(onlyFifth.posSales).toBe(0);
    const onlySixth = buildStockProfitReport(source(), '2026-10-06', '2026-10-06');
    expect(onlySixth.posSales).toBe(4800);
  });

  it('reverses a good customer return at the original sold cost', () => {
    const report = buildStockProfitReport(source({
      items: [{ id: 'buf', name: 'Buffalo Milk', unit: 'L', stock: 75, cost_price: 150, selling_price: 240, variants: [] }],
      sales: [
        { id: 's1', bill_number: 'B1', date: '2026-10-02T06:00:00Z', total: 2400, items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 10, price: 240 }] },
        {
          id: 's2', bill_number: 'B2', date: '2026-10-05T19:30:00Z', total: 4800, refund_amount: 1200,
          items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 20, price: 240 }],
          returned_items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 5, price: 240, returnDate: '2026-10-07', action: 'refund', restock: 'restock' }]
        }
      ]
    }), '2026-10-01', '2026-10-20');
    expect(report.salesReturns).toBe(1200);
    expect(report.netSales).toBe(6000);
    expect(report.closingStock).toBe(75 * 150);
    expect(report.consumedCost).toBe(25 * 150);
    expect(report.issues.map(i => i.code)).toEqual([]);
  });

  it('does not restock a scrapped return', () => {
    const report = buildStockProfitReport(source({
      sales: [
        { id: 's1', bill_number: 'B1', date: '2026-10-02T06:00:00Z', total: 2400, items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 10, price: 240 }] },
        {
          id: 's2', bill_number: 'B2', date: '2026-10-05T19:30:00Z', total: 4800, refund_amount: 1200,
          items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 20, price: 240 }],
          returned_items: [{ itemId: 'buf', name: 'Buffalo Milk', qty: 5, price: 240, returnDate: '2026-10-07', action: 'refund', restock: 'scrap_spoilage' }]
        }
      ]
    }), '2026-10-01', '2026-10-20');
    expect(report.salesReturns).toBe(1200);
    expect(report.closingStock).toBe(10500);
  });

  it('flags data problems instead of claiming an exact profit', () => {
    const report = buildStockProfitReport(source({
      inventoryLogs: [{ id: 'log_unknown_buf', date: '2026-10-02', item_id: 'buf', item_name: 'Buffalo Milk', difference: -1, reason: 'Sale' }],
      pendingCount: 2
    }), '2026-10-01', '2026-10-20');
    const codes = report.issues.map(i => i.code);
    expect(codes).toContain('orphan_sale_log');
    expect(codes).toContain('pending_sync');
  });

  it('rejects a reversed range', () => {
    const report = buildStockProfitReport(source(), '2026-10-20', '2026-10-01');
    expect(report.validRange).toBe(false);
    expect(report.issues.map(i => i.code)).toContain('invalid_range');
    expect(report.netSales).toBe(0);
  });
});

describe('itemStockValue', () => {
  const eggs = {
    id: 'egg', stock: 10, cost_price: 20, selling_price: 25,
    variants: [
      { id: 'dz', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true },
      { id: 'p6', name: 'Pack of 6', quantity_in_base_unit: 6, selling_price: 110 },
      { id: 'old', name: 'Old pack', quantity_in_base_unit: 30, isActive: false }
    ],
    variant_stocks: { dz: 99, p6: 2, old: 4 }
  };

  it('values loose plus active packed stock, ignoring dozen views', () => {
    const value = itemStockValue(eggs);
    expect(value.packs.map(p => p.id)).toEqual(['p6']);
    expect(value.packedBaseQty).toBe(12);
    expect(value.totalBaseQty).toBe(22);
    expect(value.costValue).toBe(10 * 20 + 2 * 120);
    expect(value.retailValue).toBe(10 * 25 + 2 * 110);
    expect(value.costMissing).toBe(false);
  });

  it('shows negative stock but values it at zero', () => {
    const value = itemStockValue(eggs, -5, { p6: -1 });
    expect(value.totalBaseQty).toBe(-11);
    expect(value.costValue).toBe(0);
    expect(value.retailValue).toBe(0);
  });

  it('flags stock without a cost price', () => {
    expect(itemStockValue({ ...eggs, cost_price: 0 }).costMissing).toBe(true);
    expect(itemStockValue({ ...eggs, cost_price: 0 }, 0, {}).costMissing).toBe(false);
  });
});

describe('returnedQtyForLine', () => {
  const milk = (qty: number) => ({ itemId: 'milk', name: 'Milk', qty, price: 220 });
  const dahi = { itemId: 'dahi', name: 'Dahi', qty: 1, price: 260 };

  it('spreads an unindexed return over same-item lines in bill order', () => {
    const sale = { items: [milk(2), dahi, milk(3)], returned_items: [{ itemId: 'milk', qty: 4 }] };
    expect(returnedQtyForLine(sale, sale.items[0], 0)).toBe(2);
    expect(returnedQtyForLine(sale, sale.items[2], 2)).toBe(2);
    expect(returnedQtyForLine(sale, sale.items[1], 1)).toBe(0);
  });

  it('gives an indexed return to its own line', () => {
    const sale = { items: [milk(2), dahi, milk(3)], details: { returned_items: [{ itemId: 'milk', qty: 1, lineIndex: 2 }] } };
    expect(returnedQtyForLine(sale, sale.items[0], 0)).toBe(0);
    expect(returnedQtyForLine(sale, sale.items[2], 2)).toBe(1);
  });

  it('does not lose a return saved with a null or out-of-range line index', () => {
    const nullIndex = { items: [dahi, milk(3)], returned_items: [{ itemId: 'milk', qty: 1, lineIndex: null }] };
    expect(returnedQtyForLine(nullIndex, nullIndex.items[1], 1)).toBe(1);
    const outOfRange = { items: [dahi, milk(3)], returned_items: [{ itemId: 'milk', qty: 2, lineIndex: 7 }] };
    expect(returnedQtyForLine(outOfRange, outOfRange.items[1], 1)).toBe(2);
  });

  it('ignores replacements and keeps pack sizes apart', () => {
    const sale = {
      items: [{ itemId: 'egg', name: 'Eggs', qty: 2, variantId: 'dz' }, { itemId: 'egg', name: 'Eggs', qty: 5 }],
      returned_items: [
        { itemId: 'egg', qty: 1, variantId: 'dz' },
        { itemId: 'egg', qty: 3, action: 'replace' },
        { itemId: 'egg', qty: 2 }
      ]
    };
    expect(returnedQtyForLine(sale, sale.items[0], 0)).toBe(1);
    expect(returnedQtyForLine(sale, sale.items[1], 1)).toBe(2);
  });
});
