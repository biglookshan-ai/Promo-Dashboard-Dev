// 交互检查:真实效果(2 秒出现、5 秒隐藏、悬停暂停)、× 关闭、Cookie 让位
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '/Users/chillmungc/Vibe Coding Dev/Tool App/cgp-review/node_modules/playwright/index.mjs';
const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true });
const st = (p) => p.evaluate(() => ({ s: document.querySelector('.cgpp').dataset.state, b: document.querySelector('.cgpp').style.bottom, note: document.querySelector('.pvbar em').textContent }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 电脑:真实效果
let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); let p = await ctx.newPage();
await p.goto('file://' + path.join(PKG, 'home-a.html')); await wait(800);
console.log('电脑 一直显示:', (await st(p)).s);
await p.click('[data-mode="play"]'); await wait(300); console.log('点真实效果后:', (await st(p)).s);
await wait(2200); console.log('2.5 秒:', (await st(p)).s);
await p.hover('.cgpp'); await wait(6000); console.log('悬停 6 秒:', (await st(p)).s, '|', (await st(p)).note);
await p.mouse.move(900, 200); await wait(5500); console.log('移开后:', (await st(p)).s, '|', (await st(p)).note);
await p.click('[data-mode="keep"]'); await wait(800); await p.click('.cgpp__x'); await wait(400); console.log('点 ×:', (await st(p)).s, '|', (await st(p)).note);
await ctx.close();
// 电脑:第一次来
ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); p = await ctx.newPage();
await p.goto('file://' + path.join(PKG, 'first-a.html')); await wait(800);
console.log('电脑第一次来:', JSON.stringify(await st(p)));
await p.click('.ckb__ok'); await wait(500); console.log('点 Accept 后:', JSON.stringify(await st(p)));
await ctx.close();
// 手机:第一次来
ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }); p = await ctx.newPage();
await p.goto('file://' + path.join(PKG, 'first-b.m.html')); await wait(800);
console.log('手机第一次来:', JSON.stringify(await st(p)));
await p.tap('.ckb__ok'); await wait(1700); console.log('点 Accept 1.7 秒后:', JSON.stringify(await st(p)));
await p.screenshot({ path: '/tmp/bnshot/pv-first-b.m.png' });
await ctx.close();
await browser.close();
