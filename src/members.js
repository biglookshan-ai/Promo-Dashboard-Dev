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

// 登录时登记成员。第一个从 Shopify 后台里登录的人(证明有店铺后台权限)在还没有管理员时成为管理员。
export function upsertOnLogin(state, user, { fromAdmin, now = Date.now() }) {
  state.members ||= [];
  let m = state.members.find((x) => x.id === user.openId);
  const hasAdmin = state.members.some(isAdmin);
  if (!m) {
    m = { id: user.openId, name: user.name || '新成员', avatar: user.avatar || '', roles: [], status: 'pending', joinedAt: now };
    if (!hasAdmin && fromAdmin) { m.roles = ['admin']; m.status = 'active'; m.bootstrap = true; }
    state.members.push(m);
  } else if (!hasAdmin && fromAdmin && m.status !== 'disabled') {
    m.roles = [...new Set([...(m.roles || []), 'admin'])]; m.status = 'active';
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
