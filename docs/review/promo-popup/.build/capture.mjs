// 抓线上首页当预览底图(电脑 1440 / 手机 390),顺便读网站字体、按钮颜色、Banner 图片地址。
//   node .build/capture.mjs  → img/home-d.jpg、img/home-m.jpg、.build/site.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '/Users/chillmungc/Vibe Coding Dev/Tool App/cgp-review/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const SITE = 'https://www.cinegearpro.co.uk/';
const HIDE = `#shopify-chat, shopify-chat, inbox-online-store-chat, #ShopifyChat, [id^="shopify-pc__"], .back-to-top, [class*="back-to-top" i], [id*="back-to-top" i],
  [class*="cookie" i][class*="banner" i], [id*="cookie" i], .glc-popup, [class*="geolocation" i] { display: none !important; }`;
const browser = await chromium.launch({ headless: true });
const out = {};
for (const [k, opt, h] of [['d', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, 2400], ['m', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, 2200]]) {
  const ctx = await browser.newContext({ ...opt, locale: 'en-GB', timezoneId: 'Europe/London' });
  await ctx.addCookies([{ name: 'cookie_consent', value: '1', domain: '.cinegearpro.co.uk', path: '/' }, { name: 'localization', value: 'GB', domain: '.cinegearpro.co.uk', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3000);
  const title = await page.title();
  if (/just a moment/i.test(title)) throw new Error('被机器人验证拦了,别重试,过一会儿再抓');
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(async (h) => { for (let y = 0; y < h + 1200; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } scrollTo(0, 0); }, h);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(PKG, 'img', `home-${k}.jpg`), type: 'jpeg', quality: 78, fullPage: true, clip: { x: 0, y: 0, width: opt.viewport.width, height: h } });
  out[k] = await page.evaluate(() => {
    const cs = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, color: s.color, bg: s.backgroundColor, radius: s.borderRadius }; };
    const btn = [...document.querySelectorAll('a.button, button.button, .button--primary, .btn')].find((e) => e.offsetParent);
    const bs = btn ? getComputedStyle(btn) : null;
    return {
      title: document.title, body: cs('body'), h2: cs('h2'), price: cs('.price-item, .price'),
      button: bs && { font: bs.fontFamily, bg: bs.backgroundColor, color: bs.color, radius: bs.borderRadius, text: btn.textContent.trim().slice(0, 30) },
      fonts: [...new Set([...document.querySelectorAll('link[href*="fonts"], style')].map((e) => (e.href || '').slice(0, 140)).filter(Boolean))],
      slides: [...document.querySelectorAll('img')].map((i) => i.currentSrc || i.src).filter((s) => /files\//.test(s) && /banner|friday|bf|sale/i.test(s)).slice(0, 20),
      prices: [...document.querySelectorAll('.price-item, .money, [class*="price"]')].slice(0, 3).map((e) => e.textContent.trim().slice(0, 20)),
      height: document.documentElement.scrollHeight,
    };
  });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(HERE, 'site.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
