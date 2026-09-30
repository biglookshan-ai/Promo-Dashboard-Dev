import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, ActionError, orderPipeline } from '../src/schedule-actions.js';

const T = Date.UTC(2026, 9, 1, 12), D = 86400000;
const approver = { id: 'u1', name: '审核人', role: 'approver' };
const editor = { id: 'u2', name: '编辑', role: 'editor' };
const doc = (o = {}) => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], pendingOrder: null, log: [], staff: [], ...o });
const banner = (o = {}) => ({ id: 'b1', kind: 'banner', state: 'approved', image: 'x.jpg', title: 'A', order: 0, start: null, end: null, campaign: null, ...o });

test('编辑新建 → 提交审核 → 待审核,并要通知审核人', () => {
  const r = applyAction(doc(), { type: 'save', mode: 'submit', kind: 'banner', isNew: true, values: { id: 'b-new', image: 'a.jpg', title: 'New' } }, editor, T);
  assert.equal(r.doc.banners[0].state, 'pending');
  assert.ok(r.effects.some((e) => e.type === 'notify' && e.event === 'submit'));
  assert.ok(!r.effects.some((e) => e.type === 'sync'), '没批准的不写 Shopify');
});

test('编辑不能直接发布,也不能批准', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'banner', isNew: true, values: { id: 'x', image: 'a' } }, editor, T), ActionError);
  const d = doc({ banners: [banner({ state: 'pending' })] });
  assert.throws(() => applyAction(d, { type: 'approve', id: 'b1' }, editor, T), /只有审核人/);
});

test('编辑改已上线的内容 → 只生成「修改待审核」,线上版本不变', () => {
  const d = doc({ banners: [banner()] });
  const r = applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', id: 'b1', values: { title: 'B', image: 'x.jpg' } }, editor, T);
  assert.equal(r.doc.banners[0].title, 'A');
  assert.deepEqual(Object.keys(r.doc.banners[0].pendingChange).sort(), ['at', 'by', 'title']);
  assert.ok(!r.effects.some((e) => e.type === 'sync'));
  const r2 = applyAction(r.doc, { type: 'approve', id: 'b1' }, approver, T);
  assert.equal(r2.doc.banners[0].title, 'B');
  assert.equal(r2.doc.banners[0].pendingChange, null);
  assert.ok(r2.effects.some((e) => e.type === 'sync' && e.id === 'b1'));
});

test('没改动不能提交;首尾空格不算改动', () => {
  const d = doc({ banners: [banner()] });
  assert.throws(() => applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', id: 'b1', values: { title: ' A ' } }, editor, T), /没有改动/);
});

test('审核人直接发布 = 自动批准 + 写 Shopify', () => {
  const r = applyAction(doc(), { type: 'save', mode: 'publish', kind: 'topbar', isNew: true, values: { id: 't-x', text: 'Hi' } }, approver, T);
  assert.equal(r.doc.topbar[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync' && e.id === 't-x'));
});

test('校验:结束要晚于开始、活动要开始时间', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'banner', isNew: true, values: { id: 'b2', image: 'a', start: T, end: T } }, approver, T), /结束时间/);
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'campaign', isNew: true, values: { id: 'c2', name: 'X' } }, approver, T), /开始时间/);
});

test('批准活动时,跟随它的内容一起写 Shopify', () => {
  const d = doc({ campaigns: [{ id: 'c1', kind: 'campaign', state: 'pending', name: 'Sale', start: T, end: T + D }], banners: [banner({ campaign: 'c1' })] });
  const r = applyAction(d, { type: 'approve', id: 'c1' }, approver, T);
  const synced = r.effects.filter((e) => e.type === 'sync').map((e) => e.id);
  assert.deepEqual(synced.sort(), ['b1', 'c1']);
});

test('退回要带原因,通知提交人', () => {
  const d = doc({ banners: [banner({ state: 'pending', by: 'u2' })] });
  const r = applyAction(d, { type: 'reject', id: 'b1', note: '图片换一张' }, approver, T);
  assert.equal(r.doc.banners[0].state, 'rejected');
  assert.equal(r.doc.banners[0].rejectNote, '图片换一张');
  assert.ok(r.effects.some((e) => e.event === 'decision' && e.to === 'u2' && !e.approved));
});

test('删除:只能删草稿 / 退回 / 已结束;删了的 Shopify 条目也要删', () => {
  assert.throws(() => applyAction(doc({ banners: [banner()] }), { type: 'delete', id: 'b1' }, approver, T), /只能删除/);
  const r = applyAction(doc({ banners: [banner({ end: T - 1, shopifyId: 'gid://9' })] }), { type: 'delete', id: 'b1' }, approver, T);
  assert.equal(r.doc.banners.length, 0);
  assert.deepEqual(r.effects, [{ type: 'remove', shopifyId: 'gid://9' }]);
});

test('排序:审核人直接生效;编辑提交待审核,批准后生效', () => {
  const d = doc({ banners: [banner({ id: 'a', order: 0 }), banner({ id: 'b', order: 1 }), banner({ id: 'z', order: 2, end: T - 1 })] });
  assert.deepEqual(orderPipeline(d, 'banner', T).map((x) => x.id), ['a', 'b'], '已结束的不参与排序');
  const r = applyAction(d, { type: 'order', kind: 'banner', ids: ['b', 'a'] }, approver, T);
  assert.deepEqual(r.doc.banners.sort((x, y) => x.order - y.order).map((x) => x.id), ['b', 'a', 'z']);
  const r2 = applyAction(d, { type: 'order', kind: 'banner', ids: ['b', 'a'] }, editor, T);
  assert.equal(r2.doc.banners.find((x) => x.id === 'a').order, 0, '编辑提交的顺序批准前不生效');
  assert.ok(r2.doc.pendingOrder);
  const r3 = applyAction(r2.doc, { type: 'approve', id: '__order' }, approver, T);
  assert.equal(r3.doc.banners.find((x) => x.id === 'b').order, 0);
  assert.ok(r3.effects.some((e) => e.type === 'syncOrder'));
});

test('排序:列表和现在对不上(有人刚改过)就拒绝', () => {
  const d = doc({ banners: [banner({ id: 'a', order: 0 }), banner({ id: 'b', order: 1 })] });
  assert.throws(() => applyAction(d, { type: 'order', kind: 'banner', ids: ['a'] }, approver, T), /对不上/);
});

test('暂停只能审核人做;默认样式不能暂停 / 删除', () => {
  const d = doc({ tbstyles: [{ id: 's0', kind: 'tbstyle', isDefault: true, state: 'approved', name: '默认' }] });
  assert.throws(() => applyAction(d, { type: 'pause', id: 's0' }, approver, T), /默认样式/);
  assert.throws(() => applyAction(d, { type: 'delete', id: 's0' }, approver, T), /默认样式/);
  assert.throws(() => applyAction(doc({ banners: [banner()] }), { type: 'pause', id: 'b1' }, editor, T), /只有审核人/);
});

test('不改动传入的数据(纯函数)', () => {
  const d = doc({ banners: [banner()] });
  const snap = JSON.stringify(d);
  applyAction(d, { type: 'pause', id: 'b1' }, approver, T);
  assert.equal(JSON.stringify(d), snap);
});
