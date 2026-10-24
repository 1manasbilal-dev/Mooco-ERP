/**
 * Client side of the inbound stock RPCs (supabase/migrations/20261024100000 .. 104000):
 * record_material_purchase, return_material_purchase, allocate_milk_pool, take_counter_milk,
 * complete_production_batch and cancel_production_batch.
 *
 * The server moves the stock piles, the average cost, the stock log and any money together and
 * answers with the items it touched; these helpers fold that answer into the screen's state and
 * build the few inputs the browser still decides (which counter milk item a lot goes to).
 */
import type { InventoryItem, ItemDefinition, MaterialPurchaseEntry, UnitDefinition } from '../types';
import { convertQuantity } from './unitConversion';
import { cleanQty, formatQty } from './formatters';

/** One item as the server left it. */
export interface ItemStockState {
  id: string;
  stock: number;
  variant_stocks: Record<string, number>;
  cost_price: number;
}

/** The `items` map an RPC answers with ({ [itemId]: state }), as a list; anything malformed is dropped. */
export function itemStatesFrom(result: unknown): ItemStockState[] {
  const raw = (result && typeof result === 'object' ? (result as { items?: unknown }).items : undefined);
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Record<string, unknown>).flatMap(value => {
    const s = value as Partial<ItemStockState> | null;
    if (!s || typeof s.id !== 'string') return [];
    return [{
      id: s.id,
      stock: cleanQty(Number(s.stock) || 0),
      variant_stocks: s.variant_stocks && typeof s.variant_stocks === 'object' ? s.variant_stocks : {},
      cost_price: Number(s.cost_price) || 0,
    }];
  });
}

/** Catalog rows with the server's piles and cost. */
export function applyItemStates(items: ItemDefinition[], states: ItemStockState[]): ItemDefinition[] {
  if (states.length === 0) return items;
  const byId = new Map(states.map(s => [s.id, s]));
  return items.map(item => {
    const s = byId.get(item.id);
    return s ? { ...item, stock: s.stock, variant_stocks: s.variant_stocks, cost_price: s.cost_price } : item;
  });
}

/** Inventory rows (keyed `inv_<itemId>` or by item_id) with the server's piles. */
export function applyInventoryStates(inventory: InventoryItem[], states: ItemStockState[]): InventoryItem[] {
  if (states.length === 0) return inventory;
  const byId = new Map(states.map(s => [s.id, s]));
  return inventory.map(row => {
    const id = row.item_id || (row.id.startsWith('inv_') ? row.id.slice(4) : row.id);
    const s = byId.get(id);
    return s ? { ...row, quantity: s.stock, variant_stocks: s.variant_stocks } : row;
  });
}

const takesLitres = (item: Pick<ItemDefinition, 'unit'>, customUnits: UnitDefinition[]) =>
  convertQuantity(1, 'L', String(item.unit || '').trim() || 'L', customUnits) !== null;

/**
 * The counter item a milk lot goes to: `item_<type>_milk`, else a milk item named after the type,
 * else Mixed Milk, else any plain milk item. Only items stocked in a volume unit (L, ml) qualify, so
 * a kg product or a fallback in the wrong unit is skipped instead of receiving litres as kg.
 */
export function counterMilkItemFor<T extends Pick<ItemDefinition, 'id' | 'name' | 'unit'>>(
  items: T[],
  milkType: string | undefined,
  customUnits: UnitDefinition[] = [],
): T | undefined {
  const type = String(milkType || 'Mixed').trim().toLowerCase();
  const ok = (i: T | undefined): i is T => Boolean(i) && takesLitres(i!, customUnits);
  const name = (i: T) => String(i.name || '').toLowerCase();
  const candidates: (T | undefined)[] = [
    items.find(i => i.id === `item_${type}_milk`),
    items.find(i => ok(i) && name(i).includes(type) && name(i).includes('milk')),
    items.find(i => i.id === 'item_mixed_milk'),
    items.find(i => ok(i) && /\bmilk\b/i.test(i.name) && !/(powder|shake|flavou?red|condensed|cake)/i.test(i.name)),
  ];
  return candidates.find(ok);
}

/** A material_purchases row from an RPC answer, shaped like the rows the context loads. */
export function materialPurchaseFromRow(row: Record<string, any>): MaterialPurchaseEntry & Record<string, any> {
  const details = (row.details || {}) as Record<string, any>;
  const money = (v: unknown) => (v === undefined || v === null ? undefined : Math.round((Number(v) || 0) * 100) / 100);
  return {
    ...row,
    quantity: cleanQty(Number(row.quantity) || 0),
    rate: money(row.rate) ?? 0,
    total_amount: money(row.total_amount) ?? 0,
    paid_amount: money(details.paid_amount),
    due_amount: money(details.due_amount),
    account_id: row.account_id || details.account_id,
  } as unknown as MaterialPurchaseEntry & Record<string, any>;
}

/**
 * Stable key for one bill, so Save pressed again after a lost response reuses the same request id.
 * Only the day of the bill date counts: a bill dated today carries the current time, which changes
 * on every click.
 */
export function materialPurchaseKey(data: {
  supplier_id?: string | null;
  date?: string;
  paid_amount?: number;
  account_id?: string;
  items?: { item_id?: string; quantity?: number; unit?: string; rate?: number }[];
}): string {
  const lines = (data.items || []).map(l => `${l.item_id}:${Number(l.quantity) || 0}:${l.unit || ''}:${Number(l.rate) || 0}`).join('|');
  const day = String(data.date || '').slice(0, 10);
  return `material_purchase:${data.supplier_id || 'spot'}:${day}:${Number(data.paid_amount) || 0}:${data.account_id || ''}:${lines}`;
}

export interface ShortMaterial {
  item_id: string;
  name: string;
  short: number;
  unit?: string;
}

/** "Sugar 0.3 kg, Culture 20 g": materials production used beyond what was on hand. */
export function shortMaterialsText(result: unknown): string {
  const list = (result && typeof result === 'object' ? (result as { short_materials?: unknown }).short_materials : undefined);
  if (!Array.isArray(list) || list.length === 0) return '';
  return (list as ShortMaterial[])
    .map(m => `${m.name} ${formatQty(Number(m.short) || 0, 3)}${m.unit ? ` ${m.unit}` : ''}`)
    .join(', ');
}
