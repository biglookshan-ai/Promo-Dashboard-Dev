// 编辑器选产品用的只读查询:按产品 / 合集 / 品牌 / 标签 / 类型取产品和变体现价、成本;找合集;品牌清单;网站更新中心的活动。
// ⚠️ Shopify 对不认识的搜索条件会「静默忽略」、把全店都返回来(promo-manager 踩过)——按条件搜回来的产品逐个核对,不符合的丢掉。
import { graphql } from '../shopify.js';

const MAX_PRODUCTS = 5000;

const VARIANT_FIELDS = (withCost) => `variants(first: 100) { nodes { id title sku price compareAtPrice ${withCost ? 'inventoryItem { unitCost { amount } }' : ''} } }`;
const PRODUCT_FIELDS = (withCost) => `id title handle vendor productType tags status
  featuredMedia { preview { image { url(transform: { maxWidth: 120, maxHeight: 120 }) } } }
  ${VARIANT_FIELDS(withCost)}`;

// 成本价要 read_inventory;没这个权限就退回不带成本的查询(预览里不做「低于成本」检查)
let costOk = true;
async function q(ctx, build, vars) {
  if (costOk) {
    try { return await graphql(ctx, build(true), vars); }
    catch (e) { if (!/access|denied|inventoryItem|unitCost/i.test(e.message)) throw e; costOk = false; }
  }
  return graphql(ctx, build(false), vars);
}

export function shapeProduct(p) {
  return {
    id: p.id, title: p.title, handle: p.handle, vendor: p.vendor || '', type: p.productType || '', tags: p.tags || [], status: p.status,
    image: p.featuredMedia?.preview?.image?.url || '',
    variants: (p.variants?.nodes || []).map((v) => ({ id: v.id, title: v.title === 'Default Title' ? '' : v.title, sku: v.sku || '', price: v.price, compareAt: v.compareAtPrice, cost: v.inventoryItem?.unitCost?.amount ?? null })),
  };
}

export async function productsByIds(ctx, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await q(ctx, (c) => `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS(c)} } } }`, { ids: ids.slice(i, i + 50) });
    for (const n of d.nodes || []) if (n?.id) out.push(shapeProduct(n));
  }
  return out;
}

export async function collectionProducts(ctx, collectionId) {
  const out = []; let after = null; let title = '';
  do {
    const d = await q(ctx, (c) => `query($id: ID!, $after: String) { collection(id: $id) { title products(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor } nodes { ${PRODUCT_FIELDS(c)} } } } }`, { id: collectionId, after });
    if (!d.collection) throw new Error('找不到这个合集');
    title = d.collection.title;
    out.push(...d.collection.products.nodes.map(shapeProduct));
    after = d.collection.products.pageInfo.hasNextPage ? d.collection.products.pageInfo.endCursor : null;
  } while (after && out.length < MAX_PRODUCTS);
  return { title, products: out, truncated: !!after };
}

const esc = (s) => String(s).replace(/(["\\])/g, '\\$1');
// by:{ vendor?, tag?, type? }(可以组合,同时满足)
export async function searchProducts(ctx, by) {
  const parts = [];
  if (by.vendor) parts.push(`vendor:"${esc(by.vendor)}"`);
  if (by.tag) parts.push(`tag:"${esc(by.tag)}"`);
  if (by.type) parts.push(`product_type:"${esc(by.type)}"`);
  if (!parts.length && !by.all) throw new Error('至少选一个条件');
  const match = (p) => (!by.vendor || p.vendor.toLowerCase() === by.vendor.toLowerCase())
    && (!by.tag || p.tags.some((t) => t.toLowerCase() === by.tag.toLowerCase()))
    && (!by.type || p.type.toLowerCase() === by.type.toLowerCase());
  const out = []; let after = null; let dropped = 0;
  do {
    const d = await q(ctx, (c) => `query($q: String!, $after: String) { products(first: 50, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor } nodes { ${PRODUCT_FIELDS(c)} } } }`, { q: parts.join(' AND ') || null, after });
    for (const p of d.products.nodes.map(shapeProduct)) (match(p) ? out.push(p) : dropped++);
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    // 静默忽略的典型症状:前两页全是不符合的 → 停,别把全店翻一遍
    if (!out.length && dropped >= 100 && !by.all) throw new Error('Shopify 没按这个条件筛选(返回的都不符合),请换个写法或改用合集');
  } while (after && out.length < MAX_PRODUCTS);
  return { products: out, dropped, truncated: !!after };
}

export async function findCollections(ctx, text) {
  const d = await graphql(ctx, `query($q: String) { collections(first: 30, query: $q, sortKey: TITLE) { nodes {
    id title handle productsCount { count } ruleSet { appliedDisjunctively } } } }`, { q: text ? `title:*${esc(text)}*` : null });
  return d.collections.nodes.map((c) => ({ id: c.id, title: c.title, handle: c.handle, count: c.productsCount?.count ?? null, smart: !!c.ruleSet }));
}

export async function vendors(ctx) {
  const d = await graphql(ctx, '{ productVendors(first: 250) { nodes } }');
  return d.productVendors.nodes.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// 网站更新中心的活动(店铺级 metaobject,别的 app 能读条目)
export async function campaigns(ctx) {
  try {
    const d = await graphql(ctx, `{ metaobjects(type: "cgp_campaign", first: 100) { nodes { id handle displayName fields { key value } } } }`);
    return d.metaobjects.nodes.map((m) => {
      const f = Object.fromEntries(m.fields.map((x) => [x.key, x.value]));
      const list = (k) => { try { return JSON.parse(f[k] || '[]'); } catch { return []; } };
      return { id: m.id, name: f.name || m.displayName, start: f.starts_at ? Date.parse(f.starts_at) : null, end: f.ends_at ? Date.parse(f.ends_at) : null,
        collections: list('collections'), tags: list('tags'), products: list('products') };
    });
  } catch { return []; }
}

export async function grantedScopes(ctx) {
  const d = await graphql(ctx, '{ currentAppInstallation { accessScopes { handle } } }');
  return d.currentAppInstallation.accessScopes.map((s) => s.handle);
}
export const REQUIRED_SCOPES = ['read_products', 'write_products', 'read_inventory', 'read_metaobjects'];
export function missingScopes(granted) {
  const has = new Set(granted);
  // write_x 自带 read_x
  return REQUIRED_SCOPES.filter((s) => !has.has(s) && !(s.startsWith('read_') && has.has(s.replace('read_', 'write_'))));
}

export async function shopInfo(ctx) {
  const d = await graphql(ctx, '{ shop { name myshopifyDomain primaryDomain { url } currencyCode } currentAppInstallation { app { handle } } }');
  const handle = d.shop.myshopifyDomain.replace('.myshopify.com', '');
  return { name: d.shop.name, handle, domain: d.shop.primaryDomain.url.replace(/\/$/, ''), currency: d.shop.currencyCode,
    appUrl: `https://admin.shopify.com/store/${handle}/apps/${d.currentAppInstallation.app.handle}` };
}
