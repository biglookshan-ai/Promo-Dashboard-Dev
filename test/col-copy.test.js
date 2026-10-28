// 照另一个 Collection 的顺序排(2026-10-28 用户:Black Friday 的顺序完全照 Autumn Sale)
import test from 'node:test';
import assert from 'node:assert/strict';
import { planCopy, sortWantFrom, previewCopy, copyOrder } from '../src/col-copy.js';

test('planCopy:两边都有的照来源排,只在目标里有的排最后(保持原来先后),只在来源里有的不加', () => {
  const p = planCopy(['5', '3', '9', '1', '7'], ['1', '2', '3', '4', '5']);
  assert.deepEqual(p.want, ['5', '3', '1', '2', '4']);
  assert.equal(p.both, 3); assert.equal(p.extra, 2); assert.equal(p.notInTarget, 2);
  assert.ok(p.moved > 0);
  assert.equal(planCopy(['1', '2', '3'], ['1', '2', '3']).moved, 0); // 本来就一样
  assert.deepEqual(planCopy(['gid://shopify/Product/2', 'gid://shopify/Product/1'], ['1', '2']).want, ['2', '1']); // gid / 数字都认
});

test('sortWantFrom:平时怎么排照来源;来源是自动排序就不复制顺序', () => {
  assert.deepEqual(sortWantFrom({ sortOrder: 'MANUAL', off: true }), { mode: 'manual' });
  assert.deepEqual(sortWantFrom({ sortOrder: 'MANUAL', off: false, pinManual: 8 }), { mode: 'top', n: 8, toManual: true });
  assert.deepEqual(sortWantFrom({ sortOrder: 'MANUAL', off: false, pinManual: null }), { mode: 'top', n: 12, toManual: true });
  assert.equal(sortWantFrom({ sortOrder: 'BEST_SELLING', off: true }), null);
});

// 假的 Shopify:几个 Collection(顺序、排序方式、两个合集字段),真的会挪顺序
function fakeShop(cols) {
  const calls = [];
  const C = (id) => cols[String(id).split('/').pop()];
  const gql = async (ctx, q, v) => {
    if (q.includes('collectionReorderProducts')) {
      calls.push({ reorder: v.moves.length });
      const c = C(v.id);
      if (c.sortOrder !== 'MANUAL') return { collectionReorderProducts: { job: null, userErrors: [{ message: 'Collection is not manually sorted' }] } };
      for (const m of v.moves) { const id = m.id.split('/').pop(); c.ids.splice(c.ids.indexOf(id), 1); c.ids.splice(Number(m.newPosition), 0, id); }
      return { collectionReorderProducts: { job: { id: 'j' }, userErrors: [] } };
    }
    if (q.includes('collectionUpdate')) { calls.push({ sort: v.c.sortOrder }); C(v.c.id).sortOrder = v.c.sortOrder; return { collectionUpdate: { collection: { id: v.c.id, sortOrder: v.c.sortOrder }, userErrors: [] } }; }
    if (q.includes('metafieldsSet')) { for (const m of v.m) C(m.ownerId)[m.key] = m.value; calls.push({ set: v.m.map((m) => m.key) }); return { metafieldsSet: { metafields: [], userErrors: [] } }; }
    if (q.includes('metafieldsDelete')) { for (const m of v.m) delete C(m.ownerId)[m.key]; calls.push({ del: v.m.map((m) => m.key) }); return { metafieldsDelete: { deletedMetafields: [], userErrors: [] } }; }
    if (q.includes('collection(id: $id)')) {
      const c = C(v.id); if (!c) return { collection: null };
      const id = `gid://shopify/Collection/${String(v.id).split('/').pop()}`;
      if (q.includes('products(')) return { collection: { id, title: c.title, sortOrder: c.sortOrder, ruleSet: c.rules ? { rules: [{}] } : null, sources: [], products: { nodes: c.ids.map((x) => ({ id: `gid://shopify/Product/${x}` })), pageInfo: { hasNextPage: false, endCursor: null } } } };
      return { collection: { id, title: c.title, handle: c.title.toLowerCase(), sortOrder: c.sortOrder, productsCount: { count: c.ids.length }, image: null,
        sortOff: c.cgp_sort_off != null ? { value: c.cgp_sort_off } : null, pinManual: c.cgp_pin_manual != null ? { value: c.cgp_pin_manual } : null, pinNew: null } };
    }
    throw new Error('没模拟的查询:' + q.slice(0, 60));
  };
  return { gql, calls, cols };
}
const shop = () => fakeShop({
  1: { title: 'Autumn Sale', sortOrder: 'MANUAL', cgp_sort_off: 'true', ids: ['50', '10', '40', '20', '30', '60'] },
  2: { title: 'Black Friday', sortOrder: 'BEST_SELLING', rules: true, ids: ['10', '20', '30', '40', '50', '70'] },
  3: { title: 'Top Deals', sortOrder: 'PRICE_ASC', ids: ['10', '20'] },
});

test('预览:不写店里,说清楚会怎么排', async () => {
  const f = shop();
  const { calls } = f;
  const pv = await previewCopy({}, { target: '2', from: '1' }, { gql: f.gql });
  assert.equal(pv.target.title, 'Black Friday'); assert.equal(pv.source.title, 'Autumn Sale');
  assert.equal(pv.both, 5); assert.equal(pv.extra, 1); assert.equal(pv.notInTarget, 1);
  assert.equal(pv.willSetManual, true); assert.equal(pv.sourceAuto, null);
  assert.equal(pv.source.rule, '完全按手动顺序');
  assert.equal(calls.length, 0);
  await assert.rejects(previewCopy({}, { target: '2', from: '2' }, { gql: f.gql }), /同一个/);
});

test('真的排:后台改成手动、平时照来源、顺序排成一样,前后各记一版历史', async () => {
  const f = shop(); const hist = [];
  const r = await copyOrder({}, { target: '2', from: '1' }, { gql: f.gql, state: {}, record: (cid, ids, meta) => hist.push({ cid, ids: [...ids], why: meta.why }), by: '测试' });
  const bf = f.cols[2];
  assert.equal(bf.sortOrder, 'MANUAL');
  assert.equal(bf.cgp_sort_off, 'true'); // 和 Autumn Sale 一样「完全按手动顺序」
  assert.deepEqual(bf.ids, ['50', '10', '40', '20', '30', '70']); // 70 只在 BF 里 → 最后;60 只在 Autumn 里 → 不加
  assert.equal(r.both, 5); assert.equal(r.extra, 1); assert.ok(r.moved > 0);
  assert.equal(r.rule, '完全按手动顺序'); assert.equal(r.ruleChanged, true); assert.deepEqual(r.sortChanged, { from: '最畅销', to: '手动' });
  assert.equal(hist.length, 2); assert.deepEqual(hist[0].ids, ['10', '20', '30', '40', '50', '70']); assert.deepEqual(hist[1].ids, bf.ids);
  assert.match(hist[0].why, /排之前/);
  // 再排一次:已经一样,不发 move
  const before = f.calls.length;
  const r2 = await copyOrder({}, { target: '2', from: '1' }, { gql: f.gql, state: {} });
  assert.equal(r2.moved, 0);
  assert.equal(f.calls.slice(before).filter((c) => c.reorder).length, 0);
});

test('拦住:来源是自动排序 / 目标正被置顶清单接管', async () => {
  const f = shop();
  await assert.rejects(copyOrder({}, { target: '2', from: '3' }, { gql: f.gql, state: {} }), /自动排的/);
  assert.equal(f.cols[2].sortOrder, 'BEST_SELLING'); // 什么都没动
  await assert.rejects(copyOrder({}, { target: '2', from: '1' }, { gql: f.gql, state: { colState: { 2: { pinName: 'BF 置顶' } } } }), /BF 置顶/);
  assert.deepEqual(f.cols[2].ids, ['10', '20', '30', '40', '50', '70']);
  // 清单已经「保留后台排序」放手了 → 可以排
  await copyOrder({}, { target: '2', from: '1' }, { gql: f.gql, state: { colState: { 2: { pinName: 'BF 置顶', released: 1 } } } });
  assert.deepEqual(f.cols[2].ids.slice(0, 2), ['50', '10']);
});

test('来源是「前 N 个手动」:目标也设成同样的 N,后台改成手动', async () => {
  const f = shop();
  f.cols[1].cgp_sort_off = undefined; delete f.cols[1].cgp_sort_off; f.cols[1].cgp_pin_manual = '8';
  await copyOrder({}, { target: '2', from: '1' }, { gql: f.gql, state: {} });
  assert.equal(f.cols[2].sortOrder, 'MANUAL');
  assert.equal(f.cols[2].cgp_pin_manual, '8');
  assert.equal(f.cols[2].cgp_sort_off, undefined);
});
