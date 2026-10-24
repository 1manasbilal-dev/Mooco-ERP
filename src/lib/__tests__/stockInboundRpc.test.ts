import { describe, expect, it } from 'vitest';
import {
  applyInventoryStates, applyItemStates, counterMilkItemFor, itemStatesFrom, materialPurchaseFromRow,
  materialPurchaseKey, shortMaterialsText,
} from '../stockInboundRpc';
import type { InventoryItem, ItemDefinition } from '../../types';

const item = (id: string, name: string, unit: string, extra: Partial<ItemDefinition> = {}) =>
  ({ id, name, unit, cost_price: 0, ...extra } as ItemDefinition);

describe('counter milk item for a lot', () => {
  const items = [
    item('item_paneer', 'Paneer', 'kg'),
    item('item_milk_powder', 'Milk Powder', 'kg'),
    item('item_cow_milk', 'Cow Milk', 'L'),
    item('item_mixed_milk', 'Mixed Milk', 'ml'),
  ];

  it('takes the milk type item first', () => {
    expect(counterMilkItemFor(items, 'Cow')?.id).toBe('item_cow_milk');
  });

  it('falls back to Mixed Milk, which may be stocked in ml', () => {
    expect(counterMilkItemFor(items, 'Buffalo')?.id).toBe('item_mixed_milk');
    expect(counterMilkItemFor(items, undefined)?.id).toBe('item_mixed_milk');
  });

  it('skips a fallback whose unit cannot take litres', () => {
    const wrong = [item('item_mixed_milk', 'Mixed Milk', 'kg'), item('item_milk_cake', 'Milk Cake', 'kg'), item('item_desi', 'Desi Milk', 'L')];
    expect(counterMilkItemFor(wrong, 'Buffalo')?.id).toBe('item_desi');
    expect(counterMilkItemFor([item('item_mixed_milk', 'Mixed Milk', 'pcs')], 'Cow')).toBeUndefined();
  });

  it('never picks a powder or cake product', () => {
    expect(counterMilkItemFor([item('a', 'Milk Cake', 'L'), item('b', 'Milk Shake', 'L')], 'Cow')).toBeUndefined();
  });
});

describe('server item states', () => {
  const result = { items: { item_a: { id: 'item_a', stock: 12.3456, variant_stocks: { v1: 4 }, cost_price: '105.5' }, junk: null } };

  it('reads the items map and rounds stock to 3 decimals', () => {
    expect(itemStatesFrom(result)).toEqual([{ id: 'item_a', stock: 12.346, variant_stocks: { v1: 4 }, cost_price: 105.5 }]);
    expect(itemStatesFrom(null)).toEqual([]);
    expect(itemStatesFrom({ items: 'x' })).toEqual([]);
  });

  it('replaces piles and cost on the catalog and inventory rows only', () => {
    const states = itemStatesFrom(result);
    const catalog = applyItemStates([item('item_a', 'A', 'kg', { stock: 1, cost_price: 90 }), item('item_b', 'B', 'kg', { stock: 2 })], states);
    expect(catalog[0]).toMatchObject({ stock: 12.346, variant_stocks: { v1: 4 }, cost_price: 105.5 });
    expect(catalog[1].stock).toBe(2);
    const inventory = applyInventoryStates([
      { id: 'inv_item_a', name: 'A', category: '', stock_type: 'Loose' as any, quantity: 1, unit: 'kg', price: 0 },
      { id: 'inv_item_b', item_id: 'item_b', name: 'B', category: '', stock_type: 'Loose' as any, quantity: 2, unit: 'kg', price: 0 },
    ] as InventoryItem[], states);
    expect(inventory[0]).toMatchObject({ quantity: 12.346, variant_stocks: { v1: 4 } });
    expect(inventory[1].quantity).toBe(2);
  });
});

describe('material purchase rows', () => {
  it('shapes a saved row like a loaded one (paid / due from details)', () => {
    const row = materialPurchaseFromRow({ id: 'mp_1', quantity: '2.0004', rate: 120.456, total_amount: 240.9, details: { paid_amount: 100, due_amount: 140.9, account_id: 'acc_cash' } });
    expect(row).toMatchObject({ id: 'mp_1', quantity: 2, rate: 120.46, total_amount: 240.9, paid_amount: 100, due_amount: 140.9, account_id: 'acc_cash' });
  });

  it('keys the same bill the same way and a changed bill differently', () => {
    const bill = { supplier_id: 'sup_1', date: '2026-10-24', paid_amount: 100, items: [{ item_id: 'a', quantity: 2, unit: 'kg', rate: 50 }] };
    expect(materialPurchaseKey(bill)).toBe(materialPurchaseKey({ ...bill }));
    expect(materialPurchaseKey(bill)).not.toBe(materialPurchaseKey({ ...bill, items: [{ item_id: 'a', quantity: 3, unit: 'kg', rate: 50 }] }));
    expect(materialPurchaseKey({ ...bill, supplier_id: null })).toContain(':spot:');
    // A bill dated today carries the click time: two clicks are still the same bill.
    expect(materialPurchaseKey({ ...bill, date: '2026-10-24T07:01:02.000Z' })).toBe(materialPurchaseKey({ ...bill, date: '2026-10-24T07:01:09.500Z' }));
  });
});

describe('short materials', () => {
  it('lists what production used beyond the stock on hand', () => {
    expect(shortMaterialsText({ short_materials: [{ item_id: 's', name: 'Sugar', short: 0.3, unit: 'kg' }, { item_id: 'c', name: 'Cup', short: 4 }] })).toBe('Sugar 0.3 kg, Cup 4');
    expect(shortMaterialsText({ short_materials: [] })).toBe('');
    expect(shortMaterialsText(undefined)).toBe('');
  });
});
