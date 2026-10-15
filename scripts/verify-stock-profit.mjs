import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync('lib/stockProfit.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { buildStockProfitReport: report, profitDay } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const empty = () => ({ items: [], sales: [], purchases: [], materialPurchases: [], allocations: [], productionBatches: [], dailySupplyEntries: [], expenses: [], inventoryLogs: [], supplierTransactions: [], retailClosings: [] });
const item = (stock, cost = 999) => ({ id: 'i', name: 'Paneer', stock, unit: 'kg', cost_price: cost });
const purchase = (id, date, quantity, rate) => ({ id, date, quantity, rate, total_amount: quantity * rate, item_id: 'i', item_name: 'Paneer', status: 'Completed' });
const sale = (id, date, quantity, total) => ({ id, date, bill_number: id, total, status: 'Completed', items: [{ itemId: 'i', name: 'Paneer', qty: quantity, price: total / quantity, total }] });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 0.02, `${actual} != ${expected}`);
const tests = [];
function test(name, fn) { fn(); tests.push(name); }

test('Pakistan midnight and date-only business dates', () => {
  assert.equal(profitDay('2026-09-30T21:15:00Z'), '2026-10-01');
  assert.equal(profitDay('2026-09-30'), '2026-09-30');
});
test('Historical stock, weighted purchase cost, accrual expenses and future isolation', () => {
  const s = { ...empty(), items: [item(80)], materialPurchases: [purchase('a', '2026-09-01', 100, 10), purchase('b', '2026-10-01', 100, 20)], sales: [sale('a', '2026-09-02', 40, 600), sale('b', '2026-10-02', 80, 2400)], expenses: [{ id: 'e', date: '2026-10-02', amount: 100, paid_amount: 0 }] };
  const september = report(s, '2026-09-01', '2026-09-30');
  near(september.openingStock, 0); near(september.closingStock, 600); near(september.consumedCost, 400); near(september.netProfit, 200);
  assert.deepEqual(september.issues, []);
  const october = report(s, '2026-10-01', '2026-10-02');
  near(october.openingStock, 600); near(october.closingStock, 1300); near(october.consumedCost, 1300); near(october.netProfit, 1000);
  near(report({ ...s, items: [item(80, 12345)] }, '2026-09-01', '2026-09-30').netProfit, 200);
});
test('Unsold purchased stock does not reduce profit', () => {
  const r = report({ ...empty(), items: [item(100)], materialPurchases: [purchase('a', '2026-10-01', 100, 10)] }, '2026-10-01', '2026-10-01');
  near(r.consumedCost, 0); near(r.netProfit, 0); assert.deepEqual(r.issues, []);
});
test('Invoice stock logs never deduct the same sale twice', () => {
  const s = { ...empty(), items: [item(80)], materialPurchases: [purchase('a', '2026-10-01', 100, 10)], sales: [sale('s', '2026-10-02', 20, 400)], inventoryLogs: [{ id: 'log_s_i', date: '2026-10-02', item_id: 'i', item_name: 'Paneer', reason: 'Sale', difference: -20 }] };
  const r = report(s, '2026-10-01', '2026-10-02');
  near(r.openingStock, 0); near(r.closingStock, 800); near(r.netProfit, 200); assert.deepEqual(r.issues, []);
});
test('Partial supplier returns occur on the return date, not original invoice date', () => {
  const s = { ...empty(), items: [item(60)], materialPurchases: [{ ...purchase('a', '2026-09-01', 80, 10), details: { partial_returned: true, returned_quantity: 20 } }], sales: [sale('s', '2026-09-02', 20, 400)], supplierTransactions: [{ id: 'r', date: '2026-10-01', type: 'Return', amount: 200, details: { purchase_id: 'a' } }] };
  const before = report(s, '2026-09-01', '2026-09-30');
  near(before.grossPurchases, 1000); near(before.closingStock, 800); near(before.netProfit, 200);
  const after = report(s, '2026-10-01', '2026-10-01');
  near(after.openingStock, 800); near(after.purchaseReturns, 200); near(after.closingStock, 600); near(after.netProfit, 0);
});
test('Full supplier return preserves historical purchase before return', () => {
  const s = { ...empty(), items: [item(0)], materialPurchases: [{ ...purchase('a', '2026-09-01', 100, 10), status: 'Returned', details: { returned_at: '2026-10-01', returned_quantity: 100 } }], supplierTransactions: [{ id: 'r', date: '2026-10-01', type: 'Return', amount: 1000, details: { purchase_id: 'a' } }] };
  near(report(s, '2026-09-01', '2026-09-30').closingStock, 1000);
  near(report(s, '2026-10-01', '2026-10-01').netProfit, 0);
});
test('A later sales return reverses original sold cost after purchase prices change', () => {
  const s = { ...empty(), items: [item(200)], materialPurchases: [purchase('a', '2026-09-01', 100, 10), purchase('b', '2026-10-01', 100, 20)], sales: [{ ...sale('s', '2026-09-02', 50, 750), status: 'Returned', refund_amount: 750, returned_at: '2026-10-02', details: { returned_items: [{ itemId: 'i', name: 'Paneer', qty: 50, price: 15, returnDate: '2026-10-02', restock: 'restock', action: 'refund' }] } }] };
  near(report(s, '2026-09-01', '2026-09-30').netProfit, 250);
  const returned = report(s, '2026-10-01', '2026-10-02');
  near(returned.openingStock, 500); near(returned.closingStock, 3000); near(returned.salesReturns, 750); near(returned.netProfit, -250);
});
test('Discounted partial refund and scrapped returns do not restock or double deduct cost', () => {
  const s = { ...empty(), items: [item(90)], materialPurchases: [purchase('a', '2026-10-01', 100, 10)], sales: [{ ...sale('s', '2026-10-01', 10, 180), refund_amount: 90, details: { returned_items: [{ itemId: 'i', name: 'Paneer', qty: 5, price: 20, returnDate: '2026-10-02', restock: 'scrap_spoilage', action: 'refund' }] } }] };
  const r = report(s, '2026-10-01', '2026-10-02');
  near(r.netSales, 90); near(r.consumedCost, 100); near(r.netProfit, -10);
});
test('Stock wastage is charged once; stock-count corrections have a separate bridge', () => {
  const s = { ...empty(), items: [item(75)], materialPurchases: [purchase('a', '2026-10-01', 100, 10)], sales: [sale('s', '2026-10-02', 20, 400)], inventoryLogs: [{ id: 'loss', date: '2026-10-02', item_id: 'i', reason: 'Spoilage / Wastage', difference: -5 }] };
  const r = report(s, '2026-10-01', '2026-10-02');
  near(r.consumedCost, 250); near(r.stockLoss, 50); near(r.netProfit, 150);
  const corrected = report({ ...s, items: [item(85)], inventoryLogs: [...s.inventoryLogs, { id: 'count', date: '2026-10-02', item_id: 'i', reason: 'Stock Count Correction', difference: 10 }] }, '2026-10-01', '2026-10-02');
  near(corrected.stockAdjustments, 100); near(corrected.netProfit, 150);
  const shortage = report({ ...s, items: [item(70)], inventoryLogs: [...s.inventoryLogs, { id: 'short', date: '2026-10-02', item_id: 'i', reason: 'Stock Count Correction', difference: -5 }] }, '2026-10-01', '2026-10-02');
  near(shortage.stockLoss, 100); near(shortage.netProfit, 100);
});
test('Raw milk, retail transfers and WIP stay assets across the selected boundary', () => {
  const s = { ...empty(), items: [{ id: 'milk', name: 'Cow Milk', stock: 60, cost_price: 999, unit: 'L' }, { id: 'i', name: 'Paneer', stock: 0, unit: 'kg' }], purchases: [{ id: 'p', date: '2026-10-01', quantity: 100, rate: 10, total_amount: 1000, milk_type: 'Cow' }], allocations: [{ id: 'a', purchase_id: 'p', milk_type: 'Cow', date: '2026-10-01', remaining_quantity: 0, details: { allocation_history: [{ allocated_at: '2026-10-01', destination: 'Retail Counter', quantity: 60 }, { allocated_at: '2026-10-02', destination: 'Production', quantity: 40 }] } }], productionBatches: [{ id: 'b', batch_number: 'B1', product_name: 'Paneer', status: 'Processing', quantity_input: 40, start_date: '2026-10-02', input_cost_per_unit: 10, details: { milk_breakdown: [{ source: 'fresh', allocationId: 'a', quantity: 40, milkType: 'Cow', rate: 10 }] } }] };
  const first = report(s, '2026-10-01', '2026-10-01');
  near(first.closingStock, 1000); near(first.consumedCost, 0);
  const second = report(s, '2026-10-02', '2026-10-02');
  near(second.openingStock, 1000); near(second.closingStock, 1000); near(second.netProfit, 0);
  assert.deepEqual(second.issues, []);
});
test('Production cost transfers to loose and packed products without another purchase cost', () => {
  const s = { ...empty(), items: [{ id: 'i', name: 'Paneer', stock: 2, unit: 'kg', variants: [{ id: 'v', name: '2kg', quantity_in_base_unit: 2 }], variant_stocks: { v: 3 } }], purchases: [{ id: 'p', date: '2026-10-01', quantity: 10, rate: 10, total_amount: 100, milk_type: 'Cow' }], allocations: [{ id: 'a', purchase_id: 'p', milk_type: 'Cow', date: '2026-10-01', remaining_quantity: 0, details: { allocation_history: [{ allocated_at: '2026-10-01', destination: 'Production', quantity: 10 }] } }], productionBatches: [{ id: 'b', batch_number: 'B1', product_name: 'Paneer', status: 'Completed', quantity_input: 10, quantity_output_actual: 10, start_date: '2026-10-01', completed_date: '2026-10-02', details: { milk_breakdown: [{ source: 'fresh', allocationId: 'a', quantity: 10 }], output_breakdown: { loose_qty: 2, variants: [{ variantId: 'v', count: 4, base_qty_each: 2 }] }, cost_snapshot: { external_conversion_cost: 0 } } }], sales: [{ ...sale('s', '2026-10-03', 1, 30), items: [{ itemId: 'i', name: 'Paneer', variantId: 'v', qty: 1, price: 30, total: 30 }] }] };
  const r = report(s, '2026-10-01', '2026-10-03');
  near(r.closingStock, 80); near(r.consumedCost, 20); near(r.netProfit, 10); assert.deepEqual(r.issues, []);
});
test('Cancelled batch returns milk; completion after the range remains WIP', () => {
  const s = { ...empty(), purchases: [{ id: 'p', date: '2026-10-01', quantity: 10, rate: 10, total_amount: 100, milk_type: 'Cow' }], allocations: [{ id: 'a', purchase_id: 'p', date: '2026-10-01', milk_type: 'Cow', remaining_quantity: 0, details: { allocation_history: [{ destination: 'Production', allocated_at: '2026-10-01', quantity: 10 }] } }, { id: 'ret', purchase_id: 'ret_b', date: '2026-10-03', milk_type: 'Cow', remaining_quantity: 10, average_rate: 10, details: { returned_from_batch_id: 'b' } }], productionBatches: [{ id: 'b', batch_number: 'B1', status: 'Cancelled', product_name: 'Paneer', quantity_input: 10, start_date: '2026-10-01', completed_date: '2026-10-03', details: { milk_breakdown: [{ source: 'fresh', allocationId: 'a', quantity: 10 }] } }] };
  near(report(s, '2026-10-01', '2026-10-02').closingStock, 100);
  near(report(s, '2026-10-03', '2026-10-03').netProfit, 0);
});
test('Completed supply sales and delivery stock; pending supplies do not create profit', () => {
  const s = { ...empty(), purchases: [{ id: 'p', date: '2026-10-01', quantity: 100, rate: 10, total_amount: 1000, milk_type: 'Cow' }], allocations: [{ id: 'a', purchase_id: 'p', date: '2026-10-01', milk_type: 'Cow', remaining_quantity: 40, average_rate: 10, details: { allocation_history: [{ destination: 'Home Delivery', allocated_at: '2026-10-01', quantity: 60 }] } }], dailySupplyEntries: [{ id: 's', date: '2026-10-02', status: 'Completed', allocation_id: 'a', net_qty: 50, total_amount: 1000 }, { id: 'pending', date: '2026-10-02', status: 'Pending', allocation_id: 'a', net_qty: 10, total_amount: 200 }] };
  const r = report(s, '2026-10-01', '2026-10-02');
  near(r.closingStock, 500); near(r.supplySales, 1000); near(r.netProfit, 500); assert.deepEqual(r.issues, []);
});
test('Missing historical opening costs and negative stocks stay explicitly provisional', () => {
  const r = report({ ...empty(), items: [item(10, 0)] }, '2026-10-01', '2026-10-02');
  assert.ok(r.issues.some(i => i.code === 'opening_history'));
  assert.ok(r.issues.some(i => i.code === 'missing_cost'));
  assert.ok(report({ ...empty(), items: [item(0)], materialPurchases: [purchase('a', '2026-10-01', 100, 10)] }, '2026-10-01', '2026-10-02').issues.some(i => i.code === 'negative_opening'));
  assert.equal(report(empty(), '2026-10-03', '2026-10-01').validRange, false);
  assert.ok(report({ ...empty(), pendingCount: 1 }, '2026-10-01', '2026-10-01').issues.some(i => i.code === 'pending_sync'));
});
console.log(JSON.stringify({ passed: tests.length, tests }, null, 2));
