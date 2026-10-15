import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/dashboard.mjs';

const outDir = path.join(process.cwd(), 'screenshots', 'sidebar-redesign');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
await context.addInitScript(data => {
  window.__dashboardFixture = data;
  window.__allowedPermissions = null;
  if (!localStorage.getItem('app_theme')) localStorage.setItem('app_theme', 'light');
  if (!localStorage.getItem('app_sidebar_auto_collapse')) localStorage.setItem('app_sidebar_auto_collapse', 'false');
}, fixture);
// Navigation is exercised with the real tab provider and an isolated page placeholder.
// No live page actions, user changes, authentication calls or database writes are made.
await context.route('**/components/WorkspaceContainer.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export default function WorkspaceContainer(){return 'Navigation preview';}` }));
await context.route('**/context/DairyContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
export const DairyProvider=({children})=>children;
export const useDairy=()=>({...window.__dashboardFixture,
  hasPermission:module=>window.__allowedPermissions===null||window.__allowedPermissions.includes(module),
  canPerform:()=>true, setIsUserSwitcherOpen:()=>{window.__switchCount=(window.__switchCount||0)+1;},
  logoutUser:()=>{window.__logoutCount=(window.__logoutCount||0)+1;}, retryLoading:async()=>{}});
` }));
await context.route('**/lib/syncService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};` }));
await context.route(/https:\/\/[^/]*\.supabase\.co\//, route => route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto('http://127.0.0.1:3000/dashboard');
const sidebar = page.locator('#mooco-sidebar');
const panel = page.locator('.mooco-sidebar-panel');
const nav = page.getByRole('navigation', { name: 'Main navigation' });
const profile = sidebar.getByRole('button', { name: 'User menu for Anas Bilal', exact: true });
const checks = [];
await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
await expect(sidebar).toHaveCSS('width', '280px');
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(outDir, 'desktop-light.png') });

await nav.getByRole('button', { name: 'Sales & POS', exact: true }).click();
await expect(nav.getByRole('button', { name: 'Sales & POS', exact: true })).toHaveAttribute('aria-expanded', 'true');
await nav.getByRole('button', { name: 'Sales History & Returns', exact: true }).click();
await expect(page).toHaveURL('http://127.0.0.1:3000/sales-history');
await expect(nav.getByRole('button', { name: 'Sales History & Returns', exact: true })).toHaveAttribute('aria-current', 'page');
await expect(nav.getByRole('button', { name: 'Sales & POS', exact: true })).toHaveClass(/is-active/);
await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
await nav.getByRole('button', { name: 'Sales & POS', exact: true }).click();
await expect(nav.getByRole('button', { name: 'POS Terminal', exact: true })).toHaveCount(0);

await sidebar.getByRole('button', { name: 'Use compact sidebar' }).click();
await expect(sidebar).toHaveCSS('width', '88px');
await page.mouse.move(900, 600);
await expect(panel).toHaveCSS('width', '78px');
assert.equal(await page.evaluate(() => localStorage.getItem('app_sidebar_auto_collapse')), 'true');
const mainWidth = await page.locator('[data-sidebar-content]').evaluate(el => el.getBoundingClientRect().width);
await sidebar.hover();
await expect(panel).toHaveCSS('width', '270px');
assert.equal(await page.locator('[data-sidebar-content]').evaluate(el => el.getBoundingClientRect().width), mainWidth, 'Hover expansion must not move the dashboard');
await page.mouse.move(900, 600);
await expect(panel).toHaveCSS('width', '78px');
await page.screenshot({ path: path.join(outDir, 'desktop-compact.png') });
await page.reload();
await expect(sidebar).toHaveAttribute('data-compact', 'true');
await nav.getByRole('button', { name: 'Dashboard', exact: true }).focus();
await expect(sidebar).toHaveAttribute('data-reveal', 'true');
await expect(panel).toHaveCSS('width', '270px');
await sidebar.getByRole('button', { name: 'Pin sidebar expanded' }).click();
await expect(sidebar).toHaveCSS('width', '280px');
await page.reload();
await expect(sidebar).toHaveAttribute('data-compact', 'false');
// Settings uses the same persistence event, including changes made from another window.
await page.evaluate(() => { localStorage.setItem('app_sidebar_auto_collapse', 'true'); window.dispatchEvent(new Event('mooco-sidebar-preference')); });
await expect(sidebar).toHaveAttribute('data-compact', 'true');
await page.evaluate(() => { localStorage.setItem('app_sidebar_auto_collapse', 'false'); window.dispatchEvent(new StorageEvent('storage', { key: 'app_sidebar_auto_collapse' })); });
await expect(sidebar).toHaveAttribute('data-compact', 'false');
checks.push('Compact preference persistence, Settings sync and stable hover expansion');

await profile.click();
await expect(page.getByRole('dialog', { name: 'User options' })).toBeVisible();
await expect(page.getByRole('button', { name: 'Switch User / Lock', exact: true })).toBeFocused();
await page.screenshot({ path: path.join(outDir, 'desktop-profile.png') });
await page.keyboard.press('Escape');
await expect(profile).toBeFocused();
await expect(page.getByRole('dialog', { name: 'User options' })).toHaveCount(0);
await profile.click();
await page.locator('header').click({ position: { x: 15, y: 15 } });
await expect(page.getByRole('dialog', { name: 'User options' })).toHaveCount(0);
await profile.click();
await page.getByRole('button', { name: 'Switch User / Lock', exact: true }).click();
assert.equal(await page.evaluate(() => window.__switchCount), 1);
await profile.click();
await page.getByRole('button', { name: 'Logout / Sign Out', exact: true }).click();
assert.equal(await page.evaluate(() => window.__logoutCount), 1);
checks.push('Profile menu, Escape focus restoration, outside dismissal and isolated action callbacks');
await page.getByTitle('Switch to Dark Theme').click();
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(outDir, 'desktop-dark.png') });

const touch = await context.newCDPSession(page);
async function gesture(vertical = false) {
 const box = await nav.boundingBox();
 const start = { x: vertical ? 150 : Math.min(box.x + box.width - 25, 270), y: box.y + Math.min(150, box.height / 2) };
 const end = { x: vertical ? start.x : 50, y: vertical ? start.y - 90 : start.y };
 await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
 for (let step = 1; step <= 8; step++) {
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1 }] });
  await page.waitForTimeout(30);
 }
 await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
 await page.waitForTimeout(350);
}
for (const [width, height] of [[390, 844], [320, 568]]) {
 await page.setViewportSize({ width, height });
 await expect(sidebar).toHaveAttribute('data-desktop', 'false');
 await expect(sidebar).toHaveAttribute('inert', '');
 await expect(nav).not.toBeVisible();
 const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
 await opener.click();
 await expect(page.getByRole('dialog', { name: 'Navigation menu', exact: true })).toBeVisible();
 await expect(sidebar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
 await expect(page.getByRole('button', { name: 'Close navigation menu', exact: true })).toBeFocused();
 assert.ok(await page.locator('[data-sidebar-content]').evaluate(el => el.inert));
 const box = await panel.boundingBox();
 assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `Drawer bounds at ${width}px: ${JSON.stringify(box)}`);
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
 await sidebar.getByRole('button', { name: 'Go to dashboard', exact: true }).focus();
 await page.keyboard.press('Shift+Tab');
 await expect(profile).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(sidebar.getByRole('button', { name: 'Go to dashboard', exact: true })).toBeFocused();
 await nav.evaluate(el => el.scrollTop = 0);
 await gesture(true);
 await expect(sidebar).toHaveAttribute('data-open', 'true');
 assert.ok(await nav.evaluate(el => el.scrollTop > 20), 'Vertical touch should scroll the menu');
 await nav.evaluate(el => el.scrollTop = 0);
 await page.screenshot({ path: path.join(outDir, `mobile-dark-${width}.png`) });
 await gesture();
 await expect(sidebar).toHaveAttribute('data-open', 'false');
 await expect(page).toHaveURL('http://127.0.0.1:3000/dashboard');
 await expect(opener).toBeFocused();
 assert.equal(await page.locator('[data-sidebar-content]').evaluate(el => el.inert), false);
 await opener.click();
 await page.keyboard.press('Escape');
 await expect(opener).toBeFocused();
 await expect(sidebar).toHaveAttribute('data-open', 'false');
 checks.push(`Mobile ${width}px: drawer bounds, inert background, focus trap, swipe close and vertical scrolling`);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.getByTitle('Switch to Light Theme').click();
await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(outDir, 'mobile-light.png') });
await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 400 } });
await expect(sidebar).toHaveAttribute('data-open', 'false');
await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
await nav.getByRole('button', { name: 'Sales & POS', exact: true }).click();
await nav.getByRole('button', { name: 'Sales History & Returns', exact: true }).click();
await expect(page).toHaveURL('http://127.0.0.1:3000/sales-history');
await expect(sidebar).toHaveAttribute('data-open', 'false');
await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
await expect(nav.getByRole('button', { name: 'Sales History & Returns', exact: true })).toHaveAttribute('aria-current', 'page');
await page.emulateMedia({ reducedMotion: 'reduce' });
assert.equal(await sidebar.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
await expect(page.getByRole('button', { name: 'Close navigation menu', exact: true })).toBeFocused();
await profile.click();
await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 400 } });
await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
await expect(page.getByRole('dialog', { name: 'User options' })).toHaveCount(0);
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1440, height: 1000 });
await expect(sidebar).toHaveAttribute('data-desktop', 'true');
await page.evaluate(() => {
 window.__allowedPermissions = ['dashboard', 'purchase'];
 window.__dashboardFixture.currentUser.role_id = 'role_staff';
 window.__dashboardFixture.currentRole = { id: 'role_staff', name: 'Staff' };
});
await sidebar.getByRole('button', { name: 'Use compact sidebar' }).click();
await sidebar.getByRole('button', { name: 'Pin sidebar expanded' }).click();
await expect(nav.getByRole('button', { name: 'Sales & POS', exact: true })).toHaveCount(0);
await expect(sidebar.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
await expect(nav.getByRole('button', { name: 'Milk Collection', exact: true })).toBeVisible();
await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
await expect(page.locator('.sidebar-section')).toHaveCount(1);
await expect(page.locator('.sidebar-section')).toHaveText('Dairy Operations');
checks.push('Mobile navigation, backdrop dismissal, reduced motion and permission-filtered links / sections');
assert.deepEqual(errors, []);
fs.writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify({ checks, runtimeErrors: errors, fixture: 'Isolated representative data and module placeholder. No production writes.' }, null, 2));
console.log('PASS: Sidebar navigation, compact mode, persistence, profile actions, keyboard access, permissions, mobile swipe and both themes.');
console.log(`Screenshots: ${outDir}`);
await browser.close();
