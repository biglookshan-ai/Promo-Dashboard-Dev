// Read-only inventory + consistency checks for the promotion data model.
// Shared by the embedded app (/api/inventory) and the CLI (scripts/inventory.mjs).
// runInventory(ctx) -> structured JSON; no file IO here (callers persist if needed).
import { graphql } from './shopify.js';

const ACTIVITY_TYPE = 'product_activity_event';
const PROMO_TYPE = 'promotion_info';
// Product reverse-reference metafields (from the admin definitions).
const REF_KEYS = ['product_activity_event', 'promotion_tag'];
// Standalone time metafields — keys discovered dynamically, these are hints.
const TIME_KEY_HINTS = ['offer_start', 'offer_end', 'start_time', 'end_time'];

async function getDefinition(ctx, type) {
  const d = await graphql(
    ctx,
    `query($type:String!){ metaobjectDefinitionByType(type:$type){
       id name type
       fieldDefinitions{ key name required type{ name } }
    }}`,
    { type }
  );
  return d.metaobjectDefinitionByType;
}

async function getEntries(ctx, type) {
  const out = [];
  let cursor = null;
  do {
    const d = await graphql(
      ctx,
      `query($type:String!,$cursor:String){
        metaobjects(type:$type, first:50, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{
            id handle displayName updatedAt
            fields{
              key value type
              references(first:100){ nodes{ __typename ... on Product{ id title handle status } } }
            }
          }
        }
      }`,
      { type, cursor }
    );
    const c = d.metaobjects;
    out.push(...c.nodes);
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

async function getProductMetafieldDefs(ctx) {
  const d = await graphql(
    ctx,
    `query{ metafieldDefinitions(first:100, ownerType:PRODUCT, namespace:"custom"){
       nodes{ key name type{ name } } } }`
  );
  return d.metafieldDefinitions.nodes;
}

function pickTimeKeys(defs) {
  return defs
    .filter((x) => {
      const s = (x.key + ' ' + x.name).toLowerCase();
      return TIME_KEY_HINTS.some((h) => s.includes(h)) && x.type.name.includes('date');
    })
    .map((x) => x.key);
}

async function scanProducts(ctx, timeKeys, onProgress) {
  const wanted = [...new Set([...REF_KEYS, ...timeKeys])];
  const aliasLines = wanted
    .map((k, i) => `m${i}: metafield(namespace:"custom", key:"${k}"){ value type }`)
    .join('\n');
  const hits = [];
  let cursor = null;
  let scanned = 0;
  do {
    const d = await graphql(
      ctx,
      `query($cursor:String){
        products(first:50, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{ id title handle status ${aliasLines} }
        }
      }`,
      { cursor }
    );
    const c = d.products;
    for (const p of c.nodes) {
      scanned++;
      const mf = {};
      wanted.forEach((k, i) => {
        const v = p[`m${i}`];
        if (v && v.value != null && v.value !== '') mf[k] = v.value;
      });
      if (Object.keys(mf).length) hits.push({ id: p.id, title: p.title, handle: p.handle, status: p.status, mf });
    }
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
    if (onProgress) onProgress(scanned, hits.length);
  } while (cursor);
  return { scanned, hits, wanted };
}

// ---- field helpers ----
const fieldVal = (node, key) => (node.fields.find((f) => f.key === key) || {}).value;
const fieldRefs = (node, key) =>
  ((node.fields.find((f) => f.key === key) || {}).references?.nodes || []).filter((n) => n.__typename === 'Product');

function findKey(def, hints, typeIncludes) {
  if (!def) return null;
  for (const fd of def.fieldDefinitions) {
    const s = (fd.key + ' ' + fd.name).toLowerCase();
    if (hints.some((h) => s.includes(h)) && (!typeIncludes || fd.type.name.toLowerCase().includes(typeIncludes)))
      return fd.key;
  }
  return null;
}

export async function runInventory(ctx, { onProgress } = {}) {
  const [actDef, promoDef, prodDefs] = await Promise.all([
    getDefinition(ctx, ACTIVITY_TYPE),
    getDefinition(ctx, PROMO_TYPE),
    getProductMetafieldDefs(ctx),
  ]);
  const timeKeys = pickTimeKeys(prodDefs);

  const [actEntries, promoEntries] = await Promise.all([
    actDef ? getEntries(ctx, ACTIVITY_TYPE) : [],
    promoDef ? getEntries(ctx, PROMO_TYPE) : [],
  ]);

  const { scanned, hits, wanted } = await scanProducts(ctx, timeKeys, onProgress);

  const actKeys = {
    start: findKey(actDef, ['start'], 'date'),
    end: findKey(actDef, ['end'], 'date'),
    active: findKey(actDef, ['active', 'status'], null),
    title: findKey(actDef, ['card title', 'title'], null),
    products: findKey(actDef, ['product'], 'product'),
  };
  const promoKeys = {
    title: findKey(promoDef, ['title'], null),
    products: findKey(promoDef, ['product'], 'product'),
    search: findKey(promoDef, ['search'], null),
  };

  // Forward index: which metaobject entries list each product.
  const listedBy = new Map();
  const indexEntry = (entries, key, label) => {
    if (!key) return;
    for (const e of entries) {
      for (const p of fieldRefs(e, key)) {
        if (!listedBy.has(p.id)) listedBy.set(p.id, []);
        listedBy.get(p.id).push(`${label}:${e.handle}`);
      }
    }
  };
  indexEntry(actEntries, actKeys.products, 'event');
  indexEntry(promoEntries, promoKeys.products, 'promo');

  const hitById = new Map(hits.map((h) => [h.id, h]));
  const now = Date.now();

  // Resolve a product's REF_KEYS metafield values (GID or JSON list of GIDs)
  // back to the metaobject handle they point at.
  const metaHandle = new Map();
  for (const e of [...actEntries, ...promoEntries]) metaHandle.set(e.id, e.handle);
  const refTargets = (hit) => {
    const out = [];
    for (const k of REF_KEYS) {
      const v = hit.mf[k];
      if (!v) continue;
      let gids;
      try { const j = JSON.parse(v); gids = Array.isArray(j) ? j : [j]; } catch { gids = [v]; }
      for (const g of gids) out.push(metaHandle.get(g) || String(g).split('/').pop());
    }
    return out;
  };

  const orphanTimers = hits.filter(
    (h) => timeKeys.some((k) => h.mf[k]) && !REF_KEYS.some((k) => h.mf[k])
  );
  // Group orphan timers by their (start,end) signature — products sharing a
  // window are almost certainly one campaign, so they can be fixed in one batch.
  const startKey = timeKeys.find((k) => k.includes('start'));
  const endKey = timeKeys.find((k) => k.includes('end'));
  const gmap = new Map();
  for (const h of orphanTimers) {
    const start = startKey ? h.mf[startKey] || '' : '';
    const end = endKey ? h.mf[endKey] || '' : '';
    const key = start + '|' + end;
    if (!gmap.has(key)) gmap.set(key, { start, end, expired: end ? Date.parse(end) < now : false, products: [] });
    gmap.get(key).products.push({ title: h.title, handle: h.handle });
  }
  const orphanGroups = [...gmap.values()].sort((a, b) => b.products.length - a.products.length);

  const missingReverse = [];
  for (const [gid, labels] of listedBy) {
    const h = hitById.get(gid);
    const hasRef = h && REF_KEYS.some((k) => h.mf[k]);
    if (!hasRef) missingReverse.push({ gid, labels });
  }
  const refButNotListed = hits
    .filter((h) => REF_KEYS.some((k) => h.mf[k]) && !listedBy.has(h.id))
    .map((h) => ({ title: h.title, handle: h.handle, targets: refTargets(h) }));
  // Empty/invalid activity entries: no dates AND/OR zero products attached.
  const emptyActivities = actEntries
    .map((e) => ({
      handle: e.handle,
      title: fieldVal(e, actKeys.title) || e.displayName || '',
      noDates: !fieldVal(e, actKeys.start) && !fieldVal(e, actKeys.end),
      productCount: actKeys.products ? fieldRefs(e, actKeys.products).length : 0,
    }))
    .filter((e) => e.noDates || e.productCount === 0);
  const noDates = actEntries
    .filter((e) => !fieldVal(e, actKeys.start) && !fieldVal(e, actKeys.end))
    .map((e) => e.handle);
  const expiredActive = actEntries
    .filter((e) => {
      const active = String(fieldVal(e, actKeys.active)).toLowerCase() === 'true';
      const end = fieldVal(e, actKeys.end);
      return active && end && Date.parse(end) < now;
    })
    .map((e) => ({ handle: e.handle, end: fieldVal(e, actKeys.end) }));

  const mfCounts = {};
  for (const k of wanted) mfCounts[k] = hits.filter((h) => h.mf[k]).length;

  // Flatten entries into compact rows for UI tables.
  const actRows = actEntries.map((e) => ({
    handle: e.handle,
    title: fieldVal(e, actKeys.title) || e.displayName || '',
    start: actKeys.start ? fieldVal(e, actKeys.start) || '' : '',
    end: actKeys.end ? fieldVal(e, actKeys.end) || '' : '',
    active: actKeys.active ? fieldVal(e, actKeys.active) || '' : '',
    productCount: actKeys.products ? fieldRefs(e, actKeys.products).length : 0,
  }));
  const promoRows = promoEntries.map((e) => ({
    handle: e.handle,
    title: fieldVal(e, promoKeys.title) || e.displayName || '',
    search: promoKeys.search ? fieldVal(e, promoKeys.search) || '' : '',
    productCount: promoKeys.products ? fieldRefs(e, promoKeys.products).length : 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    shop: ctx.shop,
    definitions: { activity: actDef, promotion: promoDef, productMetafields: prodDefs, timeKeys },
    resolvedKeys: { activity: actKeys, promotion: promoKeys },
    counts: {
      activityEntries: actEntries.length,
      promotionEntries: promoEntries.length,
      productsScanned: scanned,
      productsWithPromoMetafields: hits.length,
      metafields: mfCounts,
    },
    tables: { activity: actRows, promotion: promoRows },
    groups: { orphanGroups, startKey, endKey },
    checks: { orphanTimers, missingReverse, refButNotListed, noDates, expiredActive, emptyActivities },
    raw: { entries: { activity: actEntries, promotion: promoEntries }, hits },
  };
}
