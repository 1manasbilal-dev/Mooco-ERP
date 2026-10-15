import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  // Fresh browser storage, no credentials, all remote data calls blocked.
  await context.route(/https:\/\/[^/]*\.supabase\.co\//,route=>route.abort());
  const page=await context.newPage();
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/assets\/.*\.js/.test(request.url()))requests.push(new URL(request.url()).pathname);});
  await page.goto('http://127.0.0.1:4100/purchase');
  await expect(page.locator('.mooco-app')).toBeVisible();
  await page.waitForTimeout(1500);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(requests.filter(url=>/vendor-charts|Reports-|html2canvas|jspdf/.test(url)).length,0,'Optional reports/charts/PDF must not enter the shell startup graph');
  const manifest=JSON.parse(fs.readFileSync('dist/.vite/manifest.json','utf8'));
  const visited=new Set();
  function visit(id){if(visited.has(id))return;visited.add(id);for(const dep of manifest[id].imports||[])visit(dep);}
  visit('index.html');
  const initialFiles=[...visited].map(id=>manifest[id].file);
  assert.equal(initialFiles.filter(file=>/vendor-motion|vendor-charts|UserSwitcherModal|CommandPalette|jspdf|html2canvas/.test(file)).length,0);
  fs.writeFileSync('screenshots/global-theme/production-checks.json',JSON.stringify({initialFiles,requestedJavaScript:requests,runtimeErrors:errors,liveData:'blocked in isolated browser'},null,2));
  console.log(JSON.stringify({initialFiles,runtimeErrors:errors},null,2));
}finally{await browser.close();}
