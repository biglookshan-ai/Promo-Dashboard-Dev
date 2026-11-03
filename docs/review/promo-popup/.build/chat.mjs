// 看一眼线上聊天按钮、Cookie 提示在电脑 / 手机上的真实样子(只截图看,不进预览)
import { chromium, devices } from '/Users/chillmungc/Vibe Coding Dev/Tool App/cgp-review/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
for (const [k, opt] of [['d', { viewport: { width: 1440, height: 900 } }], ['m', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }]]) {
  const ctx = await browser.newContext({ ...opt, locale: 'en-GB', timezoneId: 'Europe/London' });
  await ctx.addCookies([{ name: 'localization', value: 'GB', domain: '.cinegearpro.co.uk', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('https://www.cinegearpro.co.uk/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `/tmp/bnshot/live-${k}.png` });
  console.log(k, JSON.stringify(await page.evaluate(() => {
    const el = [...document.querySelectorAll('body *')].filter((e) => { const s = getComputedStyle(e); return s.position === 'fixed' && e.offsetWidth > 20 && e.offsetHeight > 20; })
      .map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 30)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
    return el.slice(0, 12);
  })));
  await ctx.close();
}
await browser.close();
