import { fixture, sales, today } from './fixtures/dashboard.mjs';
import { chromium, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';

const root = process.cwd();
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/dashboardAnalytics.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Intl });
const { businessDate, getDashboardPeriod, percentageChange, reportingHour, reportingHalfHour } = exports;
assert.equal(businessDate('2026-09-30T20:05:00Z'), '2026-10-01');
assert.equal(businessDate('2026-09-30'), '2026-09-30');
assert.equal(reportingHour('2026-09-30T20:05:00Z'), 1);
assert.equal(reportingHour('2026-10-01'), 12);
assert.equal(reportingHalfHour('2026-09-30T19:29:59Z'), 0);
assert.equal(reportingHalfHour('2026-09-30T19:30:00Z'), 1);
assert.equal(reportingHalfHour('2026-10-01T23:59:59+05:00'), 47);
assert.equal(reportingHalfHour('2026-10-01'), 24);
assert.equal(percentageChange(100, 0), null);
assert.equal(percentageChange(120, 100), 20);
const range = getDashboardPeriod('7days', new Date('2026-10-01T05:00:00Z'));
assert.equal(range.start, '2026-09-25'); assert.equal(range.previousStart, '2026-09-18'); assert.equal(range.previousEnd, '2026-09-24');
const month = getDashboardPeriod('month', new Date('2026-03-31T05:00:00Z'));
assert.equal(month.days, 31); assert.equal(month.previousStart, '2026-01-29'); assert.equal(month.previousEnd, '2026-02-28');
const yday = getDashboardPeriod('yesterday', new Date('2026-10-01T05:00:00Z'));
assert.equal(yday.start, '2026-09-30'); assert.equal(yday.previousEnd, '2026-09-29');
console.log('PASS: Pakistan date boundaries, equal-period comparisons and zero-baseline changes.');

const performanceExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/dashboardPerformanceData.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
 exports: performanceExports, Date, Intl, require: name => { assert.equal(name, './dashboardAnalytics'); return exports; },
});
const period = getDashboardPeriod('today', new Date('2026-10-01T05:00:00Z'));
const sample = [
 { date:'2026-09-30T19:29:59Z', value:100 },
 { date:'2026-09-30T19:30:00Z', value:200 },
 { date:'2026-10-01T23:59:59+05:00', value:300 },
 { date:'2026-09-30T00:30:00+05:00', value:80 },
 { date:'2026-10-01', value:40 },
];
const inputs = {
 sales:sample.map(({date,value})=>({date,status:'Completed',total:value,items:[{name:'Milk',total:value,qty:1,price:value}]})),
 purchases:sample.map(({date,value})=>({date,status:'Completed',quantity:value})),
 expenses:sample.map(({date,value})=>({date,amount:value})),
 selectedProduct:'Milk', period, range:'today',
};
inputs.sales.push({...inputs.sales[0],status:'Returned',total:999});
inputs.purchases.push({...inputs.purchases[0],status:'Cancelled',quantity:999});
for (const metric of ['sales','milk','expenses','products']) {
 const series = performanceExports.buildPerformanceSeries({...inputs,metric});
 assert.equal(series.length,48);
 assert.equal(series[0].label,'00:00'); assert.equal(series[1].label,'00:30'); assert.equal(series[47].label,'23:30');
 assert.equal(series[0].current,100); assert.equal(series[1].current,200);
 assert.equal(series[24].current,40); assert.equal(series[47].current,300); assert.equal(series[1].previous,80);
 assert.equal(series.reduce((total,row)=>total+row.current,0),640);
 const daily = performanceExports.buildPerformanceSeries({...inputs,metric,period:range,range:'7days'});
 assert.equal(daily.length,7); assert.equal(daily[6].current,640); assert.equal(daily[5].current,80);
}
console.log('PASS: 48 half-hour buckets for all four metrics, midnight/30-minute boundaries, previous series and unchanged multi-day totals.');

const outDir=path.join(root,'screenshots','dashboard-redesign'); fs.mkdirSync(outDir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,timezoneId:'Asia/Karachi',acceptDownloads:true,hasTouch:true});
await context.addInitScript(data=>{window.__dashboardFixture=data;localStorage.setItem('app_theme','light');localStorage.setItem('app_sidebar_auto_collapse','false');},fixture);
// Replace only the context in this isolated browser. Production code and the database are never seeded or changed.
await context.route('**/context/DairyContext.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const DairyProvider=({children})=>children; export const useDairy=()=>({...window.__dashboardFixture,hasPermission:()=>true,canPerform:()=>true,setIsUserSwitcherOpen:()=>{},logoutUser:()=>{},retryLoading:async()=>{window.__refreshCount=(window.__refreshCount||0)+1;}});`}));
await context.route('**/lib/syncService.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};`}));
await context.route(/https:\/\/[^/]*\.supabase\.co\//,route=>route.abort());
const page=await context.newPage();
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'));
await page.goto('http://127.0.0.1:3000/dashboard');
await expect(page.getByRole('heading',{name:'Business performance',exact:true})).toBeVisible({timeout:30000});
await expect(page.locator('.overview-kpi.featured > strong')).toHaveText('Rs 128,450');
await expect(page.locator('.stock-display strong')).toHaveText('235 L');
await expect(page.locator('.overview-cash-total strong')).toHaveText('Rs 388,950');
await expect(page.locator('.overview-kpis > :nth-child(2) > strong')).toHaveText('580 L');
await expect(page.locator('.overview-kpis > :nth-child(3) > strong')).toHaveText('Rs 17,700');
await expect(page.locator('.surplus-kpi > strong')).toHaveText('Rs 18,750');
await expect(page.getByText('Swipe to explore',{exact:true})).toHaveCount(0);
await expect(page.locator('.overview-swipe-pagination')).toHaveCount(0);
await expect(page.getByRole('button',{name:'View stock',exact:true})).toHaveCount(0);
await expect(page.locator('.stock-panel .stock-actions')).toHaveCount(0);
await expect(page.locator('.stock-panel').getByRole('button',{name:'Allocate milk',exact:true})).toHaveCount(0);
await expect(page.locator('.performance-note')).toHaveText('Pakistan time · 30-minute intervals');
await page.waitForTimeout(500);
await page.screenshot({path:path.join(outDir,'desktop-light.png'),fullPage:true});
const checks=[];
async function overflow(width,height) {
 await page.setViewportSize({width,height});
 await page.waitForTimeout(250);
 const result=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,contentWidth:document.querySelector('.mooco-overview').scrollWidth,contentClient:document.querySelector('.mooco-overview').clientWidth}));
 assert.equal(result.documentWidth,result.width,`Document overflow at ${width}px`);
 if(result.contentWidth>result.contentClient+1) { console.log(await page.evaluate(()=>{const parent=document.querySelector('.mooco-overview').getBoundingClientRect();return [...document.querySelectorAll('.mooco-overview *')].map(el=>({tag:el.tagName,cls:el.getAttribute('class'),rect:el.getBoundingClientRect().toJSON()})).filter(x=>x.rect.width>0 && (x.rect.right>parent.right+1 || x.rect.left<parent.left-1)).slice(0,20)})); await page.screenshot({path:path.join(outDir,'overflow.png'),fullPage:true}); }
 assert.ok(result.contentWidth<=result.contentClient+1,`Dashboard overflow at ${width}px: ${JSON.stringify(result)}`);
 checks.push(result);
}
await page.getByRole('button',{name:'7 days',exact:true}).click();
const weekly=sales.filter(s=>s.status!=='Returned'&&businessDate(s.date)>='2026-09-25'&&businessDate(s.date)<=today).reduce((sum,s)=>sum+s.total,0);
await expect(page.locator('.overview-kpi.featured > strong')).toHaveText(`Rs ${weekly.toLocaleString('en-PK')}`);
await expect(page.locator('.stock-display strong')).toHaveText('235 L');
await expect(page.locator('.performance-previous span')).toHaveText('Previous 7 days');
await expect(page.locator('.performance-note')).toHaveText('Daily totals · Pakistan time');
await page.getByRole('button',{name:'Products',exact:true}).click();
await expect(page.getByRole('combobox',{name:'Product to chart'})).toBeVisible();
await page.getByRole('combobox',{name:'Product to chart'}).selectOption({label:'Desi Ghee'});
await expect(page.locator('.performance-totals > div:first-child > span')).toHaveText('Desi Ghee');
await page.getByRole('button',{name:'Milk intake',exact:true}).click();
await expect(page.locator('.performance-totals > div:first-child > span')).toHaveText('Milk collected');
await page.getByRole('button',{name:'Today',exact:true}).click();
await page.getByRole('button',{name:'Sales',exact:true}).click();
await page.getByRole('button',{name:'Customize',exact:true}).click();
await page.getByRole('checkbox',{name:'Best sellers',exact:true}).uncheck();
await expect(page.locator('.products-panel')).toHaveCount(0);
await page.keyboard.press('Escape');
await page.reload(); await expect(page.getByRole('heading',{name:'Business performance'})).toBeVisible();
await expect(page.locator('.products-panel')).toHaveCount(0);
await page.getByRole('button',{name:'Customize',exact:true}).click();
await page.getByRole('checkbox',{name:'Best sellers',exact:true}).check();
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Refresh dashboard',exact:true}).click();
assert.equal(await page.evaluate(()=>window.__refreshCount),1);
const downloadPromise=page.waitForEvent('download');
await page.getByRole('button',{name:'Export overview',exact:true}).click();
const download=await downloadPromise; const csvPath=path.join(outDir,'overview-test.csv'); await download.saveAs(csvPath);
const csv=fs.readFileSync(csvPath,'utf8'); assert.ok(csv.includes('128450')); assert.ok(csv.includes('Current balance'));
await page.locator('.overview-kpis > :nth-child(2)').click();
await expect(page.getByRole('heading',{name:'Milk Procurement Breakdown',exact:true})).toBeVisible();
await page.keyboard.press('Tab');
assert.ok(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));
await page.keyboard.press('Escape');
await expect(page.locator('.overview-kpis > :nth-child(2)')).toBeFocused();
for(const [w,h] of [[1920,1080],[1440,1000],[1024,900],[768,1024],[640,900],[430,932],[390,844],[360,800],[320,700]]) await overflow(w,h);
await page.setViewportSize({width:390,height:844});
await expect(page.locator('.overview-mobile-actions')).toBeVisible();
// Actual touch input checks native momentum scrolling and the directional view gestures.
const touch=await context.newCDPSession(page);
async function touchGesture(locator, direction, vertical=false) {
 await locator.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 await page.waitForTimeout(150);
 const box=await locator.boundingBox(); assert.ok(box);
 const viewport=page.viewportSize();
 const visibleTop=Math.max(90,box.y+8), visibleBottom=Math.min(viewport.height-115,box.y+box.height-8);
 assert.ok(visibleBottom-visibleTop>40,'Gesture target must be above the fixed action bar');
 const y=(visibleTop+visibleBottom)/2;
 const left=Math.max(25,box.x+box.width*.22),right=Math.min(viewport.width-25,box.x+box.width*.78);
 const start={x:vertical?(left+right)/2:direction===1?right:left,y:vertical?visibleBottom-5:y};
 const end={x:vertical?start.x:direction===1?left:right,y:vertical?Math.max(visibleTop+5,start.y-110):y};
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,radiusX:4,radiusY:4}]});
 for(let step=1;step<=8;step++) {
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*step/8,y:start.y+(end.y-start.y)*step/8,id:1,radiusX:4,radiusY:4}]});
  await page.waitForTimeout(35);
 }
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(400);
}
for(const selector of ['.overview-kpis','.overview-milk-flow','.overview-priority-items','.overview-detail-grid']) {
 const track=page.locator(selector);
 await track.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
 const sizing=await track.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,slide:el.querySelector('[data-carousel-slide]').getBoundingClientRect().width}));
 assert.ok(sizing.scroll>sizing.width*1.5 && sizing.slide>sizing.width*.7,`Readable swipe cards: ${selector}`);
 await touchGesture(track,1);
 await expect.poll(()=>track.evaluate(el=>el.scrollLeft)).toBeGreaterThan(80);
 const afterLeft=await track.evaluate(el=>el.scrollLeft);
 await touchGesture(track,-1);
 await expect.poll(()=>track.evaluate(el=>el.scrollLeft)).toBeLessThan(afterLeft-50);
}
const summaries=page.getByRole('group',{name:'Business summaries',exact:true});
await expect(page.locator('.overview-swipe-pagination')).toHaveCount(0);
const summaryTrack=summaries.locator('.overview-snap-track');
await summaryTrack.focus(); await page.keyboard.press('Home');
await expect.poll(()=>summaryTrack.evaluate(el=>el.scrollLeft)).toBeLessThan(2);
await page.keyboard.press('ArrowRight');
await expect.poll(()=>summaryTrack.evaluate(el=>el.scrollLeft)).toBeGreaterThan(80);
await page.waitForTimeout(400);
await page.keyboard.press('ArrowLeft');
await expect.poll(()=>summaryTrack.evaluate(el=>el.scrollLeft)).toBeLessThan(2);
await page.keyboard.press('End');
await expect.poll(()=>summaryTrack.evaluate(el=>el.scrollLeft>=el.scrollWidth-el.clientWidth-3)).toBe(true);
const milkCard=page.locator('.overview-kpis > :nth-child(2)');
await milkCard.scrollIntoViewIfNeeded();
const milkBox=await milkCard.boundingBox();
await page.touchscreen.tap(milkBox.x+milkBox.width/2,milkBox.y+milkBox.height/2);
await expect(page.getByRole('dialog')).toBeVisible();
await page.keyboard.press('Escape');
const chart=page.locator('.performance-chart');
await touchGesture(chart,1);
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','milk');
await expect(page.locator('.performance-totals > div:first-child > strong')).toHaveText('580 L');
await touchGesture(chart,-1);
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','sales');
await touchGesture(chart,-1);
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','products');
await page.getByRole('combobox',{name:'Product to chart'}).selectOption({label:'Desi Ghee'});
await expect(page.locator('.performance-totals > div:first-child > strong')).toHaveText('Rs 22,500');
await page.getByRole('button',{name:'Sales',exact:true}).click();
const scroller=page.locator('.mooco-overview').locator('..').locator('..');
await chart.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
const scrollBefore=await scroller.evaluate(el=>el.scrollTop);
await touchGesture(chart,1,true);
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','sales');
await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(scrollBefore+30);
const dates=page.getByRole('region',{name:'Reporting period navigation',exact:true});
for(const name of ['Yesterday','7 days','This month','This month']) {
 await touchGesture(dates,1);
 await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
}
for(const name of ['7 days','Yesterday','Today','Today']) {
 await touchGesture(dates,-1);
 await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
}
await page.getByRole('button',{name:'Sales',exact:true}).focus();
await page.keyboard.press('ArrowRight');
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','milk');
await page.keyboard.press('ArrowLeft');
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','sales');
// Respect system accessibility preferences while retaining the same controls.
await page.emulateMedia({reducedMotion:'reduce'});
assert.equal(await page.locator('.overview-welcome').evaluate(el=>getComputedStyle(el).animationName),'none');
await touchGesture(chart,1);
await expect(page.locator('.performance-panel')).toHaveAttribute('data-metric','milk');
await expect(page.locator('.performance-animated-view')).toHaveCSS('opacity','1');
await page.getByRole('button',{name:'Sales',exact:true}).click();
await page.emulateMedia({reducedMotion:'no-preference'});
await summaryTrack.focus(); await page.keyboard.press('Home');
await expect.poll(()=>summaryTrack.evaluate(el=>el.scrollLeft)).toBeLessThan(2);
await page.locator('.overview-welcome').scrollIntoViewIfNeeded();
console.log('PASS: Real left/right touch gestures on 4 carousels, chart metrics and dates; taps, keyboard navigation, vertical scrolling and reduced motion.');
await page.waitForTimeout(500); await page.locator('.overview-welcome').click();
assert.equal(await page.locator('.mooco-app').evaluate(el=>el.scrollTop),0,'Ambient background must not create an outer scroll container');
assert.equal((await page.locator('.mooco-app > div > header').boundingBox()).y,0,'Mobile header remains at the top after touch navigation');
await page.screenshot({path:path.join(outDir,'mobile-light.png'),fullPage:true});
await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
await expect(page.getByRole('button',{name:'Close navigation menu',exact:true})).toBeVisible();
await page.getByRole('button',{name:'Close navigation menu',exact:true}).click();
await page.getByTitle('Switch to Dark Theme').click(); await page.waitForTimeout(500);
await page.screenshot({path:path.join(outDir,'mobile-dark.png'),fullPage:true});
await page.setViewportSize({width:1440,height:1000}); await page.waitForTimeout(500);
await page.screenshot({path:path.join(outDir,'desktop-dark.png'),fullPage:true});
// Capture the whole scrollable dashboard without changing any production layout.
async function fullDashboardScreenshot(filename) {
 const dimensions=page.viewportSize();
 const size=await page.locator('.mooco-overview').evaluate(el=>Math.ceil(el.getBoundingClientRect().height+100));
 await page.setViewportSize({width:dimensions.width,height:size}); await page.waitForTimeout(400);
 await page.screenshot({path:path.join(outDir,filename),fullPage:true});
 await page.setViewportSize(dimensions); await page.waitForTimeout(350);
}
await fullDashboardScreenshot('desktop-dark-full.png');
await page.getByTitle('Switch to Light Theme').click(); await page.waitForTimeout(350);
await fullDashboardScreenshot('desktop-light-full.png');
await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(350);
await fullDashboardScreenshot('mobile-light-full.png');
await page.getByTitle('Switch to Dark Theme').click(); await page.waitForTimeout(350);
await fullDashboardScreenshot('mobile-dark-full.png');
await page.locator('.overview-detail-grid').scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(outDir,'mobile-dark-details.png')});
await page.locator('.cash-panel').scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(outDir,'mobile-dark-finance.png')});
await page.evaluate(()=>{
 const value=window.__dashboardFixture;
 for(const key of ['sales','purchases','expenses','inventory','items','allocations','productionBatches','inventoryLogs','accounts','customers','suppliers']) value[key]=[];
 value.cashInTransit={count:0,amount:0};
});
await page.getByRole('button',{name:'Yesterday',exact:true}).click();
await expect(page.getByText('No activity in these periods',{exact:true})).toBeVisible();
await expect(page.getByRole('heading',{name:'You’re all caught up',exact:true})).toBeVisible();
await expect(page.locator('.stock-display strong')).toHaveText('0 L');
await overflow(320,700);
await page.evaluate(()=>{
 const value=window.__dashboardFixture;
 value.sales=[{id:'big',date:'2026-10-01T10:00:00+05:00',bill_number:'LARGE-001',customer_name:'A long customer business name for narrow-screen testing',total:999999999,subtotal:999999999,payment_mode:'Credit',status:'Completed',items:[{name:'A long product name with multiple descriptive words',qty:1,price:999999999,total:999999999}]}];
 value.accounts=[{type:'Cash',balance:999999999}];
 value.customers=[{id:'long',name:'A long customer business name for narrow-screen testing',balance:999999999}];
 value.inventory=[{id:'neg',name:'Buffalo Milk',stock_type:'Retail Stock',unit:'L',quantity:-5,category:'Milk',price:230}];
});
await page.getByRole('button',{name:'Today',exact:true}).click();
await expect(page.getByText('Negative balance · check stock',{exact:true})).toBeVisible();
await overflow(320,700); await overflow(768,1024);
assert.ok(!(await page.locator('.mooco-overview').innerText()).includes('NaN'));
console.log('PASS: Empty periods, zero denominators, negative milk stock, long names, large balances and keyboard focus.');
assert.deepEqual(errors,[],`Runtime errors: ${errors.join('\n')}`);
fs.writeFileSync(path.join(outDir,'checks.json'),JSON.stringify({checks,runtimeErrors:errors,tested:['48 half-hour buckets and boundary aggregation for all metrics','Removed carousel footer and stock action buttons','Real left/right touch input on 4 native carousels','Chart and date swipe navigation','Vertical page scrolling without accidental chart changes','Touch taps and keyboard carousel navigation','Reduced motion and keyboard chart navigation','Empty periods and zero denominators','Large balances and long names','Negative milk stock','Dialog focus containment and restoration','KPI totals','Pakistan midnight sale','live stock stable under date filters','equal previous period','chart metrics and product selection','customization persistence','refresh','CSV export','milk details and Escape','mobile navigation','light and dark themes'],fixture:'Isolated representative data. No production writes.'},null,2));
console.log('PASS: Dashboard interactions, totals, light/dark modes and 9 viewport sizes.');
console.log(`Screenshots: ${outDir}`);
await browser.close();

