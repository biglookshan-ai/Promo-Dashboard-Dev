// 执行器对 Shopify 的全部读写(只有这几样,别在别处另写改价代码):
//   读变体现价 / 改一个产品的变体价格 / 查产品在不在合集里 / 往手动合集加产品 / 从手动合集移出产品
import { graphql as rawGraphql } from '../shopify.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 被 Shopify 限流(THROTTLED / 429)就等一下重试;批量改几百个产品时会碰到
async function graphql(ctx, query, variables) {
  for (let attempt = 0; ; attempt++) {
    try { return await rawGraphql(ctx, query, variables); }
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
    if (e) throw new Error(`加入合集失败:${e.message}`);
  }
}

export async function removeFromCollection(ctx, collectionId, productIds) {
  for (const part of chunk(productIds, 250)) {
    const d = await graphql(ctx, `mutation($id: ID!, $p: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $p) { userErrors { message } } }`, { id: collectionId, p: part });
    const e = d.collectionRemoveProducts?.userErrors?.[0];
    if (e) throw new Error(`移出合集失败:${e.message}`);
  }
}

export const realIO = { readVariants, writeProductVariants, productsInCollection, addToCollection, removeFromCollection };
