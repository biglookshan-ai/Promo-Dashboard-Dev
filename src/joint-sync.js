// 联合推广(2026-10-22):把「兼容产品」按推广块的条件同步进一个手动合集。
// 这个合集是唯一的名单 —— 兼容产品页上的卡片、活动页(就是这个合集的页面)、KitBundle 的加购优惠都认它,三处永远一致。
// 只动推广块里选的那两个合集,只加减产品,不改合集的其他设置。合集可以在编辑器里直接新建(src/joint-coll.js)。
// 用户 2026-10-22 选的是「app 条件为准,自动同步合集」—— 新增的写操作只有这两个合集的成员。
// 2026-10-23 用户:推广产品也要自动放进去 —— 「推广的产品」可以选多个(promos),app 把推广产品合集同步成正好这几个;
//   兼容产品 = 条件命中的产品,去掉推广产品。老的推广块(还没有 promos)不动推广产品合集,等人在新编辑器里保存一次。
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

// 推广的产品(新:promos 多选;老的推广块只有 promo 一个)
export const promoIdsOf = (it) => [...new Set((it?.promos?.length ? it.promos : it?.promo ? [it.promo] : []).map((p) => nid(p?.id ?? p)).filter(Boolean))];

// 把一个手动合集同步成正好 target 这些产品 → { collection, count, added, removed, held, pending, error }
async function syncMembers(ctx, gql, c, target, { force = false, emptyMsg = '' } = {}) {
  const r = { collection: { id: nid(c.id), title: c.title || '' }, count: 0, added: 0, removed: 0, held: false, error: '' };
  const col = await readCollection(ctx, c.id, gql);
  if (!col) return { ...r, error: '找不到这个 Collection(可能在 Shopify 后台删掉了)' };
  r.collection.title = col.title; r.count = col.ids.length;
  if (col.automated) return { ...r, error: '这个 Collection 带条件(自动归类),app 只能往「手动」Collection 里加减产品 —— 换一个手动 Collection(可以在这里新建)' };
  if (!target.length) return { ...r, error: emptyMsg };
  const p = syncPlan(col.ids, target, { force });
  if (p.held) return { ...r, held: true, pending: { add: p.add.length, remove: p.remove.length },
    error: `这次要从 Collection「${col.title}」移出 ${p.remove.length} 个产品(超过现在的一半),怕是设置改错了,先没动 —— 确认没问题就点「仍然同步」` };
  for (let i = 0; i < p.add.length; i += CHUNK) await run(ctx, gql, ADD, { id: gid(c.id), p: p.add.slice(i, i + CHUNK).map(pgid) }, 'collectionAddProducts');
  for (let i = 0; i < p.remove.length; i += CHUNK) await run(ctx, gql, REMOVE, { id: gid(c.id), p: p.remove.slice(i, i + CHUNK).map(pgid) }, 'collectionRemoveProducts');
  return { ...r, count: target.length, added: p.add.length, removed: p.remove.length };
}

// 同步一条:先推广产品合集(= 选的推广产品),再兼容产品合集(= 条件命中的,去掉推广产品)。
// 结果记在 state.jointSync[推广块 id]:兼容产品合集的 { at, collection, count, added, removed, held, error } + promo: 推广产品合集的同样一份
export async function syncJoint(ctx, state, it, { gql, now = Date.now(), force = false } = {}) {
  state.jointSync ||= {};
  const fail = (e) => ({ collection: null, count: 0, added: 0, removed: 0, held: false, error: String(e?.message || e) });
  let promo = null;
  if (it.promoCollection?.id && it.promos?.length) {
    try { promo = await syncMembers(ctx, gql, it.promoCollection, promoIdsOf(it), { force }); } catch (e) { promo = { ...fail(e), collection: { id: nid(it.promoCollection.id), title: it.promoCollection.title || '' } }; }
  }
  let lens;
  try {
    const { ids, capped } = await calloutIds(ctx, {
      rules: it.rules, ruleGroups: it.ruleGroups, products: it.products, exProducts: it.exProducts, promos: (it.promos?.length ? it.promos : it.promo ? [it.promo] : []),
      exCollections: it.promoCollection?.id ? [it.promoCollection.id] : [],
    }, gql);
    lens = await syncMembers(ctx, gql, it.lensCollection, capped ? [] : ids, { force,
      emptyMsg: capped ? '条件命中的产品太多(超过 3000 个),没有同步 —— 把条件收窄一点' : '条件一个产品都没命中,Collection 没动' });
  } catch (e) { lens = { ...fail(e), collection: { id: nid(it.lensCollection.id), title: it.lensCollection.title || '' } }; }
  const out = { at: now, ...lens, ...(promo ? { promo } : {}) };
  if (promo?.held) out.held = true;
  return (state.jointSync[it.id] = out);
}

// 写进操作日志的几句话(保存后 / 立即同步 / 定时器共用):两个合集各一句;all = 没变化也写
export function syncNotes(rep, { all = false } = {}) {
  const one = (x, what) => (x.error ? { failed: true, note: `同步${what}没成功:${x.error}` }
    : all || x.added || x.removed ? { failed: false, note: `${what}「${x.collection?.title || ''}」:加了 ${x.added} 个、移出 ${x.removed} 个,现在 ${x.count} 个` } : null);
  return [rep.promo ? one(rep.promo, '推广产品 Collection') : null, one(rep, '兼容产品 Collection')].filter(Boolean);
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
