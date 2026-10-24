import { cleanQty } from '../../lib/formatters';
import { sellUnitContains } from '../../lib/sellUnits';
import { logBaseDelta, logStockDelta } from '../../lib/stockRules';
import type { InventoryLog, ItemDefinition } from '../../types';
import { pkDay } from './milkOps';

/** One pile's part of a log row: "-2 kg loose" or "+6 × 500 g tub". */
export interface LogMove {
  id: string;
  name: string;
  delta: number;
  /** Base unit for loose, "packs" for packs, "old count" for a multi-unit or deleted pack. */
  unit: string;
  kind: 'loose' | 'pack' | 'stray';
}

export interface LogLine {
  log: InventoryLog;
  /** Pakistan business day, YYYY-MM-DD. */
  day: string;
  moves: LogMove[];
  /** Loose plus packs × size, in the item's base unit. */
  baseDelta: number;
  /** Physical stock after this row, worked back from today's stock; null when it can't be worked out. */
  balanceAfter: number | null;
}

type LogItem = Pick<ItemDefinition, 'unit' | 'variants'> | undefined;

/** The pile moves on one log row, read through `logStockDelta` / `logBaseDelta` (all three stored shapes). */
export function describeLog(log: InventoryLog, item: LogItem): Omit<LogLine, 'balanceAfter'> {
  const delta = logStockDelta(log);
  const unit = item?.unit || '';
  const moves: LogMove[] = [];
  if (delta.looseDelta !== 0) moves.push({ id: 'loose', name: 'loose', delta: delta.looseDelta, unit, kind: 'loose' });
  Object.entries(delta.packDeltas).forEach(([id, d]) => {
    const variant = (item?.variants || []).find(v => v.id === id);
    const isPack = Boolean(variant && variant.deduct_from_base !== true);
    moves.push({
      id,
      name: variant?.name || 'Deleted pack',
      delta: d,
      unit: isPack ? 'packs' : 'old count',
      kind: isPack ? 'pack' : 'stray',
    });
  });
  return { log, day: pkDay(log.date), moves, baseDelta: logBaseDelta(delta, item?.variants) };
}

const timeOf = (date: string) => {
  const time = Date.parse(date);
  return Number.isFinite(time) ? time : 0;
};

const recorded = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * One product's history, newest first, each row with the physical stock (base units) left after it.
 * The loose part comes from the loose balance each row recorded (`new_quantity`), so a move that never
 * wrote a log can't throw every older balance off; pack counts have no recorded balance and are worked
 * back from today's counts. Pass `current` null to leave balances out.
 */
export function buildItemHistory(
  logs: InventoryLog[],
  item: LogItem,
  current: { loose: number; packs: Record<string, number> } | null,
): LogLine[] {
  const lines = logs
    .map(log => describeLog(log, item))
    .sort((a, b) => timeOf(b.log.date) - timeOf(a.log.date) || String(b.log.id).localeCompare(String(a.log.id)));
  if (!current) return lines.map(line => ({ ...line, balanceAfter: null }));
  const packSizes = new Map<string, number>();
  (item?.variants || []).forEach(v => { if (v.deduct_from_base !== true) packSizes.set(v.id, sellUnitContains(v)); });
  let loose = Number(current.loose) || 0;
  const packs = new Map<string, number>([...packSizes.keys()].map(id => [id, Number(current.packs[id]) || 0]));
  return lines.map(line => {
    const delta = logStockDelta(line.log);
    const looseAfter = recorded(line.log.new_quantity) ?? loose;
    let total = looseAfter;
    packs.forEach((count, id) => { total += count * (packSizes.get(id) || 0); });
    // Step to the row before this one.
    loose = recorded(line.log.old_quantity) ?? cleanQty(looseAfter - delta.looseDelta);
    Object.entries(delta.packDeltas).forEach(([id, d]) => {
      if (packs.has(id)) packs.set(id, cleanQty((packs.get(id) || 0) - d));
    });
    return { ...line, balanceAfter: cleanQty(total) };
  });
}

/** Logs grouped by item id, keeping the incoming order. */
export function groupLogsByItem(logs: InventoryLog[]): Map<string, InventoryLog[]> {
  const byItem = new Map<string, InventoryLog[]>();
  for (const log of logs) {
    if (!log.item_id) continue;
    const list = byItem.get(log.item_id);
    if (list) list.push(log);
    else byItem.set(log.item_id, [log]);
  }
  return byItem;
}

/** Stock in and out over some rows, in base units. */
export function historyTotals(lines: Pick<LogLine, 'baseDelta'>[]): { stockIn: number; stockOut: number; net: number } {
  let stockIn = 0;
  let stockOut = 0;
  lines.forEach(line => {
    if (line.baseDelta > 0) stockIn += line.baseDelta;
    else stockOut -= line.baseDelta;
  });
  return { stockIn: cleanQty(stockIn), stockOut: cleanQty(stockOut), net: cleanQty(stockIn - stockOut) };
}
