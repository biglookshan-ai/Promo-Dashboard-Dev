// 网站内容的历史版本:每次动作记一版、一样的不重复、删掉的保留、看得出改了哪些字段
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../src/schedule-actions.js';
import { recordChanges, changedKeys, pushItemVersion } from '../src/item-history.js';

const approver = { id: 'u1', name: '管理员', role: 'approver' };
const editor = { id: 'u2', name: '运营', role: 'editor' };
const empty = () => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], pmodules: [], pins: [], log: [], pendingOrder: null });
const run = (h, doc, action, actor, now) => {
  const r = applyAction(doc, action, actor, now);
  const after = { ...doc, ...r.doc };
  recordChanges(h, doc, after, [action.id, r.id], { action: action.type, by: actor.name }, now);
  return after;
};

test('保存 → 提交修改 → 批准 → 暂停 → 删除,每一步都留一版;删掉的历史还在', () => {
  const h = {};
  let d = empty();
  d = run(h, d, { type: 'save', mode: 'publish', kind: 'topbar', isNew: true, id: 't-1', values: { id: 't-1', emoji: '📣', text: '旧文案', start: 1000, end: 2000 } }, approver, 10);
  d = run(h, d, { type: 'save', mode: 'submit', kind: 'topbar', id: 't-1', values: { text: '新文案' } }, editor, 20);
  d = run(h, d, { type: 'approve', id: 't-1' }, approver, 30);
  d = run(h, d, { type: 'pause', id: 't-1' }, approver, 40);
  d = run(h, d, { type: 'pause', id: 't-1' }, approver, 45);
  const vs = h['t-1'].versions;
  assert.deepEqual(vs.map((v) => v.at), [10, 20, 30, 40, 45]);
  assert.equal(vs[1].values.text, '旧文案'); assert.equal(vs[1].pending.text, '新文案'); // 提交时线上还是旧的,修改在 pending
  assert.equal(vs[2].values.text, '新文案'); assert.equal(vs[2].pending, null);
  assert.equal(vs[3].paused, true);
  assert.deepEqual(changedKeys(vs[1].values, vs[2].values), ['text']);
  // 结束后删掉:历史留着,最后一版标「已删除」
  const d2 = run(h, d, { type: 'delete', id: 't-1' }, approver, 5000);
  assert.equal(d2.topbar.length, 0);
  assert.equal(h['t-1'].versions.at(-1).deleted, true);
  assert.equal(h['t-1'].versions.at(-1).values.text, '新文案');
});

test('一模一样的不重复记;改了什么看得出来', () => {
  const h = {};
  const it = { id: 'b-1', kind: 'banner', state: 'approved', title: 'A', image: 'x.jpg', start: null, end: null };
  assert.equal(pushItemVersion(h, it, { action: 'x' }, 1), true);
  assert.equal(pushItemVersion(h, { ...it }, { action: 'y' }, 2), false);
  assert.equal(pushItemVersion(h, { ...it, title: 'B', end: 9 }, { action: 'z' }, 3), true);
  assert.deepEqual(changedKeys(h['b-1'].versions[0].values, h['b-1'].versions[1].values).sort(), ['end', 'title']);
  assert.deepEqual(changedKeys({ subtitle: '' }, { subtitle: null }), []); // 空字符串和没填算一样
});

test('清理:只删已经不存在的内容的历史', async () => {
  const { pruneDeletedHistory } = await import('../src/item-history.js');
  const h = { a: { kind: 'banner', versions: [] }, b: { kind: 'banner', versions: [] }, c: { kind: 'pin', versions: [] } };
  assert.equal(pruneDeletedHistory(h, ['a', 'c']), 1);
  assert.deepEqual(Object.keys(h), ['a', 'c']);
});
