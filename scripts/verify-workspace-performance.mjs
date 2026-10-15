import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures/dashboard.mjs';

const baseline = process.argv.includes('--baseline');
const modules = ['dashboard','purchase','allocation','production','pos','sales-history','cash-control','items','inventory','customers','suppliers','expenses','bank-cash','accounts','reports','settings'];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ fixture, modules }) => {
    window.__dashboardFixture = fixture;
    sessionStorage.setItem('mooco_workspace_tabs', JSON.stringify(modules.map(id => ({ id, path: `/${id}`, title: id, iconName: 'LayoutDashboard', closable: id !== 'dashboard' }))));
    localStorage.setItem('app_theme', 'light');
  }, { fixture, modules });
  await context.route('**/context/DairyContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const DairyProvider=({children})=>children;export const useDairy=()=>({...window.__dashboardFixture,hasPermission:()=>true,canPerform:()=>true,setIsUserSwitcherOpen:()=>{},logoutUser:()=>{},retryLoading:async()=>{}});` }));
  await context.route('**/lib/syncService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};` }));
  const requested = new Set();
  await context.route(/\/pages\/[^/]+\.tsx/, route => {
    const name = new URL(route.request().url()).pathname.split('/').pop().replace('.tsx','');
    const id = { Dashboard:'dashboard', Purchase:'purchase', Allocation:'allocation', Production:'production', POS:'pos', SalesHistory:'sales-history', CashControl:'cash-control', Items:'items', Inventory:'inventory', Customers:'customers', Suppliers:'suppliers', Expenses:'expenses', BankCash:'bank-cash', Accounts:'accounts', Reports:'reports', Settings:'settings' }[name];
    requested.add(id);
    return route.fulfill({ contentType: 'application/javascript', body: `export { default } from '/scripts/fixtures/WorkspaceProbe.tsx?module=${id}';` });
  });
  await context.route(/https:\/\/[^/]*\.supabase\.co\//, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3000/dashboard');
  const dashboard = page.locator('[data-probe="dashboard"]');
  await expect(dashboard).toBeVisible();
  await page.waitForTimeout(1000);
  const initialEffects = await page.evaluate(() => window.__workspaceCounters.effects);
  const startupModules = [...requested];
  const result = { savedTabs: modules.length, startupModules, initialEffects, checks: [], runtimeErrors: errors };
  if (!baseline) {
    assert.deepEqual(startupModules, ['dashboard'], 'Only the active saved module should load');
    assert.deepEqual(initialEffects, { dashboard: 1 });
    result.checks.push('16 saved tabs load only the active module on startup');
    const before = await page.evaluate(() => window.__workspaceCounters.renders.dashboard);
    await dashboard.getByRole('button', { name: 'Test notification' }).click();
    await expect(page.getByText('Performance test notification', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.__workspaceCounters.renders.dashboard), before, 'Toast must not re-render command consumers');
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    result.checks.push('Notification display/dismissal does not re-render workspace consumers');
    await dashboard.getByRole('button', { name: 'Visit purchase' }).click();
    const purchase = page.locator('[data-probe="purchase"]');
    await expect(purchase).toBeVisible();
    await purchase.getByLabel('Unsaved draft').fill('580 litres — unsaved collection');
    const identity = await purchase.getAttribute('data-identity');
    await page.locator('[data-module="purchase"]').evaluate(el => el.scrollTop = 320);
    await purchase.getByRole('button', { name: 'Visit dashboard' }).evaluate(el => el.click());
    await expect(dashboard).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__workspaceCounters.effects.purchase)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__workspaceCounters.effects.dashboard)).toBe(1);
    await dashboard.getByRole('button', { name: 'Visit purchase' }).click();
    await expect(purchase).toBeVisible();
    await expect(purchase.getByLabel('Unsaved draft')).toHaveValue('580 litres — unsaved collection');
    assert.equal(await purchase.getAttribute('data-identity'), identity);
    assert.equal(await page.locator('[data-module="purchase"]').evaluate(el => el.scrollTop), 320);
    await expect.poll(() => page.evaluate(() => window.__workspaceCounters.effects.purchase)).toBe(1);
    result.checks.push('Hidden page effects pause; draft, DOM identity and scroll survive switching');
    await purchase.getByRole('button', { name: 'Close purchase' }).evaluate(el => el.click());
    await expect(purchase).toHaveCount(0);
    await page.locator('[data-probe]:visible').getByRole('button', { name: 'Visit dashboard' }).click();
    await expect(dashboard).toBeVisible();
    await dashboard.getByRole('button', { name: 'Visit purchase' }).click();
    await expect(purchase.getByLabel('Unsaved draft')).toHaveValue('');
    result.checks.push('Closing a tab releases its page; reopening starts a fresh form');
    assert.equal(errors.length, 0, errors.join('\n'));
  }
  fs.mkdirSync('screenshots/global-theme', { recursive: true });
  fs.writeFileSync(`screenshots/global-theme/workspace-${baseline ? 'before' : 'after'}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
