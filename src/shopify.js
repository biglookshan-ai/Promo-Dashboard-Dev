// Shopify Admin API GraphQL client. ctx = { shop, token } resolved per-request
// from the App Bridge session token (see auth-embedded.js), or from a fixed
// SHOPIFY_ADMIN_TOKEN for CLI use.
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
export const API_VERSION = VERSION;
// 2026-07 起合集有了新模型(Collection.sources:条件 + 单独加的产品 + 排除);旧版本的接口看不到用了新功能的合集
export const NEW_COLLECTIONS = VERSION >= '2026-07';
// 只给本地测试环境用(scripts/live-harness.mjs 的假 Shopify);线上不设这个变量
const ORIGIN = process.env.SHOPIFY_GRAPHQL_ORIGIN || '';

const headers = (token) => ({
  'X-Shopify-Access-Token': token,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

// version:个别查询要用新版接口时传(比如查新版合集在不在 —— 2026-07 之前的接口看不到用了新功能的合集,会以为被删了)
export async function graphql(ctx, query, variables = {}, { version = VERSION } = {}) {
  const res = await fetch(`${ORIGIN || `https://${ctx.shop}`}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: headers(ctx.token),
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 400)}`);
  return json.data;
}
