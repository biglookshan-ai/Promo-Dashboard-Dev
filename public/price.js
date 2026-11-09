// 网站更新中心 ·「改价」页面(v3 起并入,原 price-scheduler-app 的界面)。只有定价角色和管理员看得到(服务器也只放行这两类人)。
// 价格计算、检查、审核动作全部用 /lib/price-core.js 和 /lib/price-actions.js(和服务器同一份),这里不再写一套规则。
// 用网站更新中心的请求(window.api,带飞书登录会话)和提示(window.toast);只在点开「改价」时才加载。
const core = await import('./lib/price-core.js');
const A = await import('./lib/price-actions.js');

// ================= 工具 =================
const TZ = 'Europe/London';
const DAY = 86400000;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null || v === '' ? '—' : `£${Number(v).toFixed(2)}`);
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = (x) => JSON.parse(JSON.stringify(x));
const now = () => Date.now();

function londonOffsetMin(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000);
}
const toInput = (ms) => (ms == null ? '' : new Date(ms + londonOffsetMin(ms) * 60000).toISOString().slice(0, 16));
function fromInput(v) {
  if (!v) return null;
  const [d, t = '00:00'] = v.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, dd, hh, mi);
  return guess - londonOffsetMin(guess) * 60000;
}
// 英国时间「今天 + n 天」的某个钟点(按日历算,跨夏令时不差一小时)
function dayAt(n, hhmm = '00:00', from = now()) {
  const [y, m, d] = toInput(from).slice(0, 10).split('-').map(Number);
  return fromInput(new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) + 'T' + hhmm);
}
const fmtT = (ms, o = {}) => (ms == null ? '' : new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...o }).format(new Date(ms)));
const fmtD = (ms) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(ms));
function ago(ms) {
  const s = Math.round((now() - ms) / 1000);
  return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.round(s / 60)} 分钟前` : s < 86400 ? `${Math.round(s / 3600)} 小时前` : fmtT(ms);
}

const api = (method, path, body) => window.api(method, path, body);
const toast = (msg, ok = true) => window.toast(msg, ok);
async function download(path, name) {
  const r = await fetch(path, { headers: await window.cgpHeaders() });
  if (!r.ok) throw new Error('下载失败');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.append(a); a.click(); a.remove();
}
// 「再点一次确认」(后台在 iframe 里,不用 confirm())
function armed(btn, label = '再点一次确认') {
  if (btn.dataset.armed) { delete btn.dataset.armed; return true; }
  btn.dataset.armed = '1'; const old = btn.innerHTML; btn.innerHTML = label; btn.classList.add('is-arm');
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove('is-arm'); } }, 3500);
  return false;
}

// ================= 状态 =================
let S = null;          // 服务器状态
let tab = 'plans';
let filter = 'active';
let E = null;          // 正在编辑的计划
let ledgerQ = { q: '', plan: '', offset: 0 };
const cache = {};
const isAdmin = () => !!S?.me?.admin;
const meActor = () => ({ id: S.me.id, name: S.me.name, role: S.me.admin ? 'approver' : 'editor', ...(S.approvals ? {} : { direct: true }) });
const canApprove = (plan) => A.canApprove(meActor(), plan);
const nameOf = (id) => S.people.find((u) => u.id === id)?.name || '同事';
const planById = (id) => S.plans.find((p) => p.id === id);
const STATUS_TAG = { draft: '', pending: 'tag--warn', rejected: 'tag--danger', scheduled: 'tag--accent', running: 'tag--ok', paused: 'tag--warn', ended: '', done: '' };
const statusOf = (p) => core.planStatus(p, now());
const layerCls = (p) => (p.kind === 'permanent' ? 'L-perm' : 'L-window');
const kindLabel = (p) => (p.kind === 'permanent' ? '永久调价' : `限时${core.prioOf(p) !== core.PRIO_MAX ? ` · 优先级 ${core.prioOf(p)}` : ''}`);
const holdsOf = (planId) => S.vault.filter((v) => v.hold && (!planId || v.hold.planId === planId));

// 改价数据(2026-10-28 用户:系统慢)—— 同一时间只读一次,「我的工作」/ 活动页 / Collection 排序里要用也共用这一份
// 默认只读没结束的计划;all = 连已结束的一起(看「已结束 / 全部」、从活动页 / 历史打开旧计划时)
const psInflight = {}, psLast = {}; // 按 all / cur 分开
function priceState(maxAge = 0, all = false) {
  const k = all ? 'all' : 'cur'; const last = psLast[k] || (all ? null : psLast.all); // 有全部的也能当「没结束的」用
  if (last && Date.now() - last.at <= maxAge) return Promise.resolve(last.value);
  return (psInflight[k] ||= api('GET', `/api/price/state${all ? '?all=1' : ''}`)
    .then((v) => { psLast[k] = { at: Date.now(), value: v }; return v; })
    .finally(() => { psInflight[k] = null; }));
}
window.cgpPriceState = priceState;
const wantAll = () => ['ended', 'all'].includes(filter);
let loadingAll = false; // 正在补读已结束的计划
async function load(all = wantAll()) {
  S = await priceState(0, all);
  renderChrome();
}
// 旧计划(已结束的)默认没读进来:要打开时先补读全部
async function planByIdAll(id) {
  let p = planById(id);
  if (!p && !S.allPlans) { await load(true); p = planById(id); }
  return p;
}
const planName = (id) => (S.planNames || []).find((x) => x.id === id)?.name || planById(id)?.name || '';

// ================= 外框 =================
function renderChrome() {
  const pend = S.plans.filter((p) => (p.state === 'pending' || p.pendingChange) && canApprove(p.pendingChange ? { ...p, ...p.pendingChange } : p)).length;
  const holds = holdsOf().length;
  const nav = document.querySelector('#modnav [data-section="price"]');
  if (nav) {
    let b = nav.querySelector('.modnav__n'); if (!b) { nav.insertAdjacentHTML('beforeend', '<span class="modnav__n modnav__n--alert"></span>'); b = nav.querySelector('.modnav__n'); }
    b.textContent = pend + holds; b.hidden = !(pend + holds);
  }
}
const SUBTABS = [['plans', '改价计划'], ['vault', '受管产品'], ['ledger', '价格账本'], ['settings', '改价设置']];
function headHtml() {
  const e = S.engine;
  const pend = S.plans.filter((p) => (p.state === 'pending' || p.pendingChange) && canApprove(p.pendingChange ? { ...p, ...p.pendingChange } : p)).length;
  const holds = holdsOf().length;
  return `<div class="pr-head"><div><h2>改价</h2><p class="muted">${S.approvals ? '限时 / 永久改价 · 指定审批人 · 到点自动改 · 到期自动恢复 · 通知只私信相关的人' : '限时 / 永久改价 · 到点自动改 · 到期自动恢复'}</p></div>
    ${e.lastError ? `<span class="pr-chip pr-chip--warn" title="${esc(e.lastError)}">执行器出错:${esc(e.lastError.slice(0, 40))}</span>` : `<span class="pr-chip">执行器 · ${e.lastRun ? ago(e.lastRun) + '对齐' : '还没运行'}</span>`}</div>
  <div class="pr-subnav">${SUBTABS.map(([k, l]) => `<button class="${!E && tab === k ? 'is-on' : ''}" data-a="tab" data-t="${k}">${l}${k === 'plans' && pend ? ` <span class="modnav__n modnav__n--alert">${pend}</span>` : ''}${k === 'vault' && holds ? ` <span class="modnav__n modnav__n--alert">${holds}</span>` : ''}</button>`).join('')}</div>`;
}

function render() {
  const root = $('#pr-root');
  window.cgpNav?.sync(); // 地址栏:/price、/price/vault、/price/<计划 id>…(public/nav.js)
  if (E) {
    // 重画会换掉整个编辑器:记下正在输入的框,画完放回去(改折扣、搜产品时边打字边刷新)
    // 表格里每个款式都有自己的框:按 data-v 精确找回;还没按回车的内容也原样放回(后台读完产品 / 款式图时会重画,别把正在打的字弄丢)
    const a = document.activeElement; const inside = a && root.contains(a);
    const key = inside ? (a.dataset?.f ? `[data-f="${a.dataset.f}"]${a.dataset.v ? `[data-v="${a.dataset.v}"]` : ''}${a.dataset.ver ? `[data-ver="${a.dataset.ver}"]` : ''}` : a.id ? `#${a.id}` : a.dataset?.tq ? `[data-tq="${a.dataset.tq}"]` : null) : null;
    const typed = inside && 'value' in a ? a.value : null;
    let pos = null; try { pos = inside ? a.selectionStart : null; } catch { /* 数字框没有光标位置 */ }
    root.innerHTML = editorHtml();
    if (key) {
      const b = root.querySelector(key);
      if (b) { if (typed != null && b.type !== 'checkbox' && b.type !== 'radio' && b.value !== typed) b.value = typed; b.focus(); try { if (pos != null) b.setSelectionRange(pos, pos); } catch { /* 同上 */ } }
    }
    return;
  }
  root.innerHTML = headHtml() + { plans: plansHtml, vault: vaultHtml, ledger: () => '<div id="ledger-root"><p class="muted">加载中…</p></div>', settings: settingsHtml }[tab]();
  if (tab === 'ledger') loadLedger();
}

// ================= 改价计划列表 =================
const FILTERS = [
  ['active', '未结束', (s) => ['running', 'paused', 'scheduled', 'pending'].includes(s)],
  ['running', '进行中', (s) => ['running', 'paused'].includes(s)],
  ['scheduled', '已排期', (s) => s === 'scheduled'],
  ['pending', '待审核', (s, p) => s === 'pending' || !!p.pendingChange],
  ['draft', '草稿', (s) => ['draft', 'rejected'].includes(s)],
  ['ended', '已结束', (s) => ['ended', 'done'].includes(s)],
  ['all', '全部', () => true],
];
const ORDER = { running: 0, paused: 1, scheduled: 2, pending: 3, rejected: 4, draft: 5, ended: 6, done: 7 };

// ---- 分组(2026-11-03 用户:计划几十上百个时好找;同一天改成「一排分组标签」—— 原来「分组方式 + 三个筛选下拉」叠在一起太绕)----
// 列表上面一排标签就是分组(带数量),点一个只看它;左边小开关切换「我的分组 / 按活动 / 按品牌」。
// 「我的分组」= 计划上自己起的分组名(plan.folder);按活动 / 品牌是自动分的(页面上算,不存)
// 2026-11-09:一度去掉过(误会了用户的意思),同一天用户要回来 —— 数据一直在(plan.folder 没删过),列表照旧「我的分组 | 按活动 | 按品牌」。
// 编辑页里叫「列表分组」,免得和改价分组(分组 1 / 分组 2,一批产品)混
const LV = { by: ['folder', 'campaign', 'brand'].includes(localStorage.getItem('cgp-pr-by2')) ? localStorage.getItem('cgp-pr-by2') : 'folder',
  chip: '__all', q: '', sel: new Set(), newFolder: false };
const BY = [['folder', '我的分组'], ['campaign', '按活动'], ['brand', '按品牌']];
// 列表排序(2026-11-09 用户):创建时间(默认,最后建的在最上面)/ 编辑时间 / 改价开始时间 / 改价结束时间;旁边按钮反过来
const SORTS = [['created', '按创建时间'], ['edited', '按编辑时间'], ['start', '按改价开始时间'], ['end', '按改价结束时间']];
LV.sort = SORTS.some(([k]) => k === localStorage.getItem('cgp-pr-sort')) ? localStorage.getItem('cgp-pr-sort') : 'created';
LV.sortDir = localStorage.getItem('cgp-pr-sortdir') === 'asc' ? 'asc' : 'desc';
function planSorter() {
  const keyOf = (p) => { const sm = A.planSummary(p);
    return LV.sort === 'edited' ? p.updatedAt || p.approvedAt || p.createdAt || 0 : LV.sort === 'start' ? sm.start ?? 0 : LV.sort === 'end' ? sm.end ?? Infinity : p.createdAt || p.updatedAt || sm.start || 0; };
  const d = LV.sortDir === 'asc' ? 1 : -1;
  return (a, b) => { const x = keyOf(a.p), y = keyOf(b.p); return (x === y ? 0 : x < y ? -1 : 1) * d || String(a.p.name || '').localeCompare(String(b.p.name || ''), 'zh'); };
}
const NONE = { folder: '未分组', campaign: '没关联活动', brand: '还没有产品' };
const foldersAll = () => [...new Set([...S.plans.map((p) => p.folder), ...(S.folders || [])].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
// 计划里的品牌,按选项数多到少
function brandsOf(p) {
  const m = new Map(); for (const sl of p.slots) for (const i of sl.items) if (i.vendor) m.set(i.vendor, (m.get(i.vendor) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
// 这个计划属于哪几个标签('' = 未分组 / 没关联活动 / 没有产品);一个计划可以有几个品牌,几个品牌标签里都算它
// 计划关联的活动(几个价格各自关联时有好几个)
const campaignsOf = (p) => { const m = new Map(); for (const c of [...(p.campaigns || []), p.campaign]) if (c?.id) m.set(c.id, c); return [...m.values()]; };
const keysOf = (p, by = LV.by) => (by === 'folder' ? [p.folder || ''] : by === 'campaign' ? (campaignsOf(p).length ? campaignsOf(p).map((c) => c.id) : ['']) : brandsOf(p).length ? brandsOf(p) : ['']);
const qOf = () => LV.q.trim().toLowerCase();
function searchMatch(p) {
  const q = qOf(); if (!q) return true;
  return [p.name, p.folder, ...campaignsOf(p).map((c) => c.name), ...brandsOf(p)].some((x) => String(x || '').toLowerCase().includes(q))
    || p.slots.some((sl) => sl.items.some((i) => `${i.product || i.title} ${i.variant || ''} ${i.sku || ''}`.toLowerCase().includes(q)));
}
const chipMatch = (p) => LV.chip === '__all' || keysOf(p).includes(LV.chip);
// 搜的是产品时,告诉人这个计划里命中了哪个产品
function hitOf(p) {
  const q = qOf(); if (!q || String(p.name || '').toLowerCase().includes(q)) return '';
  const it = p.slots.flatMap((sl) => sl.items).find((i) => `${i.product || i.title} ${i.variant || ''} ${i.sku || ''}`.toLowerCase().includes(q));
  return it ? `<div class="plan__hit">包含 <b>${esc(it.product || it.title)}</b>${it.variant ? ` · ${esc(it.variant)}` : ''}${it.sku ? ` <span class="muted">${esc(it.sku)}</span>` : ''}${it.price != null ? ` → <b>${money(it.price)}</b>` : ''}</div>` : '';
}
// 分组标签条。base = 按状态页签 + 搜索筛过的计划(标签上的数字按它算,和下面列表对得上)
function groupBarHtml(base, shown) {
  const by = LV.by; const counts = new Map();
  for (const { p } of base) for (const k of keysOf(p)) counts.set(k, (counts.get(k) || 0) + 1);
  if (by === 'folder') for (const f of foldersAll()) if (!counts.has(f)) counts.set(f, 0); // 我的分组:这个状态下没有计划的也列出来(数字 0)
  if (LV.chip !== '__all' && !counts.has(LV.chip)) counts.set(LV.chip, 0);
  const camps = new Map(S.plans.flatMap((p) => campaignsOf(p)).map((c) => [c.id, c.name]));
  const label = (k) => (!k ? NONE[by] : by === 'campaign' ? camps.get(k) || '活动' : k);
  const keys = [...counts.keys()].sort((a, b) => (!a) - (!b) || label(a).localeCompare(label(b), 'zh'));
  const chip = (k, txt, n) => `<button type="button" class="pl-chip ${LV.chip === k ? 'is-on' : ''} ${!n && k !== '__all' ? 'is-empty' : ''}" data-a="lchip" data-k="${esc(k)}">${esc(txt)} <b>${n}</b></button>`;
  const ids = shown.map((x) => x.p.id); const allSel = ids.length && ids.every((id) => LV.sel.has(id));
  return `<div class="pl-bar">
    <span class="pr-seg pr-seg--sm pl-bar__by">${BY.map(([k, l]) => `<button type="button" class="${by === k ? 'is-on' : ''}" data-a="lby" data-v="${k}">${l}</button>`).join('')}</span>
    <div class="pl-chips">${chip('__all', '全部', base.length)}${keys.map((k) => chip(k, label(k), counts.get(k))).join('')}
      ${by === 'folder' ? (LV.newFolder ? `<span class="pl-newf"><input class="inp inp--sm" id="pl-newf" maxlength="${A.FOLDER_MAX}" placeholder="新分组的名字,回车"/><button type="button" class="linkbtn" data-a="lnewf0">取消</button></span>`
        : '<button type="button" class="pl-chip pl-chip--add" data-a="lnewf" title="先勾选下面的计划,再点这里起名字,勾选的就放进新分组">＋ 新分组</button>') : ''}</div>
    ${ids.length ? `<label class="pl-bar__all"><input type="checkbox" data-a="lselgrp" data-ids="${ids.join(',')}" ${allSel ? 'checked' : ''}/>全选这 ${ids.length} 个</label>` : ''}
  </div>`;
}
function bulkHtml() {
  const n = LV.sel.size; if (!n) return '';
  return `<div class="pl-bulk"><b>已选 ${n} 个计划</b>
    <span class="pl-bulk__g">移到分组 <input class="inp inp--sm" id="pl-folder" list="pl-folders" placeholder="新的或已有的分组名" maxlength="${A.FOLDER_MAX}"/><datalist id="pl-folders">${foldersAll().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      <button type="button" class="btn btn-sm btn-primary" data-a="lmove">移过去</button><button type="button" class="linkbtn" data-a="lunfolder">移出分组</button></span>
    <span class="pl-bulk__g">关联活动 <select class="sel sel--sm" id="pl-camp"><option value="">不关联</option>${(cache.campaigns || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
      <button type="button" class="btn btn-sm" data-a="lcamp">关联</button></span>
    <button type="button" class="linkbtn" data-a="lnone">取消选择</button></div>`;
}

function plansHtml() {
  const st = S.plans.map((p) => ({ p, s: statusOf(p) }));
  // 已结束的没读进来时,「已结束 / 全部」的数字用服务器给的
  const count = (f) => st.filter(({ p, s }) => f(s, p)).length + (!S.allPlans && f === FILTERS[5][2] ? S.endedCount || 0 : !S.allPlans && f === FILTERS[6][2] ? S.endedCount || 0 : 0);
  const live = S.vault.filter((v) => v.written && !v.hold).length;
  const showPending = !!S.approvals || count(FILTERS[3][2]) > 0; // 多人协作关着时,所有人都能直接批准,基本不会有待审核
  const f = FILTERS.find((x) => x[0] === filter) || FILTERS[0];
  const ovIdx = core.overlapIndex(S.plans, now()); // 还没结束的限时计划之间,改到同一个产品又时间重叠的
  const base = st.filter(({ p, s }) => f[2](s, p) && searchMatch(p));
  const list = base.filter(({ p }) => chipMatch(p)).sort(planSorter());
  return `
  <div class="stats">
    <button class="stat" data-a="filter" data-f="running"><div class="stat__n">${count(FILTERS[1][2])}</div><div class="stat__l">进行中的计划</div></button>
    <button class="stat" data-a="filter" data-f="scheduled"><div class="stat__n">${count(FILTERS[2][2])}</div><div class="stat__l">已排期</div></button>
    ${showPending ? `<button class="stat ${count(FILTERS[3][2]) ? 'stat--danger' : ''}" data-a="filter" data-f="pending"><div class="stat__n">${count(FILTERS[3][2])}</div><div class="stat__l">待审核</div></button>` : ''}
    <button class="stat" data-a="tab" data-t="vault"><div class="stat__n">${live}</div><div class="stat__l">正在活动价上的选项</div></button>
    <button class="stat ${holdsOf().length ? 'stat--danger' : ''}" data-a="tab" data-t="vault"><div class="stat__n">${holdsOf().length}</div><div class="stat__l">暂停接管(要处理)</div></button>
  </div>
  ${ganttHtml()}
  <div class="toolbar">
    <button class="btn btn-primary" data-a="new" data-kind="window">+ 限时改价</button>
    <button class="btn" data-a="new" data-kind="permanent">+ 永久调价</button>
    <span class="tipify">Flash 每天一组:建好第一天,在计划里点「复制成下一天」。时间一律按英国时间(店铺时区),夏令时自动处理。</span>
    <span class="spacer"></span>
  </div>
  <div class="pl-top"><div class="pr-tabs">${FILTERS.filter(([k]) => k !== 'pending' || showPending).map(([k, label, fn]) => `<button class="${k === filter ? 'is-on' : ''}" data-a="filter" data-f="${k}">${label} ${count(fn)}</button>`).join('')}</div>
    <span class="pl-sort"><select class="sel sel--sm" data-lv="sort" title="列表怎么排">${SORTS.map(([k, l]) => `<option value="${k}" ${LV.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn btn-sm btn-ghost" data-a="lsortdir" title="点一下反过来">${LV.sortDir === 'desc' ? '↓ 新 / 晚的在上' : '↑ 旧 / 早的在上'}</button></span>
    <input class="inp inp--sm pl-top__q" data-lv="q" placeholder="搜计划 / 产品 / SKU / 品牌" value="${esc(LV.q)}"/></div>
  ${LV.q && !S.allPlans ? '<p class="muted pl-top__more">已结束的计划还没一起搜。<button type="button" class="linkbtn" data-a="filter" data-f="all">连已结束的一起搜</button></p>' : ''}
  ${groupBarHtml(base, list)}
  ${bulkHtml()}
  ${loadingAll ? '<div class="pr-empty">正在读已结束的计划…</div>' : list.length ? list.map(({ p, s }) => planRow(p, s, ovIdx.get(p.id))).join('') : `<div class="pr-empty">${LV.q || LV.chip !== '__all' ? '没有符合的计划' : '这里还没有计划'}</div>`}`;
}

const leftTxt = (ms) => {
  const d = ms - now(); if (d <= 0) return '';
  const dd = Math.floor(d / DAY), hh = Math.floor((d % DAY) / 3600000), mm = Math.floor((d % 3600000) / 60000);
  return dd ? `${dd} 天 ${hh} 小时` : hh ? `${hh} 小时 ${mm} 分` : `${mm} 分`;
};
// 这个计划在做什么,用一句话说清(和原来那个 app 的 "Change N products ... to specific prices." 一样)
function planSay(p) {
  const its = p.slots.flatMap((x) => x.items);
  const n = new Set(its.map((i) => i.productId)).size;
  const gs = groupsOf(p);
  const r = gs[0]?.rule ? RULE_MODES[gs[0].rule.mode] : null;
  const vs = versionsOf(p);
  // 按时间段(2026-11-09 用户:每个计划把所有时间段列出来,几段、每段什么时间):每段一行 —— 段名 + 时间 + 每一组怎么改 + 这段的设置
  if (p.kind === 'window' && p.schedule?.mode !== 'weekly' && p.slots.length > 1) {
    const sl = [...p.slots].sort((a, b) => a.start - b.start);
    return `把 <b>${n}</b> 个产品分 <b>${sl.length}</b> 个时间段改${gs.length > 1 ? `(${gs.length} 组)` : ''}:<span class="pl-vers">${sl.map((x, k) => { const v = vs.find((y) => y.id === (x.version || 'A')) || {};
      const set = vSetSay({ coll: x.collection, tagsAdd: x.tagsAdd, tagsRemove: x.tagsRemove, campaign: x.campaign, countdown: x.countdown });
      return `<span class="pl-ver">${vDot(p, x.version || 'A')}<b>${esc(v.name || `第 ${k + 1} 段`)}</b><span class="muted">${fmtT(x.start)} → ${fmtT(x.end)}</span>
      ${gs.map((g, i) => `<span>${gs.length > 1 ? `${esc(gName(g, i))} ` : ''}${esc(ruleShort(ruleAt(g, x.version || 'A')))}</span>`).join('<span class="muted">·</span>')}
      ${set ? `<span class="pl-ver__set">${set}</span>` : ''}</span>`; }).join('')}</span>`;
  }
  // 每周重复:每种价格一行 —— 名字 + 每一组怎么改 + 用在几段
  if (vs.length > 1 && p.slots.length > 1) {
    const segN = (id) => p.slots.filter((x) => (x.version || 'A') === id).length;
    return `把 <b>${n}</b> 个产品分 ${vs.length} 种价格改${gs.length > 1 ? `(${gs.length} 组)` : ''}:<span class="pl-vers">${vs.map((v) => `<span class="pl-ver">${vDot(p, v.id)}<b>${esc(vName(p, v.id))}</b>
      ${gs.map((g, i) => `<span>${gs.length > 1 ? `${esc(gName(g, i))} ` : ''}${esc(ruleShort(ruleAt(g, v.id)))}</span>`).join('<span class="muted">·</span>')}
      <span class="muted">用在 ${segN(v.id)} 段</span>${vSetSay(v) ? `<span class="pl-ver__set">${vSetSay(v)}</span>` : ''}</span>`).join('')}</span>`;
  }
  const how = gs.length > 1 ? `分 ${gs.length} 组改价(${gs.map((g, i) => `${esc(gName(g, i))} ${esc(ruleShort(g.rule))}`).join(' / ')})` : r ? r.say(gs[0].rule.value) : '按逐个产品设定的价格';
  return `把 <b>${n}</b> 个产品${p.kind === 'permanent' ? '永久' : '在活动期间'}:${how}`;
}
function planRow(p, s, ovs = []) {
  const sum = A.planSummary(p);
  const items = p.slots.flatMap((x) => x.items).filter((i) => i.price != null);
  const maxOff = items.reduce((m, i) => Math.max(m, core.discountPct(i.refPrice, i.price)), 0);
  const holds = holdsOf(p.id).length;
  const live = S.vault.filter((v) => v.written?.planId === p.id).length;
  const prods = [...new Map(p.slots.flatMap((x) => x.items).map((i) => [i.productId, i])).values()];
  const ap = canApprove(p);
  const btn = (act, label, cls = '') => `<button class="btn btn-sm ${cls}" data-a="${act}" data-id="${p.id}">${label}</button>`;
  const acts = [
    btn('open', '编辑'),
    ...(p.state === 'approved' && !p.stopped && !['ended', 'done'].includes(s) ? [
      ...(ap ? [btn('qpause', p.paused ? '继续' : '暂停(先回到改价前)')] : []),
      btn('qstop', '提前结束', 'btn-danger'),
    ] : []),
    ...(s === 'pending' && ap ? [btn('qapprove', '批准', 'btn-ok')] : []),
    btn('qdup', '复制'),
    ...(p.kind === 'window' && sum.end ? [btn('qdupnext', '复制成下一天')] : []),
  ].join('');
  return `<div class="plan ${LV.sel.has(p.id) ? 'is-sel' : ''}">
    <div class="plan__bar ${layerCls(p)}" style="${p.color ? `background:${esc(p.color)}` : ''}"></div>
    <label class="plan__sel" title="选中后可以一起移到分组 / 关联活动"><input type="checkbox" data-a="lsel" data-id="${p.id}" ${LV.sel.has(p.id) ? 'checked' : ''}/></label>
    <div data-a="open" data-id="${p.id}" style="cursor:pointer">
      <div class="plan__name">${esc(p.name || '未命名计划')}
        <span class="tag ${STATUS_TAG[s]}">${core.STATUS_CN[s]}</span>
        <span class="tag ${p.kind === 'window' ? 'tag--' + layerCls(p) : ''}">${kindLabel(p)}</span>
        ${p.slots.length > 1 ? `<span class="tag" title="${esc(p.slots.map((x) => `${x.version ? vName(p, x.version) + ' · ' : ''}${fmtT(x.start)} → ${fmtT(x.end)}`).join('\n'))}">${p.schedule?.mode === 'weekly' ? `每周重复 · ${p.slots.length} 段${versionsOf(p).length > 1 ? ` · ${versionsOf(p).length} 种价格` : ''}` : `${p.slots.length} 个时间段`}</span>` : ''}
        ${p.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}
        ${holds ? `<span class="tag tag--danger">${holds} 个暂停接管</span>` : ''}
        ${ovs.length ? `<span class="tag tag--warn" title="${esc(ovs.map((o) => `「${o.name}」:${o.n} 个选项,重叠时用「${o.wins ? p.name : o.name}」的价`).join('\n'))}">⚠️ 和「${esc(ovs[0].name)}」${ovs.length > 1 ? `等 ${ovs.length} 个计划` : ''}改到同一批产品(${ovs.reduce((n, o) => n + o.n, 0)} 个选项)</span>` : ''}
        ${p.folder && LV.by !== 'folder' ? `<span class="tag">分组:${esc(p.folder)}</span>` : ''}
        ${campaignsOf(p).length ? `<span class="tag">活动:${campaignsOf(p).map((c) => esc(c.name)).join('、')}${p.followCampaign ? ' · 跟随时间' : ''}</span>` : ''}
        ${S.approvals ? `<span class="tag">审批:${p.approver ? esc(nameOf(p.approver)) : '管理员'}</span>${p.owner ? `<span class="tag">负责:${esc(nameOf(p.owner))}</span>` : ''}` : ''}
      </div>
      <div class="plan__say">${planSay(p)}</div>
      ${hitOf(p)}
      <div class="plan__prods">${prods.slice(0, 3).map((i) => `<span>${esc(i.product || i.title)}</span>`).join('')}${prods.length > 3 ? `<span class="muted">…另有 ${prods.length - 3} 个产品</span>` : ''}</div>
      <div class="plan__meta">
        <span>${fmtT(sum.start)}${sum.end ? ' → ' + fmtT(sum.end) : ' 起生效'}</span>
        ${s === 'running' && sum.end ? `<span class="tx-ok">还剩 ${leftTxt(sum.end)}</span>` : s === 'scheduled' ? `<span>${leftTxt(sum.start)}后开始</span>` : ''}
        <span>${sum.products} 个产品 / ${sum.variants} 个选项</span>
        ${maxOff > 0 ? `<span>最大降幅 ${maxOff}%</span>` : ''}
        ${live ? `<span>此刻 ${live} 个选项在活动价上</span>` : ''}
        ${(p.tagsAdd || []).length ? `<span>加标签 ${p.tagsAdd.map(esc).join('、')}</span>` : ''}
        ${p.state === 'rejected' && p.rejectNote ? `<span style="color:var(--danger)">退回意见:${esc(p.rejectNote)}</span>` : ''}
      </div>
    </div>
    <div class="plan__acts">${acts}</div>
  </div>`;
}

// 接下来 14 天的时间轴(每个时段一条)
// 时间轴(2026-11-09 用户:能往前 / 往后翻,按一周 / 两周 / 一个月 / 三个月放大缩小)
const GSPANS = [[7, '一周'], [14, '两周'], [31, '一个月'], [92, '三个月']];
const GV = { span: GSPANS.some(([n]) => String(n) === localStorage.getItem('cgp-pr-gspan')) ? Number(localStorage.getItem('cgp-pr-gspan')) : 14, off: 0 };
const gStep = () => (GV.span <= 14 ? 7 : GV.span === 31 ? 14 : 31); // 往前 / 往后一次挪几天
const ymd = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { m: Number(p.month), d: Number(p.day), wd: p.weekday }; };
const WD_CN = { Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六', Sun: '日' };
function ganttHtml() {
  if (!S.plans.some((p) => !['draft', 'rejected'].includes(statusOf(p)))) return '';
  const n = GV.span; const t0 = dayAt(GV.off); const t1 = dayAt(GV.off + n); const span = t1 - t0;
  if (GV.off < 0 && !S.allPlans && !loadingAll && !GV.askedAll) { GV.askedAll = true; setTimeout(async () => { loadingAll = true; try { await load(true); } catch { /* 读不到就只看没结束的 */ } loadingAll = false; render(); }, 0); } // 往前翻:把已结束的计划也读进来
  const rows = S.plans.filter((p) => !['draft', 'rejected'].includes(statusOf(p)) && !p.stopped && p.slots.some((s) => (s.end ?? s.start + DAY) > t0 && s.start < t1))
    .sort((a, b) => A.planSummary(a).start - A.planSummary(b).start);
  const pct = (ms) => `${((Math.min(Math.max(ms, t0), t1) - t0) / span) * 100}%`;
  const days = Array.from({ length: n }, (_, i) => dayAt(GV.off + i));
  const today = dayAt(0); const nowIn = now() >= t0 && now() < t1; const nowLeft = pct(now());
  // 表头:两周以内每天写「11/9周一」;一个月写日期 + 星期两行;三个月只在周一写日期、每月 1 号写月份
  const head = days.map((d) => { const x = ymd(d); const we = x.wd === 'Sat' || x.wd === 'Sun';
    const cls = `${d === today ? 'is-today' : ''} ${we ? 'is-we' : ''} ${x.d === 1 ? 'is-m1' : ''}`;
    if (n <= 14) return `<span class="${cls}">${fmtD(d)}</span>`;
    if (n <= 31) return `<span class="${cls} is-2l">${x.d === 1 || d === days[0] ? `<b>${x.m}/${x.d}</b>` : x.d}<i>${WD_CN[x.wd] || ''}</i></span>`;
    return `<span class="${cls} is-sparse">${x.d === 1 ? `<b>${x.m}月</b>` : x.wd === 'Mon' && x.d >= 3 && x.d <= 27 ? `${x.m}/${x.d}` : ''}</span>`; }).join(''); // 月初前后的周一不写,免得和「12月」叠在一起
  const bar = `<div class="gantt__bar"><span class="pr-seg pr-seg--sm">${GSPANS.map(([k, l]) => `<button type="button" class="${n === k ? 'is-on' : ''}" data-a="gspan" data-v="${k}">${l}</button>`).join('')}</span>
    <span class="gantt__nav"><button type="button" class="btn btn-sm btn-ghost" data-a="gnav" data-d="-1" title="往前 ${gStep()} 天">‹ 往前</button><button type="button" class="btn btn-sm ${GV.off ? '' : 'btn-ghost'}" data-a="gnav" data-d="0">今天</button><button type="button" class="btn btn-sm btn-ghost" data-a="gnav" data-d="1" title="往后 ${gStep()} 天">往后 ›</button></span>
    <span class="muted">${fmtD(t0)} – ${fmtD(t1 - DAY)}${loadingAll ? ' · 正在读已结束的计划…' : ''}</span></div>`;
  return `<div class="gantt">${bar}<div class="gantt__grid">
    <div></div><div class="gantt__days" style="grid-template-columns:repeat(${n}, 1fr)">${head}</div>
    ${rows.length ? '' : '<div></div><div class="gantt__empty muted">这段时间没有改价</div>'}
    ${rows.map((p) => `<div class="gantt__label" data-a="open" data-id="${p.id}" title="${esc(p.name)}">${versionsOf(p).length > 1 ? `<span class="pr-dot" style="background:${esc(p.color || '#888')}"></span>` : ''}${esc(p.name)}</div>
      <div class="gantt__lane">${p.slots.map((s, i) => {
        const end = s.end ?? s.start + DAY / 3;
        if (end <= t0 || s.start >= t1) return '';
        const mv = s.version && versionsOf(p).length > 1; // 这一段用的是几种价格里的哪一种:条上写价格的名字(不写 A / B),停上去看每一组在这个价格下怎么改
        const tip = [`${p.name}${mv ? ` · ${vName(p, s.version)}` : p.slots.length > 1 ? ` · 第 ${i + 1} 段` : ''}`, `${fmtT(s.start)}${s.end ? ' → ' + fmtT(s.end) : ' 起'} · ${s.items.length} 个选项`,
          ...(mv || groupsOf(p).length > 1 ? groupsOf(p).map((g, gi) => `${groupsOf(p).length > 1 ? `${gName(g, gi)}:` : ''}${ruleSay(ruleAt(g, s.version))}`) : [])].join('\n');
        return `<div class="gantt__slot ${layerCls(p)} ${p.state === 'pending' ? 'is-pending' : ''}" style="${mv ? `background:${vColor(p, s.version)};` : p.color ? `background:${esc(p.color)};` : ''}left:${pct(s.start)};width:calc(${pct(end)} - ${pct(s.start)})" data-a="open" data-id="${p.id}" data-slot="${i}"
          title="${esc(tip)}">${p.kind === 'permanent' ? '永久' : mv ? esc(`${p.name}-${vName(p, s.version)}`) : p.slots.length > 1 ? esc(`${p.name}-第 ${i + 1} 段`) : esc(p.name)}</div>`; // 2026-11-09 用户:计划名在前,如「test2-黑五」
      }).join('')}${nowIn ? `<div class="gantt__now" style="left:${nowLeft}"></div>` : ''}</div>`).join('')}
  </div></div>`;
}

// ================= 编辑器 =================
// 和原来那个改价 app 一样:从上往下填 —— 名称 → 改什么价 → 改哪些产品 → 什么时候 → 标签 → 谁负责 → 高级;
// 右边一直显示一段大白话摘要。具体到每个变体的价格收在「试算预览」里,点开才看。
const COLORS = ['#6b8e23', '#2f5cff', '#c0342b', '#9a6300', '#067a57', '#7b3fa0', '#444'];
// 顺序(2026-10-28 用户):百分比降价 → 减固定金额 → 逐个填价 → 售价不变 → 统一改成一个价;涨价只有永久调价有,跟在百分比降价后面
const RULE_MODES = {
  percent_off: { label: '按百分比降价', unit: '%', say: (v) => `每个产品的现价下降 ${v}%` },
  percent_up: { label: '按百分比涨价', unit: '%', say: (v) => `每个产品的现价上涨 ${v}%` },
  amount_off: { label: '减固定金额', unit: '£', say: (v) => `每个产品的现价减 £${v}` },
  manual: { label: '逐个填价', unit: '', say: () => '逐个填新价' },
  keep: { label: '售价不变(只改划线价)', unit: '', say: () => '售价不动,只调整划线价' },
  fixed: { label: '统一改成一个价', unit: '£', say: (v) => `所有产品都改成 £${v}` },
};
// 划线价五种(2026-10-28 用户定):限时改价默认「显示原来的划线价,没有就显示原来的现价」(不然原来没打折的产品改了价也看不出在打折);
// 永久调价默认「只显示原来的划线价」
const CMP_OPTS = [
  ['original', '显示原来的划线价,没有就显示原来的现价', '原来有划线价(比如建议零售价 £100、现在卖 £80)→ 显示 <s>£100</s>;原来没有划线价 → 显示改价前的售价(原来卖 £80、改成 £70 → <s>£80</s> £70)。<b>限时促销选这个</b>,前台的「只显示打折」、促销链接、折扣角标都靠划线价判断'],
  ['keep', '只显示原来的划线价', '只用产品原来的划线价;<b>原来没有划线价的就不显示</b> —— 这些产品前台看不出在打折,也不会出现在促销链接、「只显示打折」里'],
  ['price', '只显示原来的现价', '划线价 = 改价前的售价,不管原来有没有划线价:原来卖 £80、改成 £70 → <s>£80</s> £70'],
  ['clear', '不显示划线价', '改价期间去掉划线价,只显示新价;这些产品不算打折'],
  ['set', '逐个指定划线价', '在每一组的「产品和新价」表格里给每个选项填划线价(选别的方式时,个别选项也能在表格里单独改,算例外)'],
];
const cmpDefault = (p) => (p.kind === 'window' ? 'original' : 'keep');
const cmpOf = (p) => p.compare || cmpDefault(p);
const cmpOpts = () => CMP_OPTS;
const CMP_SHORT = { original: '划线价:原划线价或原价', keep: '划线价:只用原划线价', price: '划线价:原来的现价', clear: '不显示划线价', set: '划线价逐个填' };
const gCmp = (p, g) => g?.compare || cmpOf(p);
function cmpHtml(ro, g) {
  const p = P(); const cur = gCmp(p, g);
  const isDef = cur === cmpDefault(p); const label = CMP_OPTS.find((o) => o[0] === cur)?.[1] || '';
  if (!E.cmpOpen?.[g.id]) { // 2026-10-29 用户:平时只用第一个,收起来,只显示现在选的
    return `<div class="pr-cmpsum ${isDef ? '' : 'is-custom'}"><span><b>${esc(label)}</b>${isDef ? ' <span class="muted">(默认)</span>' : ''}</span>
      ${ro || started() ? '' : `<button type="button" class="linkbtn" data-a="cmpopen" data-g="${g.id}">修改 ▾</button>`}</div>`;
  }
  return `<div class="pr-cmpsum"><span class="muted">选一种:</span><button type="button" class="linkbtn" data-a="cmpopen" data-g="${g.id}">收起 ▴</button></div><div class="cmpopts">${CMP_OPTS.map(([k, t, d]) => `<label class="cmpopt ${cur === k ? 'is-on' : ''}"><input type="radio" name="cmp-${g.id}" data-f="compare" value="${k}" ${cur === k ? 'checked' : ''} ${ro || started() ? 'disabled' : ''}/><span><b>${t}${k === cmpDefault(p) ? ' <span class="muted">(默认)</span>' : ''}</b><em>${d}</em></span></label>`).join('')}</div>
    ${started() ? '<p class="muted">计划已经开始,划线价方式不能再改。</p>' : ''}`;
}
// 改价倒计时(2026-10-27 用户):倒数到这个计划恢复原价;写在产品字段 custom.cgp_price_cd,主题里比活动的倒计时优先
const CD_STY = { classic: ['经典红框', '#ffefef', '#d10000', 'Deals Expires in :'], pill: ['胶囊', '#fdecec', '#c8102e', 'Deal ends in'],
  dark: ['黑金', '#111111', '#f5c518', 'Deal ends in'], minimal: ['只有文字', 'transparent', '#d10000', 'Ends in'] };
const CD_DAYS_CN = [[0, '一直显示'], [1, '最后 1 天'], [3, '最后 3 天'], [7, '最后 7 天'], [15, '最后 15 天']];
const cdLabel = (p) => String(p.countdown?.label || '').trim() || (CD_STY[p.countdown?.style] || CD_STY.classic)[3];
// 预览照主题 snippets/cgp-campaign-offer.liquid 画:经典 = 方框「2d 4h 12m 30s」;胶囊 / 黑金 = 圆角 + 时钟图标「2 days 04:12:30」,最后一天反色;只有文字 = 没底色
function cdPreview(p, sty, bg, fg) {
  const flip = sty === 'pill' || sty === 'dark';
  const icon = flip ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>' : '';
  const chip = (inv, time) => `<span class="cdpv cdpv--${sty}" style="--cd-bg:${inv ? fg : bg};--cd-fg:${inv ? bg : fg}">${icon}${esc(cdLabel(p))} <b>${time}</b></span>`;
  return `<div class="cdpvs"><span class="cdpvs__k">平时</span>${chip(false, sty === 'classic' ? '2d 4h 12m 30s' : '2 days 04:12:30')}
    ${flip ? `<span class="cdpvs__k">最后一天</span>${chip(true, '04:12:30')}` : ''}</div>`;
}
function cdHtml(p, ro) {
  const c = p.countdown || {}; const sty = CD_STY[c.style] ? c.style : 'classic'; const [, bg, fg] = CD_STY[sty];
  return `<label class="row" style="gap:8px;margin-bottom:10px;font-size:13px"><input type="checkbox" data-f="cdon" ${c.on ? 'checked' : ''} ${ro ? 'disabled' : ''}/> <b>在产品上显示倒计时</b>
      <span class="muted">倒数到这个计划结束(一天一段的,倒数到当天这一段结束)</span></label>
    ${c.on ? `<div class="grid2">
      <label class="pr-fld">文字 <em>显示在时间前面,比如 Black Friday ends in、Pre-Order Offer ends in;留空用样式默认的</em>
        <input class="inp" data-f="cdlabel" maxlength="60" value="${esc(c.label || '')}" placeholder="${esc(CD_STY[sty][3])}" ${ro ? 'disabled' : ''}/></label>
      <label class="pr-fld">什么时候开始显示
        <select class="sel" data-f="cddays" ${ro ? 'disabled' : ''}>${CD_DAYS_CN.map(([d, l]) => `<option value="${d}" ${Number(c.days || 0) === d ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="pr-fld">样式 <em>和活动倒计时同一套</em>
        <select class="sel" data-f="cdstyle" ${ro ? 'disabled' : ''}>${Object.entries(CD_STY).map(([k, v]) => `<option value="${k}" ${sty === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <div class="pr-fld">预览 <em>和网站上一模一样${sty === 'pill' || sty === 'dark' ? ';胶囊 / 黑金最后一天会整条变实心(反色),提醒快结束了' : ''}</em>${cdPreview(p, sty, bg, fg)}</div>
    </div>` : ''}`;
}
const SCOPE_MODES = { products: '指定产品', collections: '指定 Collection', search: '按品牌 / 标签 / 类型', all: '全店所有产品' }; // 2026-10-29 用户:选产品优先(默认、排第一)

// 改价分组:一个计划里可以分几组,每组自己选产品、自己定规则(比如合集 A 打 85 折、品牌 B 打 7 折、几个产品逐个填价)
function newGroup(kind, rule, compare) {
  return { id: uid('g_'), scope: { mode: 'products', collections: [], products: [], vendor: '', tag: '', type: '' },
    rule: rule ? { ...rule } : { mode: kind === 'permanent' ? 'percent_up' : 'percent_off', value: kind === 'permanent' ? 5 : 15, rounding: '', from: 'price' },
    compare: compare || (kind === 'permanent' ? 'keep' : 'original') }; // 划线价按分组设(2026-10-28)
}
function newPlan(kind) {
  return {
    id: uid('p_'), name: '', color: COLORS[0], kind, layer: null, priority: core.PRIO_MAX,
    compare: kind === 'window' ? 'original' : 'keep', campaign: null, note: '',
    rule: { mode: kind === 'permanent' ? 'percent_up' : 'percent_off', value: kind === 'permanent' ? 5 : 15, rounding: '', from: 'price' },
    scope: { mode: 'products', collections: [], products: [], vendor: '', tag: '', type: '' },
    tagsAdd: [], tagsRemove: [],
    groups: [newGroup(kind)],
    slots: [{ id: uid('s_'), start: dayAt(1), end: kind === 'permanent' ? null : dayAt(8), items: [], collection: null }],
    followCampaign: false, state: 'new', excluded: [], owner: S.me.id, approver: null, cc: [],
    countdown: { on: false, label: '', days: 0, style: 'classic' },
  };
}
function openEditor(plan, isNew) {
  const p = clone(plan);
  p.rule ||= { mode: p.kind === 'permanent' ? 'percent_up' : 'percent_off', value: 15, rounding: '', from: 'price' };
  p.scope ||= { mode: 'products', collections: [], products: [], vendor: '', tag: '', type: '' };
  p.color ||= COLORS[0]; p.tagsAdd ||= []; p.tagsRemove ||= []; p.followCampaign = !!p.followCampaign;
  if (p.kind === 'window') p.priority = core.prioOf(p); // 老计划的层级换成数字(限时抢购 10 / 品牌 9 / 全场 8)
  p.countdown = { on: false, label: '', days: 0, style: 'classic', ...(p.countdown || {}) };
  if (!p.groups?.length) p.groups = [{ id: uid('g_'), scope: p.scope, rule: p.rule }]; // 老计划只有一组
  for (const g of p.groups) g.compare ||= p.compare || cmpDefault(p); // 老计划:各组用计划的划线价方式
  for (const sl of p.slots) for (const it of sl.items || []) it.group ??= p.groups[0].id; // 老计划的变体没记分组 = 第 1 组
  if (p.kind === 'window') p.schedule = { mode: p.schedule?.mode || (p.slots.length > 1 ? 'multi' : 'one'), ...(p.schedule?.weekly ? { weekly: p.schedule.weekly } : {}) };
  if (p.kind === 'window') ensureVersions(p); // 限时改价:不管分不分段,都按价格设(价格总览里第一个价格就是原来计划上那一份设置)
  const vitems = {}; // 每个价格的条目:取用这个价格的第一段
  for (const v of versionsOf(p)) { const sl = p.slots.find((x) => (x.version || 'A') === v.id); vitems[v.id] = tagVer(sl ? sl.items : v.id === 'A' ? p.slots[0].items : [], v.id); }
  E = { plan: p, orig: isNew ? null : plan, isNew, panel: null, dirty: isNew, showPending: false, showAll: false, busy: false, gi: 0,
    calcKey: scopeKey(p), lists: {}, fresh: new Set(), tf: {}, stockOut: {},
    ver: 'A', vitems, segs: p.slots.map((x) => ({ id: x.id, start: x.start, end: x.end, version: x.version || 'A' })) };
  if (p.kind === 'window' && p.schedule.mode === 'multi') splitSharedVersions(p);
  renderChrome(); render(); window.scrollTo(0, 0);
  // 2026-10-29 用户:选了就要看到产品 —— 打开时先在后台把每组的产品读出来(之后改规则就能马上算);这一步不改计划内容
  if (!readonly()) for (const g of p.groups) if (g.scope.mode !== 'all') loadGroup(g, { initial: (p.slots[0].items || []).length > 0 }); // 已有 / 复制来的计划:先不重算
}
const P = () => (E.showPending && E.orig?.pendingChange ? { ...E.orig, ...E.orig.pendingChange } : E.plan);
// ---- 一个计划多段时间 + 多个价格(2026-11-03 改价第 3 期)----
// versions = 价格 A / B / C…(同一批产品,每一组给每个价格各定一个规则:A 用 g.rule,其余用 g.vrules[版本]);
// 时间安排 schedule.mode:one 一段时间 / multi 几段时间(E.segs,每段自己的开始、结束、用哪个价格)/ weekly 每周重复(按规则生成几段)。
// 保存时按段展开成执行器的时段(slot.version + 那个价格的全部条目),执行器不用改;两段之间空着 = 回到改价前,两段连着 = 直接换价
const VCOLORS = ['#2f5cff', '#e8710a', '#0b8f5b', '#9b3fd6', '#c0342b', '#5f6b7a'];
const versionsOf = (p) => (p?.versions?.length ? p.versions : [{ id: 'A', name: '' }]);
// 价格的叫法(2026-11-09 用户:到处只写 A / B 看不懂)—— 起了名字就只写名字,没起才写「价格 A」;字母只在内部用
const vName = (p, id) => versionsOf(p).find((x) => x.id === id)?.name || `${p?.schedule?.mode === 'weekly' ? '价格' : '时间段'} ${id}`;
// 按时间段排(2026-11-09 用户:价格总览一列 = 一个时间段):不是每周重复的限时改价,每一段有自己的「价格」(1 段 1 个,名字就是段名)
const segCols = (p = P()) => p.kind === 'window' && schedMode(p) !== 'weekly';
const VIDS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const newVid = (p) => VIDS.find((x) => !versionsOf(p).some((v) => v.id === x));
const vNamed = (p, id) => !!versionsOf(p).find((x) => x.id === id)?.name;
const vDot = (p, id) => `<i class="pr-vdot" style="background:${vColor(p, id)}"></i>`;
// ---- 每个价格自己的设置(2026-11-09 用户:加进 Collection / 产品标签 / 关联活动 / 倒计时都按价格设)----
// 几段时间 / 每周重复时存在 versions[] 上(coll / tagsAdd / tagsRemove / campaign / countdown),保存时展开到用这个价格的每一段;
// 一段时间时还是计划上那一份(和以前一样)
// 2026-11-09 用户:没分段和分了段的界面要一样 → 限时改价一律按价格设(一段时间 = 只有价格 A 一段);永久调价还是计划上那一份
const perPrice = (p = P()) => p.kind === 'window';
const cdBlank = () => ({ on: false, label: '', days: 0, style: 'classic' });
const planSet = (p) => ({ coll: p.slots[0]?.collection || null, tagsAdd: [...(p.tagsAdd || [])], tagsRemove: [...(p.tagsRemove || [])], campaign: p.campaign || null, countdown: clone(p.countdown || cdBlank()) });
// 按时间段 = 一段一个价格:老计划几段共用一个价格的,拆成每段一个(最早那段留原来的编号,已开始的段不受影响;其余照抄规则、设置和手改的价)
function splitSharedVersions(p) {
  ensureVersions(p); const seen = new Set();
  for (const sg of [...E.segs].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) {
    if (!seen.has(sg.version)) { seen.add(sg.version); continue; }
    const src = verOf(sg.version, p); const id = newVid(p); if (!src || !id) continue;
    p.versions.push({ ...clone(src), id, name: src.name ? `${src.name} (${[...p.versions].filter((v) => v.name?.startsWith(src.name)).length + 1})` : '' });
    for (const g of p.groups) (g.vrules ||= {})[id] = clone(ruleOf(g, sg.version));
    E.vitems[id] = tagVer(clone(E.vitems[sg.version] || []), id);
    sg.version = id; seen.add(id);
  }
}
// 确保计划有 versions,而且每个价格都带齐设置(老计划:从计划上那一份 / 这个价格那一段的 Collection 补)
function ensureVersions(p = E.plan) {
  if (!p.versions?.length) p.versions = [{ id: 'A', name: '' }];
  const base = planSet(p);
  for (const v of p.versions) {
    const sl = p.slots.find((x) => (x.version || 'A') === v.id);
    if (v.coll === undefined) v.coll = sl && 'collection' in sl ? sl.collection || null : base.coll;
    if (v.tagsAdd === undefined) v.tagsAdd = sl?.tagsAdd ? [...sl.tagsAdd] : [...base.tagsAdd];
    if (v.tagsRemove === undefined) v.tagsRemove = sl?.tagsRemove ? [...sl.tagsRemove] : [...base.tagsRemove];
    if (v.campaign === undefined) v.campaign = sl && 'campaign' in sl ? sl.campaign || null : base.campaign;
    if (v.countdown === undefined) v.countdown = clone(sl?.countdown || base.countdown);
  }
  return p.versions;
}
// 一个价格的设置写成一句话(摘要 / 列表用)
const vSetSay = (v) => [v.coll && `加进 <b>${esc(v.coll.title)}</b>`, v.tagsAdd?.length && `加标签 <b>${v.tagsAdd.map(esc).join('、')}</b>`, v.tagsRemove?.length && `去掉标签 <b>${v.tagsRemove.map(esc).join('、')}</b>`,
  v.campaign && `关联活动「${esc(v.campaign.name)}」`, v.countdown?.on && `倒计时「${esc(String(v.countdown.label || '').trim() || (CD_STY[v.countdown.style] || CD_STY.classic)[3])}」`].filter(Boolean).join(' · ');
const verOf = (id, p = E.plan) => (p.versions || []).find((x) => x.id === id);
const vColor = (p, id) => VCOLORS[Math.max(0, versionsOf(p).findIndex((x) => x.id === id)) % VCOLORS.length];
const ruleAt = (g, v = 'A') => (v === 'A' || !v ? g.rule : g.vrules?.[v] || g.rule); // 只读,不顺手建 vrules(列表 / 时间轴用)
const ruleOf = (g, v = 'A') => (v === 'A' || !v ? g.rule : ((g.vrules ||= {})[v] ||= clone(g.rule)));
const curV = () => (E && versionsOf(P()).some((v) => v.id === E.ver) ? E.ver : 'A');
const schedMode = (p = P()) => (p.kind !== 'window' ? 'one' : p.schedule?.mode || (p.slots.length > 1 ? 'multi' : 'one'));
const WD = ['', '一', '二', '三', '四', '五', '六', '日'];
// 每周重复 → 一段一段(按英国时间):每天按规则切出时间段,连着的同一个价格合成一段;编号按开始时间和价格定,开始后重新生成不会变
function genWeekly(w) {
  if (!w?.from || !w?.to) return [];
  const out = []; const [y, m, d] = w.from.split('-').map(Number); const last = w.to;
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10); if (day > last) break;
    const wd = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = 周一 … 7 = 周日
    const next = new Date(Date.UTC(y, m - 1, d + i + 1)).toISOString().slice(0, 10);
    for (const r of w.rules || []) {
      if (!(r.days || []).includes(wd)) continue;
      const st = fromInput(`${day}T${r.from || '00:00'}`);
      let en = r.to === '24:00' || !r.to ? fromInput(`${next}T00:00`) : fromInput(`${day}T${r.to}`);
      if (en <= st) en = fromInput(`${next}T${r.to}`); // 结束早于开始 = 跨到第二天
      out.push({ start: st, end: en, version: r.version || 'A' });
    }
  }
  out.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const x of out) { const pv = merged[merged.length - 1]; if (pv && pv.version === x.version && pv.end === x.start) pv.end = x.end; else merged.push({ ...x }); }
  return merged.map((x) => ({ ...x, id: `w${x.start.toString(36)}${x.version}` }));
}
// 现在这份时间安排展开后的几段
function scheduleSegments(p = P()) {
  const m = schedMode(p);
  if (m === 'one') { const s0 = p.slots[0]; return [{ id: s0.id, start: s0.start, end: s0.end, version: 'A' }]; }
  if (m === 'weekly') return genWeekly(p.schedule.weekly);
  return [...(E.segs || [])].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}
// 这一段是不是已经开始了(保存过、开始时间已过)—— 开始了的段锁住
const segStarted = (seg) => !E.isNew && E.orig?.state === 'approved' && (E.orig.slots || []).some((x) => x.id === seg.id && x.start <= now());
const curSlot = () => P().slots[0];
const started = () => !E.isNew && E.orig?.state === 'approved' && E.orig.slots.some((s) => s.start <= now());
const scopeKey = (p) => JSON.stringify([p.groups || [{ scope: p.scope, rule: p.rule }], p.compare, (p.versions || []).map((v) => v.id)]);
const groupsOf = (p) => (p.groups?.length ? p.groups : [{ id: 'g0', scope: p.scope, rule: p.rule }]);
// 组名(2026-11-03 用户:只有第 1、2、3 组看不出是什么)—— 没起名字就叫「第 N 组」
// 2026-11-09 用户:默认叫「分组 1 / 分组 2」(一组 = 一批产品;以前只有一组时叫「改价规则」,容易误会)
const gName = (g, i) => g?.name || `分组 ${i + 1}`;
const G = () => groupsOf(P())[Math.min(E.gi || 0, groupsOf(P()).length - 1)];   // 正在看的那一组
const EG = () => E.plan.groups[Math.min(E.gi || 0, E.plan.groups.length - 1)]; // 正在改的那一组
// 短说法(总览表格子、列表、时间轴用):降 15% / 减 £20 / 逐个填价…
const ruleShort = (r) => { if (!r) return '';
  const v = r.value; const base = { percent_off: `${r.from === 'compare' ? '按划线价' : ''}降 ${v}%`, percent_up: `涨 ${v}%`, amount_off: `${r.from === 'compare' ? '按划线价' : ''}减 £${v}`, manual: '逐个填价', keep: '售价不变', fixed: `统一 £${v}` }[r.mode] || '';
  return `${base}${r.rounding && !['manual', 'keep', 'fixed'].includes(r.mode) ? `,尾数 ${r.rounding === '99' ? '.99' : '取整'}` : ''}`; };
const ruleSay = (r) => `${RULE_MODES[r.mode]?.say(r.value) || ''}${r.rounding ? `,尾数取 ${r.rounding === '99' ? '.99' : '整数'}` : ''}${r.from === 'compare' ? ',按划线价算' : ''}`;
function scopeSayOf(sc) {
  return sc.mode === 'all' ? '全店所有产品'
    : sc.mode === 'collections' ? `Collection ${sc.collections.map((c) => c.title).join('、') || '(还没选)'}`
      : sc.mode === 'products' ? `手选的 ${sc.products.length} 个产品`
        : [sc.vendor && `品牌 ${sc.vendor}`, sc.tag && `标签 ${sc.tag}`, sc.type && `类型 ${sc.type}`].filter(Boolean).join(' + ') || '(还没选条件)';
}
// 加上库存条件的说法(列表、摘要、组标题用)
const scopeSayFull = (sc) => `${scopeSayOf(sc)}${sc.stock === 'uk' && sc.mode !== 'products' ? ' · 只要 UK 仓有货的' : ''}`;
const stale = () => Object.values(E.lists || {}).some((L) => L.status === 'loading') || scopeKey(P()) !== E.calcKey // 产品还在读 / 还没按最新设置算
  || E.plan.groups.some((g) => stockInfo(g).wait > 0); // 「只要有货」的库存还在读
function readonly() {
  if (E.showPending) return true;
  if (E.isNew) return false;
  const s = statusOf(E.orig);
  if (['ended', 'done'].includes(s)) return true;
  if (E.orig.kind === 'permanent' && Object.keys(E.orig.applied || {}).length) return true;
  return started(); // 已经开始改价了:只能改名字和结束时间(和原来那个 app 一样)
}
// 条目属于哪个价格(同一个选项每个价格各一条;「售价不变」/ 逐个填价这类按价格判断要用)
const IVER = (cache.iver ||= new WeakMap());
const tagVer = (arr, ver) => { for (const x of arr || []) IVER.set(x, ver); return arr; };
const opts = (it) => ({ maxDiscountPct: S.settings.maxDiscountPct, version: it ? IVER.get(it) : undefined });
const items = () => (E.vitems?.[curV()] ?? curSlot().items); // 正在看的那个价格的条目
// 同一个选项在每个价格里的条目(划线价对所有价格都一样,一起改)
const sameVariant = (vid) => { const out = Object.values(vItemMaps()).map((m) => m.get(vid)).filter(Boolean);
  if (!out.length) { const it = items().find((i) => i.variantId === vid); if (it) out.push(it); } return [...new Set(out)]; };
// 从所有价格里一起拿掉这些条目(产品清单各价格一样,排除 / 删除对所有价格都算)
function dropItems(test) { for (const k of Object.keys(E.vitems || {})) E.vitems[k] = E.vitems[k].filter((i) => !test(i)); E.plan.slots[0].items = E.vitems.A || E.plan.slots[0].items.filter((i) => !test(i)); }

// ---- 一段大白话摘要(右边那块)----
function summaryHtml() {
  const p = P(); const s = curSlot();
  const its = items(); const ex = new Set(p.excluded || []);
  const segs = schedMode() !== 'one' ? scheduleSegments().filter((x) => x.start != null && x.end != null) : null;
  const live = its.filter((i) => !ex.has(i.variantId));
  const offs = live.flatMap((i) => rowItems(i)).filter((i) => i.price != null).map((i) => core.discountPct(i.refPrice, i.price)); // 几种价格:看所有价格里降得最多的
  const maxOff = offs.length ? Math.max(...offs) : 0;
  const nProd = new Set(live.map((i) => i.productId)).size;
  const mins = Math.max(1, Math.ceil(nProd / 60));
  const gs = groupsOf(p);
  const line = (t) => `<li>${t}</li>`;
  return `<div class="pr-sum">
    <div class="pr-sum__h"><span class="pr-dot" style="background:${esc(p.color)}"></span><b>${esc(p.name || '(还没起名字)')}</b></div>
    <ul>
      ${gs.map((g, i) => line(`${gs.length > 1 || g.name ? `<b>${esc(gName(g, i, gs.length > 1))}</b>:` : ''}${esc(scopeSayFull(g.scope))} · <b>${multiV() ? versionsOf(p).map((v) => `${vDot(p, v.id)}${esc(vName(p, v.id))} ${esc(ruleShort(ruleOf(g, v.id)))}`).join(' / ') : esc(ruleSay(g.rule))}</b>${gs.length > 1 ? ` · ${CMP_SHORT[gCmp(p, g)]}` : ''}`)).join('')}
      ${gs.length > 1 ? line('<span class="muted">同一个产品在几组里时,以排在下面的那组为准</span>') : ''}
      ${segs ? line(segs.length ? `分 <b>${segs.length}</b> 段:<b>${fmtT(Math.min(...segs.map((x) => x.start)))}</b> 开始,<b>${fmtT(Math.max(...segs.map((x) => x.end)))}</b> 结束;${multiV() ? `用 ${new Set(segs.map((x) => x.version)).size} 种价格,` : ''}两段之间空着的时间<b>回到改价前</b>` : '<span class="tx-warn">还没排时间</span>') : line(`<b>${fmtT(s.start)}</b> 开始${p.kind === 'window' ? `,<b>${s.end ? fmtT(s.end) : '(还没设结束时间)'}</b> 结束后<b>售价和划线价都回到改价前</b>` : ',<b>不恢复</b>(永久调价)'}${p.followCampaign ? `(跟随活动「${esc(p.campaign?.name || '')}」,活动改时间它也改)` : ''}`)}
      ${line(`${gs.length > 1 ? '划线价按分组设' : cmpOpts(p).find((o) => o[0] === gCmp(p, gs[0]))?.[1] || '显示原来的划线价'}${(() => { const n = items().filter((i) => i.cmpManual).length; return n ? `,另有 <b>${n}</b> 个选项单独设了划线价` : ''; })()}`)}
      ${p.kind === 'window' && core.prioOf(p) !== core.PRIO_MAX ? line(`优先级 ${core.prioOf(p)}(和别的限时计划改到同一个产品时,数字大的说了算)`) : ''}
      ${p.kind === 'window' && !perPrice() && p.countdown?.on ? line(`产品上显示倒计时「${esc(cdLabel(p))}」${Number(p.countdown.days) ? `,最后 ${Number(p.countdown.days)} 天才显示` : ',一直显示'}`) : ''}
      ${perPrice() ? versionsOf(p).map((v) => { const bits = vSetSay(v); return bits ? line(`${vDot(p, v.id)}<b>${esc(vName(p, v.id))}</b>生效时:${bits}`) : ''; }).join('') : ''}
      ${!perPrice() && p.tagsAdd.length ? line(`生效期间加标签 <b>${p.tagsAdd.map(esc).join('、')}</b>,结束自动去掉`) : ''}
      ${!perPrice() && p.tagsRemove.length ? line(`生效期间去掉标签 <b>${p.tagsRemove.map(esc).join('、')}</b>,结束自动加回`) : ''}
      ${S.approvals ? line(`审批人:<b>${p.approver ? esc(nameOf(p.approver)) : '管理员'}</b>${p.owner ? ` · 负责人 ${esc(nameOf(p.owner))}` : ''}`) : ''}
      ${its.length ? line(`影响 <b>${nProd}</b> 个产品 / <b>${live.length}</b> 个选项${maxOff > 0 ? `,最多降 <b>${maxOff}%</b>` : ''} · 预计 ${mins} 分钟内改完`) : line(`<span class="tx-warn">${stale() ? '正在读产品…' : '还没选产品'}</span>`)}
    </ul>
  </div>${its.length && !stale() ? checkHtml() : ''}`;
}

function editorHtml() {
  const p = P(); const ro = readonly();
  const st = E.isNew ? null : statusOf(E.orig);
  const sl = curSlot();
  const sec = (title, body, hint = '') => `<section class="pr-sec"><div class="pr-sec__h">${title}${hint ? `<span class="muted">${hint}</span>` : ''}</div><div class="pr-sec__b">${body}</div></section>`;
  return `
  <div class="edhead">
    <button class="btn btn-ghost" data-a="close">← 返回</button>
    <b>${E.isNew ? `新建${p.kind === 'permanent' ? '永久调价' : '限时改价'}` : esc(p.name || '改价计划')}</b>
    ${st ? `<span class="tag ${STATUS_TAG[st]}">${core.STATUS_CN[st]}</span>` : '<span class="tag">新计划</span>'}
    ${E.dirty && !ro ? '<span class="tag tag--warn">有未保存的改动</span>' : ''}
    ${!E.isNew ? '<button class="btn btn-sm btn-ghost" data-a="copylink" title="复制这个改价计划的链接,同事点开直接打开这个计划" style="margin-left:auto">🔗 复制链接</button>' : ''}
  </div>
  ${bannersHtml()}
  <div class="pr-grid">
    <div class="pr-main">
      ${sec('名称', `<div class="row">
        <span class="pr-colors">${COLORS.map((c) => `<button type="button" class="pr-color ${p.color === c ? 'is-on' : ''}" style="background:${c}" data-a="color" data-v="${c}" ${ro ? 'disabled' : ''}></button>`).join('')}</span>
        <input class="inp" data-f="name" value="${esc(p.name)}" placeholder="比如:Early Black Friday · 全场 85 折" ${ro ? 'disabled' : ''} style="flex:1;min-width:200px"/></div>
        <label class="pr-fld" style="margin-top:10px">列表分组 <em>计划列表里「我的分组」按它归类(和下面的改价分组无关);随时能改,不影响改价${E.isNew ? '' : '(改了马上生效,不用点保存)'}</em>
          <input class="inp" data-f="folder" list="pr-folders" value="${esc(p.folder || '')}" placeholder="可不填,比如:Black Friday 2026 / 清货 / 日常调价" maxlength="${A.FOLDER_MAX}" ${E.showPending ? 'disabled' : ''} style="max-width:420px"/>
          <datalist id="pr-folders">${foldersAll().map((f) => `<option value="${esc(f)}">`).join('')}</datalist></label>`, '只有后台看得到,顾客看不到')}

      ${sec('改价分组', groupsHtml(ro), '一组 = 选一批产品 + 定一个改价规则;可以分几组,比如 Collection A 打 85 折、品牌 B 打 7 折、几个产品逐个填价。同一个产品出现在好几组时,以<b>排在下面的那组</b>为准 —— 比如第 1 组全场 9 折,第 2 组某个品牌 8 折,这个品牌就是 8 折。')}


      ${p.kind === 'window' ? sec(segCols() ? '改价时间段' : '价格(每周重复)', priceMatrixHtml(ro), segCols()
        ? '一列 = 一个时间段(列头填名字和开始 / 结束),一行 = 一个分组(一批产品),格子里是这一组在这一段怎么改(点格子去上面那一组改)。下面几行是这一段顺便做的事:加进 Collection、加 / 去掉标签、关联活动、倒计时。前后两段连着时直接换价;中间空着的时间回到改价前'
        : '每周重复:一列 = 一个价格,一行 = 一个分组(一批产品);每周哪几天用哪个价格在下面「什么时候生效」里排。下面几行是这个价格生效时顺便做的事') : ''}

      ${sec(p.kind === 'permanent' ? '什么时候执行' : '什么时候生效', `
        <div class="row" style="margin-bottom:10px"><span class="pr-seg">${[['window', '限时(到期回到改价前)'], ['permanent', '永久(到点改,不恢复)']].map(([k, l]) => `<button type="button" class="${p.kind === k ? 'is-on' : ''}" data-a="kind" data-v="${k}" ${ro || started() ? 'disabled' : ''}>${l}</button>`).join('')}</span></div>
        ${p.campaign ? `<label class="row" style="margin-bottom:10px;font-size:13px"><input type="checkbox" data-f="followcamp" ${p.followCampaign ? 'checked' : ''} ${ro ? 'disabled' : ''}/> 跟随活动「${esc(p.campaign.name)}」的时间 <span class="muted">活动改时间,这个计划跟着一起改</span></label>` : ''}
        ${p.kind === 'window' && !p.followCampaign ? schedModeHtml() : ''}
        ${p.kind === 'permanent' ? `        <div class="grid2">
          <label class="pr-fld">开始<input class="inp" type="datetime-local" data-f="start" value="${toInput(sl.start)}" ${ro || started() || p.followCampaign ? 'disabled' : ''}/>${!ro && !started() && !p.followCampaign ? `<button type="button" class="linkbtn" data-a="startnow" style="text-align:left">设成现在(${S.approvals ? '批准' : '保存'}后一分钟内执行)</button>` : ''}</label>
          ${p.kind === 'window' ? `<label class="pr-fld">结束(售价和划线价都回到改价前)<input class="inp" type="datetime-local" data-f="end" value="${toInput(sl.end)}" ${E.showPending || p.followCampaign || (!E.isNew && ['ended', 'done'].includes(statusOf(E.orig))) ? 'disabled' : ''}/><em>${p.followCampaign ? '跟着活动走' : '已经开始的计划也能改结束时间'}</em></label>` : ''}
        </div>` : schedMode() === 'weekly' ? weeklyHtml() : ''}
        ${p.kind === 'window' && (schedMode() === 'weekly' || scheduleSegments().length > 1) ? timelineHtml(scheduleSegments()) : ''}
        ${segCols() ? '<p class="muted" style="margin-top:6px;font-size:13px">每一段的开始 / 结束时间、折扣、加进哪个 Collection、标签、关联活动、倒计时,都在上面「改价时间段」里设。</p>'
          : perPrice() ? '<p class="muted" style="margin-top:10px;font-size:13px">每个价格的折扣、加进哪个 Collection、标签、关联活动、倒计时,在上面「价格」里设。</p>' : ''}
        ${p.kind === 'window' && !perPrice() ? `<div class="pr-fld" style="margin-top:10px">这个时段内把产品加进 Collection <em>带条件的也行(加进它的「单独加入的产品」,不动条件);结束拿掉 app 加的,本来就在 / 你们手动加的不动。Flash 当天那一组常用</em>
          ${sl.collection ? `<div class="row"><span class="tag ${S.goneCollections?.[sl.collection.id] ? 'tag--danger' : 'tag--accent'}">${esc(sl.collection.title)}</span>${ro ? '' : '<button class="linkbtn" data-a="unsetcoll">不加了</button>'}</div>
            ${S.collState?.[sl.collection.id]?.via === 'shared' ? '<div class="note note--sm">这个 Collection 的条件和别的 Collection 共用:单独加产品会连带改到别的 Collection,所以 app 不加,产品照它的条件进出。</div>' : ''}
            ${S.goneCollections?.[sl.collection.id] ? `<div class="note note--warn">这个 Collection ${GONE_WHY[S.goneCollections[sl.collection.id].reason] || GONE_WHY.deleted}(${fmtT(S.goneCollections[sl.collection.id].at)}):价格照常改,只是不再往里加产品。${ro ? '' : '要加进别的 Collection 就点「不加了」再重新选。'}</div>` : ''}`
            : ro ? '<span class="muted">不加</span>' : '<button class="btn btn-sm" data-a="panel" data-p="slotcoll" style="width:fit-content">选 Collection…</button>'}
          ${E.panel === 'slotcoll' ? collPanel('slotcoll') : ''}</div>` : ''}
        ${p.kind === 'window' ? `<label class="pr-fld" style="margin-top:12px">优先级 <em>1–10,默认 10(最高)。只有两个限时计划改到同一个产品、时间又重叠时才用得到:<b>数字大的说了算,一样大时开始晚的说了算</b>(比如黑五期间加一天 Flash,那天自动用 Flash 的价,过了回到黑五的价)。想让这个计划让位就调低</em>
          <input class="inp" type="number" min="1" max="${core.PRIO_MAX}" step="1" data-f="priority" value="${core.prioOf(p)}" ${ro ? 'disabled' : ''} style="width:90px"/></label>` : ''}
      `, '时间一律按英国时间(店铺时区),夏令时自动处理')}

      ${p.kind === 'window' && !perPrice() ? sec('倒计时', cdHtml(p, ro), '产品页和产品卡上倒数到改价结束;比活动的倒计时优先。显示在产品页、搜索页和 Collection 页的产品卡上。同一个产品也在活动里时,<b>活动的徽章照常显示,倒计时换成这个</b>;没改价的产品还是显示活动的倒计时。只给真的在这个价格上的产品(有人在后台手动改过价的不显示),计划结束、暂停、提前结束时自动去掉。') : ''}

      ${perPrice() ? '' : sec('产品标签', `<div class="grid2">
        <div class="pr-fld">生效期间加上 <em>结束自动去掉;产品本来就有的不动</em>${tagChips('tagsAdd', ro)}</div>
        <div class="pr-fld">生效期间去掉 <em>结束自动加回来</em>${tagChips('tagsRemove', ro)}</div></div>
      `, '可不填;用来驱动「按标签自动归类」的 Collection,比如 FlashDeal、TOP DEALS')}

      ${sec(S.approvals ? '负责人与审批' : perPrice() ? '备注' : '关联活动与备注', `<div class="grid2">
        ${S.approvals ? `<label class="pr-fld">负责人<select class="sel" data-f="owner" ${ro ? 'disabled' : ''}><option value="">不指定</option>${S.people.map((u) => `<option value="${u.id}" ${p.owner === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label class="pr-fld">审批人 <em>不指定 = 管理员审批;审批人自己提交直接生效</em><select class="sel" data-f="approver" ${ro ? 'disabled' : ''}><option value="">管理员审批</option>${S.people.map((u) => `<option value="${u.id}" ${p.approver === u.id ? 'selected' : ''}>${esc(u.name)}${u.admin ? '(管理员)' : ''}</option>`).join('')}</select></label>` : ''}
        ${perPrice() ? '' : `<label class="pr-fld">关联活动 <em>关联后在活动页里能看到这次改价</em><select class="sel" data-f="campaign" ${ro ? 'disabled' : ''}><option value="">不关联</option>${(cache.campaigns || []).map((c) => `<option value="${c.id}" ${p.campaign?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${p.campaign && !(cache.campaigns || []).some((c) => c.id === p.campaign.id) ? `<option value="${p.campaign.id}" selected>${esc(p.campaign.name)}</option>` : ''}</select></label>`}
        ${S.approvals ? `<div class="pr-fld">抄送 <em>只通知,不能批准</em><div class="row">${S.people.map((u) => `<label class="row" style="gap:4px;font-size:13px"><input type="checkbox" data-f="cc" value="${u.id}" ${(p.cc || []).includes(u.id) ? 'checked' : ''} ${ro ? 'disabled' : ''}/>${esc(u.name)}</label>`).join('') || '<span class="muted">没有别的能看改价页的成员</span>'}</div></div>` : ''}
      </div>
      <label class="pr-fld" style="margin-top:10px">备注 <em>${S.approvals ? '给审批人看的说明' : '给同事看的说明'}</em><textarea class="inp" rows="2" data-f="note" ${ro ? 'disabled' : ''} placeholder="比如:配合首页 Banner,Flash 每天 0 点换">${esc(p.note || '')}</textarea></label>`)}


    </div>
    <aside class="pr-side">${summaryHtml()}</aside>
  </div>
  <div class="footbar">${footHtml()}</div>`;
}

// ---- 时间安排(一段 / 几段 / 每周重复)和价格版本的界面 ----
const multiV = () => P().kind === 'window' && versionsOf(P()).length > 1;
// 时间安排还能不能改:看别人提交的修改、已结束、永久调价执行了 → 不能;已经开始的计划还能改「以后的段」和进行中那段的结束时间
const schedRO = () => E.showPending || (!E.isNew && (['ended', 'done'].includes(statusOf(E.orig)) || (E.orig.kind === 'permanent' && Object.keys(E.orig.applied || {}).length) || E.orig.stopped));
const verOpts = (cur, dis) => versionsOf(P()).map((v) => `<option value="${v.id}" ${cur === v.id ? 'selected' : ''} ${dis ? 'disabled' : ''}>${esc(vName(P(), v.id))}</option>`).join('');
function schedModeHtml() {
  const m = schedMode(); const lock = schedRO() || started();
  return `<div class="row" style="margin-bottom:10px"><span class="pr-seg">${[['seg', '按时间段'], ['weekly', '每周重复']].map(([k, l]) => `<button type="button" class="${(k === 'weekly') === (m === 'weekly') ? 'is-on' : ''}" data-a="schedmode" data-v="${k === 'seg' ? 'one' : k}" ${lock ? 'disabled' : ''}>${l}</button>`).join('')}</span>
    <span class="tipify">按时间段 = 上面「改价时间段」一列一段,每段自己的时间、折扣、Collection、标签、活动、倒计时。<br>每周重复 = 同一批产品选每周哪几天、几点到几点用哪个价格(比如工作日一个价、周末一个价),自动排出每一段;两段之间空着的时间回到改价前。</span></div>`;
}
function segsHtml() {
  const ro = schedRO(); const segs = scheduleSegments();
  return `<div class="pr-segs"><div class="pr-segs__h"><span>开始</span><span>结束</span><span>用哪个价格</span><span></span></div>
    ${segs.map((sg, i) => { const st = segStarted(sg); const live = st && (sg.end == null || sg.end > now());
      return `<div class="pr-segs__r ${st ? 'is-locked' : ''}"><input class="inp" type="datetime-local" data-f="segstart" data-i="${i}" value="${toInput(sg.start)}" ${ro || st ? 'disabled' : ''}/>
        <input class="inp" type="datetime-local" data-f="segend" data-i="${i}" value="${toInput(sg.end)}" ${ro || (st && !live) ? 'disabled' : ''}/>
        <select class="sel" data-f="segver" data-i="${i}" ${ro || st ? 'disabled' : ''}>${verOpts(sg.version)}</select>
        ${ro || st ? `<span class="muted">${live ? '进行中' : st ? '已过' : ''}</span>` : `<button type="button" class="linkbtn" data-a="segdel" data-i="${i}" ${segs.length < 2 ? 'disabled' : ''}>删除</button>`}</div>`; }).join('')}
    ${ro ? '' : '<button type="button" class="btn btn-sm" data-a="segadd" style="margin-top:6px">＋ 加一段</button>'}</div>`;
}
function weeklyHtml() {
  const ro = schedRO(); const lock = ro || started(); const w = P().schedule.weekly || { rules: [] };
  return `<div class="pr-week">
    <div class="row"><label class="pr-fld">从哪天<input class="inp" type="date" data-f="wfrom" value="${esc(w.from || '')}" ${lock ? 'disabled' : ''}/></label>
      <label class="pr-fld">到哪天(含这一天)<input class="inp" type="date" data-f="wto" value="${esc(w.to || '')}" ${ro ? 'disabled' : ''}/></label></div>
    ${(w.rules || []).map((r, i) => `<div class="pr-week__r">
      <span class="pr-days">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<button type="button" class="${(r.days || []).includes(d) ? 'is-on' : ''}" data-a="wday" data-r="${i}" data-d="${d}" ${lock ? 'disabled' : ''}>${WD[d]}</button>`).join('')}</span>
      <input class="inp inp--time" type="time" data-f="wrfrom" data-r="${i}" value="${esc(r.from || '00:00')}" ${lock ? 'disabled' : ''}/><span class="muted">到</span>
      <input class="inp inp--time" data-f="wrto" data-r="${i}" value="${esc(r.to || '24:00')}" placeholder="24:00" ${lock ? 'disabled' : ''} title="24:00 = 一整天"/>
      <select class="sel" data-f="wrver" data-r="${i}" ${lock ? 'disabled' : ''}>${verOpts(r.version || 'A')}</select>
      ${lock ? '' : `<button type="button" class="linkbtn" data-a="wrdel" data-r="${i}" ${(w.rules || []).length < 2 ? 'disabled' : ''}>删除</button>`}</div>`).join('')}
    ${lock ? '' : '<button type="button" class="btn btn-sm" data-a="wradd">＋ 加一条</button>'}
    ${started() && !ro ? '<p class="muted">计划已经开始:每周的规则锁住了,只能改「到哪天」。</p>' : ''}</div>`;
}
// 时间条:每一段一块颜色(价格 A 蓝、B 橙…),灰 = 回到改价前
function timelineHtml(segs) {
  const ok = segs.filter((x) => x.start != null && x.end != null && x.end > x.start);
  if (!ok.length) return '';
  const t0 = Math.min(...ok.map((x) => x.start)), t1 = Math.max(...ok.map((x) => x.end)); const span = t1 - t0 || 1;
  const p = P(); const used = [...new Set(ok.map((x) => x.version))];
  const days = Math.round(span / DAY);
  return `<div class="pr-tl">
    <div class="pr-tl__bar">${ok.map((x) => `<span class="pr-tl__seg" style="left:${((x.start - t0) / span) * 100}%;width:${((x.end - x.start) / span) * 100}%;background:${vColor(p, x.version)}" title="${esc(vName(p, x.version))} · ${fmtT(x.start)} → ${fmtT(x.end)}"></span>`).join('')}</div>
    <div class="pr-tl__ends"><span>${fmtT(t0)}</span><span>${days ? `共 ${days} 天 · ` : ''}${ok.length} 段</span><span>${fmtT(t1)}</span></div>
    <div class="pr-tl__leg">${used.map((v) => `<span><i style="background:${vColor(p, v)}"></i>${esc(vName(p, v))}</span>`).join('')}<span><i class="is-gap"></i>空着 = 回到改价前</span></div>
    ${segs.some((x) => x.start != null && x.end != null && x.end <= x.start) ? '<div class="note note--warn note--sm">有一段的结束时间早于开始时间,检查一下</div>' : ''}
  </div>`;
}
// 价格总览表(2026-11-09 用户选的,替换原来那排 A / B 切换):一行一组、一列一个价格,格子里写这一组在这个价格下怎么改;
// 点格子 = 打开那一组、切到那个价格去改。列头就是价格的名字(直接改)。只有一种价格时只显示一条「＋ 加一个价格」;一段时间时不显示
function priceMatrixHtml(ro) {
  const p = P();
  if (p.kind !== 'window') return '';
  if (p === E.plan) ensureVersions(p); // 一段时间也一样:价格 A 一列(2026-11-09 用户:两种界面统一)
  let vs = versionsOf(p); const cv = curV(); const gs = groupsOf(p); const gi = Math.min(E.gi || 0, gs.length - 1);
  const sc = segCols(p);
  const add = ro || p.followCampaign || vs.length >= A.MAX_VERSIONS || (!sc && started()) ? ''
    : sc ? '<button type="button" class="pr-ver pr-ver--add" data-a="coladd" title="接在最后一段后面加一段,有自己的折扣和设置">＋ 加一段</button>'
      : '<button type="button" class="pr-ver pr-ver--add" data-a="vadd">＋ 加一个价格</button>';
  const segs = scheduleSegments(p); const used = (id) => segs.filter((x) => x.version === id).length;
  if (sc) vs = segs.map((sg) => vs.find((v) => v.id === sg.version)).filter((v, k, arr) => v && arr.indexOf(v) === k); // 按时间段:列按开始时间排,一段一列
  const ex = new Set(p.excluded || []);
  const todoOf = (g, v) => (E.vitems?.[v] || []).filter((it) => it.group === g.id && needsPrice(p, it) && !ex.has(it.variantId)).length;
  const sro = schedRO(); // 设置(Collection / 标签 / 活动 / 倒计时)开始后也能改以后的段 —— 跟着时间安排的只读走
  const tagCell = (v, key) => `<div class="pr-vmx__tags">${(v[key] || []).map((t, i) => `<span class="tag">${esc(t)}${sro ? '' : `<button type="button" class="chip__x" data-a="rmtag" data-k="v:${v.id}:${key}" data-i="${i}">✕</button>`}</span>`).join('') || (sro ? '<span class="muted">—</span>' : '')}
    ${sro ? '' : `<input class="inp inp--sm" data-addtag="v:${v.id}:${key}" placeholder="输入标签,回车"/>`}</div>`;
  const collCell = (v) => (v.coll ? `<span class="tag ${S.goneCollections?.[v.coll.id] ? 'tag--danger' : 'tag--accent'}">${esc(v.coll.title)}${sro ? '' : `<button type="button" class="chip__x" data-a="vcollx" data-v="${v.id}" title="不加了">✕</button>`}</span>`
    : sro ? '<span class="muted">不加</span>' : `<button type="button" class="btn btn-xs" data-a="panel" data-p="slotcoll" data-v="${v.id}">选 Collection…</button>`);
  const campCell = (v) => (sro ? (v.campaign ? esc(v.campaign.name) : '<span class="muted">不关联</span>')
    : `<select class="sel sel--sm" data-f="vcamp" data-v="${v.id}"><option value="">不关联</option>${(cache.campaigns || []).map((c) => `<option value="${c.id}" ${v.campaign?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${v.campaign && !(cache.campaigns || []).some((c) => c.id === v.campaign.id) ? `<option value="${v.campaign.id}" selected>${esc(v.campaign.name)}</option>` : ''}</select>`);
  const cdCell = (v) => { const c = v.countdown || cdBlank(); const sty = CD_STY[c.style] ? c.style : 'classic';
    return `<label class="row" style="gap:6px;font-size:13px"><input type="checkbox" data-f="vcdon" data-v="${v.id}" ${c.on ? 'checked' : ''} ${sro ? 'disabled' : ''}/>显示</label>
      ${c.on ? `<input class="inp inp--sm" data-f="vcdlabel" data-v="${v.id}" maxlength="60" value="${esc(c.label || '')}" placeholder="${esc(CD_STY[sty][3])}" ${sro ? 'disabled' : ''} style="margin-top:4px"/>
        <div class="row" style="gap:4px;margin-top:4px"><select class="sel sel--sm" data-f="vcddays" data-v="${v.id}" ${sro ? 'disabled' : ''}>${CD_DAYS_CN.map(([d, l]) => `<option value="${d}" ${Number(c.days || 0) === d ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="sel sel--sm" data-f="vcdstyle" data-v="${v.id}" ${sro ? 'disabled' : ''}>${Object.entries(CD_STY).map(([k, x]) => `<option value="${k}" ${sty === k ? 'selected' : ''}>${x[0]}</option>`).join('')}</select></div>` : ''}`; };
  // 列头:按时间段 = 名字 + 开始 / 结束(一段时间时改的是计划那一段,几段时改那一段);每周重复 = 名字 + 用在几段
  const colHead = (v) => {
    const nameInp = ro ? `<b>${esc(vName(p, v.id))}</b>` : `<input class="inp inp--sm ${vNamed(p, v.id) ? '' : 'is-unnamed'}" data-f="vname" data-v="${v.id}" value="${esc(v.name || '')}" placeholder="${sc ? '给这一段起名,比如 预热 / Flash 日' : '给这个价格起名,比如 周末价'}" maxlength="20"/>`;
    if (!sc) {
      return `<div class="pr-vmx__vh">${vDot(p, v.id)}${nameInp}${!ro && v.id !== 'A' ? `<button type="button" class="chip__x" data-a="vdel" data-v="${v.id}" title="删掉这个价格">✕</button>` : ''}</div>
        <div class="pr-vmx__use ${used(v.id) ? '' : 'tx-warn'}">${used(v.id) ? `用在 ${used(v.id)} 段` : '还没有哪段用它'}</div>`;
    }
    const one = schedMode(p) === 'one'; const i = segs.findIndex((x) => x.version === v.id); const sg = segs[i] || {};
    const tro = schedRO(); const st = !one && segStarted(sg); const live = st && (sg.end == null || sg.end > now());
    const startDis = one ? ro || started() || p.followCampaign : tro || st;
    const endDis = one ? E.showPending || p.followCampaign || (!E.isNew && ['ended', 'done'].includes(statusOf(E.orig))) : tro || (st && !live);
    const fS = one ? 'data-f="start"' : `data-f="segstart" data-i="${i}"`; const fE = one ? 'data-f="end"' : `data-f="segend" data-i="${i}"`;
    return `<div class="pr-vmx__vh">${vDot(p, v.id)}${nameInp}${!one && !tro && !st && segs.length > 1 ? `<button type="button" class="chip__x" data-a="coldel" data-v="${v.id}" title="删掉这一段">✕</button>` : ''}</div>
      <div class="pr-vmx__time"><label>开始<input class="inp inp--sm" type="datetime-local" ${fS} value="${toInput(sg.start)}" ${startDis ? 'disabled' : ''}/></label>
        <label>结束<input class="inp inp--sm" type="datetime-local" ${fE} value="${toInput(sg.end)}" ${endDis ? 'disabled' : ''}/></label>
        ${one && !startDis ? `<button type="button" class="linkbtn" data-a="startnow" style="text-align:left">开始设成现在</button>` : ''}
        ${i === segs.length - 1 ? '<span class="pr-vmx__back">↩ 结束后售价和划线价回到改价前</span>' : segs[i + 1] && sg.end != null && segs[i + 1].start > sg.end ? '<span class="pr-vmx__back">↩ 到下一段开始前先回到改价前</span>' : ''}
        ${!one && live ? '<span class="tag tag--ok">进行中</span>' : !one && st ? '<span class="muted">已过</span>' : ''}${p.followCampaign ? '<span class="muted">跟着活动走</span>' : ''}</div>`;
  };
  const setRow = (label, tip, cell) => `<tr class="pr-vmx__set"><th class="pr-vmx__g">${label}${tip ? `<span class="tipify">${tip}</span>` : ''}</th>${vs.map((v) => `<td class="${v.id === cv ? 'is-curcol' : ''}">${cell(v)}</td>`).join('')}</tr>`;
  return `<div class="pr-vmx">
    <div class="pr-vmx__h"><span class="muted">${sc ? (segs.length > 1 ? `${segs.length} 个时间段 · ${fmtT(Math.min(...segs.map((x) => x.start ?? Infinity)))} → ${segs.some((x) => x.end) ? fmtT(Math.max(...segs.map((x) => x.end || 0))) : '?'}` : '一个时间段;不同时间段用不同的折扣 / 设置就「＋ 加一段」')
      : `${vs.length} 个价格 · 每周哪几天用哪个,在下面「什么时候生效」里排`}</span>${add}</div>
    <div class="tblwrap"><table class="pr-vmx__t"><thead><tr><th class="pr-vmx__g">分组 ↓ · ${sc ? '时间段' : '价格'} →</th>${vs.map((v) => `<th class="${v.id === cv ? 'is-cur' : ''}">${colHead(v)}</th>`).join('')}</tr></thead>
      <tbody>${gs.map((g, i) => `<tr class="${i === gi ? 'is-open' : ''}"><th class="pr-vmx__g"><div class="pr-vmx__gn"><span class="pr-group__no">${i + 1}</span>${esc(gName(g, i, gs.length > 1))}</div><div class="pr-vmx__gs">${esc(scopeSayFull(g.scope))}</div></th>
        ${vs.map((v) => { const n = todoOf(g, v.id); return `<td class="pr-vmx__c ${i === gi && v.id === cv ? 'is-cur' : ''}" data-a="vcell" data-i="${i}" data-v="${v.id}" title="改「${esc(gName(g, i, gs.length > 1))}」在「${esc(vName(p, v.id))}」下的价">${esc(ruleShort(ruleAt(g, v.id)))}${n ? `<div><span class="tag tag--warn">${n} 个没填价</span></div>` : ''}</td>`; }).join('')}</tr>`).join('')}
      ${setRow('加进 Collection', '这个价格生效期间把这批产品加进这个 Collection(带条件的也行,加进它的「单独加入的产品」,不动条件);换到别的价格或结束时拿掉 app 加的,本来就在的不动。Flash 那一段常用', collCell)}
      ${setRow('加标签', '这个价格生效期间给产品加上的标签,换价 / 结束自动去掉;产品本来就有的不动。用来驱动按标签自动归类的 Collection', (v) => tagCell(v, 'tagsAdd'))}
      ${setRow('去掉标签', '这个价格生效期间去掉的标签,换价 / 结束自动加回来', (v) => tagCell(v, 'tagsRemove'))}
      ${setRow('关联活动', '关联后在活动页里能看到这次改价', campCell)}
      ${setRow('倒计时', '产品页 / 产品卡上倒数到<b>这一段</b>结束,比活动的倒计时优先(活动的徽章照常显示)', cdCell)}
      </tbody></table></div>
    ${E.panel === 'slotcoll' && E.panelVer ? `<div style="margin-top:8px"><div class="muted" style="font-size:12px;margin-bottom:4px">给「${esc(vName(p, E.panelVer))}」选 Collection</div>${collPanel('slotcoll')}</div>` : ''}
  </div>`;
}
// 打开的那一组里「改什么价」旁边的价格切换(看的是哪个价格一目了然)
const verTabsHtml = () => (multiV() ? `<span class="pr-vtabs">${versionsOf(P()).map((v) => `<button type="button" class="pr-ver pr-ver--sm ${curV() === v.id ? 'is-on' : ''}" data-a="vpick" data-v="${v.id}">${vDot(P(), v.id)}${esc(vName(P(), v.id))}</button>`).join('')}</span>` : '');

function ruleHtml(ro) {
  const p = P(); const r = ruleOf(G(), curV()); const rm = RULE_MODES[r.mode] || RULE_MODES.percent_off;
  return `<div class="pr-radios">${Object.entries(RULE_MODES).filter(([k]) => k !== 'percent_up' || p.kind === 'permanent').map(([k, m]) => `
      <label class="pr-radio ${r.mode === k ? 'is-on' : ''}"><input type="radio" name="rmode" value="${k}" ${r.mode === k ? 'checked' : ''} ${ro ? 'disabled' : ''}/><span>${m.label}</span></label>`).join('')}</div>
    ${['keep', 'manual'].includes(r.mode) ? '' : `<div class="row" style="margin-top:10px">
      <input class="inp" type="number" step="0.01" min="0" data-f="rvalue" value="${esc(r.value)}" style="width:120px" ${ro ? 'disabled' : ''}/><span class="pr-unit">${rm.unit}</span>
      ${r.mode === 'fixed' ? '' : `<span class="muted">尾数</span><select class="sel" data-f="rrounding" ${ro ? 'disabled' : ''}><option value="" ${!r.rounding ? 'selected' : ''}>不取整</option><option value="99" ${r.rounding === '99' ? 'selected' : ''}>.99</option><option value="00" ${r.rounding === '00' ? 'selected' : ''}>整数</option></select>`}
      ${['percent_off', 'amount_off'].includes(r.mode) ? `<span class="muted">按</span><select class="sel" data-f="rfrom" ${ro ? 'disabled' : ''}><option value="price" ${r.from !== 'compare' ? 'selected' : ''}>现售价</option><option value="compare" ${r.from === 'compare' ? 'selected' : ''}>划线价(RRP)</option></select><span class="muted">算</span>` : ''}
    </div>`}
    <p class="pr-say">${multiV() ? `${vDot(p, curV())}<b>${esc(vName(p, curV()))}</b>:` : ''}${rm.say(r.value)}${r.mode === 'manual' ? ':在这一组下面「产品和新价」的表格里一个个填' : ''}。</p>`;
}
function groupsHtml(ro) {
  const gs = groupsOf(P()); const gi = Math.min(E.gi || 0, gs.length - 1);
  const its = items(); const ex = new Set(P().excluded || []);
  const multi = gs.length > 1;
  return `<div class="pr-groups">${gs.map((g, i) => {
    const open = i === gi;
    const mine = its.filter((it) => it.group === g.id);
    const todo = P().kind === 'window' ? (multiV() ? versionsOf(P()).map((v) => (E.vitems?.[v.id] || [])) : [mine]).flat().filter((it) => it.group === g.id && needsPrice(P(), it) && !ex.has(it.variantId)).length : 0;
    const hit = E.groupHits?.[g.id]; const over = hit != null ? hit - mine.length : 0; // 选中但被下面的组覆盖的
    return `<div class="pr-group ${open ? 'is-open' : ''}">
      <div class="pr-group__h" data-a="gopen" data-i="${i}">
        <span class="pr-group__no">${i + 1}</span>
        <span class="pr-group__n">${esc(gName(g, i, multi))}</span>
        <span class="pr-group__s">${esc(scopeSayFull(g.scope))} · <b>${multiV() ? versionsOf(P()).map((v) => `<span class="pr-gv">${vDot(P(), v.id)}${esc(vName(P(), v.id))} ${esc(ruleShort(ruleAt(g, v.id)))}</span>`).join(' / ') : esc(ruleSay(ruleOf(g, curV())))}</b> · ${CMP_SHORT[gCmp(P(), g)] || ''}${mine.length ? ` <span class="muted">· ${new Set(mine.map((x) => x.productId)).size} 个产品 / ${mine.length} 个选项</span>` : ''}${todo ? ` <span class="tag tag--warn">${todo} 个没填价</span>` : ''}</span>
        ${open ? '' : '<span class="pr-group__go">点开修改</span>'}
        ${ro || !multi ? '' : `<span class="pr-group__acts">
          <button type="button" class="btn btn-ghost btn-xs" data-a="gup" data-i="${i}" ${i ? '' : 'disabled'} title="上移">↑</button>
          <button type="button" class="btn btn-ghost btn-xs" data-a="gdown" data-i="${i}" ${i < gs.length - 1 ? '' : 'disabled'} title="下移">↓</button>
          <button type="button" class="btn btn-ghost btn-xs" data-a="gdel" data-i="${i}" title="删掉这一组">删除</button></span>`}
      </div>
      ${open ? `<div class="pr-group__b">
        <label class="pr-fld pr-group__name">这一组的名字 <em>可不填;起个名字一眼看出这组是哪批产品,比如「Leaplight 清货」「Sunnylife 新品」${multiV() ? '。工作日 / 周末这种是「价格」,在下面「价格总览」的列头起名' : ''}</em>
          <input class="inp" data-f="gname" value="${esc(g.name || '')}" maxlength="30" placeholder="分组 ${i + 1}" ${ro ? 'disabled' : ''}/></label>
        <div class="pr-group__lab">改哪些产品</div>${scopeHtml(ro)}
        <div class="pr-group__lab">改什么价${verTabsHtml()}</div>${ruleHtml(ro)}
        <div class="pr-group__lab">划线价 <span class="muted">这一组改价期间前台显示的划线价;限时计划结束时售价和划线价一起恢复原样</span></div>${cmpHtml(ro, g)}
        <div class="pr-group__lab">产品和新价 <span class="muted">${ro ? '这一组的产品和新价' : '选了产品马上列出来,改规则自动刷新;手改的价格、去掉的产品都会保留。<br>新价可以<b>一个个直接改</b>(标「手改」,点「用规则价」恢复)。划线价也能<b>单独例外</b>:灰字是按上面方式算出来的;填数字 = 这个选项用这个划线价,填 0 = 不显示,清空 = 回到上面的方式(标「例外」)'}</span></div>
        ${groupListHtml(ro, g, mine, over)}
      </div>` : ''}
    </div>`;
  }).join('')}</div>
  ${ro ? '' : `<button class="pr-gadd" type="button" data-a="gadd">＋ 再加一组<span>另一批产品用另一个改价规则,比如 A 牌子 85 折、B 牌子逐个填价</span></button>`}`;
}

// 标签清单:计划上的(tagsAdd / tagsRemove)或某个价格的(v:B:tagsAdd)
const tagList = (k) => { if (!E) return null; if (k.startsWith('v:')) { const [, id, key] = k.split(':'); const v = verOf(id); return v ? (v[key] ||= []) : null; } return (E.plan[k] ||= []); };
function tagChips(key, ro) {
  const list = P()[key] || [];
  return `<div class="row" style="gap:4px;flex-wrap:wrap;margin-top:4px">${list.map((t, i) => `<span class="tag">${esc(t)}${ro ? '' : `<button type="button" class="chip__x" data-a="rmtag" data-k="${key}" data-i="${i}">✕</button>`}</span>`).join('')}
    ${ro ? '' : `<input class="inp" data-addtag="${key}" placeholder="输入标签,回车添加" style="width:170px"/>`}</div>`;
}

function scopeHtml(ro) {
  const sc = G().scope;
  const tab = (k) => `<button type="button" class="${sc.mode === k ? 'is-on' : ''}" data-a="smode" data-v="${k}" ${ro ? 'disabled' : ''}>${SCOPE_MODES[k]}</button>`;
  let body = '';
  if (sc.mode === 'collections') {
    body = `<div class="row">${sc.collections.map((c, i) => `<span class="tag tag--accent">${esc(c.title)}${ro ? '' : `<button type="button" class="chip__x" data-a="rmcoll" data-i="${i}">✕</button>`}</span>`).join('') || '<span class="muted">还没选 Collection</span>'}
      ${ro ? '' : '<button class="btn btn-sm" data-a="panel" data-p="coll">选 Collection…</button>'}</div>${E.panel === 'coll' ? collPanel('coll') : ''}`;
  } else if (sc.mode === 'products') {
    body = `<div class="row">${sc.products.length ? `<span class="tag tag--accent">已选 ${sc.products.length} 个产品${sc.products.some((x) => x.variants?.length) ? `(${sc.products.filter((x) => x.variants?.length).length} 个只选了部分选项)` : ''}</span>${ro ? '' : '<button class="linkbtn" data-a="clearprod">清空</button>'}` : '<span class="muted">还没选产品</span>'}
      ${ro ? '' : '<button class="btn btn-sm" data-a="pick">选产品</button>'}</div>
      ${sc.products.length ? `<div class="pr-picked">${sc.products.slice(0, 12).map((x) => `<span class="pr-picked__i" title="${esc(x.title)}">${x.image ? `<img src="${esc(x.image)}" alt="">` : ''}</span>`).join('')}${sc.products.length > 12 ? `<span class="muted">…共 ${sc.products.length} 个</span>` : ''}</div>` : ''}`;
  } else if (sc.mode === 'search') {
    body = `<div class="grid2">
      <label class="pr-fld">品牌 <em>品牌、标签、类型填几项,就要同时满足几项</em><input class="inp" data-f="svendor" list="pr-vendors" value="${esc(sc.vendor || '')}" placeholder="如 TILTA" ${ro ? 'disabled' : ''}/><datalist id="pr-vendors">${(cache.vendors || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist></label>
      <label class="pr-fld">标签<input class="inp" data-f="stag" value="${esc(sc.tag || '')}" placeholder="如 New Gear" ${ro ? 'disabled' : ''}/></label>
      <label class="pr-fld">产品类型<input class="inp" data-f="stype" value="${esc(sc.type || '')}" placeholder="如 Cine Lens" ${ro ? 'disabled' : ''}/></label></div>`;
  } else {
    body = '<p class="muted">全店所有产品都会被改价。产品多的话执行会慢一些(摘要里有预计时间);下面点「读出全店产品」先看看每个产品的新价。</p>';
  }
  // 2026-11-03 用户:清货只给有货的打折 —— 按选项看 UK 仓的 Available;指定产品是自己点选的,不自动筛(表格上有「删除没货的」)
  const stockRow = sc.mode === 'products' ? '' : `<div class="pr-stockf"><span class="pr-stockf__l">库存</span>
      <span class="pr-seg pr-seg--sm"><button type="button" class="${sc.stock !== 'uk' ? 'is-on' : ''}" data-a="sstock" data-v="" ${ro ? 'disabled' : ''}>全部选项</button><button type="button" class="${sc.stock === 'uk' ? 'is-on' : ''}" data-a="sstock" data-v="uk" ${ro ? 'disabled' : ''}>只要 UK 仓有货的</button></span>
      <em class="muted">按选项算(没货的颜色 / 卡口不改价);按现在的库存选,保存后清单就固定了</em></div>`;
  return `<div class="pr-seg pr-seg--wrap" style="margin-bottom:10px">${Object.keys(SCOPE_MODES).map(tab).join('')}</div>${body}${stockRow}
    ${P().campaign && !ro ? `<button type="button" class="btn btn-sm" data-a="fromcamp" style="margin-top:8px">用活动「${esc(P().campaign.name)}」圈定的产品</button>` : ''}`;
}

// 一组的产品区:读取状态 → £0 提醒 → 工具条(数量 / 筛选 / 搜索 / 重新读)→ 表格 → 已去掉的
const needsPrice = (p, i) => p.kind === 'window' && i.price == null && core.ruleModeOf(p, i, IVER.get(i)) !== 'keep'; // 限时计划要填新价(「售价不变」那组不用)
const itemBad = (p, i) => needsPrice(p, i) || core.itemWarnings(p, i, opts(i)).length > 0;
function groupListHtml(ro, g, mine, over) {
  const p = P(); const L = E.lists?.[g.id]; const sc = g.scope;
  if (!ro && sc.mode === 'all' && !C.all && L?.status !== 'loading') {
    return `<div class="pr-load"><button class="btn btn-sm btn-primary" data-a="loadall">读出全店产品</button><span class="muted">全店几千个产品,要等半分钟左右</span></div>${mine.length ? previewHtml(ro, g.id) : ''}`;
  }
  const head = L?.status === 'loading' ? '<div class="pr-load"><span class="pr-spin"></span>正在从店里读这一组的产品…</div>'
    : L?.status === 'err' ? `<div class="banner banner--danger" style="margin-top:6px">读不到产品:${esc(L.err)} <button class="btn btn-sm" data-a="reload" data-g="${g.id}">重试</button></div>` : '';
  if (!mine.length) {
    const why = L?.status === 'loading' ? '' : stockInfo(g).wait ? '正在读 UK 仓库存…' : scopeEmpty(sc) ? '在上面选好产品,这里马上列出来。' : over > 0 ? '这一组的产品全被下面的组接手了(同一个产品以排在下面的组为准)。' : L?.status === 'ok' ? '这一组没有产品。' : '';
    return head + (why ? `<p class="muted" style="margin-top:6px">${why}</p>` : '') + removedHtml(ro, g);
  }
  const tf = E.tf?.[g.id] || {}; const q = (tf.q || '').trim().toLowerCase();
  const nBad = mine.filter((i) => rowBad(p, i)).length; const nMan = mine.filter((i) => rowMan(i)).length;
  const zero = mine.filter((i) => !(Number(i.refPrice) > 0)).length;
  const keep = (i) => (!q || `${i.product} ${i.variant || ''} ${i.sku || ''}`.toLowerCase().includes(q))
    && (tf.only === 'bad' ? rowBad(p, i) : tf.only === 'man' ? rowMan(i) : true);
  const chip = (v, label, n) => `<button type="button" class="pr-chipf ${(tf.only || '') === v ? 'is-on' : ''}" data-a="tfilter" data-g="${g.id}" data-v="${v}">${label}${n != null ? ` <b>${n}</b>` : ''}</button>`;
  const fill = !ro && gCmp(p, g) === 'set' ? `<div class="pr-fill">一键填划线价 = 现价的 <input class="inp inp--xs" id="fillpct-${g.id}" type="number" min="101" step="1" value="120" style="width:70px"/> %
      <button type="button" class="btn btn-sm" data-a="fillcmp" data-g="${g.id}">填上</button><span class="muted">${ruleOf(g, curV()).mode === 'keep' ? '售价不变、划线价调高 = 虚拟折扣;' : ''}填完还能在表格里一个个改</span></div>` : '';
  const stkErr = STK.err ? `<div class="banner banner--warn" style="margin-top:6px">读不到 UK 仓库存:${esc(STK.err)} <button class="btn btn-sm" data-a="stkretry">重试</button></div>` : '';
  return `${head}${stkErr}${fill}
    ${zero && !ro ? `<div class="banner banner--warn" style="margin-top:6px">有 <b>${zero}</b> 个选项现价是 £0(多半是询价 / 还没定价的产品),改不了价,不${isPick(g) ? '删除' : '排除'}就存不了。<button class="btn btn-sm" data-a="rmzero" data-g="${g.id}" style="margin-left:8px">${isPick(g) ? '删除' : '排除'}这 ${zero} 个</button></div>` : ''}
    <div class="pr-tbar">
      <span class="pr-tbar__n">${new Set(mine.map((i) => i.productId)).size} 个产品 / ${mine.length} 个选项${over > 0 ? ` <span class="muted">· 另有 ${over} 个也在下面的组里,按下面那组的价</span>` : ''}${(() => { if (sc.stock !== 'uk' || isPick(g)) return ''; const so = stockInfo(g);
        return ` <span class="muted">· 没货不改价的 ${so.out} 个${so.wait ? `,还有 ${so.wait} 个在读库存…` : ''}</span>`; })()}</span>
      ${!ro && isPick(g) ? (() => { const n = mine.filter((i) => noStock(stockOf(i.variantId))).length; return n ? `<button type="button" class="btn btn-sm" data-a="rmnostock" data-g="${g.id}" title="UK 仓 Available ≤ 0 的选项从选的清单里删掉">删除没货的 ${n} 个选项</button>` : ''; })() : ''}
      <span class="pr-chipfs">${chip('', '全部')}${chip('bad', '有问题', nBad)}${chip('man', '手改过', nMan)}</span>
      <input class="inp inp--sm" data-tq="${g.id}" placeholder="找产品 / SKU" value="${esc(tf.q || '')}" style="width:170px"/>
      ${ro ? '' : `<button type="button" class="linkbtn" data-a="reload" data-g="${g.id}" title="店里刚改过产品或价格时用">从店里重新读</button>`}
    </div>
    ${previewHtml(ro, g.id, keep)}
    ${removedHtml(ro, g)}`;
}
// 去掉的变体:折起来,能一个个 / 全部恢复
function removedHtml(ro, g) {
  if (isPick(g)) return ''; // 指定产品模式是直接删除,没有「已排除」
  const rm = g.removed || []; if (!rm.length) return '';
  const names = new Map(); for (const pr of E.lists?.[g.id]?.products || []) for (const v of pr.variants) names.set(v.id, `${pr.title}${v.title && v.title !== 'Default Title' ? ' · ' + v.title : ''}`);
  return `<details class="pr-removed" data-rmg="${g.id}" ${E.rmOpen?.[g.id] ? 'open' : ''}><summary>已排除 ${rm.length} 个选项 <span class="muted">(这些不改价${ro ? '' : ';点开可以恢复'})</span></summary>
    <div class="pr-removed__b">${rm.slice(0, 60).map((id) => `<span class="tag">${esc(names.get(id) || '(名字还没读到)')}${ro ? '' : `<button type="button" class="chip__x" data-a="unrm" data-g="${g.id}" data-v="${esc(id)}" title="恢复">↺</button>`}</span>`).join('')}
      ${rm.length > 60 ? `<span class="muted">…共 ${rm.length} 个</span>` : ''}${ro ? '' : `<button type="button" class="linkbtn" data-a="unrm" data-g="${g.id}">全部恢复</button>`}</div></details>`;
}
// ---- UK 仓库存(2026-11-03 用户)----
// 读 Shopify 里 UK 仓(Cinegearpro)的 Available,按款式小批量问服务器;读过的这次打开页面里不再读(「从店里重新读」会刷新)
const STK = (cache.stk ||= { map: new Map(), queue: new Set(), busy: false, loc: null, err: '', waiters: [] });
const stockOf = (id) => (STK.map.has(id) ? STK.map.get(id) : undefined); // undefined = 还没读到;null = 这个选项不追踪库存
const noStock = (n) => n !== undefined && n !== null && n <= 0;
function wantStock(ids) {
  for (const id of ids) if (!STK.map.has(id)) STK.queue.add(id);
  if (STK.queue.size && !STK.busy && !STK.err) pumpStock();
}
async function pumpStock() {
  STK.busy = true;
  while (STK.queue.size) {
    const batch = [...STK.queue].slice(0, 250);
    try {
      const d = await api('POST', '/api/price/catalog/stock', { ids: batch });
      STK.loc = d.location;
      for (const id of batch) { STK.map.set(id, Object.prototype.hasOwnProperty.call(d.stock, id) ? d.stock[id] : 0); STK.queue.delete(id); }
    } catch (e) { STK.err = e.message || '读不到库存'; STK.queue.clear(); break; }
  }
  STK.busy = false;
  STK.waiters.splice(0).forEach((f) => f());
  if (E) { if (!readonly() && E.plan.groups.some((g) => g.scope.stock === 'uk')) recompute(); render(); }
}
// 等这些选项的库存读齐(保存前用);读失败也返回,由调用的地方看 STK.err
function stockReady(ids) {
  wantStock(ids);
  return new Promise((res) => { const check = () => (STK.err || ids.every((id) => STK.map.has(id)) ? res() : STK.waiters.push(check)); check(); });
}
const groupVariantIds = (g) => (E.lists?.[g.id]?.products || []).flatMap((x) => x.variants.map((v) => v.id));
// 「只要 UK 仓有货的」这一组:有几个选项因为没货不改价、几个还在读库存(按这一组读到的产品算,和重算用同一套条件)
function stockInfo(g) {
  const out = { out: 0, wait: 0 }; if (g.scope.stock !== 'uk' || isPick(g)) return out;
  const rm = new Set(g.removed || []);
  for (const pr of E.lists?.[g.id]?.products || []) for (const v of pr.variants) {
    if (rm.has(v.id)) continue; const k = stockOf(v.id);
    if (k === undefined) out.wait++; else if (noStock(k)) out.out++;
  }
  return out;
}
const stockCell = (id) => { const n = stockOf(id);
  return n === undefined ? '<span class="muted">…</span>' : n === null ? '<span class="muted" title="这个选项在 Shopify 里不追踪库存">不追踪</span>' : `<span class="${n < 0 ? 'stk-neg' : n === 0 ? 'stk-zero' : ''}">${n}</span>`; };

// 表格:默认只看前 20 个,可以展开全部;keep = 筛选 / 搜索
const VIMG = (cache.vimg ||= { map: new Map(), asked: new Set(), busy: false });
const vimgOf = (it) => { const u = VIMG.map.get(it.variantId); return u && u !== it.image ? u : ''; };
function wantVimages(its) { // 只读有多个款式的产品;每次最多 5 个产品,读完再画
  const ids = [...new Set(its.map((i) => i.productId))].filter((pid) => !VIMG.asked.has(pid) && its.filter((i) => i.productId === pid).length > 1);
  if (!ids.length || VIMG.busy) return;
  const batch = ids.slice(0, 5); batch.forEach((x) => VIMG.asked.add(x)); VIMG.busy = true;
  api('GET', `/api/price/catalog/vimages?ids=${batch.join(',')}`).then((d) => { Object.entries(d.images || {}).forEach(([k, v]) => VIMG.map.set(k, v)); })
    .catch(() => { /* 读不到图不影响别的 */ }).finally(() => { VIMG.busy = false; if (E) render(); });
}
// 产品表里并排的价格列(2026-11-09 用户选的:每个价格一列、并排能改)—— 一种价格 = null(和以前一样一列「新价」);
// 超过 3 个只并排 3 个(正在看的那个一定在),其余在上面总览表点格子切换
function priceCols() {
  if (!multiV()) return null;
  const vs = versionsOf(P()).map((v) => v.id); if (vs.length <= 3) return vs;
  const cv = curV(); const pick = [cv, ...vs.filter((x) => x !== cv)].slice(0, 3); return vs.filter((x) => pick.includes(x));
}
// 每个价格的「选项 → 条目」对照(按条目数组缓存:重算换了新数组才重建;全店几千个选项时别每格都去找)
function vItemMaps() {
  const vs = versionsOf(P()); const arrs = vs.map((v) => E.vitems?.[v.id] || []);
  const c = E.vmCache; if (c && c.arrs.length === arrs.length && c.arrs.every((a, i) => a === arrs[i] && c.lens[i] === a.length)) return c.maps;
  const maps = Object.fromEntries(vs.map((v, i) => [v.id, new Map(arrs[i].map((x) => [x.variantId, x]))]));
  E.vmCache = { arrs, lens: arrs.map((a) => a.length), maps }; return maps;
}
// 一行(一个选项)在所有价格下:有没有要填的价 / 有没有提醒 / 有没有手改
const rowItems = (it) => { if (!multiV()) return [it]; const m = vItemMaps(); return versionsOf(P()).map((v) => m[v.id]?.get(it.variantId)).filter(Boolean); };
const rowBad = (p, it) => rowItems(it).some((x) => itemBad(p, x));
const rowMan = (it) => rowItems(it).some((x) => x.manual || x.cmpManual);
function previewHtml(ro, gid, keep = null) {
  const p = P(); const all0 = items().filter((i) => i.group === gid); const its = keep ? all0.filter(keep) : all0; const ex = new Set(p.excluded || []);
  const cols = priceCols(); const vm = cols ? vItemMaps() : null;
  const needFill = its.some((i) => rowItems(i).some((x) => needsPrice(p, x)) && !ex.has(i.variantId));
  const all = (E.showAllG || {})[gid];
  const show = all || needFill ? its : its.slice(0, 20);
  setTimeout(() => { wantVimages(show); wantStock(show.map((i) => i.variantId)); }, 0);
  const setCompare = gCmp(p, groupsOf(p).find((g) => g.id === gid)) === 'set';
  let lastPid = null;
  // 2026-10-28 用户:进行中的计划看不到移出 —— 表格只读时按钮被一起藏了。移出是安全方向(下一分钟恢复原价),开始后照样能用
  const canExclude = started() && !E.showPending && !E.orig?.stopped && !['ended', 'done'].includes(statusOf(E.orig));
  const rowAct = canExclude ? 'exclude' : ro ? '' : 'rm';
  // 2026-10-29 用户:指定产品模式叫「删除」(从选的清单里删掉);Collection / 品牌标签 / 全店叫「排除」(从这批产品里排除,能恢复)
  const grp = groupsOf(p).find((g) => g.id === gid); const pick = isPick(grp);
  const actLabel = rowAct === 'exclude' ? '移出' : pick ? '删除' : '排除';
  const actTip = rowAct === 'exclude' ? '移出后下一分钟回到改价前的价格' : pick ? '从选的产品里删掉这个选项(和在选择器里取消勾选一样)' : '从这批产品里排除,它的价格不会被改(下面「已排除」里能恢复)';
  const listOf = new Map((E.lists?.[gid]?.products || []).map((x) => [x.id, x])); const selOf = pick ? pickedVariants(grp) : null;
  const notPicked = (pid) => { const pr = listOf.get(pid); const vs = selOf?.get(pid); return pr && vs ? pr.variants.length - vs.size : 0; }; // 这个产品有几个选项没选
  const live = its.filter((x) => !ex.has(x.variantId));
  const rows = show.map((it) => {
    const first = it.productId !== lastPid; lastPid = it.productId;
    const w = core.itemWarnings(p, it, opts(it));
    const t = (() => { try { return core.targetFor({ price: it.refPrice, compareAt: it.refCompareAt }, p, it); } catch { return null; } })();
    const d = it.price != null ? core.discountPct(it.refPrice, it.price) : null;
    const gone = ex.has(it.variantId);
    return `<tr class="${first ? 'is-first' : ''} ${E.fresh?.has(it.productId) ? 'is-fresh' : ''}" style="${gone ? 'opacity:.45' : ''}">
      <td>${first ? `<div class="pcell">${it.image ? `<img class="pimg" src="${esc(it.image)}" loading="lazy" alt=""/>` : '<span class="pimg"></span>'}<div><div class="pcell__t">${esc(it.product || it.title)}</div><div class="pcell__s">${esc(it.vendor || '')} · <button type="button" class="linkbtn pcell__hist" data-a="phist" data-p="${esc(it.productId)}" data-t="${esc(it.product || it.title)}">改价记录</button></div>${pick && notPicked(it.productId) > 0 ? `<div class="pcell__s pcell__np">另有 ${notPicked(it.productId)} 个选项没选,不改价</div>` : ''}
        ${(() => { const sib = live.filter((x) => x.productId === it.productId); return rowAct && sib.length > 1 ? `<button class="linkbtn pcell__all" data-a="${rowAct}" data-vs="${sib.map((x) => x.variantId).join(',')}" title="${rowAct === 'exclude' ? `这个产品的 ${sib.length} 个选项一起移出,下一分钟回到改价前的价格` : pick ? `这个产品整个从选的清单里删掉` : `这个产品的 ${sib.length} 个选项一起排除`}">整个产品${actLabel}(${sib.length} 个选项)</button>` : ''; })()}</div></div>` : ''}</td>
      <td><div class="vcell">${vimgOf(it) ? `<img class="vimg" src="${esc(vimgOf(it))}" loading="lazy" alt=""/>` : ''}<div>${esc(it.variant || '')}<div class="pcell__s">${esc(it.sku || '')}</div></div></div></td>
      <td class="ctr">${stockCell(it.variantId)}</td>
      <td class="num">${money(it.refPrice)}${it.refCompareAt && Number(it.refCompareAt) > Number(it.refPrice) ? `<div><s>${money(it.refCompareAt)}</s></div>` : ''}${Number(it.cost) > 0 ? `<div class="pcell__s">成本 ${money(it.cost)}</div>` : ''}</td>
      ${cols ? cols.map((ver) => priceTd(p, vm[ver].get(it.variantId), ver, ro, gone)).join('') : priceTd(p, it, null, ro, gone)}
      <td class="num">${(() => {
        if (setCompare && !ro && !gone && !it.cmpManual) return `<input class="inp" data-f="icompare" data-v="${it.variantId}" value="${it.compareAt ?? ''}" placeholder="无"/>`;
        const shown = t?.compareAt ? `<s>${money(t.compareAt)}</s>` : '<span class="muted">无</span>';
        if (ro || gone) return `${shown}${it.cmpManual ? '<div><span class="pr-mtag">例外</span></div>' : ''}`;
        // 按规则算出来的划线价(没单独改时显示成占位提示)
        const byRule = (() => { try { return core.targetFor({ price: it.refPrice, compareAt: it.refCompareAt }, p, { ...it, cmpManual: false }).compareAt; } catch { return null; } })();
        return `<input class="inp ${it.cmpManual ? 'is-exc' : ''}" data-f="icompare" data-v="${it.variantId}" value="${it.cmpManual ? (it.compareAt ?? '0') : ''}" placeholder="${byRule ? money(byRule) : '无'}" title="填数字 = 这个选项单独用这个划线价;填 0 = 这个选项不显示划线价;清空 = 按上面选的方式"/>
          ${it.cmpManual ? `<div><span class="pr-mtag">例外</span><button class="linkbtn" data-a="uncmp" data-v="${it.variantId}" title="回到上面选的划线价方式">用规则</button></div>` : ''}`;
      })()}</td>
      ${cols ? '' : `<td class="num">${pctTxt(d)}</td>`}
      <td class="ctr">${gone ? '<span class="w w--warn">已移出</span>' : ''}${(cols ? rowWarnings(p, it) : w).map((x) => `<button type="button" class="tip tip--${x.level}" aria-label="${esc(x.text)}"><span class="tip__i" aria-hidden="true">!</span><span class="tip__c">${esc(x.text)}</span></button>`).join('')}</td>
      <td class="num">${gone || !rowAct ? '' : `<button class="linkbtn" data-a="${rowAct}" data-v="${it.variantId}" title="${actTip}">${actLabel}</button>`}</td>
    </tr>`;
  }).join('');
  if (!its.length) return '<p class="muted" style="margin-top:8px">没有符合筛选的产品。</p>';
  return `    <div class="tblwrap" style="margin-top:10px"><table class="pr-tbl"><thead><tr><th>产品</th><th>选项 / SKU</th><th class="ctr" title="Shopify 里 ${esc(STK.loc?.name || 'UK 仓')} 的 Available(可售数),不含别的仓">UK 可售</th><th class="num">现价</th>${cols ? cols.map((ver) => `<th class="num pr-vth ${ver === curV() ? 'is-cur' : ''}">${vDot(p, ver)}${esc(vName(p, ver))}</th>`).join('') : '<th class="num">新价</th>'}<th class="num">划线价${cols ? '<span class="tipify">划线价对每个价格都一样(都按原来的价算),改一次就行</span>' : ''}</th>${cols ? '' : '<th class="num">变化</th>'}<th class="ctr">检查</th><th class="num">${rowAct ? '操作' : ''}</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${cols && versionsOf(p).length > cols.length ? `<p class="muted" style="margin-top:6px">还有 ${versionsOf(p).length - cols.length} 个价格没并排显示(${versionsOf(p).filter((v) => !cols.includes(v.id)).map((v) => esc(vName(p, v.id))).join('、')}),在下面「价格总览」点那一列的格子切过去</p>` : ''}
    ${its.length > 20 && !needFill ? `<button class="btn btn-sm btn-ghost" data-a="showall" data-g="${gid}" style="margin-top:8px">${all ? '只看前 20 个' : `展开全部 ${its.length} 个选项`}</button>` : ''}`;
}

const pctTxt = (d) => (d == null ? '' : d > 0 ? `<span class="off">-${d}%</span>` : d < 0 ? `<span class="up">+${-d}%</span>` : '0%');
// 一个价格的新价格子:ver = null 是只有一种价格(老样子);几种价格时每格下面带降幅,手改的标「手改」
function priceTd(p, it, ver, ro, gone) {
  if (!it) return '<td class="num"><span class="muted">—</span></td>';
  const vAttr = ver ? ` data-ver="${ver}"` : '';
  const d = ver && it.price != null ? core.discountPct(it.refPrice, it.price) : null;
  return `<td class="num ${ver && ver === curV() ? 'is-cur' : ''}">${ro || gone ? `<b>${it.price != null ? money(it.price) : '不变'}</b>` : `<input class="inp ${needsPrice(p, it) ? 'is-todo' : ''}" data-f="iprice" data-v="${it.variantId}"${vAttr} value="${it.price ?? ''}" placeholder="${needsPrice(p, it) ? '填新价' : '不变'}"/>`}
    ${ver ? `<div class="pr-vd">${pctTxt(d)}</div>` : ''}
    ${it.manual && !ro && !gone ? `<div><span class="pr-mtag">手改</span><button class="linkbtn" data-a="unmanual" data-v="${it.variantId}"${vAttr} title="回到这一组规则算出来的价">用规则价</button></div>` : ''}</td>`;
}
// 几种价格时一行的提醒:每个价格都有的只写一次,只有某几个价格有的前面写上价格名字
function rowWarnings(p, it) {
  const by = new Map(); const vs = versionsOf(p);
  const m = vItemMaps();
  for (const v of vs) {
    const x = m[v.id]?.get(it.variantId); if (!x) continue;
    for (const w of core.itemWarnings(p, x, opts(x))) { const k = `${w.level}|${w.text}`; if (!by.has(k)) by.set(k, { ...w, vs: [] }); by.get(k).vs.push(v.id); }
  }
  return [...by.values()].map((w) => ({ level: w.level, text: w.vs.length === vs.length ? w.text : `${w.vs.map((id) => vName(p, id)).join('、')}:${w.text}` }));
}
function bannersHtml() {
  const out = [];
  const o = E.orig;
  if (!o) return '';
  if (o.state === 'rejected' && o.rejectNote) out.push(`<div class="banner banner--danger">被退回:${esc(o.rejectNote)}。改好后重新提交。</div>`);
  if (o.stopped) out.push('<div class="banner banner--warn">这个计划已提前结束,活动价都已恢复(或正在恢复)。</div>');
  if (o.paused) out.push('<div class="banner banner--warn">暂停中:所有产品已回到改价前的售价和划线价,点「继续」会重新套用活动价。</div>');
  if (o.pendingChange) {
    const ch = { ...o, ...o.pendingChange };
    out.push(`<div class="banner banner--info"><b>${esc(nameOf(o.pendingChange.by))} 提交了修改(${fmtT(o.pendingChange.at)})</b>,批准前按原计划执行。
      <div style="margin:6px 0">${diffLines(o, ch).map((l) => `· ${esc(l)}`).join('<br>') || '· (只改了名称 / 备注)'}</div>
      <div class="row"><button class="btn btn-sm" data-a="togglepending">${E.showPending ? '看原计划' : '看修改后的版本'}</button>
      ${canApprove({ ...o, ...o.pendingChange }) ? `<button class="btn btn-sm btn-ok" data-a="approve">批准修改</button><button class="btn btn-sm" data-a="panel" data-p="reject">退回修改…</button>` : ''}</div></div>`);
  }
  if (started() && !o.stopped && statusOf(o) !== 'ended') out.push(`<div class="banner banner--info">这个计划已经在改价了:产品和价格锁住了,${schedMode(o) === 'one' ? '还能改结束时间' : '还能改以后的时间段、进行中那段的结束时间'},或者暂停、提前结束、把个别产品移出。要换价格或范围,请提前结束后新建一个。</div>`);
  if (E.panel === 'reject') out.push(`<div class="pr-panel"><div class="row"><input class="inp" id="reject-note" placeholder="退回原因(会发给提交人)" style="flex:1"/><button class="btn btn-danger" data-a="reject">确认退回</button><button class="btn btn-ghost" data-a="panel" data-p="">取消</button></div></div>`);
  return out.join('');
}
function diffLines(a, b) {
  const out = [];
  const ga = groupsOf(a), gb = groupsOf(b);
  if (ga.length !== gb.length) out.push(`分组从 ${ga.length} 组改成 ${gb.length} 组`);
  if (JSON.stringify(ga.map((g) => g.rule)) !== JSON.stringify(gb.map((g) => g.rule))) out.push(`改价方式改成「${gb.map((g) => ruleSay(g.rule)).join(' / ')}」`);
  if (JSON.stringify(ga.map((g) => g.scope)) !== JSON.stringify(gb.map((g) => g.scope))) out.push('改了适用产品的范围');
  const sa = a.slots[0] || {}, sb = b.slots[0] || {};
  if (sa.start !== sb.start) out.push(`开始时间改成 ${fmtT(sb.start)}`);
  if (sa.end !== sb.end) out.push(`结束时间改成 ${sb.end ? fmtT(sb.end) : '不结束'}`);
  const ma = new Map((sa.items || []).map((t) => [t.variantId, t])), mb = new Map((sb.items || []).map((t) => [t.variantId, t]));
  const add = [...mb.keys()].filter((k) => !ma.has(k)).length, del = [...ma.keys()].filter((k) => !mb.has(k)).length;
  const chg = [...mb.keys()].filter((k) => ma.has(k) && ma.get(k).price !== mb.get(k).price).length;
  if (add || del || chg) out.push([add && `加 ${add} 个选项`, del && `删 ${del} 个`, chg && `改价 ${chg} 个`].filter(Boolean).join('、'));
  { const ma = core.groupCmpModes(a), mb = core.groupCmpModes(b); if (JSON.stringify(ma) !== JSON.stringify(mb)) out.push(`划线价改成「${mb.map((m) => core.COMPARE_CN[m]).join(' / ')}」`); }
  if (JSON.stringify(a.tagsAdd || []) !== JSON.stringify(b.tagsAdd || []) || JSON.stringify(a.tagsRemove || []) !== JSON.stringify(b.tagsRemove || [])) out.push('改了产品标签');
  if ((a.approver || '') !== (b.approver || '')) out.push(`审批人改成 ${b.approver ? nameOf(b.approver) : '管理员'}`);
  return out;
}

function collPanel(which) {
  const list = cache.collSearch || [];
  return `<div class="pr-panel"><div class="row"><input class="inp" id="coll-q" placeholder="搜 Collection 名称" style="flex:1" value="${esc(cache.collQ || '')}"/><button class="btn btn-sm" data-a="collsearch" data-w="${which}">搜索</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div>
    <div class="results">${list.map((c) => `<div class="result"><b style="flex:1">${esc(c.title)}</b><span class="muted">${c.count ?? '?'} 个产品 · ${c.smart ? '带条件' : '手动'}</span>
      ${which === 'slotcoll' ? (c.shared ? '<span class="muted" title="条件和别的 Collection 共用,单独加产品会连带改到别的 Collection">条件是共用的,不能单独加</span>' : `<button class="btn btn-sm" data-a="setcoll" data-id="${c.id}" data-t="${esc(c.title)}">选这个</button>`)
        : `<button class="btn btn-sm" data-a="addcoll" data-id="${c.id}" data-t="${esc(c.title)}">选这个</button>`}</div>`).join('') || '<span class="muted">输入名称搜索</span>'}</div></div>`;
}

function checkHtml() {
  const p = P();
  const its = items();
  const ex = new Set(p.excluded || []);
  // 几种价格时按选项算:任何一个价格有问题,这个选项就算有问题(不重复算)
  const ws = its.filter((i) => !ex.has(i.variantId)).map((i) => rowItems(i).flatMap((x) => core.itemWarnings(p, x, opts(x))));
  const errs = ws.filter((w) => w.some((x) => x.level === 'error')).length + its.filter((i) => rowItems(i).some((x) => needsPrice(p, x))).length;
  const warns = ws.filter((w) => w.some((x) => x.level === 'warn')).length;
  const ov = core.overlaps({ ...p, state: 'approved' }, S.plans);
  const byOther = new Map();
  for (const o of ov) { const k = o.other.planId; if (!byOther.has(k)) byOther.set(k, { ...o.other, n: new Set(), wins: o.wins }); byOther.get(k).n.add(o.variantId); }
  const err = A.validate(p, opts());
  // 尾数取整会让便宜的产品降得比规则多很多(£1.50 打 8 折 = £1.20,取 .99 就成了 £0.99)
  let roundWarn = '';
  {
    const gmap = new Map(groupsOf(p).map((g) => [g.id, g]));
    const ruleOf = (i) => ruleAt(gmap.get(i.group) || groupsOf(p)[0], multiV() ? curV() : 'A');
    const offs = its.filter((i) => i.price != null && !i.manual && !ex.has(i.variantId)).map((i) => ({ off: core.discountPct(i.refPrice, i.price), i, r: ruleOf(i) }))
      .filter((x) => x.r.mode === 'percent_off' && x.r.rounding && x.off > Number(x.r.value) + 5);
    const worst = offs.sort((a, b) => b.off - a.off)[0];
    if (worst) roundWarn = `<div class="banner banner--warn" style="margin-bottom:6px">尾数取整让便宜的产品降得更多:规则是降 ${worst.r.value}%,但「${esc(worst.i.product || worst.i.title)}」实际降了 ${worst.off}%(${money(worst.i.refPrice)} → ${money(worst.i.price)})。不想这样就把那一组的尾数改成「不取整」。</div>`;
  }
  const todo = its.filter((i) => rowItems(i).some((x) => needsPrice(p, x)) && !ex.has(i.variantId)).length;
  return `<div class="pr-card"><div class="pr-card__t">检查</div>
    <div class="check">
      <div class="${errs ? 'is-bad' : ''}"><b>${errs}</b>个有错误(不能提交)</div>
      <div class="${warns ? 'is-warn' : ''}"><b>${warns}</b>个要留意</div>
    </div>
    ${todo && p.kind === 'window' ? `<div class="banner banner--warn" style="margin-bottom:6px">还有 <b>${todo}</b> 个选项没填新价(在对应那一组的「产品和新价」表格里填;表格上点「有问题」能只看这些)。</div>` : ''}
    ${roundWarn}
    ${[...byOther.values()].map((o) => `<div class="banner banner--warn" style="margin-bottom:6px">⚠️ <b>${o.n.size} 个选项</b>也在「${esc(o.name)}」(优先级 ${o.priority})里,时间有重叠:重叠期间用<b>「${o.wins ? esc(p.name || '这个计划') : esc(o.name)}」</b>的价格${o.wins ? `,这个计划结束后回到「${esc(o.name)}」的价` : ',这个计划在重叠的这段时间里对这些选项不起作用'}。不对就改上面的「优先级」(数字大的说了算,一样大时开始晚的说了算)。</div>`).join('')}
    ${err && !readonly() ? `<div class="banner banner--warn" style="margin:0">还不能提交:${esc(err)}</div>` : ''}
  </div>`;
}

function footHtml() {
  const o = E.orig; const ro = readonly();
  const ap = canApprove(o ? (o.pendingChange ? { ...o, ...o.pendingChange } : o) : E.plan); // 这个计划的审批人(或管理员)
  const st = E.isNew ? 'new' : statusOf(o);
  const b = [];
  if (!ro) {
    if (st === 'pending' && ap) {
      // 审核人看待审核的计划:没改就直接批准 / 退回;自己改了就「保存修改并批准」
      if (E.dirty) b.push('<button class="btn btn-primary" data-a="save" data-m="publish">保存修改并批准</button>');
    } else if (['new', 'draft', 'rejected', 'pending'].includes(st)) {
      b.push(`<button class="btn" data-a="save" data-m="draft">${st === 'pending' ? '撤回成草稿' : '存草稿'}</button>`);
      b.push(ap ? `<button class="btn btn-primary" data-a="save" data-m="publish">${S.approvals ? '批准并排期' : '保存并排期'}</button>` : `<button class="btn btn-primary" data-a="save" data-m="submit">${st === 'pending' ? '重新提交' : '提交审核'}</button>`);
    } else if (o?.state === 'approved' && !o.stopped) {
      b.push(ap ? `<button class="btn btn-primary" data-a="save" data-m="publish" ${E.dirty ? '' : 'disabled'}>保存修改(直接生效)</button>` : `<button class="btn btn-primary" data-a="save" data-m="submit" ${E.dirty ? '' : 'disabled'}>提交修改审核</button>`);
    }
  }
  // 已经开始的计划:价格和产品锁住了,但时间还能改(进行中那段的结束时间、以后的段)—— 以前这里没有保存按钮,「能改结束时间」其实存不了
  if (ro && started() && !E.showPending && o?.state === 'approved' && !o.stopped && !['ended', 'done'].includes(st) && !(o.kind === 'permanent')) {
    b.push(ap ? `<button class="btn btn-primary" data-a="save" data-m="publish" ${E.dirty ? '' : 'disabled'}>保存时间修改</button>` : `<button class="btn btn-primary" data-a="save" data-m="submit" ${E.dirty ? '' : 'disabled'}>提交时间修改审核</button>`);
  }
  if (st === 'pending' && ap && !E.dirty) { b.push('<button class="btn btn-ok" data-a="approve">批准</button>'); b.push('<button class="btn" data-a="panel" data-p="reject">退回…</button>'); }
  if (o?.state === 'approved' && !o.stopped && !['ended', 'done'].includes(st)) {
    if (ap) b.push(o.paused ? '<button class="btn" data-a="resume">继续</button>' : '<button class="btn" data-a="pause">暂停(先回到改价前)</button>');
    b.push('<button class="btn btn-danger" data-a="stop">提前结束</button>');
  }
  b.push('<span class="spacer"></span>');
  if (!E.isNew) b.push('<button class="btn btn-ghost" data-a="history">历史版本</button>');
  if (!E.isNew) b.push('<button class="btn btn-ghost" data-a="dup">复制成新计划</button>');
  if (!E.isNew && P().kind === 'window' && curSlot().end) b.push('<button class="btn btn-ghost" data-a="dupnext">复制成下一天</button>');
  if (!E.isNew && (!['running', 'paused'].includes(st)) && (o.state !== 'approved' || ap)) b.push('<button class="btn btn-ghost btn-danger" data-a="delete">删除</button>');
  if (E.isNew) b.push('<button class="btn btn-ghost" data-a="close">放弃</button>');
  return b.join('');
}

// ---- 编辑器里的改动 ----
function touch() { E.dirty = true; }
// 勾了「跟随活动时间」:把活动的开始 / 结束填进来(执行器每轮也会再对齐一次)
function applyCampaignTime() {
  const c = (cache.campaigns || []).find((x) => x.id === E.plan.campaign?.id);
  if (!c || c.start == null) { toast('这个活动还没设开始时间', false); E.plan.followCampaign = false; return; }
  const s = curSlot(); s.start = c.start; s.end = E.plan.kind === 'window' ? c.end ?? null : null;
}
const toItem = (pr, v, rule) => {
  const it = { variantId: v.id, productId: pr.id, title: `${pr.title}${v.title ? ' - ' + v.title : ''}`, product: pr.title, variant: v.title, sku: v.sku, vendor: pr.vendor, image: pr.image,
    refPrice: v.price, refCompareAt: v.compareAt, cost: v.cost, price: null };
  try { if (!['keep', 'manual'].includes(rule.mode)) it.price = core.priceByRule({ price: v.price, compareAt: v.compareAt }, rule); } catch { /* 规则没填好就先不设价 */ }
  return it;
};
// ================= 产品清单和新价(2026-10-29 用户:选了就出现、改了规则自动刷新、手动调的不丢)=================
// 「哪些产品」和「新价怎么算」分开:
//   - 选 Collection / 品牌标签 / 单品 → 马上去店里读这一组的产品(E.lists[组],按来源缓存,加一个产品只读新加的那个)
//   - 改折扣、改方式、改尾数 → 不用再读店里,在本地马上重算(recompute)
//   - 手改的新价、单独改的划线价按变体记在条目上,「去掉」的记在组上(g.removed)—— 加产品、改规则、重新读都不会丢
// 顺序:新加的在最上面(用户定的);一组只用一种来源,要混合就分组。
const srcKey = (sc) => JSON.stringify(sc.mode === 'collections' ? ['c', sc.collections.map((c) => c.id)] : sc.mode === 'products' ? ['p', sc.products.map((x) => x.id)]
  : sc.mode === 'search' ? ['s', sc.vendor || '', sc.tag || '', sc.type || ''] : ['all']);
const scopeEmpty = (sc) => (sc.mode === 'collections' ? !sc.collections.length : sc.mode === 'products' ? !sc.products.length : sc.mode === 'search' ? !(sc.vendor || sc.tag || sc.type) : false);
const C = (cache.cat ||= { coll: new Map(), prod: new Map(), search: new Map(), all: null });
// 指定产品(2026-10-29 用户):按选项选 —— 选择器里勾整个产品 = 全部选项,只勾几个选项 = 只改这几个(scope.products[].variants;没有 = 全部)
const isPick = (g) => g?.scope?.mode === 'products';
const pickedVariants = (g) => new Map((g.scope.products || []).map((x) => [x.id, x.variants?.length ? new Set(x.variants) : null]));
// 读到产品后理一理选的选项:全选了就记成「整个产品」;上一版记在 removed 里的「去掉」、老计划里没有的选项 → 都算没选(指定产品模式不用「已排除」)
function normalizePick(g, ps, initial) {
  const byId = new Map(ps.map((x) => [x.id, x]));
  const rmd = new Set(g.removed || []);
  const inPlan = initial && g.removed === undefined ? new Set(items().map((i) => i.variantId)) : null; // 老计划:当时没算进来的 = 没选
  g.scope.products = g.scope.products.flatMap((x) => {
    const pr = byId.get(x.id); if (!pr) return [x]; // 读不到(店里删了?)先留着
    const all = pr.variants.map((v) => v.id);
    const sel = (x.variants?.length ? all.filter((id) => x.variants.includes(id)) : all).filter((id) => !rmd.has(id) && (!inPlan || inPlan.has(id)));
    if (!sel.length) return []; // 一个选项都没选了 = 这个产品不在清单里
    const { variants, ...rest } = x;
    return [sel.length === all.length ? rest : { ...rest, variants: sel }];
  });
  g.removed = [];
}
// 指定产品模式的「删除」:从选的清单里删掉这些选项(和在选择器里取消勾选一样);一个都不剩就整个产品删掉
function pickDelete(g, variantIds) {
  const ids = new Set(variantIds); const L = E.lists[g.id];
  g.scope.products = g.scope.products.flatMap((x) => {
    const pr = L?.products?.find((y) => y.id === x.id);
    const all = pr ? pr.variants.map((v) => v.id) : items().filter((i) => i.productId === x.id).map((i) => i.variantId);
    const cur = x.variants?.length ? x.variants : all;
    const left = cur.filter((id) => !ids.has(id));
    if (left.length === cur.length) return [x];
    if (!left.length) return [];
    const { variants, ...rest } = x;
    return [left.length === all.length ? rest : { ...rest, variants: left }];
  });
  if (L) L.key = srcKey(g.scope); // 清单还是那批产品(少了几个),不用重新读
}
const keepProd = (ps) => { ps.forEach((x) => C.prod.set(x.id, x)); return ps; };
// 店里读过的直接用;force = 从店里重新读
async function productsOf(sc, force = false) {
  if (sc.mode === 'collections') {
    const out = new Map();
    for (const c of sc.collections) {
      let ps = !force && C.coll.get(c.id);
      if (!ps) {
        const d = await api('GET', `/api/price/catalog/collection?id=${encodeURIComponent(c.id)}`);
        if (d.truncated) toast(`Collection「${c.title}」太大,只取了前 5000 个产品`, false);
        ps = keepProd(d.products); C.coll.set(c.id, ps);
      }
      ps.forEach((x) => { if (!out.has(x.id)) out.set(x.id, x); });
    }
    return [...out.values()];
  }
  if (sc.mode === 'products') {
    const miss = sc.products.map((x) => x.id).filter((id) => force || !C.prod.has(id));
    for (let i = 0; i < miss.length; i += 80) keepProd((await api('GET', `/api/price/catalog/products?ids=${miss.slice(i, i + 80).join(',')}`)).products);
    return sc.products.map((x) => C.prod.get(x.id)).filter(Boolean); // 照选的先后(新加的在最上面)
  }
  if (sc.mode === 'search') {
    const q = new URLSearchParams(Object.fromEntries(['vendor', 'tag', 'type'].filter((k) => sc[k]).map((k) => [k, sc[k]])));
    const key = String(q); let ps = !force && C.search.get(key);
    if (!ps) { ps = keepProd((await api('GET', `/api/price/catalog/search?${q}`)).products); C.search.set(key, ps); }
    return ps;
  }
  if (!C.all || force) {
    const d = await api('GET', '/api/price/catalog/search?all=1');
    if (d.truncated) toast('店里产品很多,只取了前 5000 个', false);
    C.all = keepProd(d.products);
  }
  return C.all;
}
// 读一组的产品。读完:按最新设置重算、刷新页面;刚加进来的产品闪一下
// initial = 打开已有计划时的后台读:不重算(不改保存的内容),只把「当时去掉了哪些」补记下来(老计划没记)
function loadGroup(g, { force = false, initial = false } = {}) {
  if (!E) return Promise.resolve();
  const key = srcKey(g.scope); const prev = E.lists[g.id];
  if (!force && prev && prev.key === key && prev.status !== 'err') return prev.promise || Promise.resolve();
  if (scopeEmpty(g.scope)) { E.lists[g.id] = { key, status: 'ok', products: [] }; if (!initial) { g.removed = []; recompute(); } return Promise.resolve(); } // 什么都没选了:排除记录也清掉
  const entry = { key, status: 'loading', products: prev?.products || [] };
  const before = new Set((prev?.products || []).map((x) => x.id));
  entry.promise = productsOf(g.scope, force).then((ps) => {
    if (!E || E.lists[g.id] !== entry) return;
    entry.status = 'ok'; entry.products = ps;
    if (g.scope.stock === 'uk' && !isPick(g)) setTimeout(() => wantStock(ps.flatMap((x) => x.variants.map((v) => v.id))), 0);
    if (isPick(g)) { normalizePick(g, ps, initial); entry.key = srcKey(g.scope); }
    else if (!initial && g.removed?.length) { const have = new Set(ps.flatMap((x) => x.variants.map((v) => v.id))); g.removed = g.removed.filter((id) => have.has(id)); }
    if (initial) { if (!isPick(g)) seedRemoved(g, ps); E.calcKey = scopeKey(P()); }
    else {
      if (prev) { const fresh = ps.filter((x) => !before.has(x.id)).map((x) => x.id); if (fresh.length < ps.length) { E.fresh = new Set(fresh); setTimeout(() => { if (E) E.fresh = new Set(); }, 2500); } }
      recompute();
    }
    render();
  }).catch((e) => { if (!E || E.lists[g.id] !== entry) return; entry.status = 'err'; entry.err = e.message; render(); });
  E.lists[g.id] = entry;
  return entry.promise;
}
// 老计划:当时「去掉」的变体没单独记 —— 这一组读出来有、保存的计划里没有(也不在别的组)的,就当是去掉的,免得一重算又加回来
function seedRemoved(g, ps) {
  if (g.removed) return;
  const mine = new Set(items().map((i) => i.variantId));
  g.removed = ps.flatMap((x) => x.variants.map((v) => v.id)).filter((id) => !mine.has(id));
  E.calcKey = scopeKey(P());
}
// 按每组的产品清单 + 规则算出全部变体的新价(本地,马上)。同一个变体在几组里时,下面的组说了算
function recompute() {
  if (!E || readonly() || E.showPending) return;
  const p = E.plan; E.vitems ||= {};
  // 每个价格各算一遍(产品清单一样,规则 / 手改的价按价格分开记)
  for (const v of versionsOf(p)) E.vitems[v.id] = tagVer(computeItems(p, v.id), v.id);
  for (const k of Object.keys(E.vitems)) if (!versionsOf(p).some((v) => v.id === k)) delete E.vitems[k]; // 删掉的价格
  p.slots[0].items = E.vitems.A; // 「一段时间」照旧从第一段存
  E.calcKey = scopeKey(p);
  const wait = Object.values(E.stockOut).flatMap((x) => x.wait); if (wait.length) setTimeout(() => wantStock(wait), 0);
}
function syncCmp(it, src) {
  const a = src?.get(it.variantId); if (!a) return;
  if (a.cmpManual) it.cmpManual = true; else delete it.cmpManual;
  if (a.compareAt !== undefined) it.compareAt = a.compareAt; else delete it.compareAt;
}
function computeItems(p, ver) {
  const prev = E.vitems[ver] || (ver === 'A' ? p.slots[0].items : null) || E.vitems.A || [];
  const old = new Map(prev.map((i) => [i.variantId, i]));
  const keepManual = !!E.vitems[ver] || ver === 'A'; // 新加的价格:先照着 A 的产品,不带 A 手改的价
  // 划线价对每个价格都一样(都按原来的价算,2026-11-09 起产品表里一起改):别的价格照 A 刚算好的抄,新加的价格也带上
  const cmpSrc = ver === 'A' ? null : new Map((E.vitems.A || []).map((i) => [i.variantId, i]));
  const by = new Map(); E.groupHits = {}; E.stockOut = {};
  for (const g of p.groups) {
    const rule = ruleOf(g, ver);
    const L = E.lists[g.id]; const rm = new Set(isPick(g) ? [] : g.removed || []); const sel = isPick(g) ? pickedVariants(g) : null;
    const put = (it) => { by.delete(it.variantId); by.set(it.variantId, it); }; // 先删再放:被下面的组接手时,顺序跟着下面的组
    const byStock = g.scope.stock === 'uk' && !isPick(g); // 只要 UK 仓有货的:没货的不进清单,库存还没读到的先不放(读到了再放,免得混进没货的)
    const so = (E.stockOut[g.id] = { out: 0, wait: [] });
    if (L && L.status === 'ok' && L.key === srcKey(g.scope)) {
      let n = 0;
      for (const pr of L.products) for (const v of pr.variants) {
        const vs = sel?.get(pr.id); if (sel && (!sel.has(pr.id) || (vs && !vs.has(v.id)))) continue; // 指定产品:没选的选项不算
        if (rm.has(v.id)) continue;
        if (byStock) { const k = stockOf(v.id); if (k === undefined) { so.wait.push(v.id); continue; } if (noStock(k)) { so.out++; continue; } }
        n++;
        const it = toItem(pr, v, rule); it.group = g.id;
        const o = keepManual ? old.get(v.id) : null;
        if (o?.manual && o.price != null) { it.price = o.price; it.manual = true; } // 手改过的保留
        if (o && o.compareAt != null) it.compareAt = o.compareAt;
        if (o?.cmpManual) { it.cmpManual = true; it.compareAt = o.compareAt ?? null; } // 划线价单独例外也保留
        syncCmp(it, cmpSrc);
        put(it);
      }
      E.groupHits[g.id] = n;
    } else {
      // 这一组的产品还没读到(或读不到):先用原来的条目,价格按现在的规则重算
      for (const o0 of prev) {
        const o = keepManual ? o0 : { ...o0, manual: false, cmpManual: false };
        if (o.group !== g.id || rm.has(o.variantId)) continue;
        if (byStock && noStock(stockOf(o.variantId))) { so.out++; continue; }
        if (sel && (!sel.has(o.productId) || (sel.get(o.productId) && !sel.get(o.productId).has(o.variantId)))) continue;
        const it = { ...o };
        if (!it.manual) { it.price = null; try { if (!['keep', 'manual'].includes(rule.mode)) it.price = core.priceByRule({ price: it.refPrice, compareAt: it.refCompareAt }, rule); } catch { /* 规则没填好 */ } }
        syncCmp(it, cmpSrc);
        put(it);
      }
    }
  }
  return [...by.values()];
}
// 改了「改哪些产品」:读这一组(读过的马上出来);全店产品要点按钮才读(几千个,要等一会儿)
function scopeChanged(g = EG()) {
  touch();
  if (g.scope.mode === 'all' && !C.all) { delete E.lists[g.id]; recompute(); render(); return; }
  const L = E.lists[g.id];
  if (L && L.status === 'ok' && L.key === srcKey(g.scope)) { if (isPick(g)) { normalizePick(g, L.products, false); L.key = srcKey(g.scope); } recompute(); render(); return; } // 产品没变(只改了选项)
  loadGroup(g); render();
}
// 改了规则 / 分组顺序:本地马上重算
function ruleChanged() { touch(); recompute(); render(); }
// 保存前:每组的产品都读好、按最新设置算好
async function ensureCalc() {
  for (const g of E.plan.groups) {
    if (g.scope.mode === 'all' && !C.all) await loadGroup(g, { force: true });
    else await loadGroup(g);
    const L = E.lists[g.id]; if (L?.status === 'err') throw new Error(`${E.plan.groups.length > 1 ? `第 ${E.plan.groups.indexOf(g) + 1} 组:` : ''}读不到产品:${L.err}`);
  }
  // 「只要 UK 仓有货的」:等这一组所有选项的库存读齐再算(不然没读到的会被漏掉)
  const need = E.plan.groups.filter((g) => g.scope.stock === 'uk' && !isPick(g)).flatMap(groupVariantIds);
  if (need.length) {
    await stockReady(need);
    if (STK.err) throw new Error(`读不到 UK 仓库存:${STK.err}`);
    recompute(); return;
  }
  if (scopeKey(P()) !== E.calcKey) recompute();
}
async function withBusy(btn, fn) {
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '处理中…'; }
  try { await fn(); } catch (e) { toast(e.message, false); } finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = old; } }
}
const cdOut = (c) => ({ on: !!c?.on, label: String(c?.label || '').trim(), days: Number(c?.days) || 0, style: c?.style || 'classic' });
function values() {
  const p = E.plan; const pp = perPrice(p); if (pp) ensureVersions(p);
  const outSlots = slotsOut(p);
  // 关联活动 = 用到的价格各自关联的活动(没用到的价格不算)
  const camps = pp ? [...new Map(outSlots.filter((x) => x.campaign?.id).map((x) => [x.campaign.id, x.campaign])).values()] : p.campaign ? [p.campaign] : [];
  return { id: p.id, name: p.name.trim(), color: p.color, kind: p.kind, layer: p.kind === 'window' ? p.layer || null : null,
    priority: p.kind === 'window' ? core.prioOf(p) : null,
    // 分段时计划上那一份(倒计时 / 标签)不用了,每段自己带;关联活动 = 各价格的活动(第一个兼当 campaign)
    countdown: p.kind === 'window' ? (pp ? cdBlank() : cdOut(p.countdown)) : null,
    compare: p.groups?.[0]?.compare || cmpOf(p), campaign: pp ? camps[0] || null : p.campaign, campaigns: camps, note: p.note, slots: outSlots,
    versions: pp ? p.versions.map((v) => ({ id: v.id, name: v.name || '', coll: v.coll || null, tagsAdd: v.tagsAdd || [], tagsRemove: v.tagsRemove || [], campaign: v.campaign || null, countdown: cdOut(v.countdown) })) : null, schedule: p.kind === 'window' ? { mode: schedMode(p), ...(schedMode(p) === 'weekly' ? { weekly: p.schedule.weekly } : {}) } : null,
    groups: p.groups, rule: p.groups[0].rule, scope: p.groups[0].scope, tagsAdd: pp ? [] : p.tagsAdd, tagsRemove: pp ? [] : p.tagsRemove, followCampaign: (!pp || schedMode(p) === 'one') && !!p.followCampaign && !!camps[0],
    owner: p.owner || null, approver: p.approver || null, cc: p.cc || [], folder: p.folder || '' };
}

// 存的时段:一段时间 = 原来那一段;几段 / 每周重复 = 按段展开,每段带上它那个价格的全部条目(执行器照旧按时段改价)
function slotsOut(p) {
  if (schedMode(p) === 'one') {
    const { tagsAdd, tagsRemove, countdown, campaign, ...s0 } = p.slots[0]; void tagsAdd, tagsRemove, countdown, campaign;
    const base = { ...s0, items: E.vitems?.A || p.slots[0].items };
    if (!perPrice(p)) return [base]; // 永久调价:用计划上那一份
    ensureVersions(p); const a = verOf('A', p) || {}; // 限时一段时间:带上价格 A 的设置(版本号不动,免得已开始的计划被当成改了时段)
    return [{ ...base, collection: a.coll || null, tagsAdd: [...(a.tagsAdd || [])], tagsRemove: [...(a.tagsRemove || [])], campaign: a.campaign || null, countdown: cdOut(a.countdown) }];
  }
  // 每一段带上它那个价格的设置(Collection / 标签 / 活动 / 倒计时),执行器按段读
  ensureVersions(p);
  return scheduleSegments(p).map((sg) => { const v = verOf(sg.version, p) || {};
    return { id: sg.id, start: sg.start, end: sg.end, version: sg.version, collection: v.coll || null, tagsAdd: [...(v.tagsAdd || [])], tagsRemove: [...(v.tagsRemove || [])],
      campaign: v.campaign || null, countdown: cdOut(v.countdown), items: clone(E.vitems?.[sg.version] || []) }; });
}
async function act(action, msg) {
  const r = await api('POST', '/api/price/act', { action });
  toast(msg || r.message || '完成');
  await load();
  return r;
}
async function reopen(id) {
  const p = planById(id);
  if (p && E) openEditor(p, false); else { E = null; render(); }
}

// ================= 受管产品 =================
const REASON = { manual: '有人在后台手动改过价,app 已暂停接管这个产品(不会覆盖)', 'not-lower': '原价已经不比活动价高(可能有人先降了价),app 没有改' };
function vaultHtml() {
  const holds = holdsOf();
  const live = S.vault.filter((v) => v.written && !v.hold);
  const plan = (id) => planName(id) || '—';
  const colls = Object.entries(S.collState || {});
  return `
  <div class="toolbar"><button class="btn" data-a="dlvault">导出还原表格(CSV)</button>${isAdmin() ? '<button class="btn" data-a="runnow">立即对齐一次</button>' : ''}
    <span class="muted">还原表格 = 每个受管选项的原价和原划线价;app 万一出问题,照着它在后台改回去即可。</span></div>
  ${holds.length ? `<h3>⚠️ 暂停接管,等你处理(${holds.length})</h3>${holds.map((v) => `<div class="hold">
    <div class="hold__t">${esc(v.title || v.id)} <span class="muted">${esc(v.sku || '')}</span></div>
    <div class="muted" style="margin:2px 0">${REASON[v.hold.reason] || v.hold.reason} · 计划「${esc(plan(v.hold.planId))}」· ${fmtT(v.hold.at)}</div>
    <div class="hold__p"><span>店里现价 <b>${money(v.hold.seen?.price)}</b>${v.hold.seen?.compareAt ? `(划线 ${money(v.hold.seen.compareAt)})` : ''}</span>
      <span>app 写的价 <b>${money(v.written?.price ?? v.hold.expected?.price)}</b></span><span>原价 <b>${money(v.base?.price)}</b>${v.base?.compareAt ? `(划线 ${money(v.base.compareAt)})` : ''}</span></div>
    ${isAdmin() || canApprove(planById(v.hold.planId)) ? `<div class="row">
      <button class="btn btn-sm" data-a="fixhold" data-v="${v.id}" data-c="reapply">以店里现价为原价,重新套用活动价</button>
      <button class="btn btn-sm" data-a="fixhold" data-v="${v.id}" data-c="keep">退出计划,保持现价</button>
      ${v.written ? `<button class="btn btn-sm" data-a="fixhold" data-v="${v.id}" data-c="restore">回到改价前并退出计划</button>` : ''}</div>` : '<span class="muted">等审核人处理</span>'}
  </div>`).join('')}` : ''}
  <h3>正在活动价上(${live.length})</h3>
  ${live.length ? `<div class="tblwrap"><table class="pr-tbl"><thead><tr><th>产品</th><th>SKU</th><th class="num">原价</th><th class="num">现在</th><th>计划</th><th>开始接管</th></tr></thead><tbody>
    ${live.map((v) => `<tr><td><button type="button" class="linkbtn" data-a="phist" data-p="${esc(v.productId)}" data-t="${esc(v.title)}" title="看这个产品的改价记录">${esc(v.title)}</button></td><td>${esc(v.sku || '')}</td><td class="num">${money(v.base?.price)}${v.base?.compareAt ? `<div><s>${money(v.base.compareAt)}</s></div>` : ''}</td>
      <td class="num"><b>${money(v.written.price)}</b>${v.written.compareAt ? `<div><s>${money(v.written.compareAt)}</s></div>` : ''}</td><td>${esc(plan(v.written.planId))}</td><td>${fmtT(v.since)}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="pr-empty">现在没有产品在活动价上</div>'}
  ${colls.length ? `<h3>app 管着的 Collection 成员</h3>${colls.map(([id, c]) => `<div class="pr-kv"><span>${esc(c.title || id)}</span>${c.via === 'shared' ? '条件和别的 Collection 共用:app 不碰,产品照它的条件进出' : `${c.via === 'sources' ? '带条件的 Collection · ' : ''}app ${c.via === 'sources' ? '加进「单独加入的产品」' : '加进去'} ${c.managed.length} 个产品(时段结束拿掉)${c.preexisting.length ? `;${c.preexisting.length} 个本来就在,不动` : ''}`}
    ${isAdmin() ? `<button class="linkbtn" data-a="collrelease" data-id="${esc(id)}" title="一直报错(比如 Collection 改成了按条件归类)时用:app 不再往里加 / 移产品,已经加进去的留在里面">不再管这个 Collection</button>` : ''}</div>`).join('')}` : ''}
  ${goneHtml()}`;
}
// 不再管的 Collection(被删了 / 改成按条件归类 / Shopify 不让加移 / 手动停的):说清原因,app 之前加进去、还留在里面的产品能看清单
const GONE_WHY = { deleted: '在店里被删除了', smart: '改成了按条件自动归类(Shopify 只让手动 Collection 加 / 移产品)', refused: 'Shopify 不让往里加 / 移产品(可能改成了按条件归类)', manual: '手动停止管理' };
function goneHtml() {
  const gone = Object.entries(S.goneCollections || {}); if (!gone.length) return '';
  return `<h3>不再管的 Collection</h3>${gone.map(([id, g]) => {
    const names = cache.goneNames?.[id];
    return `<div class="pr-kv"><span>${esc(g.title || id)}</span>${GONE_WHY[g.reason] || GONE_WHY.deleted} · ${fmtT(g.at)}${g.plans?.length ? ` · 计划 ${g.plans.map((p) => `「${esc(p.name)}」`).join('')}` : ''}
      ${g.left?.length ? `<br><b>app 之前加进去的 ${g.left.length} 个产品还留在里面</b>,不需要的话到 Shopify 后台从这个 Collection 移除。
        ${names ? `<div class="pr-gonelist">${names.map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</div>` : `<button class="linkbtn" data-a="goneprods" data-id="${esc(id)}">看是哪些产品</button>`}` : ''}</div>`;
  }).join('')}`;
}

// ================= 价格账本 =================
const OP_CN = { start: '开始活动价', switch: '换时段价', restore: '回到改价前', permanent: '永久调价' };
async function loadLedger() {
  const el = $('#ledger-root'); if (!el) return;
  const qs = new URLSearchParams({ q: ledgerQ.q, plan: ledgerQ.plan, offset: ledgerQ.offset, limit: 100 });
  try {
    const d = await api('GET', `/api/price/ledger?${qs}`);
    el.innerHTML = `<div class="toolbar">
      <div class="field-search"><input type="search" id="lq" placeholder="搜产品 / SKU / 计划" value="${esc(ledgerQ.q)}"/></div>
      <select class="sel" id="lplan"><option value="">全部计划</option>${(S.planNames || S.plans).map((p) => `<option value="${p.id}" ${ledgerQ.plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <button class="btn" data-a="dlledger">导出 CSV</button></div>
      ${d.rows.length ? `<div class="tblwrap"><table class="pr-tbl"><thead><tr><th>时间(英国)</th><th>产品</th><th>SKU</th><th>动作</th><th class="num">改前</th><th class="num">改后</th><th>计划</th><th>备注</th></tr></thead><tbody>
      ${d.rows.map((x) => `<tr><td>${fmtT(x.at)}</td><td>${x.productId ? `<button type="button" class="linkbtn" data-a="phist" data-p="${esc(x.productId)}" data-t="${esc(x.title)}" title="看这个产品的改价记录">${esc(x.title)}</button>` : esc(x.title)}</td><td>${esc(x.sku || '')}</td><td>${OP_CN[x.op] || x.op}</td>
        <td class="num">${money(x.from?.price)}${x.from?.compareAt ? `<div><s>${money(x.from.compareAt)}</s></div>` : ''}</td><td class="num"><b>${money(x.to?.price)}</b>${x.to?.compareAt ? `<div><s>${money(x.to.compareAt)}</s></div>` : ''}</td>
        <td>${esc(x.plan || '')}</td><td class="muted">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pr-empty">还没有改价记录</div>'}
      <div class="pager"><span class="pager__info">共 ${d.total} 条</span><div class="pager__btns">
        <button class="pgbtn" data-a="lpage" data-d="-1" ${ledgerQ.offset ? '' : 'disabled'}>上一页</button><button class="pgbtn" data-a="lpage" data-d="1" ${ledgerQ.offset + 100 < d.total ? '' : 'disabled'}>下一页</button></div></div>`;
  } catch (e) { el.innerHTML = `<div class="banner banner--danger">${esc(e.message)}</div>`; }
}

// ================= 一个产品的改价记录(2026-11-03 用户:改过几次价、分别在哪个计划,能追溯)=================
let PH = null; // { pid, title, data, err, v: 正在看的选项('' = 全部) }
async function openProductHistory(pid, title) {
  PH = { pid, title, data: null, err: '', v: '' }; drawPH();
  try { PH.data = await api('GET', `/api/price/product-history?product=${encodeURIComponent(pid)}`); } catch (e) { PH.err = e.message; }
  if (PH?.pid === pid) drawPH();
}
function drawPH() {
  let el = document.getElementById('pr-ph');
  if (!PH) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'pr-ph'; el.className = 'pr-modal'; $('#section-price').appendChild(el); }
  const d = PH.data;
  const body = PH.err ? `<div class="banner banner--danger">${esc(PH.err)}</div>` : !d ? '<div class="pr-load"><span class="pr-spin"></span>正在读…</div>' : (() => {
    // 这个产品有哪些选项(从计划和账本里收集)
    const vs = new Map();
    for (const p of d.plans) for (const i of p.items) if (!vs.has(i.variantId)) vs.set(i.variantId, [i.variant, i.sku].filter(Boolean).join(' · ') || '默认选项');
    for (const r of d.rows) if (!vs.has(r.variantId)) vs.set(r.variantId, (r.title || '').split(' - ').slice(1).join(' - ') || r.sku || '默认选项');
    const pickV = (id) => !PH.v || id === PH.v;
    const rows = d.rows.filter((r) => pickV(r.variantId));
    const writes = rows.filter((r) => ['start', 'switch', 'restore', 'permanent'].includes(r.op)).length;
    const plans = d.plans.filter((p) => p.items.some((i) => pickV(i.variantId)));
    const now0 = d.vault.filter((x) => pickV(x.id));
    const nowTxt = now0.length ? now0.map((x) => x.hold ? `<span class="tx-warn">暂停接管(${esc(x.plan)})</span>` : x.written ? `「${esc(x.plan)}」接管中 <b>${money(x.written.price)}</b>` : '').filter(Boolean).join(';') : '原价(没有计划接管)';
    const multi = vs.size > 1;
    const vname = (id) => (multi ? vs.get(id) || '' : '');
    const pair = (x) => (x ? `${money(x.price)}${x.compareAt ? ` <s>${money(x.compareAt)}</s>` : ''}` : '—');
    return `
      <div class="pr-ph__sum">app 改过 <b>${writes}</b> 次价 · 在 <b>${plans.length}</b> 个计划里 · 现在:${nowTxt}</div>
      ${multi ? `<div class="pr-chipfs" style="margin:8px 0">${[['', '全部选项'], ...vs].map(([id, n]) => `<button type="button" class="pr-chipf ${PH.v === id ? 'is-on' : ''}" data-a="phv" data-v="${esc(id)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <h4>改价记录 <span class="tipify">app 每次改这个产品的价都记一笔(最新在前)。只记得到 app 改的;不在任何计划里时有人直接在 Shopify 后台改的价记不到。</span></h4>
      ${rows.length ? `<div class="tblwrap"><table class="pr-tbl"><thead><tr><th>时间(英国)</th>${multi ? '<th>选项</th>' : ''}<th>动作</th><th class="num">改前</th><th class="num">改后</th><th>计划</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="nowrap">${fmtT(r.at)}</td>${multi ? `<td>${esc(vname(r.variantId))}</td>` : ''}<td>${OP_CN[r.op] || esc(r.op)}${r.note ? ` <span class="tipify">${esc(r.note)}</span>` : ''}</td>
          <td class="num">${pair(r.from)}</td><td class="num"><b>${pair(r.to)}</b></td><td>${r.planId ? `<button type="button" class="linkbtn" data-a="phopen" data-id="${esc(r.planId)}">${esc(r.plan || '计划')}</button>` : esc(r.plan || '')}</td></tr>`).join('')}
      </tbody></table></div>${d.total > d.rows.length ? `<p class="muted">只列最近 ${d.rows.length} 条(共 ${d.total} 条),全部的在「价格账本」导出</p>` : ''}` : '<div class="pr-empty">app 还没改过这个产品的价</div>'}
      <h4>包含这个产品的计划</h4>
      ${plans.length ? plans.map((p) => `<div class="pr-ph__plan">
          <div class="pr-ph__pn"><span class="tag ${STATUS_TAG[p.status]}">${core.STATUS_CN[p.status]}</span><button type="button" class="linkbtn" data-a="phopen" data-id="${esc(p.id)}"><b>${esc(p.name)}</b></button>
            ${p.folder ? `<span class="tag">分组:${esc(p.folder)}</span>` : ''}${p.campaign ? `<span class="tag">活动:${esc(p.campaign)}</span>` : ''}</div>
          <div class="muted">${p.slots.map((sl) => `${fmtT(sl.start)}${sl.end ? ' → ' + fmtT(sl.end) : ' 起'}`).join(';')}${p.kind === 'permanent' ? ' · 永久调价' : ''}</div>
          <div class="pr-ph__its">${p.items.filter((i) => pickV(i.variantId)).map((i) => `<span>${multi ? `${esc(vs.get(i.variantId) || '')}:` : ''}${i.vname ? `<em class="pr-ph__v">${esc(i.vname)}</em> ` : ''}${money(i.refPrice)} → <b>${i.price != null ? money(i.price) : '售价不变'}</b>${i.excluded ? ' <span class="tag">已移出</span>' : ''}</span>`).join('')}</div>
        </div>`).join('') : '<div class="pr-empty">没有计划包含这个产品</div>'}`;
  })();
  el.innerHTML = `<div class="pr-modal__bg" data-a="phclose"></div><div class="pr-modal__box" role="dialog" aria-label="改价记录">
    <div class="pr-modal__h"><div><div class="muted" style="margin:0">改价记录</div><b>${esc(d?.product?.title || PH.title || '')}</b></div><button type="button" class="btn btn-ghost" data-a="phclose">关闭</button></div>
    <div class="pr-modal__b">${body}</div></div>`;
}

// ================= 改价设置 =================
function settingsHtml() {
  const s = S.settings; const ap = isAdmin();
  return `
  <div class="pr-card"><div class="pr-card__t">通知</div>
    <p class="muted">改价每类通知(开始、结束、被接管、失败、已创建…)的样式、内容、推给谁、私信还是发群、什么时候推,都在「消息中心」里设(原来这里的开关已经带过去了)。</p>
    ${ap ? '<div class="row" style="margin-top:8px"><button class="btn btn-sm" type="button" data-a="opennotify">打开消息中心</button></div>' : ''}</div>
  <div class="pr-card"><div class="pr-card__t">安全</div>
    <div class="grid2"><label class="pr-fld">降幅上限 % <em>超过的在预览里标黄提醒</em><input class="inp" type="number" id="maxoff" value="${s.maxDiscountPct}" ${ap ? '' : 'disabled'}/></label>
      <label class="pr-fld">巡检间隔(分钟)<em>多久核对一次「正在活动价上的产品有没有被人手动改过」</em><input class="inp" type="number" id="sweep" value="${s.sweepMinutes}" ${ap ? '' : 'disabled'}/></label></div>
    ${ap ? '<div class="row" style="margin-top:10px"><button class="btn btn-sm btn-primary" data-a="savesafe">保存</button></div>' : ''}</div>
  <div class="pr-card"><div class="pr-card__t">库存 <span class="muted">编辑计划时「只要 UK 仓有货的」和产品表「UK 可售」按这个仓库的 Available 算</span></div>
    ${(() => { if (!cache.locs) { loadLocations(); return '<p class="muted">正在读仓库…</p>'; }
      if (cache.locs.err) return `<p class="muted">读不到仓库:${esc(cache.locs.err)}</p>`;
      return `<label class="pr-fld">UK 仓 <em>默认是伦敦仓(编号 43451853,Shopify 里叫 Cinegearpro)${cache.locs.locations.some((l) => l.noName) ? ';app 没有「读取仓库」权限,别的仓只显示编号(不影响读库存)' : ''}</em><select class="sel" id="ukloc" ${ap ? '' : 'disabled'} style="max-width:320px">
        <option value="" ${!s.ukLocation ? 'selected' : ''}>自动(现在是:${esc(cache.locs.uk?.name || '没找到')})</option>
        ${cache.locs.locations.filter((l) => l.active).map((l) => `<option value="${esc(l.id)}" ${s.ukLocation === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`; })()}</div>
  <div class="pr-card"><div class="pr-card__t">执行器</div>
    <div class="pr-kv"><span>状态</span>${S.engine.lastRun ? `上次对齐 ${ago(S.engine.lastRun)},改了 ${S.engine.lastWrites} 个选项` : '还没运行'}${S.engine.lastError ? ` · <span style="color:var(--danger)">${esc(S.engine.lastError)}</span>` : ''}</div>
    <div class="pr-kv"><span>时区</span>英国时间(Europe/London,自动处理夏令时)</div>
    ${S.team ? '<div class="pr-kv"><span>成员 / 飞书</span>在网站更新中心的「设置」里管(谁能看改价页 = 角色勾了「改价」)</div>' : ''}
  </div>`;
}

// ================= 事件 =================
document.addEventListener('click', async (ev) => {
  if (!ev.target.closest('#section-price')) return;
  const el = ev.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a;
  try {
    switch (a) {
      case 'filter': {
        filter = el.dataset.f;
        if (wantAll() && !S.allPlans) { loadingAll = true; render(); try { await load(true); } catch (e) { toast(e.message, false); } loadingAll = false; }
        render(); break;
      }
      // ---- 时间安排(第 3 期)----
      case 'schedmode': {
        if (el.disabled) return; const m = el.dataset.v; const p = E.plan; if (m === schedMode(p) || (m === 'one' && schedMode(p) === 'multi')) return; // 「按时间段」包括一段 / 几段
        const segs = scheduleSegments(p).filter((x) => x.start != null);
        const t0 = segs.length ? Math.min(...segs.map((x) => x.start)) : dayAt(1); const t1 = segs.length ? Math.max(...segs.map((x) => x.end ?? x.start + DAY)) : dayAt(8);
        if (m === 'one') { p.slots[0].start = t0; p.slots[0].end = t1;
          const a = verOf('A'); if (a) { p.slots[0].collection = a.coll || null; p.tagsAdd = [...(a.tagsAdd || [])]; p.tagsRemove = [...(a.tagsRemove || [])]; p.campaign = a.campaign || null; p.countdown = clone(a.countdown || cdBlank()); } // 回到一段时间:用价格 A 的设置
        } else ensureVersions(p); // 分段:计划上那一份设置先给价格 A
        if (m === 'multi') E.segs = segs.map((x) => ({ ...x, id: x.id || uid('s_') }));
        if (m === 'weekly') p.schedule.weekly ||= { from: toInput(t0).slice(0, 10), to: toInput(t1 - 1).slice(0, 10), rules: [{ id: uid('r_'), days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '24:00', version: 'A' }] };
        p.schedule.mode = m; touch(); render(); break;
      }
      case 'segadd': {
        const segs = scheduleSegments(); const last = segs[segs.length - 1];
        const st0 = last?.end ?? dayAt(1); const vs = versionsOf(E.plan); const nextV = vs[(vs.findIndex((v) => v.id === last?.version) + 1) % vs.length]?.id || 'A';
        E.segs = [...segs, { id: uid('s_'), start: st0, end: st0 + DAY, version: nextV }]; touch(); render(); break;
      }
      case 'segdel': { const segs = scheduleSegments(); segs.splice(+el.dataset.i, 1); E.segs = segs; touch(); render(); break; }
      case 'wday': { const r = E.plan.schedule.weekly.rules[+el.dataset.r]; const d = +el.dataset.d; r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort(); touch(); render(); break; }
      case 'wradd': { const w = E.plan.schedule.weekly; const vs = versionsOf(E.plan); w.rules.push({ id: uid('r_'), days: [6, 7], from: '00:00', to: '24:00', version: vs[1]?.id || 'A' }); touch(); render(); break; }
      case 'wrdel': { const w = E.plan.schedule.weekly; if (w.rules.length < 2) return; w.rules.splice(+el.dataset.r, 1); touch(); render(); break; }
      // ---- 价格版本 ----
      case 'vpick': E.ver = el.dataset.v; render(); break;
      case 'vcell': { // 总览表的格子:打开那一组、切到那个价格
        E.ver = el.dataset.v; E.gi = +el.dataset.i; render();
        document.querySelector('#section-price .pr-group.is-open')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
      }
      case 'coladd': { // 按时间段:接在最后一段后面加一段(自己的价格 = 自己的折扣和设置,折扣先照着正在看的那段)
        const p = E.plan; if (versionsOf(p).length >= A.MAX_VERSIONS) { toast(`一个计划最多 ${A.MAX_VERSIONS} 段`, false); return; }
        ensureVersions(p); const id = newVid(p); const from = vName(p, curV());
        p.versions = [...p.versions, { id, name: '', coll: null, tagsAdd: [], tagsRemove: [], campaign: null, countdown: cdBlank() }];
        for (const g of p.groups) (g.vrules ||= {})[id] = clone(ruleOf(g, curV()));
        const segs = scheduleSegments(p); const last = segs[segs.length - 1] || {}; const st = last.end ?? (last.start ?? dayAt(1)) + 7 * DAY;
        const len = last.end && last.start != null ? Math.min(last.end - last.start, 7 * DAY) : DAY;
        if (schedMode(p) === 'one') { p.schedule.mode = 'multi'; if (p.followCampaign) p.followCampaign = false; }
        E.segs = [...segs.map((x) => ({ ...x, id: x.id || uid('s_') })), { id: uid('s_'), start: st, end: st + len, version: id }];
        E.ver = id; ruleChanged();
        document.querySelector(`#section-price [data-f="vname"][data-v="${id}"]`)?.focus();
        toast(`加了一段(接在「${vName(p, last.version || 'A')}」后面,折扣先照着「${from}」):起个名字,改时间、折扣和这一段的设置`); break;
      }
      case 'coldel': { // 删掉一段(和它的价格)
        const p = E.plan; const id = el.dataset.v; const segs = scheduleSegments(p); if (segs.length < 2) return;
        if (!armed(el, `再点一次删掉「${vName(p, id)}」`)) return;
        E.segs = segs.filter((x) => x.version !== id);
        p.versions = versionsOf(p).filter((v) => v.id !== id); for (const g of p.groups) if (g.vrules) delete g.vrules[id];
        delete E.vitems[id]; if (E.ver === id) E.ver = E.segs[0]?.version || 'A';
        if (!p.versions.some((v) => v.id === 'A')) { /* A 被删了也没关系:一段时间以外各段用自己的价格 */ }
        ruleChanged(); break;
      }
      case 'vadd': {
        const p = E.plan; const vs = versionsOf(p); if (vs.length >= A.MAX_VERSIONS) return;
        const id = newVid(p);
        ensureVersions(p); const src = verOf(curV()) || verOf('A');
        void src;
        p.versions = [...p.versions, { id, name: '', coll: null, tagsAdd: [], tagsRemove: [], campaign: null, countdown: cdBlank() }]; // 新价格的设置从空的开始(用户:加一个价格 = 多一份它自己的设置)
        for (const g of p.groups) (g.vrules ||= {})[id] = clone(ruleOf(g, curV())); // 折扣照着正在看的价格起步
        let moved = '';
        if (schedMode(p) === 'one') { // 一段时间 → 几段时间:原来那段用价格 A,后面接一段用新价格(一天,自己改)
          const s0 = p.slots[0]; const st = s0.end ?? s0.start + 7 * DAY;
          E.segs = [{ id: s0.id, start: s0.start, end: st, version: 'A' }, { id: uid('s_'), start: st, end: st + DAY, version: id }];
          p.schedule.mode = 'multi'; moved = ',「什么时候生效」换成了「几段时间」并接了一段用它(时间自己改)';
        }
        const from = vName(p, curV()); E.ver = id; ruleChanged();
        document.querySelector(`#section-price [data-f="vname"][data-v="${id}"]`)?.focus(); // 加完马上起名
        toast(`加了一个价格(折扣先照着「${from}」)${moved}:在列头给它起名字,改各组的折扣和这一列的设置`); break;
      }
      case 'vdel': {
        const p = E.plan; const id = el.dataset.v || curV(); if (id === 'A') return;
        const usedBy = scheduleSegments(p).filter((x) => x.version === id).length + (schedMode(p) === 'weekly' ? (p.schedule.weekly.rules || []).filter((r) => r.version === id).length : 0);
        if (usedBy) { toast(`还有 ${usedBy} 段 / 条规则在用「${vName(p, id)}」,先在「什么时候生效」里换成别的价格`, false); return; }
        if (!armed(el, `再点一次删掉「${vName(p, id)}」`)) return;
        p.versions = versionsOf(p).filter((v) => v.id !== id); for (const g of p.groups) if (g.vrules) delete g.vrules[id];
        delete E.vitems[id]; E.ver = 'A'; ruleChanged(); break;
      }
      // ---- 一个产品的改价记录 ----
      case 'phist': openProductHistory(el.dataset.p, el.dataset.t || ''); break;
      case 'phv': PH.v = el.dataset.v; drawPH(); break;
      case 'phclose': PH = null; drawPH(); break;
      case 'phopen': { // 从记录里打开计划:有没保存的改动先提醒
        if (E && E.dirty && E.plan.id !== el.dataset.id && !armed(el, '有未保存的改动,再点一次打开')) return;
        PH = null; drawPH(); const p = await planByIdAll(el.dataset.id); if (p) { openEditor(p, false); loadCampaigns(); } else toast('这个计划已经删掉了', false); break;
      }
      // ---- 计划列表:分组 / 多选整理 ----
      case 'lsel': { const id = el.dataset.id; el.checked ? LV.sel.add(id) : LV.sel.delete(id); if (LV.sel.size) loadCampaigns(); render(); break; }
      case 'lselgrp': { const ids = el.dataset.ids.split(',').filter(Boolean); ids.forEach((id) => (el.checked ? LV.sel.add(id) : LV.sel.delete(id))); if (LV.sel.size) loadCampaigns(); render(); break; }
      case 'lnone': LV.sel.clear(); render(); break;
      case 'gspan': GV.span = Number(el.dataset.v) || 14; localStorage.setItem('cgp-pr-gspan', String(GV.span)); render(); break;
      case 'gnav': { const d = Number(el.dataset.d); GV.off = d ? GV.off + d * gStep() : 0; render(); break; }
      case 'lsortdir': LV.sortDir = LV.sortDir === 'desc' ? 'asc' : 'desc'; localStorage.setItem('cgp-pr-sortdir', LV.sortDir); render(); break;
      case 'lby': LV.by = el.dataset.v; LV.chip = '__all'; LV.newFolder = false; localStorage.setItem('cgp-pr-by2', LV.by); render(); break;
      case 'lchip': LV.chip = el.dataset.k; render(); break;
      case 'lnewf': if (!LV.sel.size) { toast('先在下面勾选要放进新分组的计划,再点「＋ 新分组」', false); return; } LV.newFolder = true; render(); document.querySelector('#pl-newf')?.focus(); break;
      case 'lnewf0': LV.newFolder = false; render(); break;
      case 'lmove': case 'lunfolder': {
        const f = a === 'lunfolder' ? '' : A.cleanFolder($('#pl-folder')?.value);
        if (a === 'lmove' && !f) { toast('先填分组名', false); $('#pl-folder')?.focus(); return; }
        await withBusy(el, async () => { await act({ type: 'organize', ids: [...LV.sel], folder: f }); LV.sel.clear(); render(); }); break;
      }
      case 'lcamp': {
        const c = (cache.campaigns || []).find((x) => x.id === $('#pl-camp')?.value);
        await withBusy(el, async () => { await act({ type: 'organize', ids: [...LV.sel], campaign: c ? { id: c.id, name: c.name } : null }); LV.sel.clear(); render(); }); break;
      }
      case 'tab': if (E && E.dirty && !armed(el, '有未保存的改动,再点一次离开')) return; E = null; tab = el.dataset.t; renderChrome(); render(); break;
      case 'new': openEditor(newPlan(el.dataset.kind), true); loadCampaigns(); break;
      case 'open': { const p = await planByIdAll(el.dataset.id); if (p) { openEditor(p, false); loadCampaigns(); } break; }
      case 'close': if (E.dirty && !E.isNew && !armed(el, '有未保存的改动,再点一次放弃')) return; E = null; renderChrome(); render(); break;
      case 'color': E.plan.color = el.dataset.v; touch(); render(); break;
      case 'kind': {
        if (el.disabled) return;
        const k = el.dataset.v; E.plan.kind = k;
        E.plan.compare = k === 'window' ? 'original' : 'keep';
        for (const g of E.plan.groups) g.compare = E.plan.compare;
        for (const g of E.plan.groups) if (!['manual', 'keep', 'fixed', 'amount_off'].includes(g.rule.mode)) g.rule.mode = k === 'window' ? 'percent_off' : 'percent_up';
        const s = E.plan.slots[0];
        if (k === 'permanent') { s.end = null; s.collection = null; } else if (!s.end) s.end = s.start + 7 * DAY;
        ruleChanged(); break;
      }
      case 'layer': if (el.disabled) return; E.plan.layer = el.dataset.v; touch(); render(); break;
      case 'smode': if (el.disabled) return; EG().scope.mode = el.dataset.v; E.panel = null;
        if (el.dataset.v === 'search' && !cache.vendors) api('GET', '/api/price/catalog/vendors').then((d) => { cache.vendors = d.vendors; render(); }).catch(() => {});
        scopeChanged(); break;
      case 'panel': E.panel = el.dataset.p || null; E.panelVer = el.dataset.v || null; render(); break; // data-v = 给哪个价格选(价格总览里的「选 Collection」)
      case 'vcollx': { const v = verOf(el.dataset.v); if (v) v.coll = null; touch(); render(); break; }
      case 'gomulti': { // 一段时间 → 几段时间(价格总览出现),滚到「什么时候生效」
        document.querySelector('#section-price [data-a="schedmode"][data-v="multi"]')?.click();
        setTimeout(() => [...document.querySelectorAll('#section-price .pr-sec')].find((x) => x.querySelector('.pr-sec__h')?.textContent.trim().startsWith('什么时候'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        toast('换成「几段时间」了:在下面排每一段、选用哪个价格;上面「价格总览」点「＋ 加一个价格」'); break;
      }
      case 'pick': {
        if (!window.shopify?.resourcePicker) { toast('选择器只能在 Shopify 后台里用', false); return; }
        const picked = await window.shopify.resourcePicker({ type: 'product', multiple: true, action: 'select',
          selectionIds: EG().scope.products.map((x) => (x.variants?.length ? { id: x.id, variants: x.variants.map((id) => ({ id })) } : { id: x.id })) });
        if (!picked) return;
        // 叠加:新选的排最上面(用户定的倒序);在选择器里取消勾选的就拿掉。按选项记:只勾了几个选项就只改这几个(读到产品后,全勾了会记成整个产品)
        const sc = EG().scope; const had = new Set(sc.products.map((x) => x.id)); const now0 = new Set(picked.map((x) => x.id));
        const conv = (x) => { const vs = (x.variants || []).map((v) => v.id).filter(Boolean); const whole = !vs.length || (x.totalVariants != null && vs.length >= x.totalVariants);
          return { id: x.id, title: x.title, image: x.images?.[0]?.originalSrc || '', ...(whole ? {} : { variants: vs }) }; };
        const added = picked.filter((x) => !had.has(x.id)).map(conv);
        sc.products = [...added, ...sc.products.filter((x) => now0.has(x.id)).map((x) => conv(picked.find((y) => y.id === x.id)))];
        if (added.length) toast(`加了 ${added.length} 个产品,排在最上面`);
        scopeChanged(); break;
      }
      case 'clearprod': if (!armed(el, '再点一次清空')) return; EG().scope.products = []; scopeChanged(); break;
      case 'collsearch': cache.collQ = $('#coll-q').value.trim(); await withBusy(el, async () => { cache.collSearch = (await api('GET', `/api/price/catalog/collections?q=${encodeURIComponent(cache.collQ)}`)).collections; render(); }); break;
      case 'addcoll': { const sc = EG().scope; if (!sc.collections.some((c) => c.id === el.dataset.id)) sc.collections.unshift({ id: el.dataset.id, title: el.dataset.t }); E.panel = null; scopeChanged(); break; } // 新加的排最上面
      case 'rmcoll': EG().scope.collections.splice(+el.dataset.i, 1); scopeChanged(); break;
      case 'setcoll': { const c = { id: el.dataset.id, title: el.dataset.t }; const v = E.panelVer && verOf(E.panelVer);
        if (v) v.coll = c; else curSlot().collection = c; E.panel = null; E.panelVer = null; touch(); render(); break; }
      case 'unsetcoll': curSlot().collection = null; touch(); render(); break;
      case 'fromcamp': await withBusy(el, async () => {
        const d = await api('GET', `/api/price/catalog/campaign?id=${encodeURIComponent(E.plan.campaign.id)}`);
        EG().scope = { mode: 'products', collections: [], products: d.products.map((x) => ({ id: x.id, title: x.title, image: x.image })), vendor: '', tag: '', type: '' };
        toast(`用了活动圈定的 ${d.products.length} 个产品`); scopeChanged();
      }); break;
      case 'rmtag': tagList(el.dataset.k)?.splice(+el.dataset.i, 1); touch(); render(); break;
      // ---- 改价分组 ----
      case 'gopen': if (ev.target.closest('button')) return; E.gi = +el.dataset.i; E.panel = null; render(); break;
      case 'gadd': {
        const g = newGroup(E.plan.kind, EG().rule, EG().compare); g.scope.mode = 'products';
        E.plan.groups.push(g); E.gi = E.plan.groups.length - 1; E.panel = null; E.lists[g.id] = { key: srcKey(g.scope), status: 'ok', products: [] }; ruleChanged(); break;
      }
      case 'gdel': {
        if (E.plan.groups.length < 2 || !armed(el, '再点一次删掉这组')) return;
        const i = +el.dataset.i; const gid = E.plan.groups[i].id;
        E.plan.groups.splice(i, 1); E.gi = Math.max(0, Math.min(E.gi, E.plan.groups.length - 1));
        dropItems((it) => it.group === gid); delete E.lists[gid]; ruleChanged(); break;
      }
      case 'gup': case 'gdown': {
        const i = +el.dataset.i; const j = a === 'gup' ? i - 1 : i + 1; const gs = E.plan.groups;
        if (j < 0 || j >= gs.length) return;
        [gs[i], gs[j]] = [gs[j], gs[i]]; E.gi = j; ruleChanged(); break;
      }
      case 'unmanual': { // 手改过的变体:回到它那组规则算出来的价(几种价格时只回那一列的价格)
        const ver = el.dataset.ver || curV();
        const it = (E.vitems?.[ver] || items()).find((x) => x.variantId === el.dataset.v); if (!it) return;
        const g = E.plan.groups.find((x) => x.id === it.group) || E.plan.groups[0];
        it.manual = false; it.price = null;
        const gr = ruleOf(g, ver);
        try { if (!['keep', 'manual'].includes(gr.mode)) it.price = core.priceByRule({ price: it.refPrice, compareAt: it.refCompareAt }, gr); } catch { /* 规则没填好 */ }
        touch(); render(); break;
      }
      case 'reload': { const g = E.plan.groups.find((x) => x.id === el.dataset.g) || EG();
        await withBusy(el, () => loadGroup(g, { force: true })); groupVariantIds(g).forEach((id) => STK.map.delete(id)); STK.err = '';
        if (g.scope.stock === 'uk') wantStock(groupVariantIds(g)); toast('已从店里重新读(价格和库存)'); render(); break; } // 店里改了产品 / 价格 / 库存时用
      case 'tfilter': (E.tf[el.dataset.g] ||= {}).only = el.dataset.v || ''; render(); break;
      case 'sstock': if (el.disabled) return; { const g = EG(); if (el.dataset.v) g.scope.stock = 'uk'; else delete g.scope.stock;
        if (g.scope.stock) wantStock(groupVariantIds(g)); ruleChanged(); } break;
      case 'stkretry': STK.err = ''; wantStock(E.plan.groups.flatMap(groupVariantIds)); render(); break;
      case 'rmnostock': { const g = E.plan.groups.find((x) => x.id === el.dataset.g); if (!g) return;
        const ids = items().filter((i) => i.group === g.id && noStock(stockOf(i.variantId))).map((i) => i.variantId);
        if (!ids.length) return; pickDelete(g, ids); dropItems((i) => ids.includes(i.variantId)); E.calcKey = scopeKey(P()); touch(); render();
        toast(`删除了 ${ids.length} 个 UK 仓没货的选项`); break; }
      case 'cmpopen': (E.cmpOpen ||= {})[el.dataset.g] = !E.cmpOpen[el.dataset.g]; render(); break;
      case 'fillcmp': { // 逐个指定划线价:一键填 = 现价 × X%(手动单独改过的不动)
        const pct = Number($(`#fillpct-${el.dataset.g}`)?.value); if (!(pct > 100)) { toast('填一个大于 100 的百分比,比如 120', false); return; }
        let n = 0; for (const it of items()) if (it.group === el.dataset.g && !it.cmpManual) { const c = (Math.round(Number(it.refPrice) * pct) / 100).toFixed(2); for (const x of sameVariant(it.variantId)) if (!x.cmpManual) x.compareAt = c; n++; }
        toast(`填好了 ${n} 个选项的划线价(现价的 ${pct}%)`); touch(); render(); break;
      }
      case 'uncmp': { for (const it of sameVariant(el.dataset.v)) { it.cmpManual = false; delete it.compareAt; } touch(); render(); break; }
      case 'showall': E.showAllG ||= {}; E.showAllG[el.dataset.g] = !E.showAllG[el.dataset.g]; render(); break;
      case 'rm': case 'rmzero': { // 去掉:记在这一组上(加产品、改规则、重新读都不会再加回来),下面「已去掉」里能恢复
        const g = E.plan.groups.find((x) => x.id === el.dataset.g);
        const ids = a === 'rmzero' ? items().filter((i) => i.group === g?.id && !(Number(i.refPrice) > 0)).map((i) => i.variantId) : (el.dataset.vs || el.dataset.v).split(',');
        const byG = new Map(); for (const it of items()) if (ids.includes(it.variantId)) byG.set(it.group, [...(byG.get(it.group) || []), it.variantId]);
        let picked = false;
        for (const [gid, vs] of byG) {
          const gg = E.plan.groups.find((x) => x.id === gid); if (!gg) continue;
          if (isPick(gg)) { pickDelete(gg, vs); picked = true; } // 指定产品:直接从选的清单里删掉
          else gg.removed = [...new Set([...(gg.removed || []), ...vs])]; // Collection / 品牌标签 / 全店:排除
        }
        dropItems((i) => ids.includes(i.variantId)); E.calcKey = scopeKey(P()); touch(); render();
        if (a === 'rmzero') toast(picked ? `删除了 ${ids.length} 个现价为 £0 的选项` : `排除了 ${ids.length} 个现价为 £0 的选项,下面「已排除」里能恢复`);
        break;
      }
      case 'unrm': { // 恢复去掉的(这一组的产品没读到就先读);恢复一个后「已排除」保持展开,方便接着恢复(2026-11-03 用户)
        const g = E.plan.groups.find((x) => x.id === el.dataset.g); if (!g) return;
        (E.rmOpen ||= {})[g.id] = !!el.dataset.v; // 恢复全部后就没东西了,不用再展开
        const back = el.dataset.v ? [el.dataset.v] : [...(g.removed || [])];
        g.removed = (g.removed || []).filter((id) => !back.includes(id)); touch();
        if (E.lists[g.id]?.status === 'ok') { recompute(); render(); } else { await loadGroup(g); recompute(); render(); }
        break;
      }
      case 'loadall': await withBusy(el, () => loadGroup(EG(), { force: true })); break;
      case 'startnow': curSlot().start = now() + 60_000; touch(); render(); break;
      case 'togglepending': E.showPending = !E.showPending; render(); break;
      case 'save': {
        const mode = el.dataset.m;
        if (!E.plan.name.trim()) { toast('先填计划名称', false); $('[data-f=name]')?.focus(); return; }
        await withBusy(el, async () => {
          await ensureCalc(); render(); // 每组的产品都读好、按最新设置算好再存
          const r = await act({ type: 'save', mode, id: E.plan.id, isNew: E.isNew, values: values() });
          if (mode === 'draft') { E.isNew = false; E.dirty = false; await reopen(r.id); } else { E = null; renderChrome(); render(); }
        });
        break;
      }
      case 'approve': await withBusy(el, async () => { await act({ type: 'approve', id: E.orig.id }); await reopen(E.orig.id); }); break;
      case 'reject': await withBusy(el, async () => { await act({ type: 'reject', id: E.orig.id, note: $('#reject-note')?.value || '' }); E = null; renderChrome(); render(); }); break;
      case 'pause': case 'resume': await withBusy(el, async () => { await act({ type: a, id: E.orig.id }); await reopen(E.orig.id); }); break;
      case 'stop': if (!armed(el, '再点一次:提前结束(回到改价前)')) return; await withBusy(el, async () => { await act({ type: 'stop', id: E.orig.id }); await reopen(E.orig.id); }); break;
      case 'delete': if (!armed(el)) return; await withBusy(el, async () => { await act({ type: 'delete', id: E.orig.id }); E = null; renderChrome(); render(); }); break;
      case 'exclude': if (!armed(el, '再点一次:移出(回到改价前)')) return; await withBusy(el, async () => { await act({ type: 'exclude', id: E.orig.id, variantIds: (el.dataset.vs || el.dataset.v).split(',') }); await reopen(E.orig.id); }); break;
      case 'history': if (window.cgpPlanHistory) window.cgpPlanHistory(E.orig.id); break;
      case 'dup': case 'dupnext': {
        const src = clone(P());
        const shift = a === 'dupnext' ? DAY : 0;
        const slots = src.slots.map((s) => ({ ...s, id: uid('s_'), start: s.start + shift, end: s.end == null ? null : s.end + shift }));
        if (shift && src.schedule?.weekly) { const mv = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + DAY).toISOString().slice(0, 10); src.schedule = { ...src.schedule, weekly: { ...src.schedule.weekly, from: mv(src.schedule.weekly.from), to: mv(src.schedule.weekly.to) } }; }
        const name = a === 'dupnext' ? `${src.name.replace(/(第\s*\d+\s*天|D\d+)$/, '').trim()} ${fmtD(slots[0].start)}` : `${src.name}(副本)`;
        openEditor({ ...src, id: uid('p_'), name, state: 'new', slots, excluded: [], applied: {}, pendingChange: null, paused: false, stopped: false }, true);
        if (shift) toast('已复制成下一天,确认时间和产品后提交');
        break;
      }
      case 'qapprove': await withBusy(el, async () => { await act({ type: 'approve', id: el.dataset.id }); render(); }); break;
      case 'qpause': { const p = planById(el.dataset.id); await withBusy(el, async () => { await act({ type: p.paused ? 'resume' : 'pause', id: p.id }); render(); }); break; }
      case 'qstop': if (!armed(el, '再点一次:提前结束(回到改价前)')) return; await withBusy(el, async () => { await act({ type: 'stop', id: el.dataset.id }); render(); }); break;
      case 'qdup': case 'qdupnext': { const p = planById(el.dataset.id); openEditor(p, false); loadCampaigns();
        document.querySelector(`#section-price [data-a="${a === 'qdupnext' ? 'dupnext' : 'dup'}"]`)?.click(); break; }
      case 'fixhold': await withBusy(el, async () => { await act({ type: 'resolve', variantId: el.dataset.v, choice: el.dataset.c }); render(); }); break;
      case 'collrelease': if (!armed(el, '再点一次:不再管(已经加进去的产品留在里面)')) return;
        await withBusy(el, async () => { await api('POST', '/api/price/coll-release', { id: el.dataset.id }); toast('好,app 不再管这个 Collection 了'); await load(); render(); }); break;
      case 'goneprods': await withBusy(el, async () => {
        const g = S.goneCollections?.[el.dataset.id]; if (!g?.left?.length) return;
        const ps = (await api('GET', `/api/price/catalog/products?ids=${g.left.slice(0, 80).join(',')}`)).products;
        (cache.goneNames ||= {})[el.dataset.id] = [...ps.map((x) => x.title), ...(g.left.length > 80 ? [`…共 ${g.left.length} 个`] : [])]; render();
      }); break;
      case 'runnow': await withBusy(el, async () => { const r = await api('POST', '/api/price/run-now'); toast(`对齐完成:改价 ${r.written} 个,暂停接管 ${r.holds} 个,失败 ${r.failures} 个`); await load(); render(); }); break;
      case 'dlvault': await withBusy(el, () => download('/api/price/export/vault.csv', `还原表格-${toInput(now()).slice(0, 10)}.csv`)); break;
      case 'dlledger': await withBusy(el, () => download(`/api/price/export/ledger.csv?plan=${encodeURIComponent(ledgerQ.plan)}`, `价格账本-${toInput(now()).slice(0, 10)}.csv`)); break;
      case 'lpage': ledgerQ.offset = Math.max(0, ledgerQ.offset + Number(el.dataset.d) * 100); loadLedger(); break;
      case 'opennotify': window.cgpOpenNotify?.(); break;
      case 'copylink': window.cgpNav?.copy(null, '这个改价计划的链接'); break;
      case 'savesafe': await withBusy(el, async () => { await api('PUT', '/api/price/settings', { maxDiscountPct: $('#maxoff').value, sweepMinutes: $('#sweep').value }); toast('已保存'); await load(); render(); }); break;
      default: break;
    }
  } catch (e) { toast(e.message, false); }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (!el.closest('#section-price')) return;
  if (el.dataset.a === 'notify') { try { await api('PUT', '/api/price/settings', { notify: { [el.dataset.k]: el.checked } }); await load(); } catch (e) { toast(e.message, false); } return; }
  if (el.id === 'lplan') { ledgerQ.plan = el.value; ledgerQ.offset = 0; loadLedger(); return; }
  if (el.dataset.lv === 'sort') { LV.sort = el.value; LV.sortDir = ['start', 'end'].includes(el.value) ? 'asc' : 'desc'; localStorage.setItem('cgp-pr-sort', LV.sort); localStorage.setItem('cgp-pr-sortdir', LV.sortDir); render(); return; } // 开始 / 结束时间默认早的在上,创建 / 编辑时间默认新的在上
  if (el.id === 'ukloc') { try { await api('PUT', '/api/price/settings', { ukLocation: el.value }); STK.map.clear(); STK.loc = null; STK.err = ''; toast('已保存:UK 可售按这个仓库算'); await load(); render(); } catch (e) { toast(e.message, false); } return; }
  if (!E) return;
  if (el.name === 'rmode') {
    ruleOf(EG(), curV()).mode = el.value;
    if (el.value === 'keep' && E.plan.kind === 'window' && ['original', 'keep', 'price'].includes(EG().compare)) { // 售价不变还用原划线价 = 什么都没改
      EG().compare = 'set'; E.plan.compare = E.plan.groups[0].compare; toast('售价不变时要把划线价调高(虚拟折扣):已切到「逐个指定划线价」,表格上面可以一键填');
    }
    ruleChanged(); return;
  }
  const f = el.dataset.f;
  if (!f) return;
  const s = curSlot();
  const norm = (v) => { const t = String(v).trim().replace(/^£/, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n.toFixed(2) : undefined; };
  switch (f) {
    case 'name': E.plan.name = el.value; touch(); break;
    case 'folder': { // 分组随时能改、不影响改价:已有的计划马上存(不用点保存,也不会把编辑中的其他改动带上)
      const f = A.cleanFolder(el.value); E.plan.folder = f;
      if (E.isNew || !E.orig) { touch(); break; }
      try { await api('POST', '/api/price/act', { action: { type: 'organize', ids: [E.orig.id], folder: f } }); E.orig.folder = f; toast(f ? `已移到分组「${f}」` : '已移出分组'); load().catch(() => {}); }
      catch (e) { toast(e.message, false); }
      break;
    }
    case 'note': E.plan.note = el.value; touch(); break;
    case 'gname': EG().name = el.value.replace(/\s+/g, ' ').trim().slice(0, 30); touch(); render(); break;
    case 'vname': { const id = el.dataset.v || curV(); if (!E.plan.versions?.length) E.plan.versions = versionsOf(E.plan).map((x) => ({ ...x }));
      const nm = el.value.replace(/\s+/g, ' ').trim().slice(0, 20);
      if (nm && E.plan.versions.some((x) => x.id !== id && x.name === nm)) { toast(`已经有一个价格叫「${nm}」了,换个名字`, false); render(); return; }
      const v = E.plan.versions.find((x) => x.id === id); if (v) v.name = nm; touch(); render(); break; }
    case 'segstart': case 'segend': case 'segver': {
      const segs = scheduleSegments(); const sg = segs[+el.dataset.i]; if (!sg) return;
      if (f === 'segver') sg.version = el.value; else sg[f === 'segstart' ? 'start' : 'end'] = fromInput(el.value);
      E.segs = segs.sort((a, b) => (a.start ?? 0) - (b.start ?? 0)); touch(); render(); break;
    }
    case 'wfrom': case 'wto': E.plan.schedule.weekly[f === 'wfrom' ? 'from' : 'to'] = el.value; touch(); render(); break;
    case 'wrfrom': case 'wrto': case 'wrver': {
      const r = E.plan.schedule.weekly.rules[+el.dataset.r]; if (!r) return;
      if (f === 'wrver') r.version = el.value;
      else { const v = el.value.trim(); if (!/^([01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(v)) { toast('时间写成 09:00 这样;一整天写 00:00 到 24:00', false); render(); return; } r[f === 'wrfrom' ? 'from' : 'to'] = v.padStart(5, '0'); }
      touch(); render(); break;
    }
    case 'compare': EG().compare = el.value; E.plan.compare = E.plan.groups[0].compare; (E.cmpOpen ||= {})[EG().id] = false; touch(); render(); break; // 改的是正在编辑的那一组;选完收起
    case 'cdon': E.plan.countdown.on = el.checked; touch(); render(); break;
    case 'cdlabel': E.plan.countdown.label = el.value.slice(0, 60); touch(); render(); break;
    case 'cddays': E.plan.countdown.days = Number(el.value) || 0; touch(); render(); break;
    case 'cdstyle': E.plan.countdown.style = el.value; touch(); render(); break;
    // 价格总览里每个价格自己的设置
    case 'vcamp': { const v = verOf(el.dataset.v); const c = (cache.campaigns || []).find((x) => x.id === el.value); if (v) v.campaign = c ? { id: c.id, name: c.name } : null;
      if (v?.id === 'A') { E.plan.campaign = v.campaign; if (!c) E.plan.followCampaign = false; else if (E.plan.followCampaign) applyCampaignTime(); } // 「跟随活动时间」看价格 A 的活动
      touch(); render(); break; }
    case 'vcdon': case 'vcdlabel': case 'vcddays': case 'vcdstyle': { const v = verOf(el.dataset.v); if (!v) return; const c = (v.countdown ||= cdBlank());
      if (f === 'vcdon') c.on = el.checked; else if (f === 'vcdlabel') c.label = el.value.slice(0, 60); else if (f === 'vcddays') c.days = Number(el.value) || 0; else c.style = el.value;
      touch(); render(); break; }
    case 'priority': { const n = Math.round(Number(el.value)); E.plan.priority = n >= 1 && n <= core.PRIO_MAX ? n : core.PRIO_MAX; touch(); render(); break; }
    case 'rvalue': clearTimeout(E.rvT); if (ruleOf(EG(), curV()).value !== el.value) { ruleOf(EG(), curV()).value = el.value; ruleChanged(); } break;
    case 'rrounding': ruleOf(EG(), curV()).rounding = el.value; ruleChanged(); break;
    case 'rfrom': ruleOf(EG(), curV()).from = el.value; ruleChanged(); break;
    case 'svendor': case 'stag': case 'stype': { clearTimeout(E.svT); const k = { svendor: 'vendor', stag: 'tag', stype: 'type' }[f]; if (EG().scope[k] !== el.value.trim()) { EG().scope[k] = el.value.trim(); scopeChanged(); } break; }
    case 'campaign': {
      const c = (cache.campaigns || []).find((x) => x.id === el.value);
      E.plan.campaign = c ? { id: c.id, name: c.name } : null;
      if (!c) E.plan.followCampaign = false; else if (E.plan.followCampaign) applyCampaignTime();
      touch(); render(); break;
    }
    case 'followcamp': E.plan.followCampaign = el.checked; if (el.checked) { if (schedMode(E.plan) !== 'one') { const sg = scheduleSegments(E.plan); E.plan.slots[0].start = sg[0]?.start; E.plan.slots[0].end = sg[sg.length - 1]?.end; E.plan.schedule.mode = 'one'; toast('跟随活动时间只能是「一段时间」,已切换'); } applyCampaignTime(); } touch(); render(); break;
    case 'owner': E.plan.owner = el.value || null; touch(); break;
    case 'approver': E.plan.approver = el.value || null; touch(); render(); break; // 换审批人会改变底部按钮(审批人自己提交 = 直接生效)
    case 'cc': { const set = new Set(E.plan.cc || []); el.checked ? set.add(el.value) : set.delete(el.value); E.plan.cc = [...set]; touch(); break; }
    case 'start': s.start = fromInput(el.value); touch(); render(); break;
    case 'end': s.end = fromInput(el.value); touch(); render(); break;
    case 'iprice': case 'icompare': {
      const v = norm(el.value); if (v === undefined) { toast('价格格式不对', false); render(); return; }
      if (f === 'iprice') { // 手改过的,重新试算时保留;几种价格并排时改的是那一列的价格(data-ver)
        const it = (E.vitems?.[el.dataset.ver || curV()] || items()).find((i) => i.variantId === el.dataset.v); if (!it) return;
        it.price = v; it.manual = true; touch(); render(); break;
      }
      // 划线价对每个价格都一样(都按原来的价算):几种价格时一起改
      for (const it of sameVariant(el.dataset.v)) {
        if (core.cmpModeOf(E.plan, it) === 'set' && !it.cmpManual) it.compareAt = v;
        else if (String(el.value).trim() === '') { it.cmpManual = false; delete it.compareAt; } // 清空 = 回到上面选的方式
        else { it.cmpManual = true; it.compareAt = Number(v) > 0 ? v : null; }              // 单独例外(0 = 这个变体不显示划线价)
      }
      touch(); render(); break;
    }
    default: break;
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.dataset?.lv === 'q' && !E) { // 搜计划 / 产品 / SKU:停一下再刷新,刷新后光标放回去
    const v = ev.target.value; clearTimeout(LV.qT);
    LV.qT = setTimeout(() => { LV.q = v; render(); const n = document.querySelector('#section-price [data-lv="q"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250);
    return;
  }
  if (ev.target.id === 'lq') { clearTimeout(ev.target._t); ev.target._t = setTimeout(() => { ledgerQ.q = ev.target.value; ledgerQ.offset = 0; loadLedger(); }, 300); }
  if (!E || !ev.target.closest('#section-price')) return;
  const f = ev.target.dataset.f;
  if (f === 'name') { E.plan.name = ev.target.value; E.dirty = true; const b = document.querySelector('#section-price .pr-sum__h b'); if (b) b.textContent = ev.target.value || '(还没起名字)'; }
  if (f === 'rvalue') { const v = ev.target.value; clearTimeout(E.rvT); E.rvT = setTimeout(() => { if (E && ruleOf(EG(), curV()).value !== v) { ruleOf(EG(), curV()).value = v; ruleChanged(); } }, 350); }
  if (['svendor', 'stag', 'stype'].includes(f)) {
    const k = { svendor: 'vendor', stag: 'tag', stype: 'type' }[f]; const v = ev.target.value.trim(); clearTimeout(E.svT);
    E.svT = setTimeout(() => { if (E && EG().scope[k] !== v) { EG().scope[k] = v; scopeChanged(); } }, 600);
  }
  if (ev.target.dataset.tq) { const gq = ev.target.dataset.tq; clearTimeout(E.tqT); const v = ev.target.value; E.tqT = setTimeout(() => { if (E) { (E.tf[gq] ||= {}).q = v; render(); } }, 250); }
});
// 标签输入框:回车添加
document.addEventListener('keydown', (ev) => {
  const k = ev.target.dataset?.addtag;
  if (!k || ev.key !== 'Enter' || !E) return;
  ev.preventDefault();
  const t = ev.target.value.trim(); const list = tagList(k);
  if (t && list && !list.includes(t)) { list.push(t); touch(); render(); document.querySelector(`#section-price [data-addtag="${k}"]`)?.focus(); }
  else ev.target.value = '';
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'coll-q') $('[data-a=collsearch]')?.click(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && PH) { PH = null; drawPH(); } });
// 「已排除」展开 / 收起:记住(重画后照样)。toggle 事件不冒泡,用捕获
document.addEventListener('toggle', (ev) => { const d = ev.target; if (E && d.matches?.('details.pr-removed[data-rmg]')) (E.rmOpen ||= {})[d.dataset.rmg] = d.open; }, true);
// 「＋ 新分组」:起名字回车 = 勾选的计划放进这个新分组
document.addEventListener('keydown', async (ev) => {
  if (ev.target.id !== 'pl-newf' || ev.key !== 'Enter') return; ev.preventDefault();
  const f = A.cleanFolder(ev.target.value); if (!f) return;
  try { await act({ type: 'organize', ids: [...LV.sel], folder: f }); LV.sel.clear(); LV.newFolder = false; LV.by = 'folder'; LV.chip = f; render(); } catch (e) { toast(e.message, false); }
});

async function loadLocations() {
  if (cache.locsBusy) return; cache.locsBusy = true;
  try { cache.locs = await api('GET', '/api/price/catalog/locations'); } catch (e) { cache.locs = { err: e.message, locations: [] }; }
  cache.locsBusy = false; if (!E && tab === 'settings') render();
}
async function loadCampaigns(rerender) {
  if (cache.campaigns) { if (rerender) render(); return; }
  try { cache.campaigns = (await api('GET', '/api/price/campaigns')).campaigns; } catch { cache.campaigns = []; }
  if (E || LV.sel.size) render(); // 列表多选时「关联活动」下拉要用
}

// 每 30 秒刷新一次状态(执行器在后台改价;只在看改价页、没在编辑时)
const visible = () => document.getElementById('section-price')?.classList.contains('is-active');
setInterval(async () => { if (!S || E || document.hidden || !visible()) return; try { await load(); if (tab !== 'ledger') render(); } catch { /* 忽略 */ } }, 30_000);

// ================= 启动 =================
// 点开「改价」时才加载(registry.js 的 showSection 是全局函数,包一层)
let booted = false;
async function start() {
  // 再次进入:先用手上的数据马上画出来,再在后台读最新的(以前要等读完才换,看起来像卡住)
  if (booted) { if (!E && S) render(); try { await load(); if (!E) render(); } catch { /* 忽略 */ } return; }
  booted = true;
  if (S) render(); else $('#pr-root').innerHTML = '<div class="pr-empty">加载中…</div>'; // 第一次:打开 app 时多半已经读好了
  try { await load(); render(); }
  catch (e) { booted = false; $('#pr-root').innerHTML = `<div class="banner banner--danger">${esc(e.message)}</div>`; }
}
// 活动总控台里点改价计划 / 「+ 改价计划」时用
// 历史版本抽屉用:把某一版复制成新计划 / 回滚后刷新
window.cgpPriceCopy = async (vals, when) => {
  await start();
  const slots = (vals.slots || []).map((x) => ({ ...x, id: uid('s_') }));
  openEditor({ ...vals, id: uid('p_'), name: `${vals.name || ''}(复制)`, state: 'new', slots, excluded: [], applied: {}, pendingChange: null, paused: false, stopped: false }, true);
  loadCampaigns(); toast(`已复制 ${when || ''} 那一版,改好时间再提交`);
};
window.cgpPriceRefresh = async () => { await load(); render(); };
window.cgpPriceOpen = async (id) => { await start(); const p = await planByIdAll(id); if (p) { openEditor(p, false); loadCampaigns(); } };
window.cgpPriceNew = async (campaign) => { await start(); const p = newPlan('window', false); p.campaign = campaign; p.name = campaign.name; openEditor(p, true); loadCampaigns(); };
// 网址(public/nav.js):改价页现在看哪一块;null = 新建还没保存的计划(没有 id,不改网址)
window.cgpPricePath = () => (E ? (E.isNew || !E.orig?.id ? null : `/${encodeURIComponent(E.orig.id)}`) : tab === 'plans' ? '' : `/${tab}`);
// 打开网址:/price/vault 这类是分页,别的当计划 id
window.cgpPriceRoute = async (sub) => {
  if (!S) { await start(); if (!S) return; } // 读不到(start 已经把原因显示出来了)
  const isTab = SUBTABS.some(([k]) => k === sub);
  const planId = sub && !isTab ? sub : null;
  if (E && E.orig?.id && E.orig.id === planId) return;
  if (E && E.dirty) { toast('这个计划有还没保存的改动:先保存,或点「← 返回」放弃', false); return; } // 后退键别把改了一半的计划丢掉
  if (planId) {
    const p = await planByIdAll(planId);
    if (p) { openEditor(p, false); loadCampaigns(); return; }
    toast('找不到这个改价计划(可能已经删掉了)', false);
  }
  E = null; tab = isTab ? sub : 'plans'; renderChrome(); render();
};
const show0 = window.showSection;
window.showSection = (name) => { show0(name); if (name === 'price') start(); };
await window.CGP_AUTH;
if (window.cgpCanSee('price')) { try { await load(); } catch { /* 进页面时再试 */ } }
