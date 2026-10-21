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
//   条件(rules)同时满足才算:{ f: vendor 品牌 / type 产品类型 / collection 合集 / tag 标签 / title 标题, n: 是否取反, v: [值…] }
//   一行里多个值 = 任一个就算(取反 = 一个都不能有);标题是「包含」,不分大小写。
//   再加上「一定显示」的产品(products)、去掉排除的产品(exProducts)和推广产品自己(promo)。只算上架中的产品。
//   和主题 snippets/cgp-pdp-callout.liquid 同一套判断(改一边要改另一边)。
//   标题包含 Shopify 搜索做不到(只认整词 / 前缀)→ 有标题条件时先按其他条件把候选产品逐页拉回来,在这里比标题。
export const CO_FIELDS = ['vendor', 'type', 'collection', 'tag', 'title'];
const CO_Q = { vendor: (v) => `vendor:${q(v)}`, type: (v) => `product_type:${q(v)}`, tag: (v) => `tag:${q(v)}`, collection: (v) => `collection_id:${numId(v?.id ?? v)}` };
const coRules = (rules) => (Array.isArray(rules) ? rules : []).filter((r) => r && CO_FIELDS.includes(r.f) && Array.isArray(r.v) && r.v.length);
export function calloutQuery(rules) {
  return ['status:active', ...coRules(rules).filter((r) => CO_Q[r.f]).map((r) => (r.n ? r.v.map((v) => `NOT ${CO_Q[r.f](v)}`).join(' AND ') : `(${r.v.map(CO_Q[r.f]).join(' OR ')})`))].join(' AND ');
}
// 标题条件(其他条件已经由 Shopify 筛过)
export function calloutTitleOk(rules, title) {
  const t = String(title || '').toLowerCase();
  return coRules(rules).filter((r) => r.f === 'title').every((r) => { const m = r.v.some((v) => t.includes(String(v).toLowerCase())); return r.n ? !m : m; });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gqlRetry(ctx, gql, query, vars) { // 逐页拉的时候可能被限流,等一下再试
  for (let i = 0; ; i++) {
    try { return await gql(ctx, query, vars); } catch (e) { if (i >= 5 || !/THROTTLED/i.test(e.message)) throw e; await sleep(1500 * (i + 1)); }
  }
}
export async function calloutScope(ctx, { rules = [], products = [], exProducts = [], promo = null }, gql = graphql) {
  const rs = coRules(rules);
  const exIds = new Set([...exProducts.map((p) => numId(p.id || p)), promo?.id ? numId(promo.id) : null].filter(Boolean));
  const incIds = products.map((p) => numId(p.id || p)).filter((id) => id && !exIds.has(id));
  if (!rs.length && !incIds.length) return { total: 0, sample: [], capped: false };
  const SAMPLE = 12; const CAP = 2000;
  const hits = new Map(); // 命中的产品 id → { title, handle, status }
  let capped = false;
  if (rs.length) {
    const query = calloutQuery(rs);
    const hasTitle = rs.some((r) => r.f === 'title');
    if (!hasTitle) {
      // 没有标题条件:Shopify 直接数(去掉排除的),再取按名称排的前几个
      const exQ = exIds.size ? `${query} AND (${[...exIds].map((id) => `id:${id}`).join(' OR ')})` : null;
      const d = await gql(ctx, `query($q: String!, $ex: String!, $hasEx: Boolean!, $n: Int!) {
          total: productsCount(query: $q, limit: null) { count }
          ex: productsCount(query: $ex, limit: null) @include(if: $hasEx) { count }
          products(first: $n, query: $q, sortKey: TITLE) { nodes { id title handle status } } }`,
      { q: query, ex: exQ || '', hasEx: !!exQ, n: Math.min(60, SAMPLE + exIds.size + incIds.length) });
      d.products.nodes.filter((p) => !exIds.has(numId(p.id))).forEach((p) => hits.set(numId(p.id), p));
      const ruleTotal = Math.max(0, d.total.count - (d.ex?.count || 0));
      // 「一定显示」的产品里本来就符合条件的不重复算
      const extra = incIds.length ? (await gql(ctx, `query($q: String!) { productsCount(query: $q, limit: null) { count } }`, { q: `${query} AND (${incIds.map((id) => `id:${id}`).join(' OR ')})` })).productsCount.count : 0;
      const sample = await coSample(ctx, gql, [...hits.keys(), ...incIds], SAMPLE);
      return { total: ruleTotal + incIds.length - extra, sample, capped: false };
    }
    let after = null; let scanned = 0;
    do {
      const d = await gqlRetry(ctx, gql, `query($q: String!, $after: String) { products(first: 250, after: $after, query: $q, sortKey: TITLE) { nodes { id title handle status } pageInfo { hasNextPage endCursor } } }`, { q: query, after });
      for (const p of d.products.nodes) if (!exIds.has(numId(p.id)) && calloutTitleOk(rs, p.title)) hits.set(numId(p.id), p);
      after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
      scanned += d.products.nodes.length;
      if (after && scanned >= CAP) { capped = true; break; } // 候选太多(比如只有标题条件 = 全店)就只看前 2000 个,数字显示「至少」
    } while (after);
  }
  incIds.forEach((id) => { if (!hits.has(id)) hits.set(id, null); });
  return { total: hits.size, sample: await coSample(ctx, gql, [...hits.keys()], SAMPLE), capped };
}
// 前几个命中的产品(带图,给编辑器看)
async function coSample(ctx, gql, ids, n) {
  const want = [...new Set(ids)].slice(0, n);
  if (!want.length) return [];
  const d = await gql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title handle vendor productType status featuredMedia { preview { image { url } } } } } }`, { ids: want.map((id) => toGid('Product', id)) });
  return d.nodes.filter(Boolean).map((p) => ({ id: p.id, title: p.title, handle: p.handle, vendor: p.vendor, type: p.productType, status: p.status, image: p.featuredMedia?.preview?.image?.url || '' }));
}
// 推广块条件的下拉选项:店里所有品牌、产品类型、标签
export async function calloutOptions(ctx, gql = graphql) {
  const strs = async (field) => {
    const out = []; let after = null;
    for (let i = 0; i < 6; i++) {
      const d = await gqlRetry(ctx, gql, `query($after: String) { ${field}(first: 250, after: $after) { nodes pageInfo { hasNextPage endCursor } } }`, { after }).catch(() => null);
      if (!d?.[field]) break;
      out.push(...d[field].nodes);
      if (!d[field].pageInfo?.hasNextPage) break; after = d[field].pageInfo.endCursor;
    }
    return [...new Set(out.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  };
  return { vendors: await strs('productVendors'), types: await strs('productTypes'), tags: await strs('productTags') };
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
// 产品卡上的库存(合集排序网格):读店里已经同步好的款式字段(2026-10-21 用户:不用读仓库)——
//   custom.uk_inventory(后台叫 UK Inventory)→ UK;custom.es_inventory(后台叫 EW Inventory,External Warehouse)→ EW(和后台名字一样)
//   和主题 snippets/stock-logic-compute.liquid 读的是同一组字段。每个产品把所有款式加起来;负数当 0;一个款式都没有这两个字段 = 不显示。
//   只要 read_products。两分钟内同一个产品不重复读。
const stockCache = new Map(); // `${shop}:${产品id}` → { at, v }
export const STOCK_FIELDS = [['uk_inventory', 'UK'], ['es_inventory', 'EW']];
const STOCK_Q = `query($q: String!, $after: String) { productVariants(first: 100, after: $after, query: $q) { nodes { product { id }
  ${STOCK_FIELDS.map(([k]) => `${k}: metafield(namespace: "custom", key: "${k}") { value }`).join(' ')} } pageInfo { hasNextPage endCursor } } }`;
export async function productsStock(ctx, ids, gql = graphql) {
  const shop = ctx.shop || ''; const now = Date.now();
  const nums = [...new Set((ids || []).map((x) => String(x).split('/').pop()).filter((x) => /^\d+$/.test(x)))].slice(0, 300);
  const stock = {}; const need = [];
  for (const n of nums) { const c = stockCache.get(`${shop}:${n}`); if (c && now - c.at < 120_000) stock[n] = c.v; else need.push(n); }
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    for (const n of chunk) stock[n] = { tracked: false, by: {} };
    const q = chunk.map((n) => `product_id:${n}`).join(' OR ');
    let after = null;
    for (let page = 0; page < 20; page++) {
      const d = await gqlRetry(ctx, gql, STOCK_Q, { q, after });
      for (const v of d.productVariants.nodes) {
        const s = stock[String(v.product?.id || '').split('/').pop()];
        if (!s) continue;
        for (const [k, label] of STOCK_FIELDS) {
          if (v[k]?.value == null || v[k].value === '') continue;
          s.tracked = true;
          s.by[label] = (s.by[label] || 0) + Math.max(0, Math.round(Number(v[k].value)) || 0);
        }
      }
      if (!d.productVariants.pageInfo.hasNextPage) break;
      after = d.productVariants.pageInfo.endCursor;
    }
    for (const n of chunk) stockCache.set(`${shop}:${n}`, { at: now, v: stock[n] });
  }
  return { stock };
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
