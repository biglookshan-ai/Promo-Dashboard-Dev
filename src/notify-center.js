// 通知中心(2026-11-09 用户:要能规定哪些通知、发给谁、怎么发 —— 比如改价的只给改价相关的人,操作人收还是管理员收)。
//
// 各模块(src/notifier.js 网站内容、src/price/notifier.js 改价、scheduler 里的 Collection 排序 / 联合推广)只说「发生了什么、和谁有关」:
//   { ev: 事件 key, card, cards?: { 成员 id: 给他的专属卡片 }, related: [相关的人], approvers: [审批人], actor: 做这件事的人, page?, key?: 去重 }
// 这里按规则决定发给谁(私信 / 飞书群)、马上发还是合进每天 10:00 的汇总,并记发送记录。
//
// 用户定的(2026-11-09):管理员定规则,每个人能在「我的通知」关掉自己不想收的(出问题的关不掉);
//   日常通知默认 = 相关的人 + 管理员(管理员看全部);出问题默认 = 相关的人 + 同部门 + 管理员;改价可以选发群或发给不同的人。
// 规则存在排期数据的 notifyCenter(成员也在那);还没保存过时按老开关(设置 → 飞书通知、改价 → 设置 → 通知)和原来的群推出默认值。
// 发送记录 / 汇总队列 / 去重放 DATA_DIR/notify/(和排期数据分开放:schedule 目录里的文件会被 listShops 当成店铺)。
import fs from 'node:fs';
import path from 'node:path';
import { isAdmin, canSee, rolesOf, approvalsOn } from './members.js';
import { sendDMs } from './lark-bot.js';
import { sendLark, isLarkWebhook } from './lark.js';

const TZ = 'Europe/London';
const DAY = 86400000;
export const DIGEST_HOUR = 10;
const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
const londonHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));

export const MODS = { content: '网站内容', price: '改价', pins: 'Collection 排序', joint: '产品页推广', system: '系统' };
const CONTENT_PAGES = ['banners', 'topbar', 'pmodules', 'callouts', 'pins', 'salelinks', 'campaigns'];
// level:info = 日常(可以合进汇总、个人能关);problem = 出问题(个人关不掉,没人收时兜底给管理员);approval = 审批(只有开了审批才有)
// old:还没保存过规则时,开 / 关照老开关(['sched' | 'price', 老开关 key])
export const EVENTS = [
  { key: 'content.updown', mod: 'content', level: 'info', name: '自动上线 / 下线', desc: '定时器到点把 Banner、顶栏、活动等上线或下线', old: ['sched', 'upDown'], group: true },
  { key: 'content.tomorrow', mod: 'content', level: 'info', name: '明天要上线的', desc: '每天 10:00 列出明天要上线的内容', old: ['sched', 'dayBefore'], group: true, noDigest: true },
  { key: 'content.ending', mod: 'content', level: 'info', name: '3 天内要下架的', desc: '每天 10:00 列出快到期的,方便决定延长还是准备替换', old: ['sched', 'endingSoon'], group: true, noDigest: true },
  { key: 'content.notlive', mod: 'content', level: 'problem', name: '到点了但没上线', desc: '跟随的活动还是草稿,或者还没批准', old: ['sched', 'unapproved'], group: true },
  { key: 'content.failure', mod: 'content', level: 'problem', name: '定时上下线失败', desc: '写进店铺没成功;同一小时只报一次,下一分钟自动重试', old: ['sched', 'failure'], group: true },
  { key: 'content.submit', mod: 'content', level: 'approval', name: '有内容等审批', desc: '有人提交了新内容或修改', old: ['sched', 'submit'], group: true },
  { key: 'content.decision', mod: 'content', level: 'approval', name: '批准 / 退回', desc: '告诉提交的人结果', old: ['sched', 'decision'], group: true, skipActor: true },
  { key: 'content.due', mod: 'content', level: 'approval', name: '截止提醒', desc: '截止前一天还没提交;过了截止也告诉审批人', old: ['sched', 'due'] },
  { key: 'price.live', mod: 'price', level: 'info', name: '改价已生效', desc: '到点换成活动价 / 换到另一个时段的价 / 永久调价', old: ['price', 'start'], page: 'price' },
  { key: 'price.restored', mod: 'price', level: 'info', name: '改价已恢复', desc: '回到改价前的价格;永久调价全部完成', old: ['price', 'end'], page: 'price' },
  { key: 'price.collection', mod: 'price', level: 'info', name: 'Collection 加入 / 移出产品', desc: '改价时段把产品加进 / 移出 Collection', old: ['price', 'start'], page: 'price' },
  { key: 'price.control', mod: 'price', level: 'info', name: '暂停 / 继续 / 提前结束', desc: '有人在改价页点了这些按钮(不发给点的人自己)', old: ['price', 'decision'], page: 'price', skipActor: true },
  { key: 'price.moved', mod: 'price', level: 'info', name: '计划时间跟着活动改了', desc: '跟随活动的改价计划,活动改时间后跟着改', old: ['price', 'decision'], page: 'price' },
  { key: 'price.recovered', mod: 'price', level: 'info', name: '中途中断,已核对补记', desc: '服务器重启等原因中断,恢复后核对过价格', old: ['price', 'failure'], page: 'price' },
  { key: 'price.hold', mod: 'price', level: 'problem', name: '有产品暂停接管', desc: '有人手动改了价,app 不再动这些产品,要在「受管产品」里选怎么处理', old: ['price', 'hold'], page: 'price' },
  { key: 'price.failure', mod: 'price', level: 'problem', name: '改价失败', desc: '同一个错误一小时只报一次,下一分钟自动重试', old: ['price', 'failure'], page: 'price' },
  { key: 'price.gone', mod: 'price', level: 'problem', name: 'Collection 被删除了', desc: '计划设了加进这个 Collection,但它在店里不存在了', old: ['price', 'failure'], page: 'price' },
  { key: 'price.submit', mod: 'price', level: 'approval', name: '改价计划等审批', desc: '有人提交了改价计划或修改', old: ['price', 'submit'], page: 'price' },
  { key: 'price.decision', mod: 'price', level: 'approval', name: '改价计划批准 / 退回', desc: '告诉计划相关的人结果', old: ['price', 'decision'], page: 'price', skipActor: true },
  { key: 'price.unapproved', mod: 'price', level: 'approval', name: '改价快开始了还没批准', desc: '开始前 2 小时提醒审批人', old: ['price', 'unapproved'], page: 'price' },
  { key: 'pins.hold', mod: 'pins', level: 'problem', name: '有人在后台手动改了 Collection 顺序', desc: 'app 已暂停接管,不覆盖别人的改动,要在 Collection 排序里选怎么处理', page: 'pins' },
  { key: 'pins.failure', mod: 'pins', level: 'problem', name: 'Collection 排序失败', desc: '同一个 Collection 同一个原因一天只报一次', page: 'pins' },
  { key: 'joint.failure', mod: 'joint', level: 'problem', name: '联合推广同步 Collection 失败', desc: '兼容产品 / 推广产品没能同步进 Collection;同一条一天只报一次', page: 'callouts' },
];
export const EV = Object.fromEntries(EVENTS.map((e) => [e.key, e]));
export const eventsOn = () => EVENTS.filter((e) => e.level !== 'approval' || approvalsOn());

// ---------- 规则 ----------
const blankTo = () => ({ related: false, approver: false, dept: false, admins: false, page: false, roles: [], people: [], groups: [] });
export function defaultRule(ev, { sched = {}, price = {}, groupIds = [] } = {}) {
  const to = blankTo();
  if (ev.level === 'info') Object.assign(to, { related: true, admins: true });
  else if (ev.level === 'problem') Object.assign(to, { related: true, dept: true, admins: true });
  else if (['content.submit', 'price.submit', 'price.unapproved'].includes(ev.key)) to.approver = true;
  else if (ev.key === 'content.due') Object.assign(to, { related: true, approver: true });
  else to.related = true;
  if (ev.group) to.groups = [...groupIds]; // 原来发群的(网站内容)照旧发到原来的群
  const old = ev.old ? (ev.old[0] === 'price' ? price : sched)[ev.old[1]] : undefined;
  return { on: old === undefined ? true : !!old, to, when: 'now' };
}
// 现在生效的设置(没保存过 = 按老开关推出来的默认值,不写盘)
export function centerOf(sched = {}, priceNotify = {}) {
  const saved = sched.notifyCenter || {};
  const st = sched.settings || {};
  const groups = saved.groups || (st.larkWebhook ? [{ id: 'main', name: '飞书群(原来设置的)', webhook: st.larkWebhook, secret: st.larkSecret || '' }] : []);
  const ctx = { sched: st.notify || {}, price: priceNotify || {}, groupIds: saved.groups ? [] : groups.map((g) => g.id) };
  const rules = {};
  for (const ev of EVENTS) {
    const r = saved.rules?.[ev.key];
    rules[ev.key] = r ? { on: !!r.on, to: { ...blankTo(), ...r.to }, when: r.when === 'digest' && !ev.noDigest && ev.level === 'info' ? 'digest' : 'now' } : defaultRule(ev, ctx);
  }
  return { saved: !!saved.rules, groups, rules };
}

// 一条规则改成什么(管理员在通知中心改);只认识的字段、只认存在的群 / 成员 / 角色
export function cleanRule(ev, r = {}, { groups = [], members = [], roles = [] } = {}) {
  const t = r.to || {};
  const g = new Set(groups.map((x) => x.id)); const m = new Set(members.map((x) => x.id)); const k = new Set(roles.map((x) => x.key));
  return {
    on: !!r.on,
    to: { related: !!t.related, approver: ev.level === 'approval' && !!t.approver, dept: !!t.dept, admins: !!t.admins, page: !!t.page,
      roles: [...new Set(t.roles || [])].filter((x) => k.has(x)), people: [...new Set(t.people || [])].filter((x) => m.has(x)), groups: [...new Set(t.groups || [])].filter((x) => g.has(x)) },
    when: r.when === 'digest' && !ev.noDigest && ev.level === 'info' ? 'digest' : 'now',
  };
}

// ---------- 发给谁 ----------
const pageOf = (ev, msg) => msg.page || ev.page || null;
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
  const page = pageOf(ev, msg);
  if (r.to.related) related.forEach(add);
  if (r.to.approver) (msg.approvers || []).forEach(add);
  if (r.to.dept) deptOf(sched, related, act, page).forEach(add);
  if (r.to.admins) act.filter(isAdmin).forEach((m) => add(m.id));
  if (r.to.page) act.filter((m) => seesPage(sched, m, page)).forEach((m) => add(m.id));
  for (const k of r.to.roles) act.filter((m) => (m.roles || []).includes(k)).forEach((m) => add(m.id));
  r.to.people.forEach(add);
  if (ev.skipActor && msg.actor) ids.delete(msg.actor);
  if (ev.level === 'info') for (const m of act) if ((m.notifyMute || []).includes(ev.key)) ids.delete(m.id); // 个人关掉的(出问题的关不掉)
  const groups = r.to.groups.map((gid) => cfg.groups.find((g) => g.id === gid)).filter(Boolean);
  // 出问题却谁都收不到(规则里的人都停用了 / 没相关的人):兜底给管理员,别让问题没人知道
  if (!ids.size && !groups.length && ev.level !== 'info') act.filter(isAdmin).forEach((m) => add(m.id));
  return { people: [...ids], groups, when: r.when };
}

// ---------- 发送记录 / 汇总队列 / 去重(DATA_DIR/notify/)----------
const DIR = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'notify');
const safe = (shop) => shop.replace(/[^a-z0-9.-]/gi, '_');
const boxFile = (shop) => path.join(DIR(), `${safe(shop)}.box.json`);
const logFile = (shop) => path.join(DIR(), `${safe(shop)}.log.jsonl`);
export function loadBox(shop) {
  if (!shop) return { queue: {}, sent: {}, lastDigest: '', seeded: true }; // 没有店铺(测试)= 不存
  try { return { queue: {}, sent: {}, lastDigest: '', ...JSON.parse(fs.readFileSync(boxFile(shop), 'utf8')) }; } catch { return { queue: {}, sent: {}, lastDigest: '' }; }
}
export function saveBox(shop, box) {
  if (!shop) return;
  fs.mkdirSync(DIR(), { recursive: true });
  const f = boxFile(shop); fs.writeFileSync(f + '.tmp', JSON.stringify(box)); fs.renameSync(f + '.tmp', f);
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
export function readNotifyLog(shop, { limit = 100, before = Infinity, mod = '' } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(logFile(shop), 'utf8').trim().split('\n').filter(Boolean); } catch { return { rows: [], more: false }; }
  const rows = [];
  for (let i = lines.length - 1; i >= 0 && rows.length <= limit; i--) {
    try { const r = JSON.parse(lines[i]); if (r.at < before && (!mod || EV[r.ev]?.mod === mod || (mod === 'system' && r.ev === 'digest'))) rows.push(r); } catch { /* 坏行跳过 */ }
  }
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

const nameOf = (sched, id) => (sched.members || []).find((m) => m.id === id)?.name || id;
const lineOf = (card) => `${card.title}${card.lines?.find(Boolean) ? ` · ${String(card.lines.find(Boolean)).replace(/\*\*/g, '').slice(0, 80)}` : ''}`;

// 发出去(或放进汇总),记发送记录。sched = 排期数据(成员 / 规则);priceNotify = 改价的老开关(还没保存过规则时用)
export async function dispatch(shop, msgs, { sched, priceNotify = {}, now = Date.now(), sendDm = sendDMs, sendGroup = sendLark } = {}) {
  if (!msgs?.length) return { sent: 0, errors: [] };
  const cfg = centerOf(sched, priceNotify);
  const box = loadBox(shop);
  // 第一次用通知中心:把原来群通知记下的去重 key 接过来(免得当天的汇总再发一遍)
  if (!box.seeded) { box.sent = { ...(sched.notified || {}), ...box.sent }; box.seeded = true; }
  let sent = 0; const errors = [];
  for (const msg of msgs) {
    if (msg.key && box.sent[msg.key]) continue;
    const to = recipients(sched, cfg, msg);
    if (!to) continue;
    if (!to.people.length && !to.groups.length) continue;
    if (to.when === 'digest') { // 合进每天 10:00 的汇总
      for (const id of to.people) (box.queue[`p:${id}`] ||= []).push({ at: now, ev: msg.ev, line: lineOf(msg.cards?.[id] || msg.card) });
      for (const g of to.groups) (box.queue[`g:${g.id}`] ||= []).push({ at: now, ev: msg.ev, line: lineOf(msg.card) });
      if (msg.key) box.sent[msg.key] = now;
      appendNotifyLog(shop, { at: now, ev: msg.ev, title: msg.card.title, people: to.people.map((id) => nameOf(sched, id)), groups: to.groups.map((g) => g.name), mode: 'digest', ok: true });
      continue;
    }
    const errs = [];
    // 每个人的卡片可以不一样(比如上下线只列他相关的),一样的合成一次发
    const byCard = new Map();
    for (const id of to.people) { const c = msg.cards?.[id] || msg.card; if (!byCard.has(c)) byCard.set(c, []); byCard.get(c).push(id); }
    for (const [card, ids] of byCard) {
      const failed = await sendDm(ids, card).catch((e) => ids.map((id) => ({ to: id, message: String(e.message || e) })));
      for (const f of failed || []) errs.push(`${nameOf(sched, f.to)}:${f.message}`);
    }
    for (const g of to.groups) {
      try { await sendGroup({ webhook: g.webhook, secret: g.secret }, msg.groupCard || msg.card); }
      catch (e) { errs.push(`群「${g.name}」:${e.message || e}`); }
    }
    if (errs.length < to.people.length + to.groups.length) { sent++; if (msg.key) box.sent[msg.key] = now; }
    errors.push(...errs);
    appendNotifyLog(shop, { at: now, ev: msg.ev, title: msg.card.title, people: to.people.map((id) => nameOf(sched, id)), groups: to.groups.map((g) => g.name), mode: 'now', ok: !errs.length, errors: errs.slice(0, 5) });
  }
  for (const [k, t] of Object.entries(box.sent)) if (now - t > 60 * DAY) delete box.sent[k];
  saveBox(shop, box);
  if (errors.length) console.error('[notify]', errors.slice(0, 3).join(' / '));
  return { sent, errors };
}

// 每天 10:00:把攒着的「合进汇总」发出去(每人 / 每个群一张卡片)。定时器每分钟调一次
export async function flushDigest(shop, { sched, now = Date.now(), appUrl = '', sendDm = sendDMs, sendGroup = sendLark } = {}) {
  if (londonHour(now) < DIGEST_HOUR) return { sent: 0 };
  const box = loadBox(shop);
  const today = londonDate(now);
  if (box.lastDigest === today) return { sent: 0 };
  const cfg = centerOf(sched);
  let sent = 0;
  for (const [target, items] of Object.entries(box.queue)) {
    if (!items.length) continue;
    const lines = [...items.slice(0, 40).map((x) => `· ${x.line}`), items.length > 40 ? `……共 ${items.length} 条` : ''];
    const card = { title: `📬 通知汇总 · ${items.length} 条`, color: 'blue', lines, button: appUrl ? { text: '打开网站更新中心', url: appUrl } : undefined };
    try {
      if (target.startsWith('p:')) { const f = await sendDm([target.slice(2)], card); if (f?.length) throw new Error(f[0].message); }
      else { const g = cfg.groups.find((x) => x.id === target.slice(2)); if (g) await sendGroup({ webhook: g.webhook, secret: g.secret }, card); }
      sent++;
      appendNotifyLog(shop, { at: now, ev: 'digest', title: card.title, people: target.startsWith('p:') ? [nameOf(sched, target.slice(2))] : [], groups: target.startsWith('g:') ? [cfg.groups.find((x) => x.id === target.slice(2))?.name || target.slice(2)] : [], mode: 'now', ok: true });
      delete box.queue[target];
    } catch (e) {
      appendNotifyLog(shop, { at: now, ev: 'digest', title: card.title, people: [], groups: [], mode: 'now', ok: false, errors: [String(e.message || e)] });
      delete box.queue[target]; // 发不出去也别一直攒着
    }
  }
  box.lastDigest = today;
  saveBox(shop, box);
  return { sent };
}

// 给页面看的:规则 + 事件目录 + 群(webhook 只给结尾几位)+ 成员 / 角色(选人用)
export function centerView(sched, priceNotify) {
  const cfg = centerOf(sched, priceNotify);
  return {
    saved: cfg.saved,
    mods: MODS,
    events: eventsOn().map(({ old, group, ...e }) => e),
    rules: cfg.rules,
    groups: cfg.groups.map((g) => ({ id: g.id, name: g.name, tail: `…${String(g.webhook).slice(-6)}`, signed: !!g.secret })),
    roles: rolesOf(sched).map((r) => ({ key: r.key, name: r.name, pages: r.pages })),
    members: (sched.members || []).filter((m) => m.status === 'active').map((m) => ({ id: m.id, name: m.name, avatar: m.avatar || '', roles: m.roles || [], mute: m.notifyMute || [] })),
  };
}
// 保存:第一次保存时把现在生效的(含默认值)整套写下来
export function ensureSaved(sched, priceNotify) {
  if (sched.notifyCenter?.rules) return sched.notifyCenter;
  const cfg = centerOf(sched, priceNotify);
  sched.notifyCenter = { groups: cfg.groups.map((g) => ({ ...g })), rules: JSON.parse(JSON.stringify(cfg.rules)) };
  return sched.notifyCenter;
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
  for (const r of Object.values(c.rules)) r.to.groups = (r.to.groups || []).filter((x) => x !== id);
  return g;
}
