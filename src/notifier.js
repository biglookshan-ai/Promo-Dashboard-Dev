// 什么时候发飞书、发什么。所有提醒都受「设置 → 飞书通知」里的开关控制,没填 webhook 就不发。
//   即时:有人提交审核 / 批准或退回 / 定时器上下线 / 到点还没批准 / 定时切换失败
//   每天英国时间 10:00 一次汇总:明天要上线的 + 3 天内要下架的
// 去重:state.notified 记下已发过的 key,同一件事同一天只提醒一次。
import { sendLark } from './lark.js';
import { itemStatus, effectiveWindow, campaignIndex, ENDING_SOON_MS } from './schedule-core.js';
import { titleOf, KIND_CN, findItem, effApprover } from './schedule-actions.js';
import { sendDMs } from './lark-bot.js';

const TZ = 'Europe/London';
const DAY = 86400000;
export const DIGEST_HOUR = 10;
const fmt = (ms, o) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, ...o }).format(new Date(ms));
const fDT = (ms) => fmt(ms, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms)); // YYYY-MM-DD
export const londonHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const who = (state, id) => (state.members || []).find((u) => u.id === id)?.name || state.staff.find((u) => u.id === id)?.name || '同事';
// 飞书模式:审核人 = 启用中的管理员;否则用旧的 Shopify 员工名单
const approvers = (state) => ((state.members || []).some((m) => m.status === 'active')
  ? state.members.filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.name)
  : state.staff.filter((u) => u.role === 'approver').map((u) => u.name)).join('、') || '审核人';
const line = (it) => `**${KIND_CN[it.kind]}** · ${titleOf(it)}`;
// 这条内容由谁审批(指定的 / 默认的;都没有就是管理员们)
const apprName = (state, it) => { const a = effApprover(state, it); return a ? who(state, a) : approvers(state); };

// 要发的消息(纯函数,返回 [{ key?, card }]);真正发送在 deliver()
export function eventMessages(state, effect, { appUrl, now = Date.now() } = {}) {
  const n = state.settings.notify; const btn = { text: '打开网站更新中心', url: appUrl };
  if (effect.event === 'submit' && n.submit) {
    if (effect.order) return [{ card: { title: '📝 有新的轮播顺序等审核', color: 'orange', lines: [`${who(state, effect.order.by)} 调整了${effect.order.kind === 'banner' ? '首页 Banner' : '顶栏'}的顺序`, `请 ${approvers(state)} 审核`], button: btn } }];
    const it = findItem(state, effect.id); if (!it) return [];
    const w = effectiveWindow(it, campaignIndex(state.campaigns));
    return [{ card: { title: effect.change ? '📝 有修改等审核' : '📝 有新内容等审核', color: 'orange', button: btn,
      lines: [line(it), `提交人:${who(state, effect.change ? it.pendingChange?.by : it.by)}`,
        w.start ? `计划上线:${fDT(w.start)}` : '', `请 ${apprName(state, it)} 审核${effect.change ? '(批准前线上保持原版本)' : ''}`] } }];
  }
  if (effect.event === 'decision' && n.decision) {
    if (effect.order) return [{ card: { title: effect.approved ? '✅ 新顺序已批准' : '↩️ 新顺序被退回', color: effect.approved ? 'green' : 'red', button: btn,
      lines: [`${who(state, effect.order.by)} 提交的${effect.order.kind === 'banner' ? '首页 Banner' : '顶栏'}顺序`, effect.note ? `意见:${effect.note}` : ''] } }];
    const it = findItem(state, effect.id); if (!it) return [];
    const s = itemStatus(it, campaignIndex(state.campaigns), now); const w = effectiveWindow(it, campaignIndex(state.campaigns));
    return [{ card: { title: effect.approved ? '✅ 已批准' : '↩️ 被退回', color: effect.approved ? 'green' : 'red', button: btn,
      lines: [line(it), `提交人:${who(state, effect.to)}`,
        effect.approved ? (s === 'scheduled' ? `将在 ${fDT(w.start)} 自动上线` : s === 'live' ? '已上线' : '') : `意见:${effect.note || '(没写原因)'}`] } }];
  }
  return [];
}

// 定时器一轮之后:上下线 / 失败 / 到点还没批准
export function schedulerMessages(state, { changes = [], failures = [] }, { appUrl, now = Date.now() } = {}) {
  const n = state.settings.notify; const out = []; const btn = { text: '打开网站更新中心', url: appUrl };
  if (n.upDown && changes.length) {
    out.push({ card: { title: `🔄 自动上下线 ${changes.length} 条`, color: 'blue', button: btn,
      lines: changes.map((c) => `${c.to === 'ACTIVE' ? '⬆️ 上线' : '⬇️ 下线'} · **${KIND_CN[c.kind]}** · ${c.title}`) } });
  }
  if (n.failure && failures.length) {
    const key = `failure:${londonDate(now)}:${londonHour(now)}`; // 同一小时只报一次
    out.push({ key, card: { title: '⚠️ 定时切换失败', color: 'red', button: btn,
      lines: [...failures.slice(0, 8).map((f) => `${f.title ? `**${f.title}**:` : ''}${f.message}`), `请 ${approvers(state)} 看一下;下一分钟会自动重试`] } });
  }
  if (n.unapproved) {
    const camps = campaignIndex(state.campaigns);
    for (const it of [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles]) {
      const s = itemStatus(it, camps, now); const w = effectiveWindow(it, camps);
      if (!['pending', 'waiting'].includes(s) || w.start == null || w.start > now) continue;
      out.push({ key: `unapproved:${it.id}:${w.start}`, card: { title: '⏰ 到点了,但还没批准', color: 'red', button: btn,
        lines: [line(it), `原定 ${fDT(w.start)} 上线,${s === 'waiting' ? '它跟随的活动' : '它'}还没批准,所以前台没显示`, `请 ${apprName(state, s === 'waiting' ? state.campaigns.find((c) => c.id === it.campaign) || it : it)} 审核`] } });
    }
  }
  return out;
}

// 每天 10:00 的汇总
export function digestMessages(state, { appUrl, now = Date.now() } = {}) {
  const n = state.settings.notify; const out = [];
  if (londonHour(now) < DIGEST_HOUR) return out;
  const today = londonDate(now);
  const camps = campaignIndex(state.campaigns);
  const items = [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles].filter((x) => !x.isDefault);
  const btn = { text: '打开网站更新中心', url: appUrl };
  if (n.dayBefore) {
    const tomorrow = londonDate(now + DAY);
    const list = items.filter((x) => { const w = effectiveWindow(x, camps); return w.start != null && londonDate(w.start) === tomorrow && ['scheduled', 'pending', 'waiting'].includes(itemStatus(x, camps, now)); });
    if (list.length) out.push({ key: `dayBefore:${today}`, card: { title: `📅 明天要上线 ${list.length} 条`, color: 'blue', button: btn,
      lines: list.map((x) => { const s = itemStatus(x, camps, now); return `${fmt(effectiveWindow(x, camps).start, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · ${line(x)}${s !== 'scheduled' ? ' · ⚠️ **还没批准,到点不会上线**' : ''}`; }) } });
  }
  if (n.endingSoon) {
    const list = items.filter((x) => { const w = effectiveWindow(x, camps); return itemStatus(x, camps, now) === 'live' && w.end != null && w.end - now <= ENDING_SOON_MS; });
    if (list.length) out.push({ key: `endingSoon:${today}`, card: { title: `⏳ ${list.length} 条内容 3 天内下架`, color: 'orange', button: btn,
      lines: [...list.map((x) => `${fDT(effectiveWindow(x, camps).end)} 下架 · ${line(x)}`), '要继续显示就改结束时间;要替换就提前做好新的'] } });
  }
  return out;
}

// 发送:跳过已发过的 key,发成功的 key 记进 state.notified(调用方负责保存)
export async function deliver(state, messages, { send = sendLark, now = Date.now() } = {}) {
  const { larkWebhook: webhook, larkSecret: secret } = state.settings;
  if (!webhook || !messages.length) return { sent: 0, errors: [] };
  let sent = 0; const errors = [];
  for (const m of messages) {
    if (m.key && state.notified[m.key]) continue;
    try { await send({ webhook, secret }, m.card); sent++; if (m.key) state.notified[m.key] = now; }
    catch (e) { errors.push(String(e.message || e)); }
  }
  // 只留 60 天内的去重记录
  for (const [k, t] of Object.entries(state.notified)) if (now - t > 60 * DAY) delete state.notified[k];
  return { sent, errors };
}

// ================= v3:飞书私信给具体的人 =================
// 群里照旧发汇总;下面这些只发给相关的人(要开了飞书应用,见 lark-bot.js):
//   提交审核 → 审批人;批准 / 退回 → 提交人 + 负责人 + 抄送;上下线 → 负责人 + 抄送;
//   到点还没批准 → 审批人;截止前一天 / 过了截止还没提交 → 负责人
const HOUR = 3600000;
const activeIds = (state) => new Set((state.members || []).filter((m) => m.status === 'active').map((m) => m.id));
const adminIds = (state) => (state.members || []).filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.id);
// 这条内容的审批人(没指定、没默认 → 管理员们)
export function approversOf(state, it) {
  const a = effApprover(state, it);
  return a && activeIds(state).has(a) ? [a] : adminIds(state);
}
// 负责人 + 抄送(+ 额外的人),只要启用中的成员,去掉做这件事的人自己
export function peopleOf(state, it, extra = [], skip = null) {
  const act = activeIds(state);
  return [...new Set([it.owner, ...(it.cc || []), ...extra].filter((id) => id && act.has(id) && id !== skip))];
}
const orderApprovers = (state, kind) => { const a = state.settings?.approvers?.[kind]; return a && activeIds(state).has(a) ? [a] : adminIds(state); };

export function dmMessages(state, effect, { appUrl, now = Date.now() } = {}) {
  const n = state.settings.notify; const btn = { text: '打开网站更新中心', url: appUrl };
  const skip = effect.actor || null;
  const not = (ids) => ids.filter((id) => id !== skip);
  if (effect.event === 'submit' && n.submit) {
    if (effect.order) return [{ to: not(orderApprovers(state, effect.order.kind)), card: { title: '📝 有新的轮播顺序等你审批', color: 'orange', button: { ...btn, text: '去审批' },
      lines: [`${who(state, effect.order.by)} 调整了${effect.order.kind === 'banner' ? '首页 Banner' : '顶栏'}的顺序`, '批准前前台保持原顺序'] } }];
    const it = findItem(state, effect.id); if (!it) return [];
    const w = effectiveWindow(it, campaignIndex(state.campaigns));
    return [{ to: not(approversOf(state, it)), card: { title: effect.change ? '📝 有修改等你审批' : '📝 有内容等你审批', color: 'orange', button: { ...btn, text: '去审批' },
      lines: [line(it), `提交人:${who(state, effect.change ? it.pendingChange?.by : it.by)}`,
        w.start ? `计划上线:${fDT(w.start)}` : '', effect.change ? '批准前线上保持原版本' : '不批准不会上线'] } }];
  }
  if (effect.event === 'decision' && n.decision) {
    if (effect.order) return [{ to: not([effect.order.by]), card: { title: effect.approved ? '✅ 你提交的顺序已批准' : '↩️ 你提交的顺序被退回', color: effect.approved ? 'green' : 'red', button: btn,
      lines: [`${effect.order.kind === 'banner' ? '首页 Banner' : '顶栏'}的轮播顺序`, effect.note ? `意见:${effect.note}` : ''] } }];
    const it = findItem(state, effect.id); if (!it) return [];
    const camps = campaignIndex(state.campaigns);
    const s = itemStatus(it, camps, now); const w = effectiveWindow(it, camps);
    return [{ to: peopleOf(state, it, [effect.to], skip), card: { title: effect.approved ? (effect.edited ? '✅ 已批准(审批人改过再保存)' : '✅ 已批准') : '↩️ 被退回', color: effect.approved ? 'green' : 'red', button: btn,
      lines: [line(it), `审批人:${who(state, effect.actor)} · 提交人:${who(state, effect.to)}`,
        effect.approved ? (s === 'scheduled' ? `将在 ${fDT(w.start)} 自动上线` : s === 'live' ? '已上线' : '') : `意见:${effect.note || '(没写原因)'}`] } }];
  }
  return [];
}

// 定时器一轮之后的私信:上下线 / 到点还没批准 / 截止提醒(带 key 的去重,同一件事只发一次)
export function schedulerDMs(state, { changes = [] }, { appUrl, now = Date.now() } = {}) {
  const n = state.settings.notify; const out = []; const btn = { text: '打开网站更新中心', url: appUrl };
  if (n.upDown && changes.length) {
    const per = new Map(); // 每个人一张卡片,列出他相关的
    for (const c of changes) {
      const it = findItem(state, c.id); if (!it) continue;
      for (const id of peopleOf(state, it, it.owner ? [] : [it.by])) {
        if (!per.has(id)) per.set(id, []);
        per.get(id).push(`${c.to === 'ACTIVE' ? '⬆️ 上线' : '⬇️ 下线'} · **${KIND_CN[c.kind]}** · ${c.title}`);
      }
    }
    for (const [id, lines] of per) out.push({ to: [id], card: { title: `🔄 你负责 / 关注的内容自动${lines.every((l) => l.startsWith('⬆️')) ? '上线' : lines.every((l) => l.startsWith('⬇️')) ? '下线' : '上下线'}了`, color: 'blue', button: btn, lines } });
  }
  const camps = campaignIndex(state.campaigns);
  const items = [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles, ...(state.pmodules || []), ...(state.pins || []), ...(state.salelinks || []), ...(state.callouts || [])];
  if (n.unapproved) {
    for (const it of items) {
      const s = itemStatus(it, camps, now); const w = effectiveWindow(it, camps);
      if (s !== 'pending' || w.start == null || w.start > now + 2 * HOUR || w.start < now - DAY) continue;
      out.push({ key: `dm-unapproved:${it.id}:${w.start}`, to: approversOf(state, it), card: { title: w.start > now ? '⏰ 快到上线时间了,还没批准' : '⏰ 到点了,但还没批准', color: 'red', button: { ...btn, text: '去审批' },
        lines: [line(it), `原定 ${fDT(w.start)} 上线,不批准就不会显示`] } });
    }
  }
  if (n.due) {
    for (const it of items) {
      if (it.due == null || !['new', 'draft', 'rejected'].includes(it.state)) continue;
      const to = peopleOf(state, { owner: it.owner || it.by }, []); if (!to.length) continue;
      if (it.due > now && it.due - now <= DAY) out.push({ key: `due-soon:${it.id}:${it.due}`, to, card: { title: '⏳ 明天截止,还没提交', color: 'orange', button: btn,
        lines: [line(it), `截止:${fDT(it.due)}`, it.state === 'rejected' ? '上次被退回了,改好后重新提交' : '做好后点「提交审核」'] } });
      if (it.due <= now && now - it.due <= 7 * DAY) out.push({ key: `due-over:${it.id}:${it.due}`, to: [...new Set([...to, ...approversOf(state, it)])], card: { title: '⚠️ 已过截止时间,还没提交', color: 'red', button: btn,
        lines: [line(it), `截止:${fDT(it.due)}`, `负责人:${who(state, it.owner || it.by)}`] } });
    }
  }
  return out;
}

// 发私信:跳过已发过的 key;没开飞书应用时 send 什么都不做
export async function deliverDMs(state, messages, { send = sendDMs, now = Date.now() } = {}) {
  const errors = [];
  for (const m of messages) {
    if (!m.to?.length || (m.key && state.notified[m.key])) continue;
    const failed = await send(m.to, m.card).catch((e) => [{ message: String(e.message || e) }]);
    if (failed.length) errors.push(...failed.map((f) => f.message));
    else if (m.key) state.notified[m.key] = now;
  }
  if (errors.length) console.error('[lark-dm]', errors.slice(0, 3).join(' / '));
  return { errors };
}
