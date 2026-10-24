import { describe, expect, it } from 'vitest';
import { logBaseDelta, logStockDelta, pileBreakdown, readStock, sellableLabel, stockCountLines, stockCountMoves } from '../stockRules';

const dahi = {
  name: 'Dahi',
  unit: 'kg',
  cost_price: 150,
  selling_price: 200,
  allow_loose_sale: true,
  reorder_level: 10,
  variants: [
    { id: 'v_half', name: '500 g tub', quantity_in_base_unit: 0.5, deduct_from_base: false },
    { id: 'v_kg', name: '1 kg tub', quantity_in_base_unit: 1, deduct_from_base: false, isActive: false },
    { id: 'v_dozen', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true },
  ],
};

describe('readStock', () => {
  it('counts every physical pile, hidden packs included, and flags stray multi-unit counts', () => {
    const r = readStock(dahi, 4, { v_half: 6, v_kg: 2, v_dozen: 3 });
    expect(r.totalBase).toBe(9); // 4 loose + 6 × 0.5 + 2 × 1 (hidden)
    expect(r.sellableBase).toBe(7); // hidden 1 kg tubs can't be sold
    expect(r.status).toBe('low'); // 9 <= reorder 10
    expect(r.hiddenPacks.map(p => p.id)).toEqual(['v_kg']);
    expect(r.strayCounts.map(p => p.id)).toEqual(['v_dozen']);
    expect(pileBreakdown(r)).toEqual(['4 kg loose', '6 × 500 g tub', '2 × 1 kg tub (hidden)', '3 old Dozen (clear in stock count)']);
  });

  it('treats a missing or zero reorder level as no alert and any negative pile as minus', () => {
    expect(readStock({ ...dahi, reorder_level: 0 }, 1, {}).status).toBe('ok');
    expect(readStock(dahi, -2, { v_half: 40 }).status).toBe('minus');
    expect(readStock(dahi, 0, {}).status).toBe('out');
  });

  it('labels a pack-only product by its single pack type, never by summing pack sizes', () => {
    const packOnly = { ...dahi, allow_loose_sale: false, variants: dahi.variants.slice(0, 2).map(v => ({ ...v, isActive: true })) };
    expect(sellableLabel(readStock(packOnly, 0, { v_half: 8 }))).toBe('8 500 g tub');
    expect(sellableLabel(readStock(packOnly, 0, { v_half: 8, v_kg: 2 }))).toBe('6 kg');
  });
});

describe('alerts and stock counts', () => {
  it('raises alerts only for active products', () => {
    expect(readStock(dahi, 0, {})).toMatchObject({ status: 'out', alert: true, isActive: true });
    expect(readStock({ ...dahi, is_active: false }, 0, {})).toMatchObject({ status: 'out', alert: false, isActive: false });
    expect(readStock({ ...dahi, isActive: false }, 20, {}).alert).toBe(false);
    expect(readStock(dahi, 20, {}).alert).toBe(false);
  });

  it('moves only the piles that were counted, ignores unknown ids and clears stray counts', () => {
    const r = readStock(dahi, 4, { v_half: 6, v_kg: 2, v_dozen: 3 });
    expect(stockCountLines(r).map(l => [l.id, l.kind, l.current])).toEqual([
      ['loose', 'loose', 4], ['v_half', 'packed', 6], ['v_kg', 'packed', 2], ['v_dozen', 'stray', 3],
    ]);
    expect(stockCountMoves(r, { packs: { v_kg: 0, nope: 5 } })).toEqual({ looseDelta: 0, packDeltas: { v_kg: -2 } });
    expect(stockCountMoves(r, { loose: 4.5, packs: { v_half: 6, v_dozen: 7 } })).toEqual({ looseDelta: 0.5, packDeltas: { v_dozen: -3 } });
    expect(stockCountMoves(r, { loose: null })).toEqual({ looseDelta: 0, packDeltas: {} });
  });
});

describe('logStockDelta', () => {
  it('reads all three log shapes', () => {
    expect(logStockDelta({ difference: -2.5 })).toEqual({ looseDelta: -2.5, packDeltas: {} });
    expect(logStockDelta({ difference: 0, details: { variant_id: 'v_half', variant_delta: 4 } })).toEqual({ looseDelta: 0, packDeltas: { v_half: 4 } });
    const sale = logStockDelta({ difference: -1, details: { loose_delta: -1, variant_deltas: { v_half: -2, v_kg: 0 } } });
    expect(sale).toEqual({ looseDelta: -1, packDeltas: { v_half: -2 } });
    expect(logBaseDelta(sale, dahi.variants)).toBe(-2);
  });
});
