import { cleanNumber, cleanQty, formatCurrency, formatQty } from './formatters';
import { normalizeUnit } from './unitConversion';

export type QuickMode = 'amount' | 'qty';

/** Grams and millilitres are stocked in small units but sold by the glass or quarter kilo: step them 250 at a time. */
const SMALL_UNIT_STEP = 250;
const isSmallUnit = (symbol: string) => symbol === 'g' || symbol === 'ml';

/** Move to the next whole or sensible fractional count (e.g. 0.25 kg for weight items); amount/manual entries retain fractional quantities. */
export function stepWholeQuantity(current: number, direction: number, minimum = 0) {
  const value = Number.isFinite(current) ? current : 0;
  return Math.max(minimum, direction > 0 ? Math.floor(value) + 1 : Math.ceil(value) - 1);
}

/**
 * Steps the physical quantity in natural dairy increments:
 * - Packaged items: 1, 2, 3, 4, 5... (minimum 1)
 * - Loose kg items: 0.25 (quarter kg) <-> 0.5 (half kg) <-> 0.75 (¾ kg) <-> 1 <-> 2 <-> 3 <-> 4 <-> 5... (minimum 0.25)
 * - Loose liter items: 0.5 (half liter) <-> 1 <-> 2 <-> 3 <-> 4 <-> 5... (minimum 0.5)
 * - Loose g / ml items: 250 <-> 500 <-> 750 <-> 1000... (minimum 250)
 */
export function stepQuickQuantity(current: number, direction: number, unit = 'Unit', packaged = false): number {
  const symbol = normalizeUnit(unit);
  if (!packaged && isSmallUnit(symbol)) {
    const value = Number.isFinite(current) && current > 0 ? current : SMALL_UNIT_STEP;
    const steps = value / SMALL_UNIT_STEP;
    const next = direction > 0 ? Math.floor(steps + 1e-9) + 1 : Math.ceil(steps - 1e-9) - 1;
    return Math.max(1, next) * SMALL_UNIT_STEP;
  }
  const value = Number.isFinite(current) && current > 0 ? current : 1;
  const isKg = !packaged && symbol === 'kg';
  const isLiter = !packaged && symbol === 'L';
  const isFractional = isKg || isLiter;

  if (!isFractional) {
    return Math.max(1, direction > 0 ? Math.floor(value + 1e-9) + 1 : Math.ceil(value - 1e-9) - 1);
  }

  if (direction > 0) {
    if (isKg) {
      if (value < 0.24) return 0.25;
      if (value < 0.49) return 0.5;
      if (value < 0.74) return 0.75;
      if (value < 0.99) return 1;
    } else {
      if (value < 0.49) return 0.5;
      if (value < 0.99) return 1;
    }
    return cleanQty(Math.floor(value + 1e-9) + 1);
  } else {
    // direction < 0
    if (value > 1.01) {
      return cleanQty(Math.ceil(value - 1e-9) - 1);
    }
    if (isKg) {
      if (value > 0.76) return 0.75;
      if (value > 0.51) return 0.5;
      if (value > 0.26) return 0.25;
      return 0.25;
    } else {
      if (value > 0.51) return 0.5;
      return 0.5;
    }
  }
}


/** Keep entered rupees exact while storing quantities at the app's three-decimal precision. */
export function calculateQuickEntry(value: string, mode: QuickMode, rate: number, packaged: boolean) {
  const invalid = (error: string) => ({ qty: 0, total: 0, error });
  if (!Number.isFinite(rate) || rate <= 0) return invalid('Set a selling rate before adding this item.');
  if (!value.trim()) return invalid('Enter an amount or quantity to continue.');
  if (!/^\d*\.?\d+$/.test(value.trim())) return invalid('Enter a valid positive number.');
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return invalid('Enter a number greater than zero.');
  if (packaged) {
    if (mode === 'qty' && !Number.isInteger(number)) return invalid('Packs must be sold in whole numbers.');
    if (mode === 'amount') {
      const rawPacks = number / rate;
      const roundedPacks = Math.round(rawPacks);
      if (Math.abs(rawPacks - roundedPacks) > 0.001) {
        return invalid(`Amount must match whole packs (each pack is ${formatCurrency(rate)}).`);
      }
    }
  }
  const total = cleanNumber(mode === 'amount' ? number : cleanQty(number) * rate);
  const qty = packaged
    ? (mode === 'amount' ? Math.round(total / rate) : Math.round(number))
    : (mode === 'amount' ? cleanQty(total / rate) : cleanQty(number));
  if (!Number.isFinite(total) || !Number.isFinite(qty) || total <= 0 || qty <= 0) return invalid('This amount is too small for the selling rate.');
  return { qty, total, error: '' };
}

/** True when the product owner has set cash shortcuts on the item itself (Items → POS Quick Cash Buttons). */
export function hasConfiguredCashShortcuts(configured?: number[] | null) {
  return Array.isArray(configured) && configured.some(amount => Number(amount) > 0);
}

export interface QuickPresetInput {
  mode: QuickMode;
  packaged: boolean;
  unit?: string;
  rate: number;
  configured?: number[] | null;
}

/**
 * Single source of truth for the quick buttons shown for a product.
 * The POS quick-entry dialog and the product detail view both call this, so
 * what a cashier taps in POS is exactly what the product page previews.
 */
export function getQuickPresets({ mode, packaged, unit, rate, configured }: QuickPresetInput): number[] {
  if (mode === 'qty') {
    if (packaged) return [1, 2, 3, 5, 10, 12];
    const symbol = normalizeUnit(unit);
    if (symbol === 'kg') return [0.25, 0.5, 0.75, 1, 1.5, 2, 5];
    if (symbol === 'L') return [0.5, 1, 1.5, 2, 3, 5, 10];
    if (symbol === 'ml') return [250, 500, 750, 1000, 1500, 2000, 5000];
    if (symbol === 'g') return [100, 250, 500, 750, 1000, 2000];
    return [1, 2, 3, 4, 5, 10];
  }
  const source = hasConfiguredCashShortcuts(configured) ? configured! : (
    rate >= 2000 ? [500, 1000, 1500, 1750, 2000, 3500] :
    rate >= 500 ? [100, 200, 250, 500, 1000, 1500] :
    [50, 100, 150, 200, 250, 500]
  );
  return [...new Set(source.map(Number).filter(amount => Number.isFinite(amount) && amount > 0))].sort((a, b) => a - b);
}

/** Friendly title (and optional everyday-words hint) for a quantity shortcut. */
function describeQuickQty(preset: number, unit: string, packaged: boolean): { title: string; hint?: string } {
  if (packaged) return { title: `${formatQty(preset)} pack${preset === 1 ? '' : 's'}` };
  const title = `${formatQty(preset, 3)} ${unit}`;
  const symbol = normalizeUnit(unit);
  if (symbol === 'kg') {
    const hints: Record<number, string> = { 0.25: 'Quarter kg', 0.5: 'Half kg', 0.75: '¾ kg', 1: '1 Kilo', 1.5: '1½ kg', 2: '2 Kilo' };
    return { title, hint: hints[preset] };
  }
  if (symbol === 'g') {
    const hints: Record<number, string> = { 250: 'Quarter kg', 500: 'Half kg', 750: '¾ kg', 1000: '1 Kilo', 2000: '2 Kilo' };
    return { title, hint: hints[preset] };
  }
  if (symbol === 'ml') {
    const hints: Record<number, string> = { 250: '1 Glass', 500: 'Half liter', 1000: '1 Liter', 1500: '1½ liter', 2000: '2 Liter', 5000: '5 Liter' };
    return { title, hint: hints[preset] };
  }
  return { title };
}

/** Cash and quantity shortcuts with their converted counterpart, used for previews outside POS. */
export function buildQuickPreview(rate: number, unit: string, configured?: number[] | null) {
  const cash = getQuickPresets({ mode: 'amount', packaged: false, unit, rate, configured }).map(amount => {
    const entry = calculateQuickEntry(String(amount), 'amount', rate, false);
    return { amount, qty: entry.qty, label: formatCurrency(amount), converted: entry.error ? '' : `${formatQty(entry.qty, 3)} ${unit}` };
  });
  const qty = getQuickPresets({ mode: 'qty', packaged: false, unit, rate }).map(value => {
    const entry = calculateQuickEntry(String(value), 'qty', rate, false);
    const label = describeQuickQty(value, unit, false);
    return { qty: value, title: label.title, hint: label.hint, total: entry.total, converted: entry.error ? '' : formatCurrency(entry.total) };
  });
  return { cash, qty, usingDefaultCash: !hasConfiguredCashShortcuts(configured) };
}
