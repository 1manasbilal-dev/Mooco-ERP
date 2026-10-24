import { describe, expect, it } from 'vitest';
import { saleItemSnapshot } from '../saleSnapshot';

describe('saleItemSnapshot', () => {
  it('drops heavy catalog fields from saved bill lines', () => {
    const [line] = saleItemSnapshot([{ id: 'milk', name: 'Milk', qty: 2, price: 220, image_url: 'data:...', quick_amounts: [50], variants: [{}], variant_stocks: {} }]);
    expect(line).not.toHaveProperty('image_url');
    expect(line).not.toHaveProperty('variants');
    expect(line).toMatchObject({ itemId: 'milk', name: 'Milk', qty: 2, price: 220, total: 440, unit: 'Unit' });
  });

  it('rounds a computed line total to the paisa', () => {
    expect(saleItemSnapshot([{ id: 'x', qty: 3, price: 1.1 }])[0].total).toBe(3.3);
    expect(saleItemSnapshot([{ id: 'x', qty: 0.5, price: 20.15 }])[0].total).toBe(10.08);
  });

  it('keeps an explicit total or an amount-entry total', () => {
    expect(saleItemSnapshot([{ id: 'x', qty: 0.357, price: 280, total: 100 }])[0].total).toBe(100);
    expect(saleItemSnapshot([{ id: 'x', qty: 0.357, price: 280, customTotal: 100 }])[0].total).toBe(100);
  });

  it('always records the stock pile of a pack line', () => {
    const [dozen, packed, legacy, loose] = saleItemSnapshot([
      { id: 'egg', qty: 1, price: 280, variantId: 'dz', variantName: 'Dozen', stockDeduction: 12, deductFromBase: true },
      { id: 'egg', qty: 1, price: 110, variantId: 'p6', variantName: 'Pack of 6', stockDeduction: 6, deductFromBase: false },
      { id: 'egg', qty: 1, price: 110, variantId: 'p6', stockDeduction: 6 },
      { id: 'egg', qty: 3, price: 25 }
    ]);
    expect(dozen).toMatchObject({ deductFromBase: true, stockDeduction: 12, unit: 'Dozen' });
    expect(packed).toMatchObject({ deductFromBase: false, stockDeduction: 6 });
    expect(legacy.deductFromBase).toBe(false);
    expect(legacy.unit).toBe('Pack');
    expect(loose.deductFromBase).toBeUndefined();
    expect(loose.stockDeduction).toBeUndefined();
  });

  it("reads 'base' / 'loose' and loose-marked lines as the loose pile", () => {
    const [base, marked] = saleItemSnapshot([
      { id: 'milk', qty: 2, price: 220, variantId: 'base' },
      { id: 'egg', qty: 1, price: 25, variantId: 'gone', isLoose: true }
    ]);
    expect(base).toMatchObject({ variantId: undefined, unit: 'Unit' });
    expect(base.deductFromBase).toBeUndefined();
    expect(marked).toMatchObject({ variantId: 'gone', isLoose: true, deductFromBase: true });
  });

  it('returns an empty list for anything that is not a list', () => {
    expect(saleItemSnapshot(null as any)).toEqual([]);
  });
});
