// 成员与部门(v3:飞书登录后认人)。纯函数,服务器和页面共用。
//   成员:{ id: 飞书 open_id, name, avatar, roles: [部门 key](+ 'admin'), status: 'pending' | 'active' | 'disabled', joinedAt, lastSeen }
//   部门(2026-11-10 起「角色」升级成「部门」,数据还叫 roles,key 不变):
//     { key, name, ceiling: { 页面: 0–3 }, capsOff: [敏感功能], leads: [成员 id], grants: { 成员 id: { levels: { 页面: 0–3 }, capsOff: [] } }, pages(= 上限 ≥ 1 的页面,老代码用) }
//   档位:0 不能看 / 1 只看 / 2 能编辑(保存 = 提交给负责人批准)/ 3 能上线(直接生效、暂停、删除、批准别人的)。
//   一个人在某页的档位 = 他所在各部门里 min(部门上限, 负责人给的) 取最高;负责人自己 = 本部门上限;管理员 = 全部 3。方案:docs/departments/PLAN.md
// 第一次登录的人 = 待分配(什么都看不到),管理员(或部门负责人)把他拉进部门后才能用。

// 2026-10-28 用户:不要审批(每个人保存直接生效),页面和左边导航一一对应;「操作记录」所有登录的人都能看,不算页面权限。
// 审批只在 Railway 设了 APPROVALS=on 时才开(以后想要再开),开着才有「审核」页
export const approvalsOn = () => process.env.APPROVALS === 'on';
export const PAGES = {
  overview: '总览', campaigns: '活动', banners: '首页 Banner', topbar: '顶栏', pmodules: '首页商品模块',
  callouts: '产品页推广', pins: 'Collection 排序', salelinks: '促销链接', price: '改价', history: '历史记录',
  settings: '设置', tools: '工具',
};
export const pageNames = () => (approvalsOn() ? { ...PAGES, reviews: '审核' } : PAGES);

export const DEFAULT_ROLES = [
  { key: 'admin', name: '管理员', pages: Object.keys(PAGES), builtin: true, v: 2 },
  { key: 'ops', name: '运营', pages: ['overview', 'campaigns', 'banners', 'topbar', 'pmodules', 'callouts', 'pins', 'salelinks', 'history'], v: 2 },
  { key: 'pricing', name: '定价', pages: ['overview', 'campaigns', 'price', 'pins', 'salelinks', 'history'], v: 2 },
  { key: 'design', name: '设计', pages: ['overview', 'campaigns', 'banners', 'history'], v: 2 },
  { key: 'copy', name: '文案 / 社媒', pages: ['overview', 'campaigns', 'banners', 'topbar', 'callouts', 'history'], v: 2 },
];

// 老的角色(v1):「商品模块」以前包含 Collection 排序 / 促销链接 / 产品页推广,「总览」包含历史记录 —— 拆开后照样给,谁都不会突然看不到
// 部门(v3,2026-11-10):老角色只有 pages → 上限 = 这些页面都是「能上线」(和以前「能看到就能改」一样),没有负责人,员工没单独设 = 和上限一样
export const LEVEL_CN = ['不能看', '只看', '能编辑', '能上线'];
// 敏感功能:默认跟着那一页的「能上线」,管理员(整个部门)/ 负责人(个人)可以单独关掉。新加的在这里登记,服务器接口里 needCap
export const CAPS = {
  'price.control': { page: 'price', name: '暂停 / 继续 / 提前结束改价' },
  'price.hold': { page: 'price', name: '处理被接管的产品' },
  'price.export': { page: 'price', name: '导出还原表 / 价格账本' },
  'pins.defsort': { page: 'pins', name: '改 Collection 默认设置(含照另一个 Collection 排)' },
  'pins.rollback': { page: 'pins', name: '回滚 Collection 顺序' },
};
const PAGE_KEYS = () => Object.keys(PAGES).filter((p) => p !== 'settings' && p !== 'tools'); // 设置、工具只给管理员
const lv = (n) => Math.max(0, Math.min(3, Math.round(Number(n) || 0)));
function migrateRole(r) {
  if (r.key === 'admin') return DEFAULT_ROLES[0];
  let x = r;
  if (x.v !== 2 && x.v !== 3) {
    const pages = new Set(x.pages || []);
    if (pages.has('pmodules')) ['callouts', 'pins', 'salelinks'].forEach((k) => pages.add(k));
    if (pages.has('overview')) pages.add('history');
    x = { ...x, pages: [...pages], v: 2 };
  }
  const ceiling = x.ceiling ? Object.fromEntries(PAGE_KEYS().map((p) => [p, lv(x.ceiling[p])])) : Object.fromEntries(PAGE_KEYS().map((p) => [p, (x.pages || []).includes(p) ? 3 : 0]));
  return { ...x, v: 3, ceiling, pages: PAGE_KEYS().filter((p) => ceiling[p] > 0), leads: [...(x.leads || [])], capsOff: [...(x.capsOff || [])], grants: x.grants || {}, notify: x.notify || { group: null, rules: {} } };
}
export const rolesOf = (state) => (state.roles?.length ? state.roles.map(migrateRole) : DEFAULT_ROLES.map(migrateRole));
export const isAdmin = (m) => !!m && m.status === 'active' && (m.roles || []).includes('admin');
// 部门(= 不含管理员的角色)
export const deptsOf = (state) => rolesOf(state).filter((r) => r.key !== 'admin');
export const isLeadOf = (r, m) => !!m && (r.leads || []).includes(m.id);
// 他是哪些部门的负责人
export const leadDepts = (state, m) => (m && m.status === 'active' ? deptsOf(state).filter((r) => isLeadOf(r, m) && (m.roles || []).includes(r.key)) : []);

// 在一个部门里,这个人这一页是几档(负责人 = 上限;员工 = min(上限, 负责人给的))
export function levelIn(r, m, page) {
  const cap = r.ceiling?.[page] || 0;
  if (isLeadOf(r, m)) return cap;
  const g = r.grants?.[m.id]?.levels?.[page];
  return g == null ? cap : Math.min(cap, lv(g));
}
// 这个人这一页最终几档(管理员 3;待分配 / 停用 0;设置 / 工具只给管理员)
export function levelOf(state, m, page) {
  if (!m || m.status !== 'active') return 0;
  if (isAdmin(m)) return 3;
  if (page === 'settings' || page === 'tools') return 0;
  let best = 0;
  for (const r of deptsOf(state)) if ((m.roles || []).includes(r.key)) best = Math.max(best, levelIn(r, m, page));
  return best;
}
export const levelsOf = (state, m) => Object.fromEntries(PAGE_KEYS().map((p) => [p, levelOf(state, m, p)]));
// 敏感功能:任一部门里那一页是「能上线」,并且部门、个人都没关掉(负责人的个人设置不算,他只受部门的限制)
export function capOf(state, m, key) {
  const c = CAPS[key]; if (!c || !m || m.status !== 'active') return false;
  if (isAdmin(m)) return true;
  return deptsOf(state).some((r) => (m.roles || []).includes(r.key) && levelIn(r, m, c.page) >= 3 && !(r.capsOff || []).includes(key)
    && (isLeadOf(r, m) || !(r.grants?.[m.id]?.capsOff || []).includes(key)));
}
export const capsOf = (state, m) => Object.keys(CAPS).filter((k) => capOf(state, m, k));
// 有没有人是「能编辑」档(保存要提交给负责人批准)—— 有的话「审核」页、待审核状态、审批通知才有意义
export const reviewsOn = (state) => (state.members || []).some((m) => m.status === 'active' && !isAdmin(m) && PAGE_KEYS().some((p) => levelOf(state, m, p) === 2));
// 谁来批这个人在这一页的提交:他所在部门里、这一页「能上线」的负责人(都没有 = 空,由调用方退回管理员)
export function leadApprovers(state, memberId, page) {
  const m = (state.members || []).find((x) => x.id === memberId);
  if (!m) return [];
  const out = new Set();
  for (const r of deptsOf(state)) {
    if (!(m.roles || []).includes(r.key)) continue;
    for (const id of r.leads || []) {
      const l = (state.members || []).find((x) => x.id === id);
      if (l && l.id !== m.id && levelIn(r, l, page) >= 3 && l.status === 'active') out.add(l.id);
    }
  }
  return [...out];
}

// 这个成员能看哪些页面(管理员 = 全部;待分配 / 停用 = 没有)
export function pagesOf(state, m) {
  if (!m || m.status !== 'active') return [];
  const rv = approvalsOn() || reviewsOn(state); // 有人要审批:都能看「审核」(只列他能批的;能编辑的看自己提交的)
  const names = { ...pageNames(), ...(rv ? { reviews: '审核' } : {}) };
  if (isAdmin(m)) return Object.keys(names);
  const set = new Set(PAGE_KEYS().filter((p) => levelOf(state, m, p) >= 1));
  if (rv) set.add('reviews');
  return Object.keys(names).filter((p) => set.has(p));
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
  const emails = emailsOf(user);
  // 飞书登录时有没有给邮箱(要在飞书开发者后台开「获取用户邮箱信息」权限):成员面板上告诉管理员按邮箱预设能不能对上
  // ok = 这次给了;okAt / okName = 最近一次给了邮箱的登录(个别同事飞书里没填邮箱,不代表权限没开)
  const prevOk = state.emailCheck?.okAt ? { okAt: state.emailCheck.okAt, okName: state.emailCheck.okName } : {};
  state.emailCheck = { ok: emails.length > 0, at: now, name: user.name || '', ...(emails.length ? { okAt: now, okName: user.name || '' } : prevOk) };
  if (!m) {
    m = { id: user.openId, name: user.name || '新成员', avatar: user.avatar || '', roles: [], status: 'pending', joinedAt: now };
    // 管理员预先按邮箱 / 名字设好了角色(2026-10-29 名字、2026-11-02 邮箱)→ 第一次登录对上就直接开通
    const hit = matchInvite(state, user);
    if (hit) {
      const inv = hit.invite;
      const keys = new Set(rolesOf(state).map((r) => r.key));
      m.roles = inv.roles.filter((k) => keys.has(k) && k !== 'admin');
      if (m.roles.length) m.status = 'active';
      m.fromInvite = { name: invLabel(inv), by: inv.by || '', at: now, via: hit.via };
      state.invites = state.invites.filter((x) => x.id !== inv.id);
    }
    state.members.push(m);
  }
  if (forceAdmin || (bootstrap && m.status !== 'disabled')) {
    m.roles = [...new Set([...(m.roles || []), 'admin'])]; m.status = 'active';
    if (bootstrap) { m.bootstrap = true; state.bootstrapDone = true; }
  }
  m.name = user.name || m.name; m.avatar = user.avatar || m.avatar; m.lastSeen = now;
  if (emails.length) m.emails = emails;
  return m;
}

export class MemberError extends Error {}
const fail = (msg) => { throw new MemberError(msg); };

// ---------- 预先设好角色(还没登录过的同事)----------
// 管理员没有同事的飞书 id:先存一条「预设」(飞书邮箱和 / 或名字),他第一次用飞书登录时对上就套用。
//   · 邮箱(2026-11-02 用户):飞书登录要给邮箱才对得上(开发者后台开「获取用户邮箱信息」权限);飞书的邮箱和企业邮箱都认,不分大小写。
//     预设填了邮箱、飞书也给了邮箱 → 只按邮箱对(同名的别人对不上);飞书没给邮箱 → 退回按名字对(预设里也填了名字才行)。
//   · 名字:中文名或英文名,不分大小写、空格。
// ⛔ 邮箱 / 名字都是飞书管理员录入的,不是本人验证过的:预设不能给「管理员」;自动开通的成员标 fromInvite,成员表和操作记录里都看得到。
export const normName = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export const normEmail = (s) => String(s || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailsOf = (user) => [...new Set((user.emails || []).map(normEmail).filter((e) => EMAIL_RE.test(e)))];
export const invLabel = (inv) => inv.name || inv.email || '';
export function matchInvite(state, user) {
  const invs = state.invites || [];
  const emails = emailsOf(user);
  if (emails.length) {
    const hits = invs.filter((x) => x.email && emails.includes(normEmail(x.email)));
    if (hits.length) return hits.length === 1 ? { invite: hits[0], via: 'email' } : null;
  }
  // 按名字:预设填了邮箱、飞书也给了邮箱却没对上 = 不是这个人,不再按名字认
  const names = [user.name, user.enName].map(normName).filter(Boolean);
  const hits = invs.filter((x) => x.name && names.includes(normName(x.name)) && !(x.email && emails.length));
  return hits.length === 1 ? { invite: hits[0], via: 'name' } : null; // 对上两条以上就不猜,等管理员分配
}
const cleanEmail = (email) => {
  const e = normEmail(email);
  if (e && (!EMAIL_RE.test(e) || e.length > 80)) fail(`「${String(email).trim()}」不像邮箱,检查一下`);
  return e;
};
const inviteRoles = (state, roles, msg) => {
  const keys = new Set(rolesOf(state).map((r) => r.key).filter((k) => k !== 'admin'));
  const rs = [...new Set(roles || [])].filter((k) => keys.has(k));
  if (!rs.length) fail(msg);
  return rs;
};
const emailTaken = (state, e, exceptId) => (state.invites || []).find((x) => x.id !== exceptId && x.email && normEmail(x.email) === e);
export function addInvite(state, actor, { name, email, roles } = {}, now = Date.now()) {
  if (!isAdmin(actor)) fail('只有管理员能预先添加同事');
  const n = String(name || '').trim().slice(0, 30);
  const e = cleanEmail(email);
  if (!n && !e) fail('先填同事的飞书邮箱或名字(和他飞书里的一样)');
  const rs = inviteRoles(state, roles, '至少勾一个角色(管理员不能预设,要等他登录后在成员表里给)');
  // 已经登录过的:待分配的直接开通,别的提示去成员表改。按邮箱找;没填邮箱(或这人登录时飞书没给邮箱)才按名字找
  const members = state.members || [];
  const m = (e && members.find((x) => (x.emails || []).includes(e)))
    || (n && members.find((x) => normName(x.name) === normName(n) && !(e && (x.emails || []).length)));
  if (m) {
    if (m.status !== 'pending') fail(`「${m.name}」已经登录过了,直接在下面的成员表里改他的角色`);
    m.roles = rs; m.status = 'active';
    return { member: m };
  }
  state.invites ||= [];
  if (e && emailTaken(state, e)) fail(`已经预设过「${e}」了,要改角色就在预设里改`);
  // 同名:两条里有一条没填邮箱就分不清是谁,拦住;都填了邮箱可以同名
  if (n && state.invites.some((x) => x.name && normName(x.name) === normName(n) && !(e && x.email))) fail(`已经预设过「${n}」了,要改角色就在预设里改;同名的两个人请都填上邮箱`);
  const inv = { id: `inv_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n, email: e, roles: rs, at: now, by: actor.name || '' };
  state.invites.push(inv);
  return { invite: inv };
}
// 改预设:角色,或者补 / 改邮箱(先只填了名字的,后来拿到邮箱)
export function updateInvite(state, actor, id, { roles, email } = {}) {
  if (!isAdmin(actor)) fail('只有管理员能改');
  const inv = (state.invites || []).find((x) => x.id === id) || fail('找不到这条预设');
  if (roles !== undefined) inv.roles = inviteRoles(state, roles, '至少勾一个角色;不要了就删掉这条预设');
  if (email !== undefined) {
    const e = cleanEmail(email);
    if (!e && !inv.name) fail('这条预设只有邮箱,不能清空;不要了就删掉');
    if (e && emailTaken(state, e, id)) fail(`已经预设过「${e}」了`);
    const m = e && (state.members || []).find((x) => (x.emails || []).includes(e));
    if (m) fail(`「${m.name}」已经用这个邮箱登录过了,直接在下面的成员表里改他的角色,再删掉这条预设`);
    inv.email = e;
  }
  return inv;
}
export function removeInvite(state, actor, id) {
  if (!isAdmin(actor)) fail('只有管理员能删');
  const inv = (state.invites || []).find((x) => x.id === id) || fail('找不到这条预设');
  state.invites = state.invites.filter((x) => x.id !== id); return inv;
}

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

// 管理员改部门:名字、每页上限(老界面只勾页面 = 勾上的给「能上线」,原来设过档位的照旧)、敏感功能、负责人;加 / 删部门(管理员不能改)
export function saveRoles(state, actor, roles) {
  if (!isAdmin(actor)) fail('只有管理员能改部门');
  const out = [];
  const seen = new Set();
  const old = Object.fromEntries(rolesOf(state).map((r) => [r.key, r]));
  const memberIds = new Set((state.members || []).map((m) => m.id));
  for (const r of roles || []) {
    const key = String(r.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key === 'admin') { out.push(DEFAULT_ROLES[0]); continue; }
    const name = String(r.name || '').trim().slice(0, 20) || key;
    const prev = old[key];
    const ceiling = r.ceiling ? Object.fromEntries(PAGE_KEYS().map((p) => [p, lv(r.ceiling[p])]))
      : Object.fromEntries(PAGE_KEYS().map((p) => [p, (r.pages || []).includes(p) ? (prev?.ceiling?.[p] || 3) : 0]));
    out.push(migrateRole({ key, name, v: 3, ceiling,
      capsOff: (r.capsOff ?? prev?.capsOff ?? []).filter((k) => CAPS[k]),
      leads: (r.leads ?? prev?.leads ?? []).filter((id) => memberIds.has(id)),
      grants: prev?.grants || {}, notify: prev?.notify || { group: null, rules: {} } }));
  }
  if (!out.some((r) => r.key === 'admin')) out.unshift(DEFAULT_ROLES[0]);
  // 负责人一定在这个部门里(待分配的顺便启用)
  for (const r of out) for (const id of r.leads || []) {
    const m = (state.members || []).find((x) => x.id === id); if (!m) continue;
    if (!(m.roles || []).includes(r.key)) m.roles = [...(m.roles || []), r.key];
    if (m.status === 'pending') m.status = 'active';
  }
  // 被删掉的角色从成员身上去掉
  const keys = new Set(out.map((r) => r.key));
  for (const m of state.members || []) m.roles = (m.roles || []).filter((k) => keys.has(k));
  for (const inv of state.invites || []) inv.roles = (inv.roles || []).filter((k) => keys.has(k) && k !== 'admin');
  state.roles = out;
  return out;
}

// 给审核流用的身份。2026-10-28 起默认不审批:每个人都按「审核人」算(保存直接生效);
// 能不能动某一类内容改由页面权限管(schedule-api 的 needPage)。开了审批(APPROVALS=on)才回到 管理员 = 审核人、其他 = 编辑
// ---------- 部门负责人(2026-11-10)----------
// 负责人能:给本部门员工定每页档位、关敏感功能(不超过部门上限,不能动别的负责人);把待分配的新同事拉进本部门;把员工移出本部门。
// 管理员什么都能做。都是纯函数:改 state,返回改了什么(给操作记录写人话)。
const deptOr = (state, key) => deptsOf(state).find((r) => r.key === key) || fail('找不到这个部门');
const rawDept = (state, key) => { // 改的是存着的那份(rolesOf 返回的是整理过的副本)
  if (!state.roles?.length) state.roles = DEFAULT_ROLES.map(migrateRole);
  const i = state.roles.findIndex((r) => r.key === key);
  if (i < 0) fail('找不到这个部门');
  state.roles[i] = migrateRole(state.roles[i]);
  return state.roles[i];
};
export const canManageDept = (state, actor, key) => isAdmin(actor) || !!deptsOf(state).find((r) => r.key === key && isLeadOf(r, actor) && (actor.roles || []).includes(key));
// 员工在这个部门的档位 / 敏感功能(levels 里没写的页面 = 和上限一样)
export function setGrant(state, actor, key, memberId, { levels, capsOff } = {}) {
  if (!canManageDept(state, actor, key)) fail('只有这个部门的负责人(或管理员)能改');
  const r0 = deptOr(state, key);
  const m = (state.members || []).find((x) => x.id === memberId) || fail('找不到这个成员');
  if (!(m.roles || []).includes(key)) fail(`「${m.name}」不在这个部门`);
  if (isLeadOf(r0, m)) fail('负责人的权限 = 部门上限,由管理员改');
  if (isAdmin(m)) fail('管理员什么都能做,不用设');
  const r = rawDept(state, key);
  const prev = r.grants[memberId] || {};
  const next = {
    levels: Object.fromEntries(PAGE_KEYS().filter((p) => (r.ceiling[p] || 0) > 0).map((p) => [p, Math.min(r.ceiling[p], lv(levels && p in levels ? levels[p] : prev.levels?.[p] ?? r.ceiling[p]))])),
    capsOff: [...new Set(capsOff ?? prev.capsOff ?? [])].filter((k) => CAPS[k]),
  };
  r.grants = { ...r.grants, [memberId]: next };
  return { member: m, dept: r, grant: next };
}
// 把人拉进本部门:待分配的新同事(拉进来就启用),或别的部门的同事(多加一个部门)
export function joinDept(state, actor, key, memberId) {
  if (!canManageDept(state, actor, key)) fail('只有这个部门的负责人(或管理员)能加人');
  const r = deptOr(state, key);
  const m = (state.members || []).find((x) => x.id === memberId) || fail('找不到这个成员');
  if (m.status === 'disabled') fail(`「${m.name}」已被管理员停用`);
  if ((m.roles || []).includes(key)) fail(`「${m.name}」已经在${r.name}了`);
  m.roles = [...(m.roles || []), key];
  const wasPending = m.status === 'pending';
  if (wasPending) m.status = 'active';
  return { member: m, dept: r, wasPending };
}
// 移出本部门:没别的部门了就回到待分配。负责人只能由管理员移出;不能移出自己
export function leaveDept(state, actor, key, memberId) {
  if (!canManageDept(state, actor, key)) fail('只有这个部门的负责人(或管理员)能移出');
  const r = deptOr(state, key);
  const m = (state.members || []).find((x) => x.id === memberId) || fail('找不到这个成员');
  if (!(m.roles || []).includes(key)) fail(`「${m.name}」不在${r.name}`);
  if (m.id === actor.id) fail('不能把自己移出部门,请找管理员');
  if (isLeadOf(r, m) && !isAdmin(actor)) fail('负责人只能由管理员移出');
  m.roles = m.roles.filter((k) => k !== key);
  const raw = rawDept(state, key);
  if (raw.grants[memberId]) { const { [memberId]: _, ...rest } = raw.grants; raw.grants = rest; } // eslint-disable-line no-unused-vars
  raw.leads = (raw.leads || []).filter((id) => id !== memberId);
  if (!m.roles.length) m.status = 'pending';
  return { member: m, dept: r, pending: m.status === 'pending' };
}
// ---------- 部门通知(2026-11-10,用户定:负责人管本部门谁收、发哪个部门群、什么时候;样式内容仍由管理员在消息中心统一)----------
// r.notify = { group: { name, webhook, secret } | null, rules: { 通知 key: { on, to: related|all|leads, notActor, group, when } } }
//   某种通知「本部门自己定」= rules 里有它:本部门的人(管理员除外)按这条收,不再按消息中心的规则;管理员 / 指定的人 / 公司群照旧。
// webhook 地址格式在这里只粗查,发送那边(src/lark.js isLarkWebhook)会再拦。
const DEPT_TO = ['related', 'all', 'leads'];
const hhmm = (x, d) => (/^\d{1,2}:\d{2}$/.test(String(x || '')) && Number(String(x).split(':')[0]) < 25 && Number(String(x).split(':')[1]) < 60 ? String(x).padStart(5, '0') : d);
export function setDeptNotify(state, actor, key, { group, rules } = {}, { info = () => true } = {}) {
  if (!canManageDept(state, actor, key)) fail('只有这个部门的负责人(或管理员)能改部门通知');
  const r = rawDept(state, key);
  const cur = r.notify || { group: null, rules: {} };
  let g = cur.group;
  if (group !== undefined) {
    if (!group || !String(group.webhook || '').trim()) g = null;
    else {
      const w = String(group.webhook).trim();
      if (!/^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(w)) fail('部门群的 webhook 地址格式不对(群设置 → 群机器人 → 自定义机器人 → 复制 webhook)');
      g = { name: String(group.name || '').trim().slice(0, 30) || `${r.name}群`, webhook: w, secret: String(group.secret ?? cur.group?.secret ?? '').trim() };
    }
  }
  let rs = cur.rules || {};
  if (rules !== undefined) {
    rs = {};
    for (const [ev, x] of Object.entries(rules || {})) {
      if (!x) continue; // null = 跟消息中心
      const mode = ['now', 'merge', 'digest', 'work'].includes(x.when?.mode) ? x.when.mode : 'now';
      rs[ev] = { on: !!x.on, to: DEPT_TO.includes(x.to) ? x.to : 'related', notActor: !!x.notActor, group: !!x.group,
        when: { mode: mode === 'digest' && !info(ev) ? 'now' : mode, merge: Math.min(240, Math.max(1, Math.round(Number(x.when?.merge) || 10))), at: hhmm(x.when?.at, '10:00'), from: hhmm(x.when?.from, '09:00'), to: hhmm(x.when?.to, '18:00') } };
    }
  }
  r.notify = { group: g, rules: rs };
  return r;
}
// 负责人看到的:他管的部门,每个员工每页最终档位
export function deptView(state, actor) {
  const keys = isAdmin(actor) ? deptsOf(state).map((r) => r.key) : leadDepts(state, actor).map((r) => r.key);
  return deptsOf(state).filter((r) => keys.includes(r.key)).map((r) => ({
    key: r.key, name: r.name, ceiling: r.ceiling, capsOff: r.capsOff, leads: r.leads,
    notify: { group: r.notify?.group ? { name: r.notify.group.name, tail: `…${String(r.notify.group.webhook).slice(-6)}`, signed: !!r.notify.group.secret } : null, rules: r.notify?.rules || {} },
    members: (state.members || []).filter((m) => (m.roles || []).includes(r.key) && m.status !== 'disabled').map((m) => ({
      id: m.id, name: m.name, avatar: m.avatar || '', status: m.status, lead: isLeadOf(r, m), admin: isAdmin(m),
      levels: Object.fromEntries(PAGE_KEYS().map((p) => [p, levelIn(r, m, p)])), capsOff: r.grants?.[m.id]?.capsOff || [] })),
  }));
}

// 2026-11-10 部门负责人:给了 state + page 就按这一页的档位 —— 能上线 = 审核人(直接生效),能编辑 / 只看 = 编辑(保存 = 提交)。不给页面 = 老的整体身份
export const actorOf = (m, state = null, page = null) => {
  const base = { id: m.id, name: m.name, ...(approvalsOn() ? {} : { direct: true }) };
  if (isAdmin(m)) return { ...base, role: 'approver' };
  if (approvalsOn()) return { ...base, role: 'editor' }; // 老开关:全员审批
  if (!state || !page) return { ...base, role: 'approver' };
  const level = levelOf(state, m, page);
  return { ...base, role: level >= 3 ? 'approver' : 'editor', level };
};

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
