// 每个价格自己的设置(2026-11-09 用户:加进 Collection / 产品标签 / 关联活动 / 倒计时按价格设)
// 编辑器保存时把价格的设置展开到每一段;执行器按段读,段上没有(老计划)就用计划上的
import test from 'node:test';
import assert from 'node:assert/strict';
import { planTags, planCountdowns, planCollections } from '../src/price/price-core.js';
import { validate } from '../src/price/price-actions.js';

const H = 3600_000;
const it = (v, pid) => ({ variantId: v, productId: pid, title: v, price: '80.00', refPrice: '100.00', refCompareAt: null, group: 'g1' });
const plan = (extra = {}) => ({ id: 'p', name: '黑五', kind: 'window', state: 'approved', excluded: [], tagsAdd: ['OLD'], tagsRemove: [], countdown: { on: false },
  slots: [
    { id: 'a', start: 0, end: 10 * H, version: 'A', collection: { id: 'C1', title: 'Black Friday' }, tagsAdd: ['BFCM'], tagsRemove: [], countdown: { on: false }, items: [it('v1', 'P1')] },
    { id: 'b', start: 10 * H, end: 20 * H, version: 'B', collection: { id: 'C2', title: 'FlashDeal' }, tagsAdd: ['BFCM', 'Flash'], tagsRemove: ['Old'], countdown: { on: true, label: 'Flash ends in', days: 0, style: 'pill' }, items: [it('v1', 'P1')] },
  ], ...extra });

test('标签按段:第一段只加 BFCM;换到第二段加 Flash、去掉 Old;计划上的标签不算(段上有自己的)', () => {
  const st = { plans: [plan()], tagState: {} };
  const t1 = planTags(st, 5 * H);
  assert.deepEqual(t1.map((x) => [x.productId, x.todoAdd, x.todoRemove]), [['P1', ['BFCM'], []]]);
  st.tagState = { P1: { added: ['BFCM'], removed: [] } };
  const t2 = planTags(st, 15 * H);
  assert.deepEqual(t2.map((x) => [x.todoAdd, x.todoRemove, x.undoAdd]), [[['Flash'], ['Old'], []]]);
  // 老计划(段上没有 tagsAdd):照旧用计划上的
  const old = plan(); for (const s of old.slots) { delete s.tagsAdd; delete s.tagsRemove; }
  assert.deepEqual(planTags({ plans: [old], tagState: {} }, 5 * H)[0].todoAdd, ['OLD']);
});

test('倒计时按段:只有第二段(开了倒计时的价格)写,文字 / 样式用段上的', () => {
  const st = { plans: [plan()], vault: { v1: { productId: 'P1', written: { planId: 'p', slotId: 'a' } } }, cdState: {} };
  assert.deepEqual(planCountdowns(st, 5 * H).set, []);
  st.vault.v1.written.slotId = 'b';
  const cd = planCountdowns(st, 15 * H);
  assert.equal(cd.set.length, 1);
  assert.deepEqual(JSON.parse(cd.set[0].value), { e: Math.floor(20 * H / 1000), s: 0, l: 'Flash ends in', st: 'pill' });
  // 老计划(段上没有 countdown):用计划上的
  const old = plan({ countdown: { on: true, label: 'Ends', style: 'classic' } }); for (const s of old.slots) delete s.countdown;
  st.plans = [old];
  assert.equal(JSON.parse(planCountdowns(st, 15 * H).set[0].value).l, 'Ends');
});

test('加进 Collection 按段:第一段要 C1,第二段要 C2(C1 里 app 加的移出)', () => {
  const st = { plans: [plan()], collState: {} };
  assert.deepEqual(planCollections(st, 5 * H).map((x) => [x.collectionId, x.check]), [['C1', ['P1']]]);
  st.collState = { C1: { managed: ['P1'], preexisting: [] } };
  const r = planCollections(st, 15 * H);
  assert.deepEqual(r.map((x) => [x.collectionId, x.remove, x.check]).sort(), [['C1', ['P1'], []], ['C2', [], ['P1']]]);
});

test('保存检查:段上的倒计时文字 / 标签格式', () => {
  const base = { ...plan(), versions: [{ id: 'A', name: '平时价' }, { id: 'B', name: 'Flash 价' }], groups: [{ id: 'g1', scope: { mode: 'products', products: [] }, rule: { mode: 'percent_off', value: '20' }, compare: 'original' }] };
  assert.equal(validate(base), '');
  assert.match(validate({ ...base, slots: base.slots.map((s) => ({ ...s, countdown: { on: true, label: 'x'.repeat(61) } })) }), /倒计时文字最多 60 个字/);
  assert.match(validate({ ...base, slots: base.slots.map((s) => ({ ...s, tagsAdd: [1] })) }), /标签的格式不对/);
});
