import { cleanQty, formatQty } from '../../lib/formatters';
import { pileBreakdown, readStock } from '../../lib/stockRules';
import { convertQuantity } from '../../lib/unitConversion';
import type { InventoryItem, ItemDefinition, ItemVariant, ProductionBatch, UnitDefinition } from '../../types';

// What a production batch takes from stock and puts back, worked out before anything is saved, so
// the batch sheet can show it and refuse to complete a batch whose materials are short or can't be
// converted (docs/stock-model.md, "Production complete" and "batch cancel").

const EPS = 0.0005;

/** One product's piles: loose stock in the base unit and the count of each ready-made pack. */
export interface PileStock {
  loose: number;
  packs: Record<string, number>;
}

/** Live piles of an item: the inventory row is the source, the catalog mirror the fallback. */
export function stockLookup(items: ItemDefinition[], inventory: InventoryItem[]): (itemId: string) => PileStock {
  const rows = new Map<string, InventoryItem>();
  for (const row of inventory) {
    const id = row.item_id || (row.id.startsWith('inv_') ? row.id.slice(4) : '');
    if (id && !rows.has(id)) rows.set(id, row);
  }
  const byId = new Map(items.map(item => [item.id, item]));
  return (itemId: string) => {
    const row = rows.get(itemId);
    const item = byId.get(itemId);
    return {
      loose: Number(row ? row.quantity : item?.stock) || 0,
      packs: (row?.variant_stocks || item?.variant_stocks || {}) as Record<string, number>,
    };
  };
}

/** Ready-made packs a batch can be packed into (multi-units like dozen are only a view of loose stock). */
export const outputPacksOf = (product?: ItemDefinition): ItemVariant[] =>
  (product?.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true);

/** One recipe or packaging line, priced in the material's own stock unit (the cost table). */
export interface MaterialLine {
  kind: 'recipe' | 'packaging';
  itemId: string;
  name: string;
  /** Needed in the material's stock unit; null when the recipe unit can't be converted to it. */
  qty: number | null;
  unit: string;
  /** As written on the recipe / pack. */
  rawQty: number;
  rawUnit: string;
  cost: number;
}

export type MaterialProblem = 'missing' | 'unit' | 'short';

/** One material across all its lines, against what is on hand. */
export interface MaterialNeed {
  itemId: string;
  name: string;
  unit: string;
  /** Total needed in the stock unit; null when a line can't be converted. */
  need: number | null;
  /** Positive loose and pack piles, in the stock unit (packs are opened when loose runs out). */
  available: number;
  /** "2 kg loose · 3 × 50 kg bag", for the row. */
  piles: string[];
  problem: MaterialProblem | null;
  shortBy: number;
  message: string;
}

export interface MaterialCheck {
  lines: MaterialLine[];
  needs: MaterialNeed[];
  /** Needs that stop the batch from completing. */
  blocking: MaterialNeed[];
  /** Things the owner should know that don't stop completion. */
  warnings: string[];
}

interface MaterialCheckInput {
  product?: ItemDefinition;
  /** Litres of milk in the batch (the recipe is scaled by it). */
  inputLitres: number;
  /** Ready-made packs being filled, by variant id (their packaging is used up). */
  packCounts: Record<string, number>;
  itemsById: Map<string, ItemDefinition>;
  stockOf: (itemId: string) => PileStock;
  customUnits?: UnitDefinition[];
}

const qtyText = (qty: number, unit: string) => `${formatQty(qty, 3)} ${unit}`.trim();

/**
 * Materials the batch uses up on completion: recipe ingredients scaled to the milk, plus packaging for
 * every pack filled. A recipe unit that can't be converted to the material's stock unit, a material
 * missing from the catalog, or a shortfall (loose + packs) blocks completion; nothing is deducted raw.
 */
export function batchMaterialCheck({ product, inputLitres, packCounts, itemsById, stockOf, customUnits = [] }: MaterialCheckInput): MaterialCheck {
  const lines: MaterialLine[] = [];
  const warnings: string[] = [];
  const recipe = (product?.recipe || []).filter(ing => ing.item_id && Number(ing.quantity) > 0);
  const base = Number(product?.recipe_base_quantity) || 0;

  if (recipe.length > 0 && base <= 0) {
    warnings.push('Recipe mein "kitne litre doodh par" (base quantity) set nahi, is liye recipe ke materials stock se nahi katenge. Catalog mein recipe theek karein.');
  }
  if (base > 0) {
    const scale = inputLitres / base;
    for (const ing of recipe) {
      const material = itemsById.get(ing.item_id);
      const rawQty = cleanQty(Number(ing.quantity) * scale);
      const rawUnit = ing.unit || material?.unit || '';
      const unit = material?.unit || rawUnit;
      const converted = rawUnit && unit ? convertQuantity(rawQty, rawUnit, unit, customUnits) : rawQty;
      const qty = converted === null ? null : cleanQty(converted);
      lines.push({
        kind: 'recipe', itemId: ing.item_id, name: material?.name || ing.item_name || 'Material', qty, unit, rawQty, rawUnit,
        cost: qty === null ? 0 : qty * (Number(material?.cost_price) || 0),
      });
    }
  }

  for (const pack of outputPacksOf(product)) {
    const count = Math.max(0, Math.floor(Number(packCounts[pack.id]) || 0));
    const each = Number(pack.packaging_qty) || 0;
    if (!pack.packaging_item_id || count <= 0 || each <= 0) continue;
    const material = itemsById.get(pack.packaging_item_id);
    const qty = cleanQty(count * each);
    const unit = material?.unit || '';
    lines.push({
      kind: 'packaging', itemId: pack.packaging_item_id, name: `${pack.name} packaging (${material?.name || pack.packaging_item_name || 'material'})`,
      qty, unit, rawQty: qty, rawUnit: unit, cost: qty * (Number(material?.cost_price) || 0),
    });
  }

  const byItem = new Map<string, MaterialLine[]>();
  for (const line of lines) byItem.set(line.itemId, [...(byItem.get(line.itemId) || []), line]);

  const needs: MaterialNeed[] = [];
  for (const [itemId, group] of byItem) {
    const material = itemsById.get(itemId);
    const name = material?.name || group[0].name;
    const unit = material?.unit || group[0].unit;
    const unconvertible = group.find(line => line.qty === null);
    const need = unconvertible ? null : cleanQty(group.reduce((sum, line) => sum + (line.qty || 0), 0));
    let available = 0;
    let piles: string[] = [];
    if (material) {
      const stock = stockOf(itemId);
      const reading = readStock(material, stock.loose, stock.packs);
      available = cleanQty(reading.piles
        .filter(p => p.kind === 'loose' || p.kind === 'packed')
        .reduce((sum, p) => sum + Math.max(0, p.baseQty), 0));
      piles = pileBreakdown(reading);
    }
    let problem: MaterialProblem | null = null;
    let message = '';
    let shortBy = 0;
    if (!material) {
      problem = 'missing';
      message = `${name}: ye material catalog mein nahi mila. Recipe / pack se hatayen ya material dobara banayen.`;
    } else if (unconvertible) {
      problem = 'unit';
      message = `${name}: recipe ki unit "${unconvertible.rawUnit || '—'}" ko stock ki unit "${unit}" mein badla nahi ja sakta. Recipe ya material ki unit theek karein.`;
    } else if (need !== null && need > available + EPS) {
      problem = 'short';
      shortBy = cleanQty(need - available);
      message = `${name}: ${qtyText(need, unit)} chahiye, stock mein ${qtyText(available, unit)} hai (${qtyText(shortBy, unit)} kam). Purchase ya stock count darj karein.`;
    }
    needs.push({ itemId, name, unit, need, available, piles, problem, shortBy, message });
  }

  return { lines, needs, blocking: needs.filter(n => n.problem !== null), warnings };
}

/** One output pile before and after the batch goes into stock. */
export interface OutputPileRow {
  id: string;
  name: string;
  /** 'loose' counts base units, 'pack' counts packs. */
  kind: 'loose' | 'pack';
  /** Base units in one pack (1 for loose). */
  contains: number;
  before: number;
  add: number;
  after: number;
}

export interface OutputPreview {
  rows: OutputPileRow[];
  /** Produced, in the base unit (loose + packs × size). */
  addedBase: number;
  totalBefore: number;
  totalAfter: number;
}

/** Product stock per pile after completion: loose += loose qty, each pack pile += its count. */
export function batchOutputPreview(product: ItemDefinition | undefined, stock: PileStock, looseQty: number, packCounts: Record<string, number>): OutputPreview {
  const loose = cleanQty(Math.max(0, looseQty));
  const packs = outputPacksOf(product);
  const rows: OutputPileRow[] = [{
    id: 'loose', name: 'Loose', kind: 'loose', contains: 1,
    before: cleanQty(stock.loose), add: loose, after: cleanQty(stock.loose + loose),
  }];
  const afterPacks: Record<string, number> = { ...stock.packs };
  let addedBase = loose;
  for (const pack of packs) {
    const add = Math.max(0, Math.floor(Number(packCounts[pack.id]) || 0));
    const before = cleanQty(Number(stock.packs[pack.id]) || 0);
    const contains = Number(pack.quantity_in_base_unit) || 0;
    rows.push({ id: pack.id, name: pack.name || 'Pack', kind: 'pack', contains, before, add, after: cleanQty(before + add) });
    afterPacks[pack.id] = cleanQty(before + add);
    addedBase += add * contains;
  }
  const item = product || { unit: '' };
  return {
    rows,
    addedBase: cleanQty(addedBase),
    totalBefore: readStock(item, stock.loose, stock.packs).totalBase,
    totalAfter: readStock(item, stock.loose + loose, afterPacks).totalBase,
  };
}

interface MilkPart {
  allocationId?: string;
  quantity?: number;
  source?: string;
  milkType?: string;
}

export interface CounterReturn {
  itemId: string;
  name: string;
  litres: number;
  /** In the item's own stock unit (ml milk gets ml back). */
  stockQty: number;
  stockUnit: string;
  /** False when litres can't be converted to the item's unit (the litres are added as they are). */
  converted: boolean;
}

export interface CancelPlan {
  counter: CounterReturn[];
  /** Litres that go back to the unallocated pool as a new "Return: Batch #..." lot. */
  poolLitres: number;
  poolLotName: string;
  poolMilkType: string;
  poolRate: number;
  /** Counter litres whose milk item no longer exists: they go to the pool instead. */
  orphanCounterLitres: number;
}

/**
 * Where a cancelled batch's milk goes, the same way the cancel writes it: counter milk back to that
 * milk item's loose stock (in its own unit), everything else to the pool. Materials are only used up
 * on completion, so a cancel returns none.
 */
export function batchCancelPlan(batch: ProductionBatch, itemsById: Map<string, ItemDefinition>, customUnits: UnitDefinition[] = []): CancelPlan {
  const input = cleanQty(Number(batch.quantity_input) || 0);
  const details = (batch.details || {}) as { milk_breakdown?: MilkPart[]; milk_type?: string; input_cost_per_unit?: number };
  const parts = Array.isArray(details.milk_breakdown) ? details.milk_breakdown : [];
  const counter: CounterReturn[] = [];
  let returned = 0;
  let orphan = 0;
  for (const part of parts) {
    const litres = cleanQty(Number(part?.quantity) || 0);
    if (part?.source !== 'retail' || litres <= 0) continue;
    const rawId = String(part.allocationId || '');
    const itemId = rawId.startsWith('inv_') ? rawId.slice(4) : rawId;
    const item = itemsById.get(itemId);
    if (!item) {
      orphan = cleanQty(orphan + litres);
      continue;
    }
    const unit = item.unit || 'L';
    const converted = convertQuantity(litres, 'L', unit, customUnits);
    counter.push({ itemId, name: item.name, litres, stockQty: cleanQty(converted ?? litres), stockUnit: unit, converted: converted !== null });
    returned = cleanQty(returned + litres);
  }
  const type = String(details.milk_type || '').toLowerCase();
  return {
    counter,
    poolLitres: cleanQty(Math.max(0, input - returned)),
    poolLotName: `Return: Batch #${batch.batch_number} (${batch.product_name})`,
    poolMilkType: type.includes('buffalo') ? 'Buffalo' : type.includes('cow') ? 'Cow' : 'Mixed',
    poolRate: Number(batch.input_cost_per_unit || details.input_cost_per_unit) || 0,
    orphanCounterLitres: orphan,
  };
}
