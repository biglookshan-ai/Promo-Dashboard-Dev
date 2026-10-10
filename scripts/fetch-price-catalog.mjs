// 本地测试数据:从网站前台公开的 JSON(/products.json、/collections.json)取一份真实的产品、变体价格、品牌和合集成员。
// 只读公开数据,不登录后台、不写任何东西。结果存 scripts/price-catalog.json(不进仓库)。
//   node scripts/fetch-price-catalog.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.cinegearpro.co.uk';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'price-catalog.json');
const get = async (u) => { const r = await fetch(SITE + u, { headers: { 'User-Agent': 'cgp-price-scheduler-local-test' } }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); };

const products = [];
for (let page = 1; page <= 3; page++) {
  const d = await get(`/products.json?limit=250&page=${page}`);
  if (!d.products.length) break;
  for (const p of d.products) products.push({
    id: p.id, title: p.title, handle: p.handle, vendor: p.vendor, type: p.product_type, tags: p.tags, image: p.images?.[0]?.src || '',
    variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: v.price, compareAt: v.compare_at_price })),
  });
  console.log(`产品第 ${page} 页:${d.products.length} 个`);
}
const ids = new Set(products.map((p) => p.id));
const cols = [];
for (let page = 1; page <= 4; page++) { const d = await get(`/collections.json?limit=250&page=${page}`); if (!d.collections.length) break; cols.push(...d.collections); }
// 优先挑促销相关和几个大品牌的合集(拿成员);其余只要名字,给「找合集」用
const PREFER = [/^flash/, /flashdeal/, /clearance/, /black-?friday/, /^tilta$/, /^smallrig$/, /^viltrox$/, /^dzofilm$/, /^telesin$/, /^godox$/, /sale$/, /new/];
const pick = [];
for (const re of PREFER) for (const c of cols) if (re.test(c.handle) && !pick.includes(c) && pick.length < 16) pick.push(c);
const collections = [];
for (const c of pick) {
  const d = await get(`/collections/${c.handle}/products.json?limit=250`).catch(() => ({ products: [] }));
  collections.push({ id: c.id, title: c.title, handle: c.handle, products: d.products.map((p) => p.id).filter((id) => ids.has(id)) });
}
for (const c of cols.filter((c) => !pick.includes(c)).slice(0, 40)) collections.push({ id: c.id, title: c.title, handle: c.handle, products: [] });
fs.writeFileSync(OUT, JSON.stringify({ site: SITE, fetchedAt: new Date().toISOString(), products, collections }));
console.log(`完成:${products.length} 个产品,${collections.length} 个合集 → ${OUT}`);
