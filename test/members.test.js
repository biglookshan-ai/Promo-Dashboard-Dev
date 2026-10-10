import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertOnLogin, updateMember, saveRoles, pagesOf, isAdmin, canSee, actorOf } from '../src/members.js';
import { issueSession, verifySession } from '../src/lark-login.js';

const u = (openId, name) => ({ openId, name, avatar: '', tenantKey: 't1' });

test('第一个从 Shopify 后台登录的人成为管理员;直接开网页登录的不会', () => {
  const s = { members: [] };
  const web = upsertOnLogin(s, u('ou_web', '网页来的'), { fromAdmin: false });
  assert.equal(web.status, 'pending');
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  assert.ok(isAdmin(boss));
  const next = upsertOnLogin(s, u('ou_2', '同事'), { fromAdmin: true });
  assert.equal(next.status, 'pending'); // 已经有管理员了,后来的都是待分配
  assert.deepEqual(pagesOf(s, next), []);
});

test('再次登录只更新名字头像,不改角色', () => {
  const s = { members: [] };
  upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  const again = upsertOnLogin(s, u('ou_boss', '老板(新名字)'), { fromAdmin: false });
  assert.ok(isAdmin(again));
  assert.equal(again.name, '老板(新名字)');
  assert.equal(s.members.length, 1);
});

test('管理员分配角色 → 自动启用,按角色看页面;设置 / 工具只有管理员', () => {
  const s = { members: [] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  upsertOnLogin(s, u('ou_ops', '运营'), { fromAdmin: false });
  const m = updateMember(s, boss, 'ou_ops', { roles: ['ops', 'pricing'] });
  assert.equal(m.status, 'active');
  assert.deepEqual(pagesOf(s, m), ['overview', 'campaigns', 'banners', 'topbar', 'pmodules', 'reviews', 'price']);
  assert.ok(!canSee(s, m, 'settings'));
  assert.ok(canSee(s, boss, 'settings'));
  assert.equal(actorOf(boss).role, 'approver');
  assert.equal(actorOf(m).role, 'editor');
});

test('非管理员不能管成员;不能撤掉最后一个管理员;停用后看不到任何页面', () => {
  const s = { members: [] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  const ops = upsertOnLogin(s, u('ou_ops', '运营'), { fromAdmin: false });
  updateMember(s, boss, 'ou_ops', { roles: ['ops'] });
  assert.throws(() => updateMember(s, ops, 'ou_boss', { status: 'disabled' }), /只有管理员/);
  assert.throws(() => updateMember(s, boss, 'ou_boss', { roles: ['ops'] }), /至少要留一个管理员/);
  updateMember(s, boss, 'ou_ops', { status: 'disabled' });
  assert.deepEqual(pagesOf(s, ops), []);
});

test('改角色页面:管理员角色固定;删掉的角色从成员身上去掉;设置 / 工具勾了也不算', () => {
  const s = { members: [] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  const p = upsertOnLogin(s, u('ou_p', '摄影'), { fromAdmin: false });
  saveRoles(s, boss, [{ key: 'admin', pages: [] }, { key: 'photo', name: '摄影', pages: ['campaigns', 'settings', 'bogus'] }]);
  assert.deepEqual(s.roles.find((r) => r.key === 'admin').pages.length > 5, true);
  assert.deepEqual(s.roles.find((r) => r.key === 'photo').pages, ['campaigns']);
  updateMember(s, boss, 'ou_p', { roles: ['photo', 'ops'] }); // ops 已经被删了
  assert.deepEqual(p.roles, ['photo']);
  assert.deepEqual(pagesOf(s, p), ['campaigns']);
});

test('登录会话:签名对才认,过期 / 篡改都不认', () => {
  const t = issueSession({ uid: 'ou_1', shop: 'x.myshopify.com' }, 1000);
  assert.equal(verifySession(t, 2000).uid, 'ou_1');
  assert.equal(verifySession(t, 1000 + 31 * 86400_000), null);
  const [p, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'ou_boss', shop: 'x.myshopify.com', iat: 1, exp: 9e15 })).toString('base64url');
  assert.equal(verifySession(`${forged}.${sig}`, 2000), null);
  assert.equal(verifySession(`${p}.xx`, 2000), null);
  assert.equal(verifySession('', 2000), null);
});
