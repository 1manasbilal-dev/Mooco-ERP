// Usage: node render.js <out_dir> <fps> <duration> [t1,t2,... for stills]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [outDir, fps, dur, stills] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve('status.html'));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => i.onload = r))); });
  await page.waitForTimeout(800);
  const times = stills ? stills.split(',').map(Number) : Array.from({ length: Math.round(fps * dur) }, (_, i) => i / fps);
  for (let i = 0; i < times.length; i++) {
    await page.evaluate(t => window.render(t), times[i]);
    const name = stills ? `still-${times[i]}.jpg` : `f${String(i).padStart(4, '0')}.jpg`;
    await page.screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 93 });
  }
  await browser.close();
})();
