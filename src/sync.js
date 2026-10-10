// 执行动作带出来的「副作用」:写 Shopify 条目 / 更新轮播位置 / 删除条目 / 发飞书。
// 每个店铺一把锁:动作 + 副作用 + 定时器一轮都排队执行,避免两个请求交错把对方的改动覆盖掉。
import { load, replace } from './schedule-store.js';
import { desiredPublishStatus, effectiveWindow, campaignIndex } from './schedule-core.js';
import { findItem, LIST, titleOf } from './schedule-actions.js';
import { upsertItem, upsertTab, setPosition, removeEntry, TYPE_OF } from './metaobjects.js';
import { createImageFromUrl } from './files.js';
import { graphql } from './shopify.js';
import { eventMessages, deliver } from './notifier.js';

const locks = new Map();
export function withLock(shop, fn) {
  const prev = locks.get(shop) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(shop, run.catch(() => {}));
  return run;
}

// 把一条已批准的内容写进 Shopify(新建或更新),并按此刻应有的状态设 ACTIVE / DRAFT。直接改 state 里的这条。
export async function syncItem(ctx, state, it, { gql = graphql, now = Date.now(), seen = new Set() } = {}) {
  if (seen.has(it.id)) return; seen.add(it.id);
  const camps = campaignIndex(state.campaigns);
  let campaignGid = '';
  if (it.campaign) {
    const c = camps.get(it.campaign);
    if (c && c.state === 'approved' && !c.shopifyId) await syncItem(ctx, state, c, { gql, now, seen });
    campaignGid = c?.shopifyId || '';
  }
  if (it.kind === 'banner' && !it.imageId && it.image) {
    const f = await createImageFromUrl(ctx, it.image, gql);
    it.imageId = f.id; if (f.url) it.image = f.url;
  }
  // 首页商品模块:先把每个页签写成条目,版本再按顺序引用它们;去掉的页签把店里的条目也删掉
  let tabGids = [];
  if (it.kind === 'pmodule') {
    for (const tab of it.tabs || []) { tab.shopifyId = await upsertTab(ctx, tab, gql); tabGids.push(tab.shopifyId); }
  }
  const status = desiredPublishStatus(it, camps, now);
  const r = await upsertItem(ctx, it, { status, win: effectiveWindow(it, camps), campaignGid, tabGids }, gql);
  Object.assign(it, { shopifyId: r.id, syncedStatus: r.status, syncedAt: now, syncError: null });
  if (it.kind === 'pmodule') {
    for (const old of (it.syncedTabIds || []).filter((x) => !tabGids.includes(x))) await removeEntry(ctx, old, gql).catch(() => {});
    it.syncedTabIds = tabGids;
  }
}

const KIND_ORDER = { campaign: 0, tbstyle: 1, banner: 2, topbar: 3, pmodule: 4, pin: 5 };

// 在锁内调用。state 会被修改,调用方负责保存。
export async function runEffects(ctx, state, effects, { gql = graphql, now = Date.now(), appUrl = '', send } = {}) {
  const errors = [];
  const ids = [...new Set(effects.filter((e) => e.type === 'sync').map((e) => e.id))]
    .map((id) => findItem(state, id)).filter((it) => it && it.state === 'approved' && TYPE_OF[it.kind]) // 设计需求 / 物料只在 app 里
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const seen = new Set();
  for (const it of ids) {
    try { await syncItem(ctx, state, it, { gql, now, seen }); }
    catch (e) { it.syncError = String(e.message || e); errors.push(`${titleOf(it)}:${it.syncError}`); }
  }
  for (const e of effects.filter((x) => x.type === 'syncOrder')) {
    for (const it of state[LIST[e.kind]].filter((x) => x.state === 'approved' && x.shopifyId)) {
      try { await setPosition(ctx, it.shopifyId, it.order, gql); }
      catch (err) { errors.push(`${titleOf(it)} 的位置:${err.message}`); }
    }
  }
  for (const e of effects.filter((x) => x.type === 'remove')) {
    try { await removeEntry(ctx, e.shopifyId, gql); }
    catch (err) { errors.push(`删除 Shopify 条目失败:${err.message}`); }
  }
  const msgs = effects.filter((x) => x.type === 'notify').flatMap((x) => eventMessages(state, x, { appUrl, now }));
  const lark = await deliver(state, msgs, { send, now });
  return { errors, larkErrors: lark.errors };
}

// 一个完整的「动作」:锁 → 读 → 改 → 先存(本地立即生效)→ 写 Shopify → 再存(记下 Shopify id / 错误)
export function performAction(shop, ctx, fn, opts = {}) {
  return withLock(shop, async () => {
    const state = load(shop);
    const { doc, effects, message, id } = fn(state);
    const merged = { ...state, ...doc };
    replace(shop, merged);
    const r = await runEffects(ctx, merged, effects, opts);
    replace(shop, merged);
    return { state: merged, message, id, syncErrors: r.errors, larkErrors: r.larkErrors };
  });
}
