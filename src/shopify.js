// Shopify Admin API GraphQL client. ctx = { shop, token } resolved per-request
// from the App Bridge session token (see auth-embedded.js), or from a fixed
// SHOPIFY_ADMIN_TOKEN for CLI use.
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

const headers = (token) => ({
  'X-Shopify-Access-Token': token,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

export async function graphql(ctx, query, variables = {}) {
  const res = await fetch(`https://${ctx.shop}/admin/api/${VERSION}/graphql.json`, {
    method: 'POST',
    headers: headers(ctx.token),
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 400)}`);
  return json.data;
}
