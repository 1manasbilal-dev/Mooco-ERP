import { cleanNumber, cleanQty, formatCurrency, formatQty } from './formatters';

export interface SellUnitLike {
  id?: string;
  name?: string;
  quantity_in_base_unit?: number;
  selling_price?: number;
  deduct_from_base?: boolean;
  isActive?: boolean;
}

export interface CartSellLine {
  id?: string;
  cartItemId?: string;
  qty?: number;
  unit?: string;
  baseUnit?: string;
  variantId?: string;
  variantName?: string;
  stockDeduction?: number;
  deductFromBase?: boolean;
  isLoose?: boolean;
  price?: number;
}

/** How many stock units sit inside one sell unit. */
export function sellUnitContains(unit?: { quantity_in_base_unit?: number } | null): number {
  const contains = Number(unit?.quantity_in_base_unit);
  return Number.isFinite(contains) && contains > 0 ? contains : 1;
}

/**
 * Price of one sell unit. A typed price wins, so a dozen can cost less than 12 pieces.
 * An empty price follows the loose rate times how many base units it contains.
 */
export function sellUnitPrice(basePrice: number, contains: number, override?: number | null): number {
  const own = Number(override);
  if (Number.isFinite(own) && own > 0) return cleanNumber(own);
  return cleanNumber((Number(basePrice) || 0) * (contains || 1));
}

export function pricePerBase(packPrice: number, contains: number): number {
  const size = contains || 1;
  return cleanNumber((Number(packPrice) || 0) / size);
}

/** Main-stock sell units (dozen, tray) draw the base pile. Packed units draw their own count. */
export function takesMainStock(unit?: { deduct_from_base?: boolean } | null): boolean {
  return !unit || unit.deduct_from_base === true;
}

export function cartLineUsesMainStock(line: CartSellLine): boolean {
  if (line.deductFromBase === true) return true;
  if (line.deductFromBase === false) return false;
  return Boolean(line.isLoose) || !line.variantId;
}

export function cartLineContains(line: CartSellLine): number {
  const contains = Number(line.stockDeduction);
  return Number.isFinite(contains) && contains > 0 ? contains : 1;
}

export function cartLineBaseQty(line: CartSellLine): number {
  return cleanQty((Number(line.qty) || 0) * cartLineContains(line));
}

/** Base units already sitting in the cart for this product, excluding one line. */
export function reservedBaseQty(cart: CartSellLine[], productId: string, exceptCartItemId?: string): number {
  return cleanQty(cart
    .filter(line => line.id === productId && line.cartItemId !== exceptCartItemId && cartLineUsesMainStock(line))
    .reduce((sum, line) => sum + cartLineBaseQty(line), 0));
}

/**
 * How many of this sell unit can still be sold.
 * Main-stock units divide the remaining base stock. Packed units use their own count.
 */
export function availableSellUnits(mainStock: number, packedStock: number, unit?: SellUnitLike | null): number {
  if (!unit) return Math.max(0, Number(mainStock) || 0);
  if (unit.deduct_from_base === true) {
    const contains = sellUnitContains(unit);
    return Math.max(0, (Number(mainStock) || 0) / contains);
  }
  return Math.max(0, Number(packedStock) || 0);
}

/**
 * Keep the same stock quantity when the cashier changes unit.
 * 12 pieces become 1 dozen. 12 pieces do not become 12 dozens.
 * When the stock does not divide into a whole pack, start at 1 of the new unit.
 */
export function qtyAfterUnitSwitch(currentQty: number, currentContains: number, nextContains: number, nextIsPack: boolean): { qty: number; kept: boolean } {
  const base = cleanQty((Number(currentQty) || 0) * (currentContains || 1));
  const next = nextContains || 1;
  if (base <= 0) return { qty: 1, kept: false };
  const raw = base / next;
  if (!nextIsPack) return { qty: cleanQty(raw), kept: true };
  const whole = Math.round(raw);
  if (whole >= 1 && Math.abs(raw - whole) < 0.001) return { qty: whole, kept: true };
  return { qty: 1, kept: false };
}

export function oneUnitLabel(name: string, contains: number, baseUnit: string): string {
  const unitName = name || baseUnit || 'unit';
  const base = baseUnit || 'unit';
  if (unitName.toLowerCase() === base.toLowerCase() || (contains || 1) === 1 && unitName.toLowerCase() === base.toLowerCase()) {
    return `1 ${base}`;
  }
  return `1 ${unitName} = ${formatQty(contains, 3)} ${base}`;
}

/** "2 tray = 60 pcs" for a pack line. Loose lines stay as the quantity itself. */
export function sellLineCaption(line: CartSellLine): string {
  const base = line.baseUnit || line.unit || 'unit';
  const name = !line.isLoose && line.variantName ? line.variantName : (line.unit || base);
  const contains = cartLineContains(line);
  const qty = Number(line.qty) || 0;
  if (line.isLoose || !line.variantName || (contains === 1 && name.toLowerCase() === base.toLowerCase())) {
    return `${formatQty(qty, 3)} ${base}`;
  }
  return `${formatQty(qty, 3)} ${name} = ${formatQty(qty * contains, 3)} ${base}`;
}

export interface SaleLineStock {
  /** True: the line moved the loose (main) pile. False: it moved the packed count of `variantId`. */
  fromBase: boolean;
  /** Base units inside one sold unit. */
  contains: number;
  /** Packed variant pile, only when fromBase is false. */
  variantId?: string;
  /** Quantity moved in its own pile: base units for main stock, pack count for packed stock. */
  stockQty: number;
  /** The same quantity in base units, for reports that add lines together. */
  baseQty: number;
}

/**
 * Stock effect of one saved bill line. The bill's own snapshot wins, so a later catalog change
 * (dozen switched to packed, tray resized, variant deleted) never rewrites history.
 * The catalog only fills gaps on old bills saved before the snapshot carried these fields.
 */
export function saleLineStock(
  line: { qty?: number; variantId?: string; variant_id?: string; isLoose?: boolean; stockDeduction?: number; deductFromBase?: boolean; deduct_from_base?: boolean },
  item?: { variants?: { id: string; quantity_in_base_unit?: number; deduct_from_base?: boolean }[] } | null
): SaleLineStock {
  const qty = Number(line.qty) || 0;
  const rawVariant = line.variantId || line.variant_id;
  const variantId = rawVariant && rawVariant !== 'loose' && rawVariant !== 'base' && !line.isLoose ? rawVariant : undefined;
  const variant = variantId ? (item?.variants || []).find(v => v.id === variantId) : undefined;
  const snapshotContains = Number(line.stockDeduction);
  const contains = snapshotContains > 0
    ? snapshotContains
    : (variant && Number(variant.quantity_in_base_unit) > 0 ? Number(variant.quantity_in_base_unit) : 1);
  const flag = line.deductFromBase ?? line.deduct_from_base;
  const fromBase = !variantId || (flag === true ? true : flag === false ? false : variant?.deduct_from_base === true);
  const baseQty = cleanQty(qty * (variantId ? contains : 1));
  return {
    fromBase,
    contains: variantId ? contains : 1,
    variantId: fromBase ? undefined : variantId,
    stockQty: fromBase ? baseQty : cleanQty(qty),
    baseQty
  };
}

/**
 * Base units physically on hand: loose stock plus every packed pile at its pack size.
 * Multi-unit counts (dozen, tray) are views of the loose pile, so they are never added again.
 * Negative piles count as zero, so a shortfall never dilutes the average cost.
 */
export function stockOnHandBase(
  looseStock: number,
  variantStocks?: Record<string, number> | null,
  variants?: { id: string; quantity_in_base_unit?: number; deduct_from_base?: boolean }[] | null
): number {
  let total = Math.max(0, Number(looseStock) || 0);
  Object.entries(variantStocks || {}).forEach(([id, count]) => {
    const variant = (variants || []).find(v => v.id === id);
    if (!variant || variant.deduct_from_base === true) return;
    total += Math.max(0, Number(count) || 0) * sellUnitContains(variant);
  });
  return cleanQty(total);
}

/** Moving average cost per base unit after stock comes in. Old stock below zero carries no cost weight. */
export function averageCostAfterIntake(onHandBase: number, currentCost: number, incomingBase: number, incomingValue: number): number {
  const before = Math.max(0, Number(onHandBase) || 0);
  const added = Math.max(0, Number(incomingBase) || 0);
  if (added <= 0) return Number(currentCost) || 0;
  const cost = before > 0 && Number(currentCost) > 0
    ? (before * Number(currentCost) + (Number(incomingValue) || 0)) / (before + added)
    : (Number(incomingValue) || 0) / added;
  return cleanNumber(cost, 4);
}

/** Saved line cost is per sold unit. This is the same cost per base unit. */
export function saleLineCostPerBase(line: { cost_price?: number }, stock: SaleLineStock, fallbackBaseCost = 0): number {
  const own = Number(line.cost_price);
  if (Number.isFinite(own) && own > 0) return cleanNumber(own / (stock.contains || 1), 4);
  return Number(fallbackBaseCost) || 0;
}

export function sellUnitRateLabel(price: number, name: string): string {
  return `${formatCurrency(price)} / ${name || 'unit'}`;
}

/** Ready-made sizes. Count products get dozen and tray; weight and volume get their usual portions. */
export function sellUnitPresets(baseUnit: string): { name: string; contains: number }[] {
  const unit = (baseUnit || '').toLowerCase();
  if (unit === 'kg') {
    return [
      { name: 'Pao', contains: 0.25 },
      { name: 'Half kg', contains: 0.5 },
      { name: '1 kg', contains: 1 }
    ];
  }
  if (unit === 'g') {
    return [
      { name: 'Pao', contains: 250 },
      { name: 'Half kg', contains: 500 },
      { name: '1 kg', contains: 1000 }
    ];
  }
  if (unit === 'l' || unit === 'liter' || unit === 'liters') {
    return [
      { name: '250 ml', contains: 0.25 },
      { name: 'Half liter', contains: 0.5 },
      { name: '1 liter', contains: 1 }
    ];
  }
  if (unit === 'ml') {
    return [
      { name: '250 ml', contains: 250 },
      { name: 'Half liter', contains: 500 },
      { name: '1 liter', contains: 1000 }
    ];
  }
  return [
    { name: 'Dozen', contains: 12 },
    { name: 'Tray', contains: 30 },
    { name: 'Half dozen', contains: 6 },
    { name: 'Carton', contains: 24 }
  ];
}
