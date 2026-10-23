import type { InventoryItem, ItemDefinition, ItemType } from '../../types';
import { describeItemStock, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';

export const ITEM_TYPES: ItemType[] = ['Raw material', 'Packaging material', 'Sale product'];

export type StockTone = 'ok' | 'low' | 'out';
export type TypeFilter = 'All' | ItemType;
export type StatusFilter = 'All' | 'Active' | 'Inactive';
export type StockFilter = 'all' | 'low' | 'out';
export type SortField = 'sort_order' | 'name' | 'stock' | 'selling_price' | 'cost_price' | 'margin';
export type SortOrder = 'asc' | 'desc';

/** Price and cost of the unit people actually buy: the loose rate, else the first priced pack. */
export interface ProfitBasis {
  sell: number;
  cost: number;
  per: string;
}

type PricedItem = Pick<ItemDefinition, 'selling_price' | 'cost_price' | 'unit' | 'allow_loose_sale' | 'variants'>;

export function profitBasisFor(item: PricedItem): ProfitBasis | null {
  const rate = Number(item.selling_price) || 0;
  const cost = Number(item.cost_price) || 0;
  // With loose sale off nobody pays the per-unit rate, so profit follows the first priced pack.
  const looseRate = item.allow_loose_sale !== false ? rate : 0;
  if (looseRate > 0) return { sell: looseRate, cost, per: item.unit };
  const pack = (item.variants || []).filter(v => v.isActive !== false).find(v => sellUnitPrice(rate, sellUnitContains(v), v.selling_price) > 0);
  if (!pack) return null;
  const contains = sellUnitContains(pack);
  return { sell: sellUnitPrice(rate, contains, pack.selling_price), cost: cost * contains, per: pack.name };
}

/** Margin is profit as a share of the selling price; markup is profit as a share of cost. */
export function profitOf(basis: ProfitBasis | null) {
  if (!basis) return { profit: 0, marginPct: null as number | null, markupPct: null as number | null };
  const profit = basis.sell - basis.cost;
  return {
    profit,
    marginPct: basis.sell > 0 ? (profit / basis.sell) * 100 : null,
    markupPct: basis.cost > 0 ? (profit / basis.cost) * 100 : null,
  };
}

export interface CatalogRow {
  item: ItemDefinition;
  isSale: boolean;
  loose: number;
  variantStocks: Record<string, number>;
  /** Loose plus ready-made packs, in the base unit. */
  totalBase: number;
  /** What the POS can sell right now, in the base unit. */
  sellable: number;
  reorder: number;
  tone: StockTone;
  costValue: number;
  basis: ProfitBasis | null;
  profit: number;
  marginPct: number | null;
  packsOnly: boolean;
  /** Lower-cased name and categories for search. */
  haystack: string;
}

/** One pass over the catalog: stock picture, tone and margin per product, keyed by item id. */
export function buildCatalogRows(items: ItemDefinition[], inventory: InventoryItem[] | undefined): Map<string, CatalogRow> {
  const byItemId = new Map<string, InventoryItem>();
  const byName = new Map<string, InventoryItem>();
  (inventory || []).forEach(inv => {
    if (inv.item_id) {
      if (!byItemId.has(inv.item_id)) byItemId.set(inv.item_id, inv);
    } else if (inv.name) {
      const key = inv.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, inv);
    }
  });

  const rows = new Map<string, CatalogRow>();
  items.forEach(item => {
    const inv = byItemId.get(item.id) || byName.get(item.name.toLowerCase());
    const loose = Number(inv?.quantity ?? (item as { stock?: number }).stock ?? 0) || 0;
    const variantStocks = (inv?.variant_stocks || item.variant_stocks || {}) as Record<string, number>;
    const picture = describeItemStock(item, loose, variantStocks);
    const reorder = Number(item.reorder_level) || 5;
    const sellable = picture.sellableBase;
    const basis = profitBasisFor(item);
    const { profit, marginPct } = profitOf(basis);
    rows.set(item.id, {
      item,
      isSale: Boolean(item.item_type?.includes('Sale product')),
      loose,
      variantStocks,
      totalBase: picture.totalBase,
      sellable,
      reorder,
      tone: sellable <= 0 ? 'out' : sellable <= reorder ? 'low' : 'ok',
      costValue: picture.costValue,
      basis,
      profit,
      marginPct,
      packsOnly: item.allow_loose_sale === false,
      haystack: `${item.name} ${(item.category || []).join(' ')}`.toLowerCase(),
    });
  });
  return rows;
}

export interface CatalogQuery {
  search: string;
  type: TypeFilter;
  category: string;
  status: StatusFilter;
  stock: StockFilter;
  sortField: SortField;
  sortOrder: SortOrder;
}

export function filterAndSort(rows: CatalogRow[], q: CatalogQuery): CatalogRow[] {
  const terms = q.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = rows.filter(row => {
    const { item } = row;
    if (q.status === 'Active' && item.isActive === false) return false;
    if (q.status === 'Inactive' && item.isActive !== false) return false;
    if (q.type !== 'All' && !item.item_type?.includes(q.type)) return false;
    if (q.category !== 'All' && !item.category?.includes(q.category)) return false;
    if (q.stock === 'low' && row.tone !== 'low') return false;
    if (q.stock === 'out' && row.tone !== 'out') return false;
    return terms.every(term => row.haystack.includes(term));
  });

  const dir = q.sortOrder === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    let diff = 0;
    switch (q.sortField) {
      case 'name': diff = a.item.name.localeCompare(b.item.name); break;
      case 'stock': diff = a.totalBase - b.totalBase; break;
      case 'selling_price': diff = (a.basis?.sell ?? 0) - (b.basis?.sell ?? 0); break;
      case 'cost_price': diff = (Number(a.item.cost_price) || 0) - (Number(b.item.cost_price) || 0); break;
      case 'margin': diff = (a.marginPct ?? -Infinity) - (b.marginPct ?? -Infinity); break;
      case 'sort_order': {
        const orderA = a.item.sort_order ?? 999;
        const orderB = b.item.sort_order ?? 999;
        diff = orderA !== orderB ? orderA - orderB : a.item.name.localeCompare(b.item.name);
        break;
      }
    }
    // Ties always read A to Z, whichever way the main column runs.
    return diff !== 0 ? diff * dir : a.item.name.localeCompare(b.item.name);
  });
}

/** Category names to offer: the saved list plus any category a product already carries. */
export function categoryOptions(categories: string[], items: ItemDefinition[]): string[] {
  const seen = new Map<string, string>();
  [...categories, ...items.flatMap(i => i.category || [])].forEach(name => {
    const clean = (name || '').trim();
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  });
  return Array.from(seen.values());
}

/**
 * POS positions for a reordered list. With a search or filter on, only the positions the visible
 * products already held are reshuffled, so hidden products keep their own POS numbers.
 */
export function posOrderUpdates(newOrderList: ItemDefinition[], allItems: ItemDefinition[]): { id: string; sort_order: number }[] {
  const visibleSale = newOrderList.filter(item => item.item_type?.includes('Sale product'));
  const allSaleCount = allItems.filter(item => item.item_type?.includes('Sale product')).length;
  if (visibleSale.length >= allSaleCount) return visibleSale.map((item, index) => ({ id: item.id, sort_order: index + 1 }));
  const slots = visibleSale.map(item => Number(item.sort_order ?? 999)).sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  return visibleSale.map((item, index) => ({ id: item.id, sort_order: slots[index] }));
}
