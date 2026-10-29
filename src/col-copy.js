// 照另一个 Collection 的顺序排(2026-10-28 用户:Black Friday 的产品顺序要完全照 Autumn Sale)。
// 一次性的:把目标 Collection 店里的手动顺序排成和来源一样,「平时怎么排」(合集默认排序)也照来源设;以后来源再调,目标不会自动跟着变。
// 两边都有的产品照来源的顺序;只在目标里有的排在最后(保持目标里原来的先后);只在来源里有的不加进目标(不改目标的成员)。
// 排之前 / 排之后各记一版历史(src/col-history.js),排错了可以在「历史」里回滚。
import { readCollection, movesFor } from './collection-order.js';
import { readColSort, applyColSort } from './col-sort-shop.js';
import { modeOf, describe, sortCn } from './col-sort.js';
import { diffOrder, nid } from './order-diff.js';

// 纯函数(好测):目标排成什么样
export function planCopy(sourceIds, targetIds) {
  const src = sourceIds.map(nid), tgt = targetIds.map(nid);
  const inTgt = new Set(tgt), inSrc = new Set(src);
  const both = src.filter((id) => inTgt.has(id));
  const extra = tgt.filter((id) => !inSrc.has(id));
  const want = [...both, ...extra];
  return { want, both: both.length, extra: extra.length, notInTarget: src.length - both.length, moved: diffOrder(tgt, want).moved.size };
}

// 来源的「平时怎么排」→ 目标要设成什么(applyColSort 的 want)。来源不是手动排序就不复制顺序(两边设成同一种自动排序就一样了)
export function sortWantFrom(srcRow) {
  const m = modeOf(srcRow);
  if (srcRow.sortOrder !== 'MANUAL') return null;
  return m.mode === 'top' ? { mode: 'top', n: m.n, toManual: true } : { mode: 'manual' };
}

const REORDER = `mutation($id: ID!, $moves: [MoveInput!]!) { collectionReorderProducts(id: $id, moves: $moves) { job { id } userErrors { field message } } }`;

// 看看会怎么排(不写店里)
export async function previewCopy(ctx, { target, from }, { gql }) {
  if (!target || !from) throw new Error('要选两个 Collection');
  if (nid(target) === nid(from)) throw new Error('来源和要排的是同一个 Collection');
  const [tCol, sCol, tRow, sRow] = await Promise.all([readCollection(ctx, target, gql), readCollection(ctx, from, gql), readColSort(ctx, target, gql), readColSort(ctx, from, gql)]);
  if (!tCol || !tRow) throw new Error('找不到要排的 Collection');
  if (!sCol || !sRow) throw new Error('找不到来源 Collection');
  const plan = planCopy(sCol.ids, tCol.ids);
  const sortWant = sortWantFrom(sRow);
  return {
    target: { id: nid(target), title: tCol.title, count: tCol.ids.length, sortOrder: tCol.sortOrder, rule: describe(tRow) },
    source: { id: nid(from), title: sCol.title, count: sCol.ids.length, sortOrder: sCol.sortOrder, rule: describe(sRow) },
    ...plan, want: undefined,
    sourceAuto: sortWant ? null : sortCn(sRow.sortOrder), // 来源是自动排序:不用复制顺序,把目标也设成同一种自动排序就行
    willSetManual: !!sortWant && tCol.sortOrder !== 'MANUAL',
  };
}

// 真的排。state 用来查这个 Collection 是不是正被置顶清单接管;record = 记历史版本(recordVersion 绑好店铺)
export async function copyOrder(ctx, { target, from }, { gql, state, record = () => {}, by = '' }) {
  const tid = nid(target);
  const st = state.colState?.[tid];
  if (st && !st.released) throw new Error(`这个 Collection 的顺序现在由「${st.pinName || '置顶排序'}」接管着(app 在按置顶排序改店里的顺序)—— 先暂停或结束这份置顶排序再排`);
  const pv = await previewCopy(ctx, { target, from }, { gql });
  const sRow = await readColSort(ctx, from, gql);
  const sortWant = sortWantFrom(sRow);
  if (!sortWant) throw new Error(`「${pv.source.title}」是按「${pv.sourceAuto}」自动排的,不是手动顺序 —— 直接在上面把这个 Collection 也设成「完全按 Shopify 的自动排序 · ${pv.sourceAuto}」就一样了`);
  // 1. 「平时怎么排」照来源(需要的话顺便把后台排序方式改成手动 —— 不是手动 Shopify 不让调顺序)
  const sortRes = await applyColSort(ctx, tid, sortWant, { gql, state });
  // 2. 改完排序方式再读一次现在的顺序(从自动改成手动时起始顺序由 Shopify 决定)
  const tCol = await readCollection(ctx, tid, gql);
  if (!tCol?.manualOk) throw new Error('这个 Collection 的排序方式还不是「手动」,Shopify 不让调顺序');
  const sCol = await readCollection(ctx, from, gql);
  const plan = planCopy(sCol.ids, tCol.ids);
  record(tid, tCol.ids, { why: `照「${sCol.title}」排之前`, by, title: tCol.title });
  const mv = movesFor(tCol.ids, plan.want);
  for (let i = 0; i < mv.length; i += 200) {
    const d = await gql(ctx, REORDER, { id: `gid://shopify/Collection/${tid}`, moves: mv.slice(i, i + 200) });
    const e = d.collectionReorderProducts?.userErrors?.[0];
    if (e) throw new Error('调整顺序失败:' + e.message);
  }
  record(tid, plan.want, { why: `照「${sCol.title}」的顺序排`, by, title: tCol.title });
  return { title: tCol.title, from: sCol.title, moved: plan.moved, moves: mv.length, both: plan.both, extra: plan.extra, notInTarget: plan.notInTarget,
    // rule = 平时怎么排的一句话(applyColSort 已经写好的说明,不是设置对象)
    rule: sortRes.after, ruleChanged: sortRes.changed, sortChanged: sortRes.sortChanged || null, row: sortRes.row };
}
