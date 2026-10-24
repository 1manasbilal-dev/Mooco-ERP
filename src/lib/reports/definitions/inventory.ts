import type { ReportData, ReportDefinition, ReportRow, Tone } from '../types';
import {
  COLOR, dayOf, daysBetween, describeLogMoves, findItem, groupSum, inRange, isPurchaseVoid, itemCategory, itemStock, logMoves, lower, n,
  offsetDate, packLabel, pct, r2, r3, reportSales, saleLines, sum, topSlices
} from '../helpers';
import { sellUnitContains } from '../../sellUnits';
import { formatBaseQty, pileBreakdown, type StockReading } from '../../stockRules';
import { AdjustmentReason } from '../../../types';
import type { InventoryLog, ItemDefinition } from '../../../types';

const isActiveItem = (item: ItemDefinition) => item.isActive !== false;

/** Stock from the live inventory row (shared with the Balance Sheet, so both value stock the same way). */
const stockOf = (item: ItemDefinition, data: ReportData) => itemStock(data, item);

/** "4 kg loose · 6 × 500 g tub · 2 × 1 kg tub (hidden)": every pile, never different pack sizes added together. */
const pilesText = (reading: StockReading) => pileBreakdown(reading).join(' · ') || '—';

/** A loose or pack pile still holds a count (hidden packs and old counts included). */
const holdsStock = (reading: StockReading) =>
  reading.strayCounts.length > 0 || reading.piles.some(p => (p.kind === 'loose' || p.kind === 'packed') && Math.abs(p.count) > 0.0005);

const matchesCategory = (item: ItemDefinition, category?: string) => {
  if (!category) return true;
  const cats = Array.isArray(item.category) ? item.category : item.category ? [String(item.category)] : [];
  return cats.includes(category) || itemCategory(item) === category;
};

const isSaleProduct = (item: ItemDefinition) => !Array.isArray(item.item_type) || !item.item_type.length || item.item_type.includes('Sale product');

const typeText = (item: ItemDefinition) => (Array.isArray(item.item_type) ? item.item_type.join(', ') : String(item.item_type || '')) || '—';

/** Log reasons written by purchases, production, milk allocation, bill checkout and opening stock. They are stock flows, not adjustments. */
const SALE_REASONS = ['sale', 'pos sale'];
const OPENING_REASON = lower(AdjustmentReason.OPENING_STOCK);
const FLOW_REASONS = ['allocation', 'production', 'production usage', 'purchase', OPENING_REASON, ...SALE_REASONS];
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

const isVoidPurchase = isPurchaseVoid;

/** Pack size of a log's ready-made pack, or 1 for loose stock (multi-unit returns are saved in base units). */
const logPackSize = (log: InventoryLog, item?: ItemDefinition) => {
  const packId = log.details?.variant_id ?? (log as any).variant_id;
  const pack = packId ? (item?.variants || []).find(v => v.id === packId && v.deduct_from_base !== true) : undefined;
  return pack ? sellUnitContains(pack) : 1;
};

/** Base units of a customer return that was scrapped: it left stock at the sale and never came back. */
const scrappedBaseQty = (log: InventoryLog, item?: ItemDefinition) => {
  const scrapped = n((log as any).details?.scrapped_qty ?? (log as any).scrapped_qty);
  return scrapped > 0 ? r3(scrapped * logPackSize(log, item)) : 0;
};

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
    // Inactive items that still hold stock are included: the stock is still an asset, and the Balance
    // Sheet counts it. Without them the two "Stock at cost" figures disagreed.
    build: (data, f) => {
      let missingCost = 0;
      let inactiveHeld = 0;
      let hiddenHeld = 0;
      let strayHeld = 0;
      let unpriced = 0;
      const valued = data.items.filter(item => matchesCategory(item, f.category))
        .map(item => ({ item, sv: stockOf(item, data) }))
        .filter(({ item, sv }) => {
          if (isActiveItem(item)) return true;
          const holds = holdsStock(sv.reading);
          if (holds) inactiveHeld++;
          return holds;
        });
      const rows: ReportRow[] = valued.map(({ item, sv }) => {
        const { reading } = sv;
        if (sv.costMissing) missingCost++;
        if (reading.hiddenPacks.length) hiddenHeld++;
        if (reading.strayCounts.length) strayHeld++;
        // Raw and packaging materials usually have no selling price: no retail value, not a loss of their whole cost.
        const noPrice = sv.retailValue <= 0 && sv.costValue > 0;
        if (noPrice) unpriced++;
        const profit = noPrice ? null : r2(sv.retailValue - sv.costValue);
        const negative = reading.status === 'minus';
        const loose = reading.piles.find(p => p.kind === 'loose')?.count || 0;
        return {
          item: isActiveItem(item) ? item.name : `${item.name} (inactive)`, itemId: item.id, category: itemCategory(item), type: typeText(item), unit: reading.unit,
          loose: r3(loose), piles: pilesText(reading), total: r3(reading.totalBase), sellable: r3(reading.sellableBase), rate: r2(sv.costRate),
          cost: r2(sv.costValue), retail: noPrice ? null : r2(sv.retailValue), profit, margin: profit === null ? null : pct(profit, sv.retailValue),
          _tone: negative ? 'bad' : sv.costMissing || reading.strayCounts.length ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: item.id }, label: 'Sales of this item' },
        };
      });
      const cost = sum(rows, r => n(r.cost));
      const retail = sum(rows, r => n(r.retail));
      const potential = sum(rows, r => n(r.profit));
      const inStock = rows.filter(r => n(r.total) > 0).length;
      const negative = rows.filter(r => r._tone === 'bad').length;
      const pie = topSlices(groupSum(rows, r => String(r.category), r => n(r.cost)));
      const top = [...rows].sort((a, b) => n(b.cost) - n(a.cost)).slice(0, 10);
      return {
        kpis: [
          { key: 'cost', label: 'Stock at cost', value: cost, format: 'money', tone: 'info' },
          { key: 'retail', label: 'Stock at retail', value: retail, format: 'money', hint: unpriced ? 'Items with a selling price' : undefined },
          { key: 'profit', label: 'Potential profit', value: potential, format: 'money', tone: potential >= 0 ? 'good' : 'bad', hint: `${pct(potential, retail)}% of retail` },
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
            { key: 'loose', label: 'Loose', format: 'qty', signed: true, hidden: true },
            { key: 'piles', label: 'Stock by pile', wrap: true },
            { key: 'total', label: 'Total (base)', format: 'qty', signed: true },
            { key: 'sellable', label: 'Sellable now', format: 'qty', hidden: true },
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
          hiddenHeld ? { tone: 'info' as const, text: `${hiddenHeld} item(s) have hidden packs that still hold stock. They are counted and valued, but the POS can't sell them: count them to 0 or show the pack again.` } : null,
          strayHeld ? { tone: 'warn' as const, text: `${strayHeld} item(s) have an old count on a dozen/tray-type unit or a deleted pack. It is not stock and is not valued: clear it with a stock count.` } : null,
          inactiveHeld ? { tone: 'info' as const, text: `${inactiveHeld} inactive item(s) still hold stock and are included.` } : null,
          unpriced ? { tone: 'info' as const, text: `${unpriced} item(s) have no selling price (raw or packaging material), so they count at cost only and add nothing to retail value or potential profit.` } : null,
        ].filter((x): x is { tone: 'warn' | 'bad' | 'info'; text: string } => Boolean(x)),
      };
    },
  },
  {
    id: 'low_stock',
    title: 'Low Stock & Reorder',
    subtitle: 'Products low, out of stock or in minus, with days of cover and a suggested order',
    category: 'inventory',
    icon: 'PackageMinus',
    keywords: ['reorder', 'out of stock', 'shortage', 'kam stock'],
    snapshot: true,
    filters: ['category'],
    // Same rule as the dashboard card and Inventory: readStock(...).status, active products only.
    build: (data, f) => {
      const from = offsetDate(data.today, -29);
      const sold = soldByItem(data, from, data.today);
      const rows: ReportRow[] = [];
      data.items.filter(isActiveItem).filter(item => matchesCategory(item, f.category)).forEach(item => {
        const { reading } = stockOf(item, data);
        if (reading.status === 'ok') return;
        const stock = r3(reading.totalBase);
        const onHand = Math.max(0, stock);
        const sellable = r3(Math.max(0, reading.sellableBase));
        const reorder = reading.reorderLevel;
        const avg = r3(n(sold.get(item.id)?.qty) / 30);
        const shortfall = r3(Math.max(0, reorder - onHand));
        const cover = avg > 0 ? Math.round((sellable / avg) * 10) / 10 : null;
        const suggested = r3(Math.max(shortfall, avg * 30 - onHand, 0));
        const status = reading.status === 'minus' ? 'Minus'
          : reading.status === 'out' ? 'Out'
            : stock <= reorder / 2 || (cover !== null && cover < 3) ? 'Critical' : 'Low';
        const why = reading.status === 'minus' ? 'A pile is below zero: fix it with a stock count'
          : reading.status === 'out' ? (stock > 0 ? `None of it can be sold now: ${pilesText(reading)}` : 'Nothing on hand')
            : `At or below reorder level (${formatBaseQty(reorder, reading.unit)})`;
        rows.push({
          item: item.name, category: itemCategory(item), unit: reading.unit, stock, sellable, piles: pilesText(reading), reorder, shortfall, avg,
          cover: cover ?? 'No sales', suggested, cost: r2(suggested * n(item.cost_price)), status, why,
          _tone: status === 'Out' || status === 'Minus' ? 'bad' : status === 'Critical' ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: item.id }, label: 'Sales of this item' },
        });
      });
      const rank: Record<string, number> = { Minus: 0, Out: 1, Critical: 2, Low: 3 };
      rows.sort((a, b) => rank[String(a.status)] - rank[String(b.status)] || (typeof a.cover === 'number' ? a.cover : 9999) - (typeof b.cover === 'number' ? b.cover : 9999));
      const count = (s: string) => rows.filter(r => r.status === s).length;
      return {
        kpis: [
          { key: 'minus', label: 'Minus stock', value: count('Minus'), format: 'number', tone: count('Minus') ? 'bad' : 'good', inverse: true },
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
            { key: 'sellable', label: 'Sellable now', format: 'qty', hidden: true },
            { key: 'piles', label: 'Stock by pile', wrap: true, hidden: true },
            { key: 'reorder', label: 'Reorder level', format: 'qty' },
            { key: 'shortfall', label: 'Shortfall', format: 'qty' },
            { key: 'avg', label: 'Avg daily sale', format: 'qty' },
            { key: 'cover', label: 'Days of cover', align: 'right' },
            { key: 'suggested', label: 'Suggested order', format: 'qty' },
            { key: 'cost', label: 'Order value', format: 'money', total: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Minus: 'bad', Out: 'bad', Critical: 'warn', Low: 'info' } },
            { key: 'why', label: 'Why', wrap: true },
          ],
          rows,
          emptyText: 'No product is low, out or in minus.',
        }],
        notes: [{ tone: 'info', text: 'Same rule as the dashboard and Inventory. Minus: a loose or pack pile is below zero. Out: nothing on hand, or for sale products nothing the POS can sell (hidden packs and loose stock with loose sale off can\'t be sold). Low: total stock, packs included, at or below the reorder level; reorder level 0 means no low alert. Inactive products are left out. Average daily sale uses the last 30 days; days of cover use sellable stock; the suggested order covers 30 days of sales and never less than the shortfall.' }],
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
      let unknownPacks = 0;
      data.inventoryLogs.forEach(log => {
        if (!inRange(log.date, f) || isFlowReason(log.reason)) return;
        if (f.itemId && log.item_id !== f.itemId) return;
        const item = findItem(data.items, log.item_id, log.item_name);
        const moves = logMoves(log, item);
        if (moves.unknownPackDelta) unknownPacks++;
        const diff = moves.baseDelta;
        const value = r2(diff * n(item?.cost_price));
        // A scrapped customer return changes no stock today (it left at the sale), but the goods are lost.
        const scrapped = scrappedBaseQty(log, item);
        const scrappedLoss = r2(scrapped * n(item?.cost_price));
        const lostStock = diff < 0 && !NOT_LOSS.includes(lower(log.reason));
        const stockLoss = lostStock ? -value : 0;
        const isLoss = lostStock || scrapped > 0;
        rows.push({
          date: log.date, item: item?.name || log.item_name || 'Item', unit: item?.unit || '', reason: log.reason || 'Not given',
          change: describeLogMoves(moves, item),
          // Pack rows saved pack counts (or nothing useful) in these columns, so they only show for loose-only rows.
          old: moves.looseColumns ? r3(n(log.old_quantity)) : null, new: moves.looseColumns ? r3(n(log.new_quantity)) : null,
          diff, value, loss: isLoss ? r2(stockLoss + scrappedLoss) : 0, notes: log.notes || '',
          _tone: isLoss ? 'bad' : moves.unknownPackDelta ? 'warn' : undefined,
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
            { key: 'change', label: 'Change by pile', wrap: true },
            { key: 'old', label: 'Loose before', format: 'qty', hidden: true },
            { key: 'new', label: 'Loose after', format: 'qty', hidden: true },
            { key: 'diff', label: 'Change (base)', format: 'qty', signed: true },
            { key: 'unit', label: 'Unit' },
            { key: 'value', label: 'Value at cost', format: 'money', total: true, signed: true },
            { key: 'loss', label: 'Loss', format: 'money', total: true, hidden: true },
            { key: 'notes', label: 'Notes', wrap: true },
          ],
          rows,
          emptyText: 'No stock adjustments in this period.',
        }],
        notes: [
          { tone: 'info' as const, text: 'Sales, purchases, production, milk allocation and opening stock entries are left out (see Item Movement Summary). Change (base) adds loose stock and each pack × its size. Value uses today\'s cost price. Supplier returns are not counted as loss. Scrapped customer returns count as loss at cost, though they do not change stock.' },
          ...(unknownPacks ? [{ tone: 'warn' as const, text: `${unknownPacks} old pack count change(s) did not save which pack was counted, so they add nothing to Change (base) or value.` }] : []),
        ],
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
        if (!isSaleProduct(item)) return;
        const sv = stockOf(item, data);
        const stock = r3(sv.reading.totalBase);
        if (stock <= 0) return;
        const sold = r3(n(inRangeSold.get(item.id)?.qty));
        const last = allSold.get(item.id)?.last || '';
        const status = sold <= 0 ? 'Dead' : sold < stock * 0.2 ? 'Slow' : 'Moving';
        const avg = sold / days;
        rows.push({
          item: item.name, category: itemCategory(item), unit: sv.reading.unit, stock, piles: pilesText(sv.reading), sold,
          last: last || null, since: last ? daysBetween(last, data.today) - 1 : 'Never',
          cover: avg > 0 ? Math.round(stock / avg) : 'No sales', value: r2(sv.costValue), status,
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
            { key: 'piles', label: 'Stock by pile', wrap: true, hidden: true },
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
        notes: [{ tone: 'info', text: 'Dead: no sale in the period. Slow: sold less than 20% of the stock now on hand. Stock is loose plus every pack × its size (hidden packs too), valued like Stock Valuation. Raw and packaging materials are left out.' }],
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
      type Move = { opening: number; purchased: number; produced: number; allocated: number; sold: number; used: number; adjusted: number };
      const map = new Map<string, Move>();
      const get = (id: string) => {
        let row = map.get(id);
        if (!row) { row = { opening: 0, purchased: 0, produced: 0, allocated: 0, sold: 0, used: 0, adjusted: 0 }; map.set(id, row); }
        return row;
      };
      // Pack piles per pack size, straight from the stock logs (every reason), in packs.
      const packMoves = new Map<string, { itemId: string; packId: string; in: number; out: number }>();
      let unknownPacks = 0;
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
        const moves = logMoves(log, item);
        if (moves.unknownPackDelta) unknownPacks++;
        Object.entries(moves.packDeltas).forEach(([packId, d]) => {
          const key = `${item!.id}|${packId}`;
          const pack = packMoves.get(key) || { itemId: item!.id, packId, in: 0, out: 0 };
          if (d > 0) pack.in += d; else pack.out -= d;
          packMoves.set(key, pack);
        });
        const reason = lower(log.reason);
        if (reason === 'purchase' || reason === 'production') return; // already counted from purchases and batches
        // Bills give "sold" net of refunds and purchase lines are net of supplier returns,
        // so the stock logs those documents wrote would count the same movement twice.
        if (SALE_REASONS.includes(reason)) return;
        const manualAudit = /Loose Stock Audit|Variant Audit/.test(String(log.notes || ''));
        if (!manualAudit && (reason === lower(AdjustmentReason.SALES_RETURN) || reason === lower(AdjustmentReason.SUPPLY_RETURN))) return;
        // A scrapped customer return is netted out of "sold" but never came back to the shelf.
        const delta = r3(moves.baseDelta - scrappedBaseQty(log, item));
        const row = get(item!.id);
        if (reason === OPENING_REASON) row.opening += delta;
        else if (reason === 'allocation') row.allocated += delta;
        else if (reason === lower(AdjustmentReason.PRODUCTION_USAGE)) row.used += delta;
        else row.adjusted += delta;
      });

      const rows: ReportRow[] = [...map.entries()].map(([id, m]): ReportRow => {
        const item = findItem(data.items, id)!;
        const { reading } = stockOf(item, data);
        const net = m.opening + m.purchased + m.produced + m.allocated - m.sold + m.used + m.adjusted;
        return {
          item: item.name, category: itemCategory(item), unit: reading.unit,
          opening: r3(m.opening), purchased: r3(m.purchased), produced: r3(m.produced), allocated: r3(m.allocated), sold: r3(m.sold),
          used: r3(m.used), adjusted: r3(m.adjusted), net: r3(net), stock: r3(reading.totalBase), piles: pilesText(reading),
          _tone: net < 0 ? 'warn' : undefined,
          _drill: { report: 'item_sales_detail', filters: { itemId: id }, label: 'Sales of this item' },
        };
      }).filter(r => ['opening', 'purchased', 'produced', 'allocated', 'sold', 'used', 'adjusted'].some(k => n(r[k]) !== 0));

      const packRows: ReportRow[] = [...packMoves.values()].map((p): ReportRow => {
        const item = findItem(data.items, p.itemId)!;
        const pile = stockOf(item, data).reading.piles.find(x => x.id === p.packId && (x.kind === 'packed' || x.kind === 'orphan'));
        const pack = (item.variants || []).find(v => v.id === p.packId);
        return {
          item: item.name, pack: packLabel(item, p.packId), size: pack && pack.deduct_from_base !== true ? formatBaseQty(sellUnitContains(pack), item.unit || '') : '—',
          in: r3(p.in), out: r3(p.out), net: r3(p.in - p.out), now: pile ? r3(pile.count) : 0,
          _tone: pile && pile.count < 0 ? 'bad' : !pack || pack.deduct_from_base === true ? 'warn' : undefined,
        };
      }).filter(r => n(r.in) !== 0 || n(r.out) !== 0);
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
          data: top.map(r => ({ name: r.item, in: r3(Math.max(0, n(r.opening)) + n(r.purchased) + n(r.produced) + Math.max(0, n(r.allocated))), out: r3(n(r.sold) - Math.min(0, n(r.used))) })),
          series: [{ key: 'in', label: 'In', color: COLOR.purchase }, { key: 'out', label: 'Out', color: COLOR.sales }],
        }],
        tables: [{
          id: 'items', showTotals: false, sort: { key: 'sold', dir: 'desc' },
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Category', hidden: true },
            { key: 'unit', label: 'Unit' },
            { key: 'opening', label: 'Opening stock', format: 'qty', signed: true },
            { key: 'purchased', label: 'Purchased', format: 'qty' },
            { key: 'produced', label: 'Produced', format: 'qty' },
            { key: 'allocated', label: 'Milk allocated', format: 'qty', signed: true, hidden: true },
            { key: 'sold', label: 'Sold', format: 'qty' },
            { key: 'used', label: 'Used in production', format: 'qty', signed: true },
            { key: 'adjusted', label: 'Adjustments', format: 'qty', signed: true },
            { key: 'net', label: 'Net movement', format: 'qty', signed: true },
            { key: 'stock', label: 'Stock now', format: 'qty', signed: true },
            { key: 'piles', label: 'Stock by pile', wrap: true, hidden: true },
          ],
          rows,
          emptyText: 'No stock movement in this period.',
        }, {
          id: 'packs', title: 'Pack movement', subtitle: 'Ready-made packs in and out, per pack size (counts, not base units)', showTotals: false,
          sort: { key: 'out', dir: 'desc' },
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'pack', label: 'Pack' },
            { key: 'size', label: 'Size' },
            { key: 'in', label: 'In', format: 'qty' },
            { key: 'out', label: 'Out', format: 'qty' },
            { key: 'net', label: 'Net', format: 'qty', signed: true },
            { key: 'now', label: 'Count now', format: 'qty', signed: true },
          ],
          rows: packRows,
          emptyText: 'No pack moved in this period.',
        }],
        notes: [
          { tone: 'info' as const, text: 'This is a movement summary, not an audited stock ledger. Quantities are in each item\'s base unit; packs count at their size. Opening stock entries are shown as an intake; stock held before the period is not, so net movement need not match stock now. Pack movement comes from the stock logs (sales saved before 19 Oct 2026 recorded no pack detail).' },
          ...(unknownPacks ? [{ tone: 'warn' as const, text: `${unknownPacks} old pack count change(s) did not save which pack was counted and are left out.` }] : []),
        ],
      };
    },
  },
];
