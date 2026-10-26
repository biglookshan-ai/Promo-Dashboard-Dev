// 联合推广的两个合集(2026-10-23 用户:不想去 Shopify 后台建合集;KitBundle 折扣要能一键设好)
//   createJointCollection:在 app 里直接建手动合集(兼容产品那个套活动页模板 joint-promo),能发布就顺手发布到网店。
//     发布要 write_publications / read_publications 权限;没有就只建不发布,页面给后台直达链接让人勾一下「网店」。
//   jointDealStatus:看 KitBundle 的加购优惠有没有生效 —— 读兼容产品上 KitBundle 写的标记(custom.gift_trigger),
//     找 kind = "deal" 且打折产品是推广产品合集里的那条。只读,不用接 KitBundle 的接口。
import { NEW_COLLECTIONS } from './shopify.js';

const nid = (x) => String(x ?? '').split('/').pop();
const gid = (type, id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${nid(id)}`);
export const KITBUNDLE_APP = 'f7b9d6e29086498ce53bd02ed0d8ff44'; // KitBundle 的 client id(后台链接 /apps/<它>/… 可以直接打开)
export const LANDING_TEMPLATE = 'joint-promo';

const CREATE = NEW_COLLECTIONS
  ? 'mutation($c: CollectionCreateInput!) { collectionCreate(collection: $c) { collection { id title handle } userErrors { field message } } }'
  : 'mutation($c: CollectionInput!) { collectionCreate(input: $c) { collection { id title handle } userErrors { field message } } }';
const PUBS = '{ publications(first: 30) { nodes { id name catalog { title } } } }';
const PUBLISH = 'mutation($id: ID!, $p: [PublicationInput!]!) { publishablePublish(id: $id, input: $p) { userErrors { field message } } }';
const denied = (e) => /access denied|read_publications|write_publications|not approved/i.test(String(e?.message || e));

export async function createJointCollection(ctx, { title, landing = false }, gql) {
  const t = String(title || '').trim();
  if (!t) throw new Error('请填 Collection 名称');
  if (t.length > 255) throw new Error('Collection 名称太长了');
  const input = { title: t, sortOrder: 'MANUAL', ...(landing ? { templateSuffix: LANDING_TEMPLATE } : {}) };
  const d = await gql(ctx, CREATE, { c: input });
  const e = d.collectionCreate?.userErrors?.[0];
  if (e) throw new Error(e.message);
  const c = d.collectionCreate.collection;
  // 发布到网店(没有发布权限就算了,交给人在后台勾一下)
  let published = false; let why = '';
  try {
    const pubs = (await gql(ctx, PUBS)).publications?.nodes || [];
    const online = pubs.find((p) => /online store/i.test(`${p.name || ''} ${p.catalog?.title || ''}`));
    if (!online) why = '找不到「网店」这个销售渠道';
    else {
      const r = await gql(ctx, PUBLISH, { id: c.id, p: [{ publicationId: online.id }] });
      const pe = r.publishablePublish?.userErrors?.[0];
      if (pe) why = pe.message; else published = true;
    }
  } catch (err) {
    why = denied(err) ? 'app 还没开「发布」权限' : String(err.message || err); // 权限名:read_publications / write_publications
  }
  return { collection: { id: c.id, title: c.title, handle: c.handle }, published, why, landing };
}

// KitBundle 的加购优惠有没有在这批兼容产品上生效
//   lensIds:兼容产品合集里的产品(取前 20 个看);promoIds:推广产品合集里的产品
//   → { status: 'none' | 'active', campaignId, pct, stamped, checked }
export async function jointDealStatus(ctx, { lensCollectionId, promoCollectionId }, gql) {
  const read = async (cid, n) => {
    const d = await gql(ctx, `query($id: ID!, $n: Int!) { collection(id: $id) { products(first: $n) { nodes { id
      gt: metafield(namespace: "custom", key: "gift_trigger") { value } } } } }`, { id: gid('Collection', cid), n });
    return d.collection?.products?.nodes || [];
  };
  const [lens, promo] = await Promise.all([read(lensCollectionId, 20), read(promoCollectionId, 50)]);
  const promoIds = new Set(promo.map((p) => nid(p.id)));
  let hit = null; let stamped = 0;
  for (const p of lens) {
    let entries = [];
    try { entries = JSON.parse(p.gt?.value || '[]'); } catch { entries = []; }
    const deal = (Array.isArray(entries) ? entries : []).find((e) => e?.kind === 'deal' && (e.giftIds || []).some((t) => promoIds.has(String(t))));
    if (deal) { stamped++; hit ||= deal; }
  }
  return { status: hit ? 'active' : 'none', campaignId: hit?.id || '', pct: hit ? Number(hit.pct) || 0 : 0, stamped, checked: lens.length };
}
