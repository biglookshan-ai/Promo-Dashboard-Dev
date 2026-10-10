import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertOnLogin, updateMember, saveRoles, pagesOf, isAdmin, canSee, actorOf } from '../src/members.js';
import { issueSession, verifySession, newLoginState, finishLoginState, redeemLoginState, loginStatus } from '../src/lark-login.js';

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

test('「第一个登录是管理员」只发生一次:有过管理员后,就算管理员没了也不会再自动给别人', () => {
  const s = { members: [] };
  upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  assert.equal(s.bootstrapDone, true);
  s.members = []; // 比如数据被误删、只剩下标记
  const x = upsertOnLogin(s, u('ou_x', '别人'), { fromAdmin: true });
  assert.equal(x.status, 'pending');
});

test('设了管理员名单(LARK_ADMIN_IDS):只有名单里的人是管理员,第一个登录的别人也只是待分配;名单里的人被停用后登录能找回', () => {
  const s = { members: [] };
  const first = upsertOnLogin(s, u('ou_x', '抢先的人'), { fromAdmin: true, adminIds: ['ou_boss'] });
  assert.equal(first.status, 'pending');
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: false, adminIds: ['ou_boss'] });
  assert.ok(isAdmin(boss));
  boss.status = 'disabled';
  assert.ok(isAdmin(upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: false, adminIds: ['ou_boss'] })));
});

test('弹窗登录:必须用飞书那边显示的验证码换会话;错 5 次作废;换完一次就失效;别的店拿不到', () => {
  const id = newLoginState({ shop: 'a.myshopify.com', fromAdmin: true, mode: 'popup' });
  assert.equal(loginStatus(id, 'a.myshopify.com').done, false);
  assert.match(redeemLoginState(id, 'a.myshopify.com', '000000').error, /还没/);
  const code = finishLoginState(id, { session: 'SESSION' });
  assert.match(code, /^\d{6}$/);
  assert.equal(loginStatus(id, 'a.myshopify.com').done, true);
  assert.match(redeemLoginState(id, 'b.myshopify.com', code).error, /过期/);
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 4; i++) assert.match(redeemLoginState(id, 'a.myshopify.com', wrong).error, /不对/);
  assert.match(redeemLoginState(id, 'a.myshopify.com', wrong).error, /错太多次/);
  assert.match(redeemLoginState(id, 'a.myshopify.com', code).error, /过期/); // 已作废
  const id2 = newLoginState({ shop: 'a.myshopify.com', fromAdmin: true, mode: 'popup' });
  const c2 = finishLoginState(id2, { session: 'S2' });
  assert.equal(redeemLoginState(id2, 'a.myshopify.com', c2).session, 'S2');
  assert.match(redeemLoginState(id2, 'a.myshopify.com', c2).error, /过期/); // 只能用一次
});
