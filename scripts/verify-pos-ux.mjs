import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fixture, today } from './fixtures/dashboard.mjs';

const output = path.join(os.tmpdir(), 'mooco-pos-ux');
fs.mkdirSync(output, { recursive: true });
const compile = (file, imports = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => imports[name] });
  return exports;
};
const { calculateQuickEntry: calculate, stepWholeQuantity } = compile('lib/posQuickEntry.ts', { './formatters': compile('lib/formatters.ts') });
assert.equal(stepWholeQuantity(1,1),2);assert.equal(stepWholeQuantity(2,-1),1);
assert.equal(stepWholeQuantity(.435,1),1);assert.equal(stepWholeQuantity(1.5,-1),1);
assert.equal(stepWholeQuantity(1,-1,1),1);
assert.equal(calculate('100', 'amount', 230, false).qty, .435);
assert.equal(calculate('100', 'amount', 230, false).total, 100);
assert.equal(calculate('1.234', 'qty', 230, false).total, 283.82);
assert.equal(calculate('2', 'qty', 80, true).total, 160);
for (const value of ['', '0', '-2', 'NaN', '123junk', 'Infinity', '1e3']) assert.ok(calculate(value, 'amount', 230, false).error);
assert.ok(calculate('1.5', 'qty', 80, true).error);
assert.ok(calculate('100', 'amount', 0, false).error);
assert.ok(calculate('.01', 'amount', 10000, false).error);

const empty = ['recurringExpenses','bankTransactions','manualAccounts','journalEntries','unitGroups','retailClosings','shiftSessions','dayClosings','businessDays','cashDrawers','cashHandovers','cashRemittances','cashVariances','shiftCashEvents','dailySupplyEntries'];
const bottle = { id:'bottle-small', name:'250ml Bottle', selling_price:80, quantity_in_base_unit:.25 };
const largeBottle = { id:'bottle-large', name:'500ml Bottle', selling_price:150, quantity_in_base_unit:.5 };
const data = {
  ...Object.fromEntries(empty.map(key => [key, []])), ...fixture,
  categories:['Milk','Dairy'], unitGroups:[], productionBatches:[],
  items:[...fixture.items.map(item => ({ ...item, variants:[], units:[], is_active:true, ...(item.id==='milk-c'?{quick_amounts:[50,125,275]}:{}) })),
    {id:'bottle',name:'Bottled Milk',category:['Dairy'],item_type:['Sale product'],unit:'L',selling_price:300,isActive:true,allow_loose_sale:false,variants:[bottle,largeBottle]},
    {id:'no-rate',name:'Unpriced product',category:['Dairy'],item_type:['Sale product'],unit:'kg',selling_price:0,isActive:true}],
  inventory:[...fixture.inventory.map(item => ({...item,quantity:item.item_id==='milk-b'?3.5:item.quantity})),
    {id:'bottle-stock',item_id:'bottle',quantity:0,variant_stocks:{'bottle-small':10,'bottle-large':5}},
    {id:'no-rate-stock',item_id:'no-rate',quantity:5}],
  accounts:fixture.accounts.map(account=>({...account,name:account.id==='cash'?'Counter Cash':'Business Bank',is_active:true})),
  activeShiftSession:{...fixture.activeShiftSession,id:'qa-shift',drawer_id:'qa-drawer',cashier_id:'qa-owner',opening_float:10000},
  settings:{general:{companyName:'Mooco Dairy',currencySymbol:'Rs',shifts:['Morning','Evening']},
    financial:{enabledPaymentModes:['Cash','Online','Credit'],visibleAccountIds:['cash','bank'],defaultCashAccountId:'cash',defaultDigitalAccountId:'bank'},
    sales:{invoicePrefix:'MOO-',defaultTaxRate:0,enableTax:false},inventory:{allowNegativeStock:false,lowStockThreshold:10,customUnits:[]},production:{}}
};
const browser = await chromium.launch({channel:'msedge',headless:true});
const checks = ['Strict numeric validation and exact rupee / quantity calculations'];
const errors = [];
let diagnosticPage;
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(data => {window.__posFixture=data;window.__submittedSales=[];window.__settingsUpdates=[];
    const saved=localStorage.getItem('qa_pos_sales_settings');if(saved)data.settings.sales={...data.settings.sales,...JSON.parse(saved)};
    localStorage.setItem('app_theme','light');}, data);
  // Real UI; sales are captured locally, and live business services are blocked.
  await context.route('**/context/DairyContext.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`
    import React from '/node_modules/.vite/deps/react.js';
    const listeners=new Set();let version=0;
    const subscribe=callback=>{listeners.add(callback);return ()=>listeners.delete(callback);};
    const noop=async()=>false;
    const data={...window.__posFixture,sessionError:null,dataLoadError:null,hasPermission:()=>true,canPerform:()=>true,isDayLocked:()=>false,
      getBusinessDate:()=>${JSON.stringify(today)},getShiftTotals:()=>({expectedCash:10000,gross_sales:0,cash_sales:0,online_sales:0,credit_sales:0,cash_collections:0,cash_refunds:0,cash_expenses:0,cash_purchases:0,other_cash_in:0,other_cash_out:0,bills_count:0}),
      addSale:async(...args)=>{window.__submittedSales.push(args);return true;},getDeleteAssessment:()=>({canDelete:false,relatedRecords:[]}),retryLoading:noop};
    data.updateSettings=async patch=>{
      for(const [key,group] of Object.entries(patch))data.settings[key]={...data.settings[key],...group};
      window.__posFixture.settings=data.settings;window.__settingsUpdates.push(patch);
      localStorage.setItem('qa_pos_sales_settings',JSON.stringify(data.settings.sales));version++;listeners.forEach(callback=>callback());
    };
    const value=new Proxy(data,{get:(target,key)=>key in target?target[key]:typeof key==='string'&&/^(add|update|delete|set|record|remove|safeDelete|reactivate|reorder|reset|clear|allocate|return|create|cancel|refresh|submit|accept|resolve|close|reopen|perform|start|open|login|switch|logout)/.test(key)?noop:undefined});
    export const DairyProvider=({children})=>children;export const useDairy=()=>{React.useSyncExternalStore(subscribe,()=>version);return value;};` }));
  await context.route('**/lib/syncService.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};`}));
  await context.route(/https:\/\/[^/]*\.supabase\.co\//,route=>route.abort());
  const page = await context.newPage();
  diagnosticPage=page;
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3000/pos');
  const pos=page.locator('[data-module="pos"]');
  const dialog=page.getByRole('dialog');
  const search=pos.getByRole('textbox',{name:'Search products',exact:true});
  const open = async name => {await search.fill('');await pos.getByRole('button',{name:`Select ${name}`,exact:true}).click();await expect(dialog).toBeVisible();};
  await expect(search).toBeVisible({timeout:30000});
  await expect(pos.getByRole('button',{name:'Enable Voice',exact:true})).toHaveCount(0);
  await expect(pos.locator('.pos-counter-toolbar')).toHaveCount(0);
  await page.keyboard.press('F2');await expect(search).toBeFocused();
  await search.fill('Buffalo');await search.press('Enter');
  await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toBeFocused();
  await dialog.locator('.pos-quick-cash-presets button').filter({hasText:/^Rs\s*100\b/}).click();
  await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('100');
  await expect(dialog.locator('.pos-quick-qty-badge')).toContainText('0.435');
  await expect(dialog.locator('.pos-quick-conversion')).toContainText('0.435 L');
  await page.keyboard.press('F9');await page.keyboard.press('F8');
  assert.equal(await page.evaluate(()=>window.__submittedSales.length),0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Add to cart'}).focus();
  await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Close quick entry'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Add to cart'})).toBeFocused();
  await page.keyboard.press('Enter');await expect(dialog).toHaveCount(0);await expect(search).toBeFocused();
  assert.equal(await page.locator('.mooco-app[inert]').count(),0);
  await open('Buffalo Milk');
  await expect(dialog.getByRole('button',{name:/By quantity/})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:/By amount/})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Increase quick quantity'}).click();
  await expect(dialog.locator('.pos-quick-conversion')).toContainText('Rs 230');
  await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('460');
  await expect(dialog.locator('.pos-quick-qty-badge')).toContainText('2');
  await dialog.getByRole('button',{name:'Increase quick quantity'}).click();
  await expect(dialog.locator('.pos-quick-conversion')).toContainText('Rs 230');
  await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('690');
  await expect(dialog.locator('.pos-quick-qty-badge')).toContainText('3');
  await dialog.getByRole('button',{name:'Decrease quick quantity'}).click();
  await expect(dialog.locator('.pos-quick-conversion')).toContainText('Rs 230');
  await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('460');
  await expect(dialog.locator('.pos-quick-qty-badge')).toContainText('2');
  await dialog.getByRole('button',{name:'Add to cart'}).click();
  const desktopRow=pos.locator('tbody tr').filter({hasText:'Buffalo Milk'});
  await expect(desktopRow.locator('input').last()).toHaveValue('560');
  checks.push('F2 → search → Enter → exact amount; trapped focus, F8/F9 isolation and search restored', 'Unified quick entry directly steps quantity without mode switch; preserves Rs 560 and per-unit stock deductions');
  await open('Buffalo Milk');
  await dialog.getByRole('button',{name:'Increase quick quantity'}).click();
  await expect(dialog.getByRole('button',{name:'Add to cart'})).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText('1.065');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  checks.push('Stock remaining includes all cart quantities; overselling disabled and Escape restores focus');
  await open('Bottled Milk');await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('80');
  await expect(dialog.locator('.pos-quick-qty-badge')).toContainText('1');
  await expect(dialog.getByRole('button',{name:/By amount/})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Increase quick quantity'}).click();
  await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('160');
  await expect(dialog.locator('.pos-quick-qty-badge')).toContainText('2');
  await dialog.getByRole('combobox').selectOption('bottle-large');await expect(dialog.locator('.pos-quick-footer')).toContainText('Rs 300');
  await dialog.getByRole('combobox').selectOption('bottle-small');await dialog.getByRole('button',{name:'Add to cart'}).click();
  await open('Unpriced product');await expect(dialog.getByRole('status')).toContainText('selling rate');
  await expect(dialog.getByRole('button',{name:'Add to cart'})).toBeDisabled();await page.keyboard.press('Escape');
  checks.push('Pack variants retain quantity, use whole counts and correct unit stock; invalid rate blocked');
  await pos.getByRole('button',{name:'Complete sale'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__submittedSales.length)).toBe(1);
  const sale=await page.evaluate(()=>window.__submittedSales[0]);
  assert.equal(sale[2],720);assert.equal(sale[4],720);assert.equal(sale[6],720);
  assert.equal(sale[0][0].customTotal,560);assert.equal(sale[0][0].qty,2.435);assert.equal(sale[0][0].stockDeduction,1);
  assert.equal(sale[0][1].qty,2);assert.equal(sale[0][1].stockDeduction,.25);
  checks.push('Isolated checkout records exact totals, three-decimal quantities and unit deductions once');

  // Fresh page for responsive checks, with no live records changed.
  await page.goto('http://127.0.0.1:3000/pos');
  await page.evaluate(()=>{window.__posFixture.settings.inventory.allowNegativeStock=true;});
  await open('Buffalo Milk');
  await dialog.getByRole('textbox',{name:'Sale amount in rupees'}).fill('10000');
  await expect(dialog.getByRole('button',{name:'Add to cart'})).toBeEnabled();
  await page.evaluate(()=>{window.__posFixture.settings.inventory.allowNegativeStock=false;});
  await dialog.getByRole('button',{name:'Add to cart'}).click();
  await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText('Could not add');
  assert.equal(await page.evaluate(()=>window.__submittedSales.length),0);
  await page.keyboard.press('Escape');
  checks.push('Final stock refusal keeps entry open and shows an error without a success confirmation');
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:width===1440?1000:844});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
      await page.waitForTimeout(350);
      await expect(search).toBeVisible();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(output,`pos-${theme}-${width}.png`)});
      await open('Cow Milk');
      if (width<768) assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'dialog');
      await expect(dialog.locator('.pos-quick-cash-presets button')).toHaveCount(3);
      await expect(dialog.locator('.pos-quick-cash-presets')).toContainText('125');
      await expect(dialog.getByRole('button',{name:'Use number keypad'})).toHaveCount(0);
      await expect(dialog.getByText('Ready to add. Enter confirms, Esc closes.')).toHaveCount(0);
      await dialog.getByRole('button',{name:'Clear',exact:true}).click();
      await dialog.getByRole('textbox',{name:'Sale amount in rupees'}).fill('100');
      await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('100');
      await dialog.getByRole('textbox',{name:'Sale amount in rupees'}).press('Backspace');
      await expect(dialog.getByRole('textbox',{name:'Sale amount in rupees'})).toHaveValue('10');
      const metrics=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();const button=el.querySelector('[type="submit"]').getBoundingClientRect();return {left:b.left,right:b.right,bottom:b.bottom,top:b.top,buttonBottom:button.bottom,width:innerWidth,height:innerHeight};});
      assert.ok(metrics.left>=0 && metrics.right<=width+1 && metrics.top>=0 && metrics.bottom<=metrics.height+1 && metrics.buttonBottom<=metrics.height);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(output,`entry-${theme}-${width}.png`)});
      await dialog.getByRole('button',{name:'Close quick entry'}).click();
    }
  }
  checks.push('Eight light / dark layouts at 1440, 768, 390 and 320 px; direct input, footer visibility and no horizontal overflow');
  await page.setViewportSize({width:390,height:480});
  await open('Cow Milk');
  await expect(dialog.getByRole('button',{name:'Add to cart'})).toBeInViewport();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),'none');
  await dialog.getByRole('button',{name:'Close quick entry'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.keyboard.press('F4');
  await expect(pos.getByText('Your Cart is Empty',{exact:true})).toBeVisible();
  await page.keyboard.press('F2');await expect(search).toBeVisible();
  await open('Cow Milk');await dialog.getByRole('button',{name:'Add to cart'}).click();
  await pos.getByRole('button',{name:/View Cart/}).click();
  await expect(pos.locator('.pos-mobile-cart-row')).toBeVisible();
  await expect(pos.getByRole('button',{name:'Complete sale'})).toBeInViewport();
  await page.waitForTimeout(350);
  await page.screenshot({path:path.join(output,'cart-mobile.png')});
  const row=pos.locator('.pos-mobile-cart-row');
  await row.getByRole('spinbutton',{name:'Cow Milk quantity'}).fill('.5');
  await row.getByTitle('Increase',{exact:true}).click();
  await expect(row.getByRole('spinbutton',{name:'Cow Milk quantity'})).toHaveValue('1');
  await row.getByTitle('Increase',{exact:true}).click();
  await expect(row.getByRole('spinbutton',{name:'Cow Milk quantity'})).toHaveValue('2');
  await row.getByTitle('Decrease',{exact:true}).click();
  await row.getByRole('button',{name:'Edit Cow Milk'}).click();
  await page.getByRole('textbox',{name:'Edited quantity'}).fill('1.5');
  await page.getByRole('button',{name:'Increase edited quantity'}).click();
  await expect(page.getByRole('textbox',{name:'Edited quantity'})).toHaveValue('2');
  await page.getByRole('button',{name:'Decrease edited quantity'}).click();
  await expect(page.getByRole('textbox',{name:'Edited quantity'})).toHaveValue('1');
  await page.keyboard.press('Escape');
  checks.push('Quick-entry, cart and edit-dialog steppers use whole counts; amount precision remains intact');
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:844});
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
      await page.waitForTimeout(350);
      const bounds=await pos.locator('.pos-checkout-panel').boundingBox();
      if(width<1024){assert.equal(bounds.x,0);assert.equal(bounds.y,0);assert.equal(bounds.width,width);assert.equal(bounds.height,844);}
      else { const workspaceWidth=await pos.locator('.pos-checkout-panel').evaluate(el=>el.parentElement.getBoundingClientRect().width);assert.ok(Math.abs(bounds.width-workspaceWidth)<1); }
      await expect(pos.locator('.pos-catalog-panel')).toBeHidden();
      await expect(pos.getByRole('button',{name:'Products',exact:true}).filter({visible:true})).toBeVisible();
      if(width<768) {
        const alignment=await row.evaluate(el=>[...el.children].map(child=>{const b=child.getBoundingClientRect();return b.y+b.height/2;}));
        assert.ok(Math.max(...alignment)-Math.min(...alignment)<3);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(output,`cart-${theme}-${width}.png`)});
    }
  }
  checks.push('Full-screen mobile / tablet cart, full-width desktop cart and one horizontal item row in eight light / dark layouts');
  checks.push('Short-height bottom sheet, reduced motion, empty-cart navigation and mobile cart checkout');
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  const customer=pos.getByRole('textbox',{name:'Search or select customer'});
  await page.keyboard.press('F4');await expect(customer).toBeFocused();
  await customer.fill('Al Rehman');await customer.press('Enter');
  await expect(customer).toHaveValue('Al Rehman Sweets');
  await pos.getByRole('textbox',{name:'Customer payment received'}).filter({visible:true}).fill('50');
  await pos.getByRole('button',{name:'Complete sale'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__submittedSales.length)).toBe(1);
  const creditSale=await page.evaluate(()=>window.__submittedSales[0]);
  assert.equal(creditSale[4],200);assert.equal(creditSale[6],50);assert.equal(creditSale[1].id,'c1');
  checks.push('F4 customer search and a partially paid customer sale preserve the exact payment and customer ID');
  await page.goto('http://127.0.0.1:3000/pos');
  await search.fill('Buffalo');await pos.locator('.pos-product-categories').getByRole('button',{name:/^Milk/}).click();
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await page.locator('.mooco-sidebar').getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.locator('[data-module="settings"]');
  await settings.getByRole('button',{name:/Sales & Invoicing/}).filter({visible:true}).click();
  const searchToggle=settings.getByRole('switch',{name:'Show POS Search Bar'});
  const categoriesToggle=settings.getByRole('switch',{name:'Show POS Product Categories'});
  await expect(searchToggle).toBeChecked();await expect(categoriesToggle).toBeChecked();
  await searchToggle.click();await expect(searchToggle).not.toBeChecked();await expect(categoriesToggle).toBeChecked();
  await categoriesToggle.click();await expect(categoriesToggle).not.toBeChecked();
  if(!await nav.getByRole('button',{name:'POS Terminal',exact:true}).count())await nav.getByRole('button',{name:'Sales & POS',exact:true}).click();
  await nav.getByRole('button',{name:'POS Terminal',exact:true}).click();
  await expect(search).toHaveCount(0);await expect(pos.locator('.pos-product-categories')).toHaveCount(0);
  await expect(pos.locator('[data-pos-product]')).toHaveCount(5);
  await page.keyboard.press('F2');await expect(pos.locator('[data-pos-product]').first()).toBeFocused();
  await page.reload();await expect(search).toHaveCount(0);await expect(pos.locator('.pos-product-categories')).toHaveCount(0);
  await page.locator('.mooco-sidebar').getByRole('button',{name:'Settings',exact:true}).click();
  await settings.getByRole('button',{name:/Sales & Invoicing/}).filter({visible:true}).click();
  await searchToggle.click();await categoriesToggle.click();
  await nav.getByRole('button',{name:'POS Terminal',exact:true}).click();
  await expect(search).toBeVisible();await expect(search).toHaveValue('');
  await expect(pos.locator('.pos-product-categories')).toBeVisible();
  await pos.getByRole('button',{name:'Expand cart',exact:true}).click();
  await expect(pos.locator('.pos-catalog-panel')).toBeHidden();
  await pos.getByRole('button',{name:'Products',exact:true}).filter({visible:true}).click();
  await expect(search).toBeVisible();
  checks.push('Settings independently hide/show search and categories, survive reload, clear hidden filters and preserve F2 and cart navigation');
  assert.equal(errors.length,0,JSON.stringify(errors));
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,runtimeErrors:errors},null,2));
  console.log(JSON.stringify({checks,runtimeErrors:errors,previews:output},null,2));
} catch(error) {
  console.error(JSON.stringify({runtimeErrors:errors,page:await diagnosticPage?.locator('body').innerText().catch(()=>'' )},null,2));
  if(diagnosticPage)await diagnosticPage.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  throw error;
} finally { await browser.close(); }
