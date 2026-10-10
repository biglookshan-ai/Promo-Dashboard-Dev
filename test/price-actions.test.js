import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, validate } from '../src/price/price-actions.js';
import { planWork, decide, commit, holdVariant, sweep } from '../src/price/price-core.js';

const H = 3600_000;
const boss = { id: '1', name: '审核人', role: 'approver' };
const ed = { id: '2', name: '编辑', role: 'editor' };
const item = (variantId, price) => ({ variantId, productId: `P-${variantId}`, title: variantId, price, refPrice: '100.00', refCompareAt: null });
const values = (extra = {}) => ({ id: 'p1', name: 'Early BF 全场', kind: 'window', layer: 'sitewide',
  slots: [{ id: 's1', start: 10 * H, end: 20 * H, items: [item('v1', '85.00')] }, { id: 's2', start: 30 * H, end: 40 * H, items: [item('v2', '85.00')] }], ...extra });
const empty = () => ({ plans: [], vault: {}, log: [], settings: {} });
const run = (doc, action, actor, now = 0) => applyAction(doc, action, actor, now).doc;

test('编辑提交 → 待审核;编辑不能批准;审核人批准', () => {
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, ed);
  assert.equal(doc.plans[0].state, 'pending');
  assert.throws(() => applyAction(doc, { type: 'approve', id: 'p1' }, ed), /审批人/);
  const r = applyAction(doc, { type: 'approve', id: 'p1' }, boss, 5);
  assert.equal(r.doc.plans[0].state, 'approved');
  assert.equal(r.doc.plans[0].approvedAt, 5);
  assert.ok(r.effects.some((e) => e.type === 'run'));
});

test('审核人自己提交 = 直接批准;退回带原因', () => {
  const doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  assert.equal(doc.plans[0].state, 'approved');
  let d2 = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, ed);
  d2 = run(d2, { type: 'reject', id: 'p1', note: '折扣太大' }, boss);
  assert.equal(d2.plans[0].state, 'rejected');
  assert.equal(d2.plans[0].rejectNote, '折扣太大');
});

test('校验:名称、时间、活动价不比原价低、重复变体、同计划时段重叠又有同一产品', () => {
  assert.match(validate(values({ name: ' ' })), /名称/);
  assert.match(validate(values({ slots: [{ id: 'a', start: 10, end: 5, items: [item('v1', '85')] }] })), /结束时间/);
  assert.match(validate(values({ slots: [{ id: 'a', start: 1, end: 5, items: [item('v1', '100.00')] }] })), /不比现价低/);
  assert.match(validate(values({ slots: [{ id: 'a', start: 1, end: 5, items: [item('v1', '85'), item('v1', '80')] }] })), /重复/);
  assert.match(validate(values({ slots: [
    { id: 'a', start: 1, end: 10, items: [item('v1', '85')] },
    { id: 'b', start: 5, end: 15, items: [item('v1', '80')] }] })), /重叠/);
  assert.match(validate({ ...values(), kind: 'permanent', slots: [{ id: 'a', start: 1, end: null, items: [item('v1', '110')] }, { id: 'b', start: 2, end: null, items: [item('v2', '110')] }] }), /只能有一个/);
  assert.match(validate(values({ slots: [{ id: 'a', start: 1, end: 5, items: [{ ...item('v1', null) }] }] })), /还没设活动价/);
  assert.match(validate({ ...values(), kind: 'permanent', compare: 'keep', slots: [{ id: 'a', start: 1, end: null, items: [item('v1', null)] }] }), /没有任何改动/);
  assert.equal(validate({ ...values(), kind: 'permanent', compare: 'set', slots: [{ id: 'a', start: 1, end: null, items: [{ ...item('v1', null), compareAt: '150.00' }] }] }), '');
  assert.equal(validate(values()), '');
  // 草稿不校验
  assert.equal(run(empty(), { type: 'save', mode: 'draft', isNew: true, values: values({ name: '' }) }, ed).plans[0].state, 'draft');
});

test('已开始的时段锁死;没开始的时段可以改(编辑改要审核,批准前按原计划执行)', () => {
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  const now = 15 * H; // s1 已开始,s2 没开始
  const changed = values();
  changed.slots[0].items[0].price = '80.00';
  assert.throws(() => applyAction(doc, { type: 'save', mode: 'submit', id: 'p1', values: changed }, ed, now), /锁定/);
  assert.throws(() => applyAction(doc, { type: 'save', mode: 'submit', id: 'p1', values: { ...values(), slots: [values().slots[1]] } }, ed, now), /不能删除/);
  assert.throws(() => applyAction(doc, { type: 'save', mode: 'submit', id: 'p1', values: { ...values(), layer: 'flash' } }, ed, now), /不能再改/);

  const future = values();
  future.slots[1].items[0].price = '75.00';
  doc = run(doc, { type: 'save', mode: 'submit', id: 'p1', values: future }, ed, now);
  assert.equal(doc.plans[0].slots[1].items[0].price, '85.00'); // 批准前不变
  assert.ok(doc.plans[0].pendingChange);
  doc = run(doc, { type: 'approve', id: 'p1' }, boss, now + 1);
  assert.equal(doc.plans[0].slots[1].items[0].price, '75.00');
  assert.equal(doc.plans[0].pendingChange, null);
  assert.throws(() => applyAction(doc, { type: 'save', mode: 'draft', id: 'p1', values: future }, ed, now), /不能存草稿/);
});

test('停止任何人都能做;进行中不能删;还有产品没恢复不能删', () => {
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  assert.throws(() => applyAction(doc, { type: 'delete', id: 'p1' }, boss, 15 * H), /先「停止」/);
  doc.vault.v1 = { productId: 'P-v1', base: { price: '100.00', compareAt: null }, written: { price: '85.00', compareAt: '100.00', planId: 'p1', slotId: 's1' } };
  doc = run(doc, { type: 'stop', id: 'p1' }, ed, 15 * H);
  assert.equal(doc.plans[0].stopped, true);
  assert.throws(() => applyAction(doc, { type: 'delete', id: 'p1' }, boss, 15 * H), /没恢复/);
  delete doc.vault.v1;
  assert.equal(run(doc, { type: 'delete', id: 'p1' }, boss, 15 * H).plans.length, 0);
  // 已批准的只有审核人能删
  const d2 = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  assert.throws(() => applyAction(d2, { type: 'delete', id: 'p1' }, ed, 0), /审批人/);
});

test('暂停 / 继续只有审核人;移出产品', () => {
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  assert.throws(() => applyAction(doc, { type: 'pause', id: 'p1' }, ed), /审批人/);
  doc = run(doc, { type: 'pause', id: 'p1' }, boss);
  assert.equal(doc.plans[0].paused, true);
  doc = run(doc, { type: 'resume', id: 'p1' }, boss);
  assert.equal(doc.plans[0].paused, false);
  doc = run(doc, { type: 'exclude', id: 'p1', variantIds: ['v1'] }, ed);
  assert.deepEqual(doc.plans[0].excluded, ['v1']);
});

// 处理「有人手动改价」的三种选择,接着跑一轮执行器看结果
function setupHold(choice, manual = '90.00') {
  const shop = new Map([['v1', { productId: 'P-v1', price: '100.00', compareAt: null }]]);
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  const tick = (now) => {
    for (const h of sweep(doc, shop)) holdVariant(doc, h, now);
    const r = decide(doc, planWork(doc, now), shop);
    for (const w of r.writes) { shop.set(w.variantId, { ...shop.get(w.variantId), ...w.to }); commit(doc, w, now); }
    for (const d of r.done) commit(doc, d, now);
    for (const h of r.holds) holdVariant(doc, h, now);
    return r;
  };
  tick(11 * H);
  shop.set('v1', { ...shop.get('v1'), price: manual });
  tick(12 * H);
  assert.ok(doc.vault.v1.hold);
  doc = run(doc, { type: 'resolve', variantId: 'v1', choice }, boss, 12 * H);
  tick(13 * H);
  tick(25 * H); // 活动结束
  return { doc, shop };
}

const priceOf = (shop) => ({ price: shop.get('v1').price, compareAt: shop.get('v1').compareAt });

test('处理异常:以现价为原价重新套用 → 活动结束恢复成新原价,划线价不残留', () => {
  const shop = new Map([['v1', { productId: 'P-v1', price: '100.00', compareAt: null }]]);
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values() }, boss);
  const tick = (now) => {
    for (const h of sweep(doc, shop)) holdVariant(doc, h, now);
    const r = decide(doc, planWork(doc, now), shop);
    for (const w of r.writes) { shop.set(w.variantId, { ...shop.get(w.variantId), ...w.to }); commit(doc, w, now); }
    for (const d of r.done) commit(doc, d, now);
    for (const h of r.holds) holdVariant(doc, h, now);
  };
  tick(11 * H);
  shop.set('v1', { ...shop.get('v1'), price: '90.00' }); // 同事把售价从 85 改成 90(划线价还是 app 写的 100)
  tick(12 * H);
  doc = run(doc, { type: 'resolve', variantId: 'v1', choice: 'reapply' }, boss, 12 * H);
  tick(13 * H);
  assert.deepEqual(priceOf(shop), { price: '85.00', compareAt: '90.00' }); // 按新原价 90 套活动价
  assert.deepEqual(doc.vault.v1.base, { price: '90.00', compareAt: null });
  tick(25 * H);
  assert.deepEqual(priceOf(shop), { price: '90.00', compareAt: null });
  assert.deepEqual(doc.vault, {});
});
test('处理异常:退出计划保持现价 → 售价不动,app 加的划线价去掉', () => {
  const { doc, shop } = setupHold('keep', '79.00');
  assert.deepEqual(priceOf(shop), { price: '79.00', compareAt: null });
  assert.deepEqual(doc.vault, {});
  assert.deepEqual(doc.plans[0].excluded, ['v1']);
});
test('处理异常:恢复原价并退出', () => {
  const { doc, shop } = setupHold('restore', '79.00');
  assert.deepEqual(priceOf(shop), { price: '100.00', compareAt: null });
  assert.deepEqual(doc.vault, {});
});
test('处理异常:改成比活动价还低再重新套用 → 安全闸再次拦下,不涨价', () => {
  const { doc, shop } = setupHold('reapply', '79.00');
  assert.equal(shop.get('v1').price, '79.00');
  assert.equal(doc.vault.v1.hold.reason, 'not-lower');
});
test('指定审批人:被指定的编辑能批准这个计划,其他编辑不能;管理员都能', () => {
  const other = { id: '3', name: '另一个编辑', role: 'editor' };
  let doc = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values({ approver: '2' }) }, other);
  assert.equal(doc.plans[0].state, 'pending');
  assert.throws(() => applyAction(doc, { type: 'approve', id: 'p1' }, other), /审批人/);
  doc = run(doc, { type: 'approve', id: 'p1' }, ed); // ed.id = '2' 是指定的审批人
  assert.equal(doc.plans[0].state, 'approved');
  // 指定审批人自己提交 = 直接批准
  const d2 = run(empty(), { type: 'save', mode: 'submit', isNew: true, values: values({ approver: '2' }) }, ed);
  assert.equal(d2.plans[0].state, 'approved');
});

test('处理异常只有审核人能做', () => {
  const doc = { ...empty(), vault: { v1: { hold: { reason: 'manual', seen: { price: '1' } } } } };
  assert.throws(() => applyAction(doc, { type: 'resolve', variantId: 'v1', choice: 'keep' }, ed), /审批人/);
});
