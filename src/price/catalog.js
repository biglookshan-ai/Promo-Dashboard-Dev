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
    if (!d.collection) throw new Error('找不到这个 Collection');
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
    if (!out.length && dropped >= 100 && !by.all) throw new Error('Shopify 没按这个条件筛选(返回的都不符合),请换个写法或改用 Collection');
  } while (after && out.length < MAX_PRODUCTS);
  return { products: out, dropped, truncated: !!after };
}

// 搜 Collection。用 2026-07 接口:旧接口搜不到用了新功能(条件 + 单独加入 + 排除)的 Collection;smart = 带条件(改价往里加产品 = 加进它的「单独加入」名单)
export async function findCollections(ctx, text) {
  const q = text ? `title:*${esc(text)}*` : null;
  try {
    const d = await graphql(ctx, `query($q: String) { collections(first: 30, query: $q, sortKey: TITLE) { nodes {
      id title handle productsCount { count } ruleSet { appliedDisjunctively } sources { __typename ... on CollectionConditionsSource { shareable inclusion { conditions { __typename } } } } } } }`, { q }, { version: '2026-07' });
    return d.collections.nodes.map((c) => {
      const srcs = c.sources || [];
      const smart = !!c.ruleSet || srcs.some((x) => x.__typename === 'CollectionSubCollectionsSource' || (x.inclusion?.conditions || []).length > 0);
      return { id: c.id, title: c.title, handle: c.handle, count: c.productsCount?.count ?? null, smart, shared: smart && !srcs.some((x) => x.__typename === 'CollectionConditionsSource' && !x.shareable) };
    });
  } catch {
    const d = await graphql(ctx, `query($q: String) { collections(first: 30, query: $q, sortKey: TITLE) { nodes {
      id title handle productsCount { count } ruleSet { appliedDisjunctively } } } }`, { q });
    return d.collections.nodes.map((c) => ({ id: c.id, title: c.title, handle: c.handle, count: c.productsCount?.count ?? null, smart: !!c.ruleSet }));
  }
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

// 款式图(2026-10-29 用户:有选项图就显示):单独小批量读,只读表格里正在显示的几个产品 —— 别加进上面的大查询(每页 50 个产品 × 100 个款式,再加图怕超出单次查询上限)
// 用 media(款式的 image 字段 2026-04 起已弃用)。返回 { 款式 id: 图 }
export async function variantImages(ctx, productIds) {
  const out = {};
  const d = await graphql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { variants(first: 50) { nodes { id media(first: 1) { nodes { preview { image { url(transform: { maxWidth: 120, maxHeight: 120 }) } } } } } } } } }`, { ids: productIds.slice(0, 5) });
  for (const n of d.nodes || []) for (const v of n?.variants?.nodes || []) { const u = v.media?.nodes?.[0]?.preview?.image?.url; if (u) out[v.id] = u; }
  return out;
}
