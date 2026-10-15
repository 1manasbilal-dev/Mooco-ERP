import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/dashboard.mjs';

const outDir=path.resolve('screenshots/global-theme');
fs.mkdirSync(outDir,{recursive:true});
const data={...fixture,sessionError:null,dataLoadError:null,bankTransactions:[],manualAccounts:[],dailySupplyEntries:[],shiftSessions:[],accounts:fixture.accounts.map(account=>({...account,name:account.id}))};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.addInitScript(data=>{window.__reportFixture=data;localStorage.setItem('app_theme','dark');},data);
  await context.route('**/context/DairyContext.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const DairyProvider=({children})=>children;export const useDairy=()=>({...window.__reportFixture,hasPermission:()=>true,canPerform:()=>true,retryLoading:async()=>{},setIsUserSwitcherOpen:()=>{},logoutUser:()=>{}});`}));
  await context.route('**/lib/syncService.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};`}));
  await context.route(/https:\/\/[^/]*\.supabase\.co\//,route=>route.abort());
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'));
  const errors=[];
  const pdfRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/(?:jspdf|html2canvas)/.test(request.url()))pdfRequests.push(request.url());});
  const checks=[];
  for(const [report,id,filename] of [
    ['day_book','daybook-a4-preview','daybook.pdf'],
    ['sales_by_customer','customer-balance-a4-preview','customer-balances.pdf']
  ]) {
    await page.goto(`http://127.0.0.1:3000/reports?tab=${report}&preset=today`);
    await expect(page.locator('.reports-workspace')).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0,{timeout:30000});
    if(report==='day_book') assert.equal(pdfRequests.length,0,'PDF libraries must not load with Reports');
    await page.screenshot({path:path.join(outDir,`${report}-dark-1440.png`)});
    await page.getByRole('button',{name:/^Print(?: Report)?$/}).click();
    const preview=page.locator(`#${id}`);
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('background-color','rgb(255, 255, 255)');
    await expect(preview).toHaveCSS('color','rgb(15, 23, 42)');
    if(report==='day_book') {
      await expect(preview.getByText('5 Invoices',{exact:true})).toBeVisible();
      await expect(preview.getByText(/NaN/)).toHaveCount(0);
      const financialText=preview.locator('[class*="text-emerald-"]').first();
      await expect(financialText).toHaveCSS('color','rgb(22, 101, 52)');
    }
    await preview.screenshot({path:path.join(outDir,`${report}-paper-dark-mode.png`)});
    const downloadPromise=page.waitForEvent('download',{timeout:60000});
    await page.getByRole('button',{name:'Download PDF',exact:true}).last().click();
    const download=await downloadPromise;
    const output=path.join(outDir,filename);
    await download.saveAs(output);
    const bytes=fs.readFileSync(output);
    assert.equal(bytes.subarray(0,4).toString(),'%PDF');
    assert.ok(bytes.length>10000);
    checks.push({report,pdfBytes:bytes.length,theme:'dark',paper:'white'});
  }
  assert.ok(pdfRequests.some(url=>url.includes('jspdf'))&&pdfRequests.some(url=>url.includes('html2canvas')));
  await page.setViewportSize({width:320,height:568});
  await page.goto('http://127.0.0.1:3000/reports');
  await page.getByRole('button',{name:'Choose report'}).click();
  const categories=page.getByRole('complementary',{name:'Report categories'});
  await expect(categories).toBeVisible();
  const bounds=await categories.boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320&&bounds.y+bounds.height<=568);
  await categories.getByRole('button',{name:'Low Stock Alerts'}).click();
  await expect(categories).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Low Stock Alerts',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(outDir,'reports-dark-320.png')});
  checks.push({mobileReportMenu:'320px bounds, selection and closing verified'});
  assert.equal(errors.length,0,errors.join('\n'));
  fs.writeFileSync(path.join(outDir,'reports-checks.json'),JSON.stringify({checks,pdfLoadedOnExport:true,runtimeErrors:errors},null,2));
  console.log(JSON.stringify({checks,runtimeErrors:errors},null,2));
}finally{await browser.close();}
