import { describe, expect, it } from 'vitest';
import type { InventoryItem, InventoryLog, ItemDefinition } from '../../../types';
import { alertOf, buildStockRows, canSetOpening, countPiles, readPileCount, summarizeCounts } from '../inventoryStock';
import { buildItemHistory, describeLog, groupLogsByItem, historyTotals } from '../stockLog';

const item = (over: Partial<ItemDefinition>): ItemDefinition => ({
  id: 'it', name: 'Item', category: ['Sweets'], item_type: ['Sale product'], unit: 'kg', source: 'Production',
  cost_price: 400, selling_price: 600, reorder_level: 0, isActive: true, ...over,
});

const inv = (itemId: string, quantity: number, variant_stocks: Record<string, number> = {}): InventoryItem => ({
  id: `inv_${itemId}`, item_id: itemId, name: itemId, category: '', stock_type: 'Retail' as InventoryItem['stock_type'], quantity, unit: 'kg', price: 0, variant_stocks,
});

const kheer = item({
  id: 'kheer', name: 'Shahi Kheer', allow_loose_sale: false,
  variants: [
    { id: 'tub500', name: '500 g tub', quantity_in_base_unit: 0.5, selling_price: 320, isActive: true } as any,
    { id: 'tub1', name: '1 kg tub', quantity_in_base_unit: 1, selling_price: 620, isActive: false } as any,
    { id: 'dozen', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true, isActive: true } as any,
  ],
});

describe('buildStockRows', () => {
  it('lists every pile separately, hidden packs tagged, and stray counts apart', () => {
    const [row] = buildStockRows([kheer], [inv('kheer', 4, { tub500: 6, tub1: 2, dozen: 3 })]);
    expect(row.reading.totalBase).toBe(4 + 3 + 2);
    expect(row.piles).toEqual(['4 kg loose', '6 × 500 g tub', '2 × 1 kg tub (hidden)']);
    expect(row.stray).toEqual(['3 old Dozen (clear in stock count)']);
    expect(row.pileDetail).toBe(true);
    // Cost includes the hidden packs: 9 kg × 400.
    expect(row.reading.costValue).toBe(3600);
    // Retail: 4 kg × 600 + 6 × 320 + 2 × 620.
    expect(row.retailValue).toBe(2400 + 1920 + 1240);
    // Only active packs set the "from" price of a pack-only product.
    expect(row.fromPrice).toBe(320);
  });

  it('uses the shared status rule instead of a default reorder level of 5', () => {
    const plain = item({ id: 'dahi', name: 'Dahi', reorder_level: 0 });
    const [row] = buildStockRows([plain], [inv('dahi', 3)]);
    expect(row.status).toBe('ok');
    expect(alertOf(row)).toBeNull();
    expect(row.pileDetail).toBe(false);

    const [low] = buildStockRows([{ ...plain, reorder_level: 5 }], [inv('dahi', 3)]);
    expect(alertOf(low)).toBe('low');
  });

  it('marks minus stock and keeps inactive products out of the alerts', () => {
    const [minus] = buildStockRows([kheer], [inv('kheer', 0, { tub500: -107 })]);
    expect(minus.status).toBe('minus');
    expect(alertOf(minus)).toBe('out');

    const [inactive] = buildStockRows([{ ...kheer, isActive: false }], [inv('kheer', 0)]);
    expect(inactive.status).toBe('out');
    expect(alertOf(inactive)).toBeNull();
  });

  it('falls back to the catalogue copy when there is no inventory row', () => {
    const [row] = buildStockRows([item({ id: 'x', stock: 2.5 })], []);
    expect(row.loose).toBe(2.5);
    expect(row.invRecordId).toBe('');
  });
});

describe('stock count piles', () => {
  const [row] = buildStockRows([kheer], [inv('kheer', 4, { tub500: 6, tub1: 2, dozen: 3, gone: 1 })]);
  const piles = countPiles(row.reading);

  it('reaches loose, every pack (hidden included) and each stray count', () => {
    expect(piles.map(p => [p.id, p.kind, p.hidden])).toEqual([
      ['loose', 'loose', false],
      ['tub500', 'pack', false],
      ['tub1', 'pack', true],
      ['dozen', 'stray', true],
      ['gone', 'stray', true],
    ]);
  });

  it('leaves out an empty hidden pack', () => {
    const [empty] = buildStockRows([kheer], [inv('kheer', 4, { tub500: 6 })]);
    expect(countPiles(empty.reading).map(p => p.id)).toEqual(['loose', 'tub500']);
  });

  it('works out the difference per pile and in base units', () => {
    const tub = piles.find(p => p.id === 'tub500')!;
    expect(readPileCount(tub, '')).toMatchObject({ counted: null, diff: 0 });
    expect(readPileCount(tub, '4')).toMatchObject({ counted: 4, diff: -2, baseDiff: -1 });
    expect(readPileCount(tub, '4.5').error).toMatch(/poore/);
    const loose = piles[0];
    expect(readPileCount(loose, '3.25')).toMatchObject({ diff: -0.75, baseDiff: -0.75 });
    expect(readPileCount(loose, '-1').error).toBeTruthy();
  });

  it('only lets a stray count be cleared, and clearing it moves no stock', () => {
    const dozen = piles.find(p => p.id === 'dozen')!;
    expect(readPileCount(dozen, '2').error).toBeTruthy();
    expect(readPileCount(dozen, '0')).toMatchObject({ counted: 0, diff: -3, baseDiff: 0 });
  });

  it('sums only the piles that change', () => {
    const summary = summarizeCounts(piles, { loose: '4', tub500: '8', tub1: '0', dozen: '0' });
    expect(summary.changes.map(c => c.pile.id)).toEqual(['tub500', 'tub1', 'dozen']);
    expect(summary.baseDiff).toBe(1 - 2);
    expect(summary.errors).toBe(0);
  });

  it('offers opening stock only to an empty product without movements', () => {
    const [empty] = buildStockRows([kheer], [inv('kheer', 0)]);
    expect(canSetOpening(empty, false)).toBe(true);
    expect(canSetOpening(empty, true)).toBe(false);
    expect(canSetOpening(row, false)).toBe(false);
  });
});

describe('stock history', () => {
  const log = (over: Partial<InventoryLog>): InventoryLog => ({
    id: 'l', date: '2026-10-20T05:00:00Z', item_id: 'kheer', item_name: 'Shahi Kheer', old_quantity: 0, new_quantity: 0, difference: 0, reason: 'Sale', ...over,
  });

  it('reads every stored log shape into loose and pack moves', () => {
    const sale = describeLog(log({ difference: -1, details: { loose_delta: -1, variant_deltas: { tub500: -2 } } }), kheer);
    expect(sale.moves.map(m => [m.id, m.delta, m.kind])).toEqual([['loose', -1, 'loose'], ['tub500', -2, 'pack']]);
    expect(sale.baseDelta).toBe(-2);

    const oldCount = describeLog(log({ difference: 0, details: { variant_id: 'tub1', variant_delta: 3, loose_delta: 0 } }), kheer);
    expect(oldCount.moves).toEqual([{ id: 'tub1', name: '1 kg tub', delta: 3, unit: 'packs', kind: 'pack' }]);
    expect(oldCount.baseDelta).toBe(3);

    const clearDozen = describeLog(log({ details: { variant_deltas: { dozen: -3 } } }), kheer);
    expect(clearDozen.moves[0]).toMatchObject({ kind: 'stray', unit: 'old count' });
    expect(clearDozen.baseDelta).toBe(0);

    const plain = describeLog(log({ difference: 5, old_quantity: 1, new_quantity: 6, details: null }), kheer);
    expect(plain.moves).toEqual([{ id: 'loose', name: 'loose', delta: 5, unit: 'kg', kind: 'loose' }]);
  });

  const logs = [
    log({ id: 'a', date: '2026-10-18T05:00:00Z', reason: 'Opening Stock', old_quantity: 0, new_quantity: 10, difference: 10, details: { loose_delta: 10, variant_deltas: { tub500: 4 } } }),
    log({ id: 'c', date: '2026-10-21T05:00:00Z', old_quantity: 7, new_quantity: 7, difference: 0, details: { variant_deltas: { tub500: -2 } } }),
    log({ id: 'b', date: '2026-10-20T05:00:00Z', old_quantity: 10, new_quantity: 7, difference: -3, details: { loose_delta: -3 } }),
  ];

  it('gives each row the stock left after it, newest first', () => {
    // Today: 7 kg loose + 2 × 0.5 kg = 8 kg.
    const history = buildItemHistory(logs, kheer, { loose: 7, packs: { tub500: 2 } });
    expect(history.map(h => [h.log.id, h.baseDelta, h.balanceAfter])).toEqual([
      ['c', -1, 8],
      ['b', -3, 9],
      ['a', 12, 12],
    ]);
    expect(history[2].day).toBe('2026-10-18');
    expect(historyTotals(history)).toEqual({ stockIn: 12, stockOut: 4, net: 8 });
    expect(buildItemHistory(logs, kheer, null).every(h => h.balanceAfter === null)).toBe(true);
  });

  it('keeps old balances right when a later move wrote no log', () => {
    // 2 kg went missing after the last log: today's loose is 5, but each row keeps its recorded loose.
    const history = buildItemHistory(logs, kheer, { loose: 5, packs: { tub500: 2 } });
    expect(history.map(h => h.balanceAfter)).toEqual([8, 9, 12]);
  });

  it('works loose back from the deltas when a row has no recorded balance', () => {
    const bare = [log({ id: 'x', date: '2026-10-21T05:00:00Z', old_quantity: null as any, new_quantity: null as any, difference: -2, details: null })];
    expect(buildItemHistory(bare, kheer, { loose: 3, packs: {} })[0].balanceAfter).toBe(3);
  });

  it('groups logs by item', () => {
    const grouped = groupLogsByItem([log({ id: '1' }), log({ id: '2', item_id: 'x' }), log({ id: '3' })]);
    expect(grouped.get('kheer')?.map(l => l.id)).toEqual(['1', '3']);
    expect(grouped.get('x')?.length).toBe(1);
  });
});
