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
  /** The product is active (not archived / switched off). */
  isActive: boolean;
  /** Show this product in low / out / minus stock alerts: active and status is not `ok`. */
  alert: boolean;
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
  const status = stockStatus(picture, reorderLevel, isSale);
  const active = isActiveProduct(item);
  return {
    ...picture,
    unit: item.unit || 'unit',
    reorderLevel,
    status,
    hiddenPacks: counted.filter(p => !p.isActive && p.count !== 0),
    strayCounts: stray,
    isActive: active,
    alert: active && status !== 'ok',
  };
}

/** Archived / switched-off products (`is_active` or `isActive` false) get no stock alerts. */
export function isActiveProduct(item: { is_active?: boolean | null; isActive?: boolean | null }): boolean {
  return item.is_active !== false && item.isActive !== false;
}

/**
 * Loose stock and pack counts of one product. The live inventory row wins (sales, returns, counts and
 * purchases update it first); the catalog row fills in when there is no row or the row has no pack counts.
 */
export function stockCountsOf(
  item: { stock?: number | null; variant_stocks?: Record<string, number> | null },
  inventoryRow?: { quantity?: number | null; variant_stocks?: Record<string, number> | null } | null,
): { loose: number; variantStocks: Record<string, number> } {
  const rowQty = inventoryRow?.quantity;
  const loose = cleanQty(rowQty !== undefined && rowQty !== null ? Number(rowQty) || 0 : Number(item.stock) || 0);
  const rowPacks = inventoryRow?.variant_stocks;
  const variantStocks = rowPacks && Object.keys(rowPacks).length ? rowPacks : (item.variant_stocks || rowPacks || {});
  return { loose, variantStocks };
}

/** One line of a stock count (audit dialog, day close): every pile that can hold a number. */
export interface StockCountLine {
  /** 'loose', a pack id, or the id a stray count sits on. */
  id: string;
  kind: 'loose' | 'packed' | 'stray';
  label: string;
  /** What the system holds now, in this pile's own unit (base units for loose, packs otherwise). */
  current: number;
  /** Base units in one of this pile's units. */
  contains: number;
  /** A pack hidden from sale; still physical stock, still counted. */
  hidden: boolean;
}

/**
 * The piles a stock count must offer: loose, every ready-made pack (hidden ones too, they are
 * physical stock) and every stray count (a number on a dozen/tray or a deleted pack) so it can be
 * cleared. Multi-units are not listed: they are views of loose stock.
 */
export function stockCountLines(reading: StockReading): StockCountLine[] {
  const lines: StockCountLine[] = [];
  reading.piles.forEach(p => {
    if (p.kind === 'loose') lines.push({ id: 'loose', kind: 'loose', label: `Loose (${reading.unit})`, current: p.count, contains: 1, hidden: false });
    else if (p.kind === 'packed') lines.push({ id: p.id, kind: 'packed', label: `${p.name}${p.isActive ? '' : ' (hidden)'}`, current: p.count, contains: p.contains, hidden: !p.isActive });
  });
  reading.strayCounts.forEach(p => lines.push({ id: p.id, kind: 'stray', label: `Old ${p.name} count (clear to 0)`, current: p.count, contains: p.contains, hidden: true }));
  return lines;
}

/**
 * The moves a stock count makes: each counted pile by its difference to the counted number
 * (send these to `adjust_item_stock`). Piles left out of `counted` don't move. A stray count can
 * only be cleared, so any number given for it moves it to 0. Unknown ids are ignored.
 */
export function stockCountMoves(reading: StockReading, counted: { loose?: number | null; packs?: Record<string, number | null | undefined> }): LogStockDelta {
  const lines = stockCountLines(reading);
  const loose = lines.find(l => l.kind === 'loose');
  const target = logNumber(counted.loose);
  const looseDelta = loose && target !== undefined ? cleanQty(target - loose.current) : 0;
  const packDeltas: Record<string, number> = {};
  Object.entries(counted.packs || {}).forEach(([id, raw]) => {
    const line = lines.find(l => l.id === id && l.kind !== 'loose');
    const value = logNumber(raw);
    if (!line || value === undefined) return;
    const delta = cleanQty((line.kind === 'stray' ? 0 : value) - line.current);
    if (delta !== 0) packDeltas[id] = delta;
  });
  return { looseDelta, packDeltas };
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

/** Readable status words used across the app. */
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  minus: 'Minus stock',
  out: 'Out of stock',
  low: 'Low stock',
  ok: 'In stock',
};

export interface LogStockDelta {
  looseDelta: number;
  packDeltas: Record<string, number>;
  /**
   * Set when the row says packs moved but not which ones, so its pack part can't be posted:
   * old pack audits (notes "Variant Audit", the pack count change stored in the loose columns) and
   * server day-close counts ("· 2 variant adjustment(s)", whose loose part is still right).
   * Show a warning; never post the number to loose stock or guess a pack.
   */
  unrecordedPacks?: boolean;
}

/** A real number from a log field, or undefined for missing / null / '' / NaN (Number(null) is 0, which is a lie here). */
function logNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Shift-closing rows (count, spoilage, wastage, staff tea) name their pile at the end of the id. */
const CLOSING_LOG_ID = /^log_(cnt|spoil|waste|tea)_/;

/**
 * The pack a shift-closing row moved, read from its id `log_cnt_<closingId>_<itemId>_<pile>`, or
 * undefined for a loose row or any other id. Those rows have no details, and for a pack pile their
 * loose columns hold that pack's count.
 */
function closingLogPack(log: { id?: string | null; item_id?: string | null }): string | undefined {
  const id = String(log.id || '');
  const itemId = String(log.item_id || '');
  if (!itemId || !CLOSING_LOG_ID.test(id)) return undefined;
  const marker = `_${itemId}_`;
  const at = id.lastIndexOf(marker);
  if (at < 0) return undefined;
  const pile = id.slice(at + marker.length);
  return pile && pile !== 'loose' && pile !== 'base' ? pile : undefined;
}

/**
 * The pile moves recorded on one inventory_logs row, whatever shape it was written in:
 * `details.variant_deltas` (sales, production, opening stock), `details.variant_id` + `variant_delta`
 * (counts, purchases, returns, write-off) or no details at all (loose only, except shift-closing rows
 * that name a pack in their id, and the legacy pack audits and day-close counts flagged by `unrecordedPacks`).
 */
export function logStockDelta(log: { id?: string | null; item_id?: string | null; difference?: number | null; old_quantity?: number | null; new_quantity?: number | null; notes?: string | null; details?: Record<string, unknown> | null }): LogStockDelta {
  const details = (log.details && typeof log.details === 'object' ? log.details : {}) as { loose_delta?: unknown; variant_deltas?: unknown; variant_id?: unknown; variant_delta?: unknown };
  const detailLoose = logNumber(details.loose_delta);
  const structured = detailLoose !== undefined || typeof details.variant_id === 'string' || Boolean(details.variant_deltas && typeof details.variant_deltas === 'object');
  const notes = String(log.notes || '');
  const closingPack = structured ? undefined : closingLogPack(log);
  if (closingPack) {
    const count = cleanQty(logNumber(log.difference) ?? ((logNumber(log.new_quantity) ?? 0) - (logNumber(log.old_quantity) ?? 0)));
    return { looseDelta: 0, packDeltas: count !== 0 ? { [closingPack]: count } : {} };
  }
  // Before pack moves rode in details, a pack audit wrote its pack-count change into the loose columns.
  const legacyPackAudit = !structured && /variant audit/i.test(notes);
  // The server day-close count writes the loose delta in the columns and only counts its pack moves in the notes.
  const dayCloseWithPacks = !structured && /variant adjustment/i.test(notes);
  const fromColumns = logNumber(log.difference) ?? ((logNumber(log.new_quantity) ?? 0) - (logNumber(log.old_quantity) ?? 0));
  const looseDelta = cleanQty(detailLoose ?? (legacyPackAudit ? 0 : fromColumns));
  const packDeltas: Record<string, number> = {};
  if (details.variant_deltas && typeof details.variant_deltas === 'object') {
    Object.entries(details.variant_deltas as Record<string, unknown>).forEach(([id, d]) => {
      const delta = cleanQty(Number(d) || 0);
      if (delta !== 0) packDeltas[id] = cleanQty((packDeltas[id] || 0) + delta);
    });
  }
  if (typeof details.variant_id === 'string' && details.variant_id !== 'loose' && details.variant_id !== 'base') {
    const delta = cleanQty(Number(details.variant_delta) || 0);
    if (delta !== 0) packDeltas[details.variant_id] = cleanQty((packDeltas[details.variant_id] || 0) + delta);
  }
  const result: LogStockDelta = { looseDelta, packDeltas };
  if ((legacyPackAudit && cleanQty(fromColumns) !== 0) || dayCloseWithPacks) result.unrecordedPacks = true;
  return result;
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
