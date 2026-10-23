import { describe, expect, it } from 'vitest';
import { getRetailMilkStock } from '../retailMilkStock';
import { StockType, type InventoryItem, type ItemDefinition } from '../../types';

const master = (patch: Partial<ItemDefinition>): ItemDefinition => ({
  id: 'i', name: 'Item', category: [], item_type: ['Sale product'], unit: 'L', source: 'Production',
  cost_price: 0, selling_price: 0, reorder_level: 0, isActive: true, ...patch
});
const stock = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: 's', name: 'Item', category: '', stock_type: StockType.RETAIL_STOCK, quantity: 0, unit: 'L', price: 0, ...patch
});

describe('getRetailMilkStock', () => {
  const items = [
    master({ id: 'buf', name: 'Buffalo Milk', selling_price: 240, cost_price: 200 }),
    master({ id: 'cow', name: 'Cow Milk', selling_price: 200, cost_price: 170 }),
    master({ id: 'dahi', name: 'Dahi', unit: 'kg', category: ['Milk products'], selling_price: 260 }),
    master({ id: 'shake', name: 'Milk Shake', selling_price: 150 }),
    master({ id: 'ml', name: 'Mixed Milk Pouch', unit: 'ml', selling_price: 0.22, cost_price: 0.18 }),
    master({ id: 'noloose', name: 'Packed Milk', selling_price: 250, allow_loose_sale: false })
  ];

  it('values loose retail milk in litres at sale and cost rates', () => {
    const summary = getRetailMilkStock([
      stock({ id: 's1', item_id: 'buf', name: 'Buffalo Milk', quantity: 40.5 }),
      stock({ id: 's2', item_id: 'cow', name: 'Cow Milk', quantity: 9.5 })
    ], items);
    expect(summary.liters).toBe(50);
    expect(summary.totalValue).toBe(9720 + 1900);
    expect(summary.totalCostValue).toBe(8100 + 1615);
    expect(summary.rows[0]).toMatchObject({ name: 'Buffalo Milk', milkType: 'Buffalo', percentOfTotal: 81, unit: 'L', stockUnit: 'L', stockQuantity: 40.5 });
    expect(summary.rows[1]).toMatchObject({ milkType: 'Cow', percentOfTotal: 19 });
    expect(summary.avgRate).toBe(232);
  });

  it('converts millilitre stock and per-ml rates to litres', () => {
    const summary = getRetailMilkStock([stock({ id: 's3', item_id: 'ml', name: 'Mixed Milk Pouch', unit: 'ml', quantity: 2500 })], items);
    expect(summary.rows[0]).toMatchObject({
      unit: 'L', liters: 2.5, stockUnit: 'ml', stockQuantity: 2500,
      rate: 220, costRate: 180, value: 550, costValue: 450, milkType: 'Mixed'
    });
    expect(summary.unit).toBe('L');
  });

  it('keeps the three-decimal stock precision', () => {
    const summary = getRetailMilkStock([stock({ id: 's1', item_id: 'buf', name: 'Buffalo Milk', quantity: 0.125 })], items);
    expect(summary.liters).toBe(0.125);
  });

  it('leaves out kg products, shakes, pack-only items and unallocated or packaging stock', () => {
    const summary = getRetailMilkStock([
      stock({ id: 'a', item_id: 'dahi', name: 'Dahi', unit: 'kg', quantity: 10 }),
      stock({ id: 'b', item_id: 'shake', name: 'Milk Shake', quantity: 5 }),
      stock({ id: 'c', item_id: 'noloose', name: 'Packed Milk', quantity: 7 }),
      stock({ id: 'd', item_id: 'buf', name: 'Buffalo Milk', quantity: 30, stock_type: StockType.UNALLOCATED }),
      stock({ id: 'e', item_id: 'buf', name: 'Buffalo Milk', quantity: 30, stock_type: StockType.PACKAGING })
    ], items);
    expect(summary.rows).toEqual([]);
    expect(summary.liters).toBe(0);
    expect(summary.avgRate).toBe(0);
  });
});
