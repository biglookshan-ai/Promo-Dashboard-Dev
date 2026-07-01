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

async function getShop(ctx) {
  const d = await graphql(ctx, `query{ shop{ myshopifyDomain primaryDomain{ url host } } }`);
  return d.shop;
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

// Shopify rich_text_field stores a JSON AST — flatten it to readable plain text.
function richToText(v) {
  let j;
  try { j = typeof v === 'string' ? JSON.parse(v) : v; } catch { return String(v || ''); }
  const walk = (n) => {
    if (!n) return '';
    if (n.type === 'text') return n.value || '';
    const inner = (n.children || []).map(walk).join('');
    if (n.type === 'link') { const url = n.url ? ` (${n.url})` : ''; return inner + url; }
    if (n.type === 'paragraph' || n.type === 'heading') return inner + '\n';
    if (n.type === 'list-item') return '• ' + inner + '\n';
    return inner;
  };
  return walk(j).replace(/\n{3,}/g, '\n\n').trim();
}

// Render every field of a metaobject entry into { key, name, type, value } rows,
// resolving rich text and product references, skipping empties.
function entryFields(entry, def) {
  const names = def ? new Map(def.fieldDefinitions.map((f) => [f.key, f.name])) : new Map();
  return entry.fields
    .map((f) => {
      const type = f.type || '';
      let value;
      const refs = (f.references?.nodes || []).filter((n) => n.__typename === 'Product');
      if (refs.length) value = refs.map((n) => n.title || n.handle).join(', ');
      else if (type.includes('rich_text')) value = richToText(f.value);
      else value = f.value || '';
      return { key: f.key, name: names.get(f.key) || f.key, type, value: String(value || '') };
    })
    .filter((f) => f.value.trim() !== '');
}

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
  const [actDef, promoDef, prodDefs, shopInfo] = await Promise.all([
    getDefinition(ctx, ACTIVITY_TYPE),
    getDefinition(ctx, PROMO_TYPE),
    getProductMetafieldDefs(ctx),
    getShop(ctx),
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
  const resolveKey = (hit, key) => {
    const v = hit.mf[key];
    if (!v) return [];
    let gids;
    try { const j = JSON.parse(v); gids = Array.isArray(j) ? j : [j]; } catch { gids = [v]; }
    return gids.map((g) => metaHandle.get(g) || String(g).split('/').pop());
  };
  const refTargets = (hit) => REF_KEYS.flatMap((k) => resolveKey(hit, k));

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

  // ---- Catalog: per definition, entry counts + in-use / unused breakdown ----
  const storeHandle = ctx.shop.replace('.myshopify.com', '');
  const storefrontUrl = (shopInfo.primaryDomain && shopInfo.primaryDomain.url) || `https://${ctx.shop}`;
  // How many products reference each metaobject entry (by handle).
  const refCount = new Map();
  for (const h of hits) for (const t of new Set(refTargets(h))) refCount.set(t, (refCount.get(t) || 0) + 1);

  const normTitle = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const metaCatalog = (entries, keys, def, type, label) => {
    const rows = entries.map((e) => {
      const own = keys.products ? fieldRefs(e, keys.products).length : 0;
      const refBy = refCount.get(e.handle) || 0;
      return {
        id: e.id.split('/').pop(),
        handle: e.handle,
        title: fieldVal(e, keys.title) || e.displayName || '',
        ownProducts: own,     // products listed inside the entry
        refByProducts: refBy, // products whose metafield points at this entry
        inUse: own > 0 || refBy > 0,
        fields: entryFields(e, def), // full content of the entry
      };
    });
    // Duplicate clusters: entries sharing a normalized title (the "-2" pattern).
    const dmap = new Map();
    for (const r of rows) {
      const k = normTitle(r.title);
      if (!dmap.has(k)) dmap.set(k, []);
      dmap.get(k).push(r);
    }
    const duplicates = [...dmap.values()]
      .filter((g) => g.length > 1)
      .map((g) => ({ title: g[0].title, count: g.length, entries: g.slice().sort((a, b) => b.inUse - a.inUse) }))
      .sort((a, b) => b.count - a.count);
    return {
      type, label, total: rows.length,
      inUse: rows.filter((r) => r.inUse).length,
      unused: rows.filter((r) => !r.inUse).length,
      duplicates,
      entries: rows,
    };
  };

  const productMetafieldCatalog = wanted.map((k) => {
    const def = prodDefs.find((d) => d.key === k);
    const list = hits.filter((h) => h.mf[k]);
    const row = { key: k, name: def ? def.name : k, type: def ? def.type.name : '', productCount: list.length, isTime: timeKeys.includes(k) };
    if (k === endKey) {
      row.valid = list.filter((h) => Date.parse(h.mf[k]) >= now).length;
      row.expired = list.filter((h) => Date.parse(h.mf[k]) < now).length;
    }
    return row;
  });

  // ---- By-product view: one row per product carrying any promo metafield ----
  const byProduct = hits.map((h) => {
    const end = endKey ? h.mf[endKey] || '' : '';
    const start = startKey ? h.mf[startKey] || '' : '';
    return {
      id: h.id.split('/').pop(),
      handle: h.handle,
      title: h.title,
      status: h.status,
      activity: resolveKey(h, 'product_activity_event'),
      promos: resolveKey(h, 'promotion_tag'),
      start,
      end,
      expired: end ? Date.parse(end) < now : false,
    };
  }).sort((a, b) => (a.expired === b.expired ? 0 : a.expired ? -1 : 1)); // expired first

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
    store: { handle: storeHandle, storefrontUrl, myshopifyDomain: shopInfo.myshopifyDomain },
    tables: { activity: actRows, promotion: promoRows },
    groups: { orphanGroups, startKey, endKey },
    catalog: {
      metaobjects: [
        metaCatalog(actEntries, actKeys, actDef, ACTIVITY_TYPE, '活动 / 体验'),
        metaCatalog(promoEntries, promoKeys, promoDef, PROMO_TYPE, '促销信息'),
      ],
      productMetafields: productMetafieldCatalog,
    },
    byProduct,
    checks: { orphanTimers, missingReverse, refButNotListed, noDates, expiredActive, emptyActivities },
    raw: { entries: { activity: actEntries, promotion: promoEntries }, hits },
  };
}
