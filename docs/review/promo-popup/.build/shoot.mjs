// 本地看预览页(真实尺寸):电脑截左下角那块,手机截整屏
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '/Users/chillmungc/Vibe Coding Dev/Tool App/cgp-review/node_modules/playwright/index.mjs';
const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
for (const name of which) {
  const m = name.includes('.m.');
  const ctx = await browser.newContext(m ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(PKG, name)); await page.waitForTimeout(2200);
  const out = `/tmp/bnshot/pv-${name.replace(/\.html$/, '')}.png`;
  await page.screenshot({ path: out, ...(m ? {} : { clip: { x: 0, y: 380, width: 760, height: 520 } }) });
  console.log(out);
  await ctx.close();
}
await browser.close();
