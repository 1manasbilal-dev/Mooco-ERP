import type { ReportData, ReportDefinition, ReportRow, Tone } from '../types';
import {
  COLOR, dayOf, daysBetween, findItem, groupSum, inRange, itemCategory, lower, n, offsetDate, pct, r2, r3,
  reportSales, saleLines, sum, topSlices
} from '../helpers';
import { itemStockValue } from '../../stockProfit';
import { AdjustmentReason } from '../../../types';
import type { InventoryLog, ItemDefinition } from '../../../types';

/* ------------------------------------------------------------- local helpers */

const isActiveItem = (item: ItemDefinition) => item.isActive !== false;

/** Loose stock: the live `stock` on the item, else the inventory row for it. */
function looseOf(item: ItemDefinition, data: ReportData): number {
  const own = (item as any).stock;
  if (own !== undefined && own !== null && own !== '') return n(own);
  const inv = data.inventory.find(i => i.item_id === item.id || i.id === item.id);
  return n(inv?.quantity);
}

function variantStocksOf(item: ItemDefinition, data: ReportData): Record<string, number> {
  if (item.variant_stocks && Object.keys(item.variant_stocks).length) return item.variant_stocks;
  const inv = data.inventory.find(i => i.item_id === item.id || i.id === item.id);
  return inv?.variant_stocks || item.variant_stocks || {};
}

const stockOf = (item: ItemDefinition, data: ReportData) =>
  itemStockValue(item as any, looseOf(item, data), variantStocksOf(item, data));

const matchesCategory = (item: ItemDefinition, category?: string) => {
  if (!category) return true;
  const cats = Array.isArray(item.category) ? item.category : item.category ? [String(item.category)] : [];
  return cats.includes(category) || itemCategory(item) === category;
};

const isSaleProduct = (item: ItemDefinition) => !Array.isArray(item.item_type) || !item.item_type.length || item.item_type.includes('Sale product');

const typeText = (item: ItemDefinition) => (Array.isArray(item.item_type) ? item.item_type.join(', ') : String(item.item_type || '')) || '—';

/** Base units moved by one log line: loose difference plus any pack deltas at their pack size. */
function logBaseDelta(log: InventoryLog, item?: ItemDefinition): number {
  const raw = log as any;
  const details = raw.details || {};
  const contains = (id?: string) => {
    const v = (item?.variants || []).find(x => x.id === id);
    return v && n(v.quantity_in_base_unit) > 0 ? n(v.quantity_in_base_unit) : 1;
  };
  let delta = n(log.difference);
  const variantId = details.variant_id ?? raw.variant_id;
  const variantDelta = n(details.variant_delta ?? raw.variant_delta);
  if (variantId && variantDelta) delta += variantDelta * contains(variantId);
  const deltas = details.variant_deltas ?? raw.variant_deltas;
  if (deltas && typeof deltas === 'object') {
    Object.entries(deltas as Record<string, unknown>).forEach(([id, count]) => { delta += n(count) * contains(id); });
  }
  return r3(delta);
}

/** Log reasons written by purchases, production and milk allocation. They are stock flows, not adjustments. */
const FLOW_REASONS = ['allocation', 'production', 'production usage', 'purchase'];
const isFlowReason = (reason?: string) => FLOW_REASONS.includes(lower(reason));
/** Reasons that move stock without being a loss to the business. */
const NOT_LOSS = [lower(AdjustmentReason.SUPPLY_RETURN), lower(AdjustmentReason.PRODUCTION_CANCEL)];

const REASON_TONES: Record<string, Tone> = {
  [AdjustmentReason.SPOILAGE]: 'bad',
  [AdjustmentReason.THEFT_LOSS]: 'bad',
  [AdjustmentReason.INTERNAL_USE]: 'warn',
  [AdjustmentReason.STOCK_COUNT]: 'info',
  [AdjustmentReason.DATA_ENTRY_ERROR]: 'neutral',
  [AdjustmentReason.SUPPLY_RETURN]: 'info',
  [AdjustmentReason.SALES_RETURN]: 'info',
  [AdjustmentReason.PRODUCTION_CANCEL]: 'neutral',
  [AdjustmentReason.PRODUCTION_USAGE]: 'neutral',
};

const isVoidPurchase = (status?: string) => /void|cancel|delete/i.test(String(status || '')) || (/returned/i.test(String(status || '')) && !/partial/i.test(String(status || '')));

/** Base units received on a material purchase line (after partial returns). */
function purchaseBaseQty(row: any): number {
  const base = row?.base_quantity ?? row?.details?.base_quantity;
  if (base !== undefined && base !== null && base !== '') return n(base);
  const factor = n(row?.conversion_factor ?? row?.details?.conversion_factor) || 1;
  return n(row?.quantity) * factor;
}

/** Actual output of a batch in base units: actual quantity, else loose + packed breakdown. */
function batchOutput(batch: any): number {
  if (n(batch?.quantity_output_actual) > 0) return n(batch.quantity_output_actual);
  const b = batch?.output_breakdown || batch?.details?.output_breakdown;
  if (!b) return 0;
  const packed = (Array.isArray(b.variants) ? b.variants : []).reduce((s: number, v: any) => s + (n(v.total_base_qty) || n(v.count) * n(v.base_qty_each)), 0);
  return n(b.loose_qty) + packed;
}

/** Base units sold per item over a range. */
function soldByItem(data: ReportData, from: string, to: string) {
  const map = new Map<string, { qty: number; last: string }>();
  reportSales(data, { from, to }).forEach(sale => saleLines(sale, data.items).forEach(line => {
    const row = map.get(line.itemId) || { qty: 0, last: '' };
    row.qty += line.baseQty;
    const d = dayOf(sale.date);
    if (line.baseQty > 0 && d > row.last) row.last = d;
    map.set(line.itemId, row);
  }));
  return map;
}

const fmtQty = (value: number) => String(r3(value));

/* ---------------------------------------------------------------- reports */

export const inventoryReports: ReportDefinition[] = [
  {
    id: 'stock_valuation',
    title: 'Stock Valuation',
    subtitle: 'Stock on hand today at cost and retail, with potential profit',
    category: 'inventory',
    icon: 'Boxes',
    keywords: ['stock value', 'closing stock', 'inventory value', 'maal'],
    financial: true,
    snapshot: true,
    filters: ['category'],
    build: (data, f) => {
      let missingCost = 0;
      const rows: ReportRow[] = data.items.filter(isActiveItem).filter(item => matchesCategory(item, f.category)).map(item => {
        const sv = stockOf(item, data);
        if (sv.costMissing) missingCost++;
        const packs = sv.packs.filter(p => p.count !== 0).map(p => `${fmtQty(p.count)} × ${p.name}`).join(', ');
        const profit = r2(sv.retailValue - sv.costValue);
        const negative = sv.looseQty < 0 || sv.packs.some(p => p.count < 0);
        return {
          item: item.name, itemId: item.id, category: itemCategory(item), type: typeText(item), unit: item.unit || 'unit',
          loose: r3(sv.looseQty), packs: packs || '—', total: r3(sv.totalBaseQty), rate: r2(sv.costRate),
          cost: r2(sv.costValue), retail: r2(sv.retailValue), profit, margin: pct(profit, sv.retailValue),
          _tone: negative ? 'bad' : sv.costMissing ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: item.id }, label: 'Sales of this item' },
        };
      });
      const cost = sum(rows, r => n(r.cost));
      const retail = sum(rows, r => n(r.retail));
      const inStock = rows.filter(r => n(r.total) > 0).length;
      const negative = rows.filter(r => r._tone === 'bad').length;
      const pie = topSlices(groupSum(rows, r => String(r.category), r => n(r.cost)));
      const top = [...rows].sort((a, b) => n(b.cost) - n(a.cost)).slice(0, 10);
      return {
        kpis: [
          { key: 'cost', label: 'Stock at cost', value: cost, format: 'money', tone: 'info' },
          { key: 'retail', label: 'Stock at retail', value: retail, format: 'money' },
          { key: 'profit', label: 'Potential profit', value: r2(retail - cost), format: 'money', tone: retail - cost >= 0 ? 'good' : 'bad', hint: `${pct(retail - cost, retail)}% of retail` },
          { key: 'items', label: 'Items in stock', value: inStock, format: 'number' },
          { key: 'negative', label: 'Negative stock', value: negative, format: 'number', tone: negative ? 'bad' : 'good', inverse: true },
        ],
        charts: [
          { id: 'cats', title: 'Stock value by category', type: 'pie', data: pie, xKey: 'name', series: [{ key: 'value', label: 'At cost' }], format: 'money' },
          { id: 'top', title: 'Top 10 items by value', type: 'bar', xKey: 'name', format: 'money', data: top.map(r => ({ name: r.item, cost: r.cost, retail: r.retail })), series: [{ key: 'cost', label: 'At cost', color: COLOR.purchase }, { key: 'retail', label: 'At retail', color: COLOR.sales }] },
        ],
        tables: [{
          id: 'items', showTotals: true, sort: { key: 'cost', dir: 'desc' },
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Category' },
            { key: 'type', label: 'Type', hidden: true },
            { key: 'unit', label: 'Unit' },
            { key: 'loose', label: 'Loose', format: 'qty', signed: true },
            { key: 'packs', label: 'Packs', wrap: true },
            { key: 'total', label: 'Total (base)', format: 'qty' },
            { key: 'rate', label: 'Cost rate', format: 'money' },
            { key: 'cost', label: 'Value at cost', format: 'money', total: true },
            { key: 'retail', label: 'Value at retail', format: 'money', total: true },
            { key: 'profit', label: 'Potential profit', format: 'money', total: true, signed: true },
            { key: 'margin', label: 'Margin', format: 'percent' },
          ],
          rows,
          emptyText: 'No active items.',
        }],
        notes: [
          missingCost ? { tone: 'warn' as const, text: `${missingCost} item(s) have stock but no cost price, so they add nothing to stock value. Set cost prices in Product Catalog.` } : null,
          negative ? { tone: 'bad' as const, text: `${negative} item(s) show negative stock. Negative stock is valued at zero. Fix it with a stock count.` } : null,
        ].filter((x): x is { tone: 'warn' | 'bad'; text: string } => Boolean(x)),
      };
    },
  },
  {
    id: 'low_stock',
    title: 'Low Stock & Reorder',
    subtitle: 'Items at or below reorder level, with days of cover and a suggested order',
    category: 'inventory',
    icon: 'PackageMinus',
    keywords: ['reorder', 'out of stock', 'shortage', 'kam stock'],
    snapshot: true,
    filters: ['category'],
    build: (data, f) => {
      const from = offsetDate(data.today, -29);
      const sold = soldByItem(data, from, data.today);
      const rows: ReportRow[] = [];
      data.items.filter(isActiveItem).filter(item => matchesCategory(item, f.category)).forEach(item => {
        const sv = stockOf(item, data);
        const stock = r3(sv.totalBaseQty);
        const reorder = n(item.reorder_level);
        const out = stock <= 0;
        const low = reorder > 0 && stock <= reorder;
        if (!low && !(out && isSaleProduct(item))) return;
        const avg = r3(n(sold.get(item.id)?.qty) / 30);
        const shortfall = r3(Math.max(0, reorder - stock));
        const cover = avg > 0 ? Math.round((Math.max(0, stock) / avg) * 10) / 10 : null;
        const suggested = r3(Math.max(shortfall, avg * 30 - stock, 0));
        const status = out ? 'Out' : stock <= reorder / 2 || (cover !== null && cover < 3) ? 'Critical' : 'Low';
        rows.push({
          item: item.name, category: itemCategory(item), unit: item.unit || 'unit', stock, reorder, shortfall, avg, cover: cover ?? 'No sales', suggested,
          cost: r2(suggested * n(item.cost_price)), status,
          _tone: status === 'Out' ? 'bad' : status === 'Critical' ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: item.id }, label: 'Sales of this item' },
        });
      });
      const rank: Record<string, number> = { Out: 0, Critical: 1, Low: 2 };
      rows.sort((a, b) => rank[String(a.status)] - rank[String(b.status)] || (typeof a.cover === 'number' ? a.cover : 9999) - (typeof b.cover === 'number' ? b.cover : 9999));
      const count = (s: string) => rows.filter(r => r.status === s).length;
      return {
        kpis: [
          { key: 'out', label: 'Out of stock', value: count('Out'), format: 'number', tone: count('Out') ? 'bad' : 'good', inverse: true },
          { key: 'critical', label: 'Critical', value: count('Critical'), format: 'number', tone: count('Critical') ? 'warn' : 'good', inverse: true },
          { key: 'low', label: 'Low', value: count('Low'), format: 'number', inverse: true },
          { key: 'cost', label: 'Suggested order value', value: sum(rows, r => n(r.cost)), format: 'money', hint: 'At current cost price' },
        ],
        charts: [{
          id: 'shortfall', title: 'Stock vs reorder level', type: 'bar', wide: true, xKey: 'name', format: 'qty',
          data: rows.slice(0, 15).map(r => ({ name: r.item, stock: Math.max(0, n(r.stock)), reorder: r.reorder, suggested: r.suggested })),
          series: [{ key: 'stock', label: 'In stock', color: COLOR.purchase }, { key: 'reorder', label: 'Reorder level', color: COLOR.credit }, { key: 'suggested', label: 'Suggested order', color: COLOR.sales }],
        }],
        tables: [{
          id: 'reorder', showTotals: true,
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Category', hidden: true },
            { key: 'stock', label: 'Stock', format: 'qty', signed: true },
            { key: 'unit', label: 'Unit' },
            { key: 'reorder', label: 'Reorder level', format: 'qty' },
            { key: 'shortfall', label: 'Shortfall', format: 'qty' },
            { key: 'avg', label: 'Avg daily sale', format: 'qty' },
            { key: 'cover', label: 'Days of cover', align: 'right' },
            { key: 'suggested', label: 'Suggested order', format: 'qty' },
            { key: 'cost', label: 'Order value', format: 'money', total: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Out: 'bad', Critical: 'warn', Low: 'info' } },
          ],
          rows,
          emptyText: 'Nothing is below its reorder level.',
        }],
        notes: [{ tone: 'info', text: 'Average daily sale uses the last 30 days. Suggested order covers 30 days of sales, and never less than the shortfall. Items with no reorder level only show here when they are out of stock.' }],
      };
    },
  },
  {
    id: 'stock_adjustments',
    title: 'Stock Adjustments & Wastage',
    subtitle: 'Spoilage, stock counts, internal use and other manual stock changes',
    category: 'inventory',
    icon: 'ClipboardList',
    keywords: ['wastage', 'spoilage', 'shrinkage', 'stock count', 'kharab'],
    financial: true,
    filters: ['itemId'],
    build: (data, f) => {
      const rows: ReportRow[] = [];
      data.inventoryLogs.forEach(log => {
        if (!inRange(log.date, f) || isFlowReason(log.reason)) return;
        if (f.itemId && log.item_id !== f.itemId) return;
        const item = findItem(data.items, log.item_id, log.item_name);
        const diff = logBaseDelta(log, item);
        const value = r2(diff * n(item?.cost_price));
        const isLoss = diff < 0 && !NOT_LOSS.includes(lower(log.reason));
        rows.push({
          date: log.date, item: item?.name || log.item_name || 'Item', unit: item?.unit || '', reason: log.reason || 'Not given',
          old: r3(n(log.old_quantity)), new: r3(n(log.new_quantity)), diff, value, loss: isLoss ? r2(-value) : 0, notes: log.notes || '',
          _tone: isLoss ? 'bad' : undefined,
        });
      });
      const loss = sum(rows, r => n(r.loss));
      const gain = sum(rows.filter(r => n(r.value) > 0), r => n(r.value));
      const spoilage = sum(rows.filter(r => lower(r.reason) === lower(AdjustmentReason.SPOILAGE)), r => n(r.loss));
      const byReason = topSlices(groupSum(rows.filter(r => n(r.loss) > 0), r => String(r.reason), r => n(r.loss)));
      const byItem = groupSum(rows.filter(r => n(r.loss) > 0), r => String(r.item), r => n(r.loss)).slice(0, 10);
      return {
        kpis: [
          { key: 'loss', label: 'Stock loss value', value: loss, format: 'money', tone: loss > 0 ? 'bad' : 'good', inverse: true },
          { key: 'spoilage', label: 'Spoilage / wastage', value: spoilage, format: 'money', inverse: true },
          { key: 'gain', label: 'Stock added back', value: gain, format: 'money' },
          { key: 'entries', label: 'Entries', value: rows.length, format: 'number' },
        ],
        charts: [
          { id: 'reasons', title: 'Loss by reason', type: 'pie', xKey: 'name', format: 'money', data: byReason, series: [{ key: 'value', label: 'Loss' }] },
          { id: 'items', title: 'Top items by loss', type: 'bar', xKey: 'name', format: 'money', data: byItem, series: [{ key: 'value', label: 'Loss', color: COLOR.expense }] },
        ],
        tables: [{
          id: 'logs', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Date / time', format: 'datetime' },
            { key: 'item', label: 'Item' },
            { key: 'reason', label: 'Reason', format: 'badge', tones: REASON_TONES },
            { key: 'old', label: 'Old qty', format: 'qty' },
            { key: 'new', label: 'New qty', format: 'qty' },
            { key: 'diff', label: 'Change (base)', format: 'qty', signed: true },
            { key: 'unit', label: 'Unit', hidden: true },
            { key: 'value', label: 'Value at cost', format: 'money', total: true, signed: true },
            { key: 'loss', label: 'Loss', format: 'money', total: true, hidden: true },
            { key: 'notes', label: 'Notes', wrap: true },
          ],
          rows,
          emptyText: 'No stock adjustments in this period.',
        }],
        notes: [{ tone: 'info', text: 'Purchases, production and milk allocation entries are left out (see Item Movement Summary). Value uses today\'s cost price. Supplier returns are not counted as loss.' }],
      };
    },
  },
  {
    id: 'slow_moving',
    title: 'Slow & Dead Stock',
    subtitle: 'Stock that is not selling: value tied up and days since the last sale',
    category: 'inventory',
    icon: 'Hourglass',
    keywords: ['dead stock', 'non moving', 'slow moving', 'aging'],
    financial: true,
    defaultPreset: 'last_30',
    filters: ['category'],
    build: (data, f) => {
      const inRangeSold = soldByItem(data, f.from, f.to);
      const allSold = soldByItem(data, '', f.to);
      const days = daysBetween(f.from, f.to);
      const rows: ReportRow[] = [];
      data.items.filter(isActiveItem).filter(item => matchesCategory(item, f.category)).forEach(item => {
        if (Array.isArray(item.item_type) && item.item_type.length && !item.item_type.includes('Sale product')) return;
        const sv = stockOf(item, data);
        if (sv.totalBaseQty <= 0) return;
        const sold = r3(n(inRangeSold.get(item.id)?.qty));
        const last = allSold.get(item.id)?.last || '';
        const status = sold <= 0 ? 'Dead' : sold < sv.totalBaseQty * 0.2 ? 'Slow' : 'Moving';
        const avg = sold / days;
        rows.push({
          item: item.name, category: itemCategory(item), unit: item.unit || 'unit', stock: r3(sv.totalBaseQty), sold,
          last: last || null, since: last ? daysBetween(last, data.today) - 1 : 'Never',
          cover: avg > 0 ? Math.round(sv.totalBaseQty / avg) : 'No sales', value: r2(sv.costValue), status,
          _tone: status === 'Dead' ? 'bad' : status === 'Slow' ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: item.id }, label: 'Sales of this item' },
        });
      });
      const rank: Record<string, number> = { Dead: 0, Slow: 1, Moving: 2 };
      rows.sort((a, b) => rank[String(a.status)] - rank[String(b.status)] || n(b.value) - n(a.value));
      const dead = rows.filter(r => r.status === 'Dead');
      const slow = rows.filter(r => r.status === 'Slow');
      const total = sum(rows, r => n(r.value));
      return {
        kpis: [
          { key: 'dead', label: 'Dead stock value', value: sum(dead, r => n(r.value)), format: 'money', tone: dead.length ? 'bad' : 'good', hint: `${dead.length} item(s)`, inverse: true },
          { key: 'slow', label: 'Slow stock value', value: sum(slow, r => n(r.value)), format: 'money', tone: slow.length ? 'warn' : 'good', hint: `${slow.length} item(s)`, inverse: true },
          { key: 'share', label: 'Of stock value', value: pct(sum([...dead, ...slow], r => n(r.value)), total), format: 'percent', inverse: true },
          { key: 'items', label: 'Items in stock', value: rows.length, format: 'number' },
        ],
        charts: [{
          id: 'status', title: 'Stock value by status', type: 'pie', xKey: 'name', format: 'money',
          data: groupSum(rows, r => String(r.status), r => n(r.value)).filter(x => x.value > 0),
          series: [{ key: 'value', label: 'At cost' }],
        }],
        tables: [{
          id: 'items', showTotals: true,
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Category', hidden: true },
            { key: 'stock', label: 'Stock', format: 'qty' },
            { key: 'unit', label: 'Unit' },
            { key: 'sold', label: 'Sold in period', format: 'qty' },
            { key: 'last', label: 'Last sale', format: 'date' },
            { key: 'since', label: 'Days since sale', align: 'right' },
            { key: 'cover', label: 'Days of stock', align: 'right', hidden: true },
            { key: 'value', label: 'Value at cost', format: 'money', total: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Dead: 'bad', Slow: 'warn', Moving: 'good' } },
          ],
          rows,
          emptyText: 'No sale products in stock.',
        }],
        notes: [{ tone: 'info', text: 'Dead: no sale in the period. Slow: sold less than 20% of the stock now on hand. Raw and packaging materials are left out.' }],
      };
    },
  },
  {
    id: 'item_movement',
    title: 'Item Movement Summary',
    subtitle: 'Stock in and out per item: purchases, production, sales and adjustments',
    category: 'inventory',
    icon: 'ArrowLeftRight',
    keywords: ['stock movement', 'stock ledger', 'in out', 'aamad kharch'],
    filters: ['itemId', 'category'],
    build: (data, f) => {
      type Move = { purchased: number; produced: number; allocated: number; sold: number; used: number; adjusted: number };
      const map = new Map<string, Move>();
      const get = (id: string) => {
        let row = map.get(id);
        if (!row) { row = { purchased: 0, produced: 0, allocated: 0, sold: 0, used: 0, adjusted: 0 }; map.set(id, row); }
        return row;
      };
      const wanted = (item?: ItemDefinition) => Boolean(item) && (!f.itemId || item!.id === f.itemId) && matchesCategory(item!, f.category);

      data.materialPurchases.forEach(p => {
        if (!inRange(p.date, f) || isVoidPurchase(p.status)) return;
        const item = findItem(data.items, p.item_id, p.item_name);
        if (!wanted(item)) return;
        get(item!.id).purchased += purchaseBaseQty(p);
      });
      data.productionBatches.forEach(b => {
        if (lower(b.status) !== 'completed') return;
        if (!inRange(b.completed_date || b.start_date, f)) return;
        const item = findItem(data.items, (b as any).product_id || b.details?.product_id, b.product_name);
        if (!wanted(item)) return;
        get(item!.id).produced += batchOutput(b);
      });
      reportSales(data, f).forEach(sale => saleLines(sale, data.items).forEach(line => {
        const item = findItem(data.items, line.itemId, line.name);
        if (!wanted(item)) return;
        get(item!.id).sold += line.baseQty;
      }));
      data.inventoryLogs.forEach(log => {
        if (!inRange(log.date, f)) return;
        const item = findItem(data.items, log.item_id, log.item_name);
        if (!wanted(item)) return;
        const reason = lower(log.reason);
        if (reason === 'purchase' || reason === 'production') return; // already counted from purchases and batches
        const delta = logBaseDelta(log, item);
        const row = get(item!.id);
        if (reason === 'allocation') row.allocated += delta;
        else if (reason === lower(AdjustmentReason.PRODUCTION_USAGE)) row.used += delta;
        else row.adjusted += delta;
      });

      const rows: ReportRow[] = [...map.entries()].map(([id, m]): ReportRow => {
        const item = findItem(data.items, id)!;
        const net = m.purchased + m.produced + m.allocated - m.sold + m.used + m.adjusted;
        return {
          item: item.name, category: itemCategory(item), unit: item.unit || 'unit',
          purchased: r3(m.purchased), produced: r3(m.produced), allocated: r3(m.allocated), sold: r3(m.sold),
          used: r3(m.used), adjusted: r3(m.adjusted), net: r3(net), stock: r3(stockOf(item, data).totalBaseQty),
          _tone: net < 0 ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: id }, label: 'Sales of this item' },
        };
      }).filter(r => ['purchased', 'produced', 'allocated', 'sold', 'used', 'adjusted'].some(k => n(r[k]) !== 0));
      const top = [...rows].sort((a, b) => (n(b.purchased) + n(b.produced) + n(b.sold)) - (n(a.purchased) + n(a.produced) + n(a.sold))).slice(0, 12);
      return {
        kpis: [
          { key: 'items', label: 'Items moved', value: rows.length, format: 'number' },
          { key: 'purchases', label: 'Purchase lines', value: data.materialPurchases.filter(p => inRange(p.date, f) && !isVoidPurchase(p.status)).length, format: 'number' },
          { key: 'batches', label: 'Batches completed', value: data.productionBatches.filter(b => lower(b.status) === 'completed' && inRange(b.completed_date || b.start_date, f)).length, format: 'number' },
          { key: 'adjusted', label: 'Items adjusted', value: rows.filter(r => n(r.adjusted) !== 0).length, format: 'number' },
        ],
        charts: [{
          id: 'flow', title: 'In vs out (base units)', type: 'bar', wide: true, xKey: 'name', format: 'qty',
          data: top.map(r => ({ name: r.item, in: r3(n(r.purchased) + n(r.produced) + Math.max(0, n(r.allocated))), out: r3(n(r.sold) - Math.min(0, n(r.used))) })),
          series: [{ key: 'in', label: 'In', color: COLOR.purchase }, { key: 'out', label: 'Out', color: COLOR.sales }],
        }],
        tables: [{
          id: 'items', showTotals: false, sort: { key: 'sold', dir: 'desc' },
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Category', hidden: true },
            { key: 'unit', label: 'Unit' },
            { key: 'purchased', label: 'Purchased', format: 'qty' },
            { key: 'produced', label: 'Produced', format: 'qty' },
            { key: 'allocated', label: 'Milk allocated', format: 'qty', signed: true, hidden: true },
            { key: 'sold', label: 'Sold', format: 'qty' },
            { key: 'used', label: 'Used in production', format: 'qty', signed: true },
            { key: 'adjusted', label: 'Adjustments', format: 'qty', signed: true },
            { key: 'net', label: 'Net movement', format: 'qty', signed: true },
            { key: 'stock', label: 'Stock now', format: 'qty' },
          ],
          rows,
          emptyText: 'No stock movement in this period.',
        }],
        notes: [{ tone: 'info', text: 'This is a movement summary, not an audited stock ledger. Quantities are in each item\'s base unit. Opening stock is not shown, so net movement need not match stock now.' }],
      };
    },
  },
];
