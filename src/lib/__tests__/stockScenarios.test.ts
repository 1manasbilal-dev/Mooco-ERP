/**
 * One product walked through its whole stock life, checking every shared rule at each step:
 * buy loose and ready-made packs → sell loose, dozen and packs → partial return → hide a pack that
 * still holds stock → a stock count that clears a stray dozen count → write-off. Then the stock-profit
 * report replays the same documents and logs. A second walk does the same for milk stocked in ml.
 * The rules are in docs/stock-model.md.
 */
import { describe, expect, it } from 'vitest';
import { StockType, type InventoryItem, type ItemDefinition } from '../../types';
import { calculateQuickEntry, getQuickPresets, stepQuickQuantity } from '../posQuickEntry';
import { getRetailMilkStock, litresToStockUnit } from '../retailMilkStock';
import { saleItemSnapshot } from '../saleSnapshot';
import {
  availableSellUnits,
  averageCostAfterIntake,
  reservedBaseQty,
  reservedPackQty,
  saleLineStock,
  stockOnHandBase,
} from '../sellUnits';
import { buildStockProfitReport, itemStockValue, returnedQtyForLine, type StockProfitSource } from '../stockProfit';
import {
  logBaseDelta,
  logStockDelta,
  pileBreakdown,
  readStock,
  sellableLabel,
  stockCountLines,
  stockCountMoves,
  stockCountsOf,
  type LogStockDelta,
} from '../stockRules';
import { cleanQty } from '../formatters';

type Row = Record<string, any>;

/** A tiny shop: the live piles of one product plus every stock log written, in the app's real log shapes. */
function openShop(item: Row) {
  const shop = { item, loose: 0, packs: {} as Record<string, number>, logs: [] as Row[] };
  const apply = (delta: LogStockDelta) => {
    shop.loose = cleanQty(shop.loose + delta.looseDelta);
    Object.entries(delta.packDeltas).forEach(([id, d]) => { shop.packs[id] = cleanQty((shop.packs[id] || 0) + d); });
  };
  const log = (id: string, date: string, reason: string, looseDelta: number, details: Row, notes = '') => {
    shop.logs.push({ id, date, item_id: item.id, item_name: item.name, old_quantity: shop.loose, new_quantity: cleanQty(shop.loose + looseDelta), difference: looseDelta, reason, notes, details });
  };
  return { shop, apply, log };
}

const read = (s: { item: Row; loose: number; packs: Record<string, number> }) => readStock(s.item, s.loose, s.packs);
const value = (s: { item: Row; loose: number; packs: Record<string, number> }) => itemStockValue(s.item, s.loose, s.packs);

/** Rebuild the piles from the logs alone. Stray counts were never logged when they appeared, so only real piles are compared. */
function replay(logs: Row[], realPacks: string[]) {
  let loose = 0;
  const packs: Record<string, number> = {};
  logs.forEach(row => {
    const d = logStockDelta(row);
    loose = cleanQty(loose + d.looseDelta);
    Object.entries(d.packDeltas).forEach(([id, x]) => { if (realPacks.includes(id)) packs[id] = cleanQty((packs[id] || 0) + x); });
  });
  return { loose, packs };
}

describe('stock scenario: eggs sold loose, by the dozen and in ready-made packs', () => {
  const variants = [
    { id: 'dz', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true, selling_price: 280, isActive: true },
    { id: 'p6', name: 'Pack of 6', quantity_in_base_unit: 6, deduct_from_base: false, selling_price: 140, isActive: true },
    { id: 't30', name: 'Tray 30', quantity_in_base_unit: 30, deduct_from_base: false, selling_price: 700, isActive: true },
  ];
  const { shop, apply, log } = openShop({
    id: 'egg', name: 'Eggs', unit: 'pcs', item_type: ['Sale product'], cost_price: 0, selling_price: 25,
    allow_loose_sale: true, reorder_level: 60, is_active: true, variants,
  });
  const realPacks = ['p6', 't30'];
  const materialPurchases: Row[] = [];
  let sale: Row = {};

  it('0. a new product with no stock is out of stock and alerts', () => {
    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 0, sellableBase: 0, costValue: 0, status: 'out', alert: true });
    expect(sellableLabel(r)).toBe('0 pcs');
    expect(pileBreakdown(r)).toEqual([]);
  });

  it('1. buying loose pieces and ready-made packs fills each pile and averages the cost over everything on hand', () => {
    // 120 loose pieces at Rs 18.
    let cost = averageCostAfterIntake(stockOnHandBase(shop.loose, shop.packs, variants), shop.item.cost_price, 120, 2160);
    expect(cost).toBe(18);
    apply({ looseDelta: 120, packDeltas: {} });
    log('log_purch_1', '2026-10-01T04:00:00Z', 'Purchase', 120, { loose_delta: 120, purchase_id: 'mp1' });
    materialPurchases.push({ id: 'mp1', date: '2026-10-01T04:00:00Z', item_id: 'egg', item_name: 'Eggs', quantity: 120, unit: 'pcs', rate: 18, total_amount: 2160, conversion_factor: 1, status: 'Completed', details: { stocked_as: 'loose' } });

    // 10 ready-made packs of 6 at Rs 120 a pack: they go to the pack pile, counted in packs.
    cost = averageCostAfterIntake(stockOnHandBase(shop.loose, shop.packs, variants), cost, 60, 1200);
    expect(cost).toBe(18.6667);
    apply({ looseDelta: 0, packDeltas: { p6: 10 } });
    log('log_purch_2', '2026-10-01T05:00:00Z', 'Purchase', 0, { variant_id: 'p6', variant_delta: 10, loose_delta: 0, purchase_id: 'mp2' });
    materialPurchases.push({ id: 'mp2', date: '2026-10-01T05:00:00Z', item_id: 'egg', item_name: 'Eggs', quantity: 10, unit: 'Pack of 6', rate: 120, total_amount: 1200, conversion_factor: 6, status: 'Completed', details: { variant_id: 'p6', stocked_as: 'packs' } });

    // 2 trays of 30 at Rs 570.
    cost = averageCostAfterIntake(stockOnHandBase(shop.loose, shop.packs, variants), cost, 60, 1140);
    expect(cost).toBe(18.75);
    apply({ looseDelta: 0, packDeltas: { t30: 2 } });
    log('log_purch_3', '2026-10-01T06:00:00Z', 'Purchase', 0, { variant_id: 't30', variant_delta: 2, loose_delta: 0, purchase_id: 'mp3' });
    materialPurchases.push({ id: 'mp3', date: '2026-10-01T06:00:00Z', item_id: 'egg', item_name: 'Eggs', quantity: 2, unit: 'Tray 30', rate: 570, total_amount: 1140, conversion_factor: 30, status: 'Completed', details: { variant_id: 't30', stocked_as: 'packs' } });
    shop.item.cost_price = cost;

    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 240, sellableBase: 240, costValue: 4500, status: 'ok', alert: false });
    expect(value(shop)).toMatchObject({ totalBaseQty: 240, packedBaseQty: 120, costValue: 4500 });
    expect(sellableLabel(r)).toBe('240 pcs');
    expect(pileBreakdown(r)).toEqual(['120 pcs loose', '10 × Pack of 6', '2 × Tray 30']);
    expect(r.piles.find(p => p.id === 'dz')).toMatchObject({ kind: 'multi', count: 10, baseQty: 0 });
    expect(availableSellUnits(shop.loose, 0, variants[0])).toBe(10);
    expect(availableSellUnits(shop.loose, shop.packs.p6, variants[1])).toBe(10);
    expect(replay(shop.logs, realPacks)).toEqual({ loose: shop.loose, packs: shop.packs });
  });

  it('2. one bill sells loose pieces, dozens (from loose) and packs (from their own count)', () => {
    const cart = [
      { id: 'egg', itemId: 'egg', cartItemId: 'egg_base', name: 'Eggs', qty: 10, price: 25, unit: 'pcs', isLoose: true, deductFromBase: true, stockDeduction: 1, image_url: 'x', variants },
      { id: 'egg', itemId: 'egg', cartItemId: 'egg_dz', name: 'Eggs', qty: 2, price: 280, unit: 'Dozen', variantId: 'dz', variantName: 'Dozen', stockDeduction: 12, deductFromBase: true },
      { id: 'egg', itemId: 'egg', cartItemId: 'egg_p6', name: 'Eggs', qty: 3, price: 140, unit: 'Pack of 6', variantId: 'p6', variantName: 'Pack of 6', stockDeduction: 6, deductFromBase: false },
    ];
    // Cart guards: loose + dozens share loose stock; packs only their own pile.
    expect(reservedBaseQty(cart, 'egg')).toBe(34);
    expect(reservedBaseQty(cart, 'egg', 'egg_dz', shop.item)).toBe(10);
    expect(reservedPackQty(cart, 'egg', 'p6')).toBe(3);
    expect(reservedPackQty(cart, 'egg', 't30')).toBe(0);

    const lines = saleItemSnapshot(cart);
    expect(lines[0]).not.toHaveProperty('variants');
    expect(lines.map(l => [l.variantId, l.deductFromBase, l.stockDeduction])).toEqual([[undefined, true, 1], ['dz', true, 12], ['p6', false, 6]]);
    const delta: LogStockDelta = { looseDelta: 0, packDeltas: {} };
    lines.forEach(line => {
      const move = saleLineStock(line, shop.item);
      if (move.fromBase) delta.looseDelta = cleanQty(delta.looseDelta - move.stockQty);
      else delta.packDeltas[move.variantId!] = cleanQty((delta.packDeltas[move.variantId!] || 0) - move.stockQty);
    });
    expect(delta).toEqual({ looseDelta: -34, packDeltas: { p6: -3 } });
    apply(delta);
    log('log_s1_egg', '2026-10-02T06:00:00Z', 'Sale', -34, { loose_delta: -34, variant_deltas: { p6: -3 }, sale_id: 's1' });
    sale = { id: 's1', bill_number: 'B1', date: '2026-10-02T06:00:00Z', status: 'Completed', total: 1230, subtotal: 1230, items: lines };

    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 188, sellableBase: 188, costValue: 3525, status: 'ok' });
    expect(value(shop).costValue).toBe(r.costValue);
    expect(pileBreakdown(r)).toEqual(['86 pcs loose', '7 × Pack of 6', '2 × Tray 30']);
    expect(logBaseDelta(logStockDelta(shop.logs.at(-1)!), variants)).toBe(-52);
  });

  it('3. a partial return goes back to the pile each line was sold from', () => {
    // The return entries do not repeat the line snapshot; the sold line fills it in.
    const returned = [
      { itemId: 'egg', name: 'Eggs', qty: 1, price: 280, variantId: 'dz', returnDate: '2026-10-03T06:00:00Z', action: 'refund', restock: 'restock' },
      { itemId: 'egg', name: 'Eggs', qty: 1, price: 140, variantId: 'p6', returnDate: '2026-10-03T06:00:00Z', action: 'refund', restock: 'restock' },
    ];
    sale = { ...sale, status: 'Partially Returned', refund_amount: 420, returned_items: returned };
    expect(returnedQtyForLine(sale, sale.items[1], 1)).toBe(1);
    expect(returnedQtyForLine(sale, sale.items[2], 2)).toBe(1);
    expect(returnedQtyForLine(sale, sale.items[0], 0)).toBe(0);

    returned.forEach((ret, i) => {
      const sold = sale.items.find((l: Row) => l.variantId === ret.variantId);
      const move = saleLineStock({ ...ret, isLoose: sold.isLoose, stockDeduction: sold.stockDeduction, deductFromBase: sold.deductFromBase }, shop.item);
      if (move.fromBase) {
        apply({ looseDelta: move.stockQty, packDeltas: {} });
        log(`log_ret_${i}`, ret.returnDate, 'Sales Return', move.stockQty, { loose_delta: move.stockQty });
      } else {
        apply({ looseDelta: 0, packDeltas: { [move.variantId!]: move.stockQty } });
        log(`log_ret_${i}`, ret.returnDate, 'Sales Return', 0, { variant_id: move.variantId, variant_delta: move.stockQty, loose_delta: 0 });
      }
    });
    expect([shop.loose, shop.packs]).toEqual([98, { p6: 8, t30: 2 }]);
    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 206, sellableBase: 206, costValue: 3862.5 });
    expect(replay(shop.logs, realPacks)).toEqual({ loose: shop.loose, packs: shop.packs });
  });

  it('4. a hidden pack that still holds stock stays on hand, valued and countable, but not sellable', () => {
    shop.item.variants = variants.map(v => v.id === 't30' ? { ...v, isActive: false } : v);
    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 206, sellableBase: 146, costValue: 3862.5, status: 'ok' });
    expect(r.hiddenPacks.map(p => p.id)).toEqual(['t30']);
    expect(pileBreakdown(r)).toEqual(['98 pcs loose', '8 × Pack of 6', '2 × Tray 30 (hidden)']);
    expect(sellableLabel(r)).toBe('146 pcs');
    // itemStockValue values the hidden tray exactly like readStock.
    const v = value(shop);
    expect(v.costValue).toBe(r.costValue);
    expect(v.totalBaseQty).toBe(r.totalBase);
    expect(v.packs.find(p => p.id === 't30')).toMatchObject({ count: 2, isActive: false, costValue: 1125 });
    expect(stockCountLines(r).map(l => [l.id, l.current, l.hidden])).toEqual([['loose', 98, false], ['p6', 8, false], ['t30', 2, true]]);
  });

  it('5. a stray count left on the dozen is shown, worth nothing, and cleared by a stock count', () => {
    shop.packs.dz = 3; // An old bug once stored a count on the dozen.
    let r = read(shop);
    expect(r.strayCounts.map(p => [p.id, p.count])).toEqual([['dz', 3]]);
    expect(r).toMatchObject({ totalBase: 206, costValue: 3862.5 });
    expect(value(shop).costValue).toBe(3862.5);
    expect(pileBreakdown(r).at(-1)).toBe('3 old Dozen (clear in stock count)');
    expect(r.warnings.some(w => w.includes('Old Dozen count of 3'))).toBe(true);
    expect(stockCountLines(r).at(-1)).toMatchObject({ id: 'dz', kind: 'stray', current: 3 });

    // The counter counts 97 loose (one broke) and leaves the stray number as it was typed: it still clears.
    const moves = stockCountMoves(r, { loose: 97, packs: { p6: 8, t30: 2, dz: 3 } });
    expect(moves).toEqual({ looseDelta: -1, packDeltas: { dz: -3 } });
    apply(moves);
    log('log_count_1', '2026-10-05T10:00:00Z', 'Stock Count Correction', -1, { loose_delta: -1, variant_deltas: moves.packDeltas });

    r = read(shop);
    expect(r.strayCounts).toEqual([]);
    expect(r).toMatchObject({ totalBase: 205, sellableBase: 145, costValue: 3843.75, status: 'ok' });
    expect(readStock({ ...shop.item, reorder_level: 205 }, shop.loose, shop.packs).status).toBe('low');
    // The count's base move ignores the dozen: clearing a stray count moves no stock.
    expect(logBaseDelta(logStockDelta(shop.logs.at(-1)!), shop.item.variants)).toBe(-1);
  });

  it('6. a write-off zeroes every positive pile, hidden pack included', () => {
    const r = read(shop);
    const off = r.piles.filter(p => (p.kind === 'loose' || p.kind === 'packed') && p.count > 0);
    off.forEach(p => {
      if (p.kind === 'loose') {
        apply({ looseDelta: -p.count, packDeltas: {} });
        log('log_wo_loose', '2026-10-06T10:00:00Z', 'Spoilage / Wastage', -p.count, { loose_delta: -p.count });
      } else {
        apply({ looseDelta: 0, packDeltas: { [p.id]: -p.count } });
        log(`log_wo_${p.id}`, '2026-10-06T10:00:00Z', 'Spoilage / Wastage', 0, { variant_id: p.id, variant_delta: -p.count, loose_delta: 0 });
      }
    });
    const after = read(shop);
    expect(after).toMatchObject({ totalBase: 0, sellableBase: 0, costValue: 0, status: 'out' });
    expect(value(shop)).toMatchObject({ totalBaseQty: 0, costValue: 0 });
    expect(replay(shop.logs, realPacks)).toEqual({ loose: 0, packs: { p6: 0, t30: 0 } });
  });

  const profitSource = (): StockProfitSource => ({
    items: [{ ...shop.item, stock: shop.loose, variant_stocks: { ...shop.packs } }],
    sales: [sale], purchases: [], materialPurchases, allocations: [], productionBatches: [], dailySupplyEntries: [],
    expenses: [], inventoryLogs: shop.logs, supplierTransactions: [], retailClosings: [],
  });

  it('7. the stock-profit report replays the same story with per-pile costs and no loose drift', () => {
    const report = buildStockProfitReport(profitSource(), '2026-10-01', '2026-10-20');
    expect(report.issues.map(i => i.code)).toEqual([]);
    expect(report.grossPurchases).toBe(4500);
    expect(report.posSales).toBe(1230);
    expect(report.salesReturns).toBe(420);
    expect(report.closingStock).toBe(0);
    expect(report.consumedCost).toBe(4500);
    // Count loss: 1 piece at Rs 18. Write-off: 97 pieces at 18, 8 packs at 120, 2 trays at 570.
    expect(report.stockLoss).toBe(18 + 1746 + 960 + 1140);
    // The stray dozen count never became a stock row.
    expect(report.rows.some(r => r.id.endsWith(':dz'))).toBe(false);

    const midway = buildStockProfitReport(profitSource(), '2026-10-01', '2026-10-05');
    expect(midway.closingStock).toBe(97 * 18 + 8 * 120 + 2 * 570);
    expect(midway.rows.map(r => [r.id, r.closingQty, r.closingRate])).toEqual(expect.arrayContaining([
      ['item:egg:loose', 97, 18], ['item:egg:p6', 8, 120], ['item:egg:t30', 2, 570],
    ]));
  });
});

describe('stock scenario: milk stocked in millilitres', () => {
  const milk = {
    id: 'mmilk', name: 'Mixed Milk', unit: 'ml', item_type: ['Sale product'], category: ['Milk'], source: 'Production',
    cost_price: 0.15, selling_price: 0.22, allow_loose_sale: true, reorder_level: 2000, isActive: true,
    variants: [
      { id: 'glass', name: '250 ml glass', quantity_in_base_unit: 250, deduct_from_base: true, selling_price: 50, isActive: true },
      { id: 'pouch', name: '1 L pouch', quantity_in_base_unit: 1000, deduct_from_base: false, selling_price: 210, isActive: true },
    ],
  };
  const { shop, apply } = openShop(milk);
  const counter = () => getRetailMilkStock(
    [{ id: 'inv_mmilk', item_id: 'mmilk', name: 'Mixed Milk', category: 'Milk', stock_type: StockType.RETAIL_STOCK, quantity: shop.loose, unit: 'ml', price: 0.22, variant_stocks: shop.packs } as InventoryItem],
    [milk as unknown as ItemDefinition],
  );

  it('allocating litres from the pool lands as ml, and the counter card shows litres', () => {
    const ml = litresToStockUnit(10, milk.unit);
    expect(ml).toBe(10000);
    apply({ looseDelta: ml!, packDeltas: {} });
    const r = read(shop);
    expect(r).toMatchObject({ unit: 'ml', totalBase: 10000, costValue: 1500, status: 'ok' });
    expect(sellableLabel(r)).toBe('10,000 ml');
    expect(counter()).toMatchObject({ liters: 10, totalValue: 2200, totalCostValue: 1500, avgRate: 220 });
    // A kg product can never take litres.
    expect(litresToStockUnit(10, 'kg')).toBeNull();
  });

  it('packing pouches moves loose ml into the pouch pile without changing the total', () => {
    apply({ looseDelta: -2000, packDeltas: { pouch: 2 } });
    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 10000, costValue: 1500 });
    expect(pileBreakdown(r)).toEqual(['8,000 ml loose', '2 × 1 L pouch']);
    // The counter card is loose milk only.
    expect(counter().liters).toBe(8);
  });

  it('glasses come out of loose ml; a rupee amount buys fractional ml; quick steps are 250 ml', () => {
    expect(availableSellUnits(shop.loose, 0, milk.variants[0])).toBe(32);
    const glasses = saleLineStock({ qty: 4, variantId: 'glass', stockDeduction: 250, deductFromBase: true }, milk);
    expect(glasses).toMatchObject({ fromBase: true, stockQty: 1000 });
    const entry = calculateQuickEntry('100', 'amount', milk.selling_price, false);
    expect(entry).toEqual({ qty: 454.545, total: 100, error: '' });
    apply({ looseDelta: -cleanQty(glasses.stockQty + entry.qty), packDeltas: {} });
    expect(shop.loose).toBe(6545.455);
    expect(stepQuickQuantity(entry.qty, 1, 'ml')).toBe(500);
    expect(stepQuickQuantity(500, -1, 'ml')).toBe(250);
    expect(stepQuickQuantity(250, -1, 'ml')).toBe(250);
    expect(getQuickPresets({ mode: 'qty', packaged: false, unit: 'ml', rate: 0.22 })[0]).toBe(250);
  });

  it('counter milk sent to production leaves in ml; totals, value and alerts follow', () => {
    apply({ looseDelta: -litresToStockUnit(2, milk.unit)!, packDeltas: {} });
    const r = read(shop);
    expect(r).toMatchObject({ totalBase: 6545.455, status: 'ok' });
    expect(r.costValue).toBe(981.82);
    expect(readStock({ ...milk, reorder_level: 7000 }, shop.loose, shop.packs).status).toBe('low');
    expect(counter()).toMatchObject({ liters: 4.545, totalValue: 999.9, totalCostValue: 681.75 });
  });

  it('the stock-profit report moves pool litres into the ml pile at the right size', () => {
    const report = buildStockProfitReport({
      items: [{ ...milk, stock: 9000, variant_stocks: {} }],
      purchases: [{ id: 'p1', date: '2026-10-01', milk_type: 'Mixed', quantity: 10, rate: 150, total_amount: 1500, status: 'Completed' }],
      materialPurchases: [],
      allocations: [{ id: 'a1', purchase_id: 'p1', milk_type: 'Mixed', original_quantity: 10, allocated_quantity: 10, remaining_quantity: 0, allocation_history: [{ destination: 'Retail Counter', quantity: 10, allocated_at: '2026-10-01T05:00:00Z' }] }],
      productionBatches: [], dailySupplyEntries: [], expenses: [], supplierTransactions: [], retailClosings: [],
      inventoryLogs: [
        { id: 'log_alloc_a1', date: '2026-10-01T05:00:00Z', item_id: 'mmilk', item_name: 'Mixed Milk', difference: 10000, reason: 'Allocation', notes: 'Allocated to Counter from Tank (Purchase #p1)' },
        { id: 'log_s1_mmilk', date: '2026-10-02T06:00:00Z', item_id: 'mmilk', item_name: 'Mixed Milk', difference: -1000, reason: 'Sale' },
      ],
      sales: [{ id: 's1', bill_number: 'B1', date: '2026-10-02T06:00:00Z', total: 200, items: [{ itemId: 'mmilk', name: 'Mixed Milk', qty: 4, price: 50, variantId: 'glass', stockDeduction: 250, deductFromBase: true }] }],
    }, '2026-10-01', '2026-10-20');
    expect(report.issues.map(i => i.code)).toEqual([]);
    expect(report.rows).toEqual([expect.objectContaining({ id: 'item:mmilk:loose', closingQty: 9000, closingValue: 1350 })]);
    expect(report.consumedCost).toBe(150);
  });
});

describe('stock logs the app has written over time', () => {
  it('keeps the loose part of a server day-close count that only counted its pack moves in the notes', () => {
    const dayClose = { difference: -2, old_quantity: 50, new_quantity: 48, notes: 'Day Close Stock Count (bd_1) · 1 variant adjustment(s)', details: null };
    expect(logStockDelta(dayClose)).toEqual({ looseDelta: -2, packDeltas: {}, unrecordedPacks: true });
    expect(logStockDelta({ ...dayClose, difference: 0, notes: 'Day Close Stock Count (bd_1) — no difference' })).toEqual({ looseDelta: 0, packDeltas: {} });
  });

  it('never posts an old pack audit (pack count in the loose columns) to loose stock', () => {
    expect(logStockDelta({ difference: 4, notes: 'Variant Audit' })).toEqual({ looseDelta: 0, packDeltas: {}, unrecordedPacks: true });
    // Today's pack audit names its pack in details.
    expect(logStockDelta({ difference: 0, notes: 'Variant Audit: Pack of 6 2 → 6 packs', details: { variant_id: 'p6', variant_delta: 4, loose_delta: 0 } })).toEqual({ looseDelta: 0, packDeltas: { p6: 4 } });
  });

  it('reads a null loose_delta as missing, not as zero', () => {
    expect(logStockDelta({ difference: -3, details: { loose_delta: null } }).looseDelta).toBe(-3);
    expect(logStockDelta({ old_quantity: 10, new_quantity: 7.5 }).looseDelta).toBe(-2.5);
  });

  it('posts the loose part of a day-close count in the stock-profit report and warns about its packs', () => {
    const report = buildStockProfitReport({
      items: [{ id: 'dahi', name: 'Dahi', unit: 'kg', stock: 8, cost_price: 200, variants: [{ id: 'tub', name: 'Tub', quantity_in_base_unit: 0.5 }], variant_stocks: { tub: 0 } }],
      purchases: [], materialPurchases: [{ id: 'm1', date: '2026-10-01T04:00:00Z', item_id: 'dahi', item_name: 'Dahi', quantity: 10, rate: 200, total_amount: 2000, status: 'Completed' }],
      allocations: [], productionBatches: [], dailySupplyEntries: [], expenses: [], supplierTransactions: [], retailClosings: [], sales: [],
      inventoryLogs: [{ id: 'log_dayclose_bd1_dahi', date: '2026-10-02T20:00:00Z', item_id: 'dahi', item_name: 'Dahi', old_quantity: 10, new_quantity: 8, difference: -2, reason: 'Stock Count Correction', notes: 'Day Close Stock Count (bd1) · 1 variant adjustment(s)' }],
    }, '2026-10-01', '2026-10-20');
    expect(report.closingStock).toBe(1600);
    expect(report.stockLoss).toBe(400);
    expect(report.issues.map(i => i.code)).toContain('variant_log');
    expect(report.issues.map(i => i.code)).not.toContain('opening_history');
  });
});

describe('opening stock in the stock-profit report', () => {
  it('books opening stock as an intake into each pile at cost, without counting it as a purchase', () => {
    const report = buildStockProfitReport({
      items: [{ id: 'dahi', name: 'Dahi', unit: 'kg', stock: 5, cost_price: 200, variants: [{ id: 'tub', name: '500 g tub', quantity_in_base_unit: 0.5 }], variant_stocks: { tub: 4 } }],
      purchases: [], materialPurchases: [], allocations: [], productionBatches: [], dailySupplyEntries: [], expenses: [], supplierTransactions: [], retailClosings: [], sales: [],
      inventoryLogs: [{ id: 'log_open', date: '2026-10-01T04:00:00Z', item_id: 'dahi', item_name: 'Dahi', old_quantity: 0, new_quantity: 5, difference: 5, reason: 'Opening Stock', notes: 'Opening stock', details: { loose_delta: 5, variant_deltas: { tub: 4 } } }],
    }, '2026-10-01', '2026-10-20');
    expect(report.issues.map(i => i.code)).toEqual([]);
    expect(report.grossPurchases).toBe(0);
    expect(report.closingStock).toBe(5 * 200 + 4 * 100);
    expect(report.stockAdjustments).toBe(1400);
    expect(report.consumedCost).toBe(0);
    expect(report.rows.map(r => [r.id, r.closingQty])).toEqual(expect.arrayContaining([['item:dahi:loose', 5], ['item:dahi:tub', 4]]));
  });
});

describe('stockCountsOf', () => {
  it('takes the live inventory row first and the catalog row for anything it lacks', () => {
    expect(stockCountsOf({ stock: 5, variant_stocks: { a: 1 } }, { quantity: 7, variant_stocks: { a: 2 } })).toEqual({ loose: 7, variantStocks: { a: 2 } });
    expect(stockCountsOf({ stock: 5, variant_stocks: { a: 1 } }, { quantity: 7, variant_stocks: {} })).toEqual({ loose: 7, variantStocks: { a: 1 } });
    expect(stockCountsOf({ stock: 5 }, null)).toEqual({ loose: 5, variantStocks: {} });
  });
});
