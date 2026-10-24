import { describe, expect, it, vi } from 'vitest';
import { orderStockNeeds } from '../customerOrders';

vi.mock('../supabase', () => ({ supabase: {} }));

const eggs = {
  id: 'eggs',
  stock: 30,
  variant_stocks: { p6: 2 },
  variants: [
    { id: 'dz', quantity_in_base_unit: 12, deduct_from_base: true },
    { id: 'p6', quantity_in_base_unit: 6 },
  ],
};

describe('orderStockNeeds', () => {
  it('adds every line of the same pile before comparing with stock', () => {
    const { piles, shortLines } = orderStockNeeds([
      { itemId: 'eggs', qty: 20 },
      { itemId: 'eggs', qty: 1, variantId: 'dz' },
      { itemId: 'eggs', qty: 2, variantId: 'p6' },
    ], [eggs]);
    expect(piles).toEqual([
      { itemId: 'eggs', pile: 'loose', need: 32, available: 30, short: true },
      { itemId: 'eggs', pile: 'p6', need: 2, available: 2, short: false },
    ]);
    expect(shortLines).toEqual([true, true, false]);
  });

  it('each line alone would fit, together they do not', () => {
    const { shortLines } = orderStockNeeds([{ itemId: 'eggs', qty: 1, variantId: 'p6' }, { itemId: 'eggs', qty: 2, variantId: 'p6' }], [eggs]);
    expect(shortLines).toEqual([true, true]);
  });

  it('an unknown product has nothing available', () => {
    expect(orderStockNeeds([{ itemId: 'x', qty: 1 }], [eggs]).shortLines).toEqual([true]);
  });
});
