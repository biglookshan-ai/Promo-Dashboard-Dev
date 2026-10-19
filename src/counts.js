// 活动覆盖多少产品:用 Admin API 直接计数,不扫全站。
//   - 每个合集:collection.productsCount
//   - 每个标签:productsCount(query: "tag:'x'")
//   - 合计(去重):productsCount(query: "collection_id:1 OR tag:'x' OR id:3")
// ⚠️ 同 metafield 存在性筛选的坑:Shopify 遇到不认识的筛选条件会「静默忽略」→ 返回全店数量。
//    所以合计如果恰好等于全店产品数(而单项加起来明显更少),就判定为不可信,不显示。
import { graphql } from './shopify.js';
import { toGid } from './metaobjects.js';
import { ActionError } from './schedule-actions.js';
import { RULES, hasRules, ownSource } from './collection-order.js';
import { NEW_COLLECTIONS } from './shopify.js';

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

// 产品页推广块(2026-10-19):「放在哪些产品」命中多少个 + 前几个是谁(编辑器右边显示)
//   条件 = (合集 OR 标签 OR 品牌 OR 指定产品) 去掉排除标签;排除的产品单独数一遍再减掉(不依赖 Shopify 认不认 -id:)
//   和主题 snippets/cgp-pdp-callout.liquid 同一套判断
export async function calloutScope(ctx, { collections = [], tags = [], vendors = [], products = [], exProducts = [], exTags = [] }, gql = graphql) {
  const inc = [...collections.map((c) => `collection_id:${numId(c.id || c)}`), ...tags.map((t) => `tag:${q(t)}`),
    ...vendors.map((v) => `vendor:${q(v)}`), ...products.map((p) => `id:${numId(p.id || p)}`)];
  if (!inc.length) return { total: 0, sample: [], maybeAll: false };
  const base = `(${inc.join(' OR ')})${exTags.map((t) => ` NOT tag:${q(t)}`).join('')}`;
  const exIds = new Set(exProducts.map((p) => numId(p.id || p)).filter(Boolean));
  const exQ = exIds.size ? `${base} (${[...exIds].map((id) => `id:${id}`).join(' OR ')})` : null;
  const d = await gql(ctx, `query($q: String!, $ex: String!, $n: Int!, $hasEx: Boolean!) {
      total: productsCount(query: $q, limit: null) { count }
      all: productsCount(limit: null) { count }
      ex: productsCount(query: $ex, limit: null) @include(if: $hasEx) { count }
      products(first: $n, query: $q, sortKey: TITLE) { nodes { id title handle vendor status featuredMedia { preview { image { url } } } } } }`,
  { q: base, ex: exQ || '', n: Math.min(50, 12 + exIds.size), hasEx: !!exQ });
  const total = Math.max(0, d.total.count - (d.ex?.count || 0));
  const sample = d.products.nodes.filter((p) => !exIds.has(numId(p.id))).slice(0, 12)
    .map((p) => ({ id: p.id, title: p.title, handle: p.handle, vendor: p.vendor, status: p.status, image: p.featuredMedia?.preview?.image?.url || '' }));
  // Shopify 不认识某个条件会静默忽略 → 返回全店数量;恰好等于全店时提示「以前台为准」
  return { total, sample, maybeAll: d.total.count === d.all.count };
}
// 店里所有品牌(Vendor),推广块选品牌用
export async function shopVendors(ctx, gql = graphql) {
  const d = await gql(ctx, '{ productVendors(first: 250) { nodes } }').catch(() => null)
    || await gql(ctx, '{ shop { productVendors(first: 250) { edges { node } } } }').then((x) => ({ productVendors: { nodes: x.shop.productVendors.edges.map((e) => e.node) } }));
  return d.productVendors.nodes.filter(Boolean).sort((a, b) => a.localeCompare(b));
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

// 合集排序编辑器:把一个合集**现在在店里的真实顺序**整份取出来(最多 MAX 个)。
//   manualOk = 这个合集能不能真的手动排序 / 手动加减产品(按条件自动归类的合集 Shopify 不让)。
const COL_MAX = 500;
export async function collectionProducts(ctx, id, gql = graphql) {
  const gid = toGid('Collection', id);
  const FIELDS = 'id title handle status featuredMedia { preview { image { url } } } variants(first: 20) { nodes { price compareAtPrice } }';
  const out = []; let after = null; let title = ''; let sortOrder = null; let ruleSet = null; let srcId = null; let sortRule = null; let total = null; let more = false;
  for (let i = 0; i < 5; i++) {
    const d = await gql(ctx, `query($id: ID!, $after: String) { collection(id: $id) { title sortOrder productsCount { count } ${RULES}
        sortOff: metafield(namespace: "custom", key: "cgp_sort_off") { value } pinManual: metafield(namespace: "custom", key: "cgp_pin_manual") { value } pinNew: metafield(namespace: "custom", key: "cgp_pin_new") { value }
        products(first: 100, after: $after, sortKey: COLLECTION_DEFAULT) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } } } }`, { id: gid, after });
    const c = d.collection;
    if (!c) throw new ActionError('找不到这个合集(可能已经删了)');
    title = c.title; sortOrder = c.sortOrder; ruleSet = hasRules(c); srcId = ownSource(c); total = c.productsCount?.count ?? null;
    // 搜索引擎在合集页的默认排法(主题默认「手动前 12 个 + 其余新到旧」,每个合集可以用这三个字段改)
    sortRule = { off: c.sortOff?.value === 'true', pinManual: c.pinManual?.value != null ? Number(c.pinManual.value) : 12, pinNew: c.pinNew?.value != null ? Number(c.pinNew.value) : 0 };
    out.push(...c.products.nodes);
    if (!c.products.pageInfo.hasNextPage) { after = null; break; }
    after = c.products.pageInfo.endCursor;
    if (out.length >= COL_MAX) { more = true; break; }
  }
  const products = out.slice(0, COL_MAX).map((p, i) => ({ id: p.id, title: p.title, handle: p.handle, image: p.featuredMedia?.preview?.image?.url || '', pos: i + 1, ...priceOf(p), draft: p.status !== 'ACTIVE' }));
  // 能真的改店里的顺序 = 排序方式是「手动」(Shopify 2026 新版合集:带条件的合集也可以手动排)
  // 能真的加 / 移出单个产品 = 手动排序 + 没有条件(带条件的合集要改它的条件来源,先交给前台)
  const manualOk = sortOrder === 'MANUAL';
  const membershipOk = manualOk && !ruleSet;
  const selectionOk = manualOk && !!ruleSet && NEW_COLLECTIONS && !!srcId; // 带条件的合集:改它的「单独加的产品 / 排除」名单
  return { id: gid, title, sortOrder, automated: !!ruleSet, manualOk, membershipOk, selectionOk,
    needsNewApi: manualOk && !!ruleSet && !NEW_COLLECTIONS, sharedSource: manualOk && !!ruleSet && NEW_COLLECTIONS && !srcId, sortRule,
    total, products, truncated: more || (total != null && total > products.length) };
}
// 按 id 取产品的名字和图(历史版本里有的产品现在可能已经不在合集里了)
export async function productsInfo(ctx, ids, gql = graphql) {
  const out = [];
  const gids = [...new Set(ids.map((id) => toGid('Product', id)).filter(Boolean))];
  for (let i = 0; i < gids.length; i += 200) {
    const d = await gql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title handle status featuredMedia { preview { image { url } } } variants(first: 20) { nodes { price compareAtPrice } } } } }`, { ids: gids.slice(i, i + 200) });
    for (const p of d.nodes.filter(Boolean)) out.push({ id: p.id, title: p.title, handle: p.handle, image: p.featuredMedia?.preview?.image?.url || '', ...priceOf(p), draft: p.status !== 'ACTIVE' });
  }
  return out;
}

// 产品卡上显示的价格:有打折的 → 折扣最大的那个变体的「原价(划线价)/ 现价」;没打折 → 最低价,变体价格不一样时标「起」
function priceOf(p) {
  const vs = p.variants?.nodes || [];
  if (!vs.length) return { price: null, compareAt: null, off: 0, from: false };
  let best = null;
  for (const v of vs) {
    const pr = Number(v.price), cmp = Number(v.compareAtPrice || 0);
    const off = cmp > pr ? Math.round(((cmp - pr) / cmp) * 100) : 0;
    if (off && (!best || off > best.off)) best = { off, price: pr, compareAt: cmp };
  }
  const prices = vs.map((v) => Number(v.price));
  const min = Math.min(...prices);
  if (best) return { ...best, from: false };
  return { price: min, compareAt: null, off: 0, from: Math.max(...prices) !== min };
}
