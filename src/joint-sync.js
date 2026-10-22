// 联合推广(2026-10-22):把「兼容产品」按推广块的条件同步进一个手动合集。
// 这个合集是唯一的名单 —— 兼容产品页上的卡片、活动页(就是这个合集的页面)、KitBundle 的加购优惠都认它,三处永远一致。
// 只动推广块里选的那一个合集,只加减产品,不改合集的其他设置。合集要先在 Shopify 后台建好(空的手动合集,发布到网店,模板选 joint-promo)。
// 用户 2026-10-22 选的是「app 条件为准,自动同步合集」—— 新增的写操作只有这个合集的成员。
import { calloutIds } from './counts.js';
import { readCollection, nid } from './collection-order.js';
import { itemStatus, campaignIndex } from './schedule-core.js';

const gid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Collection/${nid(id)}`);
const pgid = (id) => `gid://shopify/Product/${nid(id)}`;
const ADD = 'mutation($id: ID!, $p: [ID!]!) { collectionAddProducts(id: $id, productIds: $p) { userErrors { field message } } }';
const REMOVE = 'mutation($id: ID!, $p: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $p) { userErrors { field message } } }';
const CHUNK = 200;
export const HOURLY = 60 * 60_000;

// 这条推广块要不要同步:联合推广 + 选了兼容产品合集 + 已批准 + 正在上线或已排期(暂停 / 结束的不动合集,免得删了名单)
export const isJoint = (it) => it?.kind === 'callout' && !!it.joint && !!it.lensCollection?.id;
export const wantsSync = (it, camps, now = Date.now()) => isJoint(it) && it.state === 'approved' && ['live', 'scheduled'].includes(itemStatus(it, camps, now));

// 要加 / 要移出哪些;移出太多(超过现在的一半,而且至少 20 个)先停手,怕是条件改错了
export function syncPlan(current, target, { force = false } = {}) {
  const cur = new Set(current.map(String)); const want = new Set(target.map(String));
  const add = [...want].filter((id) => !cur.has(id));
  const remove = [...cur].filter((id) => !want.has(id));
  const held = !force && cur.size >= 20 && remove.length > cur.size / 2;
  return { add, remove, held };
}

async function run(ctx, gql, q, vars, key) {
  const d = await gql(ctx, q, vars);
  const e = d[key]?.userErrors?.[0];
  if (e) throw new Error(e.message);
}

// 同步一条。结果记在 state.jointSync[推广块 id]:{ at, collection, count, added, removed, held, error }
export async function syncJoint(ctx, state, it, { gql, now = Date.now(), force = false } = {}) {
  state.jointSync ||= {};
  const base = { at: now, collection: { id: nid(it.lensCollection.id), title: it.lensCollection.title || '' } };
  const done = (x) => (state.jointSync[it.id] = { ...base, count: 0, added: 0, removed: 0, held: false, error: '', ...x });
  try {
    const col = await readCollection(ctx, it.lensCollection.id, gql);
    if (!col) return done({ error: '找不到这个合集(可能在 Shopify 后台删掉了)' });
    base.collection.title = col.title;
    if (col.automated) return done({ count: col.ids.length, error: '这个合集带条件(自动归类),app 只能往「手动」合集里加减产品 —— 在 Shopify 后台建一个手动合集再选它' });
    const { ids: target, capped } = await calloutIds(ctx, {
      rules: it.rules, products: it.products, exProducts: it.exProducts, promo: it.promo,
      exCollections: it.promoCollection?.id ? [it.promoCollection.id] : [],
    }, gql);
    if (capped) return done({ count: col.ids.length, error: '条件命中的产品太多(超过 3000 个),没有同步 —— 把条件收窄一点' });
    if (!target.length) return done({ count: col.ids.length, error: '条件一个产品都没命中,合集没动' });
    const p = syncPlan(col.ids, target, { force });
    if (p.held) return done({ count: col.ids.length, held: true, pending: { add: p.add.length, remove: p.remove.length },
      error: `这次要从合集移出 ${p.remove.length} 个产品(超过现在的一半),怕是条件改错了,先没动 —— 确认没问题就点「仍然同步」` });
    for (let i = 0; i < p.add.length; i += CHUNK) await run(ctx, gql, ADD, { id: gid(it.lensCollection.id), p: p.add.slice(i, i + CHUNK).map(pgid) }, 'collectionAddProducts');
    for (let i = 0; i < p.remove.length; i += CHUNK) await run(ctx, gql, REMOVE, { id: gid(it.lensCollection.id), p: p.remove.slice(i, i + CHUNK).map(pgid) }, 'collectionRemoveProducts');
    return done({ count: target.length, added: p.add.length, removed: p.remove.length });
  } catch (e) {
    return done({ error: String(e.message || e) });
  }
}

// 定时器:每小时把所有要同步的联合推广对齐一次(新上架的兼容产品自动进名单)
export async function syncAllJoint(ctx, state, { gql, now = Date.now(), every = HOURLY } = {}) {
  const camps = campaignIndex(state.campaigns || []);
  const out = [];
  for (const it of state.callouts || []) {
    if (!wantsSync(it, camps, now)) continue;
    const last = state.jointSync?.[it.id]?.at || 0;
    if (now - last < every) continue;
    out.push({ id: it.id, name: it.name, ...(await syncJoint(ctx, state, it, { gql, now })) });
  }
  return out;
}
