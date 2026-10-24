import { describe, expect, it } from 'vitest';
import { addMove, saleLineMove } from '../saleStockMove';

// Same catalog and cases as supabase/tests/pglite/stock-outbound.mjs [sale_line_stock], so the
// screen and the server move the same piles.
const eggs = {
  variants: [
    { id: 'dz', quantity_in_base_unit: 12, deduct_from_base: true },
    { id: 'tray', quantity_in_base_unit: 30, deduct_from_base: true },
    { id: 'p6', quantity_in_base_unit: 6, deduct_from_base: false },
  ],
};

describe('saleLineMove', () => {
  it('reads loose, multi-unit and pack lines like the server', () => {
    expect(saleLineMove({ qty: 5 }, eggs)).toMatchObject({ fromBase: true, baseQty: 5, stockQty: 5, fallback: false });
    expect(saleLineMove({ qty: 2, variantId: 'dz', deductFromBase: true, stockDeduction: 12 }, eggs)).toMatchObject({ fromBase: true, baseQty: 24 });
    expect(saleLineMove({ qty: 2, variantId: 'dz', deductFromBase: true, stockDeduction: 10 }, eggs).baseQty).toBe(20);
    expect(saleLineMove({ qty: 3, variantId: 'p6', deductFromBase: false, stockDeduction: 6 }, eggs)).toMatchObject({ fromBase: false, variantId: 'p6', stockQty: 3, baseQty: 18 });
  });

  it('a pack line without a flag follows the catalog (saleLineStock)', () => {
    expect(saleLineMove({ qty: 2, variantId: 'tray' }, eggs)).toMatchObject({ fromBase: true, baseQty: 60 });
    expect(saleLineMove({ qty: 2, variantId: 'p6' }, eggs)).toMatchObject({ fromBase: false, stockQty: 2 });
  });

  it('a pack the product no longer has moves loose at its size', () => {
    expect(saleLineMove({ qty: 2, variantId: 'gone', deductFromBase: false, stockDeduction: 6 }, eggs)).toMatchObject({ fromBase: true, baseQty: 12, fallback: true });
    expect(saleLineMove({ qty: 1, variantId: 'dz', deductFromBase: false, stockDeduction: 12 }, eggs)).toMatchObject({ fromBase: true, baseQty: 12, fallback: true });
    expect(saleLineMove({ qty: 2, variantId: 'p6' }, { variants: [] })).toMatchObject({ fromBase: true, baseQty: 2, fallback: true });
  });

  it('without a catalog row it trusts the snapshot', () => {
    expect(saleLineMove({ qty: 2, variantId: 'p6', deductFromBase: false }, null)).toMatchObject({ fromBase: false, variantId: 'p6', stockQty: 2 });
  });

  it('loose markers, negatives and rounding', () => {
    expect(saleLineMove({ qty: 2, variantId: 'loose', deductFromBase: false }, eggs)).toMatchObject({ fromBase: true, baseQty: 2 });
    expect(saleLineMove({ qty: 2, variantId: 'p6', isLoose: true }, eggs)).toMatchObject({ fromBase: true, baseQty: 2 });
    expect(saleLineMove({ qty: -4 }, eggs).baseQty).toBe(0);
    expect(saleLineMove({ qty: 0.3333333 }, eggs).baseQty).toBe(0.333);
  });
});

describe('addMove', () => {
  it('adds loose and pack moves per pile', () => {
    const acc = { loose: 0, packs: {} as Record<string, number> };
    addMove(acc, saleLineMove({ qty: 2, variantId: 'dz', deductFromBase: true, stockDeduction: 12 }, eggs), -1);
    addMove(acc, saleLineMove({ qty: 3, variantId: 'p6', deductFromBase: false }, eggs), -1);
    addMove(acc, saleLineMove({ qty: 1, variantId: 'p6', deductFromBase: false }, eggs), -1);
    addMove(acc, saleLineMove({ qty: 5 }, eggs), 1);
    expect(acc).toEqual({ loose: -19, packs: { p6: -4 } });
  });
});
