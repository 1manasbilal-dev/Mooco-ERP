const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  console.log('Connecting to browser...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

  console.log('Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log('Page title:', await page.title());
  await page.screenshot({ path: path.join(screenshotDir, '01_initial_load.png') });

  // Check if lock screen or user switcher is shown
  const bodyText = await page.innerText('body');
  console.log('Body preview:', bodyText.slice(0, 300).replace(/\n+/g, ' '));

  // Find Admin tile / button
  const adminTile = page.locator('div, button').filter({ hasText: /^Admin$/i }).first();
  const ownerTile = page.locator('text=Admin').first();
  
  // Let's inspect what user tiles are present
  const tiles = await page.locator('div[class*="cursor-pointer"], button').allInnerTexts();
  console.log('Tiles found count:', tiles.length);

  // Click on Admin
  const adminLocator = page.locator('text=Admin').first();
  if (await adminLocator.isVisible()) {
    console.log('Admin text visible, clicking...');
    await adminLocator.click();
    await page.waitForTimeout(500);

    // Check for PIN entry
    for (const d of ['1', '2', '3', '4']) {
      const pinKey = page.locator(`button:has-text("${d}")`).first();
      if (await pinKey.isVisible()) {
        await pinKey.click();
        await page.waitForTimeout(150);
      }
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, '02_after_login.png') });
  }

  console.log('Current URL:', page.url());
  const header = await page.locator('header').innerText().catch(() => 'no header');
  console.log('Header text:', header.replace(/\s+/g, ' '));

  await browser.close();
  console.log('Finished check.');
})().catch(err => {
  console.error('Error in check script:', err);
  process.exit(1);
});
