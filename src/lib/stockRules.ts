/**
 * One way to read and show a product's stock, for every screen (POS, catalog, inventory, purchase,
 * production, dashboard, reports). The rules are written down in docs/stock-model.md; change them
 * there and here together, never per screen.
 *
 * Piles (see `describeItemStock`): loose stock in the base unit (`items.stock`), ready-made packs that
 * hold their own count (`items.variant_stocks[id]`, variants with `deduct_from_base !== true`), and
 * multi-units (dozen, tray) that are only a view of loose stock and never hold a count.
 */
import { describeItemStock, sellUnitContains, type StockPicture, type StockPile } from './sellUnits';
import { cleanQty, formatQty } from './formatters';

export type StockStatus = 'minus' | 'out' | 'low' | 'ok';

/** The catalog fields the rules read. `ItemDefinition` and the raw `items` row both fit. */
export type StockItemLike = Parameters<typeof describeItemStock>[0] & {
  reorder_level?: number | null;
  is_active?: boolean;
  isActive?: boolean;
};

export interface StockReading extends StockPicture {
  unit: string;
  /** 0 means "no low-stock alert" for this product. */
  reorderLevel: number;
  status: StockStatus;
  /** Ready-made pack piles that still hold stock but are hidden from sale. They must stay countable. */
  hiddenPacks: StockPile[];
  /** Counts on multi-units or deleted packs: they belong to no pile and must be cleared in a stock count. */
  strayCounts: StockPile[];
}

/** Reorder level in the base unit; anything missing, zero or negative means no alert. */
export function reorderLevelOf(item: { reorder_level?: number | null }): number {
  const level = Number(item.reorder_level);
  return Number.isFinite(level) && level > 0 ? level : 0;
}

/**
 * The one status rule:
 * - `minus`: any pile is below zero (shows "Minus stock", counts as out).
 * - `out`: nothing on hand, or (for sale products) nothing the POS can sell.
 * - `low`: physical total at or below the reorder level (base unit). No alert when the level is 0.
 * - `ok`: otherwise.
 */
export function stockStatus(picture: StockPicture, reorderLevel: number, isSaleProduct = true): StockStatus {
  const hasMinus = picture.piles.some(p => (p.kind === 'loose' || p.kind === 'packed') && p.count < 0);
  if (hasMinus) return 'minus';
  if (picture.totalBase <= 0 || (isSaleProduct && picture.sellableBase <= 0)) return 'out';
  if (reorderLevel > 0 && picture.totalBase <= reorderLevel) return 'low';
  return 'ok';
}

/** Everything a screen needs about one product's stock. */
export function readStock(item: StockItemLike, looseStock: number, variantStocks?: Record<string, number> | null): StockReading {
  const picture = describeItemStock(item, looseStock, variantStocks);
  const reorderLevel = reorderLevelOf(item);
  const isSale = !item.item_type || item.item_type.includes('Sale product');
  const counted = picture.piles.filter(p => p.kind === 'packed');
  // describeItemStock reports counts stored on a multi-unit or a deleted pack as `orphan` piles.
  const stray: StockPile[] = picture.piles.filter(p => p.kind === 'orphan');
  return {
    ...picture,
    unit: item.unit || 'unit',
    reorderLevel,
    status: stockStatus(picture, reorderLevel, isSale),
    hiddenPacks: counted.filter(p => !p.isActive && p.count !== 0),
    strayCounts: stray,
  };
}

/** "12.5 kg" with the app's quantity rounding (3 decimals, no trailing zeros). */
export function formatBaseQty(qty: number, unit: string): string {
  return `${formatQty(cleanQty(qty), 3)} ${unit}`.trim();
}

/**
 * Pile by pile, for detail views and tooltips: ["12 kg loose", "8 × 500 g pouch", "2 × 1 kg (hidden)"].
 * Different pack sizes are never added together as "N packs".
 */
export function pileBreakdown(reading: StockReading): string[] {
  const parts: string[] = [];
  reading.piles.forEach(p => {
    if (p.kind === 'loose' && (p.count !== 0 || reading.piles.every(x => x.kind === 'loose' || x.kind === 'multi'))) {
      parts.push(`${formatBaseQty(p.count, reading.unit)} loose`);
    } else if (p.kind === 'packed' && p.count !== 0) {
      parts.push(`${formatQty(p.count, 3)} × ${p.name}${p.isActive ? '' : ' (hidden)'}`);
    }
  });
  reading.strayCounts.forEach(p => parts.push(`${formatQty(p.count, 3)} old ${p.name} (clear in stock count)`));
  return parts;
}

/**
 * The short label a POS product card shows: what can be sold right now.
 * - Only one active pack type holds the sellable stock and loose can't be sold: "8 pouch".
 * - Otherwise the sellable total in the base unit: "16 kg".
 */
export function sellableLabel(reading: StockReading): string {
  const loose = reading.piles.find(p => p.kind === 'loose');
  const looseSellable = Boolean(loose && loose.isActive && loose.count > 0) || reading.piles.some(p => p.kind === 'multi' && p.isActive && (loose?.count || 0) > 0);
  const activePacks = reading.piles.filter(p => p.kind === 'packed' && p.isActive && p.count > 0);
  if (!looseSellable && activePacks.length === 1) {
    return `${formatQty(activePacks[0].count, 3)} ${activePacks[0].name}`;
  }
  return formatBaseQty(Math.max(0, reading.sellableBase), reading.unit);
}

/** Readable status words, Roman Urdu / English mix used across the app. */
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  minus: 'Minus stock',
  out: 'Out of stock',
  low: 'Low stock',
  ok: 'In stock',
};

export interface LogStockDelta {
  looseDelta: number;
  packDeltas: Record<string, number>;
}

/**
 * The pile moves recorded on one inventory_logs row, whatever shape it was written in:
 * `details.variant_deltas` (sales, production), `details.variant_id` + `variant_delta` (counts,
 * purchases, returns, write-off) or no details at all (loose only).
 */
export function logStockDelta(log: { difference?: number | null; old_quantity?: number | null; new_quantity?: number | null; details?: Record<string, unknown> | null }): LogStockDelta {
  const details = (log.details || {}) as { loose_delta?: unknown; variant_deltas?: unknown; variant_id?: unknown; variant_delta?: unknown };
  const fromColumns = Number(log.difference);
  const looseDelta = cleanQty(
    Number.isFinite(Number(details.loose_delta)) ? Number(details.loose_delta)
    : Number.isFinite(fromColumns) ? fromColumns
    : (Number(log.new_quantity) || 0) - (Number(log.old_quantity) || 0),
  );
  const packDeltas: Record<string, number> = {};
  if (details.variant_deltas && typeof details.variant_deltas === 'object') {
    Object.entries(details.variant_deltas as Record<string, unknown>).forEach(([id, d]) => {
      const delta = cleanQty(Number(d) || 0);
      if (delta !== 0) packDeltas[id] = cleanQty((packDeltas[id] || 0) + delta);
    });
  }
  if (typeof details.variant_id === 'string' && details.variant_id !== 'loose') {
    const delta = cleanQty(Number(details.variant_delta) || 0);
    if (delta !== 0) packDeltas[details.variant_id] = cleanQty((packDeltas[details.variant_id] || 0) + delta);
  }
  return { looseDelta, packDeltas };
}

/** A log row's total move in base units: loose plus each ready-made pack × its size. Multi-unit ids add nothing. */
export function logBaseDelta(delta: LogStockDelta, variants?: { id: string; quantity_in_base_unit?: number; deduct_from_base?: boolean }[] | null): number {
  let total = delta.looseDelta;
  Object.entries(delta.packDeltas).forEach(([id, d]) => {
    const variant = (variants || []).find(v => v.id === id);
    if (variant && variant.deduct_from_base !== true) total += d * sellUnitContains(variant);
  });
  return cleanQty(total);
}
