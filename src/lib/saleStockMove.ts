import { cleanQty } from './formatters';
import { saleLineStock, type SaleLineStock } from './sellUnits';

type CatalogVariant = { id: string; quantity_in_base_unit?: number; deduct_from_base?: boolean };

/**
 * The pile one bill line moves, exactly as the server does it (app_private.sale_line_stock,
 * supabase/migrations/20261024105000): `saleLineStock` (the bill's snapshot wins, the catalog fills
 * gaps) plus one catalog check. A pack line whose pack the product no longer has as a ready-made
 * pack (deleted, or turned into a dozen/tray) has no pile any more, so its base quantity moves loose
 * stock instead of leaving a count no pile owns.
 *
 * Used for the optimistic POS update, the offline projection, the sync payload and sales returns,
 * so the screen moves the same piles the server will. Quantities below zero count as zero.
 */
export function saleLineMove(
  line: Parameters<typeof saleLineStock>[0],
  item?: { variants?: CatalogVariant[] | null } | null
): SaleLineStock & { fallback: boolean } {
  const qty = Math.max(0, Number(line.qty) || 0);
  const stock = saleLineStock({ ...line, qty }, item ? { variants: item.variants || [] } : null);
  if (stock.fromBase || !item) return { ...stock, fallback: false };
  const pack = (item.variants || []).find(v => v.id === stock.variantId);
  if (pack && pack.deduct_from_base !== true) return { ...stock, fallback: false };
  return { fromBase: true, contains: stock.contains, variantId: undefined, stockQty: stock.baseQty, baseQty: stock.baseQty, fallback: true };
}

/** Loose and per-pack deltas for a set of moves on one product (negative = stock leaves). */
export function addMove(
  into: { loose: number; packs: Record<string, number> },
  move: SaleLineStock,
  sign: 1 | -1
): void {
  if (move.fromBase || !move.variantId) {
    into.loose = cleanQty(into.loose + sign * move.baseQty);
  } else {
    into.packs[move.variantId] = cleanQty((into.packs[move.variantId] || 0) + sign * move.stockQty);
  }
}
