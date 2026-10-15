import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, today } from './fixtures/dashboard.mjs';

const outDir = path.resolve('screenshots/global-theme');
const flowsOnly = process.argv.includes('--flows-only');
fs.mkdirSync(outDir, { recursive: true });
const collections = ['recurringExpenses','bankTransactions','manualAccounts','journalEntries','categories','unitGroups','retailClosings','shiftSessions','dayClosings','businessDays','cashDrawers','cashHandovers','cashRemittances','cashVariances','shiftCashEvents','dailySupplyEntries'];
const data = {
  ...Object.fromEntries(collections.map(key => [key, []])), ...fixture,
  categories: ['Milk','Dairy','Materials'], unitGroups: [],
  accounts: fixture.accounts.map(account => ({ ...account, name: { cash:'Counter Cash', bank:'Business Bank', wallet:'Mobile Wallet', asset:'Equipment' }[account.id], is_active:true })),
  suppliers: fixture.suppliers.map(supplier => ({ ...supplier, type:'Milk Supplier', milk_type:'Buffalo', is_active:true })),
  customers: fixture.customers.map(customer => ({ ...customer, phone:'0300-1234567', address:'Lahore', is_active:true })),
  items: fixture.items.map(item => ({ ...item, units:[], variants:[], is_active:true })),
  productionBatches: [], activeShiftSession:{ ...fixture.activeShiftSession, id:'qa-shift', drawer_id:'qa-drawer', cashier_id:'qa-owner', opening_float:10000 },
  settings: {
    general:{companyName:'Mooco Dairy', address:'Lahore, Pakistan', phone:'0300-1234567', email:'', currencySymbol:'Rs', shifts:['Morning','Evening']},
    financial:{enabledPaymentModes:['Cash','Online','Credit'], visibleAccountIds:['cash','bank'], defaultCashAccountId:'cash', defaultDigitalAccountId:'bank'},
    sales:{invoicePrefix:'MOO-', defaultTaxRate:0, enableTax:false, invoiceFooter:'Thank you for your visit.'},
    inventory:{allowNegativeStock:false, lowStockThreshold:10, enableBatchTracking:false, customUnits:[]},
    production:{},
  }
};
const browser = await chromium.launch({ channel:'msedge', headless:true });
try {
  const context = await browser.newContext({ viewport:{width:1440,height:1000}, hasTouch:true });
  await context.addInitScript(data => {
    window.__globalFixture = data;
    if (!localStorage.getItem('app_theme')) localStorage.setItem('app_theme','light');
  }, data);
  // The real pages and global shell render, with business records isolated in this context.
  await context.route('**/context/DairyContext.tsx*', route => route.fulfill({ contentType:'application/javascript', body:`
    const noop=async()=>false;
    const data={...window.__globalFixture,sessionError:null,dataLoadError:null,hasPermission:()=>true,canPerform:()=>true,isDayLocked:()=>false,
      getBusinessDate:()=>${JSON.stringify(today)},getShiftTotals:()=>({expectedCash:10000,gross_sales:0,cash_sales:0,online_sales:0,credit_sales:0,cash_collections:0,cash_refunds:0,cash_expenses:0,cash_purchases:0,other_cash_in:0,other_cash_out:0,bills_count:0}),
      getDeleteAssessment:()=>({canDelete:false,relatedRecords:[]}),retryLoading:noop,refreshCashControl:noop};
    const value=new Proxy(data,{get:(target,key)=>key in target?target[key]:typeof key==='string'&&/^(add|update|delete|set|record|remove|safeDelete|reactivate|reorder|reset|clear|allocate|return|create|cancel|refresh|submit|accept|resolve|close|reopen|perform|start|open|login|switch|logout)/.test(key)?noop:undefined});
    export const DairyProvider=({children})=>children;export const useDairy=()=>value;` }));
  await context.route('**/lib/syncService.ts*', route => route.fulfill({ contentType:'application/javascript',body:`export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};` }));
  await context.route(/https:\/\/[^/]*\.supabase\.co\//,route=>route.abort());
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'));
  const errors=[];
  page.on('pageerror',error=>errors.push({url:page.url(),message:error.message}));
  const modules=['dashboard','purchase','allocation','production','pos','sales-history','cash-control','items','inventory','customers','suppliers','expenses','bank-cash','accounts','reports','settings'];
  const checks=[];
  const failures=[];
  for(const width of flowsOnly?[]:[1440,390,320]) {
    await page.setViewportSize({width,height:width===1440?1000:844});
    for(const mode of ['light','dark']) {
      await page.goto('http://127.0.0.1:3000/dashboard');
      await page.evaluate(mode=>{localStorage.setItem('app_theme',mode);document.documentElement.classList.toggle('dark',mode==='dark');},mode);
      for(const module of modules) {
        const count=errors.length;
        await page.goto(`http://127.0.0.1:3000/${module}`);
        const pane=page.locator(`[data-module="${module}"]`);
        await expect(pane).toBeVisible();
        await expect(pane.locator('[aria-busy="true"]')).toHaveCount(0,{timeout:30000});
        await page.waitForTimeout(450);
        await expect(pane.getByText('Connection needed to verify access',{exact:true})).toHaveCount(0);
        const metrics=await page.evaluate(()=>{const app=document.querySelector('.mooco-app');return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,appWidth:app?.scrollWidth??-1,background:app?getComputedStyle(app).backgroundImage:'none',errorScreen:app?'':document.body.innerText.slice(0,500),cardBlur:[...document.querySelectorAll('.overview-panel')].map(el=>getComputedStyle(el).backdropFilter)};});
        if(metrics.documentWidth>width||metrics.appWidth>width||metrics.appWidth<0)failures.push({module,width,mode,...metrics});
        if(errors.length>count)failures.push({module,width,mode,errors:errors.slice(count)});
        if(mode==='light'&&width!==320||mode==='dark'&&['purchase','customers','expenses','reports','settings'].includes(module)&&width!==320) {
          await page.screenshot({path:path.join(outDir,`${module}-${mode}-${width}.png`)});
        }
        checks.push({module,width,mode,documentWidth:metrics.documentWidth,canvasTint:metrics.background!=='none'});
        fs.writeFileSync(path.join(outDir,'checks.json'),JSON.stringify({checks,failures,runtimeErrors:errors},null,2));
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3000/purchase');
  const input=page.locator('[data-module="purchase"] input:not([type="hidden"]):visible').first();
  await input.focus();
  const focus=await input.evaluate(el=>({outline:getComputedStyle(el).outlineColor,border:getComputedStyle(el).borderColor}));
  assert.ok(focus.outline==='rgb(132, 204, 22)'||focus.border==='rgb(132, 204, 22)');
  await page.goto('http://127.0.0.1:3000/dashboard');
  await expect(page.locator('.overview-panel').first()).toBeVisible();
  assert.equal(await page.locator('.overview-panel').first().evaluate(el=>getComputedStyle(el).backdropFilter),'none');
  await page.getByRole('button',{name:'Quick search',exact:true}).click();
  await expect(page.getByPlaceholder(/Search pages/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3000/purchase');
  const volume=page.locator('[data-module="purchase"]').getByPlaceholder('0.0',{exact:true});
  await volume.fill('580');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Dashboard',exact:true}).click();
  await page.getByRole('heading',{name:'Business performance',exact:true}).waitFor();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Milk Collection',exact:true}).click();
  await expect(volume).toHaveValue('580');
  const flowChecks=['Actual milk-collection draft survives Dashboard switching'];
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await nav.getByRole('button',{name:'Sales & POS',exact:true}).click();
  await nav.getByRole('button',{name:'POS Terminal',exact:true}).click();
  const pos=page.locator('[data-module="pos"]');
  await pos.getByRole('button',{name:/Buffalo Milk/}).click();
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await expect(pos.getByText('1 item',{exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'Dashboard',exact:true}).click();
  await page.getByRole('heading',{name:'Business performance',exact:true}).waitFor();
  if(await nav.getByRole('button',{name:'POS Terminal',exact:true}).count()===0)await nav.getByRole('button',{name:'Sales & POS',exact:true}).click();
  await nav.getByRole('button',{name:'POS Terminal',exact:true}).click();
  await expect(pos.getByText('1 item',{exact:true})).toBeVisible();
  flowChecks.push('Actual POS cart survives Dashboard switching without creating a sale');
  fs.writeFileSync(path.join(outDir,flowsOnly?'flow-checks.json':'checks.json'),JSON.stringify({checks,flowChecks,failures,runtimeErrors:errors},null,2));
  assert.equal(failures.length,0,JSON.stringify(failures));
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({screenChecks:checks.length,flowChecks,failures,runtimeErrors:errors},null,2));
}finally{await browser.close();}
