import { cleanNumber, cleanQty } from '../../lib/formatters';
import { pileBreakdown, readStock, STOCK_STATUS_LABEL, type StockReading, type StockStatus } from '../../lib/stockRules';
import { AdjustmentReason, type InventoryItem, type ItemDefinition } from '../../types';
import type { Tone } from '../ui';

export type { StockStatus } from '../../lib/stockRules';

/**
 * Reasons a person can give for a stock count. Flow reasons (sales / supply return, production,
 * opening stock) belong to their own documents: reports skip logs with those reasons, so a count saved
 * under one would vanish from the stock and profit figures.
 */
export const COUNT_REASONS: AdjustmentReason[] = [
  AdjustmentReason.STOCK_COUNT,
  AdjustmentReason.DATA_ENTRY_ERROR,
  AdjustmentReason.SPOILAGE,
  AdjustmentReason.INTERNAL_USE,
  AdjustmentReason.THEFT_LOSS,
];

export interface StockRow {
  item: ItemDefinition;
  /** Inventory ledger row id (`inv_<item id>`), or '' when the item has none. */
  invRecordId: string;
  /** Loose pile in the item's unit (may be negative when sales ran ahead of stock). */
  loose: number;
  variantStocks: Record<string, number>;
  /** Every number on the row comes from here (docs/stock-model.md). */
  reading: StockReading;
  /** "4 kg loose", "6 × 500 g tub", "2 × 1 kg tub (hidden)": one entry per pile, sizes never added together. */
  piles: string[];
  /** "2 old Dozen (clear in stock count)": counts that belong to no pile. */
  stray: string[];
  /** False when `piles` says nothing the total doesn't (only loose stock). Stray counts are shown regardless. */
  pileDetail: boolean;
  /** "≈ 6 Dozen · 2 Tray": loose stock in the item's multi-units. */
  multiUnitHint: string;
  isActive: boolean;
  isProduct: boolean;
  /** Inactive products get no low / out alerts. */
  alerting: boolean;
  status: StockStatus;
  /** Sale price for sale products, cost for materials. */
  rate: number;
  /** Pack-only products (loose sale off): cheapest active pack price. */
  fromPrice: number | null;
  /** Positive piles at their selling price, hidden packs included. */
  retailValue: number;
  costMissing: boolean;
  /** Any pile (or stray count) not at zero. */
  hasStock: boolean;
  search: string;
}

export const STATUS_BADGE: Record<StockStatus, { tone: Tone; label: string; solid?: boolean }> = {
  ok: { tone: 'success', label: STOCK_STATUS_LABEL.ok },
  low: { tone: 'warning', label: STOCK_STATUS_LABEL.low },
  out: { tone: 'danger', label: STOCK_STATUS_LABEL.out },
  minus: { tone: 'danger', label: STOCK_STATUS_LABEL.minus, solid: true },
};

const isOutLike = (status: StockStatus) => status === 'out' || status === 'minus';

/** Status filter / header bucket of a row: inactive products and healthy stock count in neither. */
export function alertOf(row: Pick<StockRow, 'alerting' | 'status'>): 'low' | 'out' | null {
  if (!row.alerting) return null;
  if (row.status === 'low') return 'low';
  return isOutLike(row.status) ? 'out' : null;
}

/**
 * One row per catalogue item, read with `readStock` so the list, the cards, the header counts, the
 * stock count and the history drawer agree with every other screen.
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
    const loose = stockRecord?.quantity !== undefined ? Number(stockRecord.quantity) || 0 : Number(item.stock) || 0;
    // Pack counts come from the same live row as loose stock; returns and counts update that row first.
    const variantStocks = (stockRecord?.variant_stocks || item.variant_stocks || {}) as Record<string, number>;
    const reading = readStock(item, loose, variantStocks);
    const parts = pileBreakdown(reading);
    // pileBreakdown lists the stray counts last, one entry each.
    const strayFrom = parts.length - reading.strayCounts.length;
    const isActive = item.isActive !== false;
    const isProduct = (item.item_type || []).includes('Sale product');
    const rate = Number(isProduct ? item.selling_price : item.cost_price) || 0;
    const activePacks = reading.piles.filter(p => p.kind === 'packed' && p.isActive);
    const packOnly = activePacks.length > 0 && item.allow_loose_sale === false;
    const multis = reading.piles.filter(p => p.kind === 'multi' && p.isActive);
    const retailValue = cleanNumber(reading.piles
      .filter(p => p.kind === 'loose' || p.kind === 'packed')
      .reduce((sum, p) => sum + Math.max(0, p.count) * p.price, 0));

    return {
      item,
      invRecordId: stockRecord?.id || '',
      loose,
      variantStocks,
      reading,
      piles: parts.slice(0, strayFrom),
      stray: parts.slice(strayFrom),
      pileDetail: strayFrom > 1 || reading.piles.some(p => p.kind === 'packed' && p.count !== 0),
      multiUnitHint: loose > 0 ? multis.map(p => `${cleanNumber(p.count, 1)} ${p.name}`).join(' · ') : '',
      isActive,
      isProduct,
      alerting: isActive,
      status: reading.status,
      rate,
      fromPrice: packOnly ? Math.min(...activePacks.map(p => p.price || rate)) : null,
      retailValue,
      costMissing: !(Number(item.cost_price) > 0) && reading.totalBase > 0,
      hasStock: reading.piles.some(p => p.kind !== 'multi' && p.count !== 0),
      search: `${item.name} ${(item.category || []).join(' ')}`.toLowerCase(),
    };
  });
}

/** One pile a stock count can set: the loose pile, a ready-made pack (hidden ones too) or a stray count to clear. */
export interface CountPile {
  /** 'loose' or the variant id, as `adjustStock` and the day-close count expect. */
  id: string;
  kind: 'loose' | 'pack' | 'stray';
  name: string;
  /** Current count in the pile's own unit (base units for loose, packs otherwise). */
  system: number;
  /** "kg" for loose, "packs" otherwise. */
  unitLabel: string;
  /** Base units in one counted unit. Stray counts belong to no pile, so they move no base stock. */
  contains: number;
  hidden: boolean;
  /** Packs are counted in whole numbers; stray counts can only be cleared to 0. */
  wholeOnly: boolean;
}

/** Every pile of one product that a count must be able to reach, loose first. */
export function countPiles(reading: StockReading): CountPile[] {
  const piles: CountPile[] = [];
  reading.piles.forEach(p => {
    if (p.kind === 'loose') {
      piles.push({ id: 'loose', kind: 'loose', name: `Loose ${reading.unit}`, system: p.count, unitLabel: reading.unit, contains: 1, hidden: false, wholeOnly: false });
    } else if (p.kind === 'packed' && (p.isActive || p.count !== 0)) {
      piles.push({ id: p.id, kind: 'pack', name: p.name, system: p.count, unitLabel: 'packs', contains: p.contains, hidden: !p.isActive, wholeOnly: true });
    }
  });
  reading.strayCounts.forEach(p => {
    piles.push({ id: p.id, kind: 'stray', name: p.name, system: p.count, unitLabel: 'old count', contains: 0, hidden: true, wholeOnly: true });
  });
  return piles;
}

export interface PileCount {
  /** Parsed count, or null when the box is empty (no change). */
  counted: number | null;
  error: string;
  /** Counted minus system, in the pile's own unit. */
  diff: number;
  /** The same move in base units. */
  baseDiff: number;
}

/** Reads what was typed for one pile. Empty means "not counted", never zero. */
export function readPileCount(pile: CountPile, typed: string | undefined): PileCount {
  const text = String(typed ?? '').trim().replace(/,/g, '');
  if (!text) return { counted: null, error: '', diff: 0, baseDiff: 0 };
  const value = Number(text);
  const error = !Number.isFinite(value) ? 'Sahi number likhein.'
    : value < 0 ? 'Minus ginti nahi ho sakti.'
    : pile.kind === 'stray' && value !== 0 ? 'Purani ginti sirf 0 ki ja sakti hai.'
    : pile.wholeOnly && !Number.isInteger(value) ? 'Packs poore number mein likhein.'
    : '';
  if (error) return { counted: null, error, diff: 0, baseDiff: 0 };
  const diff = cleanQty(value - pile.system);
  return { counted: cleanQty(value), error: '', diff, baseDiff: cleanQty(diff * pile.contains) };
}

export interface CountSummary {
  /** Piles whose count differs from the system. */
  changes: { pile: CountPile; counted: number; diff: number; baseDiff: number }[];
  errors: number;
  baseDiff: number;
}

/** What saving these typed counts would move. */
export function summarizeCounts(piles: CountPile[], typed: Record<string, string>): CountSummary {
  const changes: CountSummary['changes'] = [];
  let errors = 0;
  let baseDiff = 0;
  piles.forEach(pile => {
    const read = readPileCount(pile, typed[pile.id]);
    if (read.error) errors += 1;
    if (read.counted === null || read.diff === 0) return;
    changes.push({ pile, counted: read.counted, diff: read.diff, baseDiff: read.baseDiff });
    baseDiff += read.baseDiff;
  });
  return { changes, errors, baseDiff: cleanQty(baseDiff) };
}

/** Opening stock makes sense only for an active product that has never moved and holds nothing. */
export function canSetOpening(row: Pick<StockRow, 'hasStock' | 'isActive'>, hasMovements: boolean): boolean {
  return row.isActive && !hasMovements && !row.hasStock;
}
