import { describe, expect, it } from 'vitest';
import {
  billLineProblem, conversionText, costChangeText, defaultPurchaseUnit, landingPreview, pileOnHandInUnit, pileStockOf, purchaseLinePile, purchasePileText,
  purchaseQtyText, purchaseUnitsFor, rateForUnit, rateFromTotal, returnableQty, returnQtyProblem, type PurchaseUnit,
} from '../purchaseStock';

const rusk = {
  id: 'it_rusk',
  name: 'Rusk',
  unit: 'kg',
  cost_price: 400,
  item_type: ['Sale product'],
  allow_loose_sale: false,
  variants: [
    { id: 'v_pouch', name: '500 g pouch', quantity_in_base_unit: 0.5, deduct_from_base: false },
    { id: 'v_old', name: '1 kg box', quantity_in_base_unit: 1, deduct_from_base: false, isActive: false },
    { id: 'v_bag', name: 'Bag', quantity_in_base_unit: 20, deduct_from_base: true },
  ],
};

const unitOf = (units: PurchaseUnit[], key: string) => {
  const unit = units.find(u => u.key === key);
  if (!unit) throw new Error(`no unit ${key}`);
  return unit;
};

describe('purchaseUnitsFor', () => {
  it('offers base, active packs, multi-units and exact weight conversions, in that order', () => {
    const units = purchaseUnitsFor(rusk);
    expect(units[0]).toMatchObject({ key: 'base', unit: 'kg', kind: 'base', factor: 1 });
    expect(units[1]).toMatchObject({ key: 'pack:v_pouch', kind: 'pack', factor: 0.5, variantId: 'v_pouch', equals: '1 × 500 g pouch = 0.5 kg' });
    expect(units[2]).toMatchObject({ key: 'multi:v_bag', kind: 'multi', factor: 20 });
    // Hidden packs are not offered: the save would stock them as loose.
    expect(units.some(u => u.unit === '1 kg box')).toBe(false);
    const grams = unitOf(units, 'unit:g');
    expect(grams).toMatchObject({ kind: 'convert', factor: 0.001, lands: 'Loose stock' });
    // A volume never converts to a weight.
    expect(units.some(u => u.unit === 'L' || u.unit === 'ml')).toBe(false);
  });

  it('converts ml/L both ways and offers nothing for count units', () => {
    const milk = purchaseUnitsFor({ unit: 'ml', variants: [] });
    expect(unitOf(milk, 'unit:L').factor).toBe(1000);
    const cups = purchaseUnitsFor({ unit: 'pcs', variants: [{ id: 'v_ctn', name: 'Carton', quantity_in_base_unit: 100, deduct_from_base: true }] });
    // dz/ctn sizes differ per product, so only the product's own Carton is offered.
    expect(cups.map(u => u.key)).toEqual(['base', 'multi:v_ctn']);
  });

  it('offers a shared name once, as the pack the save would pick', () => {
    const units = purchaseUnitsFor({
      unit: 'g',
      variants: [
        { id: 'v_kg_pack', name: 'kg', quantity_in_base_unit: 1000, deduct_from_base: false },
        { id: 'v_kg_multi', name: 'KG', quantity_in_base_unit: 1000, deduct_from_base: true },
      ],
    });
    expect(units.filter(u => u.unit.toLowerCase() === 'kg').map(u => u.key)).toEqual(['pack:v_kg_pack']);
  });

  it('returns nothing for a missing product', () => {
    expect(purchaseUnitsFor(undefined)).toEqual([]);
  });
});

describe('bill line checks', () => {
  const units = purchaseUnitsFor(rusk);
  const pouch = unitOf(units, 'pack:v_pouch');
  const line = { item_name: 'Rusk', unit: pouch.unit, unitKey: pouch.key, conversion_factor: 0.5, quantity: 10, rate: 210 };

  it('shows the conversion in words', () => {
    expect(conversionText(10, pouch, 'kg')).toBe('10 × 500 g pouch = 5 kg');
    expect(conversionText(2, unitOf(units, 'multi:v_bag'), 'kg')).toBe('2 Bag = 40 kg');
    expect(conversionText(2500, unitOf(units, 'unit:g'), 'kg')).toBe('2,500 g = 2.5 kg');
    expect(conversionText(2.5, unitOf(purchaseUnitsFor({ unit: 'ml' }), 'unit:L'), 'ml')).toBe('2.5 L = 2,500 ml');
  });

  it('accepts a good line and refuses half packs, zero qty and minus rates', () => {
    expect(billLineProblem(line, units)).toBe('');
    expect(billLineProblem({ ...line, quantity: 2.5 }, units)).toMatch(/poore number/);
    expect(billLineProblem({ ...line, quantity: 0 }, units)).toMatch(/0 se zyada/);
    expect(billLineProblem({ ...line, rate: -1 }, units)).toMatch(/minus/);
    // Half a bag is fine: it is loose stock counted in bags.
    expect(billLineProblem({ ...line, unit: 'Bag', unitKey: 'multi:v_bag', conversion_factor: 20, quantity: 0.5 }, units)).toBe('');
  });

  it('refuses a unit that no longer exists or changed size while the bill was open', () => {
    const hidden = purchaseUnitsFor({ ...rusk, variants: rusk.variants.map(v => (v.id === 'v_pouch' ? { ...v, isActive: false } : v)) });
    expect(billLineProblem(line, hidden)).toMatch(/ab is product mein nahi/);
    const resized = purchaseUnitsFor({ ...rusk, variants: rusk.variants.map(v => (v.id === 'v_pouch' ? { ...v, quantity_in_base_unit: 0.4 } : v)) });
    expect(billLineProblem(line, resized)).toMatch(/size badal gaya/);
    const rebased = purchaseUnitsFor({ ...rusk, unit: 'g' });
    expect(billLineProblem({ ...line, unit: 'kg', unitKey: 'base', conversion_factor: 1 }, rebased)).toMatch(/ab is product mein nahi/);
    expect(billLineProblem(line, [])).toMatch(/catalog mein nahi/);
  });

  it('starts a new line in the last bought unit and rate, or the pack for pack-only products', () => {
    const lastBag = { unit: 'Bag', rate: 7900, details: { conversion_factor: 20 } };
    expect(defaultPurchaseUnit(rusk, units, lastBag)).toEqual({ unit: unitOf(units, 'multi:v_bag'), rate: 7900 });
    // The bag was resized since: start fresh.
    expect(defaultPurchaseUnit(rusk, units, { ...lastBag, details: { conversion_factor: 25 } }).unit.key).toBe('base');
    const lastPouch = { unit: 'old name', rate: 0, details: { variant_id: 'v_pouch', conversion_factor: 0.5 } };
    expect(defaultPurchaseUnit(rusk, units, lastPouch)).toEqual({ unit: pouch, rate: 200 });
    const packsOnly = { ...rusk, variants: rusk.variants.filter(v => v.id !== 'v_bag') };
    expect(defaultPurchaseUnit(packsOnly, purchaseUnitsFor(packsOnly)).unit.key).toBe('pack:v_pouch');
    expect(defaultPurchaseUnit(rusk, units)).toEqual({ unit: units[0], rate: 400 });
  });

  it('keeps the price per base unit when the unit changes, and the quantity when the total changes', () => {
    expect(rateForUnit(400, 1, 0.5)).toBe(200);
    expect(rateForUnit(7000, 50, 1)).toBe(140);
    expect(rateFromTotal(69500, 10)).toBe(6950);
    expect(rateFromTotal(100, 3)).toBe(33.33);
    expect(rateFromTotal(100, 0)).toBeNull();
    expect(rateFromTotal(-5, 2)).toBeNull();
  });
});

describe('landingPreview', () => {
  const units = purchaseUnitsFor(rusk);

  it('adds packs to their pile and the rest to loose, averaging cost line by line like the save', () => {
    const landing = landingPreview(rusk, { loose: 4, packs: { v_pouch: 6 } }, [
      { quantity: 10, rate: 220, unit: unitOf(units, 'pack:v_pouch') }, // 5 kg for 2200
      { quantity: 2000, rate: 0.45, unit: unitOf(units, 'unit:g') }, // 2 kg for 900
    ]);
    // Line 1: on hand 4 + 3 = 7 kg at 400 → (2800 + 2200) / 12 = 416.6667
    // Line 2: on hand 12 kg at 416.6667 → (5000 + 900) / 14 = 421.4286
    expect(landing.costAfter).toBeCloseTo(421.4286, 4);
    expect(landing.incomingBase).toBe(7);
    expect(landing.changes).toEqual([
      expect.objectContaining({ id: 'loose', before: 4, after: 6, afterText: '6 kg' }),
      expect.objectContaining({ id: 'v_pouch', before: 6, after: 16, afterText: '16' }),
    ]);
    expect(landing.afterText).toBe('6 kg loose · 16 × 500 g pouch');
    // Loose sale is off, but the Bag multi-unit still sells loose stock: no warning.
    expect(landing.notes).toEqual([]);
    expect(costChangeText(landing, 'kg')).toBe('Rs 400 → Rs 421.43/kg');
  });

  it('warns when loose intake of a sale product has no way to be sold', () => {
    const packsOnly = { ...rusk, variants: rusk.variants.filter(v => v.id !== 'v_bag') };
    const landing = landingPreview(packsOnly, { loose: 0, packs: {} }, [{ quantity: 2, rate: 400, unit: purchaseUnitsFor(packsOnly)[0] }]);
    expect(landing.notes[0]).toMatch(/Loose sale band/);
  });

  it('ignores minus stock in the average and says so', () => {
    const sugar = { unit: 'kg', cost_price: 150, item_type: ['Raw material'], variants: [] };
    const landing = landingPreview(sugar, { loose: -5, packs: {} }, [{ quantity: 10, rate: 140, unit: purchaseUnitsFor(sugar)[0] }]);
    expect(landing.costAfter).toBe(140);
    expect(landing.after.piles[0].count).toBe(5);
    expect(landing.notes.join(' ')).toMatch(/minus/);
    expect(costChangeText({ costBefore: 140, costAfter: 140 }, 'kg')).toBe('Rs 140/kg');
  });

  it('reads the inventory row first and falls back to the catalog row', () => {
    expect(pileStockOf({ stock: 3, variant_stocks: { a: 1 } }, { quantity: 7, variant_stocks: { a: 2 } })).toEqual({ loose: 7, packs: { a: 2 } });
    expect(pileStockOf({ stock: 3, variant_stocks: { a: 1 } }, undefined)).toEqual({ loose: 3, packs: { a: 1 } });
  });
});

describe('returns', () => {
  const packRow = { quantity: 8, unit: '500 g pouch', status: 'Completed', details: { variant_id: 'v_pouch', conversion_factor: 0.5, returned_quantity: 2 } };
  const looseRow = { quantity: 3, unit: 'Bag', status: 'Completed', details: { conversion_factor: 20 } };

  it('takes from the pile the purchase went to', () => {
    const pile = purchaseLinePile(packRow, rusk);
    expect(pile).toMatchObject({ kind: 'pack', variantId: 'v_pouch', name: '500 g pouch packs', note: '' });
    expect(purchaseLinePile(looseRow, rusk)).toMatchObject({ kind: 'loose', factor: 20, baseUnit: 'kg' });
    // The pack was deleted since: the return comes out of loose, and the owner is told.
    const gone = purchaseLinePile(packRow, { ...rusk, variants: [] });
    expect(gone.kind).toBe('loose');
    expect(gone.note).toMatch(/loose stock se kam/);
    // The pack became a multi-unit: the return would write a stray count.
    expect(purchaseLinePile(packRow, { ...rusk, variants: [{ id: 'v_pouch', name: '500 g pouch', quantity_in_base_unit: 0.5, deduct_from_base: true }] }).note).toMatch(/multi-unit/);
  });

  it('allows back exactly what is left of the line, in its own unit', () => {
    expect(returnableQty(packRow)).toBe(8);
    expect(returnableQty({ ...packRow, status: 'Returned' })).toBe(0);
    const pile = purchaseLinePile(packRow, rusk);
    expect(returnQtyProblem(8, 8, pile, '500 g pouch')).toBe('');
    expect(returnQtyProblem(9, 8, pile, '500 g pouch')).toMatch(/sirf 8 × 500 g pouch wapas/);
    expect(returnQtyProblem(1.5, 8, pile, '500 g pouch')).toMatch(/poore number/);
    expect(returnQtyProblem(0, 8, pile, 'x')).toMatch(/0 se zyada/);
    expect(returnQtyProblem(1.5, 3, purchaseLinePile(looseRow, rusk), 'Bag')).toBe('');
  });

  it('reads the pile on hand in the line unit and labels the log', () => {
    const stock = { loose: 50, packs: { v_pouch: 3 } };
    expect(pileOnHandInUnit(purchaseLinePile(packRow, rusk), stock)).toBe(3);
    expect(pileOnHandInUnit(purchaseLinePile(looseRow, rusk), stock)).toBe(2.5);
    expect(purchaseQtyText(10, '500 g pouch', { kind: 'pack' })).toBe('10 × 500 g pouch');
    expect(purchaseQtyText(2, 'Bag', { kind: 'loose' })).toBe('2 Bag');
    expect(purchasePileText(2, purchaseLinePile(looseRow, rusk))).toBe('Loose +40 kg');
    expect(purchasePileText(10, purchaseLinePile(packRow, rusk))).toBe('500 g pouch packs +10');
  });
});
