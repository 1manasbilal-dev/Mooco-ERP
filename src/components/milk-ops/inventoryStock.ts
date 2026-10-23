import { itemStockValue, type ItemStockValue } from '../../lib/stockProfit';
import type { InventoryItem, ItemDefinition, ItemVariant } from '../../types';
import type { Tone } from '../ui';

export type StockStatus = 'ok' | 'low' | 'out' | 'negative';

export interface StockRow {
  item: ItemDefinition;
  /** Loose stock in the item's unit (may be negative when sales ran ahead of stock). */
  quantity: number;
  variantStocks: Record<string, number>;
  /** Inventory ledger row id (`inv_<item id>`), or '' when the item has none. */
  invRecordId: string;
  valuation: ItemStockValue;
  /** Pre-packed sizes with their own pack count. */
  packaged: ItemVariant[];
  /** Sizes sold out of loose stock (dozen, tray). */
  multiUnits: ItemVariant[];
  packCount: number;
  packagedOnly: boolean;
  isProduct: boolean;
  /** Sale price for sale products, cost for materials. */
  rate: number;
  /** Packaged-only items: cheapest pack price. */
  fromPrice: number | null;
  reorderLevel: number;
  status: StockStatus;
  search: string;
}

export const STATUS_BADGE: Record<StockStatus, { tone: Tone; label: string; solid?: boolean }> = {
  ok: { tone: 'success', label: 'In stock' },
  low: { tone: 'warning', label: 'Low' },
  out: { tone: 'danger', label: 'Out' },
  negative: { tone: 'danger', label: 'Minus stock', solid: true },
};

const EPS = 0.0005;

/**
 * One stock rule for the list, the cards and the header counts. The old screen counted "low" one way in
 * the rows and another in the header, and showed a negative balance as "OK"; both are fixed here.
 * - Packaged-only items are judged by their pack count.
 * - Others: below zero is "Minus stock", nothing at all is "Out", and loose plus packed stock (in the
 *   item's unit) at or under the reorder level is "Low".
 */
export function buildStockRows(items: ItemDefinition[], inventory: InventoryItem[]): StockRow[] {
  const byItemId = new Map<string, InventoryItem>();
  const byName = new Map<string, InventoryItem>();
  for (const row of inventory) {
    if (row.item_id && !byItemId.has(row.item_id)) byItemId.set(row.item_id, row);
    const key = (row.name || '').toLowerCase();
    if (!byName.has(key)) byName.set(key, row);
  }

  return items.map(item => {
    const stockRecord = byItemId.get(item.id) || byName.get((item.name || '').toLowerCase());
    const quantity = stockRecord?.quantity !== undefined ? Number(stockRecord.quantity) || 0 : Number((item as ItemDefinition & { stock?: number }).stock) || 0;
    // Pack counts come from the same live row as loose stock; returns and audits update that row first.
    const variantStocks = (stockRecord?.variant_stocks || item.variant_stocks || {}) as Record<string, number>;
    const valuation = itemStockValue(item, quantity, variantStocks);
    const active = (item.variants || []).filter(v => v.isActive !== false);
    const packaged = active.filter(v => v.deduct_from_base !== true);
    const multiUnits = active.filter(v => v.deduct_from_base === true);
    const packCount = valuation.packs.reduce((sum, p) => sum + p.count, 0);
    const packagedOnly = packaged.length > 0 && item.allow_loose_sale === false;
    const isProduct = (item.item_type || []).includes('Sale product');
    const rate = Number(isProduct ? item.selling_price : item.cost_price) || 0;
    const reorderLevel = item.reorder_level || 5;

    let status: StockStatus;
    if (packagedOnly) {
      status = packCount <= EPS ? (valuation.packs.some(p => p.count < -EPS) ? 'negative' : 'out') : packCount <= reorderLevel ? 'low' : 'ok';
    } else if (quantity < -EPS) {
      status = 'negative';
    } else if (quantity <= EPS && packCount <= EPS) {
      status = 'out';
    } else {
      status = valuation.totalBaseQty <= reorderLevel ? 'low' : 'ok';
    }

    return {
      item,
      quantity,
      variantStocks,
      invRecordId: stockRecord?.id || '',
      valuation,
      packaged,
      multiUnits,
      packCount,
      packagedOnly,
      isProduct,
      rate,
      fromPrice: packagedOnly ? Math.min(...packaged.map(v => v.selling_price || rate)) : null,
      reorderLevel,
      status,
      search: `${item.name} ${(item.category || []).join(' ')}`.toLowerCase(),
    };
  });
}
