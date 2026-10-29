// 执行器对 Shopify 的全部读写(只有这几样,别在别处另写改价代码):
//   读变体现价 / 改一个产品的变体价格 / 查产品在不在合集里 / 往手动合集加产品 / 从手动合集移出产品
import { graphql as rawGraphql } from '../shopify.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 被 Shopify 限流(THROTTLED / 429)就等一下重试;批量改几百个产品时会碰到
async function graphql(ctx, query, variables, opts) {
  for (let attempt = 0; ; attempt++) {
    try { return await rawGraphql(ctx, query, variables, opts); }
    catch (e) {
      if (attempt >= 5 || !/THROTTLED|HTTP 429/.test(String(e.message))) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// → Map 变体 id → { price, compareAt, productId, title, sku }(查不到的不在 Map 里)
export async function readVariants(ctx, ids) {
  const out = new Map();
  for (const part of chunk([...new Set(ids)], 250)) {
    const d = await graphql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant {
      id price compareAtPrice sku displayName product { id title } } } }`, { ids: part });
    for (const n of d.nodes || []) {
      if (n?.id) out.set(n.id, { price: n.price, compareAt: n.compareAtPrice, productId: n.product?.id, title: n.displayName || n.product?.title || '', sku: n.sku || '' });
    }
  }
  return out;
}

// 改一个产品的若干变体。返回 Map 变体 id → 错误信息(没错的不在里面)
export async function writeProductVariants(ctx, productId, variants) {
  const d = await graphql(ctx, `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id } userErrors { field message } } }`,
  { productId, variants: variants.map((v) => ({ id: v.id, price: v.price, compareAtPrice: v.compareAt })) });
  const errs = new Map();
  for (const e of d.productVariantsBulkUpdate?.userErrors || []) {
    // field 形如 ["variants","0","price"];对不上具体变体就算整批失败
    const i = Number((e.field || [])[1]);
    if (Number.isInteger(i) && variants[i]) errs.set(variants[i].id, e.message);
    else variants.forEach((v) => errs.set(v.id, e.message));
  }
  return errs;
}

// → Set 已在合集里的产品 id
export async function productsInCollection(ctx, collectionId, productIds) {
  const inside = new Set();
  for (const part of chunk(productIds, 250)) {
    const d = await graphql(ctx, `query($ids: [ID!]!, $c: ID!) { nodes(ids: $ids) { ... on Product { id inCollection(id: $c) } } }`, { ids: part, c: collectionId });
    for (const n of d.nodes || []) if (n?.inCollection) inside.add(n.id);
  }
  return inside;
}

export async function addToCollection(ctx, collectionId, productIds) {
  for (const part of chunk(productIds, 250)) {
    const d = await graphql(ctx, `mutation($id: ID!, $p: [ID!]!) { collectionAddProducts(id: $id, productIds: $p) { userErrors { message } } }`, { id: collectionId, p: part });
    const e = d.collectionAddProducts?.userErrors?.[0];
    if (e) throw new Error(`加入 Collection 失败:${e.message}`);
  }
}

// Collection 还在不在(被删了 Shopify 返回 null)。加入 / 移出报错时用它判断是不是 Collection 被删了
export async function collectionExists(ctx, collectionId) {
  const d = await graphql(ctx, 'query($id: ID!) { collection(id: $id) { id } }', { id: collectionId });
  return !!d.collection;
}
// 2026 新版 Collection(用户 2026-10-30 提醒):带条件的也能有「单独加入的产品」和「排除」,条件可以叠几组 —— 改价往这种 Collection 加产品 = 加进它自己的「单独加入」名单。
// ⛔ 用 2026-07 接口:2026-04 及以前看不到用了新功能的合集,会以为被删了(10/29、10/30 两次误判)
const NEW_API = '2026-07';
// → { exists, automated(带条件), srcId(它自己的条件来源;条件和别的 Collection 共用时为 null), selected(「单独加入」名单里的产品 id) }
export async function collectionModel(ctx, collectionId) {
  try {
    let after = null; const selected = new Set(); let base = null;
    for (let i = 0; i < 20; i++) {
      const d = await graphql(ctx, `query($id: ID!, $after: String) { collection(id: $id) { id ruleSet { appliedDisjunctively } sources { __typename
        ... on CollectionConditionsSource { id shareable inclusion { conditions { __typename } selections(first: 250, after: $after) { nodes { product { id } } pageInfo { hasNextPage endCursor } } } } } } }`,
      { id: collectionId, after }, { version: NEW_API });
      const c = d.collection; if (!c) return { exists: false };
      const srcs = c.sources || [];
      const own = srcs.find((x) => x.__typename === 'CollectionConditionsSource' && !x.shareable);
      base = { exists: true, automated: !!c.ruleSet || srcs.some((x) => x.__typename === 'CollectionSubCollectionsSource' || (x.inclusion?.conditions || []).length > 0), srcId: own?.id || null };
      const sel = own?.inclusion?.selections;
      for (const n of sel?.nodes || []) if (n.product?.id) selected.add(n.product.id);
      if (!sel?.pageInfo?.hasNextPage) break;
      after = sel.pageInfo.endCursor;
    }
    return { ...base, selected };
  } catch (e) {
    // 新版接口用不了:退回老接口 —— 只信「查到了」;查不到不能说它被删了(老接口看不到新版合集,10/29 就是这样误判的),当成「不确定」抛出去,下一分钟再查
    const d = await graphql(ctx, 'query($id: ID!) { collection(id: $id) { id ruleSet { appliedDisjunctively } } }', { id: collectionId });
    if (!d.collection) throw new Error(`查不到这个 Collection 的状态(${String(e.message || e).slice(0, 80)})`);
    return { exists: true, automated: !!d.collection.ruleSet, srcId: null, selected: null };
  }
}
// 带条件的 Collection:改它自己的「单独加入的产品」名单(不动条件)
const SRC_UPDATE = 'mutation($c: CollectionUpdateInput!) { collectionUpdate(collection: $c) { collection { id } userErrors { field message } } }';
async function srcSelections(ctx, collectionId, srcId, op, productIds) {
  for (const part of chunk(productIds, 100)) {
    const d = await graphql(ctx, SRC_UPDATE, { c: { id: collectionId, sourcesToUpdate: [{ condition: { id: srcId, inclusion: { [op]: part.map((p) => ({ productId: p })) } } }] } }, { version: NEW_API });
    const e = d.collectionUpdate?.userErrors?.[0];
    if (e) throw new Error(`${op === 'selectionsToAdd' ? '加入' : '移出'} Collection 失败:${e.message}`);
  }
}
export const includeProducts = (ctx, collectionId, srcId, ids) => srcSelections(ctx, collectionId, srcId, 'selectionsToAdd', ids);
export const unincludeProducts = (ctx, collectionId, srcId, ids) => srcSelections(ctx, collectionId, srcId, 'selectionsToRemove', ids);

export async function removeFromCollection(ctx, collectionId, productIds) {
  for (const part of chunk(productIds, 250)) {
    const d = await graphql(ctx, `mutation($id: ID!, $p: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $p) { userErrors { message } } }`, { id: collectionId, p: part });
    const e = d.collectionRemoveProducts?.userErrors?.[0];
    if (e) throw new Error(`移出 Collection 失败:${e.message}`);
  }
}



// ---- 产品标签(改价时顺便加减;只动计划里填的那几个标签)----
export async function readProductTags(ctx, productIds) {
  const out = new Map();
  for (const part of chunk([...new Set(productIds)], 250)) {
    const d = await graphql(ctx, 'query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id tags } } }', { ids: part });
    for (const n of d.nodes || []) if (n?.id) out.set(n.id, n.tags || []);
  }
  return out;
}
export async function addTags(ctx, id, tags) {
  const d = await graphql(ctx, 'mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }', { id, tags });
  const e = d.tagsAdd?.userErrors?.[0]; if (e) throw new Error(`加标签失败:${e.message}`);
}
export async function removeTags(ctx, id, tags) {
  const d = await graphql(ctx, 'mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }', { id, tags });
  const e = d.tagsRemove?.userErrors?.[0]; if (e) throw new Error(`去标签失败:${e.message}`);
}

// ---- 改价倒计时:产品字段 custom.cgp_price_cd(json),计划开始改价时写、结束 / 暂停 / 提前结束时删(2026-10-27 用户同意)----
const CD_KEY = { namespace: 'custom', key: 'cgp_price_cd' };
const productGid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`);
// list = [{ productId, value }];返回写成功的 productId
export async function setCountdowns(ctx, list) {
  const ok = [];
  for (const part of chunk(list, 25)) {
    const d = await graphql(ctx, `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { owner { ... on Product { id } } } userErrors { field message } } }`,
      { m: part.map((x) => ({ ownerId: productGid(x.productId), ...CD_KEY, type: 'json', value: x.value })) });
    const e = d.metafieldsSet?.userErrors?.[0];
    if (e) throw new Error(`写倒计时失败:${e.message}`);
    ok.push(...part.map((x) => x.productId));
  }
  return ok;
}
export async function deleteCountdowns(ctx, productIds) {
  const ok = [];
  for (const part of chunk(productIds, 25)) {
    const d = await graphql(ctx, `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { deletedMetafields { key } userErrors { field message } } }`,
      { m: part.map((id) => ({ ownerId: productGid(id), ...CD_KEY })) });
    const e = d.metafieldsDelete?.userErrors?.[0];
    if (e) throw new Error(`删倒计时失败:${e.message}`);
    ok.push(...part);
  }
  return ok;
}

export const realIO = { readVariants, writeProductVariants, productsInCollection, addToCollection, removeFromCollection, collectionExists, collectionModel, includeProducts, unincludeProducts, readProductTags, addTags, removeTags, setCountdowns, deleteCountdowns };
