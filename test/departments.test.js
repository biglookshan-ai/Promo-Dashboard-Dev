// 部门负责人(2026-11-10,docs/departments/PLAN.md):部门上限、负责人给员工定档位、敏感功能、拉人 / 移出、按页面给身份
import test from 'node:test';
import assert from 'node:assert/strict';
import { rolesOf, levelOf, levelsOf, capOf, pagesOf, setGrant, joinDept, leaveDept, saveRoles, actorOf, deptView, leadDepts } from '../src/members.js';
import { applyAction } from '../src/schedule-actions.js';

const mem = (id, roles, o = {}) => ({ id, name: id, status: 'active', roles, ...o });
const shop = () => {
  const s = { members: [mem('boss', ['admin']), mem('lead', ['pricing']), mem('p1', ['pricing']), mem('p2', ['pricing', 'design']), mem('new', [], { status: 'pending' }), mem('ops1', ['ops'])] };
  saveRoles(s, s.members[0], rolesOf(s).map((r) => (r.key === 'pricing' ? { ...r, leads: ['lead'] } : r)));
  return s;
};
const M = (s, id) => s.members.find((m) => m.id === id);

test('老角色变部门:原来能看的页面 = 能上线,谁都不会少权限;设置 / 工具只给管理员', () => {
  const s = { members: [mem('a', ['ops'])], roles: [{ key: 'ops', name: '运营', pages: ['overview', 'pmodules'] }] }; // v1 老数据
  const r = rolesOf(s).find((x) => x.key === 'ops');
  assert.equal(r.ceiling.pmodules, 3); assert.equal(r.ceiling.pins, 3, 'v1 的商品模块拆出来的照给'); assert.equal(r.ceiling.price, 0);
  assert.deepEqual(r.leads, []);
  assert.deepEqual(pagesOf(s, s.members[0]), ['overview', 'pmodules', 'callouts', 'pins', 'salelinks', 'history']);
  assert.equal(levelOf(s, mem('x', ['admin']), 'settings'), 3);
  assert.equal(levelOf(s, s.members[0], 'settings'), 0);
});

test('档位:员工 = min(部门上限, 负责人给的),几个部门取最高;负责人 = 上限;只看的页面照样在导航里,不能看的不在', () => {
  const s = shop();
  setGrant(s, M(s, 'lead'), 'pricing', 'p1', { levels: { price: 2, pins: 1, salelinks: 0 } });
  assert.equal(levelOf(s, M(s, 'p1'), 'price'), 2);
  assert.equal(levelOf(s, M(s, 'p1'), 'pins'), 1);
  assert.ok(!pagesOf(s, M(s, 'p1')).includes('salelinks'));
  assert.ok(pagesOf(s, M(s, 'p1')).includes('pins'));
  assert.equal(levelOf(s, M(s, 'lead'), 'price'), 3);
  setGrant(s, M(s, 'lead'), 'pricing', 'p2', { levels: { overview: 1 } });
  assert.equal(levelOf(s, M(s, 'p2'), 'overview'), 3, '设计部那边的上限更高,取最高');
  assert.equal(levelOf(s, M(s, 'p2'), 'price'), 3, '没单独设的页面 = 上限');
  assert.deepEqual(levelsOf(s, M(s, 'p1')).price, 2);
  // 负责人给的不能超过上限(超过的按上限存)
  setGrant(s, M(s, 'lead'), 'pricing', 'p1', { levels: { banners: 3 } });
  assert.equal(levelOf(s, M(s, 'p1'), 'banners'), 0, '定价部门没有 Banner 页');
});

test('敏感功能:跟着「能上线」;部门关掉谁都没有(负责人也没有);负责人能给员工单独关', () => {
  const s = shop();
  assert.equal(capOf(s, M(s, 'p1'), 'price.control'), true);
  setGrant(s, M(s, 'lead'), 'pricing', 'p1', { capsOff: ['price.control'] });
  assert.equal(capOf(s, M(s, 'p1'), 'price.control'), false);
  assert.equal(capOf(s, M(s, 'p1'), 'price.hold'), true);
  setGrant(s, M(s, 'lead'), 'pricing', 'p1', { levels: { price: 2 }, capsOff: [] });
  assert.equal(capOf(s, M(s, 'p1'), 'price.hold'), false, '能编辑档没有敏感功能');
  saveRoles(s, M(s, 'boss'), rolesOf(s).map((r) => (r.key === 'pricing' ? { ...r, capsOff: ['price.export'] } : r)));
  assert.equal(capOf(s, M(s, 'lead'), 'price.export'), false, '部门关掉 = 负责人也没有');
  assert.equal(capOf(s, M(s, 'boss'), 'price.export'), true);
});

test('只有本部门负责人(和管理员)能改;负责人改不了别的负责人、别的部门', () => {
  const s = shop();
  assert.throws(() => setGrant(s, M(s, 'p1'), 'pricing', 'p2', {}), /负责人/);
  assert.throws(() => setGrant(s, M(s, 'lead'), 'ops', 'ops1', {}), /负责人/);
  assert.throws(() => setGrant(s, M(s, 'lead'), 'pricing', 'lead', {}), /部门上限/);
  assert.throws(() => setGrant(s, M(s, 'lead'), 'pricing', 'ops1', {}), /不在这个部门/);
  assert.ok(setGrant(s, M(s, 'boss'), 'ops', 'ops1', { levels: { banners: 1 } }));
  assert.deepEqual(leadDepts(s, M(s, 'lead')).map((r) => r.key), ['pricing']);
  assert.deepEqual(deptView(s, M(s, 'lead')).map((d) => d.key), ['pricing']);
  assert.equal(deptView(s, M(s, 'boss')).length, 4);
});

test('拉人 / 移出:待分配的拉进来就启用;没别的部门了回到待分配;负责人移不了负责人和自己', () => {
  const s = shop();
  const r = joinDept(s, M(s, 'lead'), 'pricing', 'new');
  assert.equal(r.wasPending, true); assert.equal(M(s, 'new').status, 'active'); assert.equal(levelOf(s, M(s, 'new'), 'price'), 3);
  assert.throws(() => joinDept(s, M(s, 'lead'), 'pricing', 'new'), /已经在/);
  setGrant(s, M(s, 'lead'), 'pricing', 'new', { levels: { price: 1 } });
  const out = leaveDept(s, M(s, 'lead'), 'pricing', 'new');
  assert.equal(out.pending, true); assert.equal(M(s, 'new').status, 'pending');
  assert.equal(rolesOf(s).find((x) => x.key === 'pricing').grants.new, undefined, '移出时权限一起清掉');
  assert.throws(() => leaveDept(s, M(s, 'lead'), 'pricing', 'lead'), /自己/);
  saveRoles(s, M(s, 'boss'), rolesOf(s).map((x) => (x.key === 'pricing' ? { ...x, leads: ['lead', 'p1'] } : x)));
  assert.throws(() => leaveDept(s, M(s, 'lead'), 'pricing', 'p1'), /管理员/);
});

test('管理员指定负责人:自动算进这个部门(待分配的顺便启用);只勾页面的老界面不会把设过的档位改掉', () => {
  const s = shop();
  saveRoles(s, M(s, 'boss'), rolesOf(s).map((r) => (r.key === 'ops' ? { ...r, leads: ['new'] } : r)));
  assert.equal(M(s, 'new').status, 'active'); assert.ok(M(s, 'new').roles.includes('ops'));
  saveRoles(s, M(s, 'boss'), rolesOf(s).map((r) => (r.key === 'pricing' ? { ...r, ceiling: { ...r.ceiling, pins: 1 } } : r)));
  saveRoles(s, M(s, 'boss'), rolesOf(s).map(({ ceiling, ...r }) => r)); // 老界面:只传 pages
  assert.equal(rolesOf(s).find((r) => r.key === 'pricing').ceiling.pins, 1);
});

test('按页面给身份:能编辑 = 保存要提交、不能直接发布;能上线 = 直接生效', () => {
  const s = shop();
  setGrant(s, M(s, 'lead'), 'pricing', 'p1', { levels: { pins: 2 } });
  const ed = actorOf(M(s, 'p1'), s, 'pins');
  assert.equal(ed.role, 'editor');
  assert.equal(actorOf(M(s, 'lead'), s, 'pins').role, 'approver');
  const doc = { banners: [], topbar: [], tbstyles: [], campaigns: [], pmodules: [], pins: [], salelinks: [], callouts: [], log: [], settings: {} };
  const values = { id: 'pn1', collection: { id: '1', title: 'C' }, products: [{ id: '11', title: 'P' }], start: null, end: null };
  assert.throws(() => applyAction(doc, { type: 'save', mode: 'publish', kind: 'pin', isNew: true, values }, ed, 0), /审批人/);
  const r = applyAction(doc, { type: 'save', mode: 'submit', kind: 'pin', isNew: true, values }, ed, 0);
  assert.equal(r.doc.pins[0].state, 'pending');
  assert.equal(applyAction(doc, { type: 'save', mode: 'submit', kind: 'pin', isNew: true, values: { ...values, id: 'pn2' } }, actorOf(M(s, 'lead'), s, 'pins'), 0).doc.pins.find((x) => x.id === 'pn2').state, 'approved');
});
