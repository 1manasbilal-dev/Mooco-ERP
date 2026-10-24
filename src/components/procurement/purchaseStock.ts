/**
 * Stock rules for the Supplies & Materials bill: which units a product can be bought in, where each
 * line lands (loose pile or a ready-made pack pile), the stock and moving-average cost after the bill,
 * and how much of a saved line can still go back to the supplier.
 *
 * Pure functions (no React, no Supabase) so they can be tested. They mirror what
 * `addBulkMaterialPurchase` / `returnMaterialPurchase` in DairyContext do; docs/stock-model.md has the rules.
 */
import type { UnitDefinition } from '../../types';
import { cleanNumber, cleanQty, formatCurrency, formatQty } from '../../lib/formatters';
import { averageCostAfterIntake, sellUnitContains, stockOnHandBase } from '../../lib/sellUnits';
import { formatBaseQty, pileBreakdown, readStock, type StockItemLike, type StockReading } from '../../lib/stockRules';
import { convertQuantity, getAllAvailableUnits } from '../../lib/unitConversion';

/**
 * - base: the product's own unit (kg, L, pcs); goes to loose stock.
 * - convert: another weight/volume that converts exactly (g → kg, L → ml); goes to loose stock.
 * - multi: the product's dozen/bag/tray (deduct_from_base); a way to count loose stock.
 * - pack: the product's ready-made pack; keeps its own count (its own pile).
 */
export type PurchaseUnitKind = 'base' | 'convert' | 'multi' | 'pack';

export interface PurchaseUnit {
  /** Stable id of the choice: 'base', 'pack:<variantId>', 'multi:<variantId>' or 'unit:<symbol>'. */
  key: string;
  /** Unit name saved on the bill line. The save matches ready-made packs by this name. */
  unit: string;
  kind: PurchaseUnitKind;
  /** Base units in one of this unit. */
  factor: number;
  /** The ready-made pack this unit stocks into (kind 'pack'). */
  variantId?: string;
  /** Option text: "Bag (50 kg)", "500 g pouch (0.5 kg)", "kg (base)". */
  label: string;
  /** "1 Bag = 50 kg". Empty for the base unit. */
  equals: string;
  /** Where the stock goes: "Loose stock" or "500 g pouch packs". */
  lands: string;
  isBase: boolean;
}

export const UNIT_KIND_LABEL: Record<PurchaseUnitKind, string> = {
  base: 'Base unit',
  pack: 'Ready-made packs (apna alag stock)',
  multi: 'Product ki units (loose stock mein)',
  convert: 'Doosri units (convert ho kar loose mein)',
};

type CatalogItem = StockItemLike & { id?: string; name?: string; unit?: string; cost_price?: number };

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();
const isWhole = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;
/** "1 Bag = 50 kg"; "1 × 500 g pouch = 0.5 kg" when the name starts with a number (not "1 500 g"). */
const oneOf = (name: string, factor: number, base: string) => `1 ${/^\d/.test(name) ? '× ' : ''}${name} = ${formatBaseQty(factor, base)}`;

/**
 * Every unit this product can be bought in, in the order the picker shows them: base, its
 * ready-made packs, its multi-units, then weights/volumes that convert to the base unit.
 *
 * A name is offered once. The save decides "pack or loose" by the unit name (first active pack with
 * that name wins), so a multi-unit or a converted unit that shares a pack's name would land in the
 * pack pile: those are left out. Hidden packs are left out because the save would stock them loose.
 */
export function purchaseUnitsFor(item: CatalogItem | null | undefined, customUnits: UnitDefinition[] = []): PurchaseUnit[] {
  if (!item) return [];
  const base = String(item.unit || 'pcs').trim() || 'pcs';
  const taken = new Set<string>([lower(base)]);
  const units: PurchaseUnit[] = [{ key: 'base', unit: base, kind: 'base', factor: 1, label: `${base} (base)`, equals: '', lands: 'Loose stock', isBase: true }];
  const variants = (item.variants || []).filter(v => v && v.isActive !== false && String(v.name || '').trim());

  variants.filter(v => v.deduct_from_base !== true).forEach(v => {
    const name = String(v.name).trim();
    if (taken.has(lower(name))) return;
    taken.add(lower(name));
    const factor = sellUnitContains(v);
    units.push({
      key: `pack:${v.id}`, unit: name, kind: 'pack', factor, variantId: v.id,
      label: `${name} (${formatBaseQty(factor, base)})`, equals: oneOf(name, factor, base), lands: `${name} packs`, isBase: false,
    });
  });
  variants.filter(v => v.deduct_from_base === true).forEach(v => {
    const name = String(v.name).trim();
    if (taken.has(lower(name))) return;
    taken.add(lower(name));
    const factor = sellUnitContains(v);
    units.push({
      key: `multi:${v.id}`, unit: name, kind: 'multi', factor,
      label: `${name} (${formatBaseQty(factor, base)})`, equals: oneOf(name, factor, base), lands: 'Loose stock', isBase: false,
    });
  });
  getAllAvailableUnits(customUnits)
    .filter(u => u.type === 'Mass' || u.type === 'Volume')
    .forEach(u => {
      if (taken.has(lower(u.symbol))) return;
      const factor = convertQuantity(1, u.symbol, base, customUnits);
      // null: different kind (kg vs L). 1: the same unit under another name. 0: too small to keep.
      if (factor === null || !(factor > 0) || factor === 1) return;
      taken.add(lower(u.symbol));
      units.push({
        key: `unit:${u.symbol}`, unit: u.symbol, kind: 'convert', factor,
        label: `${u.symbol} (${formatBaseQty(factor, base)})`, equals: oneOf(u.symbol, factor, base), lands: 'Loose stock', isBase: false,
      });
    });
  return units;
}

export interface LineUnitFields {
  item_name?: string;
  unit: string;
  unitKey?: string;
  conversion_factor: number;
  quantity: number;
  rate: number;
}

/** The unit a bill line was entered in, looked up again in today's catalog. */
export function findLineUnit(line: Pick<LineUnitFields, 'unit' | 'unitKey'>, units: PurchaseUnit[]): PurchaseUnit | undefined {
  if (line.unitKey) return units.find(u => u.key === line.unitKey);
  return units.find(u => lower(u.unit) === lower(line.unit));
}

/**
 * The unit and rate a new bill line starts with: the unit this product was last bought in (with
 * that rate) while it still exists at the same size; else its first ready-made pack when the product
 * only sells as packs; else the base unit at the current average cost.
 */
export function defaultPurchaseUnit(
  item: CatalogItem,
  units: PurchaseUnit[],
  last?: (PurchaseRow & { rate?: number }) | null,
): { unit: PurchaseUnit; rate: number } {
  const base = units[0];
  const cost = Number(item.cost_price) || 0;
  if (last && base) {
    const packId = last.details?.variant_id;
    const match = packId
      ? units.find(u => u.variantId === packId)
      : units.find(u => u.kind !== 'pack' && lower(u.unit) === lower(last.unit));
    const lastFactor = Number(last.details?.conversion_factor) > 0 ? Number(last.details?.conversion_factor) : 1;
    if (match && Math.abs(match.factor - lastFactor) < 1e-9) {
      const rate = Number(last.rate);
      return { unit: match, rate: rate > 0 ? cleanNumber(rate, 2) : cleanNumber(cost * match.factor, 2) };
    }
  }
  const isSale = !item.item_type || item.item_type.includes('Sale product');
  const packOnly = isSale && item.allow_loose_sale === false && !units.some(u => u.kind === 'multi');
  const unit = (packOnly && units.find(u => u.kind === 'pack')) || base;
  return { unit, rate: cleanNumber(cost * (unit?.factor || 1), 2) };
}

/** "10 × 500 g pouch = 5 kg", "2 Bag = 100 kg", "2.5 L = 2500 ml", "12 kg". */
export function conversionText(qty: number, unit: PurchaseUnit, baseUnit: string): string {
  const q = Number(qty) || 0;
  const baseQty = formatBaseQty(q * unit.factor, baseUnit);
  if (unit.kind === 'base') return baseQty;
  if (unit.kind === 'pack') return `${formatQty(q, 3)} × ${unit.unit} = ${baseQty}`;
  return `${formatQty(q, 3)} ${unit.unit} = ${baseQty}`;
}

/** Where one line's stock goes: "+5 kg loose" or "+10 × 500 g pouch". */
export function landingText(qty: number, unit: PurchaseUnit, baseUnit: string): string {
  const q = Number(qty) || 0;
  return unit.kind === 'pack' ? `+${formatQty(q, 3)} × ${unit.unit}` : `+${formatBaseQty(q * unit.factor, baseUnit)} loose`;
}

/**
 * Why a bill line can't be saved, or '' when it is fine. `units` is the product's current unit list,
 * so a pack hidden or resized while the bill was open, or a changed base unit, is caught here
 * instead of landing in the wrong pile.
 */
export function billLineProblem(line: LineUnitFields, units: PurchaseUnit[]): string {
  const name = line.item_name || 'Item';
  if (units.length === 0) return `"${name}" ab catalog mein nahi hai. Line hata dein.`;
  const unit = findLineUnit(line, units);
  if (!unit || lower(unit.unit) !== lower(line.unit)) {
    return `"${name}": unit "${line.unit}" ab is product mein nahi (pack hide/delete ya base unit badla). Unit dobara chunein.`;
  }
  if (Math.abs(unit.factor - (Number(line.conversion_factor) || 1)) > 1e-9) {
    return `"${name}": ${unit.unit} ka size badal gaya (ab ${unit.equals}). Unit dobara chunein.`;
  }
  const qty = Number(line.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return `"${name}" ki quantity 0 se zyada likhein.`;
  if (unit.kind === 'pack' && !isWhole(qty)) return `"${name}": ${unit.unit} poore number mein likhein (jaise 10), aadha pack stock mein nahi ginta.`;
  if (!(Number(line.rate) >= 0)) return `"${name}" ka rate minus mein nahi ho sakta.`;
  return '';
}

/** Rate for a new unit, keeping the same price per base unit. */
export function rateForUnit(rate: number, fromFactor: number, toFactor: number): number {
  const perBase = (Number(rate) || 0) / (Number(fromFactor) || 1);
  return cleanNumber(perBase * (Number(toFactor) || 1), 2);
}

/** Rate that makes qty × rate equal the typed total (quantity is what arrived, so it stays). */
export function rateFromTotal(total: number, qty: number): number | null {
  const t = Number(total);
  const q = Number(qty);
  if (!Number.isFinite(t) || t < 0 || !(q > 0)) return null;
  return cleanNumber(t / q, 2);
}

export interface PileStock {
  loose: number;
  packs: Record<string, number>;
}

/** Loose and pack counts of a product. The inventory row is the source; the catalog row is the fallback. */
export function pileStockOf(
  item: { stock?: number; variant_stocks?: Record<string, number> | null } | null | undefined,
  inventoryRow?: { quantity?: number; variant_stocks?: Record<string, number> | null } | null,
): PileStock {
  const loose = cleanQty(Number(inventoryRow ? inventoryRow.quantity : item?.stock) || 0);
  const packs = { ...((inventoryRow?.variant_stocks ?? item?.variant_stocks) || {}) };
  return { loose, packs };
}

export interface LandingLine {
  quantity: number;
  rate: number;
  unit: PurchaseUnit;
}

export interface PileChange {
  id: string;
  name: string;
  kind: 'loose' | 'pack';
  before: number;
  after: number;
  /** "12 kg" or "3" (pack count). */
  beforeText: string;
  afterText: string;
}

export interface Landing {
  before: StockReading;
  after: StockReading;
  changes: PileChange[];
  /** Moving-average cost per base unit before and after, as the save works it out line by line. */
  costBefore: number;
  costAfter: number;
  incomingBase: number;
  /** "Stock after this purchase" pile by pile. */
  afterText: string;
  notes: string[];
}

/**
 * Stock and moving-average cost of one product after the bill's lines for it, in bill order.
 * Same steps as the save: each line averages over everything on hand (negative piles count as 0),
 * then adds to its pile.
 */
export function landingPreview(item: CatalogItem, stock: PileStock, lines: LandingLine[]): Landing {
  const variants = item.variants || [];
  let loose = cleanQty(stock.loose);
  const packs: Record<string, number> = { ...stock.packs };
  const costBefore = Number(item.cost_price) || 0;
  let cost = costBefore;
  let incomingBase = 0;
  let looseIn = 0;

  lines.forEach(line => {
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) return;
    const addedBase = cleanQty(qty * line.unit.factor);
    const lineTotal = cleanNumber(qty * (Number(line.rate) || 0), 2);
    const onHand = stockOnHandBase(loose, packs, variants);
    const next = averageCostAfterIntake(onHand, cost, addedBase, lineTotal);
    if (line.unit.kind === 'pack' && line.unit.variantId) {
      packs[line.unit.variantId] = cleanQty((Number(packs[line.unit.variantId]) || 0) + qty);
    } else {
      loose = cleanQty(loose + addedBase);
      looseIn = cleanQty(looseIn + addedBase);
    }
    if (next > 0) cost = next;
    incomingBase = cleanQty(incomingBase + addedBase);
  });

  const before = readStock(item, stock.loose, stock.packs);
  const after = readStock({ ...item, cost_price: cost }, loose, packs);
  const unit = before.unit;
  const changes: PileChange[] = [];
  after.piles.forEach(pile => {
    if (pile.kind !== 'loose' && pile.kind !== 'packed') return;
    const old = before.piles.find(p => p.id === pile.id);
    const was = old ? old.count : 0;
    if (Math.abs(pile.count - was) < 0.0005) return;
    changes.push({
      id: pile.id,
      name: pile.kind === 'loose' ? 'Loose' : pile.name,
      kind: pile.kind === 'loose' ? 'loose' : 'pack',
      before: was,
      after: pile.count,
      beforeText: pile.kind === 'loose' ? formatBaseQty(was, unit) : formatQty(was, 3),
      afterText: pile.kind === 'loose' ? formatBaseQty(pile.count, unit) : formatQty(pile.count, 3),
    });
  });

  const notes: string[] = [];
  const isSale = !item.item_type || item.item_type.includes('Sale product');
  const loosePile = after.piles.find(p => p.kind === 'loose');
  const hasMulti = after.piles.some(p => p.kind === 'multi' && p.isActive);
  if (isSale && looseIn > 0 && loosePile && !loosePile.isActive && !hasMulti) {
    notes.push(`Loose sale band hai: ${formatBaseQty(looseIn, unit)} loose POS par nahi bikega. Pack unit chunein ya catalog mein loose sale on karein.`);
  }
  if (before.piles.some(p => (p.kind === 'loose' || p.kind === 'packed') && p.count < 0)) {
    notes.push('Purana stock minus mein hai; average cost sirf plus stock par banti hai.');
  }

  return {
    before,
    after,
    changes,
    costBefore,
    costAfter: cost,
    incomingBase,
    afterText: pileBreakdown(after).join(' · ') || formatBaseQty(0, unit),
    notes,
  };
}

/** "Rs 140.00 → Rs 141.25 /kg", or the one cost when it does not move. */
export function costChangeText(landing: Pick<Landing, 'costBefore' | 'costAfter'>, unit: string): string {
  const before = cleanNumber(landing.costBefore, 2);
  const after = cleanNumber(landing.costAfter, 2);
  if (before === after) return `${formatCurrency(after)}/${unit}`;
  return `${formatCurrency(before)} → ${formatCurrency(after)}/${unit}`;
}

/** A saved supplies bill line (a `material_purchases` row) as the screens read it. */
export interface PurchaseRow {
  quantity?: number;
  unit?: string;
  status?: string;
  item_id?: string;
  item_name?: string;
  details?: {
    variant_id?: string;
    conversion_factor?: number;
    base_unit?: string;
    stocked_as?: string;
    returned_quantity?: number;
    original_quantity?: number;
    original_intake_quantity?: number;
  } | null;
}

export interface PurchasePile {
  kind: 'loose' | 'pack';
  /** The pack pile, when the line was stocked as packs and that pack still exists. */
  variantId?: string;
  /** "Loose stock" or "500 g pouch packs". */
  name: string;
  /** Base units in one bought unit. */
  factor: number;
  baseUnit: string;
  /** Something the owner should know before a return, e.g. the pack was deleted since. */
  note: string;
}

/**
 * The pile a saved line went to and comes back out of on a return, decided like the return does:
 * stocked as a pack that still exists → that pack pile; anything else → loose (qty × conversion).
 */
export function purchaseLinePile(entry: PurchaseRow, item: CatalogItem | null | undefined): PurchasePile {
  const details = entry.details || {};
  const factor = Number(details.conversion_factor) > 0 ? Number(details.conversion_factor) : 1;
  const baseUnit = item?.unit || details.base_unit || entry.unit || 'unit';
  const packId = details.variant_id;
  const pack = packId ? (item?.variants || []).find(v => v.id === packId) : undefined;
  if (packId && pack) {
    const name = String(pack.name || entry.unit || 'Pack');
    return {
      kind: 'pack', variantId: packId, name: `${name} packs`, factor, baseUnit,
      note: pack.deduct_from_base === true ? `${name} ab multi-unit hai; return iska purana count banayega. Pehle catalog check karein.` : '',
    };
  }
  return {
    kind: 'loose', name: 'Loose stock', factor, baseUnit,
    note: packId && item ? `Jis pack mein yeh aaya tha woh ab catalog mein nahi; return loose stock se kam hoga.` : '',
  };
}

/** Units of this line that can still go back: what it added and has not been returned yet. */
export function returnableQty(entry: PurchaseRow): number {
  if (entry.status === 'Returned' || entry.status === 'Cancelled') return 0;
  return Math.max(0, cleanQty(Number(entry.quantity) || 0));
}

/** Units already sent back from this line (partial returns lower `quantity` and add here). */
export function returnedQty(entry: PurchaseRow): number {
  return Math.max(0, cleanQty(Number(entry.details?.returned_quantity) || 0));
}

/** On-hand stock of the pile a return takes from, in the line's own unit. */
export function pileOnHandInUnit(pile: PurchasePile, stock: PileStock): number {
  if (pile.kind === 'pack' && pile.variantId) return cleanQty(Number(stock.packs[pile.variantId]) || 0);
  return cleanQty(stock.loose / (pile.factor || 1));
}

/** Why a return quantity can't be used, or ''. */
export function returnQtyProblem(qty: number, max: number, pile: Pick<PurchasePile, 'kind'>, unit: string): string {
  if (!Number.isFinite(qty) || qty <= 0) return 'Return quantity 0 se zyada likhein.';
  if (qty > max + 0.0005) return `Is purchase se sirf ${purchaseQtyText(max, unit, pile)} wapas ho sakta hai.`;
  if (pile.kind === 'pack' && !isWhole(qty)) return `${unit} poore number mein wapas karein (aadha pack nahi).`;
  return '';
}

/** "10 × 500 g pouch" for pack lines, "2 Bag" otherwise. */
export function purchaseQtyText(qty: number, unit: string, pile: Pick<PurchasePile, 'kind'>): string {
  return pile.kind === 'pack' ? `${formatQty(qty, 3)} × ${unit}` : `${formatQty(qty, 3)} ${unit}`.trim();
}

/** "→ loose +100 kg" / "→ 500 g pouch packs +10" for the purchase log. */
export function purchasePileText(qty: number, pile: PurchasePile): string {
  if (pile.kind === 'pack') return `${pile.name} +${formatQty(qty, 3)}`;
  return `Loose +${formatBaseQty(qty * pile.factor, pile.baseUnit)}`;
}
