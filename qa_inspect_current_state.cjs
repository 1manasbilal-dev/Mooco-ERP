const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[BROWSER CONSOLE ERROR]', msg.text());
  });
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

  console.log('Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Check login
  const ownerBtn = page.locator('text=Admin').first();
  if (await ownerBtn.isVisible()) {
    console.log('Logging in with Admin PIN 1234...');
    await ownerBtn.click();
    await page.waitForTimeout(400);
    for (const d of ['1', '2', '3', '4']) {
      await page.locator(`button:has-text("${d}")`).first().click();
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1500);
  }

  // Go to Bank & Cash
  console.log('\n--- Checking Bank & Cash ---');
  await page.goto('http://localhost:3000/bank-cash', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '03_bank_cash_initial.png') });
  const accountsText = await page.locator('div:has-text("Consolidated Total")').first().innerText().catch(() => '');
  console.log('Bank & Cash summary:', accountsText.replace(/\s+/g, ' '));

  // Go to Settings -> Financial
  console.log('\n--- Checking Settings ---');
  await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '04_settings_initial.png') });

  // Go to Suppliers
  console.log('\n--- Checking Suppliers ---');
  await page.goto('http://localhost:3000/suppliers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '05_suppliers_initial.png') });

  // Go to Items
  console.log('\n--- Checking Items ---');
  await page.goto('http://localhost:3000/items', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '06_items_initial.png') });

  // Go to Customers
  console.log('\n--- Checking Customers ---');
  await page.goto('http://localhost:3000/customers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '07_customers_initial.png') });

  // Go to Expenses
  console.log('\n--- Checking Expenses ---');
  await page.goto('http://localhost:3000/expenses', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '08_expenses_initial.png') });

  await browser.close();
  console.log('\nState inspection complete.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
