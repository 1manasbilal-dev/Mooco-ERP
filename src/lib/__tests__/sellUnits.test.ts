import { describe, expect, it } from 'vitest';
import {
  availableSellUnits,
  averageCostAfterIntake,
  cartLineContains,
  cartLineUsesMainStock,
  compareWithLoose,
  describeItemStock,
  oneUnitLabel,
  pricePerBase,
  qtyAfterUnitSwitch,
  reservedBaseQty,
  reservedPackQty,
  saleLineCostPerBase,
  saleLineStock,
  sellLineCaption,
  sellUnitContains,
  sellUnitPrice,
  stockOnHandBase
} from '../sellUnits';

const eggs = {
  variants: [
    { id: 'dz', quantity_in_base_unit: 12, deduct_from_base: true },
    { id: 'tray', quantity_in_base_unit: 30, deduct_from_base: true },
    { id: 'pack6', quantity_in_base_unit: 6, deduct_from_base: false }
  ]
};

describe('sell unit sizes and prices', () => {
  it('falls back to one base unit for a missing or bad size', () => {
    expect(sellUnitContains({ quantity_in_base_unit: 12 })).toBe(12);
    expect(sellUnitContains({ quantity_in_base_unit: 0 })).toBe(1);
    expect(sellUnitContains({ quantity_in_base_unit: -3 })).toBe(1);
    expect(sellUnitContains(null)).toBe(1);
  });

  it('prefers a typed pack price over loose rate times size', () => {
    expect(sellUnitPrice(25, 12, 280)).toBe(280);
    expect(sellUnitPrice(25, 12)).toBe(300);
    expect(sellUnitPrice(25, 12, 0)).toBe(300);
    expect(sellUnitPrice(140, 0.25)).toBe(35);
    expect(pricePerBase(280, 12)).toBe(23.33);
    expect(pricePerBase(280, 0)).toBe(280);
  });
});

describe('cart stock reservation', () => {
  const cart = [
    { id: 'egg', cartItemId: 'a', qty: 2, variantId: 'dz', stockDeduction: 12, deductFromBase: true },
    { id: 'egg', cartItemId: 'b', qty: 5, isLoose: true },
    { id: 'egg', cartItemId: 'c', qty: 3, variantId: 'pack6', stockDeduction: 6, deductFromBase: false },
    { id: 'milk', cartItemId: 'd', qty: 1.5, isLoose: true }
  ];

  it('counts dozens and loose pieces against loose stock, never packed piles', () => {
    expect(reservedBaseQty(cart, 'egg')).toBe(29);
    expect(reservedBaseQty(cart, 'egg', 'a')).toBe(5);
    expect(reservedBaseQty(cart, 'milk')).toBe(1.5);
  });

  it('decides the stock pile of a cart line', () => {
    expect(cartLineUsesMainStock({ variantId: 'x', deductFromBase: true })).toBe(true);
    expect(cartLineUsesMainStock({ variantId: 'x', deductFromBase: false })).toBe(false);
    expect(cartLineUsesMainStock({ variantId: 'x' })).toBe(false);
    expect(cartLineUsesMainStock({})).toBe(true);
    expect(cartLineContains({ stockDeduction: 0 })).toBe(1);
  });

  it('reads a cart line exactly like a saved bill line: flag, then catalog, then ready-made pack', () => {
    // No flag: the catalog says the dozen is a view of loose stock.
    expect(cartLineUsesMainStock({ variantId: 'dz' }, eggs)).toBe(true);
    expect(cartLineUsesMainStock({ variantId: 'dz' })).toBe(false);
    expect(cartLineContains({ variantId: 'dz' }, eggs)).toBe(12);
    // 'base' / 'loose' ids and loose lines are the loose pile, one base unit each, whatever else they carry.
    expect(cartLineUsesMainStock({ variantId: 'base' })).toBe(true);
    expect(cartLineUsesMainStock({ isLoose: true, variantId: 'pack6', deductFromBase: false })).toBe(true);
    expect(cartLineContains({ isLoose: true, stockDeduction: 12 })).toBe(1);
    const noFlags = [{ id: 'egg', cartItemId: 'a', qty: 2, variantId: 'dz' }, { id: 'egg', cartItemId: 'b', qty: 3, variantId: 'pack6' }];
    expect(reservedBaseQty(noFlags, 'egg', undefined, eggs)).toBe(24);
    expect(reservedPackQty(noFlags, 'egg', 'pack6', undefined, eggs)).toBe(3);
    expect(reservedPackQty(cart, 'egg', 'pack6')).toBe(3);
    expect(reservedPackQty(cart, 'egg', 'pack6', 'c')).toBe(0);
    expect(reservedPackQty(cart, 'egg', 'dz')).toBe(0);
  });

  it('works out how many units can still be sold', () => {
    expect(availableSellUnits(30, 0, { quantity_in_base_unit: 12, deduct_from_base: true })).toBe(2.5);
    expect(availableSellUnits(30, 4, { quantity_in_base_unit: 6, deduct_from_base: false })).toBe(4);
    expect(availableSellUnits(-5, 0, null)).toBe(0);
    expect(availableSellUnits(10, -2, { deduct_from_base: false })).toBe(0);
  });
});

describe('qtyAfterUnitSwitch', () => {
  it('keeps the stock quantity when it divides into whole packs', () => {
    expect(qtyAfterUnitSwitch(24, 1, 12, true)).toEqual({ qty: 2, kept: true });
    expect(qtyAfterUnitSwitch(2, 12, 1, false)).toEqual({ qty: 24, kept: true });
    expect(qtyAfterUnitSwitch(0.5, 1, 0.25, false)).toEqual({ qty: 2, kept: true });
  });

  it('starts at one when the stock does not make a whole pack', () => {
    expect(qtyAfterUnitSwitch(5, 1, 12, true)).toEqual({ qty: 1, kept: false });
    expect(qtyAfterUnitSwitch(0, 1, 12, true)).toEqual({ qty: 1, kept: false });
  });
});

describe('labels', () => {
  it('describes a unit and a cart line', () => {
    expect(oneUnitLabel('Dozen', 12, 'pcs')).toBe('1 Dozen = 12 pcs');
    expect(oneUnitLabel('kg', 1, 'kg')).toBe('1 kg');
    expect(sellLineCaption({ qty: 2, variantName: 'Tray', stockDeduction: 30, baseUnit: 'pcs', unit: 'Tray' })).toBe('2 Tray = 60 pcs');
    expect(sellLineCaption({ qty: 1.5, isLoose: true, unit: 'kg', baseUnit: 'kg' })).toBe('1.5 kg');
  });

  it('compares a pack price with the loose rate', () => {
    expect(compareWithLoose(23.33, 25)).toEqual({ text: '7% below loose', tone: 'cheaper' });
    expect(compareWithLoose(26, 25)).toEqual({ text: '4% above loose', tone: 'dearer' });
    expect(compareWithLoose(25.1, 25)).toEqual({ text: '', tone: 'same' });
    expect(compareWithLoose(10, 0)).toEqual({ text: '', tone: 'same' });
  });
});

describe('saleLineStock', () => {
  it('reads a dozen line as base units from loose stock', () => {
    expect(saleLineStock({ qty: 2, variantId: 'dz', stockDeduction: 12, deductFromBase: true }, eggs))
      .toEqual({ fromBase: true, contains: 12, variantId: undefined, stockQty: 24, baseQty: 24 });
  });

  it('reads a packed line as a pack count', () => {
    expect(saleLineStock({ qty: 3, variantId: 'pack6', stockDeduction: 6, deductFromBase: false }, eggs))
      .toEqual({ fromBase: false, contains: 6, variantId: 'pack6', stockQty: 3, baseQty: 18 });
  });

  it('lets the bill snapshot win over a later catalog change', () => {
    // The catalog now says the dozen is packed, but the bill took it from loose stock.
    const changed = { variants: [{ id: 'dz', quantity_in_base_unit: 10, deduct_from_base: false }] };
    expect(saleLineStock({ qty: 1, variantId: 'dz', stockDeduction: 12, deductFromBase: true }, changed))
      .toMatchObject({ fromBase: true, contains: 12, baseQty: 12 });
  });

  it('falls back to the catalog for old bills without a snapshot', () => {
    expect(saleLineStock({ qty: 2, variant_id: 'tray' }, eggs)).toMatchObject({ fromBase: true, contains: 30, baseQty: 60 });
    expect(saleLineStock({ qty: 2, variant_id: 'pack6' }, eggs)).toMatchObject({ fromBase: false, stockQty: 2, baseQty: 12 });
  });

  it('treats loose, base and missing variants as loose stock', () => {
    expect(saleLineStock({ qty: 1.25, variantId: 'loose' }, eggs)).toMatchObject({ fromBase: true, contains: 1, baseQty: 1.25 });
    expect(saleLineStock({ qty: 1.25, variantId: 'base' })).toMatchObject({ fromBase: true, baseQty: 1.25 });
    expect(saleLineStock({ qty: 4, variantId: 'dz', isLoose: true }, eggs)).toMatchObject({ fromBase: true, baseQty: 4 });
  });

  it('keeps a negative quantity (a correction) negative', () => {
    expect(saleLineStock({ qty: -1, variantId: 'dz', stockDeduction: 12, deductFromBase: true }, eggs).baseQty).toBe(-12);
  });
});

describe('stock value helpers', () => {
  it('adds packed piles at their size and ignores dozen views and negatives', () => {
    expect(stockOnHandBase(10, { pack6: 2, dz: 5 }, eggs.variants)).toBe(22);
    expect(stockOnHandBase(-4, { pack6: -1 }, eggs.variants)).toBe(0);
    expect(stockOnHandBase(3, { ghost: 9 }, eggs.variants)).toBe(3);
  });

  it('moves the average cost only by real incoming stock', () => {
    expect(averageCostAfterIntake(100, 10, 100, 1200)).toBe(11);
    expect(averageCostAfterIntake(0, 10, 50, 600)).toBe(12);
    expect(averageCostAfterIntake(-20, 10, 50, 600)).toBe(12);
    expect(averageCostAfterIntake(100, 10, 0, 0)).toBe(10);
    expect(averageCostAfterIntake(3, 10, 7, 100)).toBe(13);
  });

  it('gives the cost of one base unit of a sold line', () => {
    const dozen = saleLineStock({ qty: 1, variantId: 'dz', stockDeduction: 12, deductFromBase: true }, eggs);
    expect(saleLineCostPerBase({ cost_price: 240 }, dozen)).toBe(20);
    expect(saleLineCostPerBase({}, dozen, 19.5)).toBe(19.5);
  });
});

describe('describeItemStock', () => {
  const item = {
    name: 'Eggs', unit: 'pcs', cost_price: 20, selling_price: 25, item_type: ['Sale product'],
    variants: [
      { id: 'dz', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true, selling_price: 280 },
      { id: 'pack6', name: 'Pack of 6', quantity_in_base_unit: 6, deduct_from_base: false, selling_price: 110 }
    ]
  };

  it('values loose plus packed stock at cost and counts what POS can sell', () => {
    const picture = describeItemStock(item, 30, { pack6: 2 });
    expect(picture.totalBase).toBe(42);
    expect(picture.sellableBase).toBe(42);
    expect(picture.costValue).toBe(30 * 20 + 2 * 120);
    expect(picture.piles.find(p => p.id === 'dz')).toMatchObject({ kind: 'multi', count: 2.5, baseQty: 0 });
    expect(picture.piles.find(p => p.id === 'pack6')).toMatchObject({ kind: 'packed', count: 2, baseQty: 12 });
    expect(picture.warnings).toContain('Pack of 6 sells below cost (Rs 110 vs Rs 120).');
  });

  it('warns about negative stock, missing cost and orphan counts', () => {
    const picture = describeItemStock({ ...item, cost_price: 0 }, -3, { ghost: 4 });
    expect(picture.warnings).toEqual(expect.arrayContaining([
      'Loose stock is negative (-3 pcs).',
      expect.stringContaining('Old Deleted pack count of 4')
    ]));
    expect(picture.costValue).toBe(0);
  });
});
