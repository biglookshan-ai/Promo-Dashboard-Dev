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
const meActor = () => ({ id: S.me.id, name: S.me.name, role: S.me.admin ? 'approver' : 'editor' });
const canApprove = (plan) => A.canApprove(meActor(), plan);
const nameOf = (id) => S.people.find((u) => u.id === id)?.name || '同事';
const planById = (id) => S.plans.find((p) => p.id === id);
const STATUS_TAG = { draft: '', pending: 'tag--warn', rejected: 'tag--danger', scheduled: 'tag--accent', running: 'tag--ok', paused: 'tag--warn', ended: '', done: '' };
const statusOf = (p) => core.planStatus(p, now());
const layerCls = (p) => (p.kind === 'permanent' ? 'L-perm' : `L-${p.layer}`);
const kindLabel = (p) => (p.kind === 'permanent' ? '永久调价' : `${core.LAYER_CN[p.layer] || ''} · 限时`);
const holdsOf = (planId) => S.vault.filter((v) => v.hold && (!planId || v.hold.planId === planId));

async function load() {
  S = await api('GET', '/api/price/state');
  renderChrome();
}

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
  return `<div class="pr-head"><div><h2>改价</h2><p class="muted">限时 / 永久改价 · 指定审批人 · 到点自动改 · 到期自动恢复 · 通知只私信相关的人</p></div>
    ${e.lastError ? `<span class="pr-chip pr-chip--warn" title="${esc(e.lastError)}">执行器出错:${esc(e.lastError.slice(0, 40))}</span>` : `<span class="pr-chip">执行器 · ${e.lastRun ? ago(e.lastRun) + '对齐' : '还没运行'}</span>`}</div>
  <div class="pr-subnav">${SUBTABS.map(([k, l]) => `<button class="${!E && tab === k ? 'is-on' : ''}" data-a="tab" data-t="${k}">${l}${k === 'plans' && pend ? ` <span class="modnav__n modnav__n--alert">${pend}</span>` : ''}${k === 'vault' && holds ? ` <span class="modnav__n modnav__n--alert">${holds}</span>` : ''}</button>`).join('')}</div>`;
}

function render() {
  const root = $('#pr-root');
  if (E) { root.innerHTML = editorHtml(); return; }
  root.innerHTML = headHtml() + { plans: plansHtml, vault: vaultHtml, ledger: () => '<div id="ledger-root"><p class="muted">加载中…</p></div>', settings: settingsHtml }[tab]();
  if (tab === 'ledger') loadLedger();
}

// ================= 改价计划列表 =================
const FILTERS = [
  ['active', '进行中 + 待执行', (s) => ['running', 'paused', 'scheduled', 'pending'].includes(s)],
  ['running', '进行中', (s) => ['running', 'paused'].includes(s)],
  ['scheduled', '已排期', (s) => s === 'scheduled'],
  ['pending', '待审核', (s, p) => s === 'pending' || !!p.pendingChange],
  ['draft', '草稿 / 被退回', (s) => ['draft', 'rejected'].includes(s)],
  ['ended', '已结束', (s) => ['ended', 'done'].includes(s)],
  ['all', '全部', () => true],
];
const ORDER = { running: 0, paused: 1, scheduled: 2, pending: 3, rejected: 4, draft: 5, ended: 6, done: 7 };

function plansHtml() {
  const st = S.plans.map((p) => ({ p, s: statusOf(p) }));
  const count = (f) => st.filter(({ p, s }) => f(s, p)).length;
  const live = S.vault.filter((v) => v.written && !v.hold).length;
  const f = FILTERS.find((x) => x[0] === filter) || FILTERS[0];
  const list = st.filter(({ p, s }) => f[2](s, p)).sort((a, b) => ORDER[a.s] - ORDER[b.s] || A.planSummary(a.p).start - A.planSummary(b.p).start);
  return `
  <div class="stats">
    <button class="stat" data-a="filter" data-f="running"><div class="stat__n">${count(FILTERS[1][2])}</div><div class="stat__l">进行中的计划</div></button>
    <button class="stat" data-a="filter" data-f="scheduled"><div class="stat__n">${count(FILTERS[2][2])}</div><div class="stat__l">已排期</div></button>
    <button class="stat ${count(FILTERS[3][2]) ? 'stat--danger' : ''}" data-a="filter" data-f="pending"><div class="stat__n">${count(FILTERS[3][2])}</div><div class="stat__l">待审核</div></button>
    <button class="stat" data-a="tab" data-t="vault"><div class="stat__n">${live}</div><div class="stat__l">正在活动价上的变体</div></button>
    <button class="stat ${holdsOf().length ? 'stat--danger' : ''}" data-a="tab" data-t="vault"><div class="stat__n">${holdsOf().length}</div><div class="stat__l">暂停接管(要处理)</div></button>
  </div>
  ${ganttHtml()}
  <div class="toolbar">
    <button class="btn btn-primary" data-a="new" data-kind="window">+ 限时改价</button>
    <button class="btn" data-a="new" data-kind="permanent">+ 永久调价</button>
    <span class="muted">Flash 每天一组:建好第一天,在计划里点「复制成下一天」</span>
    <span class="spacer"></span>
  </div>
  <div class="pr-tabs">${FILTERS.map(([k, label, fn]) => `<button class="${k === filter ? 'is-on' : ''}" data-a="filter" data-f="${k}">${label} ${count(fn)}</button>`).join('')}</div>
  ${list.length ? list.map(({ p, s }) => planRow(p, s)).join('') : '<div class="pr-empty">这里还没有计划</div>'}`;
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
  const r = p.rule ? RULE_MODES[p.rule.mode] : null;
  const how = r ? r.say(p.rule.value) : '按逐个产品设定的价格';
  return `把 <b>${n}</b> 个产品${p.kind === 'permanent' ? '永久' : '在活动期间'}:${how}`;
}
function planRow(p, s) {
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
      ...(ap ? [btn('qpause', p.paused ? '继续' : '暂停(恢复原价)')] : []),
      btn('qstop', '提前结束', 'btn-danger'),
    ] : []),
    ...(s === 'pending' && ap ? [btn('qapprove', '批准', 'btn-ok')] : []),
    btn('qdup', '复制'),
    ...(p.kind === 'window' && sum.end ? [btn('qdupnext', '复制成下一天')] : []),
  ].join('');
  return `<div class="plan">
    <div class="plan__bar ${layerCls(p)}" style="${p.color ? `background:${esc(p.color)}` : ''}"></div>
    <div data-a="open" data-id="${p.id}" style="cursor:pointer">
      <div class="plan__name">${esc(p.name || '未命名计划')}
        <span class="tag ${STATUS_TAG[s]}">${core.STATUS_CN[s]}</span>
        <span class="tag ${p.kind === 'window' ? 'tag--' + layerCls(p) : ''}">${kindLabel(p)}</span>
        ${p.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}
        ${holds ? `<span class="tag tag--danger">${holds} 个暂停接管</span>` : ''}
        ${p.campaign ? `<span class="tag">活动:${esc(p.campaign.name)}</span>` : ''}
        <span class="tag">审批:${p.approver ? esc(nameOf(p.approver)) : '管理员'}</span>${p.owner ? `<span class="tag">负责:${esc(nameOf(p.owner))}</span>` : ''}
      </div>
      <div class="plan__say">${planSay(p)}</div>
      <div class="plan__prods">${prods.slice(0, 3).map((i) => `<span>${esc(i.product || i.title)}</span>`).join('')}${prods.length > 3 ? `<span class="muted">…另有 ${prods.length - 3} 个产品</span>` : ''}</div>
      <div class="plan__meta">
        <span>${fmtT(sum.start)}${sum.end ? ' → ' + fmtT(sum.end) : ' 起生效'}</span>
        ${s === 'running' && sum.end ? `<span class="tx-ok">还剩 ${leftTxt(sum.end)}</span>` : s === 'scheduled' ? `<span>${leftTxt(sum.start)}后开始</span>` : ''}
        <span>${sum.products} 个产品 / ${sum.variants} 个变体</span>
        ${maxOff > 0 ? `<span>最大降幅 ${maxOff}%</span>` : ''}
        ${live ? `<span>此刻 ${live} 个变体在活动价上</span>` : ''}
        ${(p.tagsAdd || []).length ? `<span>加标签 ${p.tagsAdd.map(esc).join('、')}</span>` : ''}
        ${p.state === 'rejected' && p.rejectNote ? `<span style="color:var(--danger)">退回意见:${esc(p.rejectNote)}</span>` : ''}
      </div>
      <div class="muted plan__tz">店铺时区 Europe/London · 你的时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
    </div>
    <div class="plan__acts">${acts}</div>
  </div>`;
}

// 接下来 14 天的时间轴(每个时段一条)
function ganttHtml() {
  const t0 = dayAt(0); const t1 = t0 + 14 * DAY; const span = t1 - t0;
  const rows = S.plans.filter((p) => !['draft', 'rejected'].includes(statusOf(p)) && !p.stopped && p.slots.some((s) => (s.end ?? s.start + DAY) > t0 && s.start < t1))
    .sort((a, b) => A.planSummary(a).start - A.planSummary(b).start);
  if (!rows.length) return '';
  const pct = (ms) => `${((Math.min(Math.max(ms, t0), t1) - t0) / span) * 100}%`;
  const days = Array.from({ length: 14 }, (_, i) => dayAt(i));
  const nowLeft = pct(now());
  return `<div class="gantt"><div class="gantt__grid">
    <div></div><div class="gantt__days">${days.map((d, i) => `<span class="${i === 0 ? 'is-today' : ''}">${fmtD(d)}</span>`).join('')}</div>
    ${rows.map((p) => `<div class="gantt__label" data-a="open" data-id="${p.id}" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="gantt__lane">${p.slots.map((s, i) => {
        const end = s.end ?? s.start + DAY / 3;
        if (end <= t0 || s.start >= t1) return '';
        return `<div class="gantt__slot ${layerCls(p)} ${p.state === 'pending' ? 'is-pending' : ''}" style="left:${pct(s.start)};width:calc(${pct(end)} - ${pct(s.start)})" data-a="open" data-id="${p.id}" data-slot="${i}"
          title="${esc(p.name)} · ${fmtT(s.start)}${s.end ? ' → ' + fmtT(s.end) : ' 起'} · ${s.items.length} 个变体">${p.kind === 'permanent' ? '永久' : p.slots.length > 1 ? `第 ${i + 1} 段` : esc(core.LAYER_CN[p.layer])}</div>`;
      }).join('')}<div class="gantt__now" style="left:${nowLeft}"></div></div>`).join('')}
  </div></div>`;
}

// ================= 编辑器 =================
// 和原来那个改价 app 一样:从上往下填 —— 名称 → 改什么价 → 改哪些产品 → 什么时候 → 标签 → 谁负责 → 高级;
// 右边一直显示一段大白话摘要。具体到每个变体的价格收在「试算预览」里,点开才看。
const COLORS = ['#6b8e23', '#2f5cff', '#c0342b', '#9a6300', '#067a57', '#7b3fa0', '#444'];
const RULE_MODES = {
  percent_off: { label: '按百分比降价', unit: '%', say: (v) => `每个产品的现价下降 ${v}%` },
  amount_off: { label: '减固定金额', unit: '£', say: (v) => `每个产品的现价减 £${v}` },
  fixed: { label: '统一改成一个价', unit: '£', say: (v) => `所有产品都改成 £${v}` },
  percent_up: { label: '按百分比涨价', unit: '%', say: (v) => `每个产品的现价上涨 ${v}%` },
  keep: { label: '售价不变(只改划线价)', unit: '', say: () => '售价不动,只调整划线价' },
};
const SCOPE_MODES = { collections: '指定合集', products: '指定产品', search: '按品牌 / 标签 / 类型', all: '全店所有产品' };

function newPlan(kind) {
  return {
    id: uid('p_'), name: '', color: COLORS[0], kind, layer: 'sitewide',
    compare: kind === 'window' ? 'original' : 'keep', campaign: null, note: '',
    rule: { mode: kind === 'permanent' ? 'percent_up' : 'percent_off', value: kind === 'permanent' ? 5 : 15, rounding: '', from: 'price' },
    scope: { mode: 'collections', collections: [], products: [], vendor: '', tag: '', type: '' },
    tagsAdd: [], tagsRemove: [],
    slots: [{ id: uid('s_'), start: dayAt(1), end: kind === 'permanent' ? null : dayAt(8), items: [], collection: null }],
    state: 'new', excluded: [], owner: S.me.id, approver: null, cc: [],
  };
}
function openEditor(plan, isNew) {
  const p = clone(plan);
  p.rule ||= { mode: p.kind === 'permanent' ? 'percent_up' : 'percent_off', value: 15, rounding: '', from: 'price' };
  p.scope ||= { mode: 'products', collections: [], products: [], vendor: '', tag: '', type: '' };
  p.color ||= COLORS[0]; p.tagsAdd ||= []; p.tagsRemove ||= [];
  E = { plan: p, orig: isNew ? null : plan, isNew, panel: null, dirty: isNew, showPending: false, showAll: false, busy: false, resolvedKey: isNew ? '' : scopeKey(p) };
  renderChrome(); render(); window.scrollTo(0, 0);
}
const P = () => (E.showPending && E.orig?.pendingChange ? { ...E.orig, ...E.orig.pendingChange } : E.plan);
const curSlot = () => P().slots[0];
const started = () => !E.isNew && E.orig?.state === 'approved' && E.orig.slots.some((s) => s.start <= now());
const scopeKey = (p) => JSON.stringify([p.scope, p.rule, p.compare]);
const stale = () => scopeKey(P()) !== E.resolvedKey;
function readonly() {
  if (E.showPending) return true;
  if (E.isNew) return false;
  const s = statusOf(E.orig);
  if (['ended', 'done'].includes(s)) return true;
  if (E.orig.kind === 'permanent' && Object.keys(E.orig.applied || {}).length) return true;
  return started(); // 已经开始改价了:只能改名字和结束时间(和原来那个 app 一样)
}
const opts = () => ({ maxDiscountPct: S.settings.maxDiscountPct });
const items = () => curSlot().items;

// ---- 一段大白话摘要(右边那块)----
function summaryHtml() {
  const p = P(); const s = curSlot();
  const its = s.items; const ex = new Set(p.excluded || []);
  const live = its.filter((i) => !ex.has(i.variantId));
  const offs = live.filter((i) => i.price != null).map((i) => core.discountPct(i.refPrice, i.price));
  const maxOff = offs.length ? Math.max(...offs) : 0;
  const nProd = new Set(live.map((i) => i.productId)).size;
  const mins = Math.max(1, Math.ceil(nProd / 60));
  const scopeSay = p.scope.mode === 'all' ? '全店所有产品'
    : p.scope.mode === 'collections' ? `合集 ${p.scope.collections.map((c) => c.title).join('、') || '(还没选)'} 里的产品`
      : p.scope.mode === 'products' ? `手选的 ${p.scope.products.length} 个产品`
        : [p.scope.vendor && `品牌 ${p.scope.vendor}`, p.scope.tag && `标签 ${p.scope.tag}`, p.scope.type && `类型 ${p.scope.type}`].filter(Boolean).join(' + ') || '(还没选条件)';
  const line = (t) => `<li>${t}</li>`;
  return `<div class="pr-sum">
    <div class="pr-sum__h"><span class="pr-dot" style="background:${esc(p.color)}"></span><b>${esc(p.name || '(还没起名字)')}</b></div>
    <ul>
      ${line(`${esc(scopeSay)} · <b>${RULE_MODES[p.rule.mode].say(p.rule.value)}</b>${p.rule.rounding ? `,尾数取 ${p.rule.rounding === '99' ? '.99' : '整数'}` : ''}${p.rule.from === 'compare' ? ',按划线价算' : ''}`)}
      ${line(`<b>${fmtT(s.start)}</b> 开始${p.kind === 'window' ? `,<b>${s.end ? fmtT(s.end) : '(还没设结束时间)'}</b> 结束并<b>自动恢复原价</b>` : ',<b>不恢复</b>(永久调价)'}`)}
      ${line(core.COMPARE_CN[p.compare] || '划线价不动')}
      ${p.kind === 'window' ? line(`层级:${core.LAYER_CN[p.layer]}(同一产品被几个限时计划管时,限时抢购 > 品牌/合集 > 全场)`) : ''}
      ${p.tagsAdd.length ? line(`生效期间加标签 <b>${p.tagsAdd.map(esc).join('、')}</b>,结束自动去掉`) : ''}
      ${p.tagsRemove.length ? line(`生效期间去掉标签 <b>${p.tagsRemove.map(esc).join('、')}</b>,结束自动加回`) : ''}
      ${line(`审批人:<b>${p.approver ? esc(nameOf(p.approver)) : '管理员'}</b>${p.owner ? ` · 负责人 ${esc(nameOf(p.owner))}` : ''}`)}
      ${its.length ? line(`影响 <b>${nProd}</b> 个产品 / <b>${live.length}</b> 个变体${maxOff > 0 ? `,最多降 <b>${maxOff}%</b>` : ''} · 预计 ${mins} 分钟内改完`) : line('<span class="tx-warn">还没算产品,点下面的「试算预览」</span>')}
    </ul>
  </div>${its.length && !stale() ? checkHtml() : ''}`;
}

function editorHtml() {
  const p = P(); const ro = readonly();
  const st = E.isNew ? null : statusOf(E.orig);
  const sl = curSlot();
  const sec = (title, body, hint = '') => `<section class="pr-sec"><div class="pr-sec__h">${title}${hint ? `<span class="muted">${hint}</span>` : ''}</div><div class="pr-sec__b">${body}</div></section>`;
  const rm = RULE_MODES[p.rule.mode];
  return `
  <div class="edhead">
    <button class="btn btn-ghost" data-a="close">← 返回</button>
    <b>${E.isNew ? `新建${p.kind === 'permanent' ? '永久调价' : '限时改价'}` : esc(p.name || '改价计划')}</b>
    ${st ? `<span class="tag ${STATUS_TAG[st]}">${core.STATUS_CN[st]}</span>` : '<span class="tag">新计划</span>'}
    ${E.dirty && !ro ? '<span class="tag tag--warn">有未保存的改动</span>' : ''}
  </div>
  ${bannersHtml()}
  <div class="pr-grid">
    <div class="pr-main">
      ${sec('名称', `<div class="row">
        <span class="pr-colors">${COLORS.map((c) => `<button type="button" class="pr-color ${p.color === c ? 'is-on' : ''}" style="background:${c}" data-a="color" data-v="${c}" ${ro ? 'disabled' : ''}></button>`).join('')}</span>
        <input class="inp" data-f="name" value="${esc(p.name)}" placeholder="比如:Early Black Friday · 全场 85 折" ${ro ? 'disabled' : ''} style="flex:1;min-width:200px"/></div>`, '只有后台看得到,顾客看不到')}

      ${sec('改什么价', `<div class="pr-radios">${Object.entries(RULE_MODES).filter(([k]) => k !== 'percent_up' || p.kind === 'permanent').map(([k, m]) => `
        <label class="pr-radio ${p.rule.mode === k ? 'is-on' : ''}"><input type="radio" name="rmode" value="${k}" ${p.rule.mode === k ? 'checked' : ''} ${ro ? 'disabled' : ''}/><span>${m.label}</span></label>`).join('')}</div>
        ${p.rule.mode === 'keep' ? '' : `<div class="row" style="margin-top:10px">
          <input class="inp" type="number" step="0.01" min="0" data-f="rvalue" value="${esc(p.rule.value)}" style="width:120px" ${ro ? 'disabled' : ''}/><span class="pr-unit">${rm.unit}</span>
          ${['fixed'].includes(p.rule.mode) ? '' : `<span class="muted">尾数</span><select class="sel" data-f="rrounding" ${ro ? 'disabled' : ''}><option value="" ${!p.rule.rounding ? 'selected' : ''}>不取整</option><option value="99" ${p.rule.rounding === '99' ? 'selected' : ''}>.99</option><option value="00" ${p.rule.rounding === '00' ? 'selected' : ''}>整数</option></select>`}
          ${['percent_off', 'amount_off'].includes(p.rule.mode) ? `<span class="muted">按</span><select class="sel" data-f="rfrom" ${ro ? 'disabled' : ''}><option value="price" ${p.rule.from !== 'compare' ? 'selected' : ''}>现售价</option><option value="compare" ${p.rule.from === 'compare' ? 'selected' : ''}>划线价(RRP)</option></select><span class="muted">算</span>` : ''}
        </div>`}
        <p class="pr-say">${rm.say(p.rule.value)}。</p>`)}

      ${sec('改哪些产品', scopeHtml(ro), '选好范围后点下面的「试算预览」算出每个产品的新价')}

      ${sec(p.kind === 'permanent' ? '什么时候执行' : '什么时候生效', `
        <div class="row" style="margin-bottom:10px"><span class="pr-seg">${[['window', '限时(到期自动恢复原价)'], ['permanent', '永久(到点改,不恢复)']].map(([k, l]) => `<button type="button" class="${p.kind === k ? 'is-on' : ''}" data-a="kind" data-v="${k}" ${ro || started() ? 'disabled' : ''}>${l}</button>`).join('')}</span></div>
        ${p.kind === 'window' ? `<div class="row" style="margin-bottom:10px"><span class="muted">层级</span><span class="pr-seg">${[['sitewide', '全场'], ['brand', '品牌 / 合集'], ['flash', '限时抢购']].map(([k, l]) => `<button type="button" class="${p.layer === k ? 'is-on' : ''}" data-a="layer" data-v="${k}" ${ro || started() ? 'disabled' : ''}>${l}</button>`).join('')}</span></div>` : ''}
        <div class="grid2">
          <label class="pr-fld">开始<input class="inp" type="datetime-local" data-f="start" value="${toInput(sl.start)}" ${ro || started() ? 'disabled' : ''}/>${!ro && !started() ? '<button type="button" class="linkbtn" data-a="startnow" style="text-align:left">设成现在(批准后一分钟内执行)</button>' : ''}</label>
          ${p.kind === 'window' ? `<label class="pr-fld">结束(恢复原价)<input class="inp" type="datetime-local" data-f="end" value="${toInput(sl.end)}" ${E.showPending || (!E.isNew && ['ended', 'done'].includes(statusOf(E.orig))) ? 'disabled' : ''}/><em>已经开始的计划也能改结束时间</em></label>` : ''}
        </div>
        ${p.kind === 'window' ? `<div class="pr-fld" style="margin-top:10px">这个时段内把产品加进合集 <em>只能选手动合集;结束自动移出(原来就在的不动)。Flash 当天那一组常用</em>
          ${sl.collection ? `<div class="row"><span class="tag tag--accent">${esc(sl.collection.title)}</span>${ro ? '' : '<button class="linkbtn" data-a="unsetcoll">不加了</button>'}</div>`
            : ro ? '<span class="muted">不加</span>' : '<button class="btn btn-sm" data-a="panel" data-p="slotcoll" style="width:fit-content">选合集…</button>'}
          ${E.panel === 'slotcoll' ? collPanel('slotcoll') : ''}</div>` : ''}
        <p class="muted">时间一律按英国时间(店铺时区),夏令时自动处理。</p>`)}

      ${sec('产品标签', `<div class="grid2">
        <div class="pr-fld">生效期间加上 <em>结束自动去掉;产品本来就有的不动</em>${tagChips('tagsAdd', ro)}</div>
        <div class="pr-fld">生效期间去掉 <em>结束自动加回来</em>${tagChips('tagsRemove', ro)}</div></div>
        <p class="muted">用来驱动「按标签自动归类」的合集,比如 FlashDeal、TOP DEALS。</p>`, '可不填')}

      ${sec('负责人与审批', `<div class="grid2">
        <label class="pr-fld">负责人<select class="sel" data-f="owner" ${ro ? 'disabled' : ''}><option value="">不指定</option>${S.people.map((u) => `<option value="${u.id}" ${p.owner === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label class="pr-fld">审批人 <em>不指定 = 管理员审批;审批人自己提交直接生效</em><select class="sel" data-f="approver" ${ro ? 'disabled' : ''}><option value="">管理员审批</option>${S.people.map((u) => `<option value="${u.id}" ${p.approver === u.id ? 'selected' : ''}>${esc(u.name)}${u.admin ? '(管理员)' : ''}</option>`).join('')}</select></label>
        <label class="pr-fld">关联活动 <em>关联后在活动页里能看到这次改价</em><select class="sel" data-f="campaign" ${ro ? 'disabled' : ''}><option value="">不关联</option>${(cache.campaigns || []).map((c) => `<option value="${c.id}" ${p.campaign?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${p.campaign && !(cache.campaigns || []).some((c) => c.id === p.campaign.id) ? `<option value="${p.campaign.id}" selected>${esc(p.campaign.name)}</option>` : ''}</select></label>
        <div class="pr-fld">抄送 <em>只通知,不能批准</em><div class="row">${S.people.map((u) => `<label class="row" style="gap:4px;font-size:13px"><input type="checkbox" data-f="cc" value="${u.id}" ${(p.cc || []).includes(u.id) ? 'checked' : ''} ${ro ? 'disabled' : ''}/>${esc(u.name)}</label>`).join('') || '<span class="muted">没有别的能看改价页的成员</span>'}</div></div>
      </div>
      <label class="pr-fld" style="margin-top:10px">备注 <em>给审批人看的说明</em><textarea class="inp" rows="2" data-f="note" ${ro ? 'disabled' : ''} placeholder="比如:配合首页 Banner,Flash 每天 0 点换">${esc(p.note || '')}</textarea></label>`)}

      ${sec('划线价', `<select class="sel" data-f="compare" ${ro ? 'disabled' : ''}>${Object.entries(core.COMPARE_CN).map(([k, l]) => `<option value="${k}" ${(p.compare || (p.kind === 'window' ? 'original' : 'keep')) === k ? 'selected' : ''}>${l}${k === 'original' ? '(前台显示 was / now)' : ''}</option>`).join('')}</select>
        <p class="muted">主题里「只显示打折」「按折扣排序」「折扣角标」都看划线价,所以限时促销一般选「显示原价」。</p>`, '高级')}

      ${sec('试算预览', `<p class="muted">按上面的设置算出每个产品的新价,确认没问题再提交。${stale() && items().length ? '<b class="tx-warn">设置改过了,结果可能不是最新的,请重新试算。</b>' : ''}</p>
        <div class="row"><button class="btn ${items().length && !stale() ? '' : 'btn-primary'}" data-a="resolve" ${ro ? 'disabled' : ''}>${items().length ? '重新试算' : '试算预览'}</button>
          ${items().length ? `<span class="muted">${new Set(items().map((i) => i.productId)).size} 个产品 / ${items().length} 个变体</span>` : ''}</div>
        ${items().length ? previewHtml(ro) : ''}`)}
    </div>
    <aside class="pr-side">${summaryHtml()}</aside>
  </div>
  <div class="footbar">${footHtml()}</div>`;
}

function tagChips(key, ro) {
  const list = P()[key] || [];
  return `<div class="row" style="gap:4px;flex-wrap:wrap;margin-top:4px">${list.map((t, i) => `<span class="tag">${esc(t)}${ro ? '' : `<button type="button" class="chip__x" data-a="rmtag" data-k="${key}" data-i="${i}">✕</button>`}</span>`).join('')}
    ${ro ? '' : `<input class="inp" data-addtag="${key}" placeholder="输入标签,回车添加" style="width:170px"/>`}</div>`;
}

function scopeHtml(ro) {
  const sc = P().scope;
  const tab = (k) => `<button type="button" class="${sc.mode === k ? 'is-on' : ''}" data-a="smode" data-v="${k}" ${ro ? 'disabled' : ''}>${SCOPE_MODES[k]}</button>`;
  let body = '';
  if (sc.mode === 'collections') {
    body = `<div class="row">${sc.collections.map((c, i) => `<span class="tag tag--accent">${esc(c.title)}${ro ? '' : `<button type="button" class="chip__x" data-a="rmcoll" data-i="${i}">✕</button>`}</span>`).join('') || '<span class="muted">还没选合集</span>'}
      ${ro ? '' : '<button class="btn btn-sm" data-a="panel" data-p="coll">选合集…</button>'}</div>${E.panel === 'coll' ? collPanel('coll') : ''}`;
  } else if (sc.mode === 'products') {
    body = `<div class="row">${sc.products.length ? `<span class="tag tag--accent">已选 ${sc.products.length} 个产品</span>${ro ? '' : '<button class="linkbtn" data-a="clearprod">清空</button>'}` : '<span class="muted">还没选产品</span>'}
      ${ro ? '' : '<button class="btn btn-sm" data-a="pick">选产品</button>'}</div>
      ${sc.products.length ? `<div class="pr-picked">${sc.products.slice(0, 12).map((x) => `<span class="pr-picked__i" title="${esc(x.title)}">${x.image ? `<img src="${esc(x.image)}" alt="">` : ''}</span>`).join('')}${sc.products.length > 12 ? `<span class="muted">…共 ${sc.products.length} 个</span>` : ''}</div>` : ''}`;
  } else if (sc.mode === 'search') {
    body = `<div class="grid2">
      <label class="pr-fld">品牌<input class="inp" data-f="svendor" list="pr-vendors" value="${esc(sc.vendor || '')}" placeholder="如 TILTA" ${ro ? 'disabled' : ''}/><datalist id="pr-vendors">${(cache.vendors || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist></label>
      <label class="pr-fld">标签<input class="inp" data-f="stag" value="${esc(sc.tag || '')}" placeholder="如 New Gear" ${ro ? 'disabled' : ''}/></label>
      <label class="pr-fld">产品类型<input class="inp" data-f="stype" value="${esc(sc.type || '')}" placeholder="如 Cine Lens" ${ro ? 'disabled' : ''}/></label></div>
      <p class="muted">填几项就要同时满足几项。</p>`;
  } else {
    body = '<p class="muted">全店所有产品都会被改价。产品多的话执行会慢一些(摘要里有预计时间),建议先用「试算预览」看看。</p>';
  }
  return `<div class="pr-seg pr-seg--wrap" style="margin-bottom:10px">${Object.keys(SCOPE_MODES).map(tab).join('')}</div>${body}
    ${P().campaign && !ro ? `<button type="button" class="btn btn-sm" data-a="fromcamp" style="margin-top:8px">用活动「${esc(P().campaign.name)}」圈定的产品</button>` : ''}`;
}

// 试算结果:默认只看前 10 个(和原来那个 app 一样),可以展开全部
function previewHtml(ro) {
  const p = P(); const its = items(); const ex = new Set(p.excluded || []);
  const show = E.showAll ? its : its.slice(0, 10);
  const setCompare = (p.compare || '') === 'set';
  let lastPid = null;
  const rows = show.map((it) => {
    const first = it.productId !== lastPid; lastPid = it.productId;
    const w = core.itemWarnings(p, it, opts());
    const t = (() => { try { return core.targetFor({ price: it.refPrice, compareAt: it.refCompareAt }, p, it); } catch { return null; } })();
    const d = it.price != null ? core.discountPct(it.refPrice, it.price) : null;
    const gone = ex.has(it.variantId);
    return `<tr class="${first ? 'is-first' : ''}" style="${gone ? 'opacity:.45' : ''}">
      <td>${first ? `<div class="pcell">${it.image ? `<img class="pimg" src="${esc(it.image)}" loading="lazy" alt=""/>` : '<span class="pimg"></span>'}<div><div class="pcell__t">${esc(it.product || it.title)}</div><div class="pcell__s">${esc(it.vendor || '')}</div></div></div>` : ''}</td>
      <td>${esc(it.variant || '')}<div class="pcell__s">${esc(it.sku || '')}</div></td>
      <td class="num">${money(it.refPrice)}${it.refCompareAt && Number(it.refCompareAt) > Number(it.refPrice) ? `<div><s>${money(it.refCompareAt)}</s></div>` : ''}${it.cost != null ? `<div class="pcell__s">成本 ${money(it.cost)}</div>` : ''}</td>
      <td class="num">${ro || gone ? `<b>${it.price != null ? money(it.price) : '不变'}</b>` : `<input class="inp" data-f="iprice" data-v="${it.variantId}" value="${it.price ?? ''}" placeholder="不变"/>`}</td>
      <td class="num">${setCompare && !ro && !gone ? `<input class="inp" data-f="icompare" data-v="${it.variantId}" value="${it.compareAt ?? ''}" placeholder="无"/>` : t?.compareAt ? `<s>${money(t.compareAt)}</s>` : '<span class="muted">无</span>'}</td>
      <td class="num">${d == null ? '' : d > 0 ? `<span class="off">-${d}%</span>` : d < 0 ? `<span class="up">+${-d}%</span>` : '0%'}</td>
      <td>${gone ? '<span class="w w--warn">已移出</span>' : ''}${w.map((x) => `<span class="w w--${x.level}">${esc(x.text)}</span>`).join('')}</td>
      <td>${gone || ro ? '' : started() ? `<button class="linkbtn" data-a="exclude" data-v="${it.variantId}" title="移出后下一分钟恢复原价">移出</button>` : `<button class="linkbtn" data-a="rm" data-v="${it.variantId}">✕</button>`}</td>
    </tr>`;
  }).join('');
  return `<div class="tblwrap" style="margin-top:10px"><table class="pr-tbl"><thead><tr><th>产品</th><th>变体 / SKU</th><th class="num">现价</th><th class="num">新价</th><th class="num">划线价</th><th class="num">变化</th><th>检查</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${its.length > 10 ? `<button class="btn btn-sm btn-ghost" data-a="showall" style="margin-top:8px">${E.showAll ? '只看前 10 个' : `展开全部 ${its.length} 个变体`}</button>` : ''}`;
}

function bannersHtml() {
  const out = [];
  const o = E.orig;
  if (!o) return '';
  if (o.state === 'rejected' && o.rejectNote) out.push(`<div class="banner banner--danger">被退回:${esc(o.rejectNote)}。改好后重新提交。</div>`);
  if (o.stopped) out.push('<div class="banner banner--warn">这个计划已提前结束,活动价都已恢复(或正在恢复)。</div>');
  if (o.paused) out.push('<div class="banner banner--warn">暂停中:所有产品已恢复原价,点「继续」会重新套用活动价。</div>');
  if (o.pendingChange) {
    const ch = { ...o, ...o.pendingChange };
    out.push(`<div class="banner banner--info"><b>${esc(nameOf(o.pendingChange.by))} 提交了修改(${fmtT(o.pendingChange.at)})</b>,批准前按原计划执行。
      <div style="margin:6px 0">${diffLines(o, ch).map((l) => `· ${esc(l)}`).join('<br>') || '· (只改了名称 / 备注)'}</div>
      <div class="row"><button class="btn btn-sm" data-a="togglepending">${E.showPending ? '看原计划' : '看修改后的版本'}</button>
      ${canApprove({ ...o, ...o.pendingChange }) ? `<button class="btn btn-sm btn-ok" data-a="approve">批准修改</button><button class="btn btn-sm" data-a="panel" data-p="reject">退回修改…</button>` : ''}</div></div>`);
  }
  if (started() && !o.stopped && statusOf(o) !== 'ended') out.push('<div class="banner banner--info">这个计划已经在改价了:只能改名字和结束时间,或者暂停、提前结束、把个别产品移出。要换价格或范围,请提前结束后新建一个。</div>');
  if (E.panel === 'reject') out.push(`<div class="pr-panel"><div class="row"><input class="inp" id="reject-note" placeholder="退回原因(会发给提交人)" style="flex:1"/><button class="btn btn-danger" data-a="reject">确认退回</button><button class="btn btn-ghost" data-a="panel" data-p="">取消</button></div></div>`);
  return out.join('');
}
function diffLines(a, b) {
  const out = [];
  const f = (x) => `${RULE_MODES[x.rule?.mode]?.label || ''} ${x.rule?.value ?? ''}`;
  if (f(a) !== f(b)) out.push(`改价方式改成「${f(b)}」`);
  if (JSON.stringify(a.scope) !== JSON.stringify(b.scope)) out.push('改了适用产品的范围');
  const sa = a.slots[0] || {}, sb = b.slots[0] || {};
  if (sa.start !== sb.start) out.push(`开始时间改成 ${fmtT(sb.start)}`);
  if (sa.end !== sb.end) out.push(`结束时间改成 ${sb.end ? fmtT(sb.end) : '不结束'}`);
  const ma = new Map((sa.items || []).map((t) => [t.variantId, t])), mb = new Map((sb.items || []).map((t) => [t.variantId, t]));
  const add = [...mb.keys()].filter((k) => !ma.has(k)).length, del = [...ma.keys()].filter((k) => !mb.has(k)).length;
  const chg = [...mb.keys()].filter((k) => ma.has(k) && ma.get(k).price !== mb.get(k).price).length;
  if (add || del || chg) out.push([add && `加 ${add} 个变体`, del && `删 ${del} 个`, chg && `改价 ${chg} 个`].filter(Boolean).join('、'));
  if ((a.compare || '') !== (b.compare || '')) out.push(`划线价改成「${core.COMPARE_CN[b.compare]}」`);
  if (JSON.stringify(a.tagsAdd || []) !== JSON.stringify(b.tagsAdd || []) || JSON.stringify(a.tagsRemove || []) !== JSON.stringify(b.tagsRemove || [])) out.push('改了产品标签');
  if ((a.approver || '') !== (b.approver || '')) out.push(`审批人改成 ${b.approver ? nameOf(b.approver) : '管理员'}`);
  return out;
}

function collPanel(which) {
  const list = cache.collSearch || [];
  return `<div class="pr-panel"><div class="row"><input class="inp" id="coll-q" placeholder="搜合集名称" style="flex:1" value="${esc(cache.collQ || '')}"/><button class="btn btn-sm" data-a="collsearch" data-w="${which}">搜索</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div>
    <div class="results">${list.map((c) => `<div class="result"><b style="flex:1">${esc(c.title)}</b><span class="muted">${c.count ?? '?'} 个产品 · ${c.smart ? '智能合集' : '手动合集'}</span>
      ${which === 'slotcoll' ? (c.smart ? '<span class="muted">按条件自动,不能加</span>' : `<button class="btn btn-sm" data-a="setcoll" data-id="${c.id}" data-t="${esc(c.title)}">选这个</button>`)
        : `<button class="btn btn-sm" data-a="addcoll" data-id="${c.id}" data-t="${esc(c.title)}">选这个</button>`}</div>`).join('') || '<span class="muted">输入名称搜索</span>'}</div></div>`;
}

function checkHtml() {
  const p = P();
  const its = items();
  const ex = new Set(p.excluded || []);
  const ws = its.filter((i) => !ex.has(i.variantId)).map((i) => core.itemWarnings(p, i, opts()));
  const errs = ws.filter((w) => w.some((x) => x.level === 'error')).length + its.filter((i) => p.kind === 'window' && i.price == null).length;
  const warns = ws.filter((w) => w.some((x) => x.level === 'warn')).length;
  const ov = core.overlaps({ ...p, state: 'approved' }, S.plans);
  const byOther = new Map();
  for (const o of ov) { const k = o.other.planId; if (!byOther.has(k)) byOther.set(k, { ...o.other, n: new Set(), wins: o.wins }); byOther.get(k).n.add(o.variantId); }
  const err = A.validate(p, opts());
  // 尾数取整会让便宜的产品降得比规则多很多(£1.50 打 8 折 = £1.20,取 .99 就成了 £0.99)
  let roundWarn = '';
  if (p.rule.mode === 'percent_off' && p.rule.rounding) {
    const offs = its.filter((i) => i.price != null && !ex.has(i.variantId)).map((i) => ({ off: core.discountPct(i.refPrice, i.price), i }));
    const worst = offs.sort((a, b) => b.off - a.off)[0];
    if (worst && worst.off > Number(p.rule.value) + 5) roundWarn = `<div class="banner banner--warn" style="margin-bottom:6px">尾数取整让便宜的产品降得更多:规则是降 ${p.rule.value}%,但「${esc(worst.i.product || worst.i.title)}」实际降了 ${worst.off}%(${money(worst.i.refPrice)} → ${money(worst.i.price)})。不想这样就把尾数改成「不取整」。</div>`;
  }
  return `<div class="pr-card"><div class="pr-card__t">检查</div>
    <div class="check">
      <div class="${errs ? 'is-bad' : ''}"><b>${errs}</b>个有错误(不能提交)</div>
      <div class="${warns ? 'is-warn' : ''}"><b>${warns}</b>个要留意</div>
    </div>
    ${roundWarn}
    ${[...byOther.values()].map((o) => `<div class="banner banner--info" style="margin-bottom:6px">${o.n.size} 个变体同时在「${esc(o.name)}」(${core.LAYER_CN[o.layer] || ''})里:重叠期间以「${o.wins ? esc(p.name || '本计划') : esc(o.name)}」的价格为准${o.wins ? `,本计划结束后回到「${esc(o.name)}」的价` : ''}。</div>`).join('')}
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
      b.push(ap ? '<button class="btn btn-primary" data-a="save" data-m="publish">批准并排期</button>' : `<button class="btn btn-primary" data-a="save" data-m="submit">${st === 'pending' ? '重新提交' : '提交审核'}</button>`);
    } else if (o?.state === 'approved' && !o.stopped) {
      b.push(ap ? `<button class="btn btn-primary" data-a="save" data-m="publish" ${E.dirty ? '' : 'disabled'}>保存修改(直接生效)</button>` : `<button class="btn btn-primary" data-a="save" data-m="submit" ${E.dirty ? '' : 'disabled'}>提交修改审核</button>`);
    }
  }
  if (st === 'pending' && ap && !E.dirty) { b.push('<button class="btn btn-ok" data-a="approve">批准</button>'); b.push('<button class="btn" data-a="panel" data-p="reject">退回…</button>'); }
  if (o?.state === 'approved' && !o.stopped && !['ended', 'done'].includes(st)) {
    if (ap) b.push(o.paused ? '<button class="btn" data-a="resume">继续</button>' : '<button class="btn" data-a="pause">暂停(恢复原价)</button>');
    b.push('<button class="btn btn-danger" data-a="stop">提前结束</button>');
  }
  b.push('<span class="spacer"></span>');
  if (!E.isNew) b.push('<button class="btn btn-ghost" data-a="dup">复制成新计划</button>');
  if (!E.isNew && P().kind === 'window' && curSlot().end) b.push('<button class="btn btn-ghost" data-a="dupnext">复制成下一天</button>');
  if (!E.isNew && (!['running', 'paused'].includes(st)) && (o.state !== 'approved' || ap)) b.push('<button class="btn btn-ghost btn-danger" data-a="delete">删除</button>');
  if (E.isNew) b.push('<button class="btn btn-ghost" data-a="close">放弃</button>');
  return b.join('');
}

// ---- 编辑器里的改动 ----
function touch() { E.dirty = true; }
const toItem = (pr, v, rule) => {
  const it = { variantId: v.id, productId: pr.id, title: `${pr.title}${v.title ? ' - ' + v.title : ''}`, product: pr.title, variant: v.title, sku: v.sku, vendor: pr.vendor, image: pr.image,
    refPrice: v.price, refCompareAt: v.compareAt, cost: v.cost, price: null };
  try { if (rule.mode !== 'keep') it.price = core.priceByRule({ price: v.price, compareAt: v.compareAt }, rule); } catch { /* 规则没填好就先不设价 */ }
  return it;
};
// 按「改哪些产品」+「改什么价」算出每个变体的新价。手改过的价格尽量保留。
async function resolveScope() {
  const p = E.plan; const sc = p.scope;
  const old = new Map(items().map((i) => [i.variantId, i]));
  let products = [];
  if (sc.mode === 'collections') {
    if (!sc.collections.length) throw new Error('先选至少一个合集');
    const seen = new Map();
    for (const c of sc.collections) {
      const d = await api('GET', `/api/price/catalog/collection?id=${encodeURIComponent(c.id)}`);
      if (d.truncated) toast(`合集「${c.title}」太大,只取了前 5000 个产品`, false);
      d.products.forEach((x) => seen.set(x.id, x));
    }
    products = [...seen.values()];
  } else if (sc.mode === 'products') {
    if (!sc.products.length) throw new Error('先选至少一个产品');
    products = (await api('GET', `/api/price/catalog/products?ids=${sc.products.map((x) => x.id).join(',')}`)).products;
  } else if (sc.mode === 'search') {
    const q = new URLSearchParams(Object.fromEntries(['vendor', 'tag', 'type'].filter((k) => sc[k]).map((k) => [k, sc[k]])));
    if (![...q].length) throw new Error('先填品牌、标签或类型');
    products = (await api('GET', `/api/price/catalog/search?${q}`)).products;
  } else {
    const d = await api('GET', '/api/price/catalog/search?all=1');
    if (d.truncated) toast('店里产品很多,只取了前 5000 个', false);
    products = d.products;
  }
  const its = [];
  for (const pr of products) for (const v of pr.variants) {
    const it = toItem(pr, v, p.rule);
    const o = old.get(v.id);
    if (o && o.manual && o.price != null) { it.price = o.price; it.manual = true; } // 手改过的保留
    if (o && o.compareAt != null) it.compareAt = o.compareAt;
    its.push(it);
  }
  curSlot().items = its;
  E.resolvedKey = scopeKey(p);
  touch();
  return its.length;
}
async function withBusy(btn, fn) {
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '处理中…'; }
  try { await fn(); } catch (e) { toast(e.message, false); } finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = old; } }
}
function values() {
  const p = E.plan;
  return { id: p.id, name: p.name.trim(), color: p.color, kind: p.kind, layer: p.kind === 'window' ? p.layer : null,
    compare: p.compare || (p.kind === 'window' ? 'original' : 'keep'), campaign: p.campaign, note: p.note, slots: p.slots,
    rule: p.rule, scope: p.scope, tagsAdd: p.tagsAdd, tagsRemove: p.tagsRemove,
    owner: p.owner || null, approver: p.approver || null, cc: p.cc || [] };
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
  const plan = (id) => planById(id)?.name || '—';
  const colls = Object.entries(S.collState || {});
  return `
  <div class="toolbar"><button class="btn" data-a="dlvault">导出还原表格(CSV)</button>${isAdmin() ? '<button class="btn" data-a="runnow">立即对齐一次</button>' : ''}
    <span class="muted">还原表格 = 每个受管变体的原价和原划线价;app 万一出问题,照着它在后台改回去即可。</span></div>
  ${holds.length ? `<h3>⚠️ 暂停接管,等你处理(${holds.length})</h3>${holds.map((v) => `<div class="hold">
    <div class="hold__t">${esc(v.title || v.id)} <span class="muted">${esc(v.sku || '')}</span></div>
    <div class="muted" style="margin:2px 0">${REASON[v.hold.reason] || v.hold.reason} · 计划「${esc(plan(v.hold.planId))}」· ${fmtT(v.hold.at)}</div>
    <div class="hold__p"><span>店里现价 <b>${money(v.hold.seen?.price)}</b>${v.hold.seen?.compareAt ? `(划线 ${money(v.hold.seen.compareAt)})` : ''}</span>
      <span>app 写的价 <b>${money(v.written?.price ?? v.hold.expected?.price)}</b></span><span>原价 <b>${money(v.base?.price)}</b>${v.base?.compareAt ? `(划线 ${money(v.base.compareAt)})` : ''}</span></div>
    ${isAdmin() || canApprove(planById(v.hold.planId)) ? `<div class="row">
      <button class="btn btn-sm" data-a="fixhold" data-v="${v.id}" data-c="reapply">以店里现价为原价,重新套用活动价</button>
      <button class="btn btn-sm" data-a="fixhold" data-v="${v.id}" data-c="keep">退出计划,保持现价</button>
      ${v.written ? `<button class="btn btn-sm" data-a="fixhold" data-v="${v.id}" data-c="restore">恢复原价并退出计划</button>` : ''}</div>` : '<span class="muted">等审核人处理</span>'}
  </div>`).join('')}` : ''}
  <h3>正在活动价上(${live.length})</h3>
  ${live.length ? `<div class="tblwrap"><table class="pr-tbl"><thead><tr><th>产品</th><th>SKU</th><th class="num">原价</th><th class="num">现在</th><th>计划</th><th>开始接管</th></tr></thead><tbody>
    ${live.map((v) => `<tr><td>${esc(v.title)}</td><td>${esc(v.sku || '')}</td><td class="num">${money(v.base?.price)}${v.base?.compareAt ? `<div><s>${money(v.base.compareAt)}</s></div>` : ''}</td>
      <td class="num"><b>${money(v.written.price)}</b>${v.written.compareAt ? `<div><s>${money(v.written.compareAt)}</s></div>` : ''}</td><td>${esc(plan(v.written.planId))}</td><td>${fmtT(v.since)}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="pr-empty">现在没有产品在活动价上</div>'}
  ${colls.length ? `<h3>app 管着的合集成员</h3>${colls.map(([id, c]) => `<div class="pr-kv"><span>${esc(c.title || id)}</span>app 加进去 ${c.managed.length} 个产品(时段结束自动移出)${c.preexisting.length ? `;${c.preexisting.length} 个本来就在,不动` : ''}</div>`).join('')}` : ''}`;
}

// ================= 价格账本 =================
const OP_CN = { start: '开始活动价', switch: '换时段价', restore: '恢复原价', permanent: '永久调价' };
async function loadLedger() {
  const el = $('#ledger-root'); if (!el) return;
  const qs = new URLSearchParams({ q: ledgerQ.q, plan: ledgerQ.plan, offset: ledgerQ.offset, limit: 100 });
  try {
    const d = await api('GET', `/api/price/ledger?${qs}`);
    el.innerHTML = `<div class="toolbar">
      <div class="field-search"><input type="search" id="lq" placeholder="搜产品 / SKU / 计划" value="${esc(ledgerQ.q)}"/></div>
      <select class="sel" id="lplan"><option value="">全部计划</option>${S.plans.map((p) => `<option value="${p.id}" ${ledgerQ.plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <button class="btn" data-a="dlledger">导出 CSV</button></div>
      ${d.rows.length ? `<div class="tblwrap"><table class="pr-tbl"><thead><tr><th>时间(英国)</th><th>产品</th><th>SKU</th><th>动作</th><th class="num">改前</th><th class="num">改后</th><th>计划</th><th>备注</th></tr></thead><tbody>
      ${d.rows.map((x) => `<tr><td>${fmtT(x.at)}</td><td>${esc(x.title)}</td><td>${esc(x.sku || '')}</td><td>${OP_CN[x.op] || x.op}</td>
        <td class="num">${money(x.from?.price)}${x.from?.compareAt ? `<div><s>${money(x.from.compareAt)}</s></div>` : ''}</td><td class="num"><b>${money(x.to?.price)}</b>${x.to?.compareAt ? `<div><s>${money(x.to.compareAt)}</s></div>` : ''}</td>
        <td>${esc(x.plan || '')}</td><td class="muted">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pr-empty">还没有改价记录</div>'}
      <div class="pager"><span class="pager__info">共 ${d.total} 条</span><div class="pager__btns">
        <button class="pgbtn" data-a="lpage" data-d="-1" ${ledgerQ.offset ? '' : 'disabled'}>上一页</button><button class="pgbtn" data-a="lpage" data-d="1" ${ledgerQ.offset + 100 < d.total ? '' : 'disabled'}>下一页</button></div></div>`;
  } catch (e) { el.innerHTML = `<div class="banner banner--danger">${esc(e.message)}</div>`; }
}

// ================= 改价设置 =================
const NOTIFY_CN = { submit: '有人提交审核(私信审批人)', decision: '批准 / 退回 / 暂停 / 提前结束(私信相关的人)', start: '改价生效、合集变化', end: '恢复原价、永久调价完成', hold: '产品暂停接管(有人手动改价)', failure: '改价失败', unapproved: '快开始了还没批准' };
function settingsHtml() {
  const s = S.settings; const ap = isAdmin();
  return `
  <div class="pr-card"><div class="pr-card__t">通知 <span class="muted">改价通知只用飞书私信发给相关的人(负责人 / 审批人 / 提交人 / 抄送),不发群</span></div>
    ${Object.entries(NOTIFY_CN).map(([k, l]) => `<label class="row" style="font-size:13px;margin:4px 0"><input type="checkbox" data-a="notify" data-k="${k}" ${s.notify[k] ? 'checked' : ''} ${ap ? '' : 'disabled'}/> ${l}</label>`).join('')}</div>
  <div class="pr-card"><div class="pr-card__t">安全</div>
    <div class="grid2"><label class="pr-fld">降幅上限 % <em>超过的在预览里标黄提醒</em><input class="inp" type="number" id="maxoff" value="${s.maxDiscountPct}" ${ap ? '' : 'disabled'}/></label>
      <label class="pr-fld">巡检间隔(分钟)<em>多久核对一次「正在活动价上的产品有没有被人手动改过」</em><input class="inp" type="number" id="sweep" value="${s.sweepMinutes}" ${ap ? '' : 'disabled'}/></label></div>
    ${ap ? '<div class="row" style="margin-top:10px"><button class="btn btn-sm btn-primary" data-a="savesafe">保存</button></div>' : ''}</div>
  <div class="pr-card"><div class="pr-card__t">执行器</div>
    <div class="pr-kv"><span>状态</span>${S.engine.lastRun ? `上次对齐 ${ago(S.engine.lastRun)},改了 ${S.engine.lastWrites} 个变体` : '还没运行'}${S.engine.lastError ? ` · <span style="color:var(--danger)">${esc(S.engine.lastError)}</span>` : ''}</div>
    <div class="pr-kv"><span>时区</span>英国时间(Europe/London,自动处理夏令时)</div>
    <div class="pr-kv"><span>成员 / 飞书</span>在网站更新中心的「设置」里管(谁能看改价页 = 角色勾了「改价」)</div>
  </div>`;
}

// ================= 事件 =================
document.addEventListener('click', async (ev) => {
  if (!ev.target.closest('#section-price')) return;
  const el = ev.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a;
  try {
    switch (a) {
      case 'filter': filter = el.dataset.f; render(); break;
      case 'tab': if (E && E.dirty && !armed(el, '有未保存的改动,再点一次离开')) return; E = null; tab = el.dataset.t; renderChrome(); render(); break;
      case 'new': openEditor(newPlan(el.dataset.kind), true); loadCampaigns(); break;
      case 'open': { const p = planById(el.dataset.id); if (p) { openEditor(p, false); loadCampaigns(); } break; }
      case 'close': if (E.dirty && !E.isNew && !armed(el, '有未保存的改动,再点一次放弃')) return; E = null; renderChrome(); render(); break;
      case 'color': E.plan.color = el.dataset.v; touch(); render(); break;
      case 'kind': {
        if (el.disabled) return;
        const k = el.dataset.v; E.plan.kind = k;
        E.plan.compare = k === 'window' ? 'original' : 'keep';
        E.plan.rule.mode = k === 'window' ? 'percent_off' : 'percent_up';
        const s = E.plan.slots[0];
        if (k === 'permanent') { s.end = null; s.collection = null; } else if (!s.end) s.end = s.start + 7 * DAY;
        E.resolvedKey = ''; touch(); render(); break;
      }
      case 'layer': if (el.disabled) return; E.plan.layer = el.dataset.v; touch(); render(); break;
      case 'smode': if (el.disabled) return; E.plan.scope.mode = el.dataset.v; E.panel = null;
        if (el.dataset.v === 'search' && !cache.vendors) api('GET', '/api/price/catalog/vendors').then((d) => { cache.vendors = d.vendors; render(); }).catch(() => {});
        touch(); render(); break;
      case 'panel': E.panel = el.dataset.p || null; render(); break;
      case 'pick': {
        if (!window.shopify?.resourcePicker) { toast('选择器只能在 Shopify 后台里用', false); return; }
        const picked = await window.shopify.resourcePicker({ type: 'product', multiple: true, action: 'select',
          selectionIds: E.plan.scope.products.map((x) => ({ id: x.id })) });
        if (!picked) return;
        E.plan.scope.products = picked.map((x) => ({ id: x.id, title: x.title, image: x.images?.[0]?.originalSrc || '' }));
        touch(); render(); break;
      }
      case 'clearprod': E.plan.scope.products = []; touch(); render(); break;
      case 'collsearch': cache.collQ = $('#coll-q').value.trim(); await withBusy(el, async () => { cache.collSearch = (await api('GET', `/api/price/catalog/collections?q=${encodeURIComponent(cache.collQ)}`)).collections; render(); }); break;
      case 'addcoll': { const sc = E.plan.scope; if (!sc.collections.some((c) => c.id === el.dataset.id)) sc.collections.push({ id: el.dataset.id, title: el.dataset.t }); E.panel = null; touch(); render(); break; }
      case 'rmcoll': E.plan.scope.collections.splice(+el.dataset.i, 1); touch(); render(); break;
      case 'setcoll': curSlot().collection = { id: el.dataset.id, title: el.dataset.t }; E.panel = null; touch(); render(); break;
      case 'unsetcoll': curSlot().collection = null; touch(); render(); break;
      case 'fromcamp': await withBusy(el, async () => {
        const d = await api('GET', `/api/price/catalog/campaign?id=${encodeURIComponent(E.plan.campaign.id)}`);
        E.plan.scope = { mode: 'products', collections: [], products: d.products.map((x) => ({ id: x.id, title: x.title, image: x.image })), vendor: '', tag: '', type: '' };
        E.resolvedKey = ''; touch(); toast(`用了活动圈定的 ${d.products.length} 个产品`); render();
      }); break;
      case 'rmtag': E.plan[el.dataset.k].splice(+el.dataset.i, 1); touch(); render(); break;
      case 'resolve': await withBusy(el, async () => { const n = await resolveScope(); toast(`算好了:${n} 个变体`); render(); }); break;
      case 'showall': E.showAll = !E.showAll; render(); break;
      case 'rm': { const s = curSlot(); s.items = s.items.filter((i) => i.variantId !== el.dataset.v); touch(); render(); break; }
      case 'startnow': curSlot().start = now() + 60_000; touch(); render(); break;
      case 'togglepending': E.showPending = !E.showPending; render(); break;
      case 'save': {
        const mode = el.dataset.m;
        if (!E.plan.name.trim()) { toast('先填计划名称', false); $('[data-f=name]')?.focus(); return; }
        await withBusy(el, async () => {
          if (!items().length || stale()) { await resolveScope(); render(); } // 范围 / 规则改过就先重算
          const r = await act({ type: 'save', mode, id: E.plan.id, isNew: E.isNew, values: values() });
          if (mode === 'draft') { E.isNew = false; E.dirty = false; await reopen(r.id); } else { E = null; renderChrome(); render(); }
        });
        break;
      }
      case 'approve': await withBusy(el, async () => { await act({ type: 'approve', id: E.orig.id }); await reopen(E.orig.id); }); break;
      case 'reject': await withBusy(el, async () => { await act({ type: 'reject', id: E.orig.id, note: $('#reject-note')?.value || '' }); E = null; renderChrome(); render(); }); break;
      case 'pause': case 'resume': await withBusy(el, async () => { await act({ type: a, id: E.orig.id }); await reopen(E.orig.id); }); break;
      case 'stop': if (!armed(el, '再点一次:提前结束并恢复原价')) return; await withBusy(el, async () => { await act({ type: 'stop', id: E.orig.id }); await reopen(E.orig.id); }); break;
      case 'delete': if (!armed(el)) return; await withBusy(el, async () => { await act({ type: 'delete', id: E.orig.id }); E = null; renderChrome(); render(); }); break;
      case 'exclude': if (!armed(el, '再点一次:移出并恢复原价')) return; await withBusy(el, async () => { await act({ type: 'exclude', id: E.orig.id, variantIds: [el.dataset.v] }); await reopen(E.orig.id); }); break;
      case 'dup': case 'dupnext': {
        const src = clone(P());
        const shift = a === 'dupnext' ? DAY : 0;
        const slots = src.slots.map((s) => ({ ...s, id: uid('s_'), start: s.start + shift, end: s.end == null ? null : s.end + shift }));
        const name = a === 'dupnext' ? `${src.name.replace(/(第\s*\d+\s*天|D\d+)$/, '').trim()} ${fmtD(slots[0].start)}` : `${src.name}(副本)`;
        openEditor({ ...src, id: uid('p_'), name, state: 'new', slots, excluded: [], applied: {}, pendingChange: null, paused: false, stopped: false }, true);
        if (shift) toast('已复制成下一天,确认时间和产品后提交');
        break;
      }
      case 'qapprove': await withBusy(el, async () => { await act({ type: 'approve', id: el.dataset.id }); render(); }); break;
      case 'qpause': { const p = planById(el.dataset.id); await withBusy(el, async () => { await act({ type: p.paused ? 'resume' : 'pause', id: p.id }); render(); }); break; }
      case 'qstop': if (!armed(el, '再点一次:提前结束并恢复原价')) return; await withBusy(el, async () => { await act({ type: 'stop', id: el.dataset.id }); render(); }); break;
      case 'qdup': case 'qdupnext': { const p = planById(el.dataset.id); openEditor(p, false); loadCampaigns();
        document.querySelector(`#section-price [data-a="${a === 'qdupnext' ? 'dupnext' : 'dup'}"]`)?.click(); break; }
      case 'fixhold': await withBusy(el, async () => { await act({ type: 'resolve', variantId: el.dataset.v, choice: el.dataset.c }); render(); }); break;
      case 'runnow': await withBusy(el, async () => { const r = await api('POST', '/api/price/run-now'); toast(`对齐完成:改价 ${r.written} 个,暂停接管 ${r.holds} 个,失败 ${r.failures} 个`); await load(); render(); }); break;
      case 'dlvault': await withBusy(el, () => download('/api/price/export/vault.csv', `还原表格-${toInput(now()).slice(0, 10)}.csv`)); break;
      case 'dlledger': await withBusy(el, () => download(`/api/price/export/ledger.csv?plan=${encodeURIComponent(ledgerQ.plan)}`, `价格账本-${toInput(now()).slice(0, 10)}.csv`)); break;
      case 'lpage': ledgerQ.offset = Math.max(0, ledgerQ.offset + Number(el.dataset.d) * 100); loadLedger(); break;
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
  if (!E) return;
  if (el.name === 'rmode') { E.plan.rule.mode = el.value; E.resolvedKey = ''; touch(); render(); return; }
  const f = el.dataset.f;
  if (!f) return;
  const s = curSlot();
  const norm = (v) => { const t = String(v).trim().replace(/^£/, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n.toFixed(2) : undefined; };
  switch (f) {
    case 'name': E.plan.name = el.value; touch(); break;
    case 'note': E.plan.note = el.value; touch(); break;
    case 'compare': E.plan.compare = el.value; E.resolvedKey = ''; touch(); render(); break;
    case 'rvalue': E.plan.rule.value = el.value; E.resolvedKey = ''; touch(); render(); break;
    case 'rrounding': E.plan.rule.rounding = el.value; E.resolvedKey = ''; touch(); render(); break;
    case 'rfrom': E.plan.rule.from = el.value; E.resolvedKey = ''; touch(); render(); break;
    case 'svendor': case 'stag': case 'stype': E.plan.scope[{ svendor: 'vendor', stag: 'tag', stype: 'type' }[f]] = el.value.trim(); E.resolvedKey = ''; touch(); break;
    case 'campaign': { const c = (cache.campaigns || []).find((x) => x.id === el.value); E.plan.campaign = c ? { id: c.id, name: c.name } : null; touch(); break; }
    case 'owner': E.plan.owner = el.value || null; touch(); break;
    case 'approver': E.plan.approver = el.value || null; touch(); render(); break; // 换审批人会改变底部按钮(审批人自己提交 = 直接生效)
    case 'cc': { const set = new Set(E.plan.cc || []); el.checked ? set.add(el.value) : set.delete(el.value); E.plan.cc = [...set]; touch(); break; }
    case 'start': s.start = fromInput(el.value); touch(); render(); break;
    case 'end': s.end = fromInput(el.value); touch(); render(); break;
    case 'iprice': case 'icompare': {
      const v = norm(el.value); if (v === undefined) { toast('价格格式不对', false); render(); return; }
      const it = s.items.find((i) => i.variantId === el.dataset.v);
      if (f === 'iprice') { it.price = v; it.manual = true; } else it.compareAt = v; // 手改过的,重新试算时保留
      touch(); render(); break;
    }
    default: break;
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'lq') { clearTimeout(ev.target._t); ev.target._t = setTimeout(() => { ledgerQ.q = ev.target.value; ledgerQ.offset = 0; loadLedger(); }, 300); }
  if (!E || !ev.target.closest('#section-price')) return;
  const f = ev.target.dataset.f;
  if (f === 'name') { E.plan.name = ev.target.value; E.dirty = true; const b = document.querySelector('#section-price .pr-sum__h b'); if (b) b.textContent = ev.target.value || '(还没起名字)'; }
});
// 标签输入框:回车添加
document.addEventListener('keydown', (ev) => {
  const k = ev.target.dataset?.addtag;
  if (!k || ev.key !== 'Enter' || !E) return;
  ev.preventDefault();
  const t = ev.target.value.trim();
  if (t && !E.plan[k].includes(t)) { E.plan[k].push(t); touch(); render(); }
  else ev.target.value = '';
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'coll-q') $('[data-a=collsearch]')?.click(); });

async function loadCampaigns(rerender) {
  if (cache.campaigns) { if (rerender) render(); return; }
  try { cache.campaigns = (await api('GET', '/api/price/campaigns')).campaigns; } catch { cache.campaigns = []; }
  if (E) render();
}

// 每 30 秒刷新一次状态(执行器在后台改价;只在看改价页、没在编辑时)
const visible = () => document.getElementById('section-price')?.classList.contains('is-active');
setInterval(async () => { if (!S || E || document.hidden || !visible()) return; try { await load(); if (tab !== 'ledger') render(); } catch { /* 忽略 */ } }, 30_000);

// ================= 启动 =================
// 点开「改价」时才加载(registry.js 的 showSection 是全局函数,包一层)
let booted = false;
async function start() {
  if (booted) { try { await load(); if (!E) render(); } catch { /* 忽略 */ } return; }
  booted = true;
  try { await load(); render(); }
  catch (e) { booted = false; $('#pr-root').innerHTML = `<div class="banner banner--danger">${esc(e.message)}</div>`; }
}
// 活动总控台里点改价计划 / 「+ 改价计划」时用
window.cgpPriceOpen = async (id) => { await start(); const p = planById(id); if (p) { openEditor(p, false); loadCampaigns(); } };
window.cgpPriceNew = async (campaign) => { await start(); const p = newPlan('window', false); p.campaign = campaign; p.name = campaign.name; openEditor(p, true); loadCampaigns(); };
const show0 = window.showSection;
window.showSection = (name) => { show0(name); if (name === 'price') start(); };
await window.CGP_AUTH;
if (window.cgpCanSee('price')) { try { await load(); } catch { /* 进页面时再试 */ } }
