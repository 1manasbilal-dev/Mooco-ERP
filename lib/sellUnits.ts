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
