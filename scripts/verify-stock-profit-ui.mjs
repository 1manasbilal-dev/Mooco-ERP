import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/dashboard.mjs';
const outDir = path.resolve('screenshots/stock-profit');
fs.mkdirSync(outDir, { recursive: true });
const items = [{ id: 'i', name: 'Paneer', unit: 'kg', stock: 899, cost_price: 987, selling_price: 20, variants: [], variant_stocks: {} }];
const tables = {
  items,
  sales: Array.from({ length: 1101 }, (_, i) => ({ id: `s${String(i).padStart(5, '0')}`, date: '2026-10-02T12:00:00+05:00', bill_number: `S${i}`, total: 20, status: 'Completed', items: [{ itemId: 'i', name: 'Paneer', qty: 1, price: 20, total: 20 }] })),
  material_purchases: [{ id: 'p', date: '2026-10-01T09:00:00+05:00', item_id: 'i', item_name: 'Paneer', quantity: 2000, rate: 10, total_amount: 20000, status: 'Completed' }],
  purchases: [], allocations: [], production_batches: [], daily_supply: [], expenses: [], inventory_logs: [], supplier_transactions: [], retail_closings: []
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(data => { window.__reportFixture = data; localStorage.setItem('app_theme', 'light'); window.print = () => { window.__printed = true; }; }, { ...fixture, accounts: [], items: items.map(item => ({ ...item, category: ['Products'], item_type: ['Sale product'] })), inventory: items.map(item => ({ item_id: item.id, name: item.name, quantity: item.stock, unit: item.unit, price: item.selling_price })), sales: [], purchases: [], allocations: [], inventoryLogs: [], productionBatches: [], suppliers: [], customers: [], expenses: [], sessionError: null, dataLoadError: null, bankTransactions: [], manualAccounts: [], dailySupplyEntries: [], shiftSessions: [] });
  await context.route('**/context/DairyContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const DairyProvider=({children})=>children;export const useDairy=()=>({...window.__reportFixture,hasPermission:()=>true,canPerform:()=>true,retryLoading:async()=>{},setIsUserSwitcherOpen:()=>{},logoutUser:()=>{}});` }));
  await context.route('**/lib/syncService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};` }));
  let failExpenses = false;
  const ranges = [];
  await context.route(/https:\/\/[^/]*\.supabase\.co\/rest\/v1\//, async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    if (failExpenses && table === 'expenses') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Verification: expense history unavailable' }) });
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 500);
    const rows = tables[table] || [];
    ranges.push({ table, offset, count: rows.length });
    const data = rows.slice(offset, offset + limit);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `${data.length ? `${offset}-${offset + data.length - 1}` : '*'}/${rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-08T05:00:00Z'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('TypeError')) console.log(message.text()); });
  await page.goto('http://127.0.0.1:3000/reports?tab=stock_profit');
  await expect(page.getByRole('heading', { name: 'Actual Profit (Stock Based)', exact: true })).toBeVisible();
  await expect(page.getByTestId('stock-profit-net')).toHaveText('Rs 11,010.00', { timeout: 30000 });
  await expect(page.getByText('Recorded stock and costs reconcile', { exact: true })).toBeVisible();
  assert.ok(ranges.some(range => range.table === 'sales' && range.offset === 1000), 'All 1,101 sales must be loaded');
  await page.screenshot({ path: path.join(outDir, 'desktop-light.png') });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /CSV/ }).click();
  const download = await downloadPromise;
  const csvPath = path.join(outDir, 'stock-profit.csv');
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  assert.ok(csv.includes('11010') && csv.includes('8990') && csv.includes('Recorded stock and costs reconcile'));
  await page.getByPlaceholder('Search rows in report...').fill('no match');
  await expect(page.getByText('No stock balances match this range and search.')).toBeVisible();
  await expect(page.getByTestId('stock-profit-net')).toHaveText('Rs 11,010.00');
  await page.getByPlaceholder('Search rows in report...').fill('');
  await page.getByRole('button', { name: /^Print/ }).click();
  assert.equal(await page.evaluate(() => window.__printed), true);
  await page.getByLabel('Report start date').fill('2026-10-03');
  await page.getByLabel('Report end date').fill('2026-10-02');
  await expect(page.getByText('Select a start date on or before the end date.')).toBeVisible();
  await expect(page.getByTestId('stock-profit-net')).toHaveCount(0);
  await page.getByLabel('Report start date').fill('2026-10-01');
  await page.getByLabel('Report end date').fill('2026-10-08');
  tables.inventory_logs = [{ id: 'missing-receipt', date: '2026-10-03', item_id: 'i', item_name: 'Paneer', reason: 'Stock Count Correction', difference: 10 }];
  await page.getByRole('button', { name: 'Refresh history' }).click();
  await expect(page.getByText('Provisional net profit / loss', { exact: true })).toBeVisible();
  await expect(page.getByText('Review before finalising profit', { exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('Review before finalising profit', { exact: true })).toBeVisible();
  await page.pdf({ path: path.join(outDir, 'stock-profit.pdf'), format: 'A4', printBackground: true });
  await page.screenshot({ path: path.join(outDir, 'print.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { localStorage.setItem('app_theme', 'dark'); document.documentElement.classList.add('dark'); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, 'mobile-dark.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page must not overflow');
  failExpenses = true;
  await page.getByRole('button', { name: 'Refresh history' }).click();
  await expect(page.getByText('Profit report could not load', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('stock-profit-net')).toHaveCount(0);
  failExpenses = false;
  tables.inventory_logs = [];
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByTestId('stock-profit-net')).toHaveText('Rs 11,010.00');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['pagination beyond 1000', 'profit rendering', 'CSV stock + formula + status', 'search preserves totals', 'print', 'invalid date range', 'provisional checks', 'mobile dark layout', 'failed history hides totals', 'retry recovers'], runtimeErrors: errors }, null, 2));
} finally { await browser.close(); }
