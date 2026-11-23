import test from 'node:test';
import assert from 'node:assert/strict';
import { randomRanges, planSort, describe, isDefault } from '../src/col-sort.js';
import { colRow, applyColSort } from '../src/col-sort-shop.js';
import { colCard } from '../src/col-status.js';

const C = (extra = {}) => ({ id: '42', title: 'Example', sortOrder: 'MANUAL', off: false, offSet: false, pinManual: null, randomRanges: [], ...extra });
test('随机区间校验：排序、相邻、重叠、非法数字与数量', () => {
  assert.deepEqual(randomRanges([{ start: '16', end: '40' }, { start: 1, end: 15 }]), [{ start: 1, end: 15 }, { start: 16, end: 40 }]);
  for (const ranges of [null, {}, [{ start: 0, end: 20 }], [{ start: 5, end: 5 }], [{ start: 20, end: 5 }], [{ start: 1.2, end: 9 }], [{ start: 1, end: Infinity }], [{ start: 1, end: 1001 }], [{ start: 1, end: 20 }, { start: 20, end: 40 }], Array(21).fill({ start: 1, end: 2 })]) assert.throws(() => randomRanges(ranges), /随机/);
  const c = C({ randomRanges: [{ start: 16, end: 40 }] });
  assert.equal(isDefault(c), false);
  assert.match(describe(c), /第 16 至 40 位每次打开随机排序/);
  assert.equal(planSort(c, { mode: 'top', n: 12 }).changed, false, '旧调用保留随机区间');
  assert.deepEqual(planSort(c, { mode: 'top', n: 12 }).after.randomRanges, c.randomRanges);
});

test('保存随机区间只写指定 Collection 的 json 字段，清空可关闭', async () => {
  let value = null; const calls = [];
  const gql = async (_, q, v) => {
    if (q.includes('collection(id: $id)')) return { collection: { id: v.id, title: 'Example', sortOrder: 'MANUAL', randomRanges: value } };
    if (q.includes('metafieldsSet')) { calls.push(['set', v.m]); value = { value: v.m[0].value }; return { metafieldsSet: { userErrors: [] } }; }
    if (q.includes('metafieldsDelete')) { calls.push(['delete', v.m]); value = null; return { metafieldsDelete: { userErrors: [] } }; }
    throw new Error('Unexpected write: ' + q);
  };
  const want = { mode: 'top', n: 12, randomRanges: [{ start: 16, end: 40 }] };
  const first = await applyColSort({}, '42', want, { gql, state: {} });
  assert.equal(first.changed, true);
  assert.deepEqual(calls, [['set', [{ ownerId: 'gid://shopify/Collection/42', namespace: 'custom', key: 'cgp_random_ranges', type: 'json', value: '[{"start":16,"end":40}]' }]]]);
  assert.deepEqual(first.row.randomRanges, want.randomRanges);
  await applyColSort({}, '42', want, { gql, state: {} });
  assert.equal(calls.length, 1, '相同配置不重复写入');
  await assert.rejects(applyColSort({}, '42', { ...want, randomRanges: [{ start: 40, end: 16 }] }, { gql, state: {} }), /随机/);
  assert.equal(calls.length, 1, '校验失败不写店铺');
  await applyColSort({}, '42', { ...want, randomRanges: [] }, { gql, state: {} });
  assert.deepEqual(calls[1], ['delete', [{ ownerId: 'gid://shopify/Collection/42', namespace: 'custom', key: 'cgp_random_ranges' }]]);
  assert.deepEqual(colRow({ id: '42', randomRanges: { value: 'bad JSON' } }).randomRanges, []);
  assert.deepEqual(colRow({ id: '42', randomRanges: { value: '[{"start":1,"end":5}]' } }).randomRanges, [{ start: 1, end: 5 }]);
});

test('后台卡片明确标出前台区间随机规则', () => {
  const card = colCard({ pins: [], campaigns: [] }, C({ randomRanges: [{ start: 16, end: 40 }] }));
  assert.equal(card.badge.text, '区间随机排序生效中');
  assert.match(card.rows.find(r => r.label === '区间随机排序').value, /第 16 至 40 位/);
  assert.match(card.rows.find(r => r.label === '区间随机排序').value, /后台同步基础顺序/);
});

