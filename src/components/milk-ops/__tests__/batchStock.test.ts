import { describe, expect, it } from 'vitest';
import { batchCancelPlan, batchMaterialCheck, batchOutputPreview, stockLookup, type PileStock } from '../batchStock';
import type { InventoryItem, ItemDefinition, ProductionBatch } from '../../../types';

const item = (over: Partial<ItemDefinition> & { id: string }): ItemDefinition => ({
  name: over.id, category: [], item_type: ['Raw material'], unit: 'kg', source: 'Supplier', cost_price: 0, selling_price: 0,
  reorder_level: 0, isActive: true, ...over,
} as ItemDefinition);

const sugar = item({ id: 'sugar', name: 'Sugar', unit: 'kg', cost_price: 140, variants: [{ id: 'bag', name: '50 kg bag', quantity_in_base_unit: 50, isActive: true, packaging_item_id: '', packaging_qty: 0 }] });
const cup = item({ id: 'cup', name: 'Cup', unit: 'pcs', cost_price: 6, item_type: ['Packaging material'] });
const culture = item({ id: 'culture', name: 'Culture', unit: 'pcs', cost_price: 50 });
const yogurt = item({
  id: 'yogurt', name: 'Yogurt', unit: 'kg', item_type: ['Sale product'], source: 'Production', recipe_base_quantity: 10,
  recipe: [
    { item_id: 'sugar', item_name: 'Sugar', quantity: 500, unit: 'g', type: 'Ingredient' },
    { item_id: 'culture', item_name: 'Culture', quantity: 1, unit: 'pcs', type: 'Ingredient' },
  ],
  variants: [
    { id: 'tub', name: '500 g tub', quantity_in_base_unit: 0.5, isActive: true, packaging_item_id: 'cup', packaging_qty: 1 },
    { id: 'dozen', name: 'Dozen', quantity_in_base_unit: 6, isActive: true, deduct_from_base: true, packaging_item_id: 'cup', packaging_qty: 12 },
  ],
});

const byId = (...list: ItemDefinition[]) => new Map(list.map(i => [i.id, i]));
const stocks = (map: Record<string, PileStock>) => (id: string) => map[id] || { loose: 0, packs: {} };

describe('batchMaterialCheck', () => {
  it('scales the recipe to the milk and converts g to the kg stock unit', () => {
    const check = batchMaterialCheck({
      product: yogurt, inputLitres: 40, packCounts: {}, itemsById: byId(sugar, cup, culture, yogurt),
      stockOf: stocks({ sugar: { loose: 5, packs: {} }, culture: { loose: 10, packs: {} } }),
    });
    const sugarNeed = check.needs.find(n => n.itemId === 'sugar')!;
    expect(sugarNeed.need).toBe(2);
    expect(sugarNeed.unit).toBe('kg');
    expect(sugarNeed.problem).toBeNull();
    expect(check.lines.find(l => l.itemId === 'sugar')!.cost).toBe(280);
    expect(check.blocking).toEqual([]);
  });

  it('counts ready-made packs as available, not only loose stock', () => {
    const check = batchMaterialCheck({
      product: yogurt, inputLitres: 40, packCounts: {}, itemsById: byId(sugar, culture),
      stockOf: stocks({ sugar: { loose: 0.5, packs: { bag: 1 } }, culture: { loose: 4, packs: {} } }),
    });
    const sugarNeed = check.needs.find(n => n.itemId === 'sugar')!;
    expect(sugarNeed.available).toBe(50.5);
    expect(sugarNeed.problem).toBeNull();
    expect(sugarNeed.piles).toEqual(['0.5 kg loose', '1 × 50 kg bag']);
  });

  it('blocks on a shortfall and says by how much', () => {
    const check = batchMaterialCheck({
      product: yogurt, inputLitres: 40, packCounts: {}, itemsById: byId(sugar, culture),
      stockOf: stocks({ sugar: { loose: 1.25, packs: {} }, culture: { loose: -3, packs: {} } }),
    });
    const sugarNeed = check.needs.find(n => n.itemId === 'sugar')!;
    expect(sugarNeed.problem).toBe('short');
    expect(sugarNeed.shortBy).toBe(0.75);
    // A minus pile is not stock that can be used.
    expect(check.needs.find(n => n.itemId === 'culture')!.available).toBe(0);
    expect(check.blocking.map(n => n.itemId)).toEqual(['sugar', 'culture']);
  });

  it('blocks a recipe unit that cannot be converted instead of deducting the raw number', () => {
    const odd = { ...yogurt, recipe: [{ item_id: 'sugar', item_name: 'Sugar', quantity: 2, unit: 'cup', type: 'Ingredient' as const }] };
    const check = batchMaterialCheck({
      product: odd, inputLitres: 10, packCounts: {}, itemsById: byId(sugar), stockOf: stocks({ sugar: { loose: 100, packs: {} } }),
    });
    expect(check.needs[0].need).toBeNull();
    expect(check.needs[0].problem).toBe('unit');
    expect(check.lines[0].cost).toBe(0);
    expect(check.blocking).toHaveLength(1);
  });

  it('adds packaging for ready-made packs only and sums it with the recipe per material', () => {
    const withCupInRecipe = { ...yogurt, recipe: [{ item_id: 'cup', item_name: 'Cup', quantity: 1, unit: 'pcs', type: 'Packaging' as const }] };
    const check = batchMaterialCheck({
      product: withCupInRecipe, inputLitres: 10, packCounts: { tub: 30, dozen: 5 }, itemsById: byId(cup), stockOf: stocks({ cup: { loose: 40, packs: {} } }),
    });
    expect(check.lines.map(l => [l.kind, l.qty])).toEqual([['recipe', 1], ['packaging', 30]]);
    expect(check.needs[0].need).toBe(31);
    expect(check.needs[0].problem).toBeNull();
  });

  it('blocks a material missing from the catalog and warns when the recipe has no base quantity', () => {
    const missing = batchMaterialCheck({ product: yogurt, inputLitres: 10, packCounts: {}, itemsById: byId(sugar), stockOf: stocks({ sugar: { loose: 9, packs: {} } }) });
    expect(missing.blocking.map(n => [n.itemId, n.problem])).toEqual([['culture', 'missing']]);

    const noBase = batchMaterialCheck({ product: { ...yogurt, recipe_base_quantity: 0 }, inputLitres: 10, packCounts: {}, itemsById: byId(sugar, culture), stockOf: stocks({}) });
    expect(noBase.lines).toEqual([]);
    expect(noBase.warnings).toHaveLength(1);
  });
});

describe('batchOutputPreview', () => {
  it('shows each pile before and after, multi-units excluded', () => {
    const preview = batchOutputPreview(yogurt, { loose: 4, packs: { tub: 6 } }, 5.0004, { tub: 20, dozen: 3 });
    expect(preview.rows.map(r => [r.id, r.before, r.add, r.after])).toEqual([['loose', 4, 5, 9], ['tub', 6, 20, 26]]);
    expect(preview.addedBase).toBe(15);
    expect(preview.totalBefore).toBe(7);
    expect(preview.totalAfter).toBe(22);
  });
});

describe('batchCancelPlan', () => {
  const batch = (details: unknown): ProductionBatch => ({
    id: 'b1', batch_number: 'B-1', product_name: 'Yogurt', status: 'Processing', quantity_input: 12.5, input_cost_per_unit: 180,
    quantity_output_estimated: 10, wastage: 0, start_date: '', logs: [], details,
  } as unknown as ProductionBatch);
  const mlMilk = item({ id: 'item_cow_milk', name: 'Cow Milk', unit: 'ml' });

  it('sends counter milk back to its item in the item unit and the rest to the pool', () => {
    const plan = batchCancelPlan(batch({
      milk_type: 'Cow',
      milk_breakdown: [
        { allocationId: 'alloc_1', quantity: 10, source: 'fresh' },
        { allocationId: 'item_cow_milk', quantity: 2.5, source: 'retail' },
      ],
    }), byId(mlMilk));
    expect(plan.counter).toEqual([{ itemId: 'item_cow_milk', name: 'Cow Milk', litres: 2.5, stockQty: 2500, stockUnit: 'ml', converted: true }]);
    expect(plan.poolLitres).toBe(10);
    expect(plan.poolMilkType).toBe('Cow');
    expect(plan.poolLotName).toBe('Return: Batch #B-1 (Yogurt)');
  });

  it('puts counter milk of a deleted item into the pool', () => {
    const plan = batchCancelPlan(batch({ milk_breakdown: [{ allocationId: 'inv_gone', quantity: 12.5, source: 'retail' }] }), byId());
    expect(plan.counter).toEqual([]);
    expect(plan.orphanCounterLitres).toBe(12.5);
    expect(plan.poolLitres).toBe(12.5);
  });
});

describe('stockLookup', () => {
  it('reads the inventory row first and the catalog mirror as fallback', () => {
    const inv = [{ id: 'inv_sugar', name: 'Sugar', category: '', stock_type: 'Raw Material', quantity: 7, unit: 'kg', price: 0, variant_stocks: { bag: 2 } }] as unknown as InventoryItem[];
    const lookup = stockLookup([{ ...sugar, stock: 1 }, { ...cup, stock: 3 }], inv);
    expect(lookup('sugar')).toEqual({ loose: 7, packs: { bag: 2 } });
    expect(lookup('cup')).toEqual({ loose: 3, packs: {} });
  });
});
