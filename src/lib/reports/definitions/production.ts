import type { ReportDefinition, ReportRow } from '../types';
import { COLOR, inRange, lower, n, pct, r2, r3, sum } from '../helpers';
import type { ProductionBatch } from '../../../types';

const isCompleted = (b: ProductionBatch) => lower(b.status) === 'completed';
const isCancelled = (b: ProductionBatch) => /cancel/i.test(String(b.status || ''));

/** Actual output in base units: stored actual, else loose + packed breakdown. */
function actualOutput(b: ProductionBatch): number {
  if (n(b.quantity_output_actual) > 0) return n(b.quantity_output_actual);
  const br = b.output_breakdown || b.details?.output_breakdown;
  if (!br) return 0;
  const packed = (Array.isArray(br.variants) ? br.variants : []).reduce((s: number, v: any) => s + (n(v.total_base_qty) || n(v.count) * n(v.base_qty_each)), 0);
  return n(br.loose_qty) + packed;
}

interface BatchFigures {
  input: number; expected: number; actual: number; wastage: number;
  milk: number; additives: number; packaging: number; cost: number;
  sales: number; profit: number; hasFinancials: boolean;
}

function batchFigures(b: ProductionBatch): BatchFigures {
  const fin: any = b.financials || b.details?.financials || null;
  const input = n(b.quantity_input);
  const milk = fin ? n(fin.milk_cost) : r2(input * n(b.input_cost_per_unit));
  const additives = n(fin?.additives_cost);
  const packaging = n(fin?.packaging_cost);
  const cost = fin && n(fin.total_cost) > 0 ? n(fin.total_cost) : milk + additives + packaging;
  const sales = n(fin?.sales_value);
  const profit = fin && (fin.gross_profit !== undefined && fin.gross_profit !== null) ? n(fin.gross_profit) : sales - cost;
  return {
    input, expected: n(b.quantity_output_estimated), actual: actualOutput(b), wastage: n(b.wastage),
    milk: r2(milk), additives: r2(additives), packaging: r2(packaging), cost: r2(cost),
    sales: r2(sales), profit: r2(sales > 0 || fin ? profit : 0), hasFinancials: Boolean(fin),
  };
}

const batchesInRange = (batches: ProductionBatch[], f: { from: string; to: string }) =>
  batches.filter(b => inRange(b.start_date, f));

const STATUS_TONES = { Completed: 'good', Cancelled: 'bad', Processing: 'info', 'Quality Check': 'warn', Packaging: 'info' } as const;

export const productionReports: ReportDefinition[] = [
  {
    id: 'production_batches',
    title: 'Production Batches',
    subtitle: 'Every batch with input, output, yield, cost and profit',
    category: 'production',
    icon: 'Factory',
    keywords: ['batch', 'yield', 'yogurt making', 'dahi', 'conversion'],
    financial: true,
    comparable: true,
    build: (data, f) => {
      const batches = batchesInRange(data.productionBatches, f);
      let noFinancials = 0;
      const rows: ReportRow[] = batches.map(b => {
        const fig = batchFigures(b);
        if (isCompleted(b) && !fig.hasFinancials) noFinancials++;
        const yieldPct = fig.expected > 0 && fig.actual > 0 ? pct(fig.actual, fig.expected) : null;
        return {
          date: b.start_date, completed: b.completed_date || null, batch: b.batch_number, product: b.product_name || 'Product',
          status: String(b.status || ''), input: r3(fig.input), expected: r3(fig.expected), actual: r3(fig.actual),
          yieldPct, wastage: r3(fig.wastage), milk: fig.milk, additives: fig.additives, packaging: fig.packaging,
          cost: fig.cost, sales: fig.sales, profit: fig.profit, unitCost: fig.actual > 0 ? r2(fig.cost / fig.actual) : null,
          _tone: isCancelled(b) ? 'neutral' : fig.profit < 0 ? 'bad' : yieldPct !== null && yieldPct < 90 ? 'warn' : undefined,
        };
      });
      const live = batches.filter(b => !isCancelled(b)).map(batchFigures);
      const done = batches.filter(isCompleted).map(batchFigures);
      const doneExpected = sum(done.filter(x => x.expected > 0 && x.actual > 0), x => x.expected);
      const doneActual = sum(done.filter(x => x.expected > 0 && x.actual > 0), x => x.actual);
      const cost = sum(live, x => x.cost);
      const profit = sum(done, x => x.profit);
      const byProduct = new Map<string, { name: string; cost: number; sales: number; profit: number }>();
      batches.filter(b => !isCancelled(b)).forEach(b => {
        const fig = batchFigures(b);
        const key = b.product_name || 'Product';
        const row = byProduct.get(key) || { name: key, cost: 0, sales: 0, profit: 0 };
        row.cost += fig.cost; row.sales += fig.sales; row.profit += fig.profit;
        byProduct.set(key, row);
      });
      const chart = [...byProduct.values()].map(r => ({ name: r.name, cost: r2(r.cost), sales: r2(r.sales), profit: r2(r.profit) })).sort((a, b) => b.cost - a.cost);
      return {
        kpis: [
          { key: 'batches', label: 'Batches', value: batches.length, format: 'number' },
          { key: 'completed', label: 'Completed', value: done.length, format: 'number', tone: 'good' },
          { key: 'input', label: 'Input used', value: r3(sum(live, x => x.input)), format: 'qty', unit: 'L' },
          { key: 'yield', label: 'Average yield', value: pct(doneActual, doneExpected), format: 'percent', hint: 'Actual vs expected output' },
          { key: 'cost', label: 'Production cost', value: cost, format: 'money', inverse: true },
          { key: 'profit', label: 'Gross profit', value: profit, format: 'money', tone: profit >= 0 ? 'good' : 'bad', hint: 'Completed batches' },
        ],
        charts: [{
          id: 'products', title: 'Cost vs sales value by product', type: 'bar', wide: true, xKey: 'name', format: 'money', data: chart,
          series: [{ key: 'cost', label: 'Cost', color: COLOR.expense }, { key: 'sales', label: 'Sales value', color: COLOR.sales }, { key: 'profit', label: 'Gross profit', color: COLOR.profit }],
        }],
        tables: [{
          id: 'batches', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Started', format: 'date' },
            { key: 'completed', label: 'Completed', format: 'date', hidden: true },
            { key: 'batch', label: 'Batch #' },
            { key: 'product', label: 'Product' },
            { key: 'status', label: 'Status', format: 'badge', tones: STATUS_TONES },
            { key: 'input', label: 'Input', format: 'qty', unit: 'L', total: true },
            { key: 'expected', label: 'Expected', format: 'qty', total: true, hidden: true },
            { key: 'actual', label: 'Actual output', format: 'qty', total: true },
            { key: 'yieldPct', label: 'Yield', format: 'percent' },
            { key: 'wastage', label: 'Wastage', format: 'qty', total: true },
            { key: 'milk', label: 'Milk cost', format: 'money', total: true, hidden: true },
            { key: 'additives', label: 'Additives', format: 'money', total: true, hidden: true },
            { key: 'packaging', label: 'Packaging', format: 'money', total: true, hidden: true },
            { key: 'cost', label: 'Total cost', format: 'money', total: true },
            { key: 'sales', label: 'Sales value', format: 'money', total: true },
            { key: 'profit', label: 'Gross profit', format: 'money', total: true, signed: true },
            { key: 'unitCost', label: 'Cost / unit', format: 'money' },
          ],
          rows,
          emptyText: 'No batches started in this period.',
        }],
        notes: noFinancials
          ? [{ tone: 'warn', text: `${noFinancials} completed batch(es) have no saved cost sheet, so their cost uses input × input rate and sales value shows as zero.` }]
          : undefined,
      };
    },
  },
  {
    id: 'production_by_product',
    title: 'Production by Product',
    subtitle: 'Batches, yield, cost per unit and profit for each product',
    category: 'production',
    icon: 'FlaskConical',
    keywords: ['product yield', 'cost per kg', 'production summary'],
    financial: true,
    comparable: true,
    build: (data, f) => {
      const map = new Map<string, any>();
      batchesInRange(data.productionBatches, f).filter(b => !isCancelled(b)).forEach(b => {
        const fig = batchFigures(b);
        const key = b.product_name || 'Product';
        const row = map.get(key) || { product: key, batches: 0, completed: 0, input: 0, expected: 0, actual: 0, yExpected: 0, yActual: 0, wastage: 0, cost: 0, doneCost: 0, sales: 0, profit: 0 };
        row.batches++; row.input += fig.input; row.expected += fig.expected; row.actual += fig.actual; row.wastage += fig.wastage; row.cost += fig.cost;
        if (isCompleted(b)) {
          row.completed++; row.doneCost += fig.cost; row.sales += fig.sales; row.profit += fig.profit;
          if (fig.expected > 0 && fig.actual > 0) { row.yExpected += fig.expected; row.yActual += fig.actual; }
        }
        map.set(key, row);
      });
      const rows: ReportRow[] = [...map.values()].map(r => ({
        product: r.product, batches: r.batches, completed: r.completed, input: r3(r.input), expected: r3(r.expected), actual: r3(r.actual),
        yieldPct: r.yExpected > 0 ? pct(r.yActual, r.yExpected) : null, wastage: r3(r.wastage), cost: r2(r.cost),
        unitCost: r.actual > 0 ? r2(r.doneCost / r.actual) : null, perInput: r.input > 0 ? r3(r.actual / r.input) : null,
        sales: r2(r.sales), profit: r2(r.profit), margin: pct(r.profit, r.sales),
        _tone: r.profit < 0 ? 'bad' : undefined,
      }));
      const sales = sum(rows, r => n(r.sales));
      const profit = sum(rows, r => n(r.profit));
      return {
        kpis: [
          { key: 'products', label: 'Products made', value: rows.length, format: 'number' },
          { key: 'batches', label: 'Batches', value: sum(rows, r => n(r.batches)), format: 'number' },
          { key: 'cost', label: 'Production cost', value: sum(rows, r => n(r.cost)), format: 'money', inverse: true },
          { key: 'profit', label: 'Gross profit', value: profit, format: 'money', tone: profit >= 0 ? 'good' : 'bad' },
          { key: 'margin', label: 'Margin', value: pct(profit, sales), format: 'percent' },
        ],
        charts: [
          {
            id: 'value', title: 'Cost, sales value and profit', type: 'bar', xKey: 'name', format: 'money',
            data: rows.map(r => ({ name: r.product, cost: r.cost, sales: r.sales, profit: r.profit })),
            series: [{ key: 'cost', label: 'Cost', color: COLOR.expense }, { key: 'sales', label: 'Sales value', color: COLOR.sales }, { key: 'profit', label: 'Profit', color: COLOR.profit }],
          },
          {
            id: 'yield', title: 'Yield by product', type: 'bar', xKey: 'name', format: 'percent',
            data: rows.filter(r => r.yieldPct !== null).map(r => ({ name: r.product, yieldPct: r.yieldPct })),
            series: [{ key: 'yieldPct', label: 'Yield %', color: COLOR.online }],
          },
        ],
        tables: [{
          id: 'products', showTotals: true, sort: { key: 'cost', dir: 'desc' },
          columns: [
            { key: 'product', label: 'Product' },
            { key: 'batches', label: 'Batches', format: 'number', total: true },
            { key: 'completed', label: 'Completed', format: 'number', total: true, hidden: true },
            { key: 'input', label: 'Input', format: 'qty', unit: 'L', total: true },
            { key: 'expected', label: 'Expected', format: 'qty', total: true, hidden: true },
            { key: 'actual', label: 'Output', format: 'qty', total: true },
            { key: 'perInput', label: 'Output per L', format: 'qty', hidden: true },
            { key: 'yieldPct', label: 'Avg yield', format: 'percent' },
            { key: 'wastage', label: 'Wastage', format: 'qty', total: true },
            { key: 'cost', label: 'Total cost', format: 'money', total: true },
            { key: 'unitCost', label: 'Cost / unit', format: 'money' },
            { key: 'sales', label: 'Sales value', format: 'money', total: true },
            { key: 'profit', label: 'Gross profit', format: 'money', total: true, signed: true },
            { key: 'margin', label: 'Margin', format: 'percent' },
          ],
          rows,
          emptyText: 'No batches started in this period.',
        }],
        notes: [{ tone: 'info', text: 'Cancelled batches are left out. Sales value, profit and yield count completed batches only.' }],
      };
    },
  },
];
