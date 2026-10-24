/** Stock based, accrual profit. Every inventory transfer carries its cost only once. */
export type ProfitRecord = Record<string, any>;
export interface StockProfitSource {
  items: ProfitRecord[];
  sales: ProfitRecord[];
  purchases: ProfitRecord[];
  materialPurchases: ProfitRecord[];
  allocations: ProfitRecord[];
  productionBatches: ProfitRecord[];
  dailySupplyEntries: ProfitRecord[];
  expenses: ProfitRecord[];
  inventoryLogs: ProfitRecord[];
  supplierTransactions: ProfitRecord[];
  retailClosings: ProfitRecord[];
  pendingCount?: number;
  loadedAt?: string;
}
export interface ProfitIssue { code: string; message: string; item?: string }
export interface ProfitStockRow {
  id: string; name: string; location: string; unit: string;
  openingQty: number; openingRate: number; openingValue: number;
  closingQty: number; closingRate: number; closingValue: number;
}
export interface StockProfitReport {
  openingStock: number; closingStock: number; grossPurchases: number; purchaseReturns: number;
  netPurchases: number; conversionCost: number; stockAdjustments: number;
  consumedCost: number; grossSales: number; salesReturns: number; netSales: number;
  posSales: number; supplySales: number; expenses: number; grossProfit: number; netProfit: number;
  margin: number; stockLoss: number; rows: ProfitStockRow[]; issues: ProfitIssue[];
  expenseCategories: { name: string; amount: number }[];
  movements: { date: string; description: string; amount: number; kind: string }[];
  validRange: boolean;
}
import { cleanNumber } from './formatters';
import { saleLineStock, sellUnitContains, type SaleLineCatalog } from './sellUnits';
import { logBaseDelta, logStockDelta } from './stockRules';
import { convertQuantity } from './unitConversion';

type LogVariant = { id: string; quantity_in_base_unit?: number; deduct_from_base?: boolean };

const profitNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const n = profitNumber;
const money = (value: number) => cleanNumber(value, 2);
const qty = (value: number) => Math.round(value * 1e6) / 1e6;
const lower = (value: unknown) => String(value || '').trim().toLowerCase();
const records = (value: unknown): ProfitRecord[] => Array.isArray(value) ? value : [];
const EPS = 0.00001;
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Date-only business dates stay intact; timestamps use the shop's timezone. */
const profitDayCache = new Map<string, string>();
function profitDay(value?: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const cached = profitDayCache.get(value);
  if (cached !== undefined) return cached;
  const time = new Date(value);
  const day = Number.isNaN(time.getTime()) ? '' : dateFormatter.format(time);
  if (profitDayCache.size > 50000) profitDayCache.clear();
  profitDayCache.set(value, day);
  return day;
}
function flattenProfitRecord(row: ProfitRecord): ProfitRecord {
  return { ...row.details, ...row, details: row.details || {} };
}
interface Bucket {
  id: string; name: string; location: string; unit: string; current: number; rate: number;
  quantity: number; value: number; initialRate: number;
}
interface EventInput {
  id: string; date: string; order: number; description: string; kind: string;
  changes: { id: string; quantity: number; value?: number; returnOf?: string }[];
  amount?: number; source?: string; destinations?: { id: string; quantity: number; weight: number }[];
}
/** Business day and timestamp are worked out once per movement, not on every sort comparison. */
interface Event extends EventInput { day: string; time: number }

export function buildStockProfitReport(source: StockProfitSource, start: string, end: string): StockProfitReport {
  const issues = new Map<string, ProfitIssue>();
  const issue = (code: string, message: string, item?: string) => issues.set(`${code}:${item || ''}`, { code, message, item });
  const inRange = (date: string) => profitDay(date) >= start && profitDay(date) <= end;
  const items = source.items.map(flattenProfitRecord);
  const purchases = source.purchases.map(flattenProfitRecord);
  const materials = source.materialPurchases.map(flattenProfitRecord);
  const allocations = source.allocations.map(flattenProfitRecord);
  const batches = source.productionBatches.map(flattenProfitRecord);
  const logs = source.inventoryLogs.map(flattenProfitRecord);
  const sales = source.sales.map(flattenProfitRecord);
  const supplies = source.dailySupplyEntries.map(flattenProfitRecord);
  const buckets = new Map<string, Bucket>();
  const events: Event[] = [];
  const usedLogs = new Set<string>();
  const usedHistory = new Set<string>();
  const addBucket = (id: string, name: string, location: string, unit: string, current = 0, rate = 0) => {
    if (!buckets.has(id)) buckets.set(id, { id, name, location, unit, current, rate, quantity: 0, value: 0, initialRate: rate });
    return id;
  };
  const addEvent = (event: EventInput) => {
    const day = profitDay(event.date);
    if (!day) { issue('missing_date', 'A stock movement has no valid business date.', event.description); return; }
    events.push({ ...event, day, time: new Date(event.date).getTime() });
  };
  // First item wins for a duplicate id or name, exactly like a linear find over the register.
  const itemsById = new Map<unknown, ProfitRecord>();
  const itemsByName = new Map<string, ProfitRecord>();
  items.forEach(item => {
    if (!itemsById.has(item.id)) itemsById.set(item.id, item);
    if (!itemsByName.has(lower(item.name))) itemsByName.set(lower(item.name), item);
  });
  const findItem = (id?: string, name?: string) => itemsById.get(id) || itemsByName.get(lower(name));
  const milkItem = (type: string) => items.find(item => lower(item.name).includes(lower(type)) && lower(item.name).includes('milk'));
  const itemBucket = (item: ProfitRecord, variantId?: string) => {
    if (variantId && variantId !== 'loose' && variantId !== 'base') {
      const variant = records(item.variants).find(v => v.id === variantId);
      if (!variant) issue('missing_variant', 'Pack size is missing; its cost requires review.', `${item.name} / ${variantId}`);
      // A pack pile is counted in packs, so its cost rate is per pack: cost per base unit × pack size.
      return addBucket(`item:${item.id}:${variantId}`, `${item.name} — ${variant?.name || variantId}`, 'Packed stock', 'packs', n(item.variant_stocks?.[variantId]), n(item.cost_price) * sellUnitContains(variant));
    }
    return addBucket(`item:${item.id}:loose`, item.name, 'Counter / warehouse', item.unit || 'units', n(item.stock), n(item.cost_price));
  };
  const isMultiUnit = (item: ProfitRecord, variantId: string) => records(item.variants).some(v => v.id === variantId && v.deduct_from_base === true);
  // One rule for every bill line (docs/stock-model.md): the bill's snapshot wins, then today's catalog.
  const lineStock = (line: ProfitRecord) => {
    const item = findItem(line.itemId || line.item_id, line.name || line.item_name);
    return { item, stock: saleLineStock(line, item as SaleLineCatalog) };
  };
  const lineStockQty = (line: ProfitRecord) => lineStock(line).stock.stockQty;
  const lineBucket = (line: ProfitRecord) => {
    const { item, stock } = lineStock(line);
    if (!item) {
      issue('missing_item', 'A transaction refers to a product missing from the item register.', line.name || line.item_name || line.itemId);
      return addBucket(`missing:${line.itemId || line.name}`, line.name || 'Missing product', 'Unmatched stock', line.unit || 'units');
    }
    return stock.fromBase ? itemBucket(item) : itemBucket(item, stock.variantId);
  };
  /** Litres (milk pool, batches) in a milk item's stock unit: ×1000 for an ml item. A non-volume item can't take litres. */
  const litresIn = (item: ProfitRecord, liters: number) => {
    const converted = convertQuantity(liters, 'L', item.unit || 'L');
    if (converted === null) {
      issue('milk_unit', 'Milk in litres moved into a product that is not stocked in L or ml; its quantity is taken as is.', item.name);
      return liters;
    }
    return converted;
  };
  items.forEach(item => {
    itemBucket(item);
    Object.keys(item.variant_stocks || {}).forEach(id => {
      // A count on a dozen/tray is a stray number, not stock: it gets no bucket and no value.
      if (isMultiUnit(item, id)) return;
      // A deleted pack that holds nothing has no history worth a row.
      if (!records(item.variants).some(v => v.id === id) && n(item.variant_stocks?.[id]) === 0) return;
      itemBucket(item, id);
    });
  });
  const allocByPurchase = new Map(allocations.map(a => [a.purchase_id, a]));
  const rawBucket = (purchase: ProfitRecord) => {
    const allocation = allocByPurchase.get(purchase.id);
    const remaining = allocation?.remaining_quantity ?? (allocation ? n(allocation.original_quantity) - n(allocation.allocated_quantity) : 0);
    return addBucket(`raw:${purchase.id}`, `${purchase.milk_type || 'Raw'} milk`, 'Unallocated milk', 'L', n(remaining), n(purchase.rate || purchase.rate_per_liter));
  };
  // Returns are vouchers on their own dates. Partial returns mutate purchase quantities,
  // so restore the original invoice before applying each return voucher.
  const supplierReturns = source.supplierTransactions.map(flattenProfitRecord).filter(tx => lower(tx.type) === 'return');
  const returnedByPurchase = new Map<string, ProfitRecord[]>();
  supplierReturns.forEach(tx => {
    const id = tx.purchase_id || tx.details?.purchase_id;
    if (!id) { issue('unlinked_purchase_return', 'A supplier return is not linked to a purchase.', tx.id); return; }
    returnedByPurchase.set(id, [...(returnedByPurchase.get(id) || []), tx]);
  });
  const purchaseDocuments: ProfitRecord[] = [...purchases.map(p => ({ ...p, isMilk: true })), ...materials.map(p => ({ ...p, isMilk: false }))];
  purchaseDocuments.forEach(p => {
    if (lower(p.status) === 'cancelled') return;
    // A ready-made pack bought as packs was stocked into that pack's own pile, counted in packs.
    // Saved as `stocked_as: 'packs'` since that field exists; older rows only name the variant, and
    // only a ready-made pack (never a dozen/tray) holds its own count.
    const packId = !p.isMilk && p.variant_id && lower(p.stocked_as) !== 'loose' ? String(p.variant_id) : '';
    const packItem = packId ? findItem(p.item_id, p.item_name) : undefined;
    const packVariant = packItem ? records(packItem.variants).find(v => v.id === packId) : undefined;
    const intoPack = Boolean(packVariant && (lower(p.stocked_as) === 'packs' || packVariant.deduct_from_base !== true));
    const id = p.isMilk ? rawBucket(p) : intoPack ? itemBucket(packItem!, packId) : lineBucket({ itemId: p.item_id, name: p.item_name });
    const conv = intoPack ? 1 : (!p.isMilk && n(p.conversion_factor) > 0 ? n(p.conversion_factor) : 1);
    const purchaseUnitRate = n(p.rate || p.rate_per_liter) || (n(p.quantity) > 0 ? n(p.total_amount) / n(p.quantity) : 0);
    const rate = conv > 0 ? purchaseUnitRate / conv : purchaseUnitRate;
    let returns = returnedByPurchase.get(p.id) || [];
    if (!returns.length && (lower(p.status) === 'returned' || n(p.returned_quantity) > 0)) {
      const returnedQtyInBase = (n(p.returned_quantity) || n(p.quantity)) * conv;
      const returnDate = p.returned_at || p.last_returned_at;
      if (returnDate) returns = [{ id: `return:${p.id}`, date: returnDate, amount: returnedQtyInBase * rate }];
      else issue('missing_return_date', 'A returned purchase has no return date.', p.item_name || p.milk_type);
      if (p.partial_returned && returnedQtyInBase > 0) issue('return_history', 'Multiple supplier returns have only a last return date; period allocation needs review.', p.item_name || p.milk_type);
    }
    const returnedAmount = returns.reduce((sum, tx) => sum + n(tx.amount), 0);
    const wasFullReturn = lower(p.status) === 'returned';
    const rawQtyInBase = n(p.quantity) * conv;
    const rawOrigQtyInBase = n(p.original_intake_quantity || p.original_quantity || p.quantity) * conv;
    const originalQty = wasFullReturn ? Math.max(rawOrigQtyInBase, rate > 0 ? returnedAmount / rate : 0) : rawQtyInBase + (rate > 0 ? returnedAmount / rate : 0);
    const originalAmount = wasFullReturn ? originalQty * rate : n(p.total_amount) + returnedAmount;
    const bucket = buckets.get(id)!;
    if (rate > 0) bucket.initialRate = rate;
    addEvent({ id: `purchase:${p.id}`, date: p.date, order: 10, kind: 'Purchase', description: `${p.isMilk ? p.milk_type + ' milk' : p.item_name} purchase`, changes: [{ id, quantity: originalQty, value: originalAmount }], amount: originalAmount });
    returns.forEach(tx => {
      if (rate <= 0) issue('return_rate', 'Supplier return quantity cannot be recovered because its purchase rate is missing.', p.item_name || p.milk_type);
      addEvent({ id: tx.id, date: tx.date, order: 60, kind: 'Purchase return', description: 'Return to supplier', changes: [{ id, quantity: rate > 0 ? -n(tx.amount) / rate : 0, value: -n(tx.amount) }], amount: -n(tx.amount) });
    });
  });

  const purchasesById = new Map<unknown, ProfitRecord>();
  purchases.forEach(p => { if (!purchasesById.has(p.id)) purchasesById.set(p.id, p); });
  const rawForAllocation = (allocation: ProfitRecord) => {
    const purchase = purchasesById.get(allocation.purchase_id);
    return purchase ? rawBucket(purchase) : addBucket(`raw:${allocation.purchase_id || allocation.id}`, `${allocation.milk_type || 'Raw'} milk`, 'Unallocated milk', 'L', n(allocation.remaining_quantity ?? (n(allocation.original_quantity) - n(allocation.allocated_quantity))), n(allocation.average_rate));
  };
  // `toQuantity` is the same stock in the destination's unit (litres out of the pool, ml into an ml-stocked milk item).
  const transfer = (id: string, date: string, from: string, to: string, quantity: number, description: string, order = 20, toQuantity = quantity) => addEvent({ id, date, order, description, kind: 'Transfer', changes: [{ id: from, quantity: -quantity }, { id: to, quantity: toQuantity }], source: from, destinations: [{ id: to, quantity: toQuantity, weight: 1 }] });
  // Separate delivery stock prevents an allocation being counted as a sale.
  const supplyBucket = (allocation: ProfitRecord) => {
    // Only the first call creates the bucket; later calls would rescan every delivery for nothing.
    if (buckets.has(`delivery:${allocation.id}`)) return `delivery:${allocation.id}`;
    const delivered = supplies.filter(s => !['pending', 'cancelled'].includes(lower(s.status)) && (s.allocation_id === allocation.id || s.allocation_id === allocation.purchase_id)).reduce((sum, s) => sum + n(s.net_qty ?? (s.delivered_qty != null ? n(s.delivered_qty) - n(s.returned_qty) : s.quantity)), 0);
    const histories = records(allocation.allocation_history || allocation.details?.allocation_history).filter(h => lower(h.destination) === 'home delivery');
    const sent = histories.reduce((sum, h) => sum + n(h.quantity), 0) || (lower(allocation.destination) === 'home delivery' ? n(allocation.allocated_quantity) : 0);
    return addBucket(`delivery:${allocation.id}`, `${allocation.milk_type || 'Raw'} milk`, 'Delivery stock', 'L', sent - delivered, n(allocation.average_rate));
  };
  allocations.forEach(a => {
    const raw = rawForAllocation(a);
    const history = records(a.allocation_history || a.details?.allocation_history);
    history.forEach((h, index) => {
      const historyId = `${a.id}:${index}`;
      const dest = lower(h.destination);
      if (dest === 'production') return; // Batch inputs below own this transfer.
      let to: string;
      let toQuantity = n(h.quantity);
      if (dest === 'home delivery') to = supplyBucket(a);
      else if (dest === 'retail counter') {
        // The log is in the item's unit; older code wrote litres even for an ml item, so accept either.
        const matchesQty = (l: ProfitRecord) => {
          const logItem = findItem(l.item_id, l.item_name);
          return Math.abs(n(l.difference) - n(h.quantity)) < EPS || (logItem ? Math.abs(n(l.difference) - litresIn(logItem, n(h.quantity))) < EPS : false);
        };
        const log = logs.find(l => lower(l.reason) === 'allocation' && n(l.difference) > 0 && String(l.notes || '').includes(`Purchase #${a.purchase_id}`) && profitDay(l.date) === profitDay(h.allocated_at) && !usedLogs.has(l.id) && matchesQty(l));
        const item = findItem(log?.item_id, log?.item_name) || milkItem(a.milk_type);
        if (!item) { issue('allocation_item', 'Retail milk allocation has no matching milk product.', a.milk_type); return; }
        to = itemBucket(item);
        // What the stock log says moved is what the counter got; without one, the litres in the item's unit.
        toQuantity = log ? n(log.difference) : litresIn(item, n(h.quantity));
        if (log) usedLogs.add(log.id);
      } else { issue('allocation_destination', 'An allocation has an unknown destination.', a.milk_type); return; }
      usedHistory.add(historyId);
      transfer(`allocation:${historyId}`, h.allocated_at || a.date, raw, to, n(h.quantity), 'Milk allocation', 20, toQuantity);
    });
    if (!history.length && n(a.allocated_quantity) > EPS && !a.returned_from_batch_id) {
      const retailLogs = logs.filter(l => !usedLogs.has(l.id) && lower(l.reason) === 'allocation' && n(l.difference) > 0 && (String(l.id).includes(a.id) || String(l.notes || '').includes(`Purchase #${a.purchase_id}`)));
      const loggedQty = retailLogs.reduce((sum, log) => sum + n(log.difference), 0);
      if (lower(a.destination) === 'retail counter' && retailLogs.length) {
        retailLogs.forEach(log => {
          const item = findItem(log.item_id, log.item_name) || milkItem(a.milk_type);
          if (!item) { issue('allocation_item', 'Retail milk allocation has no matching product.', a.milk_type); return; }
          usedLogs.add(log.id);
          // The log is in the item's unit; the pool is in litres.
          const liters = convertQuantity(n(log.difference), item.unit || 'L', 'L') ?? n(log.difference);
          transfer(`allocation-log:${log.id}`, log.date, raw, itemBucket(item), liters, 'Milk allocation recovered from stock log', 20, n(log.difference));
        });
        if (Math.abs(loggedQty - n(a.allocated_quantity)) > 0.001) issue('allocation_history', 'Stock allocation logs do not match the allocated milk quantity.', `${a.milk_type} / ${a.id}`);
        return;
      }
      issue('allocation_history', 'Allocation timestamps are missing; the purchase date is used provisionally.', `${a.milk_type} / ${a.id}`);
      if (lower(a.destination) === 'home delivery') transfer(`allocation:${a.id}`, a.date, raw, supplyBucket(a), n(a.allocated_quantity), 'Legacy delivery allocation');
      if (lower(a.destination) === 'retail counter') {
        const item = milkItem(a.milk_type);
        if (item) transfer(`allocation:${a.id}`, a.date, raw, itemBucket(item), n(a.allocated_quantity), 'Legacy retail allocation', 20, litresIn(item, n(a.allocated_quantity)));
      }
    }
  });

  batches.forEach(batch => {
    const completion = batch.completed_date || records(batch.logs).find(l => lower(l.stage) === lower(batch.status))?.timestamp;
    const terminal = ['completed', 'cancelled'].includes(lower(batch.status));
    const wip = addBucket(`wip:${batch.id}`, `${batch.product_name} · ${batch.batch_number}`, 'Work in progress', 'L input', terminal ? 0 : n(batch.quantity_input), n(batch.input_cost_per_unit || batch.details?.input_cost_per_unit));
    const breakdown = records(batch.milk_breakdown || batch.details?.milk_breakdown);
    if (!breakdown.length) issue('batch_input', 'Production milk sources are missing; the batch input cost is provisional.', batch.batch_number);
    breakdown.forEach((part, index) => {
      const allocation = allocations.find(a => a.id === part.allocationId || a.purchase_id === part.allocationId);
      const item = findItem(String(part.allocationId || '').replace(/^inv_/, '')) || milkItem(part.milkType);
      const fromCounter = part.source === 'retail' && item;
      const from = fromCounter ? itemBucket(item) : allocation ? rawForAllocation(allocation) : '';
      if (!from) { issue('batch_source', 'A production milk source cannot be linked to its original stock.', batch.batch_number); return; }
      // Batches are in litres; counter milk leaves in the item's own unit (ml for an ml item).
      const outQty = fromCounter ? litresIn(item, n(part.quantity)) : n(part.quantity);
      transfer(`batch-in:${batch.id}:${index}`, batch.start_date, from, wip, outQty, 'Milk into production', 25, n(part.quantity));
      if (part.source === 'retail') {
        const log = logs.find(l => !usedLogs.has(l.id) && l.item_id === item?.id && lower(l.reason) === 'allocation' && n(l.difference) < 0 && (Math.abs(n(l.difference) + outQty) < EPS || Math.abs(n(l.difference) + n(part.quantity)) < EPS) && profitDay(l.date) === profitDay(batch.start_date));
        if (log) usedLogs.add(log.id);
      } else if (allocation) {
        const history = records(allocation.allocation_history || allocation.details?.allocation_history);
        const index = history.findIndex((h, i) => !usedHistory.has(`${allocation.id}:${i}`) && lower(h.destination) === 'production' && Math.abs(n(h.quantity) - n(part.quantity)) < EPS && profitDay(h.allocated_at) === profitDay(batch.start_date));
        if (index >= 0) usedHistory.add(`${allocation.id}:${index}`);
      }
    });
    if (!breakdown.length) addEvent({ id: `batch-in:${batch.id}`, date: batch.start_date, order: 25, kind: 'Adjustment', description: 'Unlinked production input', changes: [{ id: wip, quantity: n(batch.quantity_input), value: n(batch.quantity_input) * n(batch.input_cost_per_unit || batch.details?.input_cost_per_unit) }] });
    if (!terminal) return;
    if (!completion) { issue('batch_completion_date', 'A terminal batch has no completion date.', batch.batch_number); return; }
    if (lower(batch.status) === 'cancelled') {
      const returned = allocations.find(a => a.returned_from_batch_id === batch.id || a.details?.returned_from_batch_id === batch.id);
      if (returned) transfer(`batch-cancel:${batch.id}`, completion, wip, rawForAllocation(returned), n(batch.quantity_input), 'Cancelled batch milk returned', 35);
      else issue('batch_cancel', 'Cancelled batch milk has no return allocation.', batch.batch_number);
      return;
    }
    const item = findItem(batch.item_id, batch.product_name);
    if (!item) { issue('batch_product', 'Finished production product is missing from the catalog.', batch.product_name); return; }
    const output = batch.output_breakdown || batch.details?.output_breakdown;
    const prodLog = logs.find(l => l.id === `log_prod_${batch.id}`);
    if (prodLog) usedLogs.add(prodLog.id);
    const destinations: { id: string; quantity: number; weight: number }[] = [];
    if (output) {
      if (n(output.loose_qty) > 0) destinations.push({ id: itemBucket(item), quantity: n(output.loose_qty), weight: n(output.loose_qty) });
      records(output.variants).forEach(v => {
        const variantId = v.variantId || v.variant_id || records(item.variants).find(d => d.name === v.variant_name)?.id;
        const factor = n(v.base_qty_each) || n(records(item.variants).find(d => d.id === variantId)?.quantity_in_base_unit);
        if (!variantId || factor <= 0) issue('batch_pack', 'A production pack has no saved size.', batch.batch_number);
        if (variantId) destinations.push({ id: itemBucket(item, variantId), quantity: n(v.count), weight: n(v.total_base_qty) || n(v.count) * factor });
      });
    } else {
      const actual = n(batch.quantity_output_actual);
      const loose = prodLog ? n(prodLog.difference) : actual;
      if (loose > 0) destinations.push({ id: itemBucket(item), quantity: loose, weight: loose });
      // Old batches only stored packed counts in the log text.
      const packed = String(prodLog?.notes || '').match(/\[Packaged: (.*?)\]/)?.[1];
      if (packed) packed.split(', ').forEach(part => {
        const match = part.match(/^([\d.]+)x (.+)$/);
        const variant = records(item.variants).find(v => v.name === match?.[2]);
        if (match && variant) destinations.push({ id: itemBucket(item, variant.id), quantity: n(match[1]), weight: n(match[1]) * n(variant.quantity_in_base_unit) });
        else issue('batch_pack', 'Old production pack output cannot be identified.', batch.batch_number);
      });
      if (actual <= 0 || records(item.variants).length || Math.abs(destinations.reduce((sum, d) => sum + d.weight, 0) - actual) > 0.001) issue('batch_output', 'Production has no complete saved output breakdown; check loose and packed stock.', batch.batch_number);
    }
    const recipeSnapshot = batch.cost_snapshot || batch.details?.cost_snapshot;
    if ((!recipeSnapshot && (records(item.recipe).length || destinations.some(d => d.id !== itemBucket(item)))) || recipeSnapshot?.materials_posted === false) issue('production_materials', 'Ingredient / packaging consumption was not posted for this batch. Check stock and costs before relying on net profit.', batch.batch_number);
    if (recipeSnapshot?.materials_posted === true) {
      const matInputs = [...records(recipeSnapshot.recipe_inputs), ...records(recipeSnapshot.packaging_inputs)];
      matInputs.forEach((mat, matIdx) => {
        const matQty = n(mat.quantity);
        if (matQty <= 0) return;
        const matItem = findItem(mat.item_id, mat.item_name);
        if (!matItem) return;
        const matLog = logs.find(l => l.id === `log_prod_mat_${batch.id}_${mat.item_id}` || (!usedLogs.has(l.id) && l.item_id === matItem.id && lower(l.reason) === 'production usage' && Math.abs(n(l.difference) + matQty) < EPS && profitDay(l.date) === profitDay(completion)));
        if (matLog) usedLogs.add(matLog.id);
        // A material taken partly from ready-made packs (loose first, then whole packs, the rest of the
        // last pack back to loose) leaves each pile as its usage log says; otherwise it all came from loose.
        const matDelta = matLog ? logStockDelta(matLog) : undefined;
        const packMoves = matDelta ? Object.entries(matDelta.packDeltas).filter(([id]) => !isMultiUnit(matItem, id)) : [];
        const pileMoves = packMoves.length
          ? [...(matDelta!.looseDelta ? [{ id: itemBucket(matItem), quantity: matDelta!.looseDelta }] : []), ...packMoves.map(([id, delta]) => ({ id: itemBucket(matItem, id), quantity: delta }))]
          : [{ id: itemBucket(matItem), quantity: -matQty }];
        pileMoves.forEach((move, pileIdx) => addEvent({
          id: `batch-mat:${batch.id}:${matIdx}${pileIdx ? `:${pileIdx}` : ''}`,
          date: completion,
          order: 28,
          kind: 'Transfer',
          description: `Production material: ${matItem.name}`,
          changes: [{ id: move.id, quantity: move.quantity }, { id: wip, quantity: 0 }],
          source: move.id,
          destinations: [{ id: wip, quantity: 0, weight: 1 }]
        }));
      });
    }
    const extra = n(recipeSnapshot?.external_conversion_cost);
    if (extra > 0) addEvent({ id: `conversion:${batch.id}`, date: completion, order: 29, kind: 'Conversion cost', description: 'Production conversion cost', changes: [{ id: wip, quantity: 0, value: extra }], amount: extra });
    if (destinations.length) addEvent({ id: `batch-out:${batch.id}`, date: completion, order: 30, kind: 'Transfer', description: 'Finished production', changes: [{ id: wip, quantity: -n(batch.quantity_input) }, ...destinations.map(d => ({ id: d.id, quantity: d.quantity }))], source: wip, destinations });
    else issue('batch_output', 'Production output quantity is missing.', batch.batch_number);
  });
  // Unmatched production transfers are still assets until their batch is identified.
  allocations.forEach(a => records(a.allocation_history || a.details?.allocation_history).forEach((h, index) => {
    if (lower(h.destination) !== 'production' || usedHistory.has(`${a.id}:${index}`)) return;
    issue('unlinked_production', 'Milk sent to production has no linked batch input.', a.id);
    const holding = addBucket(`holding:${a.id}:${index}`, `${a.milk_type} milk`, 'Unmatched production stock', 'L', n(h.quantity), n(a.average_rate));
    transfer(`holding-in:${a.id}:${index}`, h.allocated_at || a.date, rawForAllocation(a), holding, n(h.quantity), 'Unlinked production transfer');
  }));

  sales.forEach(sale => {
    if (['cancelled', 'draft'].includes(lower(sale.status))) return;
    addEvent({ id: `sale:${sale.id}`, date: sale.date, order: 40, description: `Invoice ${sale.bill_number || sale.id}`, kind: 'POS sale', amount: n(sale.total), changes: records(sale.items).map(line => ({ id: lineBucket(line), quantity: -lineStockQty(line) })) });
    let returns = records(sale.returned_items || sale.details?.returned_items);
    if (!returns.length && (n(sale.refund_amount) > 0 || lower(sale.status) === 'returned')) {
      const returnDate = sale.returned_at;
      if (returnDate) returns = records(sale.items).map(line => ({ ...line, returnDate, action: sale.return_type || sale.details?.return_type || 'refund', restock: sale.restock_action || sale.details?.restock_action || 'restock' }));
      else issue('sales_return_date', 'A returned sale has no return date.', sale.bill_number);
    }
    const refundLines = returns.filter(line => line.action !== 'replace');
    const beforeDiscount = records(sale.items).reduce((sum, line) => sum + n(line.total ?? n(line.qty) * n(line.price)), 0);
    const discountFactor = beforeDiscount > 0 ? n(sale.total) / beforeDiscount : 0;
    const lineRefundTotal = refundLines.reduce((sum, line) => sum + n(line.qty) * n(line.price) * discountFactor, 0);
    const refundTotal = sale.refund_amount != null ? n(sale.refund_amount) : lineRefundTotal;
    // A return goes back to the pile its bill line left, sized as sold: the sold line's snapshot fills
    // what the return entry did not save (same rule as the sales-return screen).
    const soldLines = records(sale.items);
    const lineId = (line: ProfitRecord) => line.itemId || line.item_id;
    const lineVariant = (line: ProfitRecord) => line.variantId || line.variant_id || undefined;
    const soldLineOf = (line: ProfitRecord): ProfitRecord => {
      const byIndex = Number.isInteger(line.lineIndex) ? soldLines[line.lineIndex] : undefined;
      if (byIndex && lineId(byIndex) === lineId(line)) return byIndex;
      return soldLines.find(l => lineId(l) === lineId(line) && lineVariant(l) === lineVariant(line)) || {};
    };
    const asSold = (line: ProfitRecord): ProfitRecord => {
      const sold = soldLineOf(line);
      return {
        ...line,
        isLoose: line.isLoose ?? sold.isLoose,
        stockDeduction: line.stockDeduction ?? sold.stockDeduction,
        deductFromBase: line.deductFromBase ?? line.deduct_from_base ?? sold.deductFromBase ?? sold.deduct_from_base,
      };
    };
    returns.forEach((line, index) => {
      const date = line.returnDate || sale.returned_at;
      const isReplacement = line.action === 'replace';
      const restock = line.restock !== 'scrap_spoilage';
      const amount = !isReplacement && lineRefundTotal > 0 ? -refundTotal * (n(line.qty) * n(line.price) * discountFactor / lineRefundTotal) : 0;
      const stockLine = asSold(line);
      addEvent({ id: `sale-return:${sale.id}:${index}`, date, order: 60, description: `Return: ${sale.bill_number || sale.id}`, kind: isReplacement ? 'Replacement' : 'Sales return', amount, changes: isReplacement ? [] : restock ? [{ id: lineBucket(stockLine), quantity: lineStockQty(stockLine), returnOf: `sale:${sale.id}` }] : [] });
    });
  });
  // A delivery points at its allocation by id or by purchase id; the first allocation in list order wins.
  const allocationByRef = new Map<unknown, ProfitRecord>();
  allocations.forEach(a => {
    if (!allocationByRef.has(a.id)) allocationByRef.set(a.id, a);
    if (!allocationByRef.has(a.purchase_id)) allocationByRef.set(a.purchase_id, a);
  });
  supplies.forEach(s => {
    if (['pending', 'cancelled'].includes(lower(s.status))) return;
    const a = allocationByRef.get(s.allocation_id);
    const delivered = n(s.net_qty ?? (s.delivered_qty != null ? n(s.delivered_qty) - n(s.returned_qty) : s.quantity));
    if (!a) issue('supply_stock', 'A delivery sale has no linked milk allocation.', s.id);
    addEvent({ id: `supply:${s.id}`, date: s.date, order: 40, description: 'Home delivery sale', kind: 'Supply sale', amount: n(s.total_amount), changes: a ? [{ id: supplyBucket(a), quantity: -delivered }] : [] });
  });
  // POS writes one 'Sale' log per bill line ('log_<billId>_<itemId>'). Scanning every bill for every
  // such log grew with bills x lines; ids found between '_' separators are checked in a set first,
  // and only a log that matches none falls back to the full substring scan.
  const saleIds = new Set<unknown>(sales.map(sale => sale.id));
  const saleLogHasInvoice = (log: ProfitRecord) => {
    if (saleIds.has(log.sale_id) || saleIds.has(log.details?.sale_id)) return true;
    const parts = String(log.id).split('_');
    for (let first = 0; first < parts.length; first++) {
      let joined = parts[first];
      if (saleIds.has(joined)) return true;
      for (let last = first + 1; last < parts.length; last++) {
        joined = `${joined}_${parts[last]}`;
        if (saleIds.has(joined)) return true;
      }
    }
    return sales.some(sale => String(log.id).includes(sale.id));
  };
  logs.forEach(log => {
    if (usedLogs.has(log.id)) return;
    const reason = lower(log.reason);
    if (['sale', 'pos sale'].includes(reason)) {
      if (saleLogHasInvoice(log)) return;
      issue('orphan_sale_log', 'A stock sale log has no matching invoice.', log.item_name);
    }
    if (['purchase', 'production', 'sales return', 'supply return'].includes(reason)) return; // Document owns movement.
    const item = findItem(log.item_id, log.item_name) || items.find(i => String(log.item_name || '').startsWith(i.name + ' ('));
    // Every log shape is read one way (stockRules.logStockDelta). Very old rows kept the pack move in
    // top-level columns instead of details; they are read as the same `variant_id` + `variant_delta` shape.
    const legacyPack = !log.details?.variant_id && !log.details?.variant_deltas && log.variant_id
      ? { variant_id: log.variant_id, variant_delta: log.variant_delta ?? log.variant_qty, ...(log.loose_delta != null ? { loose_delta: log.loose_delta } : {}) }
      : {};
    const read = logStockDelta({ ...log, details: { ...legacyPack, ...(log.details || {}) } });
    const moves = Math.abs(read.looseDelta) > EPS || Object.keys(read.packDeltas).length > 0;
    if (!item) { if (moves) issue('unknown_log', 'A stock adjustment has no matching product.', log.item_name); return; }
    if (read.unrecordedPacks) issue('variant_log', 'A stock count changed pack stock without naming the pack; only its loose part is in this report.', item.name);
    const named = records(item.variants).find(v => log.item_name === `${item.name} (${v.name})`);
    const structured = Object.keys(read.packDeltas).length > 0 || log.details?.loose_delta != null;
    const namedPack = Boolean(named && !structured && named.deduct_from_base !== true);
    const changes: { id: string; quantity: number }[] = [];
    if (namedPack) {
      // Old rows named the pack in item_name ("Dahi (500 g tub)") and kept its count change in the columns.
      if (read.looseDelta) changes.push({ id: itemBucket(item, named!.id), quantity: read.looseDelta });
    } else {
      if (read.looseDelta) changes.push({ id: itemBucket(item), quantity: read.looseDelta });
      Object.entries(read.packDeltas).forEach(([id, quantity]) => {
        // Clearing a stray count on a dozen/tray moves no stock (it never had a bucket).
        if (isMultiUnit(item, id) && !buckets.has(`item:${item.id}:${id}`)) return;
        changes.push({ id: itemBucket(item, id), quantity });
      });
    }
    // Gain or loss is judged in base units: 2 packs out and 0.1 kg loose in is a loss.
    const baseDelta = namedPack ? read.looseDelta * sellUnitContains(named) : logBaseDelta(read, records(item.variants) as LogVariant[]);
    if (reason === 'allocation') {
      issue('unlinked_allocation_log', 'An allocation stock movement is not linked to its source history.', item.name);
      // Preserve unmatched movement, but prevent it being labelled verified profit.
    }
    if (!changes.length) return;
    const loss = /spoil|wastage|consumption|theft|loss|production usage/.test(reason) || ['sale', 'pos sale'].includes(reason) || (reason === 'stock count correction' && baseDelta < 0);
    addEvent({ id: `log:${log.id}`, date: log.date, order: 50, description: `${log.reason}: ${item.name}`, kind: loss ? 'Stock loss' : 'Adjustment', changes });
  });
  source.retailClosings.map(flattenProfitRecord).forEach(closing => {
    if (n(closing.total_unrecorded_revenue) > 0 && !closing.auto_posted_sale_id && !closing.auto_posted_sale && !sales.some(s => (s.retail_closing_id || s.details?.retail_closing_id) === closing.id)) issue('unposted_sales', 'A retail closing contains sales that were not posted to invoices.', closing.date);
  });
  if (source.pendingCount) issue('pending_sync', `${source.pendingCount} local record(s) are waiting for sync. This is a provisional report.`);
  const today = profitDay(new Date().toISOString());
  if (end > today) issue('future_range', 'The range includes future dates; closing stock is only available up to today.');
  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
  if (!validRange) issue('invalid_range', 'Select a valid start and end date.');
  const daysWithoutTimes = new Set(events.filter(e => e.date.length === 10).map(e => e.day));
  events.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    // Date-only invoices have no time; use lifecycle order before timestamp ordering.
    if (daysWithoutTimes.has(a.day)) return a.order - b.order || a.id.localeCompare(b.id);
    return a.time - b.time || a.order - b.order || a.id.localeCompare(b.id);
  });
  // Recover the quantity before the earliest stored movement from today's stock.
  const deltas = new Map<string, number>();
  events.forEach(e => e.changes.forEach(c => deltas.set(c.id, (deltas.get(c.id) || 0) + c.quantity)));
  // Never use today's catalog cost for a historical item that has a recorded receipt.
  const seededRates = new Set<string>();
  events.forEach(event => event.changes.forEach(change => {
    if (event.kind === 'Purchase' && change.quantity > 0 && change.value != null && !seededRates.has(change.id)) {
      buckets.get(change.id)!.initialRate = change.value / change.quantity;
      seededRates.add(change.id);
    }
  }));
  buckets.forEach(b => {
    b.quantity = qty(b.current - (deltas.get(b.id) || 0));
    if (Math.abs(b.quantity) > EPS) issue('opening_history', 'Stock exists before the first recorded movement. Its quantity is recovered from current stock; its historical cost needs confirmation.', `${b.name} (${b.location})`);
    if (b.quantity < -EPS) issue('negative_opening', 'Stock history does not reconcile with current stock; a movement may be missing or duplicated.', `${b.name} (${b.location})`);
    b.value = b.quantity * b.initialRate;
    if (b.quantity > EPS && b.initialRate <= 0) issue('missing_cost', 'Stock has no purchase or saved cost rate.', b.name);
  });
  const snapshot = () => new Map([...buckets].map(([id, b]) => [id, { quantity: b.quantity, value: b.value }]));
  // Opening is the stock just before the first in-period movement (or after every earlier one);
  // closing is the stock after the last movement up to the end date. Taking each picture once
  // replaces a full copy of every bucket after every pre-period movement.
  let opening: ReturnType<typeof snapshot> | undefined;
  let grossPurchases = 0, purchaseReturns = 0, posSales = 0, supplySales = 0, salesReturns = 0, conversionCost = 0, stockAdjustments = 0, stockLoss = 0;
  const movements: StockProfitReport['movements'] = [];
  const soldCosts = new Map<string, { quantity: number; value: number }>();
  for (const event of events) {
    const day = event.day;
    if (day > end) break;
    const period = day >= start && validRange;
    if (period && !opening) opening = snapshot();
    let transferred = 0;
    if (event.source) {
      const b = buckets.get(event.source)!;
      const out = -(event.changes.find(c => c.id === event.source)?.quantity || 0);
      const unitCost = b.quantity > EPS ? b.value / b.quantity : b.initialRate;
      transferred = out * unitCost;
    }
    let adjustmentValue = 0, lossValue = 0;
    const weights = (event.destinations || []).reduce((sum, d) => sum + d.weight, 0);
    event.changes.forEach(change => {
      const b = buckets.get(change.id)!;
      const rate = b.quantity > EPS ? b.value / b.quantity : b.initialRate;
      let value = change.value ?? change.quantity * rate;
      if (change.returnOf) {
        const sold = soldCosts.get(`${change.returnOf}:${change.id}`);
        if (sold && sold.quantity > 0) value = change.quantity * sold.value / sold.quantity;
        else issue('return_cost', 'Returned stock has no original sale cost to reverse.', b.name);
      }
      if (event.source === change.id) value = -transferred;
      else if (event.source) {
        const destination = event.destinations?.find(d => d.id === change.id);
        value = weights > 0 ? transferred * (destination?.weight || 0) / weights : 0;
      }
      if (event.kind === 'POS sale') {
        const key = `${event.id}:${change.id}`;
        const sold = soldCosts.get(key) || { quantity: 0, value: 0 };
        soldCosts.set(key, { quantity: sold.quantity - change.quantity, value: sold.value - value });
      }
      if (change.quantity > EPS && value <= 0) issue('missing_cost', 'Incoming stock has no recoverable cost.', b.name);
      b.quantity = qty(b.quantity + change.quantity);
      b.value += value;
      if (b.quantity < -EPS) issue('negative_stock', 'Stock became negative while replaying history; check missing receipts and timing.', b.name);
      if (Math.abs(b.quantity) < EPS) {
        if (Math.abs(b.value) > 0.02) issue('cost_reconciliation', 'Stock quantity reached zero with a remaining cost difference.', b.name);
        // Keep the difference for reconciliation; never silently invent a profit.
      }
      if (event.kind === 'Adjustment') adjustmentValue += value;
      if (event.kind === 'Stock loss') lossValue -= value;
    });
    if (!period) continue;
    if (event.kind === 'Purchase') grossPurchases += n(event.amount);
    if (event.kind === 'Purchase return') purchaseReturns -= n(event.amount);
    if (event.kind === 'POS sale') posSales += n(event.amount);
    if (event.kind === 'Supply sale') supplySales += n(event.amount);
    if (event.kind === 'Sales return') salesReturns -= n(event.amount);
    if (event.kind === 'Conversion cost') conversionCost += n(event.amount);
    stockAdjustments += adjustmentValue;
    stockLoss += lossValue;
    if (event.kind !== 'Transfer') movements.push({ date: day, description: event.description, kind: event.kind, amount: money(event.amount ?? (event.kind === 'Stock loss' ? lossValue : adjustmentValue)) });
  }
  const closing = snapshot();
  const openingSnap = opening ?? closing;
  const rows = [...buckets.values()].map(b => {
    const o = openingSnap.get(b.id) || { quantity: 0, value: 0 };
    const c = closing.get(b.id) || o;
    return { id: b.id, name: b.name, location: b.location, unit: b.unit, openingQty: qty(o.quantity), openingRate: money(o.quantity > EPS ? o.value / o.quantity : b.initialRate), openingValue: money(o.value), closingQty: qty(c.quantity), closingRate: money(c.quantity > EPS ? c.value / c.quantity : b.initialRate), closingValue: money(c.value) };
  }).filter(r => Math.abs(r.openingQty) > EPS || Math.abs(r.closingQty) > EPS || Math.abs(r.openingValue) > 0.01 || Math.abs(r.closingValue) > 0.01).sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
  const categories = new Map<string, number>();
  source.expenses.map(flattenProfitRecord).filter(e => validRange && inRange(e.date) && !['cancelled', 'returned'].includes(lower(e.status))).forEach(e => categories.set(e.category || 'General', (categories.get(e.category || 'General') || 0) + n(e.amount)));
  const expenses = money([...categories.values()].reduce((sum, amount) => sum + amount, 0));
  const openingStock = money(rows.reduce((sum, r) => sum + r.openingValue, 0));
  const closingStock = money(rows.reduce((sum, r) => sum + r.closingValue, 0));
  const netPurchases = money(grossPurchases - purchaseReturns);
  const consumedCost = money(openingStock + netPurchases + conversionCost + stockAdjustments - closingStock);
  const grossSales = money(posSales + supplySales);
  const netSales = money(grossSales - salesReturns);
  const grossProfit = money(netSales - consumedCost);
  const netProfit = money(grossProfit - expenses);
  if (consumedCost < -0.02) issue('negative_cost', 'Consumed stock cost is negative. Review opening balances, returns and adjustments.');
  return { openingStock, closingStock, grossPurchases: money(grossPurchases), purchaseReturns: money(purchaseReturns), netPurchases, conversionCost: money(conversionCost), stockAdjustments: money(stockAdjustments), consumedCost, grossSales, salesReturns: money(salesReturns), netSales, posSales: money(posSales), supplySales: money(supplySales), expenses, grossProfit, netProfit, margin: netSales > 0 ? netProfit / netSales * 100 : 0, stockLoss: money(stockLoss), rows, issues: [...issues.values()], expenseCategories: [...categories].map(([name, amount]) => ({ name, amount: money(amount) })), movements, validRange };
}

export interface PackStockValue {
  id: string; name: string; count: number; contains: number;
  costEach: number; retailEach: number; costValue: number; retailValue: number;
  /** False for a pack hidden from sale. Its stock is still on hand and still valued. */
  isActive: boolean;
}
export interface ItemStockValue {
  looseQty: number; packs: PackStockValue[]; packedBaseQty: number; totalBaseQty: number;
  costRate: number; looseCostValue: number; looseRetailValue: number;
  costValue: number; retailValue: number; costMissing: boolean;
}
/**
 * One valuation rule for every screen, the same as `readStock` (docs/stock-model.md): loose stock
 * plus every ready-made pack pile at cost, hidden packs included (they are physical stock).
 * Multi-unit sizes (dozen, tray) are drawn from loose stock, so their stored counts are ignored.
 * Negative quantities stay visible but are valued at zero.
 */
export function itemStockValue(
  item: ProfitRecord,
  looseQty: number = n(item.stock),
  variantStocks: Record<string, unknown> = item.variant_stocks || {}
): ItemStockValue {
  const costRate = n(item.cost_price);
  const sellRate = n(item.selling_price);
  const loose = qty(n(looseQty));
  const packs: PackStockValue[] = records(item.variants)
    .filter(v => v && v.id && v.deduct_from_base !== true)
    .map(v => {
      const count = qty(n(variantStocks?.[v.id]));
      const contains = sellUnitContains(v);
      const costEach = costRate * contains;
      const retailEach = n(v.selling_price) > 0 ? n(v.selling_price) : sellRate * contains;
      const valued = Math.max(0, count);
      return { id: v.id, name: v.name || 'Pack', count, contains, costEach, retailEach, costValue: valued * costEach, retailValue: valued * retailEach, isActive: v.isActive !== false };
    });
  const packedBaseQty = qty(packs.reduce((sum, p) => sum + p.count * p.contains, 0));
  const looseCostValue = Math.max(0, loose) * costRate;
  const looseRetailValue = Math.max(0, loose) * sellRate;
  const costValue = money(looseCostValue + packs.reduce((sum, p) => sum + p.costValue, 0));
  const retailValue = money(looseRetailValue + packs.reduce((sum, p) => sum + p.retailValue, 0));
  const hasStock = loose > EPS || packs.some(p => p.count > EPS);
  return {
    looseQty: loose, packs, packedBaseQty, totalBaseQty: qty(loose + packedBaseQty),
    costRate, looseCostValue: money(looseCostValue), looseRetailValue: money(looseRetailValue),
    costValue, retailValue, costMissing: costRate <= 0 && hasStock
  };
}

/** Returned lines live in details on stored bills; the context may also lift them to the top level. */
function saleReturnedItems(sale: ProfitRecord): ProfitRecord[] {
  return records(sale?.returned_items).length ? records(sale.returned_items) : records(sale?.details?.returned_items);
}
const lineVariantKey = (line: ProfitRecord) => {
  const id = line?.variantId || line?.variant_id;
  return !id || id === 'loose' || id === 'base' || line?.isLoose ? '' : String(id);
};
/** Quantity (in the line's own sold unit) refunded against one bill line. Replacements are not sales reversals. */
export function returnedQtyForLine(sale: ProfitRecord, line: ProfitRecord, lineIndex?: number): number {
  const itemId = line?.itemId || line?.item_id;
  const sameItem = (row: ProfitRecord) => itemId ? (row.itemId || row.item_id) === itemId : row.name === line?.name;
  const variant = lineVariantKey(line);
  const lines = records(sale?.items);
  // Old return entries saved no variant; they can only be matched when the bill has one line of that item.
  const onlyLine = lines.filter(sameItem).length <= 1;
  const returns = saleReturnedItems(sale)
    .filter(r => r.action !== 'replace' && sameItem(r))
    .filter(r => lineVariantKey(r) === variant || (onlyLine && r.variantId === undefined && r.variant_id === undefined));
  const index = lineIndex ?? lines.indexOf(line);
  if (index < 0) return returns.reduce((sum, r) => sum + n(r.qty), 0);
  // Returns that name their bill line belong to it; the rest fill same-item lines in bill order,
  // so two lines of the same product never both lose the same returned quantity.
  // Same rule as the Sales History return screen: only a whole-number index of an existing line
  // counts as named (a null index used to land on line 0 and vanish when line 0 was another item).
  const namedLine = (r: ProfitRecord) => Number.isInteger(r.lineIndex) && r.lineIndex >= 0 && r.lineIndex < lines.length;
  const indexed = (i: number) => returns.filter(r => namedLine(r) && r.lineIndex === i).reduce((sum, r) => sum + n(r.qty), 0);
  let pool = returns.filter(r => !namedLine(r)).reduce((sum, r) => sum + n(r.qty), 0);
  for (let i = 0; i < lines.length; i++) {
    const other = lines[i];
    if (!sameItem(other) || lineVariantKey(other) !== variant) continue;
    const own = indexed(i);
    const take = Math.min(Math.max(0, n(other.qty) - own), pool);
    if (i === index) return own + take;
    pool -= take;
  }
  return indexed(index);
}
