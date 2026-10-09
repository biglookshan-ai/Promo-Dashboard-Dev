// 活动覆盖多少产品:用 Admin API 直接计数,不扫全站。
//   - 每个合集:collection.productsCount
//   - 每个标签:productsCount(query: "tag:'x'")
//   - 合计(去重):productsCount(query: "collection_id:1 OR tag:'x' OR id:3")
// ⚠️ 同 metafield 存在性筛选的坑:Shopify 遇到不认识的筛选条件会「静默忽略」→ 返回全店数量。
//    所以合计如果恰好等于全店产品数(而单项加起来明显更少),就判定为不可信,不显示。
import { graphql } from './shopify.js';
import { toGid } from './metaobjects.js';

const numId = (id) => String(id || '').split('/').pop();
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export async function scopeCounts(ctx, { collections = [], tags = [], products = [] }, gql = graphql) {
  const out = { collections: {}, tags: {}, total: null, totalReliable: false };
  const colIds = collections.map((c) => toGid('Collection', c.id || c)).filter(Boolean);
  if (colIds.length) {
    const d = await gql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Collection { id handle title productsCount { count } } } }`, { ids: colIds });
    for (const n of d.nodes.filter(Boolean)) out.collections[n.id] = { count: n.productsCount?.count ?? null, handle: n.handle, title: n.title };
  }
  for (const t of tags) {
    const d = await gql(ctx, `query($q: String!) { productsCount(query: $q, limit: null) { count } }`, { q: `tag:${q(t)}` });
    out.tags[t] = d.productsCount.count;
  }
  const parts = [...colIds.map((id) => `collection_id:${numId(id)}`), ...tags.map((t) => `tag:${q(t)}`), ...products.map((p) => `id:${numId(p.id || p)}`)];
  if (parts.length) {
    const d = await gql(ctx, `query($q: String!) { total: productsCount(query: $q, limit: null) { count } all: productsCount(limit: null) { count } }`, { q: parts.join(' OR ') });
    const sum = Object.values(out.collections).reduce((a, c) => a + (c.count || 0), 0) + Object.values(out.tags).reduce((a, n) => a + n, 0) + products.length;
    out.total = d.total.count;
    out.totalReliable = !(d.total.count === d.all.count && sum < d.all.count);
  } else {
    out.total = 0; out.totalReliable = true;
  }
  return out;
}

// 某个产品在哪些活动里(查产品用):按产品的合集 / 标签 / id 对照活动的三个条件
export async function productCampaigns(ctx, handleOrId, campaigns, gql = graphql) {
  const byId = String(handleOrId).match(/^(gid:\/\/shopify\/Product\/)?\d+$/);
  const d = await gql(ctx, `query($id: ID, $handle: String) {
      product: ${byId ? 'product(id: $id)' : 'productByIdentifier(identifier: { handle: $handle })'} {
        id title handle tags featuredMedia { preview { image { url } } }
        collections(first: 100) { nodes { id handle title } } } }`,
  byId ? { id: toGid('Product', handleOrId) } : { handle: handleOrId });
  const p = d.product;
  if (!p) return null;
  const colIds = new Set(p.collections.nodes.map((c) => c.id));
  const tags = new Set(p.tags);
  const hits = campaigns.map((c) => {
    const why = [];
    for (const col of c.collections || []) if (colIds.has(toGid('Collection', col.id))) why.push(`在合集「${col.title}」里`);
    for (const t of c.tags || []) if (tags.has(t)) why.push(`带标签「${t}」`);
    if ((c.products || []).some((x) => toGid('Product', x.id) === p.id)) why.push('被单独指定');
    return why.length ? { id: c.id, name: c.name, why } : null;
  }).filter(Boolean);
  return { product: { id: p.id, title: p.title, handle: p.handle, image: p.featuredMedia?.preview?.image?.url || '', tags: p.tags, collections: p.collections.nodes }, campaigns: hits };
}

// 首页商品模块的页签预览:按页签的设置取前几个产品(只给后台编辑器看,前台由主题自己取)
export async function tabProducts(ctx, tab, gql = graphql) {
  const N = 10;
  const FIELDS = 'id title handle publishedAt featuredMedia { preview { image { url } } } variants(first: 20) { nodes { price compareAtPrice } }';
  let nodes = [];
  if (tab.source === 'products') {
    const ids = (tab.products || []).map((p) => toGid('Product', p.id)).filter(Boolean).slice(0, 50);
    if (ids.length) nodes = (await gql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${FIELDS} } } }`, { ids })).nodes.filter(Boolean);
  } else if (tab.collection?.id) {
    const d = await gql(ctx, `query($id: ID!, $sort: ProductCollectionSortKeys, $rev: Boolean) { collection(id: $id) { title productsCount { count }
        products(first: 60, sortKey: $sort, reverse: $rev) { nodes { ${FIELDS} } } } }`,
    { id: toGid('Collection', tab.collection.id), sort: tab.newestFirst ? 'CREATED' : 'COLLECTION_DEFAULT', rev: !!tab.newestFirst });
    nodes = d.collection?.products.nodes || [];
  }
  const items = nodes.map((p) => {
    const best = p.variants.nodes.reduce((acc, v) => {
      const pr = Number(v.price), cmp = Number(v.compareAtPrice || 0);
      const off = cmp > pr ? Math.round(((cmp - pr) / cmp) * 100) : 0;
      return off > acc.off ? { off, price: pr, cmp } : acc;
    }, { off: 0, price: Number(p.variants.nodes[0]?.price || 0), cmp: Number(p.variants.nodes[0]?.compareAtPrice || 0) });
    return { id: p.id, title: p.title, handle: p.handle, image: p.featuredMedia?.preview?.image?.url || '', price: best.price, compareAt: best.cmp > best.price ? best.cmp : null, off: best.off };
  }).filter((p) => !tab.onlyDiscounted || p.off > 0);
  if (tab.sortByDiscount) items.sort((a, b) => b.off - a.off);
  const limit = Number(tab.limit) || 0;
  return { items: items.slice(0, Math.min(N, limit || N)), shown: limit ? Math.min(limit, items.length) : items.length, approx: nodes.length >= 60 };
}
