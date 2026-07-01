// CLI wrapper around src/inventory.js — runs the same logic the app uses, but
// with a fixed Admin token, and writes report files to out/.
//
//   SHOPIFY_SHOP=cinegearpro.myshopify.com \
//   SHOPIFY_ADMIN_TOKEN=shpat_xxx \
//   node scripts/inventory.mjs
//
// Token needs: read_products, read_metaobjects, read_metaobject_definitions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInventory } from '../src/inventory.js';

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
if (!SHOP || !TOKEN) {
  console.error('Set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN env vars.');
  process.exit(1);
}
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

console.log(`Shop: ${SHOP}  API: ${process.env.SHOPIFY_API_VERSION || '2026-04'}\n`);

const d = await runInventory(
  { shop: SHOP, token: TOKEN },
  { onProgress: (scanned, hits) => process.stdout.write(`\rscanned ${scanned} products, ${hits} with promo metafields...`) }
);
process.stdout.write('\n');

fs.writeFileSync(path.join(OUT, 'inventory-raw.json'), JSON.stringify(d, null, 2));

// ---- Markdown report ----
const L = [];
const p = (s = '') => L.push(s);
const c = d.counts;
p(`# CineGearPro 促销数据盘点`);
p(`生成时间: ${d.generatedAt}  ·  店铺: ${d.shop}\n`);
p(`## 概览`);
p(`| 指标 | 数量 |`);
p(`|---|---|`);
p(`| 活动/体验 metaobject 条目 | ${c.activityEntries} |`);
p(`| 促销 metaobject 条目 | ${c.promotionEntries} |`);
p(`| 扫描产品总数 | ${c.productsScanned} |`);
p(`| 带任意促销 metafield 的产品 | ${c.productsWithPromoMetafields} |`);
for (const [k, v] of Object.entries(c.metafields)) p(`| 产品有 custom.${k} | ${v} |`);
p('');

const ck = d.checks;
p(`## 一致性问题（迁移前必看）`);
p(`### A. 孤儿倒计时 — 有时间字段但没挂任何活动引用: ${ck.orphanTimers.length}`);
for (const h of ck.orphanTimers.slice(0, 300))
  p(`- ${h.title} (${h.handle}) — ${Object.entries(h.mf).map(([k, v]) => k + '=' + v).join(' · ')}`);
p('');
p(`### B. 双向漂移 — 活动列表里有该产品,但产品端缺反向引用: ${ck.missingReverse.length}`);
for (const m of ck.missingReverse.slice(0, 300)) p(`- ${m.gid.split('/').pop()} ← ${m.labels.join(', ')}`);
p('');
p(`### C. 反向漂移 — 产品端有引用,但不在任何活动列表: ${ck.refButNotListed.length}`);
for (const h of ck.refButNotListed.slice(0, 300)) p(`- ${h.title} (${h.handle})`);
p('');
p(`### D. 没有起止日期的活动: ${ck.noDates.length}`);
for (const h of ck.noDates) p(`- ${h}`);
p('');
p(`### E. 已过期但仍标记 active 的活动: ${ck.expiredActive.length}`);
for (const e of ck.expiredActive) p(`- ${e.handle} (end: ${e.end})`);
p('');

p(`## 活动 / 体验条目`);
p(`| handle | 标题 | start | end | active | 挂载产品数 |`);
p(`|---|---|---|---|---|---|`);
for (const r of d.tables.activity) p(`| ${r.handle} | ${r.title.slice(0, 40)} | ${r.start} | ${r.end} | ${r.active} | ${r.productCount} |`);
p('');
p(`## 促销条目`);
p(`| handle | 标题 | Show in Search | 挂载产品数 |`);
p(`|---|---|---|---|`);
for (const r of d.tables.promotion) p(`| ${r.handle} | ${r.title.slice(0, 40)} | ${r.search} | ${r.productCount} |`);
p('');

fs.writeFileSync(path.join(OUT, 'inventory-report.md'), L.join('\n'));

console.log(`\n✅ 写出 out/inventory-report.md + out/inventory-raw.json`);
console.log(`问题计数 — 孤儿倒计时:${ck.orphanTimers.length} 双向漂移:${ck.missingReverse.length} 反向漂移:${ck.refButNotListed.length} 无日期:${ck.noDates.length} 过期仍active:${ck.expiredActive.length}`);
