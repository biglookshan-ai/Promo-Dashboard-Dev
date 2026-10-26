// 合集页「平时」的默认排序:读全部合集的设置 + 改一个合集(规则在 ./col-sort.js,浏览器共用)。
// 只写这个合集的三样:字段 custom.cgp_sort_off、custom.cgp_pin_manual,以及(用户 2026-10-21 同意)Shopify 合集的排序方式 sortOrder。
import { NEW_COLLECTIONS } from './shopify.js';
import { planSort, describe, sortCn } from './col-sort.js';

const nid = (x) => String(x ?? '').split('/').pop();
const gid = (x) => (String(x).startsWith('gid://') ? String(x) : `gid://shopify/Collection/${nid(x)}`);
const FIELDS = `id title handle sortOrder productsCount { count } image { url }
  sortOff: metafield(namespace: "custom", key: "cgp_sort_off") { value }
  pinManual: metafield(namespace: "custom", key: "cgp_pin_manual") { value }
  pinNew: metafield(namespace: "custom", key: "cgp_pin_new") { value }`;
const num = (mf) => (mf?.value != null && mf.value !== '' && Number.isFinite(Number(mf.value)) ? Number(mf.value) : null);
export const colRow = (c) => ({ id: nid(c.id), title: c.title, handle: c.handle, sortOrder: c.sortOrder, count: c.productsCount?.count ?? null, image: c.image?.url || null,
  off: c.sortOff?.value === 'true', offSet: !!c.sortOff, pinManual: num(c.pinManual), pinNew: num(c.pinNew) || 0 });

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
  if (st && ops.sortOrder && ops.sortOrder !== 'MANUAL') throw new Error(`这个 Collection 的顺序现在由「${st.pinName || '置顶清单'}」接管着(app 在真的改店里的顺序),改成自动排序会让它排不了、结束也还原不了 —— 等这份清单结束后再改`);
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
  if (set.length) check(await gql(ctx, MF_SET, { m: set }), 'metafieldsSet');
  if (del.length) check(await gql(ctx, MF_DEL, { m: del }), 'metafieldsDelete');
  const row = { ...live, ...after, offSet: after.off, held: fl?.pinName || null }; // 列表里显示的是「平时」的设置
  return { title: live.title, before: describe(cur), after: describe(after), changed: true, sortChanged: ops.sortOrder ? { from: sortCn(live.sortOrder), to: sortCn(ops.sortOrder) } : null, held: !!fl, row };
}
