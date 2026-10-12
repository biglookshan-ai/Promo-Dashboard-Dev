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

const COL_Q = `query($id: ID!, $after: String) { collection(id: $id) { id title sortOrder ruleSet { appliedDisjunctively }
    products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) { nodes { id } pageInfo { hasNextPage endCursor } } } }`;
const REORDER = `mutation($id: ID!, $moves: [MoveInput!]!) { collectionReorderProducts(id: $id, moves: $moves) { job { id } userErrors { field message } } }`;
const REMOVE = `mutation($id: ID!, $p: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $p) { userErrors { field message } } }`;
const ADD = `mutation($id: ID!, $p: [ID!]!) { collectionAddProducts(id: $id, productIds: $p) { userErrors { field message } } }`;

export async function readCollection(ctx, id, gql) {
  let after = null; const ids = []; let info = null;
  for (let i = 0; i < 8; i++) {
    const d = await gql(ctx, COL_Q, { id: gid(id), after });
    const c = d.collection;
    if (!c) return null;
    info = { id: c.id, title: c.title, sortOrder: c.sortOrder, automated: !!c.ruleSet };
    ids.push(...c.products.nodes.map((n) => nid(n.id)));
    if (!c.products.pageInfo.hasNextPage) break;
    after = c.products.pageInfo.endCursor;
  }
  // 手动排序的合集才能真的排;自动归类的、或者现在按别的方式排序的,都交给前台排
  return { ...info, ids, manualOk: !info.automated && info.sortOrder === 'MANUAL' };
}

const CHUNK = 200;
export const MAX_REMOVE = 100; // 一份清单最多临时移出这么多产品,再多就不动店里的合集(交给前台排)
async function reorder(ctx, id, moves, gql) {
  for (let i = 0; i < moves.length; i += CHUNK) {
    const d = await gql(ctx, REORDER, { id: gid(id), moves: moves.slice(i, i + CHUNK) });
    const e = d.collectionReorderProducts?.userErrors?.[0];
    if (e) throw new Error(e.message);
  }
}
async function removeFrom(ctx, id, products, gql) {
  if (!products.length) return;
  const d = await gql(ctx, REMOVE, { id: gid(id), p: products.map(pgid) });
  const e = d.collectionRemoveProducts?.userErrors?.[0];
  if (e) throw new Error(e.message);
}
async function addTo(ctx, id, products, gql) {
  if (!products.length) return;
  const d = await gql(ctx, ADD, { id: gid(id), p: products.map(pgid) });
  const e = d.collectionAddProducts?.userErrors?.[0];
  if (e) throw new Error(e.message);
}

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
      // 自动归类 / 不是手动排序 → 不写店里,交给主题前台排
      if (!col.manualOk) {
        if (st) { delete state.colState[cid]; }
        if (pin) rep.skipped.push({ collection: cid, title: col.title, pin: pin.name, why: col.automated ? 'automated' : `sort:${col.sortOrder}` });
        continue;
      }
      if (pin) {
        const snapshot = st?.snapshot || col.ids;            // 第一次接管:先记下原始顺序
        const same = st && st.pinId === pin.id && st.signature === sig(pin);
        if (same && !driftedFrom(st.wrote, col.ids)) continue; // 已经是想要的样子,什么都不用做
        if (same && driftedFrom(st.wrote, col.ids)) {          // 有人在后台改过 → 暂停接管,不覆盖
          st.hold = 'manual'; st.holdAt = now;
          record(cid, col.ids, { why: '有人在 Shopify 后台改过顺序', title: col.title, pin: pin.name });
          rep.holds.push({ collection: cid, title: col.title, reason: 'manual', pin: pin.name });
          continue;
        }
        // 要移出去太多(「只显示清单里的」碰上大合集)→ 不动店里的合集,交给前台处理
        const probe = desiredOrder(snapshot, col.ids, pin);
        if (probe.remove.length > MAX_REMOVE) {
          rep.skipped.push({ collection: cid, title: col.title, pin: pin.name, why: 'too-many', n: probe.remove.length });
          continue;
        }
        if (!st) record(cid, col.ids, { why: 'app 接管前的原样', title: col.title, pin: pin.name });
        const pinned = new Set((pin.products || []).map((p) => nid(p.id)));
        const stillOut = new Set(probe.remove);
        const back = (st?.removed || []).filter((id) => !stillOut.has(id));   // 上轮移出去、这轮该回来的
        const drop = (st?.added || []).filter((id) => !pinned.has(id));       // 上轮我们加进去、这轮清单里没有了的
        await addTo(ctx, cid, [...back, ...probe.add], gql);                  // 清单里排了但不在合集里的,加进合集
        await removeFrom(ctx, cid, drop, gql);
        const changed = back.length || probe.add.length || drop.length;
        const col2 = changed ? await readCollection(ctx, cid, gql) : col;
        const d = desiredOrder(snapshot, col2.ids, pin);
        await removeFrom(ctx, cid, d.remove, gql);
        const after = col2.ids.filter((id) => !d.remove.includes(id));
        const mv = movesFor(after, d.order);
        await reorder(ctx, cid, mv, gql);
        state.colState[cid] = { collection: cid, title: col.title, pinId: pin.id, pinName: pin.name, signature: sig(pin),
          snapshot, snapAt: st?.snapAt || now, removed: d.remove, added: [...new Set([...(st?.added || []).filter((id) => pinned.has(id)), ...probe.add])],
          wrote: d.pinned, at: now };
        record(cid, d.order, { why: `按「${pin.name}」排`, title: col.title, pin: pin.name });
        // 「换位置」只算原来就在合集里、被挪动的(新加进来的那几个单独算)
        rep.applied.push({ collection: cid, title: col.title, pin: pin.name, moved: mv.filter((m) => !probe.add.includes(nid(m.id))).length, removed: d.remove.length, added: probe.add.length, back: back.length });
      } else {
        // 没有清单生效了 → 还原:移出去的加回来、我们加进去的移出去、顺序照快照
        await addTo(ctx, cid, st.removed || [], gql);
        await removeFrom(ctx, cid, st.added || [], gql);
        const col2 = (st.removed || []).length || (st.added || []).length ? await readCollection(ctx, cid, gql) : col;
        const back = restoreOrder(st.snapshot, col2.ids);
        const mv = movesFor(col2.ids, back);
        await reorder(ctx, cid, mv, gql);
        record(cid, back, { why: `「${st.pinName}」结束,还原`, title: col.title, pin: st.pinName });
        rep.restored.push({ collection: cid, title: col.title, pin: st.pinName, moved: mv.length, added: (st.removed || []).length, removed: (st.added || []).length });
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
