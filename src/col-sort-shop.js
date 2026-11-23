// 合集页「平时」的默认排序:读全部合集的设置 + 改一个合集(规则在 ./col-sort.js,浏览器共用)。
// 只写这个合集的排序方式和 custom.cgp_sort_off / cgp_pin_manual / cgp_random_ranges 字段。
import { NEW_COLLECTIONS } from './shopify.js';
import { planSort, describe, sortCn, randomRanges } from './col-sort.js';
import { readCollection, movesFor, reorder } from './collection-order.js';

const nid = (x) => String(x ?? '').split('/').pop();
const gid = (x) => (String(x).startsWith('gid://') ? String(x) : `gid://shopify/Collection/${nid(x)}`);
const FIELDS = `id title handle sortOrder productsCount { count } image { url }
  sortOff: metafield(namespace: "custom", key: "cgp_sort_off") { value }
  pinManual: metafield(namespace: "custom", key: "cgp_pin_manual") { value }
  pinNew: metafield(namespace: "custom", key: "cgp_pin_new") { value }
  randomRanges: metafield(namespace: "custom", key: "cgp_random_ranges") { value }`;
const readRandom = (mf) => { try { return randomRanges(JSON.parse(mf?.value || '[]')); } catch { return []; } };
const num = (mf) => (mf?.value != null && mf.value !== '' && Number.isFinite(Number(mf.value)) ? Number(mf.value) : null);
export const colRow = (c) => ({ id: nid(c.id), title: c.title, handle: c.handle, sortOrder: c.sortOrder, count: c.productsCount?.count ?? null, image: c.image?.url || null,
  off: c.sortOff?.value === 'true', offSet: !!c.sortOff, pinManual: num(c.pinManual), pinNew: num(c.pinNew) || 0, randomRanges: readRandom(c.randomRanges) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gqlRetry(ctx, gql, q, v) {
  for (let i = 0; ; i++) {
    try { return await gql(ctx, q, v); } catch (e) { if (i >= 5 || !/THROTTLED/i.test(e.message)) throw e; await sleep(1500 * (i + 1)); }
  }
}

// 全部合集(按名字排),每页 100 个(带三个字段,一页的查询成本在上限以内)
export async function listColSorts(ctx, gql) {
  const out = []; let after = null;
  for (let page = 0; page < 40; page++) {
    const d = await gqlRetry(ctx, gql, `query($after: String) { collections(first: 100, after: $after, sortKey: TITLE) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } } }`, { after });
    out.push(...d.collections.nodes.map(colRow));
    if (!d.collections.pageInfo.hasNextPage) break;
    after = d.collections.pageInfo.endCursor;
  }
  return out;
}
export async function readColSort(ctx, id, gql) {
  const d = await gql(ctx, `query($id: ID!) { collection(id: $id) { ${FIELDS} } }`, { id: gid(id) });
  return d.collection ? colRow(d.collection) : null;
}

const MF_SET = `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`;
const MF_DEL = `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { deletedMetafields { key } userErrors { field message } } }`;
// API 2026-07 起 collectionUpdate 的参数叫 collection(旧的 input 弃用)
const SORT_UPDATE = NEW_COLLECTIONS
  ? 'mutation($c: CollectionUpdateInput!) { collectionUpdate(collection: $c) { collection { id sortOrder } userErrors { field message } } }'
  : 'mutation($c: CollectionInput!) { collectionUpdate(input: $c) { collection { id sortOrder } userErrors { field message } } }';
const check = (d, key) => { const e = d[key]?.userErrors?.[0]; if (e) throw new Error(e.message); };

// 改一个合集。want = { mode: top | manual | shopify, n, sortOrder, toManual }
// state 用来处理两件事:
//   · 清单「生效期间完全按我排的顺序」正开着(state.sortFlags[合集]):cgp_sort_off 暂时被清单设成 true,
//     平时的值记在 flag.prev,清单结束时恢复 —— 所以这里不动字段,改 flag.prev,清单结束后就用新的
//   · app 正在真的改这个合集的顺序(state.colState[合集]):不许改成自动排序(否则排不了、结束也还原不了)
export async function applyColSort(ctx, id, want, { gql, state }) {
  const cid = nid(id);
  const live = await readColSort(ctx, cid, gql);
  if (!live) throw new Error('找不到这个 Collection');
  const fl = state.sortFlags?.[cid] || null;
  const cur = fl ? { ...live, off: fl.prev?.value === 'true', offSet: !!fl.prev } : live;
  const { ops, after, changed } = planSort(cur, want);
  const st = state.colState?.[cid];
  if (st && ops.sortOrder && ops.sortOrder !== 'MANUAL') throw new Error(`这个 Collection 的顺序现在由「${st.pinName || '排序计划'}」接管着(app 在真的改店里的顺序),改成自动排序会让它排不了、结束也还原不了 —— 等这份排序计划结束后再改`);
  if (!changed) return { title: live.title, before: describe(cur), after: describe(after), changed: false, row: { ...cur, held: fl?.pinName || null } };
  // 先改排序方式(失败就什么都没动),再改字段
  if (ops.sortOrder) check(await gql(ctx, SORT_UPDATE, { c: { id: gid(cid), sortOrder: ops.sortOrder } }), 'collectionUpdate');
  const set = []; const del = [];
  const mf = (key) => ({ ownerId: gid(cid), namespace: 'custom', key });
  if (ops.off !== undefined) {
    if (fl) fl.prev = ops.off === true ? { value: 'true', type: 'boolean' } : null; // 清单开着:只改「结束后恢复成」
    else if (ops.off === true) set.push({ ...mf('cgp_sort_off'), type: 'boolean', value: 'true' });
    else del.push(mf('cgp_sort_off'));
  }
  if (ops.n !== undefined) {
    if (ops.n === null) del.push(mf('cgp_pin_manual')); else set.push({ ...mf('cgp_pin_manual'), type: 'number_integer', value: String(ops.n) });
  }
  if (ops.randomRanges !== undefined) {
    if (ops.randomRanges.length) set.push({ ...mf('cgp_random_ranges'), type: 'json', value: JSON.stringify(ops.randomRanges) });
    else del.push(mf('cgp_random_ranges'));
  }
  if (set.length) check(await gql(ctx, MF_SET, { m: set }), 'metafieldsSet');
  if (del.length) check(await gql(ctx, MF_DEL, { m: del }), 'metafieldsDelete');
  const row = { ...live, ...after, offSet: after.off, held: fl?.pinName || null }; // 列表里显示的是「平时」的设置
  return { title: live.title, before: describe(cur), after: describe(after), changed: true, sortChanged: ops.sortOrder ? { from: sortCn(live.sortOrder), to: sortCn(ops.sortOrder) } : null, held: !!fl, row };
}

// 一键同步(2026-11-18 用户:「未设置同步」的 Collection 要能一键改成能同步):把后台排序方式改成「手动」,**顺序保持改之前的样子**
// (不交给 Shopify 决定起始顺序:先记下现在的顺序,改完按原样排回去)。只动排序方式和顺序,平时的排法(cgp_* 字段)不动。
// 有排序计划生效的,由调用方接着跑一次 alignCollections 按计划排好后台。record(cid, ids, meta) = 记历史版本(可回滚)
export async function enableManualSort(ctx, id, { gql, record = () => {} } = {}) {
  const cid = nid(id);
  const before = await readCollection(ctx, cid, gql);
  if (!before) throw new Error('找不到这个 Collection');
  if (before.sortOrder === 'MANUAL') return { title: before.title, already: true, from: sortCn('MANUAL'), moved: 0 };
  record(cid, before.ids, { why: `一键同步之前(后台是「${sortCn(before.sortOrder)}」)`, title: before.title });
  check(await gql(ctx, SORT_UPDATE, { c: { id: gid(cid), sortOrder: 'MANUAL' } }), 'collectionUpdate');
  const after = await readCollection(ctx, cid, gql);
  const moves = movesFor(after?.ids || [], before.ids);
  if (moves.length) await reorder(ctx, cid, moves, gql);
  record(cid, before.ids, { why: '一键同步:后台排序方式改成手动,顺序保持原样', title: before.title });
  return { title: before.title, already: false, from: sortCn(before.sortOrder), moved: moves.length, count: before.ids.length };
}
