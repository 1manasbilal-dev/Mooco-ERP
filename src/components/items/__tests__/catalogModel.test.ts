import { describe, expect, it } from 'vitest';
import type { InventoryItem, ItemDefinition } from '../../../types';
import { readStock } from '../../../lib/stockRules';
import {
  buildCatalogRows, canTakeOpeningStock, checkOpeningStock, countOnUnit, filterAndSort, pilesHoldingStock, readyMadePacks,
  type CatalogQuery,
} from '../catalogModel';

const dahi: ItemDefinition = {
  id: 'dahi',
  name: 'Dahi',
  category: ['Yogurt'],
  item_type: ['Sale product'],
  unit: 'kg',
  cost_price: 150,
  selling_price: 200,
  source: 'Production',
  isActive: true,
  reorder_level: 10,
  variants: [
    { id: 'v_half', name: '500 g tub', quantity_in_base_unit: 0.5, deduct_from_base: false, isActive: true, packaging_item_id: '', packaging_qty: 0 },
    { id: 'v_kg', name: '1 kg tub', quantity_in_base_unit: 1, deduct_from_base: false, isActive: false, packaging_item_id: '', packaging_qty: 0 },
    { id: 'v_pao', name: 'Pao', quantity_in_base_unit: 0.25, deduct_from_base: true, isActive: true, packaging_item_id: '', packaging_qty: 0 },
  ],
};

const inv = (item_id: string, quantity: number, variant_stocks: Record<string, number> = {}) =>
  ({ id: `inv_${item_id}`, item_id, name: item_id, quantity, variant_stocks }) as unknown as InventoryItem;

const query = (stock: CatalogQuery['stock']): CatalogQuery => ({
  search: '', type: 'All', category: 'All', status: 'All', stock, sortField: 'name', sortOrder: 'asc',
});

describe('buildCatalogRows', () => {
  it('reads stock with the shared rule: hidden packs count, different sizes are never summed as "packs"', () => {
    const row = buildCatalogRows([dahi], [inv('dahi', 4, { v_half: 6, v_kg: 2 })]).get('dahi')!;
    expect(row.totalBase).toBe(9);
    expect(row.sellable).toBe(7);
    expect(row.alert).toBe('low');
    expect(row.breakdown).toEqual(['4 kg loose', '6 × 500 g tub', '2 × 1 kg tub (hidden)']);
    expect(row.costValue).toBe(1350);
  });

  it('treats reorder level 0 as no alert instead of falling back to 5', () => {
    const row = buildCatalogRows([{ ...dahi, reorder_level: 0 }], [inv('dahi', 3)]).get('dahi')!;
    expect(row.reorder).toBe(0);
    expect(row.alert).toBeNull();
  });

  it('gives inactive products no alert and files minus stock under out', () => {
    const rows = buildCatalogRows(
      [dahi, { ...dahi, id: 'old', name: 'Old dahi', isActive: false }, { ...dahi, id: 'neg', name: 'Neg dahi' }],
      [inv('dahi', 0), inv('old', 0), inv('neg', -2, { v_half: 40 })],
    );
    expect(rows.get('dahi')!.alert).toBe('out');
    expect(rows.get('old')!.alert).toBeNull();
    expect(rows.get('neg')!.alert).toBe('minus');
    const out = filterAndSort(Array.from(rows.values()), query('out')).map(r => r.item.id);
    expect(out).toEqual(['dahi', 'neg']);
  });
});

describe('opening stock', () => {
  it('keeps only filled piles and adds packs at their size', () => {
    const check = checkOpeningStock({ loose: '4.5', packs: { v_half: '12', v_kg: '', v_pao: '9' } }, dahi.variants);
    expect(check.firstError).toBe('');
    // Pao is a multi-unit: it never holds its own count, so its field is ignored.
    expect(check.piles).toEqual({ loose: 4.5, packs: { v_half: 12 } });
    expect(check.totalBase).toBe(10.5);
    expect(check.isEmpty).toBe(false);
  });

  it('refuses negative stock and part packs', () => {
    const check = checkOpeningStock({ loose: '-1', packs: { v_half: '2.5' } }, dahi.variants);
    expect(check.errors.loose).toBeTruthy();
    expect(check.errors.packs.v_half).toBeTruthy();
    expect(check.isEmpty).toBe(true);
    expect(checkOpeningStock({ loose: '', packs: {} }, dahi.variants).isEmpty).toBe(true);
  });

  it('is offered on a saved product only with every pile at 0 and no stock log', () => {
    expect(canTakeOpeningStock(readStock(dahi, 0, {}), false)).toBe(true);
    expect(canTakeOpeningStock(readStock(dahi, 0, {}), true)).toBe(false);
    expect(canTakeOpeningStock(readStock(dahi, 0, { v_kg: 1 }), false)).toBe(false);
    // A stray count on a multi-unit is still a number on the product.
    expect(canTakeOpeningStock(readStock(dahi, 0, { v_pao: 3 }), false)).toBe(false);
  });
});

describe('setup locks', () => {
  it('lists only ready-made packs as own-count piles', () => {
    expect(readyMadePacks(dahi.variants).map(v => v.id)).toEqual(['v_half', 'v_kg']);
  });

  it('sees stock on any pile, including a hidden pack, but not on a multi-unit view', () => {
    expect(pilesHoldingStock(readStock(dahi, 0, {}))).toBe(false);
    expect(pilesHoldingStock(readStock(dahi, 0, { v_kg: 2 }))).toBe(true);
    expect(pilesHoldingStock(readStock(dahi, -0.5, {}))).toBe(true);
    expect(countOnUnit({ v_half: 6.0004 }, 'v_half')).toBe(6);
    expect(countOnUnit({ v_half: 6 }, undefined)).toBe(0);
  });
});
