// 演示用的「真实目录」:从店铺前台的公开 JSON 读合集产品数、标签产品数、产品图片,
// 写到 scripts/demo-catalog.json,给 build-demo-seed.mjs 用。只读、不需要任何凭证。
// 正式版(阶段 1b)改用 Admin API:collection.productsCount / productsCount(query:"tag:…")。
//
//   node scripts/fetch-demo-catalog.mjs [https://www.cinegearpro.co.uk]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = (process.argv[2] || 'https://www.cinegearpro.co.uk').replace(/\/$/, '');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-catalog.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(p) {
  const r = await fetch(SITE + p, { headers: { 'User-Agent': 'Mozilla/5.0 (promo-manager demo catalog)' } });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// 1) 全店产品(公开 JSON 每页最多 250)→ 标签计数 + 产品基本信息
const products = [];
for (let page = 1; page < 60; page++) {
  const j = await get(`/products.json?limit=250&page=${page}`);
  if (!j || !j.products.length) break;
  for (const p of j.products) {
    products.push({ id: p.id, handle: p.handle, title: p.title, tags: p.tags, image: p.images?.[0]?.src || '' });
  }
  process.stdout.write(`\r产品 ${products.length}`);
  await sleep(250);
}
console.log();
const tagCounts = {};
for (const p of products) for (const t of p.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;

// 2) 合集:主题首页 / 顶栏链接里出现过的 → 产品数 + id(拼后台链接用)
const THEME = path.join(process.env.HOME, 'Vibe Coding Dev/Shopify Dev/_worktrees/cgp-theme-campaign');
const linkText = ['templates/index.json', 'sections/header-group.json'].map((f) => fs.readFileSync(path.join(THEME, f), 'utf8')).join('\n');
const handles = [...new Set([...linkText.matchAll(/(?:shopify:\/\/|cinegearpro\.co\.uk\/)collections\/([a-z0-9-]+)/g)].map((m) => m[1]))]
  .filter((h) => h !== 'frontpage').sort();
const collections = [];
for (const h of handles) {
  const j = await get(`/collections/${h}.json`);
  if (j?.collection) collections.push({ id: j.collection.id, handle: h, title: j.collection.title, count: j.collection.products_count ?? null });
  else collections.push({ id: null, handle: h, title: h, count: null, missing: true });
  process.stdout.write(`\r合集 ${collections.length}/${handles.length}`);
  await sleep(200);
}
console.log();

fs.writeFileSync(OUT, JSON.stringify({ site: SITE, fetchedAt: new Date().toISOString(), products, tagCounts, collections }));
console.log(`✓ ${OUT}\n  产品 ${products.length} · 标签 ${Object.keys(tagCounts).length} · 合集 ${collections.length}`);
