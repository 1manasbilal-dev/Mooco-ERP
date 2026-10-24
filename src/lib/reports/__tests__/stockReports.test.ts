import { describe, expect, it } from 'vitest';
import { inventoryReports } from '../definitions/inventory';
import { financialReports } from '../definitions/financial';
import { describeLogMoves, itemStock, logMoves } from '../helpers';
import type { ReportData, ReportFilters, ReportResult, ReportRow } from '../types';
import { readStock } from '../../stockRules';
import { itemStockValue } from '../../stockProfit';
import { getDashboardPeriod } from '../../dashboardAnalytics';
import {
  indexItems, operationalAlerts, ordersShortOfStock, stockAlertDetail, stockAlertSummary, summariseMilkFlow,
} from '../../../components/dashboard/dashboardData';
import type { CustomerOrder, InventoryItem, InventoryLog, ItemDefinition } from '../../../types';

/* Sample catalog: one product of every stock shape the app has. */

const variant = (id: string, name: string, size: number, extra: Record<string, unknown> = {}) =>
  ({ id, name, quantity_in_base_unit: size, packaging_item_id: '', packaging_qty: 0, isActive: true, deduct_from_base: false, ...extra });

const item = (fields: Partial<ItemDefinition> & { id: string; name: string; unit: string }): ItemDefinition => ({
  category: ['Dairy'], item_type: ['Sale product'], cost_price: 0, selling_price: 0, isActive: true, isSystem: false,
  source: 'Both', reorder_level: 0, variants: [], variant_stocks: {}, ...fields,
} as ItemDefinition);

/** Loose + an active pack + a hidden pack still holding stock. 4 + 6 × 0.5 + 2 × 1 = 9 kg, reorder 10 → low. */
const paneer = item({
  id: 'paneer', name: 'Paneer', unit: 'kg', cost_price: 1000, selling_price: 1400, reorder_level: 10, stock: 4,
  variants: [variant('tub500', '500 g tub', 0.5, { selling_price: 750 }), variant('tub1kg', '1 kg tub', 1, { isActive: false })],
  variant_stocks: { tub500: 6, tub1kg: 2 },
});
/** Multi-units (dozen, tray) sell loose stock; an old count left on the dozen is not stock. */
const eggs = item({
  id: 'eggs', name: 'Egg', unit: 'pcs', cost_price: 25, selling_price: 30, reorder_level: 10, stock: 74,
  variants: [variant('dozen', 'Dozen', 12, { deduct_from_base: true }), variant('tray', 'Tray', 30, { deduct_from_base: true })],
  variant_stocks: { dozen: -1.5 },
});
/** Milk stocked in ml: 2500 ml with a 5000 ml reorder level → low. */
const cowMilk = item({ id: 'cow', name: 'Cow Milk', unit: 'ml', cost_price: 0.2, selling_price: 0.24, reorder_level: 5000, stock: 2500 });
/** Pack-only product with a negative pack pile → minus. */
const badam = item({
  id: 'badam', name: 'Badam Doodh', unit: 'kg', cost_price: 400, selling_price: 600, reorder_level: 10, stock: 10, allow_loose_sale: false,
  variants: [variant('bottle', 'Badam Doodh Bottle', 0.25)], variant_stocks: { bottle: -26 },
});
/** Inactive product still holding packs: valued, never alerted. */
const rusk = item({
  id: 'rusk', name: 'Special Rusk', unit: 'kg', cost_price: 300, selling_price: 400, reorder_level: 10, stock: 0, isActive: false,
  variants: [variant('rusk500', 'Rusk 500 g', 0.5)], variant_stocks: { rusk500: 3 },
});
/** Nothing on hand, no reorder level → out. */
const butter = item({ id: 'butter', name: 'Butter', unit: 'kg', cost_price: 900, selling_price: 1200, reorder_level: 0, stock: 0 });
/** Raw material above its reorder level → ok. */
const sugar = item({ id: 'sugar', name: 'Sugar', unit: 'kg', item_type: ['Raw material'], cost_price: 150, reorder_level: 20, stock: 50 });

const items = [paneer, eggs, cowMilk, badam, rusk, butter, sugar];

const inventoryRow = (i: ItemDefinition): InventoryItem => ({
  id: `inv_${i.id}`, item_id: i.id, name: i.name, category: 'Dairy', stock_type: 'Retail Stock' as any,
  quantity: Number(i.stock) || 0, unit: i.unit, price: i.selling_price, variant_stocks: { ...(i.variant_stocks || {}) },
});

function reportData(extra: Partial<ReportData> = {}): ReportData {
  return {
    sales: [], purchases: [], materialPurchases: [], suppliers: [], supplierTransactions: [], allocations: [],
    inventory: items.map(inventoryRow), items, customers: [], customerTransactions: [], dailySupplyEntries: [],
    productionBatches: [], expenses: [], expenseVendors: [], expenseVendorTransactions: [], accounts: [], bankTransactions: [],
    inventoryLogs: [], retailClosings: [], shiftSessions: [], cashVariances: [], cashRemittances: [], settings: {} as any,
    today: '2026-10-24', ...extra,
  };
}

const filters: ReportFilters = { from: '2026-10-01', to: '2026-10-24', groupBy: 'day' };
const run = (id: string, data: ReportData, f: ReportFilters = filters): ReportResult => {
  const def = [...inventoryReports, ...financialReports].find(r => r.id === id);
  if (!def) throw new Error(`No report ${id}`);
  return def.build(data, f);
};
const table = (result: ReportResult, id: string) => result.tables!.find(t => t.id === id)!.rows;
const kpi = (result: ReportResult, key: string) => result.kpis!.find(k => k.key === key)!.value;
const rowOf = (rows: ReportRow[], name: string) => rows.find(r => String(r.item).startsWith(name))!;
const reading = (i: ItemDefinition) => readStock(i, Number(i.stock) || 0, i.variant_stocks);

describe('stock figures in reports follow readStock', () => {
  it('itemStock counts and values every pile like readStock: hidden packs in, negatives at 0, stray counts out', () => {
    const data = reportData();
    items.forEach(i => {
      const figures = itemStock(data, i);
      const r = reading(i);
      expect(figures.totalBaseQty).toBe(r.totalBase);
      expect(figures.costValue).toBe(r.costValue);
      expect(figures.reading.status).toBe(r.status);
    });
    expect(itemStock(data, paneer).totalBaseQty).toBe(9);
    expect(itemStock(data, paneer).costValue).toBe(9000);
    expect(itemStock(data, badam).costValue).toBe(4000); // 10 kg loose; −26 bottles valued at 0
    expect(itemStock(data, eggs).costValue).toBe(1850); // the −1.5 dozen count is not stock
  });

  it('values items without hidden packs exactly like itemStockValue', () => {
    const data = reportData();
    [eggs, cowMilk, badam, butter, sugar].forEach(i => {
      expect(itemStock(data, i).costValue).toBe(itemStockValue(i as any, Number(i.stock) || 0, i.variant_stocks || {}).costValue);
    });
  });

  it('reads loose and pack counts from the live inventory row first', () => {
    const data = reportData({ inventory: items.map(i => (i.id === 'paneer' ? { ...inventoryRow(i), quantity: 1, variant_stocks: { tub500: 2 } } : inventoryRow(i))) });
    expect(itemStock(data, paneer).totalBaseQty).toBe(2); // 1 + 2 × 0.5; the hidden tub has no live count
  });
});

describe('Stock Valuation and Balance Sheet', () => {
  it('shows every pile, includes inactive stock and agrees with the balance sheet', () => {
    const data = reportData();
    const result = run('stock_valuation', data);
    const rows = table(result, 'items');
    const expected = items.filter(i => i.isActive !== false || reading(i).totalBase !== 0).reduce((s, i) => s + reading(i).costValue, 0);
    expect(kpi(result, 'cost')).toBe(expected);
    expect(rowOf(rows, 'Paneer')).toMatchObject({ total: 9, sellable: 7, cost: 9000, unit: 'kg', piles: '4 kg loose · 6 × 500 g tub · 2 × 1 kg tub (hidden)' });
    expect(rowOf(rows, 'Cow Milk')).toMatchObject({ total: 2500, unit: 'ml', cost: 500 });
    expect(rowOf(rows, 'Egg').piles).toBe('74 pcs loose · -1.5 old Dozen (clear in stock count)');
    expect(rowOf(rows, 'Egg')._tone).toBe('warn');
    expect(rowOf(rows, 'Badam Doodh')._tone).toBe('bad');
    expect(rowOf(rows, 'Special Rusk').item).toBe('Special Rusk (inactive)');
    expect(rowOf(rows, 'Special Rusk').cost).toBe(450);
    expect(result.notes!.some(n => n.text.includes('hidden packs'))).toBe(true);
    // A raw material with no selling price is stock at cost, not a "loss" of its whole cost.
    expect(rowOf(rows, 'Sugar')).toMatchObject({ cost: 7500, retail: null, profit: null });
    expect(kpi(result, 'profit')).toBe(rows.reduce((s, r) => s + (Number(r.profit) || 0), 0));

    const sheet = run('balance_snapshot', data);
    expect(kpi(sheet, 'stock')).toBe(kpi(result, 'cost'));
  });
});

describe('one low-stock rule: Low Stock report and dashboard card', () => {
  it('lists exactly the active products readStock does not call ok', () => {
    const data = reportData();
    const rows = table(run('low_stock', data), 'reorder');
    const expected = items.filter(i => i.isActive !== false && reading(i).status !== 'ok').map(i => i.name).sort();
    expect(rows.map(r => r.item).sort()).toEqual(expected);
    expect(expected).toEqual(['Badam Doodh', 'Butter', 'Cow Milk', 'Paneer']);
    expect(rowOf(rows, 'Badam Doodh').status).toBe('Minus');
    expect(rowOf(rows, 'Butter').status).toBe('Out');
    expect(rowOf(rows, 'Paneer')).toMatchObject({ stock: 9, sellable: 7, reorder: 10, shortfall: 1 });
    expect(rowOf(rows, 'Cow Milk')).toMatchObject({ stock: 2500, unit: 'ml', reorder: 5000, shortfall: 2500 });
  });

  it('dashboard counts the same products, skips inactive ones and counts packs', () => {
    const data = reportData();
    const lowRows = table(run('low_stock', data), 'reorder');
    const summary = stockAlertSummary(data.inventory, indexItems(items));
    expect(summary.count).toBe(lowRows.length);
    expect(summary).toMatchObject({ minus: 1, out: 1, low: 2 });
    expect(stockAlertDetail(summary)).toBe('1 minus · 1 out of stock · 2 low');
    const alert = operationalAlerts({ unallocatedLiters: 0, stock: summary, inTransit: 0, unpaidExpenses: 0 })[0];
    expect(alert).toMatchObject({ id: 'stock', tone: 'danger', module: 'inventory' });
  });

  it('names the product when only one needs attention', () => {
    const only = [paneer, sugar];
    const summary = stockAlertSummary(only.map(inventoryRow), indexItems(only));
    expect(stockAlertDetail(summary)).toBe('Paneer is low on stock');
    expect(operationalAlerts({ unallocatedLiters: 0, stock: summary, inTransit: 0, unpaidExpenses: 0 })[0].tone).toBe('warning');
  });
});

/* Stock logs in every shape the app has written. */

const log = (fields: Partial<InventoryLog> & { id: string; item_id: string; reason: string }): InventoryLog => ({
  date: '2026-10-20T08:00:00Z', item_name: items.find(i => i.id === fields.item_id)?.name || '', old_quantity: 0, new_quantity: 0, difference: 0, ...fields,
});

const logs: InventoryLog[] = [
  // details.variant_deltas (sales, production, write-off)
  log({ id: 'l1', item_id: 'paneer', reason: 'Spoilage / Wastage', old_quantity: 4, new_quantity: 3, difference: -1, details: { loose_delta: -1, variant_deltas: { tub500: -2 } } }),
  // details.variant_id + variant_delta (counts, purchases, returns)
  log({ id: 'l2', item_id: 'paneer', reason: 'Stock Count Correction', old_quantity: 3, new_quantity: 3, details: { variant_id: 'tub1kg', variant_delta: 1, loose_delta: 0 } }),
  // no details: loose only
  log({ id: 'l3', item_id: 'cow', reason: 'Internal Consumption', old_quantity: 2500, new_quantity: 2000, difference: -500 }),
  // old pack audit, product with one pack: the bottle count moved, not kg
  log({ id: 'l4', item_id: 'badam', reason: 'Data Entry Error', old_quantity: -30, new_quantity: -26, difference: 4, notes: 'Variant Audit' }),
  // old pack audit, product with two packs: pack unknown
  log({ id: 'l5', item_id: 'paneer', reason: 'Data Entry Error', old_quantity: 10, new_quantity: 8, difference: -2, notes: 'Variant Audit' }),
  // day close, pack pile (no details; the pile is in the row id)
  log({ id: 'log_cnt_close1_paneer_tub500', item_id: 'paneer', reason: 'Stock Count Correction', old_quantity: 9, new_quantity: 6, difference: -3, notes: 'Shift Closing (Morning)' }),
  // day close, loose pile
  log({ id: 'log_cnt_close1_paneer_loose', item_id: 'paneer', reason: 'Stock Count Correction', old_quantity: 3, new_quantity: 3.25, difference: 0.25 }),
  // opening stock: an intake, not an adjustment
  log({ id: 'l8', item_id: 'butter', reason: 'Opening Stock', old_quantity: 0, new_quantity: 2, difference: 2, details: { loose_delta: 2, variant_deltas: {} } }),
  log({ id: 'l9', item_id: 'paneer', reason: 'Opening Stock', old_quantity: 0, new_quantity: 4, difference: 4, details: { loose_delta: 4, variant_deltas: { tub500: 6 } } }),
  // a sale of packs (bills give "sold"; the pack table reads the log)
  log({ id: 'l10', item_id: 'paneer', reason: 'Sale', details: { loose_delta: 0, variant_deltas: { tub500: -1 } } }),
];

describe('stock logs are read pile by pile', () => {
  const moves = (id: string) => {
    const row = logs.find(l => l.id === id)!;
    const owner = items.find(i => i.id === row.item_id);
    return { m: logMoves(row, owner), owner };
  };

  it('reads all three details shapes with packs × size', () => {
    expect(moves('l1').m.baseDelta).toBe(-2);
    expect(describeLogMoves(moves('l1').m, paneer)).toBe('−1 kg loose · −2 × 500 g tub');
    expect(moves('l2').m.baseDelta).toBe(1);
    expect(describeLogMoves(moves('l2').m, paneer)).toBe('+1 × 1 kg tub (hidden)');
    expect(moves('l3').m).toMatchObject({ baseDelta: -500, looseColumns: true });
  });

  it('recovers old pack audits and day-close pack rows that saved no pack details', () => {
    expect(moves('l4').m).toMatchObject({ looseDelta: 0, packDeltas: { bottle: 4 }, baseDelta: 1, looseColumns: false });
    expect(moves('l5').m).toMatchObject({ looseDelta: 0, unknownPackDelta: -2, baseDelta: 0 });
    expect(describeLogMoves(moves('l5').m, paneer)).toBe('−2 packs (pack size not saved)');
    expect(moves('log_cnt_close1_paneer_tub500').m).toMatchObject({ looseDelta: 0, packDeltas: { tub500: -3 }, baseDelta: -1.5 });
    expect(moves('log_cnt_close1_paneer_loose').m).toMatchObject({ looseDelta: 0.25, baseDelta: 0.25, looseColumns: true });
  });

  it('Stock Adjustments values base moves and leaves flows and opening stock out', () => {
    const result = run('stock_adjustments', reportData({ inventoryLogs: logs }));
    const rows = table(result, 'logs');
    expect(rows).toHaveLength(7); // l1-l5 and both day-close rows; opening stock and the sale are flows
    const byNotes = (fn: (r: ReportRow) => boolean) => rows.find(fn)!;
    const spoil = byNotes(r => r.reason === 'Spoilage / Wastage');
    // Rows that moved a pack saved mixed things in old/new, so those columns only show for loose-only rows.
    expect(spoil).toMatchObject({ diff: -2, value: -2000, loss: 2000, change: '−1 kg loose · −2 × 500 g tub', old: null, new: null });
    expect(byNotes(r => r.item === 'Cow Milk')).toMatchObject({ old: 2500, new: 2000 });
    const dayClosePack = byNotes(r => r.notes === 'Shift Closing (Morning)');
    expect(dayClosePack).toMatchObject({ diff: -1.5, change: '−3 × 500 g tub', old: null, new: null });
    expect(byNotes(r => r.item === 'Cow Milk')).toMatchObject({ diff: -500, unit: 'ml', value: -100 });
    expect(byNotes(r => r.item === 'Badam Doodh')).toMatchObject({ diff: 1, value: 400, change: '+4 × Badam Doodh Bottle' });
    expect(result.notes!.some(n => n.text.includes('did not save which pack'))).toBe(true);
  });

  it('Item Movement shows opening stock as an intake and pack moves per pack size', () => {
    const result = run('item_movement', reportData({ inventoryLogs: logs }));
    const rows = table(result, 'items');
    expect(rowOf(rows, 'Butter')).toMatchObject({ opening: 2, net: 2 });
    // Paneer opening: 4 kg loose + 6 × 0.5 kg; adjustments: −2 + 1 + 0 (unknown) − 1.5 + 0.25
    expect(rowOf(rows, 'Paneer')).toMatchObject({ opening: 7, adjusted: -2.25, stock: 9 });
    const packs = table(result, 'packs');
    const tub = packs.find(r => r.item === 'Paneer' && r.pack === '500 g tub')!;
    expect(tub).toMatchObject({ size: '0.5 kg', in: 6, out: 6, net: 0, now: 6 }); // in: opening 6; out: spoil 2 + day close 3 + sale 1
    expect(packs.find(r => r.pack === '1 kg tub (hidden)')).toMatchObject({ in: 1, out: 0, now: 2 });
    expect(packs.find(r => r.item === 'Badam Doodh')).toMatchObject({ in: 4, now: -26, _tone: 'bad' });
  });
});

describe('dashboard stock helpers', () => {
  it('converts counter allocation logs of an ml milk item to litres', () => {
    const period = getDashboardPeriod('today', new Date('2026-10-20T10:00:00Z'));
    const allocation = { id: 'a1', date: '2026-10-20T08:00:00Z', item_id: 'cow', item_name: 'Cow Milk', reason: 'Allocation', difference: 1500 };
    const flow = summariseMilkFlow([allocation], [], [], period, indexItems(items));
    expect(flow.retailAllocated).toBe(1.5);
  });

  it('adds one order\'s lines per pile and lets earlier orders take stock first', () => {
    const order = (id: string, due: string, lines: CustomerOrder['items']): CustomerOrder =>
      ({ id, order_number: id, customer_id: id, customer_name: id, customer_phone: '', fulfillment: 'Pickup', due_date: due, due_time: '', address: '', notes: '', items: lines } as unknown as CustomerOrder);
    const index = indexItems(items);
    const inventory = items.map(inventoryRow);
    // 60 eggs loose + 1 tray (30 eggs) = 90 > 74 on hand, though each line alone fits.
    const eggsOrder = order('A', '2026-10-24', [
      { itemId: 'eggs', name: 'Egg', qty: 60, price: 30, unit: 'pcs' },
      { itemId: 'eggs', name: 'Egg', qty: 1, price: 900, unit: 'pcs', variantId: 'tray' },
    ]);
    expect(ordersShortOfStock([eggsOrder], inventory, index)).toEqual({ short: [eggsOrder], missing: 'Egg' });
    // 6 tubs on hand: the earlier order takes 4, the later one can't get 4 more.
    const first = order('B', '2026-10-24', [{ itemId: 'paneer', name: 'Paneer tub', qty: 4, price: 750, unit: 'pcs', variantId: 'tub500' }]);
    const second = order('C', '2026-10-25', [{ itemId: 'paneer', name: 'Paneer tub', qty: 4, price: 750, unit: 'pcs', variantId: 'tub500' }]);
    expect(ordersShortOfStock([second, first], inventory, index).short.map(o => o.id)).toEqual(['C']);
    // The hidden 1 kg tub can't be sold, though it holds 2.
    const hidden = order('D', '2026-10-24', [{ itemId: 'paneer', name: 'Paneer 1 kg', qty: 1, price: 1400, unit: 'pcs', variantId: 'tub1kg' }]);
    expect(ordersShortOfStock([hidden], inventory, index).short).toHaveLength(1);
  });
});
