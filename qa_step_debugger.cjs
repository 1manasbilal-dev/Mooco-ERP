const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/items', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Check login if needed
  const adminTile = page.locator('button, div[role="button"], div[class*="cursor-pointer"]').filter({ hasText: /Admin/i }).first();
  if (await adminTile.isVisible()) {
    await adminTile.click();
    await page.waitForTimeout(300);
    for (const d of ['1', '2', '3', '4']) {
      await page.locator(`button:has-text("${d}")`).first().click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1500);
  }

  await page.goto('http://localhost:3000/items', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Open Add Product
  await page.locator('button:has-text("Add Product")').click();
  await page.waitForTimeout(600);

  // Inspect selects in drawer
  const selects = await page.locator('div[class*="fixed"] select').all();
  console.log('Select count in drawer:', selects.length);

  for (let i = 0; i < selects.length; i++) {
    const opts = await selects[i].locator('option').allInnerTexts();
    console.log(`Select #${i} options:`, opts);
  }

  // Inspect buttons in drawer
  const buttons = await page.locator('div[class*="fixed"] button').allInnerTexts();
  console.log('Drawer buttons:', buttons.map(b => b.replace(/\s+/g, ' ')).filter(Boolean).slice(0, 20));

  await browser.close();
})().catch(console.error);
