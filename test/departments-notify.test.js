// 部门负责人(2026-11-10)第 4、5 期:能编辑的员工提交 → 负责人批;部门通知(本部门谁收 / 部门群 / 什么时候)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-dept-'));
const { rolesOf, saveRoles, setGrant, setDeptNotify, reviewsOn, pagesOf, leadApprovers } = await import('../src/members.js');
const { approversOf } = await import('../src/notifier.js');
const { centerOf, recipients, dispatch, ensureSaved } = await import('../src/notify-center.js');

const HOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/dept1';
const mem = (id, roles, o = {}) => ({ id, name: id, status: 'active', roles, ...o });
const shop = () => {
  const s = { members: [mem('boss', ['admin']), mem('lead', ['ops']), mem('o1', ['ops']), mem('o2', ['ops']), mem('p1', ['pricing'])], settings: { notify: {} }, notified: {} };
  saveRoles(s, s.members[0], rolesOf(s).map((r) => (r.key === 'ops' ? { ...r, leads: ['lead'] } : r)));
  return s;
};
const M = (s, id) => s.members.find((m) => m.id === id);
const ppl = (s, msg) => { const r = recipients(s, centerOf(s), msg); return r && { main: r.people.sort(), extra: r.extra.map((x) => ({ people: x.people.sort(), groups: x.groups.map((g) => g.id), mode: x.when.mode })) }; };

test('有人是「能编辑」档 → 打开「审核」页;他的提交发给本部门这一页能上线的负责人', () => {
  const s = shop();
  assert.equal(reviewsOn(s), false);
  assert.ok(!pagesOf(s, M(s, 'o1')).includes('reviews'));
  setGrant(s, M(s, 'lead'), 'ops', 'o1', { levels: { banners: 2 } });
  assert.equal(reviewsOn(s), true);
  assert.ok(pagesOf(s, M(s, 'lead')).includes('reviews'));
  assert.deepEqual(leadApprovers(s, 'o1', 'banners'), ['lead']);
  assert.deepEqual(approversOf(s, { kind: 'banner', by: 'o1' }), ['lead']);
  assert.deepEqual(approversOf(s, { kind: 'banner', by: 'p1' }), ['boss'], '定价部门没有负责人 → 管理员');
  assert.deepEqual(approversOf(s, { kind: 'banner', by: 'o1', approver: 'o2' }), ['o2'], '指定了审批人照旧');
});

test('部门通知:没自己定 = 跟消息中心;自己定了 = 本部门的人按部门的设置收,管理员照旧', () => {
  const s = shop();
  const msg = { ev: 'banner.updated', related: ['o1'], actor: 'o1', page: 'banners' };
  assert.deepEqual(ppl(s, msg), { main: ['boss'], extra: [] }, '默认:相关的人 + 管理员,不发给动手的 o1');
  setDeptNotify(s, M(s, 'lead'), 'ops', { rules: { 'banner.updated': { on: true, to: 'all', notActor: true, when: { mode: 'merge', merge: 10 } } } });
  assert.deepEqual(ppl(s, msg), { main: ['boss'], extra: [{ people: ['lead', 'o2'], groups: [], mode: 'merge' }] });
  setDeptNotify(s, M(s, 'lead'), 'ops', { rules: { 'banner.updated': { on: true, to: 'leads', when: { mode: 'now' } } } });
  assert.deepEqual(ppl(s, msg).extra[0].people, ['lead']);
  setDeptNotify(s, M(s, 'lead'), 'ops', { rules: { 'banner.updated': { on: false, to: 'related', when: { mode: 'now' } } } });
  assert.deepEqual(ppl(s, { ...msg, actor: 'someone' }), { main: ['boss'], extra: [] }, '本部门的人不收:o1 不再按消息中心收');
  // 负责人只能管自己的部门;每天汇总只有日常通知能选
  assert.throws(() => setDeptNotify(s, M(s, 'o1'), 'ops', { rules: {} }), /负责人/);
  const r = setDeptNotify(s, M(s, 'lead'), 'ops', { rules: { 'banner.failure': { on: true, to: 'all', when: { mode: 'digest', at: '10:00' } } } }, { info: (k) => !k.endsWith('failure') });
  assert.equal(r.notify.rules['banner.failure'].when.mode, 'now');
});

test('部门群:负责人设的群只给本部门自己定的通知用;同一个人只收一次', async () => {
  const s = shop();
  assert.throws(() => setDeptNotify(s, M(s, 'lead'), 'ops', { group: { name: '运营群', webhook: 'https://example.com/x' } }), /格式不对/);
  setDeptNotify(s, M(s, 'lead'), 'ops', { group: { name: '运营群', webhook: HOOK }, rules: { 'banner.live': { on: true, to: 'all', group: true, when: { mode: 'now' } } } });
  assert.deepEqual(centerOf(s).groups.map((g) => g.id), ['d:ops']);
  const c = ensureSaved(s, {});
  c.rules['banner.live'].to.people = ['o2']; // 消息中心里点名了 o2:o2 照旧按消息中心收,但只收一次
  const dms = []; const groups = [];
  await dispatch('', [{ ev: 'banner.live', path: '/banners/b1', related: ['o1'], page: 'banners', data: { name: 'BF' } }], { sched: s, now: 1000,
    sendDm: async (ids, card) => { dms.push([...ids].sort().join(',')); return []; }, sendGroup: async (g) => { groups.push(g.webhook); } });
  assert.deepEqual(dms, ['boss,lead,o1,o2'], '同一张卡片合起来发一次,每人只收一次');
  assert.deepEqual(groups, [HOOK]);
});
