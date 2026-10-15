// Read-only verification against the configured project. Never changes business records.
import fs from 'node:fs';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')]; }));
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const code = ts.transpileModule(fs.readFileSync('lib/stockProfit.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { buildStockProfitReport, flattenProfitRecord } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const tables = { items: 'items', sales: 'sales', purchases: 'purchases', materialPurchases: 'material_purchases', allocations: 'allocations', productionBatches: 'production_batches', dailySupplyEntries: 'daily_supply', expenses: 'expenses', inventoryLogs: 'inventory_logs', supplierTransactions: 'supplier_transactions', retailClosings: 'retail_closings' };
const source = {};
await Promise.all(Object.entries(tables).map(async ([field, table]) => {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error, count } = await client.from(table).select('*', { count: 'exact' }).order('id').range(offset, offset + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (rows.length >= count) break;
    if (!data.length) throw new Error(`${table}: Incomplete history`);
  }
  source[field] = rows.map(flattenProfitRecord);
}));
const report = buildStockProfitReport(source, '2026-10-01', '2026-10-08');
const issueCounts = {};
report.issues.forEach(issue => { issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1; });
const logReasons = {};
source.inventoryLogs.forEach(log => { const key = log.reason || 'Missing reason'; logReasons[key] = (logReasons[key] || 0) + 1; });
const legacyAllocations = source.allocations.filter(a => a.allocated_quantity > 0 && !a.details?.allocation_history?.length);
console.log(JSON.stringify({ counts: Object.fromEntries(Object.keys(tables).map(field => [field, source[field].length])), logReasons, allocationFields: source.allocations[0] ? Object.keys(source.allocations[0]) : [], legacyAllocationExample: legacyAllocations[0] ? { id: legacyAllocations[0].id, purchase_id: legacyAllocations[0].purchase_id, date: legacyAllocations[0].date, milk_type: legacyAllocations[0].milk_type, destination: legacyAllocations[0].destination, original_quantity: legacyAllocations[0].original_quantity, allocated_quantity: legacyAllocations[0].allocated_quantity, remaining_quantity: legacyAllocations[0].remaining_quantity, detailsKeys: Object.keys(legacyAllocations[0].details || {}) } : null, logExample: source.inventoryLogs.slice(0, 3).map(log => ({ keys: Object.keys(log), id: log.id, date: log.date, item_id: log.item_id, reason: log.reason, difference: log.difference, reference_id: log.reference_id })), period: '2026-10-01 to 2026-10-08', openingStock: report.openingStock, closingStock: report.closingStock, netPurchases: report.netPurchases, stockAdjustments: report.stockAdjustments, consumedCost: report.consumedCost, netSales: report.netSales, expenses: report.expenses, netProfit: report.netProfit, provisional: report.issues.length > 0, issueCounts, completedBatchesWithOutputSnapshot: source.productionBatches.filter(batch => batch.output_breakdown || batch.details?.output_breakdown).length }, null, 2));
