import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertOnLogin, updateMember, saveRoles, pagesOf, isAdmin, canSee, actorOf, addInvite, updateInvite, removeInvite, matchInvite } from '../src/members.js';
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
  assert.deepEqual(pagesOf(s, m), ['overview', 'campaigns', 'banners', 'topbar', 'pmodules', 'callouts', 'pins', 'salelinks', 'price', 'history']);
  assert.ok(!canSee(s, m, 'settings'));
  assert.ok(canSee(s, boss, 'settings'));
  // 2026-10-28 起默认不审批:每个人都按审核人算(保存直接生效),开了 APPROVALS=on 才分编辑 / 审核人
  assert.equal(actorOf(boss).role, 'approver');
  assert.equal(actorOf(m).role, 'approver');
  assert.equal(actorOf(m).direct, true); // 没开审批:保存 = 直接发布(日志 / 提示不说「批准」)
  process.env.APPROVALS = 'on';
  try { assert.equal(actorOf(m).role, 'editor'); assert.equal(actorOf(m).direct, undefined); assert.ok(canSee(s, m, 'reviews')); } finally { delete process.env.APPROVALS; }
  assert.ok(!canSee(s, m, 'reviews'));
});

test('老角色(拆页面之前存的):「商品模块」照样能看 Collection 排序 / 促销链接 / 产品页推广,「总览」照样能看历史记录;改过一次就按新的', () => {
  const s = { members: [], roles: [{ key: 'admin', name: '管理员', pages: [] }, { key: 'ops', name: '运营', pages: ['overview', 'pmodules', 'reviews'] }, { key: 'x', name: '只看改价', pages: ['price'] }] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  upsertOnLogin(s, u('ou_ops', '运营'), { fromAdmin: false });
  const m = updateMember(s, boss, 'ou_ops', { roles: ['ops'] });
  assert.deepEqual(pagesOf(s, m), ['overview', 'pmodules', 'callouts', 'pins', 'salelinks', 'history']);
  saveRoles(s, boss, [{ key: 'admin' }, { key: 'ops', name: '运营', pages: ['overview', 'pmodules'] }]); // 管理员把 Collection 排序等去掉了
  assert.deepEqual(pagesOf(s, m), ['overview', 'pmodules']);                                          // 不会又被迁移加回来
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

test('测试模式:只有名单里的人能开;真飞书登录才能开;到点失效;测试身份能关不能开', async () => {
  const { setTestMode, testModeOn, canStartTestMode, TEST_MEMBER, TEST_MODE_MAX_HOURS } = await import('../src/members.js');
  const s = { members: [] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  const ops = upsertOnLogin(s, u('ou_ops', '运营'), { fromAdmin: false });
  updateMember(s, boss, 'ou_ops', { roles: ['admin'] }); // 也是管理员,但不在名单里
  const ids = ['ou_boss'];
  assert.ok(canStartTestMode(boss, ids));
  assert.ok(!canStartTestMode(ops, ids), '不在 LARK_ADMIN_IDS 名单里的管理员不能开');
  assert.ok(!canStartTestMode(TEST_MEMBER, ids), '测试模式里的临时身份不能再开/续');
  assert.throws(() => setTestMode(s, ops, { on: true, adminIds: ids }), /名单/);
  setTestMode(s, boss, { on: true, hours: 2, adminIds: ids, now: 1000 });
  assert.ok(testModeOn(s, 1000));
  assert.ok(testModeOn(s, 1000 + 1.9 * 3600_000));
  assert.ok(!testModeOn(s, 1000 + 2.1 * 3600_000), '到点自动失效');
  // 最长 8 小时
  setTestMode(s, boss, { on: true, hours: 99, adminIds: ids, now: 0 });
  assert.equal(s.testMode.hours, TEST_MODE_MAX_HOURS);
  // 测试身份能关掉(关是安全方向)
  setTestMode(s, TEST_MEMBER, { on: false });
  assert.ok(!testModeOn(s));
  // 没设名单时:任意管理员能开
  assert.ok(canStartTestMode(ops, []));
});

test('测试模式:临时身份想延长时的提示要说清原因', async () => {
  const { setTestMode, TEST_MEMBER } = await import('../src/members.js');
  const s = { members: [] };
  assert.throws(() => setTestMode(s, TEST_MEMBER, { on: true, adminIds: [] }), /测试模式下不能再打开或延长/);
});


test('预先按名字设好角色(2026-10-29):同事第一次登录名字对上就自动开通;中文名 / 英文名、大小写空格都认', () => {
  const s = { members: [] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  const r = addInvite(s, boss, { name: 'Tom  Lee', roles: ['design'] }, 100);
  assert.equal(s.invites.length, 1); assert.equal(r.invite.by, '老板');
  addInvite(s, boss, { name: '张三', roles: ['ops', 'pricing'] }, 101);
  // 英文名对上(大小写、空格不一样也算)
  const tom = upsertOnLogin(s, { ...u('ou_tom', '李汤姆'), enName: 'tom lee' }, { fromAdmin: false, now: 200 });
  assert.equal(tom.status, 'active'); assert.deepEqual(tom.roles, ['design']);
  assert.deepEqual(tom.fromInvite, { name: 'Tom  Lee', by: '老板', at: 200 });
  assert.deepEqual(s.invites.map((x) => x.name), ['张三']); // 用掉的预设删掉
  // 名字对不上:照旧待分配
  const other = upsertOnLogin(s, u('ou_x', '王五'), { fromAdmin: false });
  assert.equal(other.status, 'pending'); assert.equal(other.fromInvite, undefined);
  // 已有成员再登录不会再套预设
  addInvite(s, boss, { name: '赵六', roles: ['design'] });
  const again = upsertOnLogin(s, u('ou_x', '赵六'), { fromAdmin: false });
  assert.equal(again.status, 'pending');
});

test('预设的限制:不能给管理员、不能重复、已登录过的待分配直接开通、已启用的去成员表改;删掉角色从预设里去掉', () => {
  const s = { members: [] };
  const boss = upsertOnLogin(s, u('ou_boss', '老板'), { fromAdmin: true });
  const staff = upsertOnLogin(s, u('ou_s', '员工'), { fromAdmin: false });
  assert.throws(() => addInvite(s, staff, { name: 'A', roles: ['design'] }), /只有管理员/);
  assert.throws(() => addInvite(s, boss, { name: 'A', roles: ['admin'] }), /至少勾一个角色/); // 管理员不能预设
  assert.throws(() => addInvite(s, boss, { name: '  ', roles: ['design'] }), /名字/);
  addInvite(s, boss, { name: 'A', roles: ['design', 'admin'] });
  assert.deepEqual(s.invites[0].roles, ['design']);
  assert.throws(() => addInvite(s, boss, { name: ' a ', roles: ['ops'] }), /已经预设过/);
  // 已经登录过、还在待分配:直接开通
  const r = addInvite(s, boss, { name: '员工', roles: ['ops'] });
  assert.equal(r.member.id, 'ou_s'); assert.equal(staff.status, 'active'); assert.deepEqual(staff.roles, ['ops']);
  assert.throws(() => addInvite(s, boss, { name: '老板', roles: ['ops'] }), /已经登录过了/);
  // 改 / 删
  const id = s.invites[0].id;
  updateInvite(s, boss, id, { roles: ['pricing'] }); assert.deepEqual(s.invites[0].roles, ['pricing']);
  assert.throws(() => updateInvite(s, boss, id, { roles: [] }), /至少勾一个角色/);
  saveRoles(s, boss, [{ key: 'admin' }, { key: 'design', name: '设计', pages: ['overview'] }]); // 删掉了 pricing
  assert.deepEqual(s.invites[0].roles, []);
  // 预设的角色全被删掉了:对上名字也只是待分配
  const a = upsertOnLogin(s, u('ou_a', 'A'), { fromAdmin: false });
  assert.equal(a.status, 'pending');
  assert.equal(a.fromInvite.name, 'A');
  // 删除预设
  const b = addInvite(s, boss, { name: 'B', roles: ['design'] }).invite;
  removeInvite(s, boss, b.id); assert.ok(!s.invites.some((x) => x.id === b.id));
  assert.throws(() => removeInvite(s, boss, b.id), /找不到/);
});

test('两条预设都对上(不该发生)就不猜', () => {
  const s = { invites: [{ id: '1', name: 'Tom', roles: ['design'] }, { id: '2', name: '汤姆', roles: ['ops'] }] };
  assert.equal(matchInvite(s, { name: '汤姆', enName: 'Tom' }), null);
  assert.equal(matchInvite(s, { name: '汤姆', enName: '' }).id, '2');
});
