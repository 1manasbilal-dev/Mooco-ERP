/**
 * Stock rules for the sell side (POS cards, quick entry, cart, customer orders), built on the shared
 * reading in src/lib/stockRules.ts (see docs/stock-model.md). Pure functions, so they are unit tested.
 *
 * Piles: loose stock in the base unit, ready-made packs with their own count, and multi-units
 * (dozen, tray) that sell from the loose pile. Hidden packs never sell; loose sale off blocks the
 * loose option but not a multi-unit.
 */
import { pileBreakdown, readStock, sellableLabel, type StockItemLike, type StockReading, type StockStatus } from '../../lib/stockRules';
import { cartLineContains, cartLineUsesMainStock, reservedBaseQty, sellUnitContains, sellUnitPrice, type CartSellLine } from '../../lib/sellUnits';
import { cleanQty, formatQty } from '../../lib/formatters';

/** Small float slack when a typed rupee amount turns into a quantity (e.g. 0.333 kg x 3). */
const STOCK_SLACK = 0.01;

export interface PosStockView {
  reading: StockReading;
  status: StockStatus;
  /** What the card says can be sold now ("16 kg", "8 500 g tub"). */
  label: string;
  /** Pile by pile, for the tooltip ("4 kg loose · 6 × 500 g tub · 2 × 1 kg tub (hidden)"). */
  detail: string;
  /** Loose sale on, or at least one active pack / multi-unit. */
  hasSellUnit: boolean;
}

/** One reading per product for the POS card. */
export function posStockView(item: StockItemLike, looseStock: number, variantStocks?: Record<string, number> | null): PosStockView {
  const reading = readStock(item, looseStock, variantStocks);
  const hasSellUnit = item.allow_loose_sale !== false || (item.variants || []).some(v => v.isActive !== false);
  return {
    reading,
    status: reading.status,
    label: sellableLabel(reading),
    detail: pileBreakdown(reading).join(' · '),
    hasSellUnit,
  };
}

/** Packs of one ready-made pack already in the cart, excluding one line. Pack twin of reservedBaseQty. */
export function reservedPackedQty(cart: CartSellLine[], productId: string, variantId: string, exceptCartItemId?: string): number {
  return cleanQty(cart
    .filter(line => line.id === productId && line.variantId === variantId && line.cartItemId !== exceptCartItemId && !cartLineUsesMainStock(line))
    .reduce((sum, line) => sum + (Number(line.qty) || 0), 0));
}

export interface PosSellProduct {
  id: string;
  unit?: string;
  price?: number;
  allow_loose_sale?: boolean;
  variants?: { id: string; name?: string; quantity_in_base_unit?: number; selling_price?: number; deduct_from_base?: boolean; isActive?: boolean }[];
  /** Loose pile in the base unit. */
  stock?: number;
  variant_stocks?: Record<string, number>;
}

/** One way the counter can sell a product. */
export interface PosSellOption {
  /** 'base' for loose, else the variant id. */
  id: string;
  name: string;
  kind: 'loose' | 'multi' | 'packed';
  /** Base units in one. */
  contains: number;
  price: number;
  /** Pile this option sells from, before the cart: base units for loose / multi-unit, packs for a ready-made pack. */
  pile: number;
  /** Same pile after the cart (other lines than `exceptCartItemId`). May be below zero. */
  pileLeft: number;
  /** How many of this option can still be sold after the cart, in its own unit. Never below zero. */
  available: number;
}

/**
 * Every option the counter may sell right now: loose (only when loose sale is on), then each active
 * pack or multi-unit. Hidden packs are left out. Availability is after what the cart already holds.
 */
export function posSellOptions(product: PosSellProduct, cart: CartSellLine[], exceptCartItemId?: string): PosSellOption[] {
  const loose = Number(product.stock) || 0;
  const rate = Number(product.price) || 0;
  const looseLeft = cleanQty(loose - reservedBaseQty(cart, product.id, exceptCartItemId));
  const options: PosSellOption[] = [];
  if (product.allow_loose_sale !== false) {
    options.push({ id: 'base', name: product.unit || 'unit', kind: 'loose', contains: 1, price: rate, pile: loose, pileLeft: looseLeft, available: Math.max(0, looseLeft) });
  }
  (product.variants || []).filter(v => v.isActive !== false).forEach(v => {
    const contains = sellUnitContains(v);
    const price = sellUnitPrice(rate, contains, v.selling_price);
    if (v.deduct_from_base === true) {
      options.push({ id: v.id, name: v.name || 'Unit', kind: 'multi', contains, price, pile: loose, pileLeft: looseLeft, available: Math.max(0, cleanQty(looseLeft / contains)) });
    } else {
      const own = cleanQty(Number(product.variant_stocks?.[v.id]) || 0);
      const left = cleanQty(own - reservedPackedQty(cart, product.id, v.id, exceptCartItemId));
      options.push({ id: v.id, name: v.name || 'Pack', kind: 'packed', contains, price, pile: own, pileLeft: left, available: Math.max(0, Math.floor(left + 1e-9)) });
    }
  });
  return options;
}

/** The option a new quick entry starts on: the requested one, else loose when it has stock, else the first option with stock. */
export function defaultSellOption(options: PosSellOption[], requested?: string | null): PosSellOption | undefined {
  return options.find(o => o.id === requested)
    || options.find(o => o.kind === 'loose' && o.available > 0)
    || options.find(o => o.available > 0)
    || options[0];
}

/** "12 left" / "0.5 Dozen left" for an option button, in the option's own unit. */
export function optionStockText(option: PosSellOption, baseUnit: string): string {
  if (option.kind === 'loose') return `${formatQty(option.available, 3)} ${baseUnit} left`;
  return `${formatQty(option.available, 3)} left`;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Yogurt (500 g tub)" or just "Yogurt" for loose. */
function lineLabel(productName: string, option: PosSellOption): string {
  return option.kind === 'loose' || sameText(option.name, productName) ? productName : `${productName} (${option.name})`;
}

/**
 * Why `qty` of this option can't go on the bill, or null when it can.
 * `qty` is the whole quantity of the line being added or set; other cart lines are already in `option`.
 */
export function sellQtyProblem(productName: string, option: PosSellOption, qty: number, allowNegativeStock: boolean, baseUnit: string): string | null {
  const label = lineLabel(productName, option);
  if (option.kind === 'packed' && Math.abs(qty - Math.round(qty)) >= 0.001) return `${label}: sells in whole packs only (1, 2, 3...).`;
  if (allowNegativeStock) return null;
  const need = option.kind === 'packed' ? qty : cleanQty(qty * option.contains);
  if (need <= option.pileLeft + STOCK_SLACK) return null;
  const inCart = cleanQty(option.pile - option.pileLeft) > 0;
  if (option.available <= 0) return `${label}: out of stock${inCart ? ' — what was left is in the cart' : ''}.`;
  const unitName = option.kind === 'loose' ? baseUnit : option.name;
  return `${label}: only ${formatQty(option.available, 3)} ${unitName} left${inCart ? ' (after the cart)' : ''}.`;
}

export interface PileLine {
  itemId: string;
  name?: string;
  qty: number;
  /** True: takes qty x contains from the loose pile. False: takes qty packs from `variantId`. */
  fromBase: boolean;
  contains: number;
  variantId?: string;
}

export interface PileNeed {
  itemId: string;
  /** 'loose' or the pack's variant id. */
  pileId: string;
  /** Loose: base units. Pack: pack count. */
  need: number;
  /** Lines that take from this pile. */
  lines: number;
}

/** Every line that takes from the same pile, added up (2 Dozen + 6 loose eggs = 30 eggs from loose). */
export function sumByPile(lines: PileLine[]): PileNeed[] {
  const map = new Map<string, PileNeed>();
  lines.forEach(line => {
    const qty = Number(line.qty) || 0;
    if (!(qty > 0) || !line.itemId) return;
    const pileId = line.fromBase ? 'loose' : (line.variantId || 'loose');
    const key = `${line.itemId}|${pileId}`;
    const add = line.fromBase ? qty * (line.contains || 1) : qty;
    const row = map.get(key);
    if (row) { row.need = cleanQty(row.need + add); row.lines += 1; }
    else map.set(key, { itemId: line.itemId, pileId, need: cleanQty(add), lines: 1 });
  });
  return [...map.values()];
}

/** POS cart lines as pile lines, read from each line's own snapshot (what the bill will save). */
export function cartPileLines(cart: (CartSellLine & { name?: string })[]): PileLine[] {
  return cart.map(line => ({
    itemId: String(line.id || ''),
    name: line.name,
    qty: Number(line.qty) || 0,
    fromBase: cartLineUsesMainStock(line),
    contains: cartLineContains(line),
    variantId: line.variantId,
  }));
}

/**
 * Customer order lines as pile lines, the way the server's checkout_customer_order reads them:
 * no variant = loose; a multi-unit takes qty x its size from loose; any other variant id is its own pack pile.
 */
export function orderPileLines(
  lines: { itemId: string; name?: string; qty: number; variantId?: string }[],
  itemById: (id: string) => { variants?: { id: string; quantity_in_base_unit?: number; deduct_from_base?: boolean }[] } | undefined,
): PileLine[] {
  return lines.map(line => {
    const variant = line.variantId ? itemById(line.itemId)?.variants?.find(v => v.id === line.variantId) : undefined;
    const fromBase = !line.variantId || variant?.deduct_from_base === true;
    return {
      itemId: line.itemId,
      name: line.name,
      qty: Number(line.qty) || 0,
      fromBase,
      contains: line.variantId ? sellUnitContains(variant) : 1,
      variantId: line.variantId,
    };
  });
}

export interface PileShortage extends PileNeed {
  have: number;
}

/** Piles where the lines together need more than is in stock. */
export function pileShortages(lines: PileLine[], stockOf: (itemId: string) => { loose: number; packs?: Record<string, number> | null }): PileShortage[] {
  return sumByPile(lines).flatMap(row => {
    const stock = stockOf(row.itemId);
    const have = cleanQty(row.pileId === 'loose' ? Number(stock.loose) || 0 : Number(stock.packs?.[row.pileId]) || 0);
    return row.need > have + 0.0005 ? [{ ...row, have }] : [];
  });
}

/** "Eggs loose: need 30 pcs, have 20 pcs" for a shortage message. */
export function shortageText(row: PileShortage, item: { name?: string; unit?: string; variants?: { id: string; name?: string }[] } | undefined): string {
  const name = item?.name || 'Product';
  if (row.pileId === 'loose') {
    const unit = item?.unit || '';
    return `${name} loose: need ${formatQty(row.need, 3)} ${unit}, have ${formatQty(row.have, 3)} ${unit}`.replace(/\s+/g, ' ').trim();
  }
  const pack = item?.variants?.find(v => v.id === row.pileId)?.name || 'pack';
  return `${name} (${pack}): need ${formatQty(row.need, 3)}, have ${formatQty(row.have, 3)}`;
}
