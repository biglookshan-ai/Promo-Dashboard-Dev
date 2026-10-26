// 合集页「平时」的默认排序:三种方式 → 合集字段 cgp_sort_off / cgp_pin_manual + 合集排序方式(主题 cgp-search-head.liquid 读字段)
import test from 'node:test';
import assert from 'node:assert/strict';
import { modeOf, describe, isDefault, planSort, DEFAULT_N } from '../src/col-sort.js';
import { applyColSort } from '../src/col-sort-shop.js';

const C = (o = {}) => ({ sortOrder: 'MANUAL', off: false, offSet: false, pinManual: null, pinNew: 0, ...o });

test('现在是哪种方式 + 一句话说明', () => {
  assert.equal(modeOf(C()).mode, 'top');
  assert.equal(modeOf(C()).n, DEFAULT_N);
  assert.equal(describe(C()), '前 12 个按手动顺序,其余按新到旧');
  assert.equal(describe(C({ pinManual: 8 })), '前 8 个按手动顺序,其余按新到旧');
  assert.equal(describe(C({ pinManual: 0 })), '全部按新到旧');
  assert.equal(describe(C({ sortOrder: 'BEST_SELLING' })), '前 12 个按「最畅销」,其余按新到旧');
  assert.equal(describe(C({ pinNew: 3 })), '最新 3 个放最前,再前 12 个按手动顺序,其余按新到旧');
  assert.equal(modeOf(C({ off: true })).mode, 'manual');
  assert.equal(describe(C({ off: true })), '完全按手动顺序');
  assert.equal(modeOf(C({ off: true, sortOrder: 'PRICE_ASC' })).mode, 'shopify');
  assert.equal(describe(C({ off: true, sortOrder: 'PRICE_ASC' })), '完全按「价格从低到高」');
  assert.ok(isDefault(C()));
  assert.ok(isDefault(C({ pinManual: 12 })));
  assert.ok(!isDefault(C({ pinManual: 6 })));
  assert.ok(!isDefault(C({ off: true })));
});

test('前 N 个:12 = 删掉字段回到默认;别的数写字段;关着的开关删掉', () => {
  assert.deepEqual(planSort(C(), { mode: 'top', n: 12 }).changed, false);
  assert.deepEqual(planSort(C(), { mode: 'top', n: 8 }).ops, { off: undefined, n: 8, sortOrder: null });
  assert.deepEqual(planSort(C({ pinManual: 8 }), { mode: 'top', n: 12 }).ops, { off: undefined, n: null, sortOrder: null });
  assert.deepEqual(planSort(C({ off: true, offSet: true }), { mode: 'top', n: 12 }).ops, { off: null, n: undefined, sortOrder: null });
  // 字段存在但是 false:也删掉,回到干净的默认
  assert.equal(planSort(C({ offSet: true }), { mode: 'top', n: 12 }).ops.off, null);
  // 后台不是手动:勾了「同时改成手动」才改
  assert.equal(planSort(C({ sortOrder: 'BEST_SELLING' }), { mode: 'top', n: 12 }).ops.sortOrder, null);
  assert.equal(planSort(C({ sortOrder: 'BEST_SELLING' }), { mode: 'top', n: 12, toManual: true }).ops.sortOrder, 'MANUAL');
  assert.throws(() => planSort(C(), { mode: 'top', n: -1 }), /0–250/);
  assert.throws(() => planSort(C(), { mode: 'top', n: 3.5 }), /整数/);
  assert.throws(() => planSort(C(), { mode: 'x' }), /排序方式/);
});

test('完全按手动 / 完全按自动排序:打开开关,排序方式跟着改', () => {
  assert.deepEqual(planSort(C(), { mode: 'manual' }).ops, { off: true, n: undefined, sortOrder: null });
  assert.deepEqual(planSort(C({ sortOrder: 'CREATED_DESC' }), { mode: 'manual' }).ops, { off: true, n: undefined, sortOrder: 'MANUAL' });
  assert.equal(planSort(C({ off: true }), { mode: 'manual' }).changed, false);
  const p = planSort(C({ pinManual: 6 }), { mode: 'shopify', sortOrder: 'BEST_SELLING' });
  assert.deepEqual(p.ops, { off: true, n: undefined, sortOrder: 'BEST_SELLING' });
  assert.equal(p.after.pinManual, 6); // 前 N 个的数字留着,切回来还在
  assert.equal(describe(p.after), '完全按「最畅销」');
  assert.throws(() => planSort(C(), { mode: 'shopify', sortOrder: 'MANUAL' }), /畅销/);
  assert.throws(() => planSort(C(), { mode: 'shopify' }), /畅销/);
});

// 假 Shopify:记下发出去的写操作
function fakeShop(col) {
  const calls = [];
  const meta = { cgp_sort_off: col.off != null ? { value: String(col.off) } : null, cgp_pin_manual: col.pin != null ? { value: String(col.pin) } : null, cgp_pin_new: null };
  let sortOrder = col.sortOrder || 'MANUAL';
  const gql = async (ctx, q, v) => {
    if (q.includes('collection(id: $id)')) return { collection: { id: v.id, title: 'DZOFILM', handle: 'dzofilm', sortOrder, productsCount: { count: 40 }, image: null, sortOff: meta.cgp_sort_off, pinManual: meta.cgp_pin_manual, pinNew: meta.cgp_pin_new } };
    if (q.includes('collectionUpdate')) { calls.push(['sort', v.c.sortOrder]); sortOrder = v.c.sortOrder; return { collectionUpdate: { collection: { id: v.c.id }, userErrors: [] } }; }
    if (q.includes('metafieldsSet')) { for (const m of v.m) { calls.push(['set', m.key, m.value, m.type]); meta[m.key] = { value: m.value }; } return { metafieldsSet: { metafields: [], userErrors: [] } }; }
    if (q.includes('metafieldsDelete')) { for (const m of v.m) { calls.push(['del', m.key]); meta[m.key] = null; } return { metafieldsDelete: { deletedMetafields: [], userErrors: [] } }; }
    throw new Error('没想到的查询 ' + q.slice(0, 60));
  };
  return { gql, calls, meta };
}

test('改一个 Collection:先改排序方式,再写 / 删字段', async () => {
  const f = fakeShop({ sortOrder: 'BEST_SELLING' });
  const r = await applyColSort({}, '42', { mode: 'manual' }, { gql: f.gql, state: {} });
  assert.deepEqual(f.calls, [['sort', 'MANUAL'], ['set', 'cgp_sort_off', 'true', 'boolean']]);
  assert.equal(r.before, '前 12 个按「最畅销」,其余按新到旧');
  assert.equal(r.after, '完全按手动顺序');
  assert.deepEqual(r.sortChanged, { from: '最畅销', to: '手动' });
  const f2 = fakeShop({ off: true, pin: 6 });
  await applyColSort({}, 'gid://shopify/Collection/42', { mode: 'top', n: 12 }, { gql: f2.gql, state: {} });
  assert.deepEqual(f2.calls, [['del', 'cgp_sort_off'], ['del', 'cgp_pin_manual']]);
  const f3 = fakeShop({});
  const r3 = await applyColSort({}, '42', { mode: 'top', n: 12 }, { gql: f3.gql, state: {} });
  assert.equal(r3.changed, false); assert.deepEqual(f3.calls, []);
});

test('清单「完全按我排的顺序」正开着:不动字段,改「结束后恢复成」', async () => {
  const f = fakeShop({ off: true }); // 店里的 true 是清单临时打开的,平时没设
  const state = { sortFlags: { 42: { prev: null, pinName: 'Flash 第 1 天' } } };
  const r = await applyColSort({}, '42', { mode: 'manual' }, { gql: f.gql, state });
  assert.deepEqual(f.calls, []); // 店里已经是 true,什么都不用写
  assert.deepEqual(state.sortFlags[42].prev, { value: 'true', type: 'boolean' });
  assert.equal(r.before, '前 12 个按手动顺序,其余按新到旧'); // 说的是平时的样子
  assert.equal(r.row.held, 'Flash 第 1 天');
  // 再改回前 8 个:字段 pin_manual 照写,开关仍然不碰,结束后恢复成「没有」
  const r2 = await applyColSort({}, '42', { mode: 'top', n: 8 }, { gql: f.gql, state });
  assert.deepEqual(f.calls, [['set', 'cgp_pin_manual', '8', 'number_integer']]);
  assert.equal(state.sortFlags[42].prev, null);
  assert.equal(r2.after, '前 8 个按手动顺序,其余按新到旧');
});

test('app 正在真的改这个 Collection 的顺序:不许改成自动排序', async () => {
  const f = fakeShop({});
  const state = { colState: { 42: { pinName: 'BF 置顶' } } };
  await assert.rejects(applyColSort({}, '42', { mode: 'shopify', sortOrder: 'BEST_SELLING' }, { gql: f.gql, state }), /BF 置顶/);
  assert.deepEqual(f.calls, []);
  await applyColSort({}, '42', { mode: 'manual' }, { gql: f.gql, state }); // 手动照样可以
  assert.deepEqual(f.calls, [['set', 'cgp_sort_off', 'true', 'boolean']]);
});
