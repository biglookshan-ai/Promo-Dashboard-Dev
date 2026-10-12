// 合集排序:到点真的把店里的合集改成清单排好的顺序,结束再还原。
//
// 两种执行方式(编辑器里会写明这份清单走哪种):
//   · 手动合集(Shopify 里排序方式 = 手动)→ **真的改店里的合集**:把清单里的产品移到最前面、
//     勾了「这次不显示」的产品临时移出合集。后台、导出、别的 app 看到的都一致。
//   · 按条件自动归类的合集 → Shopify 不让手动排序,只能由主题在前台排(清单照样写进 metaobject)。
//
// 安全:
//   · 动手前先存一份**原始顺序快照**(整串产品 id),还原就按它来,移出去的加回原位。
//   · 每轮只在「该是什么样」和「现在是什么样」不一致时才写;一致就什么都不做。
//   · 有人在 Shopify 后台手动改过顺序(我们排在最前的那几个不在最前了)→ **暂停接管**,
//     不覆盖别人的改动,记日志 + 通知,等人处理。
//   · 清单结束 / 暂停 / 删除 / 退回 → 下一轮自动还原,还原完清掉记录。
import { itemStatus, campaignIndex, effectiveWindow } from './schedule-core.js';
import { diffOrder } from './order-diff.js';
import { NEW_COLLECTIONS } from './shopify.js';

export const nid = (x) => String(x ?? '').split('/').pop();
const gid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Collection/${id}`);
const pgid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`);

// ---------- 纯规则(可单测) ----------

// 这一刻每个合集该用哪份清单:生效中的里面开始时间最晚的赢(和主题里的规则一致)
export function livePins(pins, campaigns, now) {
  const camps = campaignIndex(campaigns);
  const by = new Map();
  for (const p of pins) {
    if (p.state !== 'approved' || p.paused || !p.collection) continue;
    if (itemStatus(p, camps, now) !== 'live') continue;
    const c = nid(p.collection.id);
    // 开始时间晚的赢;一样的话先建的那份赢(和页面上显示的「这一刻按哪份排」一致;跟随活动的按活动的开始时间算)
    const at = effectiveWindow(p, camps).start ?? 0;
    const cur = by.get(c);
    if (!cur || at > cur.at) by.set(c, { pin: p, at });
  }
  return new Map([...by].map(([c, x]) => [c, x.pin])); // Map<collectionId(数字), pin>
}

// 想要的样子:清单里的排最前(只算现在还在合集里的),其余照原顺序;勾了隐藏的要移出合集。
// 勾了「只显示清单里的产品」→ 除了清单里的,其余全部临时移出合集(真的改合集时才这样;数量太多会退回前台方式)。
export function desiredOrder(snapshotIds, currentIds, pin) {
  const cur = currentIds.map(nid);
  const have = new Set(cur);
  const listed = new Set((pin.products || []).map((p) => nid(p.id)));
  const hide = new Set((pin.hidden || []).map((p) => nid(p.id)));
  if (pin.onlyListed) for (const id of cur) if (!listed.has(id)) hide.add(id);
  const head = []; const add = [];   // add = 清单里排了、但现在不在这个合集里的 → 要加进合集
  const used = new Set();
  for (const p of pin.products || []) {
    const id = nid(p.id);
    if (hide.has(id) || used.has(id)) continue;
    if (!have.has(id)) add.push(id);
    head.push(id); used.add(id);
  }
  const tail = [];
  for (const id of (snapshotIds || []).map(nid)) if (have.has(id) && !used.has(id) && !hide.has(id)) { tail.push(id); used.add(id); }
  for (const id of cur) if (!used.has(id) && !hide.has(id)) { tail.push(id); used.add(id); } // 期间新加进合集的排最后
  return { order: [...head, ...tail], remove: cur.filter((id) => hide.has(id)), add, pinned: head };
}

// 还原的样子:照快照的顺序(只算现在还在的),快照里没有的(后来加的)排最后
export function restoreOrder(snapshotIds, currentIds) {
  const cur = currentIds.map(nid); const have = new Set(cur); const used = new Set();
  const out = [];
  for (const id of (snapshotIds || []).map(nid)) if (have.has(id) && !used.has(id)) { out.push(id); used.add(id); }
  for (const id of cur) if (!used.has(id)) { out.push(id); used.add(id); }
  return out;
}

// 要发给 Shopify 的 move(依次插入):只动「最长递增子序列」以外的产品,每个插到它在目标里前一个产品的后面。
// 这样把第 50 拖到第 20 只发 1 个 move;还原时把 3 个挪回原位也只发 3 个(不会因为前面挤了几个就把后面全部重排一遍)。
export function movesFor(currentIds, wantIds) {
  const inWant = new Set(wantIds.map(nid));
  const arr = currentIds.map(nid).filter((id) => inWant.has(id));
  const inArr = new Set(arr);
  const W = wantIds.map(nid).filter((id) => inArr.has(id)); // 只排两边都有的
  const moving = diffOrder(arr, W).moved;
  const out = [];
  W.forEach((id, t) => {
    if (!moving.has(id)) return;
    arr.splice(arr.indexOf(id), 1);
    const pos = t === 0 ? 0 : arr.indexOf(W[t - 1]) + 1;
    arr.splice(pos, 0, id);
    out.push({ id: pgid(id), newPosition: String(pos) });
  });
  return arr.join() === W.join() ? out : greedyMoves(currentIds, W); // 保险:模拟出来不对就用逐个排的老办法
}
function greedyMoves(currentIds, W) {
  const inW = new Set(W);
  const arr = currentIds.map(nid).filter((id) => inW.has(id));
  const out = [];
  W.forEach((id, pos) => {
    const at = arr.indexOf(id);
    if (at === -1 || at === pos) return;
    arr.splice(at, 1); arr.splice(pos, 0, id);
    out.push({ id: pgid(id), newPosition: String(pos) });
  });
  return out;
}

// 有人在后台手动动过吗:我们排在最前面的那几个,现在还在最前面吗
export function driftedFrom(wroteOrder, currentIds) {
  const cur = currentIds.map(nid);
  const head = (wroteOrder || []).map(nid);
  for (let i = 0; i < head.length; i++) if (cur[i] !== head[i]) return true;
  return false;
}

// ---------- 和 Shopify 打交道 ----------

// 合集有没有「条件」:旧接口看 ruleSet;2026-07 起还要看 sources(条件 / 子合集来源)
export const RULES = NEW_COLLECTIONS
  ? 'ruleSet { appliedDisjunctively } sources { __typename ... on CollectionConditionsSource { id shareable inclusion { conditions { __typename } } } }'
  : 'ruleSet { appliedDisjunctively }';
// 带条件的合集里,可以改「单独加的产品 / 排除」名单的那个来源:合集自己的条件来源(共享的来源会连带改到别的合集,不碰)
export const ownSource = (c) => (c.sources || []).find((x) => x.__typename === 'CollectionConditionsSource' && !x.shareable)?.id || null;
const COL_Q = `query($id: ID!, $after: String) { collection(id: $id) { id title sortOrder ${RULES}
    products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) { nodes { id } pageInfo { hasNextPage endCursor } } } }`;
const REORDER = `mutation($id: ID!, $moves: [MoveInput!]!) { collectionReorderProducts(id: $id, moves: $moves) { job { id } userErrors { field message } } }`;
const REMOVE = `mutation($id: ID!, $p: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $p) { userErrors { field message } } }`;
const ADD = `mutation($id: ID!, $p: [ID!]!) { collectionAddProducts(id: $id, productIds: $p) { userErrors { field message } } }`;
// 只有「单独加的产品」不算条件;有条件、或者从别的合集取产品,才算
export const hasRules = (c) => !!c.ruleSet || (c.sources || []).some((x) => x.__typename === 'CollectionSubCollectionsSource' || (x.inclusion?.conditions || []).length > 0);

export async function readCollection(ctx, id, gql) {
  let after = null; const ids = []; let info = null;
  for (let i = 0; i < 8; i++) {
    const d = await gql(ctx, COL_Q, { id: gid(id), after });
    const c = d.collection;
    if (!c) return null;
    info = { id: c.id, title: c.title, sortOrder: c.sortOrder, automated: hasRules(c), srcId: ownSource(c) };
    ids.push(...c.products.nodes.map((n) => nid(n.id)));
    if (!c.products.pageInfo.hasNextPage) break;
    after = c.products.pageInfo.endCursor;
  }
  // 新版合集(2026):只要排序方式是「手动」,带条件的合集也能用接口调顺序(collectionReorderProducts 只要求 sortOrder = MANUAL)。
  //   manualOk     = 能真的调店里的顺序
  //   membershipOk = 纯手动合集,用 collectionAdd/RemoveProducts 加减产品
  //   selectionOk  = 带条件的合集,改它的「单独加的产品 / 排除」名单加减产品(要 API 2026-07)
  const manualOk = info.sortOrder === 'MANUAL';
  const membershipOk = manualOk && !info.automated;
  // 带条件的合集:API 2026-07 起可以改它自己的「单独加的产品 / 排除」名单
  const selectionOk = manualOk && info.automated && NEW_COLLECTIONS && !!info.srcId;
  return { ...info, ids, manualOk, membershipOk, selectionOk, via: membershipOk ? 'manual' : selectionOk ? 'sources' : null };
}

const CHUNK = 200;
export const MAX_REMOVE = 100; // 一份清单最多临时移出这么多产品,再多就不动店里的合集(交给前台排)
const SETTLE_MS = 15 * 60_000; // 带条件的合集:加进 / 排除的产品 Shopify 在后台慢慢算,最多等 15 分钟
async function reorder(ctx, id, moves, gql) {
  for (let i = 0; i < moves.length; i += CHUNK) {
    const d = await gql(ctx, REORDER, { id: gid(id), moves: moves.slice(i, i + CHUNK) });
    const e = d.collectionReorderProducts?.userErrors?.[0];
    if (e) throw new Error(e.message);
  }
}

// 加减单个产品的两套做法(接管期间固定用同一套,还原时才对得上):
//   manual  = 纯手动合集:collectionAddProducts / collectionRemoveProducts,马上生效
//   sources = 带条件的合集(API 2026-07 起):改它的「单独加的产品」和「排除」名单(collectionUpdate → sourcesToUpdate),
//             **不动你设的条件**;Shopify 可能在后台慢慢算,所以会等它生效再排顺序
const SRC_UPDATE = `mutation($c: CollectionUpdateInput!) { collectionUpdate(collection: $c) { collection { id } job { id done } userErrors { field message } } }`;
export function membershipOps(ctx, cid, via, srcId, gql) {
  const id = gid(cid);
  const run = async (q, vars, key) => { const d = await gql(ctx, q, vars); const e = d[key]?.userErrors?.[0]; if (e) throw new Error(e.message); };
  if (via === 'manual') {
    const add = async (ids) => { if (ids.length) await run(ADD, { id, p: ids.map(pgid) }, 'collectionAddProducts'); };
    const rm = async (ids) => { if (ids.length) await run(REMOVE, { id, p: ids.map(pgid) }, 'collectionRemoveProducts'); };
    return { include: add, uninclude: rm, exclude: rm, unexclude: add };
  }
  const upd = (part, op) => async (ids) => {
    if (!ids.length) return;
    await run(SRC_UPDATE, { c: { id, sourcesToUpdate: [{ condition: { id: srcId, [part]: { [op]: ids.map((x) => ({ productId: pgid(x) })) } } }] } }, 'collectionUpdate');
  };
  return { include: upd('inclusion', 'selectionsToAdd'), uninclude: upd('inclusion', 'selectionsToRemove'), exclude: upd('exclusion', 'selectionsToAdd'), unexclude: upd('exclusion', 'selectionsToRemove') };
}
// 我们加进去的都出现了、排除的都不见了 = Shopify 已经算完
const settled = (added, removed, ids) => added.every((id) => ids.includes(id)) && !removed.some((id) => ids.includes(id));

// 跑一轮:把每个合集对齐到「这一刻该有的样子」。state.colState 记每个合集的接管情况。
//   返回 { applied:[], restored:[], holds:[], failures:[], skipped:[] }
const DAY = 86400_000;
export async function alignCollections(ctx, state, { now = Date.now(), gql, record = () => {} } = {}) {
  const rep = { applied: [], restored: [], holds: [], failures: [], skipped: [] };
  state.colState ||= {};
  // 上次因为「没有改产品的权限」失败过 → 一天之内不再试(装了权限重新打开 app 会清掉)
  if (state.colNoScope && now - state.colNoScope < DAY) { rep.skipped.push({ why: 'no-scope' }); return rep; }
  const want = livePins(state.pins || [], state.campaigns || [], now);
  const touched = new Set([...want.keys(), ...Object.keys(state.colState)]);
  for (const cid of touched) {
    const pin = want.get(cid) || null;
    const st = state.colState[cid] || null;
    if (!pin && !st) continue;
    if (st?.hold) { rep.holds.push({ collection: cid, title: st.title, reason: st.hold, pin: st.pinName }); continue; } // 已经暂停接管的不再动
    try {
      const col = await readCollection(ctx, cid, gql);
      if (!col) { delete state.colState[cid]; continue; }
      // 排序方式不是「手动」→ Shopify 不让调顺序,不写店里,交给主题前台排
      if (!col.manualOk) {
        if (st) { delete state.colState[cid]; }
        if (pin) rep.skipped.push({ collection: cid, title: col.title, pin: pin.name, why: `sort:${col.sortOrder}`, automated: col.automated });
        continue;
      }
      const via = st?.via !== undefined ? st.via : col.via;
      const ops = via ? membershipOps(ctx, cid, via, st?.srcId || col.srcId, gql) : null;
      if (pin) {
        // 加减不了单个产品(带条件 + 旧版 API / 共享的条件来源):只排顺序,加减交给前台(主题隐藏「不显示」的;合集外的显示不出来)
        const front = via ? null : {
          hidden: (pin.hidden || []).length + (pin.onlyListed ? col.ids.filter((id) => !(pin.products || []).some((p) => nid(p.id) === id)).length : 0),
          outside: (pin.products || []).filter((p) => !col.ids.includes(nid(p.id))).length,
          needsNewApi: !NEW_COLLECTIONS && col.automated,
        };
        const realPin = front ? { ...pin, hidden: [], onlyListed: false, products: (pin.products || []).filter((p) => col.ids.includes(nid(p.id))) } : pin;
        const snapshot = st?.snapshot || col.ids;            // 第一次接管:先记下原始顺序
        const same = st && st.pinId === pin.id && st.signature === sig(pin);
        if (same) {
          if (st.pending) {
            if (!settled(st.added || [], st.removed || [], col.ids)) {
              if (now - st.pending <= SETTLE_MS) continue;     // Shopify 还在后台算,下一轮再看
              rep.failures.push({ collection: cid, message: `「${col.title}」加进 / 排除的产品等了 15 分钟还没生效,先按现在的样子排顺序` });
            }
            // 算完了(或者等太久)→ 往下走,按现在的成员再排一次顺序
          } else {
            if (!driftedFrom(st.wrote, col.ids)) continue;      // 已经是想要的样子,什么都不用做
            // 调顺序在 Shopify 那边是异步任务(job),刚写完的几分钟内读到旧顺序很正常 —— 先等等,不算有人改过
            if (now - (st.at || 0) < 3 * 60_000) continue;
            st.hold = 'manual'; st.holdAt = now;                // 有人在后台改过 → 暂停接管,不覆盖
            record(cid, col.ids, { why: '有人在 Shopify 后台改过顺序', title: col.title, pin: pin.name });
            rep.holds.push({ collection: cid, title: col.title, reason: 'manual', pin: pin.name, fresh: true }); // 刚发现的才记日志
            continue;
          }
        }
        // 这一轮要「我们加进去的」和「我们排除的」各是哪些(按状态算,不看 Shopify 有没有算完 —— 不会重复加 / 重复排除)
        const cur = new Set(col.ids);
        const prevAdded = st?.added || []; const prevRemoved = st?.removed || [];
        const pinnedIds = (realPin.products || []).map((p) => nid(p.id));
        const listed = new Set(pinnedIds);
        const hide = new Set((realPin.hidden || []).map((p) => nid(p.id)));
        if (realPin.onlyListed) for (const id of [...col.ids, ...prevRemoved]) if (!listed.has(id)) hide.add(id);
        const wantAdded = ops ? pinnedIds.filter((id) => !hide.has(id) && (prevAdded.includes(id) || !cur.has(id))) : [];
        const wantRemoved = ops ? [...hide].filter((id) => (cur.has(id) || prevRemoved.includes(id)) && !wantAdded.includes(id)) : [];
        if (wantRemoved.length > MAX_REMOVE) { // 要移出去太多(「只显示清单里的」碰上大合集)→ 不动店里的合集,交给前台处理
          rep.skipped.push({ collection: cid, title: col.title, pin: pin.name, why: 'too-many', n: wantRemoved.length });
          continue;
        }
        if (!st) record(cid, col.ids, { why: 'app 接管前的原样', title: col.title, pin: pin.name });
        const toInclude = wantAdded.filter((id) => !prevAdded.includes(id));
        const toUninclude = prevAdded.filter((id) => !wantAdded.includes(id));
        const toExclude = wantRemoved.filter((id) => !prevRemoved.includes(id));
        const toUnexclude = prevRemoved.filter((id) => !wantRemoved.includes(id));
        if (ops) { await ops.unexclude(toUnexclude); await ops.include(toInclude); await ops.uninclude(toUninclude); await ops.exclude(toExclude); }
        const changed = toInclude.length + toUninclude.length + toExclude.length + toUnexclude.length;
        const col2 = changed ? await readCollection(ctx, cid, gql) : col;
        // 想要的顺序;还没真的进合集的先跳过,还没真的被排除的先放最后(马上就会消失)
        const d = desiredOrder(snapshot, col2.ids, { ...realPin, hidden: wantRemoved.map((id) => ({ id })), onlyListed: false });
        const stillThere = wantRemoved.filter((id) => col2.ids.includes(id));
        const target = [...d.order.filter((id) => col2.ids.includes(id)), ...stillThere];
        const mv = movesFor(col2.ids, target);
        await reorder(ctx, cid, mv, gql);
        const pendingNow = !settled(wantAdded, wantRemoved, col2.ids);
        state.colState[cid] = { collection: cid, title: col.title, pinId: pin.id, pinName: pin.name, signature: sig(pin),
          snapshot, snapAt: st?.snapAt || now, via, srcId: st?.srcId || col.srcId || null, removed: wantRemoved, added: wantAdded,
          wrote: d.pinned, at: now, ...(pendingNow ? { pending: changed ? now : (st?.pending || now) } : {}) };
        record(cid, d.order, { why: `按「${pin.name}」排`, title: col.title, pin: pin.name });
        // 「换位置」只算原来就在合集里、被挪动的(新加进来的那几个单独算)
        rep.applied.push({ collection: cid, title: col.title, pin: pin.name, moved: mv.filter((m) => !toInclude.includes(nid(m.id))).length,
          removed: toExclude.length, added: toInclude.length, back: toUnexclude.length, front, via, pending: pendingNow });
      } else {
        // 没有清单生效了 → 还原:排除的放回来、我们加进去的拿掉、顺序照快照
        const undoAdded = st.restoring ? (st.undoAdded || []) : (st.added || []);
        const undoRemoved = st.restoring ? (st.undoRemoved || []) : (st.removed || []);
        if (!st.restoring && ops) { await ops.unexclude(undoRemoved); await ops.uninclude(undoAdded); }
        const changed = !st.restoring && (undoAdded.length || undoRemoved.length);
        const col2 = changed ? await readCollection(ctx, cid, gql) : col;
        const done = settled(undoRemoved, undoAdded, col2.ids); // 放回来的都在了、拿掉的都不在了
        if (!done && st.restoring && now - st.restoring <= SETTLE_MS) continue; // Shopify 还在算,下一轮再排
        const stillAdded = undoAdded.filter((id) => col2.ids.includes(id));
        const back = restoreOrder(st.snapshot, col2.ids.filter((id) => !stillAdded.includes(id)));
        const mv = movesFor(col2.ids, [...back, ...stillAdded]);
        await reorder(ctx, cid, mv, gql);
        if (!done && !st.restoring) { // 第一次还原、Shopify 还没算完:记下来,下一轮再排一次
          Object.assign(st, { restoring: now, undoAdded, undoRemoved, added: [], removed: [], pinId: null });
          continue;
        }
        record(cid, back, { why: `「${st.pinName}」结束,还原`, title: col.title, pin: st.pinName });
        rep.restored.push({ collection: cid, title: col.title, pin: st.pinName, moved: mv.length, added: undoRemoved.length, removed: undoAdded.length });
        delete state.colState[cid];
      }
    } catch (e) {
      const msg = String(e.message || e);
      if (/access denied|not approved|permission/i.test(msg)) { // 没权限:记一下,今天别再试了
        state.colNoScope = now;
        rep.failures.push({ collection: cid, message: `${msg}(app 还没有「改产品 / 合集」的权限,这类清单暂时只能用前台排序)` });
        return rep;
      }
      rep.failures.push({ collection: cid, message: msg });
    }
  }
  return rep;
}

// 清单内容变了就要重排:名字不算,排的产品 / 隐藏的产品算
export const sig = (pin) => JSON.stringify([(pin.products || []).map((p) => nid(p.id)), (pin.hidden || []).map((p) => nid(p.id)), !!pin.onlyListed]);
