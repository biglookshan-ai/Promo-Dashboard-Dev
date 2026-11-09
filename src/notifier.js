// 网站内容(排期)要发的通知:只说「发生了什么、和谁有关」,发给谁 / 发群还是私信 / 马上还是汇总,由通知中心(src/notify-center.js)按规则定。
// 每条消息:{ ev, key?, card, cards?: { 成员 id: 他的专属卡片 }, related: [相关的人], approvers: [审批人], actor?, page? }
//   即时:提交审核 / 批准或退回(只有开了审批才有)
//   定时器每一轮:自动上下线、定时切换失败、到点没上线、截止提醒
//   每天英国时间 10:00:明天要上线的 + 3 天内要下架的
import { itemStatus, effectiveWindow, campaignIndex, ENDING_SOON_MS } from './schedule-core.js';
import { titleOf, KIND_CN, findItem, effApprover } from './schedule-actions.js';
import { approvalsOn } from './members.js';
import { appLink, itemPath, oneOr } from './app-links.js';

const TZ = 'Europe/London';
const DAY = 86400000;
const HOUR = 3600000;
export const DIGEST_HOUR = 10;
const fmt = (ms, o) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, ...o }).format(new Date(ms));
const fDT = (ms) => fmt(ms, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms)); // YYYY-MM-DD
export const londonHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const who = (state, id) => (state.members || []).find((u) => u.id === id)?.name || (state.staff || []).find((u) => u.id === id)?.name || '同事';
const line = (it) => `**${KIND_CN[it.kind]}** · ${titleOf(it)}`;
const PAGE = { banner: 'banners', topbar: 'topbar', tbstyle: 'topbar', pmodule: 'pmodules', pin: 'pins', salelink: 'salelinks', callout: 'callouts', campaign: 'campaigns' };
const activeIds = (state) => new Set((state.members || []).filter((m) => m.status === 'active').map((m) => m.id));
const adminIds = (state) => (state.members || []).filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.id);
const adminNames = (state) => (state.members || []).filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.name).join('、') || (approvalsOn() ? '审核人' : '管理员');

// 相关的人 = 负责人 + 抄送 + 建 / 提交的人 + 最后保存(发布)的人(只要启用中的成员)
export function relatedOf(state, it, extra = []) {
  const act = activeIds(state);
  return [...new Set([it.owner, ...(it.cc || []), it.by, it.approvedBy, ...extra].filter((id) => id && act.has(id)))];
}
// 这条内容的审批人(没指定、没默认 → 管理员们)
export function approversOf(state, it) {
  const a = effApprover(state, it);
  return a && activeIds(state).has(a) ? [a] : adminIds(state);
}
const orderApprovers = (state, kind) => { const a = state.settings?.approvers?.[kind]; return a && activeIds(state).has(a) ? [a] : adminIds(state); };
const apprName = (state, it) => { const a = effApprover(state, it); return a ? who(state, a) : adminNames(state); };

// ---------- 动作:提交审核 / 批准或退回 ----------
export function actionEvents(state, effect, { appUrl, now = Date.now() } = {}) {
  const to = (path, text = '打开这一条') => ({ text, url: appLink(appUrl, path) }); // 按钮直接打开那一页 / 那一条
  const actor = effect.actor || null;
  if (effect.event === 'submit') {
    if (effect.order) {
      const what = effect.order.kind === 'banner' ? '首页 Banner' : '顶栏';
      return [{ ev: 'content.submit', page: PAGE[effect.order.kind], related: [effect.order.by], approvers: orderApprovers(state, effect.order.kind), actor,
        card: { title: '📝 有新的轮播顺序等审批', color: 'orange', button: to('/reviews', '去审批'), lines: [`${who(state, effect.order.by)} 调整了${what}的顺序`, '批准前前台保持原顺序'] } }];
    }
    const it = findItem(state, effect.id); if (!it) return [];
    const w = effectiveWindow(it, campaignIndex(state.campaigns));
    return [{ ev: 'content.submit', page: PAGE[it.kind], related: relatedOf(state, it), approvers: approversOf(state, it), actor,
      card: { title: effect.change ? '📝 有修改等审批' : '📝 有新内容等审批', color: 'orange', button: to('/reviews', '去审批'),
        lines: [line(it), `提交人:${who(state, effect.change ? it.pendingChange?.by : it.by)}`, w.start ? `计划上线:${fDT(w.start)}` : '',
          `审批人:${apprName(state, it)}`, effect.change ? '批准前线上保持原版本' : '不批准不会上线'] } }];
  }
  if (effect.event === 'decision') {
    if (effect.order) {
      return [{ ev: 'content.decision', page: PAGE[effect.order.kind], related: [effect.order.by], actor,
        card: { title: effect.approved ? '✅ 轮播顺序已批准' : '↩️ 轮播顺序被退回', color: effect.approved ? 'green' : 'red', button: to(`/${PAGE[effect.order.kind]}`, '打开看看'),
          lines: [`${who(state, effect.order.by)} 提交的${effect.order.kind === 'banner' ? '首页 Banner' : '顶栏'}顺序`, effect.note ? `意见:${effect.note}` : ''] } }];
    }
    const it = findItem(state, effect.id); if (!it) return [];
    const camps = campaignIndex(state.campaigns);
    const s = itemStatus(it, camps, now); const w = effectiveWindow(it, camps);
    return [{ ev: 'content.decision', page: PAGE[it.kind], related: relatedOf(state, it, [effect.to]), actor,
      card: { title: effect.approved ? (effect.edited ? '✅ 已批准(审批人改过再保存)' : '✅ 已批准') : '↩️ 被退回', color: effect.approved ? 'green' : 'red', button: to(itemPath(it)),
        lines: [line(it), `审批人:${who(state, effect.actor)} · 提交人:${who(state, effect.to)}`,
          effect.approved ? (s === 'scheduled' ? `将在 ${fDT(w.start)} 自动上线` : s === 'live' ? '已上线' : '') : `意见:${effect.note || '(没写原因)'}`] } }];
  }
  return [];
}

// ---------- 定时器一轮之后 ----------
const allItems = (state) => [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles, ...(state.pmodules || []), ...(state.pins || []), ...(state.salelinks || []), ...(state.callouts || [])];
export function schedulerEvents(state, { changes = [], failures = [] }, { appUrl, now = Date.now() } = {}) {
  const out = [];
  // 按钮直接打开那一条;一张卡片里有好几条就打开概览
  const to = (paths, text) => { const p = oneOr(paths, '/'); return { text: text || (p === '/' ? '打开网站更新中心' : '打开这一条'), url: appLink(appUrl, p) }; };
  const pathOf = (id) => itemPath(findItem(state, id));
  const updown = (c) => `${c.to === 'ACTIVE' ? '⬆️ 上线' : '⬇️ 下线'} · **${KIND_CN[c.kind]}** · ${c.title}`;
  if (changes.length) {
    // 群 / 管理员看全部;相关的人各收一张只列他相关的
    const per = new Map();
    for (const c of changes) {
      const it = findItem(state, c.id); if (!it) continue;
      for (const id of relatedOf(state, it)) { if (!per.has(id)) per.set(id, { lines: [], paths: [] }); per.get(id).lines.push(updown(c)); per.get(id).paths.push(itemPath(it)); }
    }
    const cards = {};
    for (const [id, { lines, paths }] of per) cards[id] = { title: `🔄 你相关的内容自动${lines.every((l) => l.startsWith('⬆️')) ? '上线' : lines.every((l) => l.startsWith('⬇️')) ? '下线' : '上下线'}了`, color: 'blue', button: to(paths), lines };
    out.push({ ev: 'content.updown', related: [...per.keys()], cards,
      card: { title: `🔄 自动上下线 ${changes.length} 条`, color: 'blue', button: to(changes.map((c) => pathOf(c.id))), lines: changes.map(updown) } });
  }
  if (failures.length) {
    const related = [...new Set(failures.flatMap((f) => { const it = f.id && findItem(state, f.id); return it ? relatedOf(state, it) : []; }))];
    out.push({ ev: 'content.failure', key: `failure:${londonDate(now)}:${londonHour(now)}`, related, // 同一小时只报一次
      card: { title: '⚠️ 定时上下线失败', color: 'red', button: to(failures.map((f) => (f.id ? pathOf(f.id) : '/'))), lines: [...failures.slice(0, 8).map((f) => `${f.title ? `**${f.title}**:` : ''}${f.message}`), '下一分钟会自动重试'] } });
  }
  const camps = campaignIndex(state.campaigns);
  for (const it of allItems(state)) {
    const s = itemStatus(it, camps, now); const w = effectiveWindow(it, camps);
    if (!['pending', 'waiting'].includes(s) || w.start == null) continue;
    // 到点了还没上线(或开了审批、2 小时内要上线还没批)
    const soon = s === 'pending' && w.start > now && w.start <= now + 2 * HOUR;
    if ((w.start > now && !soon) || w.start < now - DAY) continue;
    const waitDraft = s === 'waiting' && !approvalsOn(); // 没开审批:「等活动批准」其实是跟随的活动还是草稿 —— 别叫人「审核」
    const camp = s === 'waiting' ? state.campaigns.find((c) => c.id === it.campaign) : null;
    out.push({ ev: 'content.notlive', key: `unapproved:${it.id}:${w.start}`, page: PAGE[it.kind], related: relatedOf(state, it), approvers: approversOf(state, camp || it),
      card: waitDraft
        ? { title: '⏰ 到点了,但跟随的活动还是草稿', color: 'red', button: camp ? { text: '打开那个活动', url: appLink(appUrl, `/campaigns/${encodeURIComponent(camp.id)}/edit`) } : to([itemPath(it)]), lines: [line(it), `原定 ${fDT(w.start)} 上线,它跟随的活动还是草稿,所以前台没显示`, '打开那个活动,点「保存并排期」就会上线'] }
        : { title: soon ? '⏰ 快到上线时间了,还没批准' : '⏰ 到点了,但还没批准', color: 'red', button: to(['/reviews'], '去审批'),
          lines: [line(it), `原定 ${fDT(w.start)} 上线,${s === 'waiting' ? '它跟随的活动' : '它'}还没批准,不批准就不会显示`, `审批人:${apprName(state, camp || it)}`] } });
  }
  for (const it of allItems(state)) {
    if (it.due == null || !['new', 'draft', 'rejected'].includes(it.state)) continue;
    const owner = relatedOf(state, { owner: it.owner || it.by });
    if (it.due > now && it.due - now <= DAY) out.push({ ev: 'content.due', key: `due-soon:${it.id}:${it.due}`, page: PAGE[it.kind], related: owner,
      card: { title: '⏳ 明天截止,还没提交', color: 'orange', button: to([itemPath(it)]), lines: [line(it), `截止:${fDT(it.due)}`, it.state === 'rejected' ? '上次被退回了,改好后重新提交' : '做好后点「提交审核」'] } });
    if (it.due <= now && now - it.due <= 7 * DAY) out.push({ ev: 'content.due', key: `due-over:${it.id}:${it.due}`, page: PAGE[it.kind], related: owner, approvers: approversOf(state, it),
      card: { title: '⚠️ 已过截止时间,还没提交', color: 'red', button: to([itemPath(it)]), lines: [line(it), `截止:${fDT(it.due)}`, `负责人:${who(state, it.owner || it.by)}`] } });
  }
  return out;
}

// ---------- 每天 10:00 ----------
export function digestEvents(state, { appUrl, now = Date.now() } = {}) {
  const out = [];
  if (londonHour(now) < DIGEST_HOUR) return out;
  const today = londonDate(now);
  const camps = campaignIndex(state.campaigns);
  const items = [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles].filter((x) => !x.isDefault);
  const to = (xs) => { const p = oneOr(xs.map(itemPath), '/'); return { text: p === '/' ? '打开网站更新中心' : '打开这一条', url: appLink(appUrl, p) }; };
  const tomorrow = londonDate(now + DAY);
  const up = items.filter((x) => { const w = effectiveWindow(x, camps); return w.start != null && londonDate(w.start) === tomorrow && ['scheduled', 'pending', 'waiting'].includes(itemStatus(x, camps, now)); });
  if (up.length) out.push({ ev: 'content.tomorrow', key: `dayBefore:${today}`, related: [...new Set(up.flatMap((x) => relatedOf(state, x)))],
    card: { title: `📅 明天要上线 ${up.length} 条`, color: 'blue', button: to(up),
      lines: up.map((x) => { const s = itemStatus(x, camps, now); return `${fmt(effectiveWindow(x, camps).start, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · ${line(x)}${s !== 'scheduled' ? (s === 'waiting' && !approvalsOn() ? ' · ⚠️ **跟随的活动还是草稿,到点不会上线**' : ' · ⚠️ **还没批准,到点不会上线**') : ''}`; }) } });
  const ending = items.filter((x) => { const w = effectiveWindow(x, camps); return itemStatus(x, camps, now) === 'live' && w.end != null && w.end - now <= ENDING_SOON_MS; });
  if (ending.length) out.push({ ev: 'content.ending', key: `endingSoon:${today}`, related: [...new Set(ending.flatMap((x) => relatedOf(state, x)))],
    card: { title: `⏳ ${ending.length} 条内容 3 天内下架`, color: 'orange', button: to(ending),
      lines: [...ending.map((x) => `${fDT(effectiveWindow(x, camps).end)} 下架 · ${line(x)}`), '要继续显示就改结束时间;要替换就提前做好新的'] } });
  return out;
}
