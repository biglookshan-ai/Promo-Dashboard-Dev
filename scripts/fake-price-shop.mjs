// 本地测试环境里「改价」用的假 Shopify:产品 / 变体价格 / 合集成员都在内存里,数据来自 scripts/price-catalog.json
// (前台公开数据,先跑 node scripts/fetch-price-catalog.mjs)。只认改价模块的查询,别的返回 undefined 交回给 live-harness。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'price-catalog.json');
const cat = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { products: [], collections: [] };
const G = (type, id) => `gid://shopify/${type}/${id}`;
const num = (gid) => String(gid).split('/').pop();
const products = new Map(cat.products.map((p) => [G('Product', p.id), { ...p, gid: G('Product', p.id) }]));
const variants = new Map();
for (const p of products.values()) for (const v of p.variants) variants.set(G('ProductVariant', v.id), { ...v, gid: G('ProductVariant', v.id), productGid: p.gid, orig: { price: v.price, compareAt: v.compareAt } });
const collections = new Map(cat.collections.map((c) => [G('Collection', c.id), { ...c, gid: G('Collection', c.id), members: new Set(c.products.map((id) => G('Product', id))), smart: /sale|clearance/.test(c.handle) && !/flash/.test(c.handle) }]));

const vShape = (v) => ({ id: v.gid, title: v.title, sku: v.sku, price: v.price, compareAtPrice: v.compareAt || null,
  displayName: `${products.get(v.productGid).title}${v.title === 'Default Title' ? '' : ' - ' + v.title}`,
  product: { id: v.productGid, title: products.get(v.productGid).title },
  inventoryItem: { unitCost: { amount: (Number(v.orig.price) * 0.55).toFixed(2) } } });
const pShape = (p) => ({ id: p.gid, title: p.title, handle: p.handle, vendor: p.vendor, productType: p.type, tags: p.tags, status: 'ACTIVE',
  featuredMedia: p.image ? { preview: { image: { url: p.image } } } : null,
  variants: { nodes: p.variants.map((v) => vShape(variants.get(G('ProductVariant', v.id)))) } });
const page = (list, first, after) => {
  const start = after ? Number(after) : 0; const nodes = list.slice(start, start + first);
  return { nodes, pageInfo: { hasNextPage: start + first < list.length, endCursor: String(start + first) } };
};
function parseQuery(q) {
  const f = {}; for (const m of String(q || '').matchAll(/(vendor|tag|product_type):"((?:[^"\\]|\\.)*)"/g)) f[m[1]] = m[2].replace(/\\(.)/g, '$1').toLowerCase();
  return (p) => (!f.vendor || p.vendor.toLowerCase() === f.vendor) && (!f.tag || p.tags.some((t) => t.toLowerCase() === f.tag)) && (!f.product_type || (p.type || '').toLowerCase() === f.product_type);
}

// 改价的查询 → 结果;不是改价的查询 → undefined
export function priceGql(q, v = {}) {
  if (q.includes('productVariantsBulkUpdate')) {
    const userErrors = [];
    v.variants.forEach((x, i) => {
      const vv = variants.get(x.id);
      if (!vv || vv.productGid !== v.productId) return userErrors.push({ field: ['variants', String(i), 'id'], message: '变体不属于这个产品' });
      if (!(Number(x.price) >= 0)) return userErrors.push({ field: ['variants', String(i), 'price'], message: '价格不合法' });
      vv.price = Number(x.price).toFixed(2); vv.compareAt = x.compareAtPrice == null ? null : Number(x.compareAtPrice).toFixed(2);
    });
    return { productVariantsBulkUpdate: { productVariants: [], userErrors } };
  }
  if (q.includes('collectionAddProducts')) { const c = collections.get(v.id); if (c.smart) return { collectionAddProducts: { userErrors: [{ message: '智能合集不能手动加产品' }] } }; (v.p || []).forEach((p) => c.members.add(p)); return { collectionAddProducts: { userErrors: [] } }; }
  if (q.includes('collectionRemoveProducts')) { const c = collections.get(v.id); (v.p || []).forEach((p) => c.members.delete(p)); return { collectionRemoveProducts: { userErrors: [] } }; }
  if (q.includes('inCollection')) return { nodes: v.ids.map((id) => (products.has(id) ? { id, inCollection: collections.get(v.c)?.members.has(id) || false } : null)) };
  if (q.includes('on ProductVariant')) return { nodes: v.ids.map((id) => (variants.has(id) ? vShape(variants.get(id)) : null)) };
  if (!q.includes('variants(first: 100)') && !q.includes('collections(first: 30') && !q.includes('productVendors')) return undefined;
  if (q.includes('nodes(ids')) return { nodes: v.ids.map((id) => (products.has(id) ? pShape(products.get(id)) : null)) };
  if (q.includes('collection(id:')) {
    const c = collections.get(v.id); if (!c) return { collection: null };
    return { collection: { title: c.title, products: page([...c.members].filter((id) => products.has(id)).map((id) => pShape(products.get(id))), 50, v.after) } };
  }
  if (q.includes('products(first')) return { products: page([...products.values()].filter(parseQuery(v.q)).map(pShape), 50, v.after) };
  if (q.includes('collections(first: 30')) {
    const t = String(v.q || '').replace(/^title:\*|\*$/g, '').toLowerCase();
    return { collections: { nodes: [...collections.values()].filter((c) => !t || c.title.toLowerCase().includes(t)).slice(0, 30)
      .map((c) => ({ id: c.gid, title: c.title, handle: c.handle, productsCount: { count: c.members.size }, ruleSet: c.smart ? { appliedDisjunctively: false } : null })) } };
  }
  if (q.includes('productVendors')) return { productVendors: { nodes: [...new Set([...products.values()].map((p) => p.vendor))] } };
  return undefined;
}

// GET /__price 看改过价的变体和合集成员;GET /__price/set?variant=<id>&price=79 模拟同事手动改价
export function priceState() {
  const changed = [...variants.values()].filter((x) => x.price !== x.orig.price || (x.compareAt || null) !== (x.orig.compareAt || null))
    .map((x) => ({ variant: num(x.gid), product: products.get(x.productGid).title, sku: x.sku, orig: x.orig, now: { price: x.price, compareAt: x.compareAt } }));
  const cols = [...collections.values()].filter((c) => c.members.size !== c.products.length || c.products.some((id) => !c.members.has(G('Product', id))))
    .map((c) => ({ collection: c.title, before: c.products.length, now: c.members.size }));
  return { products: products.size, changed, collections: cols };
}
export function priceSet(params) {
  const id = params.get('variant'); const vv = variants.get(id?.startsWith('gid') ? id : G('ProductVariant', id));
  if (!vv) return null;
  if (params.has('price')) vv.price = Number(params.get('price')).toFixed(2);
  if (params.has('compareAt')) vv.compareAt = params.get('compareAt') || null;
  return vShape(vv);
}
