// 消息中心(v1 2026-11-09 上午;v2 同一天下午 —— 用户:现在只是开关,要每一类通知都能自定义样式、内容、推给谁、怎么推、什么时候推)。
//
// 各模块(src/notifier.js 网站内容、src/price/notifier.js 改价、scheduler 里的 Collection 排序 / 联合推广)只给「发生了什么 + 数据」:
//   { ev: 通知 key, data: { 字段: 值 }, path: 这一条在 app 里的网址, related: [相关的人], approvers: [审批人], actor: 做这件事的人, key?: 去重 }
// 有哪些通知、能显示哪些字段、默认样式在 src/notify-catalog.js(页面预览共用);这里按管理员的规则:
//   推给谁(to)→ 怎么推(via:飞书私信 / 哪几个群 / 群里 @ 相关的人)→ 什么时候推(when:马上 / 几分钟内合成一条 / 每天汇总 / 只在工作时间)→ 按样式(style)拼卡片发出去,记发送记录。
//
// 用户定的:管理员定规则,每个人能在「我的通知」关掉日常通知(出问题的关不掉);默认 日常 = 相关的人 + 管理员,出问题 = 相关的人 + 同部门 + 管理员;
//   「已创建 / 已修改 / 删除 / 暂停」这类有人动手的通知默认不发给动手的人自己(notActor)。不按活动 / 品牌细分(用户:太细太复杂)。
// 规则存在排期数据的 notifyCenter(成员也在那);没保存过时按老开关(设置 → 飞书通知、改价 → 设置 → 通知)和原来的群推默认值;
// v1(上午那版)存的规则按 OLD_KEY 带到新的通知上。发送记录 / 待发队列 / 去重放 DATA_DIR/notify/(和排期数据分开:schedule 目录里的文件会被 listShops 当成店铺)。
import fs from 'node:fs';
import path from 'node:path';
import { isAdmin, canSee, rolesOf, approvalsOn } from './members.js';
import { sendDMs } from './lark-bot.js';
import { sendLark, isLarkWebhook } from './lark.js';
import { appLink } from './app-links.js';
import { EVENTS, EV, CAT, CATS, OLD_KEY, defaultStyle, cleanStyle, renderCard, renderList, renderDigest, briefLine } from './notify-catalog.js';

export { EVENTS, EV };
const DAY = 86400000;
export const TZS = { 'Europe/London': '英国时间', 'Asia/Shanghai': '北京时间' };
export const eventsOn = () => EVENTS.filter((e) => !e.approvals || approvalsOn());

// ---------- 时间(按消息中心设的时区)----------
function parts(ms, tz) {
  const o = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}
const offset = (ms, tz) => { const p = parts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
function atLocal(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offset(guess, tz);
  const o2 = offset(t, tz); if (guess - o2 !== t) t = guess - o2; // 夏令时切换那天
  return t;
}
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 25 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
// 下一次到 HH:MM(今天还没到就今天,过了就明天)
export function nextAt(now, hhmm, tz) {
  const m = hm(hhmm) ?? 600; const p = parts(now, tz);
  let t = atLocal(p.y, p.mo, p.d, Math.floor(m / 60), m % 60, tz);
  if (t <= now) { const q = parts(now + DAY, tz); t = atLocal(q.y, q.mo, q.d, Math.floor(m / 60), m % 60, tz); }
  return t;
}
export function inWindow(now, from, to, tz) {
  const p = parts(now, tz); const cur = p.h * 60 + p.mi; const a = hm(from) ?? 540; const b = hm(to) ?? 1080;
  return a === b ? true : a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

// ---------- 规则 ----------
// to:推给谁;via:怎么推;when:什么时候推;style:null = 用默认样式
export const DEFAULT_WHEN = { mode: 'now', merge: 10, at: '10:00', from: '09:00', to: '18:00' };
const blankTo = () => ({ related: false, approver: false, dept: false, admins: false, page: false, roles: [], people: [], notActor: false });
// 还没保存过规则时,开 / 关照老开关
function oldToggle(key) {
  const [c, a] = key.split('.');
  if (c === 'price') return ['price', { live: 'start', switch: 'start', collection: 'start', restored: 'end', finished: 'end', control: 'decision', moved: 'decision', recovered: 'failure', failure: 'failure', gone: 'failure', hold: 'hold', submit: 'submit', decision: 'decision', unapproved: 'unapproved' }[a]];
  if (c === 'daily') return ['sched', a === 'tomorrow' ? 'dayBefore' : 'endingSoon'];
  if (c === 'content') return ['sched', a];
  if (c === 'pins' || c === 'joint') return null;
  if (a === 'live' || a === 'off') return ['sched', 'upDown'];
  if (a === 'failure') return ['sched', 'failure'];
  if (a === 'notlive') return ['sched', 'unapproved'];
  return null;
}
// 以前发到原来那个群的(网站内容的上下线 / 失败 / 每日提醒 / 审批)照旧发群
const oldGroup = (key) => (/\.(live|off|failure|notlive)$/.test(key) && !key.startsWith('price.') && !['pins.failure', 'joint.failure'].includes(key))
  || ['daily.tomorrow', 'daily.ending', 'content.submit', 'content.decision'].includes(key);
export function defaultRule(ev, { sched = {}, price = {}, groupIds = [] } = {}) {
  const to = blankTo();
  if (ev.level === 'info') Object.assign(to, { related: true, admins: true });
  else if (ev.level === 'problem') Object.assign(to, { related: true, dept: true, admins: true });
  else if (['content.submit', 'price.submit', 'price.unapproved'].includes(ev.key)) to.approver = true;
  else if (ev.key === 'content.due') Object.assign(to, { related: true, approver: true });
  else to.related = true;
  to.notActor = !!ev.self;
  const old = oldToggle(ev.key); const v = old && old[1] ? (old[0] === 'price' ? price : sched)[old[1]] : undefined;
  return { on: v === undefined ? true : !!v, to, via: { dm: true, groups: oldGroup(ev.key) ? [...groupIds] : [], at: false }, when: { ...DEFAULT_WHEN }, style: null };
}
// 存着的规则(v2,或上午 v1 的老格式)→ v2
function normRule(ev, r) {
  const t = r.to || {};
  const when = typeof r.when === 'string' ? { ...DEFAULT_WHEN, mode: r.when === 'digest' ? 'digest' : 'now' } : { ...DEFAULT_WHEN, ...(r.when || {}) };
  return {
    on: !!r.on,
    to: { ...blankTo(), related: !!t.related, approver: !!t.approver, dept: !!t.dept, admins: !!t.admins, page: !!t.page, roles: [...(t.roles || [])], people: [...(t.people || [])], notActor: t.notActor === undefined ? !!ev.self : !!t.notActor },
    via: { dm: r.via?.dm === undefined ? true : !!r.via.dm, groups: [...(r.via?.groups || t.groups || [])], at: !!r.via?.at },
    when, style: r.style ? cleanStyle(ev, r.style) : null,
  };
}
// 现在生效的设置(没保存过 = 按老开关推出来的默认值,不写盘)
export function centerOf(sched = {}, priceNotify = {}) {
  const saved = sched.notifyCenter || {};
  const st = sched.settings || {};
  const groups = saved.groups || (st.larkWebhook ? [{ id: 'main', name: '飞书群(原来设置的)', webhook: st.larkWebhook, secret: st.larkSecret || '' }] : []);
  const ctx = { sched: st.notify || {}, price: priceNotify || {}, groupIds: saved.groups ? [] : groups.map((g) => g.id) };
  const rules = {};
  for (const ev of EVENTS) {
    let r = saved.rules?.[ev.key];
    if (!r && saved.rules) { const k = Object.keys(OLD_KEY).find((o) => saved.rules[o] && OLD_KEY[o](ev.key)); if (k) r = saved.rules[k]; }
    rules[ev.key] = r ? normRule(ev, r) : defaultRule(ev, ctx);
  }
  return { saved: !!saved.rules, tz: TZS[saved.tz] ? saved.tz : 'Europe/London', groups, rules };
}
export const styleOf = (cfg, key) => cfg.rules[key]?.style || defaultStyle(EV[key]);

// 一条规则改成什么(管理员在消息中心改):只认识的字段、只认存在的群 / 成员 / 角色
export function cleanRule(ev, r = {}, { groups = [], members = [], roles = [] } = {}) {
  const t = r.to || {}; const v = r.via || {}; const w = typeof r.when === 'object' && r.when ? r.when : { mode: r.when };
  const g = new Set(groups.map((x) => x.id)); const m = new Set(members.map((x) => x.id)); const k = new Set(roles.map((x) => x.key));
  const modes = ev.level === 'info' ? ['now', 'merge', 'digest', 'work'] : ['now', 'merge', 'work']; // 出问题 / 审批的不能拖到明天
  const time = (x, d) => (hm(x) != null ? String(x).padStart(5, '0') : d);
  return {
    on: !!r.on,
    to: { related: !!t.related, approver: ev.level === 'approval' && !!t.approver, dept: !!t.dept, admins: !!t.admins, page: !!t.page,
      roles: [...new Set(t.roles || [])].filter((x) => k.has(x)), people: [...new Set(t.people || [])].filter((x) => m.has(x)), notActor: !!t.notActor },
    via: { dm: v.dm === undefined ? true : !!v.dm, groups: [...new Set(v.groups || t.groups || [])].filter((x) => g.has(x)), at: !!v.at },
    when: { mode: modes.includes(w.mode) ? w.mode : 'now', merge: Math.min(240, Math.max(1, Math.round(Number(w.merge) || 10))), at: time(w.at, '10:00'), from: time(w.from, '09:00'), to: time(w.to, '18:00') },
    style: r.style ? cleanStyle(ev, r.style) : null,
  };
}

// ---------- 推给谁 ----------
const CONTENT_PAGES = ['banners', 'topbar', 'pmodules', 'callouts', 'pins', 'salelinks', 'campaigns'];
const seesPage = (sched, m, page) => (page ? canSee(sched, m, page) : CONTENT_PAGES.some((p) => canSee(sched, m, p)));
// 同部门 = 和相关的人有同一个(管理员以外的)角色,并且能看这类通知的页面
function deptOf(sched, related, act, page) {
  const mine = new Set(act.filter((m) => related.includes(m.id)).flatMap((m) => m.roles || []).filter((k) => k !== 'admin'));
  if (!mine.size) return [];
  return act.filter((m) => (m.roles || []).some((k) => mine.has(k)) && seesPage(sched, m, page)).map((m) => m.id);
}
export function recipients(sched, cfg, msg) {
  const ev = EV[msg.ev]; const r = cfg.rules[msg.ev];
  if (!ev || !r?.on) return null;
  const act = (sched.members || []).filter((m) => m.status === 'active');
  const has = new Set(act.map((m) => m.id));
  const ids = new Set(); const add = (id) => { if (has.has(id)) ids.add(id); };
  const related = (msg.related || []).filter((id) => has.has(id));
  const page = msg.page || ev.page || null;
  if (r.to.related) related.forEach(add);
  if (r.to.approver) (msg.approvers || []).forEach(add);
  if (r.to.dept) deptOf(sched, related, act, page).forEach(add);
  if (r.to.admins) act.filter(isAdmin).forEach((m) => add(m.id));
  if (r.to.page) act.filter((m) => seesPage(sched, m, page)).forEach((m) => add(m.id));
  for (const k of r.to.roles) act.filter((m) => (m.roles || []).includes(k)).forEach((m) => add(m.id));
  r.to.people.forEach(add);
  if (r.to.notActor && msg.actor) ids.delete(msg.actor);
  if (ev.level === 'info') for (const m of act) if ((m.notifyMute || []).includes(ev.key)) ids.delete(m.id); // 个人关掉的(出问题的关不掉)
  const people = r.via.dm ? [...ids] : [];
  const groups = r.via.groups.map((gid) => cfg.groups.find((g) => g.id === gid)).filter(Boolean);
  // 出问题却谁都收不到(规则里的人都停用了 / 没相关的人 / 私信关了又没群):兜底私信管理员,别让问题没人知道
  if (!people.length && !groups.length && ev.level !== 'info') act.filter(isAdmin).forEach((m) => people.push(m.id));
  // 群里 @ 谁:这条通知相关的人(启用中的)
  const at = r.via.at && groups.length ? related : [];
  return { people, groups, at, rule: r };
}

// ---------- 发送记录 / 待发队列 / 去重(DATA_DIR/notify/)----------
const DIR = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'notify');
const safe = (shop) => shop.replace(/[^a-z0-9.-]/gi, '_');
const boxFile = (shop) => path.join(DIR(), `${safe(shop)}.box.json`);
const logFile = (shop) => path.join(DIR(), `${safe(shop)}.log.jsonl`);
export function loadBox(shop) {
  const blank = { queue: [], sent: {} };
  if (!shop) return { ...blank, seeded: true }; // 没有店铺(测试)= 不存
  let b; try { b = { ...blank, ...JSON.parse(fs.readFileSync(boxFile(shop), 'utf8')) }; } catch { return blank; }
  if (!Array.isArray(b.queue)) { // v1 的汇总队列({ 'p:id': [{ at, ev, line }] })→ 下一轮当汇总发掉
    b.queue = Object.entries(b.queue || {}).flatMap(([target, items]) => (items || []).map((x) => ({ target, ev: x.ev, at: x.at, due: 0, mode: 'digest', name: EV[x.ev]?.name || x.ev, line: x.line, url: '' })));
  }
  return b;
}
export function saveBox(shop, box) {
  if (!shop) return;
  fs.mkdirSync(DIR(), { recursive: true });
  const f = boxFile(shop); fs.writeFileSync(f + '.tmp', JSON.stringify(box)); fs.renameSync(f + '.tmp', f);
}
// 改价执行器、定时器、页面上的动作可能同时发通知:同一个店铺的队列一次只让一个改
const boxLocks = new Map();
function withBox(shop, fn) {
  const run = (boxLocks.get(shop) || Promise.resolve()).then(async () => { const box = loadBox(shop); try { return await fn(box); } finally { saveBox(shop, box); } });
  boxLocks.set(shop, run.catch(() => {}));
  return run;
}
const LOG_MAX = 3000;
export function appendNotifyLog(shop, row) {
  if (!shop) return;
  fs.mkdirSync(DIR(), { recursive: true });
  const f = logFile(shop);
  fs.appendFileSync(f, JSON.stringify(row) + '\n');
  try { // 太长就只留最近的
    const st = fs.statSync(f);
    if (st.size > 2_000_000) { const lines = fs.readFileSync(f, 'utf8').trim().split('\n'); fs.writeFileSync(f, lines.slice(-LOG_MAX).join('\n') + '\n'); }
  } catch { /* 不影响发送 */ }
}
export function readNotifyLog(shop, { limit = 100, before = Infinity, cat = '' } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(logFile(shop), 'utf8').trim().split('\n').filter(Boolean); } catch { return { rows: [], more: false }; }
  const rows = [];
  const catOf = (r) => (r.ev === 'digest' ? 'digest' : EV[r.ev]?.cat || (String(r.ev).startsWith('price.') ? 'price' : 'system'));
  for (let i = lines.length - 1; i >= 0 && rows.length <= limit; i--) {
    try { const r = JSON.parse(lines[i]); if (r.at < before && (!cat || catOf(r) === cat)) rows.push(r); } catch { /* 坏行跳过 */ }
  }
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

const nameOf = (sched, id) => (sched.members || []).find((m) => m.id === id)?.name || id;
const WHEN_CN = { now: '马上', merge: '合成一条', digest: '每天汇总', work: '工作时间' };

// 真的发出去:同一张卡片的人合在一起发一次;群可以 @ 人
async function sendOut(sched, cfg, targets, card, { sendDm, sendGroup, at = [] }) {
  const errs = []; let ok = 0;
  const people = targets.filter((t) => t.startsWith('p:')).map((t) => t.slice(2));
  if (people.length) {
    const failed = await sendDm(people, card).catch((e) => people.map((id) => ({ to: id, message: String(e.message || e) })));
    for (const f of failed || []) errs.push(`${nameOf(sched, f.to)}:${f.message}`);
    ok += people.length - (failed || []).length;
  }
  for (const t of targets.filter((x) => x.startsWith('g:'))) {
    const g = cfg.groups.find((x) => x.id === t.slice(2)); if (!g) continue;
    try { await sendGroup({ webhook: g.webhook, secret: g.secret }, at.length ? { ...card, at } : card); ok++; }
    catch (e) { errs.push(`群「${g.name}」:${e.message || e}`); }
  }
  return { ok, errs };
}
const who = (sched, cfg, targets) => ({
  people: targets.filter((t) => t.startsWith('p:')).map((t) => nameOf(sched, t.slice(2))),
  groups: targets.filter((t) => t.startsWith('g:')).map((t) => cfg.groups.find((g) => g.id === t.slice(2))?.name || t.slice(2)),
});

// 发通知(或放进待发队列),记发送记录。sched = 排期数据(成员 / 规则 / app 地址);priceNotify = 改价的老开关(还没保存过规则时用)
export async function dispatch(shop, msgs, { sched, priceNotify = {}, now = Date.now(), appUrl, sendDm = sendDMs, sendGroup = sendLark } = {}) {
  if (!msgs?.length) return { sent: 0, errors: [] };
  const cfg = centerOf(sched, priceNotify);
  const url = (p) => appLink(appUrl || sched.appUrl || '', p);
  return withBox(shop, async (box) => {
    // 第一次用通知中心:把原来群通知记下的去重 key 接过来(免得当天的汇总再发一遍)
    if (!box.seeded) { box.sent = { ...(sched.notified || {}), ...box.sent }; box.seeded = true; }
    const batch = new Map(); // 马上发的:同一种通知按收件人合起来(同一轮几条 = 一张列表卡片)
    for (const msg of msgs) {
      if (msg.key && box.sent[msg.key]) continue;
      const ev = EV[msg.ev]; const to = ev && recipients(sched, cfg, msg);
      if (!to || (!to.people.length && !to.groups.length)) continue;
      const style = to.rule.style || defaultStyle(ev);
      const data = msg.data || {};
      const entry = { ev: ev.key, at: now, name: ev.name, line: briefLine(ev, style, data), url: url(msg.path || '/'), related: to.at, key: msg.key || null,
        card: renderCard(ev, style, data, { url, path: msg.path || '/' }) };
      const targets = [...to.people.map((id) => `p:${id}`), ...to.groups.map((g) => `g:${g.id}`)];
      const w = to.rule.when;
      let mode = w.mode;
      if (mode === 'work' && inWindow(now, w.from, w.to, cfg.tz)) mode = 'now';
      if (mode === 'now') {
        if (!batch.has(ev.key)) batch.set(ev.key, new Map());
        for (const t of targets) { const b = batch.get(ev.key); if (!b.has(t)) b.set(t, []); b.get(t).push(entry); }
        continue;
      }
      // 合成一条:同一个收件人、同一种通知,从第一条起等 N 分钟;每天汇总:到设定的时间;工作时间:等到上班
      for (const t of targets) {
        const same = mode === 'merge' && box.queue.find((q) => q.mode === 'merge' && q.target === t && q.ev === ev.key);
        const due = same ? same.due : mode === 'merge' ? now + w.merge * 60_000 : mode === 'digest' ? nextAt(now, w.at, cfg.tz) : nextAt(now, w.from, cfg.tz);
        box.queue.push({ ...entry, target: t, mode, due });
      }
      if (msg.key) box.sent[msg.key] = now;
      appendNotifyLog(shop, { at: now, ev: ev.key, title: entry.card.title, ...who(sched, cfg, targets), mode, ok: true, queued: true });
    }
    let sent = 0; const errors = [];
    for (const [evKey, byTarget] of batch) {
      // 收到一模一样一组的人合起来发一次
      const sig = new Map();
      for (const [t, es] of byTarget) { const k = es.map((e) => e.line + e.url).join('|'); if (!sig.has(k)) sig.set(k, { es, targets: [] }); sig.get(k).targets.push(t); }
      for (const { es, targets } of sig.values()) {
        const card = es.length === 1 ? es[0].card : renderList(EV[evKey], styleOf(cfg, evKey), es, { url });
        const at = [...new Set(es.flatMap((e) => e.related || []))];
        const r = await sendOut(sched, cfg, targets, card, { sendDm, sendGroup, at });
        if (r.ok) { sent++; for (const e of es) if (e.key) box.sent[e.key] = now; }
        errors.push(...r.errs);
        appendNotifyLog(shop, { at: now, ev: evKey, title: card.title, ...who(sched, cfg, targets), mode: 'now', count: es.length, ok: !r.errs.length, errors: r.errs.slice(0, 5) });
      }
    }
    for (const [k, t] of Object.entries(box.sent)) if (now - t > 60 * DAY) delete box.sent[k];
    if (errors.length) console.error('[notify]', errors.slice(0, 3).join(' / '));
    return { sent, errors };
  });
}

// 把到时间的发出去(合成一条 / 每天汇总 / 等上班的)。定时器每分钟调一次
export async function flushQueue(shop, { sched, now = Date.now(), appUrl, sendDm = sendDMs, sendGroup = sendLark } = {}) {
  const cfg = centerOf(sched);
  const url = (p) => appLink(appUrl || sched.appUrl || '', p);
  return withBox(shop, async (box) => {
    const due = box.queue.filter((q) => q.due <= now);
    if (!due.length) return { sent: 0 };
    box.queue = box.queue.filter((q) => q.due > now);
    const groups = new Map(); // 汇总:每个收件人一张;其余:每个收件人每种通知一张
    for (const q of due) { const k = q.mode === 'digest' ? `d|${q.target}` : `${q.mode}|${q.target}|${q.ev}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q); }
    let sent = 0;
    for (const [k, es] of groups) {
      const target = es[0].target;
      const card = k.startsWith('d|') ? renderDigest(es, { url })
        : es.length === 1 && es[0].card ? es[0].card : renderList(EV[es[0].ev], styleOf(cfg, es[0].ev), es, { url });
      const at = target.startsWith('g:') ? [...new Set(es.flatMap((e) => e.related || []))] : [];
      const r = await sendOut(sched, cfg, [target], card, { sendDm, sendGroup, at });
      if (r.ok) sent++;
      appendNotifyLog(shop, { at: now, ev: k.startsWith('d|') ? 'digest' : es[0].ev, title: card.title, ...who(sched, cfg, [target]), mode: es[0].mode, count: es.length, ok: !r.errs.length, errors: r.errs.slice(0, 5) });
    }
    return { sent };
  });
}
export const flushDigest = flushQueue; // 老名字

// 「发给我试试」:用示例数据和(还没保存的)样式拼一张卡片,私信给自己或发到选的群
export async function testSend(sched, priceNotify, key, input, { me = null, groupId = '', appUrl, sendDm = sendDMs, sendGroup = sendLark } = {}) {
  const ev = EV[key]; if (!ev) throw new Error('没有这种通知');
  const cfg = centerOf(sched, priceNotify);
  const rule = cleanRule(ev, input, { groups: cfg.groups, members: sched.members || [], roles: rolesOf(sched) });
  const url = (p) => appLink(appUrl || sched.appUrl || '', p);
  const card = renderCard(ev, rule.style || defaultStyle(ev), ev.sample || {}, { url, path: CAT[ev.cat]?.path || '/' });
  card.title = `【试发】${card.title}`;
  if (groupId) {
    const g = cfg.groups.find((x) => x.id === groupId); if (!g) throw new Error('找不到这个群');
    await sendGroup({ webhook: g.webhook, secret: g.secret }, rule.via.at && me ? { ...card, at: [me] } : card);
    return { to: `群「${g.name}」` };
  }
  if (!me) throw new Error('你不是用飞书登录的,发不了私信;选一个飞书群试发');
  const failed = await sendDm([me], card);
  if (failed?.length) throw new Error(failed[0].message);
  return { to: '你的飞书' };
}

// ---------- 给页面看的 ----------
export function centerView(sched, priceNotify) {
  const cfg = centerOf(sched, priceNotify);
  return {
    saved: cfg.saved, tz: cfg.tz, tzs: TZS,
    cats: CATS.filter((c) => !c.approvals || approvalsOn()).map((c) => c.key),
    events: eventsOn().map((e) => e.key),
    rules: cfg.rules,
    groups: cfg.groups.map((g) => ({ id: g.id, name: g.name, tail: `…${String(g.webhook).slice(-6)}`, signed: !!g.secret })),
    roles: rolesOf(sched).map((r) => ({ key: r.key, name: r.name, pages: r.pages })),
    members: (sched.members || []).filter((m) => m.status === 'active').map((m) => ({ id: m.id, name: m.name, avatar: m.avatar || '', roles: m.roles || [], mute: m.notifyMute || [] })),
  };
}
// 保存:第一次保存时把现在生效的(含默认值)整套写下来
export function ensureSaved(sched, priceNotify) {
  if (sched.notifyCenter?.rules && !sched.notifyCenter.v2) { // 上午 v1 存的:换成 v2 整套
    const cfg = centerOf(sched, priceNotify);
    sched.notifyCenter = { ...sched.notifyCenter, v2: true, rules: JSON.parse(JSON.stringify(cfg.rules)) };
  }
  if (sched.notifyCenter?.rules) return sched.notifyCenter;
  const cfg = centerOf(sched, priceNotify);
  sched.notifyCenter = { v2: true, tz: cfg.tz, groups: cfg.groups.map((g) => ({ ...g })), rules: JSON.parse(JSON.stringify(cfg.rules)) };
  return sched.notifyCenter;
}
// 把一种通知的设置套用到别的通知上(选套哪几块);样式只套颜色 / 详细简洁 / 按钮 / 标题带名称,显示哪些信息只留对方有的,标题不套
export function copyRule(c, fromKey, targets = [], parts = []) {
  const src = c.rules[fromKey]; if (!src) throw new Error('没有这种通知');
  let n = 0;
  for (const k of targets) {
    const ev = EV[k]; const dst = c.rules[k]; if (!ev || !dst || k === fromKey) continue;
    if (parts.includes('on')) dst.on = src.on;
    if (parts.includes('to')) dst.to = { ...JSON.parse(JSON.stringify(src.to)), approver: ev.level === 'approval' && src.to.approver };
    if (parts.includes('via')) dst.via = JSON.parse(JSON.stringify(src.via));
    if (parts.includes('when')) dst.when = { ...src.when, mode: ev.level !== 'info' && src.when.mode === 'digest' ? 'now' : src.when.mode };
    if (parts.includes('style')) {
      const s = src.style || defaultStyle(EV[fromKey]); const d = dst.style || defaultStyle(ev);
      const fields = s.fields.filter((f) => ev.avail.includes(f));
      dst.style = cleanStyle(ev, { ...d, color: s.color, layout: s.layout, titleName: s.titleName, max: s.max, fields: fields.length ? fields : d.fields,
        buttons: Object.fromEntries(Object.keys(d.buttons).map((b) => [b, s.buttons[b] || d.buttons[b]])) });
    }
    n++;
  }
  return n;
}
export function addGroup(sched, priceNotify, { name, webhook, secret } = {}, now = Date.now()) {
  const c = ensureSaved(sched, priceNotify);
  const n = String(name || '').trim().slice(0, 30); const w = String(webhook || '').trim();
  if (!n) throw new Error('给这个群起个名字,比如「改价群」');
  if (!isLarkWebhook(w)) throw new Error('飞书 webhook 地址格式不对(群设置 → 群机器人 → 自定义机器人 → 复制 webhook)');
  if (c.groups.some((g) => g.webhook === w)) throw new Error('这个群已经加过了');
  const g = { id: `g${now.toString(36)}`, name: n, webhook: w, secret: String(secret || '').trim() };
  c.groups.push(g);
  return g;
}
export function removeGroup(sched, priceNotify, id) {
  const c = ensureSaved(sched, priceNotify);
  const g = c.groups.find((x) => x.id === id); if (!g) throw new Error('找不到这个群');
  c.groups = c.groups.filter((x) => x.id !== id);
  for (const r of Object.values(c.rules)) { if (r.via) r.via.groups = (r.via.groups || []).filter((x) => x !== id); if (r.to?.groups) r.to.groups = r.to.groups.filter((x) => x !== id); }
  return g;
}
export { WHEN_CN };
