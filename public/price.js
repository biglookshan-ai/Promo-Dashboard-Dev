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
    <button class="btn" data-a="new" data-kind="window" data-daily="1">+ Flash 每日日程</button>
    <button class="btn" data-a="new" data-kind="permanent">+ 永久调价</button>
    <span class="spacer"></span>
  </div>
  <div class="pr-tabs">${FILTERS.map(([k, label, fn]) => `<button class="${k === filter ? 'is-on' : ''}" data-a="filter" data-f="${k}">${label} ${count(fn)}</button>`).join('')}</div>
  ${list.length ? list.map(({ p, s }) => planRow(p, s)).join('') : '<div class="pr-empty">这里还没有计划</div>'}`;
}

function planRow(p, s) {
  const sum = A.planSummary(p);
  const items = p.slots.flatMap((x) => x.items).filter((i) => i.price != null);
  const maxOff = items.reduce((m, i) => Math.max(m, core.discountPct(i.refPrice, i.price)), 0);
  const holds = holdsOf(p.id).length;
  const live = S.vault.filter((v) => v.written?.planId === p.id).length;
  return `<div class="plan" data-a="open" data-id="${p.id}">
    <div class="plan__bar ${layerCls(p)}"></div>
    <div>
      <div class="plan__name">${esc(p.name || '未命名计划')}
        <span class="tag ${STATUS_TAG[s]}">${core.STATUS_CN[s]}</span>
        <span class="tag ${p.kind === 'window' ? 'tag--' + layerCls(p) : ''}">${kindLabel(p)}</span>
        ${p.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}
        ${holds ? `<span class="tag tag--danger">${holds} 个暂停接管</span>` : ''}
        ${p.campaign ? `<span class="tag">活动:${esc(p.campaign.name)}</span>` : ''}
        <span class="tag">审批:${p.approver ? esc(nameOf(p.approver)) : '管理员'}</span>${p.owner ? `<span class="tag">负责:${esc(nameOf(p.owner))}</span>` : ''}
      </div>
      <div class="plan__meta">
        <span>${fmtT(sum.start)}${sum.end ? ' → ' + fmtT(sum.end) : ' 起生效'}</span>
        ${sum.slots > 1 ? `<span>${sum.slots} 个时段</span>` : ''}
        <span>${sum.products} 个产品 / ${sum.variants} 个变体</span>
        ${maxOff > 0 ? `<span>最大降幅 ${maxOff}%</span>` : ''}
        ${live ? `<span>此刻 ${live} 个变体在活动价上</span>` : ''}
        ${p.state === 'rejected' && p.rejectNote ? `<span style="color:var(--danger)">退回意见:${esc(p.rejectNote)}</span>` : ''}
      </div>
    </div>
    <div class="plan__right">›</div>
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
function newPlan(kind, daily) {
  const start = dayAt(1);
  const slots = kind === 'permanent' ? [{ id: uid('s_'), start, end: null, items: [] }]
    : daily ? Array.from({ length: 5 }, (_, i) => ({ id: uid('s_'), start: dayAt(1 + i), end: dayAt(2 + i), items: [], collection: null }))
      : [{ id: uid('s_'), start, end: dayAt(8), items: [], collection: null }];
  return { id: uid('p_'), name: daily ? 'Flash Sale 每日限时' : '', kind, layer: daily ? 'flash' : 'sitewide', compare: kind === 'window' ? 'original' : 'keep', campaign: null, note: '', slots, state: 'new', excluded: [],
    owner: S.me.id, approver: null, cc: [] };
}
function openEditor(plan, isNew, slot = 0) {
  E = { plan: clone(plan), orig: isNew ? null : plan, isNew, slot: Math.min(slot, plan.slots.length - 1), sel: new Set(), panel: null, dirty: isNew,
    rule: { mode: plan.kind === 'permanent' ? 'percent_up' : 'percent_off', value: plan.kind === 'permanent' ? 5 : 15, rounding: '', from: 'price' }, showPending: false };
  renderChrome(); render(); window.scrollTo(0, 0);
}
const P = () => (E.showPending && E.orig?.pendingChange ? { ...E.orig, ...E.orig.pendingChange } : E.plan);
const curSlot = () => P().slots[E.slot];
const started = () => !E.isNew && E.orig?.state === 'approved' && E.orig.slots.some((s) => s.start <= now());
const slotLocked = (s) => !E.isNew && E.orig?.state === 'approved' && !!E.orig.slots.find((o) => o.id === s.id && o.start <= now());
function readonly() {
  if (E.showPending) return true;
  if (E.isNew) return false;
  const s = statusOf(E.orig);
  if (['ended', 'done'].includes(s)) return true;
  if (E.orig.kind === 'permanent' && Object.keys(E.orig.applied || {}).length) return true;
  return false;
}
const slotRO = (s) => readonly() || slotLocked(s);
const opts = () => ({ maxDiscountPct: S.settings.maxDiscountPct });

function editorHtml() {
  const p = P(); const ro = readonly();
  const st = E.isNew ? null : statusOf(E.orig);
  const kindLocked = ro || started();
  return `
  <div class="edhead">
    <button class="btn btn-ghost" data-a="close">← 返回</button>
    <input class="inp" data-f="name" value="${esc(p.name)}" placeholder="计划名称,比如:Early Black Friday · 全场" ${ro ? 'disabled' : ''}/>
    ${st ? `<span class="tag ${STATUS_TAG[st]}">${core.STATUS_CN[st]}</span>` : '<span class="tag">新计划</span>'}
    ${E.dirty && !ro ? '<span class="tag tag--warn">有未保存的改动</span>' : ''}
  </div>
  ${bannersHtml()}
  <div class="pr-card">
    <div class="pr-card__t">基本设置</div>
    <div class="grid2">
      <div class="pr-fld">类型
        <div class="pr-seg">${[['window', '限时(到期自动恢复原价)'], ['permanent', '永久(到点改,不恢复)']].map(([k, l]) => `<button class="${p.kind === k ? 'is-on' : ''}" data-a="set" data-k="kind" data-v="${k}" ${kindLocked ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      </div>
      ${p.kind === 'window' ? `<div class="pr-fld">层级 <em>同一产品同时在几个限时计划里时,层级高的生效;它结束后回到下一层的价</em>
        <div class="pr-seg">${[['sitewide', '全场'], ['brand', '品牌 / 合集'], ['flash', '限时抢购']].map(([k, l]) => `<button class="${p.layer === k ? 'is-on' : ''}" data-a="set" data-k="layer" data-v="${k}" ${kindLocked ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      </div>` : ''}
      <label class="pr-fld">划线价
        <select class="sel" data-f="compare" ${kindLocked ? 'disabled' : ''}>${Object.entries(core.COMPARE_CN).map(([k, l]) => `<option value="${k}" ${(p.compare || (p.kind === 'window' ? 'original' : 'keep')) === k ? 'selected' : ''}>${l}${k === 'original' ? '(显示 was / now)' : ''}</option>`).join('')}</select>
      </label>
      <label class="pr-fld">关联活动 <em>可选。关联后在活动里能看到这次改价,也能「按活动的产品范围」加产品</em>
        <select class="sel" data-f="campaign" ${ro ? 'disabled' : ''}><option value="">不关联</option>${(cache.campaigns || []).map((c) => `<option value="${c.id}" ${p.campaign?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          ${p.campaign && !(cache.campaigns || []).some((c) => c.id === p.campaign.id) ? `<option value="${p.campaign.id}" selected>${esc(p.campaign.name)}</option>` : ''}</select>
      </label>
      <label class="pr-fld">负责人 <em>谁负责这次改价(会收到生效 / 恢复 / 异常的私信)</em>
        <select class="sel" data-f="owner" ${ro ? 'disabled' : ''}><option value="">不指定</option>${S.people.map((u) => `<option value="${u.id}" ${p.owner === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      </label>
      <label class="pr-fld">审批人 <em>谁来批准;不指定 = 管理员审批。审批人自己提交的直接生效</em>
        <select class="sel" data-f="approver" ${ro ? 'disabled' : ''}><option value="">管理员审批</option>${S.people.map((u) => `<option value="${u.id}" ${p.approver === u.id ? 'selected' : ''}>${esc(u.name)}${u.admin ? '(管理员)' : ''}</option>`).join('')}</select>
      </label>
      <div class="pr-fld" style="grid-column:1/-1">抄送 <em>只私信通知,不能批准;只能选能看改价页的人(改价信息保密)</em>
        <div class="row">${S.people.map((u) => `<label class="row" style="gap:4px;font-size:13px"><input type="checkbox" data-f="cc" value="${u.id}" ${(p.cc || []).includes(u.id) ? 'checked' : ''} ${ro ? 'disabled' : ''}/>${esc(u.name)}</label>`).join('') || '<span class="muted">还没有别的能看改价页的成员</span>'}</div>
      </div>
      <label class="pr-fld" style="grid-column:1/-1">备注 <textarea class="inp" rows="2" data-f="note" ${ro ? 'disabled' : ''} placeholder="给审核人看的说明,比如:配合首页 Banner,Flash 每天 0 点换">${esc(p.note || '')}</textarea></label>
    </div>
  </div>
  <div class="pr-card">
    <div class="pr-card__t">${p.kind === 'permanent' ? '生效时间和产品' : '时段和产品'} <span class="muted">时间一律是英国时间</span></div>
    ${p.kind === 'window' ? `<div class="slots">${p.slots.map((s, i) => `<button class="slottab ${i === E.slot ? 'is-on' : ''} ${slotLocked(s) ? 'is-locked' : ''}" data-a="slot" data-i="${i}">
        <b>${p.slots.length > 1 ? `第 ${i + 1} 段 · ` : ''}${fmtD(s.start)}</b>${fmtT(s.start, { weekday: undefined, month: undefined, day: undefined })}–${s.end ? fmtT(s.end, { weekday: undefined }) : '?'} · ${s.items.length} 个变体</button>`).join('')}
      ${ro ? '' : `<button class="btn btn-sm" data-a="addslot">+ 加一个时段</button><button class="btn btn-sm" data-a="panel" data-p="days">按天生成…</button>`}
    </div>` : ''}
    ${E.panel === 'days' ? daysPanel() : ''}
    ${slotHtml(curSlot())}
  </div>
  ${checkHtml()}
  <div class="footbar">${footHtml()}</div>`;
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
  if (started() && !o.stopped && statusOf(o) !== 'ended') out.push('<div class="banner banner--info">已经开始的时段锁定了(🔒):不能改时间和价格,只能暂停、提前结束或把产品移出。还没开始的时段可以改,改完要重新审核。</div>');
  if (E.panel === 'reject') out.push(`<div class="pr-panel"><div class="row"><input class="inp" id="reject-note" placeholder="退回原因(会发给提交人)" style="flex:1"/><button class="btn btn-danger" data-a="reject">确认退回</button><button class="btn btn-ghost" data-a="panel" data-p="">取消</button></div></div>`);
  return out.join('');
}
function diffLines(a, b) {
  const out = [];
  const ids = new Set([...a.slots.map((s) => s.id), ...b.slots.map((s) => s.id)]);
  let i = 0;
  for (const id of ids) {
    i++;
    const x = a.slots.find((s) => s.id === id); const y = b.slots.find((s) => s.id === id);
    if (!x) { out.push(`新增时段 ${fmtT(y.start)}:${y.items.length} 个变体`); continue; }
    if (!y) { out.push(`删除时段 ${fmtT(x.start)}`); continue; }
    if (x.start !== y.start || x.end !== y.end) out.push(`时段 ${i} 时间改成 ${fmtT(y.start)} → ${fmtT(y.end)}`);
    const mx = new Map(x.items.map((t) => [t.variantId, t])); const my = new Map(y.items.map((t) => [t.variantId, t]));
    const add = [...my.keys()].filter((k) => !mx.has(k)).length; const del = [...mx.keys()].filter((k) => !my.has(k)).length;
    const chg = [...my.keys()].filter((k) => mx.has(k) && (mx.get(k).price !== my.get(k).price || (mx.get(k).compareAt ?? null) !== (my.get(k).compareAt ?? null))).length;
    if (add || del || chg) out.push(`时段 ${i}:${[add && `加 ${add} 个变体`, del && `删 ${del} 个`, chg && `改价 ${chg} 个`].filter(Boolean).join('、')}`);
    if ((x.collection?.id || null) !== (y.collection?.id || null)) out.push(`时段 ${i} 的加入合集改成「${y.collection?.title || '不加'}」`);
  }
  return out;
}

function daysPanel() {
  const s = curSlot();
  return `<div class="pr-panel"><div class="row">
    从 <input class="inp" type="date" id="d-from" style="width:auto" value="${toInput(s?.start ?? dayAt(1)).slice(0, 10)}"/>
    开始,共 <input class="inp" type="number" id="d-n" min="1" max="31" value="${Math.max(P().slots.length, 5)}" style="width:70px"/> 天,每天
    <input class="inp" type="time" id="d-at" value="${toInput(s?.start ?? dayAt(1)).slice(11, 16)}" style="width:auto"/> 切换
    <button class="btn btn-primary btn-sm" data-a="gendays">生成</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button>
  </div><p class="muted">已有的时段按顺序保留产品和价格,只改时间;多出来的天是空的(可以用「从其他时段复制」)。</p></div>`;
}

function slotHtml(s) {
  if (!s) return '<div class="pr-empty">没有时段</div>';
  const p = P(); const ro = slotRO(s);
  const items = s.items;
  const ex = new Set(p.excluded || []);
  return `
  <div class="grid2" style="margin-bottom:10px">
    <label class="pr-fld">${p.kind === 'permanent' ? '生效时间' : '开始'}<input class="inp" type="datetime-local" data-f="start" value="${toInput(s.start)}" ${ro ? 'disabled' : ''}/>
      ${p.kind === 'permanent' && !ro ? '<button class="linkbtn" data-a="startnow" style="text-align:left">设成现在(批准后一分钟内执行)</button>' : ''}</label>
    ${p.kind === 'window' ? `<label class="pr-fld">结束(到点恢复原价)<input class="inp" type="datetime-local" data-f="end" value="${toInput(s.end)}" ${ro ? 'disabled' : ''}/></label>
    <div class="pr-fld">这个时段内把产品加进合集 <em>只能选手动合集;时段结束自动移出(原来就在合集里的不动)</em>
      ${s.collection ? `<div class="row"><span class="tag tag--accent">${esc(s.collection.title)}</span>${ro ? '' : '<button class="linkbtn" data-a="unsetcoll">不加了</button>'}</div>`
        : ro ? '<span class="muted">不加</span>' : '<button class="btn btn-sm" data-a="panel" data-p="slotcoll" style="width:fit-content">选合集…</button>'}
    </div>` : ''}
  </div>
  ${E.panel === 'slotcoll' ? collPanel('slotcoll') : ''}
  ${ro ? '' : `<div class="addbar">
    <span class="muted" style="align-self:center">添加产品:</span>
    <button class="btn btn-sm" data-a="pick">选产品</button>
    <button class="btn btn-sm" data-a="panel" data-p="coll">按合集</button>
    <button class="btn btn-sm" data-a="panel" data-p="vendor">按品牌</button>
    <button class="btn btn-sm" data-a="panel" data-p="tag">按标签 / 类型</button>
    <button class="btn btn-sm" data-a="panel" data-p="camp">按活动的产品范围</button>
    ${p.slots.length > 1 ? '<button class="btn btn-sm" data-a="panel" data-p="copy">从其他时段复制</button>' : ''}
    <span class="spacer"></span>
    ${items.length ? `<button class="btn btn-sm btn-ghost" data-a="slotdel" ${p.slots.length < 2 ? 'hidden' : ''}>删除这个时段</button>` : p.slots.length > 1 ? '<button class="btn btn-sm btn-ghost" data-a="slotdel">删除这个时段</button>' : ''}
  </div>
  ${E.panel === 'coll' ? collPanel('coll') : ''}${E.panel === 'vendor' ? vendorPanel() : ''}${E.panel === 'tag' ? tagPanel() : ''}${E.panel === 'camp' ? campPanel() : ''}${E.panel === 'copy' ? copyPanel() : ''}
  ${items.length ? ruleBar() : ''}`}
  ${items.length ? tableHtml(s, ro, ex) : '<div class="pr-empty">这个时段还没有产品</div>'}`;
}

function collPanel(which) {
  const list = cache.collSearch || [];
  return `<div class="pr-panel"><div class="row"><input class="inp" id="coll-q" placeholder="搜合集名称" style="flex:1" value="${esc(cache.collQ || '')}"/><button class="btn btn-sm" data-a="collsearch" data-w="${which}">搜索</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div>
    <div class="results">${list.map((c) => `<div class="result"><b style="flex:1">${esc(c.title)}</b><span class="muted">${c.count ?? '?'} 个产品 · ${c.smart ? '智能合集' : '手动合集'}</span>
      ${which === 'slotcoll' ? (c.smart ? '<span class="muted">按条件自动,不能加</span>' : `<button class="btn btn-sm" data-a="setcoll" data-id="${c.id}" data-t="${esc(c.title)}">选这个</button>`)
        : `<button class="btn btn-sm" data-a="addcoll" data-id="${c.id}">加入全部产品</button>`}</div>`).join('') || '<span class="muted">输入名称搜索</span>'}</div></div>`;
}
function vendorPanel() {
  return `<div class="pr-panel"><div class="row"><select class="sel" id="vendor" style="flex:1">${(cache.vendors || []).map((v) => `<option>${esc(v)}</option>`).join('') || '<option value="">加载中…</option>'}</select>
    <button class="btn btn-sm btn-primary" data-a="addvendor">加入这个品牌的全部产品</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div></div>`;
}
function tagPanel() {
  return `<div class="pr-panel"><div class="row"><input class="inp" id="tag" placeholder="标签,比如 New Gear" style="flex:1"/><input class="inp" id="ptype" placeholder="或产品类型,比如 Cine Lens" style="flex:1"/>
    <button class="btn btn-sm btn-primary" data-a="addtag">加入</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div><p class="muted">两个都填 = 同时满足。</p></div>`;
}
function campPanel() {
  return `<div class="pr-panel"><div class="row"><select class="sel" id="camp" style="flex:1">${(cache.campaigns || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">网站更新中心还没有活动</option>'}</select>
    <button class="btn btn-sm btn-primary" data-a="addcamp">加入活动圈定的产品</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div>
    <p class="muted">活动的产品 = 它的合集 + 标签 + 指定产品(在网站更新中心里设的),两边只圈一次。</p></div>`;
}
function copyPanel() {
  const p = P();
  return `<div class="pr-panel"><div class="row">从 <select class="sel" id="copy-from">${p.slots.map((s, i) => (i === E.slot ? '' : `<option value="${i}">第 ${i + 1} 段 · ${fmtD(s.start)}(${s.items.length} 个变体)</option>`)).join('')}</select>
    复制产品和价格到这一段 <button class="btn btn-sm btn-primary" data-a="copyslot">复制</button><button class="btn btn-ghost btn-sm" data-a="panel" data-p="">取消</button></div></div>`;
}

function ruleBar() {
  const r = E.rule;
  const modes = E.plan.kind === 'permanent'
    ? [['percent_up', '涨价 %'], ['percent_off', '降价 %'], ['amount_off', '减金额 £'], ['fixed', '指定价 £'], ['keep', '售价不变(只改划线价)']]
    : [['percent_off', '降价 %'], ['amount_off', '减金额 £'], ['fixed', '指定价 £']];
  return `<div class="rulebar">
    <select class="sel" data-r="mode">${modes.map(([k, l]) => `<option value="${k}" ${r.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${r.mode !== 'keep' ? `<input class="inp" type="number" step="0.01" min="0" data-r="value" value="${esc(r.value)}" style="width:90px"/>` : ''}
    ${['fixed', 'keep'].includes(r.mode) ? '' : `尾数 <select class="sel" data-r="rounding"><option value="" ${!r.rounding ? 'selected' : ''}>不取整</option><option value="99" ${r.rounding === '99' ? 'selected' : ''}>.99(向下)</option><option value="00" ${r.rounding === '00' ? 'selected' : ''}>整数(向下)</option></select>`}
    ${['percent_off', 'amount_off'].includes(r.mode) ? `按 <select class="sel" data-r="from"><option value="price" ${r.from !== 'compare' ? 'selected' : ''}>现售价</option><option value="compare" ${r.from === 'compare' ? 'selected' : ''}>划线价(RRP)</option></select> 算` : ''}
    <span class="spacer"></span>
    <button class="btn btn-sm btn-primary" data-a="apply" data-scope="sel" ${E.sel.size ? '' : 'disabled'}>套用到选中的(${E.sel.size})</button>
    <button class="btn btn-sm" data-a="apply" data-scope="all">套用到这一段全部</button>
  </div>`;
}

function tableHtml(s, ro, ex) {
  const p = P();
  const setCompare = (p.compare || '') === 'set';
  let lastPid = null;
  const rows = s.items.map((it) => {
    const first = it.productId !== lastPid; lastPid = it.productId;
    const w = core.itemWarnings(p, it, opts());
    const t = (() => { try { return core.targetFor({ price: it.refPrice, compareAt: it.refCompareAt }, p, it); } catch { return null; } })();
    const d = it.price != null ? core.discountPct(it.refPrice, it.price) : null;
    const gone = ex.has(it.variantId);
    const vs = S.vault.find((v) => v.id === it.variantId && (v.written?.planId === E.orig?.id || v.hold?.planId === E.orig?.id));
    return `<tr class="${first ? 'is-first' : ''}" style="${gone ? 'opacity:.45' : ''}">
      <td>${ro ? '' : `<input type="checkbox" data-a="sel" data-v="${it.variantId}" ${E.sel.has(it.variantId) ? 'checked' : ''}/>`}</td>
      <td>${first ? `<div class="pcell">${it.image ? `<img class="pimg" src="${esc(it.image)}" loading="lazy" alt=""/>` : '<span class="pimg"></span>'}<div><div class="pcell__t">${esc(it.product || it.title)}</div><div class="pcell__s">${esc(it.vendor || '')}</div></div></div>` : ''}</td>
      <td>${esc(it.variant || '')}<div class="pcell__s">${esc(it.sku || '')}</div></td>
      <td class="num">${money(it.refPrice)}${it.refCompareAt && Number(it.refCompareAt) > Number(it.refPrice) ? `<div><s>${money(it.refCompareAt)}</s></div>` : ''}${it.cost != null ? `<div class="pcell__s">成本 ${money(it.cost)}</div>` : ''}</td>
      <td class="num">${ro || gone ? `<b>${it.price != null ? money(it.price) : '不变'}</b>` : `<input class="inp" data-f="iprice" data-v="${it.variantId}" value="${it.price ?? ''}" placeholder="${p.kind === 'window' ? '未设' : '不变'}"/>`}</td>
      <td class="num">${setCompare && !ro && !gone ? `<input class="inp" data-f="icompare" data-v="${it.variantId}" value="${it.compareAt ?? ''}" placeholder="无"/>` : t?.compareAt ? `<s>${money(t.compareAt)}</s>` : '<span class="muted">无</span>'}</td>
      <td class="num">${d == null ? '' : d > 0 ? `<span class="off">-${d}%</span>` : d < 0 ? `<span class="up">+${-d}%</span>` : '0%'}</td>
      <td>${gone ? '<span class="w w--warn">已移出</span>' : ''}${vs?.hold ? '<span class="w w--error">暂停接管</span>' : vs?.written ? '<span class="w" style="background:var(--ok-soft);color:var(--ok)">活动价中</span>' : ''}${w.map((x) => `<span class="w w--${x.level}">${esc(x.text)}</span>`).join('')}</td>
      <td>${gone ? '' : slotLocked(s) && !E.showPending ? `<button class="linkbtn" data-a="exclude" data-v="${it.variantId}" title="移出后下一分钟恢复原价">移出</button>` : ro ? '' : `<button class="linkbtn" data-a="rm" data-v="${it.variantId}" title="删除">✕</button>`}</td>
    </tr>`;
  }).join('');
  return `<div class="row" style="margin-bottom:6px"><span class="muted">${new Set(s.items.map((i) => i.productId)).size} 个产品 / ${s.items.length} 个变体</span><span class="spacer"></span>
    ${!ro && E.sel.size ? `<button class="btn btn-sm btn-ghost" data-a="rmsel">删除选中的(${E.sel.size})</button>` : ''}</div>
  <div class="tblwrap"><table class="pr-tbl"><thead><tr><th>${ro ? '' : '<input type="checkbox" data-a="selall"/>'}</th><th>产品</th><th>变体 / SKU</th><th class="num">现价</th><th class="num">${p.kind === 'window' ? '活动价' : '新价'}</th><th class="num">划线价</th><th class="num">变化</th><th>检查</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function checkHtml() {
  const p = P();
  const items = p.slots.flatMap((s) => s.items);
  if (!items.length) return '';
  const ex = new Set(p.excluded || []);
  const ws = items.filter((i) => !ex.has(i.variantId)).map((i) => core.itemWarnings(p, i, opts()));
  const errs = ws.filter((w) => w.some((x) => x.level === 'error')).length + items.filter((i) => p.kind === 'window' && i.price == null).length;
  const warns = ws.filter((w) => w.some((x) => x.level === 'warn')).length;
  const offs = items.filter((i) => i.price != null).map((i) => core.discountPct(i.refPrice, i.price));
  const ov = core.overlaps({ ...p, state: 'approved' }, S.plans);
  const byOther = new Map();
  for (const o of ov) { const k = o.other.planId; if (!byOther.has(k)) byOther.set(k, { ...o.other, n: new Set(), wins: o.wins }); byOther.get(k).n.add(o.variantId); }
  const err = A.validate(p, opts());
  return `<div class="pr-card"><div class="pr-card__t">提交前检查</div>
    <div class="check">
      <div><b>${new Set(items.map((i) => i.productId)).size}</b>个产品</div>
      <div><b>${new Set(items.map((i) => i.variantId)).size}</b>个变体</div>
      <div class="${errs ? 'is-bad' : ''}"><b>${errs}</b>个有错误(不能提交)</div>
      <div class="${warns ? 'is-warn' : ''}"><b>${warns}</b>个要留意</div>
      <div><b>${offs.length ? Math.max(...offs) : 0}%</b>最大降幅</div>
    </div>
    ${[...byOther.values()].map((o) => `<div class="banner banner--info" style="margin-bottom:6px">${o.n.size} 个变体同时在「${esc(o.name)}」(${core.LAYER_CN[o.layer] || ''})里:时间重叠期间以「${o.wins ? esc(p.name || '本计划') : esc(o.name)}」的价格为准${o.wins ? `,本计划结束后回到「${esc(o.name)}」的价` : ''}。</div>`).join('')}
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
  if (!E.isNew && (!['running', 'paused'].includes(st)) && (o.state !== 'approved' || ap)) b.push('<button class="btn btn-ghost btn-danger" data-a="delete">删除</button>');
  if (E.isNew) b.push('<button class="btn btn-ghost" data-a="close">放弃</button>');
  return b.join('');
}

// ---- 编辑器里的改动 ----
function touch() { E.dirty = true; }
function addProducts(products) {
  const s = curSlot(); const have = new Set(s.items.map((i) => i.variantId));
  let n = 0;
  for (const pr of products) for (const v of pr.variants) {
    if (have.has(v.id)) continue;
    const it = { variantId: v.id, productId: pr.id, title: `${pr.title}${v.title ? ' - ' + v.title : ''}`, product: pr.title, variant: v.title, sku: v.sku, vendor: pr.vendor, image: pr.image,
      refPrice: v.price, refCompareAt: v.compareAt, cost: v.cost, price: null };
    try { if (E.rule.mode !== 'keep') it.price = core.priceByRule({ price: v.price, compareAt: v.compareAt }, E.rule); } catch { /* 规则还没填好就先不设价 */ }
    s.items.push(it); have.add(v.id); n++;
  }
  touch(); E.panel = null;
  toast(n ? `加入 ${n} 个变体(已按当前规则算好价,可以逐个改)` : '这些产品已经在这一段里了');
  render();
}
async function withBusy(btn, fn) {
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '处理中…'; }
  try { await fn(); } catch (e) { toast(e.message, false); } finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = old; } }
}
function values() {
  const p = E.plan;
  return { id: p.id, name: p.name.trim(), kind: p.kind, layer: p.kind === 'window' ? p.layer : null, compare: p.compare || (p.kind === 'window' ? 'original' : 'keep'), campaign: p.campaign, note: p.note, slots: p.slots,
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
  if (p && E) { const slot = E.slot; openEditor(p, false, slot); } else { E = null; render(); }
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
      <button class="btn btn-sm" data-a="resolve" data-v="${v.id}" data-c="reapply">以店里现价为原价,重新套用活动价</button>
      <button class="btn btn-sm" data-a="resolve" data-v="${v.id}" data-c="keep">退出计划,保持现价</button>
      ${v.written ? `<button class="btn btn-sm" data-a="resolve" data-v="${v.id}" data-c="restore">恢复原价并退出计划</button>` : ''}</div>` : '<span class="muted">等审核人处理</span>'}
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
      case 'new': openEditor(newPlan(el.dataset.kind, !!el.dataset.daily), true); loadCampaigns(); break;
      case 'open': { const p = planById(el.dataset.id); if (p) { openEditor(p, false, Number(el.dataset.slot) || 0); loadCampaigns(); } break; }
      case 'close': if (E.dirty && !E.isNew && !armed(el, '有未保存的改动,再点一次放弃')) return; E = null; renderChrome(); render(); break;
      case 'set': if (el.disabled) return; E.plan[el.dataset.k] = el.dataset.v;
        if (el.dataset.k === 'kind') { E.plan.compare = el.dataset.v === 'window' ? 'original' : 'keep'; E.rule.mode = el.dataset.v === 'window' ? 'percent_off' : 'percent_up'; if (el.dataset.v === 'permanent') { E.plan.slots = [{ ...E.plan.slots[0], end: null, collection: null }]; E.slot = 0; } else if (!E.plan.slots[0].end) E.plan.slots[0].end = E.plan.slots[0].start + 7 * DAY; }
        touch(); render(); break;
      case 'slot': E.slot = Number(el.dataset.i); E.sel.clear(); E.panel = null; render(); break;
      case 'addslot': { const last = E.plan.slots[E.plan.slots.length - 1]; const len = (last.end ?? last.start + DAY) - last.start;
        E.plan.slots.push({ id: uid('s_'), start: last.end ?? last.start + DAY, end: (last.end ?? last.start + DAY) + len, items: [], collection: last.collection || null }); E.slot = E.plan.slots.length - 1; touch(); render(); break; }
      case 'slotdel': if (!armed(el)) return; E.plan.slots.splice(E.slot, 1); E.slot = Math.max(0, E.slot - 1); touch(); render(); break;
      case 'gendays': {
        const from = $('#d-from').value; const n = Math.min(31, Math.max(1, Number($('#d-n').value) || 1)); const at = $('#d-at').value || '00:00';
        const t0 = fromInput(`${from}T${at}`); const coll = E.plan.slots[0]?.collection || null;
        const slots = [];
        for (let i = 0; i < n; i++) { const old = E.plan.slots[i]; slots.push({ id: old && !slotLocked(old) ? old.id : uid('s_'), start: dayAt(i, at, t0), end: dayAt(i + 1, at, t0), items: old && !slotLocked(old) ? old.items : [], collection: old?.collection ?? coll }); }
        E.plan.slots = [...E.plan.slots.filter(slotLocked), ...slots.filter((s) => !E.plan.slots.some((o) => slotLocked(o) && o.id === s.id))];
        E.slot = 0; E.panel = null; touch(); render(); break;
      }
      case 'panel': E.panel = el.dataset.p || null;
        if (E.panel === 'vendor' && !cache.vendors) api('GET', '/api/price/catalog/vendors').then((d) => { cache.vendors = d.vendors; render(); }).catch((e) => toast(e.message, false));
        if (E.panel === 'camp') loadCampaigns(true);
        render(); break;
      case 'pick': {
        if (!window.shopify?.resourcePicker) { toast('选择器只能在 Shopify 后台里用', false); return; }
        const picked = await window.shopify.resourcePicker({ type: 'product', multiple: true, filter: { variants: false } });
        if (!picked?.length) return;
        await withBusy(el, async () => addProducts((await api('GET', `/api/price/catalog/products?ids=${picked.map((x) => x.id).join(',')}`)).products));
        break;
      }
      case 'collsearch': cache.collQ = $('#coll-q').value.trim(); await withBusy(el, async () => { cache.collSearch = (await api('GET', `/api/price/catalog/collections?q=${encodeURIComponent(cache.collQ)}`)).collections; render(); }); break;
      case 'addcoll': await withBusy(el, async () => { const d = await api('GET', `/api/price/catalog/collection?id=${encodeURIComponent(el.dataset.id)}`); if (d.truncated) toast('合集太大,只取了前 2000 个产品', false); addProducts(d.products); }); break;
      case 'setcoll': curSlot().collection = { id: el.dataset.id, title: el.dataset.t }; E.panel = null; touch(); render(); break;
      case 'unsetcoll': curSlot().collection = null; touch(); render(); break;
      case 'addvendor': { const v = $('#vendor').value; if (!v) return; await withBusy(el, async () => addProducts((await api('GET', `/api/price/catalog/search?vendor=${encodeURIComponent(v)}`)).products)); break; }
      case 'addtag': { const tag = $('#tag').value.trim(); const type = $('#ptype').value.trim(); if (!tag && !type) { toast('填一个标签或类型', false); return; }
        await withBusy(el, async () => addProducts((await api('GET', `/api/price/catalog/search?${new URLSearchParams({ ...(tag && { tag }), ...(type && { type }) })}`)).products)); break; }
      case 'addcamp': { const id = $('#camp').value; if (!id) return;
        await withBusy(el, async () => { const d = await api('GET', `/api/price/catalog/campaign?id=${encodeURIComponent(id)}`); if (!E.plan.campaign) E.plan.campaign = { id: d.campaign.id, name: d.campaign.name }; addProducts(d.products); }); break; }
      case 'copyslot': { const from = E.plan.slots[Number($('#copy-from').value)]; const s = curSlot(); const have = new Set(s.items.map((i) => i.variantId));
        const add = from.items.filter((i) => !have.has(i.variantId)).map(clone); s.items.push(...add); E.panel = null; touch(); toast(`复制了 ${add.length} 个变体`); render(); break; }
      case 'apply': {
        const s = curSlot(); const targets = el.dataset.scope === 'sel' ? s.items.filter((i) => E.sel.has(i.variantId)) : s.items;
        for (const it of targets) it.price = E.rule.mode === 'keep' ? null : core.priceByRule({ price: it.refPrice, compareAt: it.refCompareAt }, E.rule);
        touch(); toast(`已重算 ${targets.length} 个变体`); render(); break;
      }
      case 'sel': el.checked ? E.sel.add(el.dataset.v) : E.sel.delete(el.dataset.v); render(); break;
      case 'selall': { const s = curSlot(); if (el.checked) s.items.forEach((i) => E.sel.add(i.variantId)); else E.sel.clear(); render(); break; }
      case 'rm': { const s = curSlot(); s.items = s.items.filter((i) => i.variantId !== el.dataset.v); E.sel.delete(el.dataset.v); touch(); render(); break; }
      case 'rmsel': { const s = curSlot(); s.items = s.items.filter((i) => !E.sel.has(i.variantId)); E.sel.clear(); touch(); render(); break; }
      case 'startnow': curSlot().start = now() + 60_000; touch(); render(); break;
      case 'togglepending': E.showPending = !E.showPending; render(); break;
      case 'save': {
        const mode = el.dataset.m;
        if (!E.plan.name.trim()) { toast('先填计划名称', false); $('[data-f=name]')?.focus(); return; }
        await withBusy(el, async () => {
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
      case 'dup': { const src = clone(P()); const t = (s) => ({ ...s, id: uid('s_') });
        openEditor({ ...src, id: uid('p_'), name: `${src.name}(副本)`, state: 'new', slots: src.slots.map(t), excluded: [], applied: {}, pendingChange: null, paused: false, stopped: false }, true); break; }
      case 'resolve': await withBusy(el, async () => { await act({ type: 'resolve', variantId: el.dataset.v, choice: el.dataset.c }); render(); }); break;
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
  const f = el.dataset.f; const r = el.dataset.r;
  if (r) { E.rule[r] = el.value; render(); return; }
  if (!f) return;
  const s = curSlot();
  const norm = (v) => { const t = String(v).trim().replace(/^£/, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n.toFixed(2) : undefined; };
  switch (f) {
    case 'name': E.plan.name = el.value; touch(); break;
    case 'note': E.plan.note = el.value; touch(); break;
    case 'compare': E.plan.compare = el.value; touch(); render(); break;
    case 'campaign': { const c = (cache.campaigns || []).find((x) => x.id === el.value); E.plan.campaign = c ? { id: c.id, name: c.name } : null; touch(); break; }
    case 'owner': E.plan.owner = el.value || null; touch(); break;
    case 'approver': E.plan.approver = el.value || null; touch(); render(); break; // 换审批人会改变底部按钮(审批人自己提交 = 直接生效)
    case 'cc': { const set = new Set(E.plan.cc || []); el.checked ? set.add(el.value) : set.delete(el.value); E.plan.cc = [...set]; touch(); break; }
    case 'start': s.start = fromInput(el.value); touch(); render(); break;
    case 'end': s.end = fromInput(el.value); touch(); render(); break;
    case 'iprice': case 'icompare': {
      const v = norm(el.value); if (v === undefined) { toast('价格格式不对', false); render(); return; }
      const it = s.items.find((i) => i.variantId === el.dataset.v); if (f === 'iprice') it.price = v; else it.compareAt = v;
      touch(); render(); break;
    }
    default: break;
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'lq') { clearTimeout(ev.target._t); ev.target._t = setTimeout(() => { ledgerQ.q = ev.target.value; ledgerQ.offset = 0; loadLedger(); }, 300); }
  if (E && ev.target.dataset.f === 'name') { E.plan.name = ev.target.value; E.dirty = true; }
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
const show0 = window.showSection;
window.showSection = (name) => { show0(name); if (name === 'price') start(); };
await window.CGP_AUTH;
if (window.cgpCanSee('price')) { try { await load(); } catch { /* 进页面时再试 */ } }
