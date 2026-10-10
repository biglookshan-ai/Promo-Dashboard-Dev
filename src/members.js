// 成员与角色(v3:飞书登录后认人)。纯函数,服务器和页面共用。
//   成员:{ id: 飞书 open_id, name, avatar, roles: [角色 key], status: 'pending' | 'active' | 'disabled', joinedAt, lastSeen }
//   角色:{ key, name, pages: [页面 key], builtin? }。管理员(admin)永远能看全部页面、管成员。
// 第一次登录的人 = 待分配(什么都看不到),管理员分配角色后才能用。

export const PAGES = {
  overview: '总览', campaigns: '活动', banners: 'Banner', topbar: '顶栏', pmodules: '商品模块',
  reviews: '审核', price: '改价', settings: '设置', tools: '工具',
};

export const DEFAULT_ROLES = [
  { key: 'admin', name: '管理员', pages: Object.keys(PAGES), builtin: true },
  { key: 'ops', name: '运营', pages: ['overview', 'campaigns', 'banners', 'topbar', 'pmodules', 'reviews'] },
  { key: 'pricing', name: '定价', pages: ['overview', 'campaigns', 'price', 'reviews'] },
  { key: 'design', name: '设计', pages: ['overview', 'campaigns', 'reviews'] },
  { key: 'copy', name: '文案 / 社媒', pages: ['overview', 'campaigns', 'reviews'] },
];

export const rolesOf = (state) => (state.roles?.length ? state.roles : DEFAULT_ROLES);
export const isAdmin = (m) => !!m && m.status === 'active' && (m.roles || []).includes('admin');

// 这个成员能看哪些页面(管理员 = 全部;待分配 / 停用 = 没有)
export function pagesOf(state, m) {
  if (!m || m.status !== 'active') return [];
  if (isAdmin(m)) return Object.keys(PAGES);
  const set = new Set();
  for (const r of rolesOf(state)) if ((m.roles || []).includes(r.key)) r.pages.forEach((p) => set.add(p));
  set.delete('settings'); set.delete('tools'); // 设置、工具只给管理员,角色里勾了也不算
  return Object.keys(PAGES).filter((p) => set.has(p));
}
export const canSee = (state, m, page) => pagesOf(state, m).includes(page);

// 登录时登记成员。谁能自动成为管理员:
//   - Railway 里设了 LARK_ADMIN_IDS(管理员的飞书 ID,逗号分隔)→ 只有这些人,而且他们每次登录都保证是启用的管理员(被锁在外面时也能这样找回);
//     其他人一律「待分配」,不存在「第一个登录」的空子
//   - 没设 → 一次性的「第一个从 Shopify 后台里登录的人」成为管理员;一旦有过管理员(bootstrapDone),这扇门永久关上,
//     之后就算管理员都没了也不会自动再给任何人
export function upsertOnLogin(state, user, { fromAdmin, adminIds = [], now = Date.now() }) {
  state.members ||= [];
  let m = state.members.find((x) => x.id === user.openId);
  if (state.members.some(isAdmin)) state.bootstrapDone = true;
  const pinned = adminIds.length > 0;
  const forceAdmin = pinned && adminIds.includes(user.openId);
  const bootstrap = !pinned && fromAdmin && !state.bootstrapDone;
  if (!m) {
    m = { id: user.openId, name: user.name || '新成员', avatar: user.avatar || '', roles: [], status: 'pending', joinedAt: now };
    state.members.push(m);
  }
  if (forceAdmin || (bootstrap && m.status !== 'disabled')) {
    m.roles = [...new Set([...(m.roles || []), 'admin'])]; m.status = 'active';
    if (bootstrap) { m.bootstrap = true; state.bootstrapDone = true; }
  }
  m.name = user.name || m.name; m.avatar = user.avatar || m.avatar; m.lastSeen = now;
  return m;
}

export class MemberError extends Error {}
const fail = (msg) => { throw new MemberError(msg); };

// 管理员改成员:角色 / 状态 / 名字
export function updateMember(state, actor, id, patch) {
  if (!isAdmin(actor)) fail('只有管理员能管理成员');
  const m = (state.members || []).find((x) => x.id === id) || fail('找不到这个成员');
  const keys = new Set(rolesOf(state).map((r) => r.key));
  const next = { ...m };
  if (patch.roles) {
    const roles = [...new Set(patch.roles)].filter((k) => keys.has(k));
    next.roles = roles;
    if (patch.status === undefined && m.status === 'pending' && roles.length) next.status = 'active'; // 分配了角色就启用
  }
  if (patch.status) {
    if (!['active', 'pending', 'disabled'].includes(patch.status)) fail('状态不对');
    next.status = patch.status;
  }
  if (patch.name != null) { const n = String(patch.name).trim(); if (!n) fail('名字不能为空'); next.name = n.slice(0, 30); }
  // 不能把最后一个管理员撤掉
  const adminsAfter = state.members.filter((x) => (x.id === id ? isAdmin(next) : isAdmin(x)));
  if (!adminsAfter.length) fail('至少要留一个管理员');
  Object.assign(m, next);
  return m;
}

// 管理员改角色能看的页面、加自定义角色(管理员角色不能改)
export function saveRoles(state, actor, roles) {
  if (!isAdmin(actor)) fail('只有管理员能改角色');
  const out = [];
  const seen = new Set();
  for (const r of roles || []) {
    const key = String(r.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key === 'admin') { out.push(DEFAULT_ROLES[0]); continue; }
    const name = String(r.name || '').trim().slice(0, 20) || key;
    out.push({ key, name, pages: (r.pages || []).filter((p) => PAGES[p] && p !== 'settings' && p !== 'tools') });
  }
  if (!out.some((r) => r.key === 'admin')) out.unshift(DEFAULT_ROLES[0]);
  // 被删掉的角色从成员身上去掉
  const keys = new Set(out.map((r) => r.key));
  for (const m of state.members || []) m.roles = (m.roles || []).filter((k) => keys.has(k));
  state.roles = out;
  return out;
}

// 给现有审核流用的身份:管理员 = 审核人,其他 = 编辑(3.2 改成「每项指定审批人」)
export const actorOf = (m) => ({ id: m.id, name: m.name, role: isAdmin(m) ? 'approver' : 'editor' });

// ---------- 测试模式(临时关掉飞书登录)----------
// 打开后:**从 Shopify 后台里**打开 app 的人不用登录飞书,直接是管理员。
// 安全闸(别去掉):
//   ① 只在带着 Shopify 后台凭证时生效 —— 直接开 app 网址的人照样要登录
//   ② 只有「指定管理员名单(LARK_ADMIN_IDS)」里的人、而且是真的用飞书登录之后,才能打开
//   ③ 到点自动失效;测试模式里的人只能关掉,不能延长
export const TEST_MODE_MAX_HOURS = 8;
export const testModeOn = (state, now = Date.now()) => !!(state.testMode?.until > now);
export const testModeLeft = (state, now = Date.now()) => Math.max(0, (state.testMode?.until || 0) - now);
// 测试模式下的临时身份(不写进成员名单)
export const TEST_MEMBER = { id: 'test-mode', name: '测试模式(未登录)', avatar: '', roles: ['admin'], status: 'active', testMode: true };

// 谁能「打开」测试模式:设了 LARK_ADMIN_IDS 就只有名单里的人,否则任意管理员;都必须是真的飞书登录
export function canStartTestMode(member, adminIds = []) {
  if (!member || member.testMode || member.status !== 'active') return false;
  return adminIds.length ? adminIds.includes(member.id) : isAdmin(member);
}
export function setTestMode(state, actor, { on, hours = 2, adminIds = [], now = Date.now() }) {
  if (on) {
    if (actor?.testMode) fail('测试模式下不能再打开或延长测试模式,请先用飞书登录');
    if (!canStartTestMode(actor, adminIds)) fail(adminIds.length ? '只有管理员名单(LARK_ADMIN_IDS)里的人、用飞书登录后才能打开测试模式' : '只有管理员能打开测试模式');
    const h = Math.min(Math.max(Number(hours) || 2, 0.5), TEST_MODE_MAX_HOURS);
    state.testMode = { until: now + h * 3600_000, by: actor.id, byName: actor.name, at: now, hours: h };
  } else {
    if (!isAdmin(actor)) fail('只有管理员能关闭测试模式'); // 测试模式里的人也能关(关是安全方向)
    state.testMode = null;
  }
  return state.testMode;
}
