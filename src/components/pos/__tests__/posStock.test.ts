import { describe, expect, it } from 'vitest';
import {
  cartPileLines, defaultSellOption, orderPileLines, pileShortages, posSellOptions, posStockView, sellQtyProblem, shortageText, sumByPile,
} from '../posStock';

const eggs = {
  id: 'eggs',
  name: 'Anday',
  unit: 'pcs',
  price: 30,
  selling_price: 30,
  cost_price: 25,
  allow_loose_sale: true,
  reorder_level: 30,
  variants: [
    { id: 'v_dozen', name: 'Dozen', quantity_in_base_unit: 12, deduct_from_base: true, selling_price: 340 },
    { id: 'v_tray', name: 'Tray', quantity_in_base_unit: 30, deduct_from_base: false },
    { id: 'v_old', name: 'Old box', quantity_in_base_unit: 6, deduct_from_base: false, isActive: false },
  ],
};

describe('posStockView', () => {
  it('never adds pack sizes, hidden packs or stray multi-unit counts into one number', () => {
    // 20 loose + 2 trays (60) sellable; 5 hidden boxes and a stray dozen count are not.
    const view = posStockView(eggs, 20, { v_tray: 2, v_old: 5, v_dozen: 9 });
    expect(view.label).toBe('80 pcs');
    expect(view.detail).toBe('20 pcs loose · 2 × Tray · 5 × Old box (hidden) · 9 old Dozen (clear in stock count)');
    expect(view.status).toBe('ok');
    expect(view.hasSellUnit).toBe(true);
  });

  it('shows minus, out and low as their own states', () => {
    expect(posStockView(eggs, -4, { v_tray: 3 }).status).toBe('minus');
    expect(posStockView(eggs, 0, { v_old: 5 }).status).toBe('out'); // only hidden stock left
    expect(posStockView(eggs, 24, {}).status).toBe('low');
  });

  it('a product with loose sale off and every pack hidden has nothing to sell', () => {
    expect(posStockView({ ...eggs, allow_loose_sale: false, variants: [eggs.variants[2]] }, 10, {}).hasSellUnit).toBe(false);
  });
});

describe('posSellOptions', () => {
  const product = { ...eggs, stock: 30, variant_stocks: { v_tray: 3, v_old: 5 } };

  it('lists loose, multi-units and active packs, each with its own availability after the cart', () => {
    const cart = [
      { id: 'eggs', cartItemId: 'a', qty: 1, variantId: 'v_dozen', deductFromBase: true, stockDeduction: 12 },
      { id: 'eggs', cartItemId: 'b', qty: 1, variantId: 'v_tray', deductFromBase: false, stockDeduction: 30 },
    ];
    const options = posSellOptions(product, cart);
    expect(options.map(o => [o.id, o.kind, o.available])).toEqual([
      ['base', 'loose', 18],
      ['v_dozen', 'multi', 1.5],
      ['v_tray', 'packed', 2],
    ]);
    // Editing line "a" itself: its own dozen is not reserved.
    expect(posSellOptions(product, cart, 'a')[0].available).toBe(30);
  });

  it('drops loose when loose sale is off but keeps multi-units that sell from loose', () => {
    const options = posSellOptions({ ...product, allow_loose_sale: false }, []);
    expect(options.map(o => o.id)).toEqual(['v_dozen', 'v_tray']);
    expect(options[0].available).toBe(2.5);
  });

  it('starts quick entry on loose with stock, else the first option with stock', () => {
    expect(defaultSellOption(posSellOptions(product, []))?.id).toBe('base');
    expect(defaultSellOption(posSellOptions({ ...product, stock: 0 }, []))?.id).toBe('v_tray');
    expect(defaultSellOption(posSellOptions(product, []), 'v_dozen')?.id).toBe('v_dozen');
    expect(defaultSellOption(posSellOptions(product, []), 'v_old')?.id).toBe('base'); // hidden pack is never offered
  });
});

describe('sellQtyProblem', () => {
  const product = { ...eggs, stock: 30, variant_stocks: { v_tray: 3 } };
  const [loose, dozen, tray] = posSellOptions(product, [{ id: 'eggs', cartItemId: 'x', qty: 6, isLoose: true, deductFromBase: true }]);

  it('checks the pile after the cart in the option’s own unit', () => {
    expect(sellQtyProblem('Anday', loose, 24, false, 'pcs')).toBeNull();
    expect(sellQtyProblem('Anday', loose, 25, false, 'pcs')).toBe('Anday: sirf 24 pcs baqi hai (cart ke baad).');
    expect(sellQtyProblem('Anday', dozen, 3, false, 'pcs')).toBe('Anday (Dozen): sirf 2 Dozen baqi hai (cart ke baad).');
    expect(sellQtyProblem('Anday', tray, 4, false, 'pcs')).toBe('Anday (Tray): sirf 3 Tray baqi hai.');
  });

  it('keeps packs whole and lets the negative-stock setting through', () => {
    expect(sellQtyProblem('Anday', tray, 1.5, true, 'pcs')).toBe('Anday (Tray): poore packs mein bikta hai (1, 2, 3...).');
    expect(sellQtyProblem('Anday', loose, 500, true, 'pcs')).toBeNull();
  });

  it('says when everything left is already in the cart', () => {
    const [allInCart] = posSellOptions(product, [{ id: 'eggs', cartItemId: 'x', qty: 30, isLoose: true, deductFromBase: true }]);
    expect(sellQtyProblem('Anday', allInCart, 1, false, 'pcs')).toBe('Anday: stock khatam — jo tha woh cart mein hai.');
  });
});

describe('pile totals', () => {
  it('adds every line that uses the same pile, like checkout_customer_order', () => {
    const lines = orderPileLines([
      { itemId: 'eggs', qty: 2, variantId: 'v_dozen' },
      { itemId: 'eggs', qty: 1, variantId: 'v_dozen' },
      { itemId: 'eggs', qty: 6 },
      { itemId: 'eggs', qty: 2, variantId: 'v_tray' },
    ], () => eggs);
    expect(sumByPile(lines)).toEqual([
      { itemId: 'eggs', pileId: 'loose', need: 42, lines: 3 },
      { itemId: 'eggs', pileId: 'v_tray', need: 2, lines: 1 },
    ]);
    const short = pileShortages(lines, () => ({ loose: 30, packs: { v_tray: 2 } }));
    expect(short).toEqual([{ itemId: 'eggs', pileId: 'loose', need: 42, lines: 3, have: 30 }]);
    expect(shortageText(short[0], eggs)).toBe('Anday loose: 42 pcs chahiye, 30 pcs hai');
  });

  it('reads POS cart lines from their own snapshot', () => {
    const lines = cartPileLines([
      { id: 'eggs', qty: 1, variantId: 'v_dozen', deductFromBase: true, stockDeduction: 12 },
      { id: 'eggs', qty: 2, variantId: 'v_tray', deductFromBase: false, stockDeduction: 30 },
    ]);
    const short = pileShortages(lines, () => ({ loose: 12, packs: { v_tray: 1 } }));
    expect(short.map(s => [s.pileId, s.need, s.have])).toEqual([['v_tray', 2, 1]]);
    expect(shortageText(short[0], eggs)).toBe('Anday (Tray): 2 chahiye, 1 hain');
  });
});
