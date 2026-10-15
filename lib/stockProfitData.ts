import { supabase } from './supabase';
import { loadRead } from './loadRequest';
import { emptyBases, projectLedger, readUnsyncedWork } from './unsyncedProjection';
import { flattenProfitRecord, StockProfitSource } from './stockProfit';

/** Reports must never silently stop at the API's default 1,000-row limit. */
export async function readCompleteProfitTable(table: string): Promise<any[]> {
  const pageSize = 500;
  const rows: any[] = [];
  let expected: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    const response = await loadRead(supabase.from(table).select('*', { count: 'exact' }).order('id', { ascending: true }).range(offset, offset + pageSize - 1));
    if (response.error) throw new Error(`${table}: ${response.error.message}`);
    if (response.count == null) throw new Error(`${table}: Could not verify the full record count. Retry loading.`);
    if (expected !== null && response.count !== expected) throw new Error('Records changed during loading. Refresh the profit report.');
    expected = response.count;
    rows.push(...(response.data || []));
    if (rows.length >= expected) break;
    if (!response.data?.length) throw new Error(`${table}: Incomplete history received. Retry loading.`);
  }
  if (new Set(rows.map(row => row.id)).size !== expected) throw new Error(`${table}: Duplicate or missing records received. Retry loading.`);
  return rows;
}

export async function loadStockProfitSource(): Promise<StockProfitSource> {
  const names = ['items', 'sales', 'purchases', 'material_purchases', 'allocations', 'production_batches', 'daily_supply', 'expenses', 'inventory_logs', 'supplier_transactions', 'retail_closings'];
  const results = await Promise.allSettled(names.map(readCompleteProfitTable));
  const failed = results.findIndex(result => result.status === 'rejected');
  if (failed >= 0) throw (results[failed] as PromiseRejectedResult).reason;
  const [items, sales, purchases, materialPurchases, allocations, productionBatches, dailySupplyEntries, expenses, inventoryLogs, supplierTransactions, retailClosings] = results.map(result => (result as PromiseFulfilledResult<any[]>).value.map(flattenProfitRecord));
  const endItems = (await readCompleteProfitTable('items')).map(flattenProfitRecord);
  const stockSignature = (rows: any[]) => JSON.stringify(rows.map(item => [item.id, item.stock, item.cost_price, item.variants, item.variant_stocks]));
  if (stockSignature(items) !== stockSignature(endItems)) throw new Error('Stock changed while history was loading. Refresh to calculate from a consistent balance.');
  const work = await readUnsyncedWork();
  // Reuse the POS's idempotent projection so pending vouchers and stock agree.
  const inventory = items.map(item => ({ id: `inv_${item.id}`, item_id: item.id, name: item.name, quantity: item.stock, variant_stocks: item.variant_stocks || {} }));
  const projected = projectLedger({ ...emptyBases(), items, inventory, sales, purchases, allocations, expenses, retailClosings }, work);
  const projectedItems = (projected.items || items).map(item => ({ ...item, stock: projected.inventory?.find(inv => inv.item_id === item.id)?.quantity ?? item.stock }));
  return { items: projectedItems, sales: projected.sales || sales, purchases: projected.purchases || purchases, materialPurchases, allocations: projected.allocations || allocations, productionBatches, dailySupplyEntries, expenses: projected.expenses || expenses, inventoryLogs, supplierTransactions, retailClosings: projected.retailClosings || retailClosings, pendingCount: work.orders.length + work.outbox.length, loadedAt: new Date().toISOString() };
}
