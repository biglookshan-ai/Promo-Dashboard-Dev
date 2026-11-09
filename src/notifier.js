// 网站内容(排期)要发的通知:只给「发生了什么 + 数据」,推给谁 / 怎么推 / 什么时候推 / 卡片长什么样由消息中心(src/notify-center.js)按规则定。
// 每条消息:{ ev: '<分类>.<事件>', data: { 字段: 值 }, path: 这一条的网址, related: [相关的人], approvers?, actor?, page?, key?: 去重 }
// 分类 = 内容类型(banner / topbar / pmodule / pin / salelink / callout / campaign,节日样式算 topbar),见 src/notify-catalog.js。
//   有人动手(schedule-api 的 /act):已创建 / 已修改 / 调整顺序 / 暂停恢复结束 / 已删除 —— changeEvents
//   审批(开了审批才有):提交 / 批准退回 —— actionEvents
//   定时器每一轮:自动上线 / 下线、上下线失败、到点没上线、截止提醒 —— schedulerEvents
//   每天英国时间 10:00:明天要上线的 + 3 天内要下架的 —— digestEvents
import { itemStatus, effectiveWindow, campaignIndex, ENDING_SOON_MS } from './schedule-core.js';
import { titleOf, KIND_CN, findItem, effApprover } from './schedule-actions.js';
import { approvalsOn } from './members.js';
import { changedKeys } from './item-history.js';
import { itemPath, PAGE_OF_KIND } from './app-links.js';
import { CAT_OF_KIND } from './notify-catalog.js';

const TZ = 'Europe/London';
const DAY = 86400000;
const HOUR = 3600000;
export const DIGEST_HOUR = 10;
const fmt = (ms, o) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, ...o }).format(new Date(ms));
const fDT = (ms) => fmt(ms, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fHM = (ms) => fmt(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms)); // YYYY-MM-DD
export const londonHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const who = (state, id) => (state.members || []).find((u) => u.id === id)?.name || (state.staff || []).find((u) => u.id === id)?.name || '同事';
const activeIds = (state) => new Set((state.members || []).filter((m) => m.status === 'active').map((m) => m.id));
const adminIds = (state) => (state.members || []).filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.id);
const adminNames = (state) => (state.members || []).filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.name).join('、') || (approvalsOn() ? '审核人' : '管理员');
const STATUS_CN = { live: '上线中', scheduled: '已排期', pending: '待审核', draft: '草稿', ended: '已结束', paused: '已暂停', rejected: '已退回', waiting: '等活动批准' };
const LIST = { banner: 'banners', topbar: 'topbar', tbstyle: 'tbstyles', campaign: 'campaigns', pmodule: 'pmodules', pin: 'pins', salelink: 'salelinks', callout: 'callouts' };

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

// ---------- 一条内容的数据(卡片上能显示的信息)----------
const winText = (w) => (w.start == null && w.end == null ? '长期显示' : `${w.start != null ? fDT(w.start) : '保存后马上'} → ${w.end != null ? fDT(w.end) : '长期'}`);
export function itemData(state, it, now = Date.now()) {
  const camps = campaignIndex(state.campaigns || []);
  const s = itemStatus(it, camps, now);
  const camp = it.campaign ? (state.campaigns || []).find((c) => c.id === it.campaign) : null;
  return {
    kind: KIND_CN[it.kind] || '', name: titleOf(it), time: winText(effectiveWindow(it, camps)), campaign: camp ? titleOf(camp) : '',
    status: s === 'waiting' && !approvalsOn() ? '活动是草稿' : STATUS_CN[s] || s, owner: it.owner ? who(state, it.owner) : '',
  };
}
const evOf = (it, suf) => `${CAT_OF_KIND[it.kind] || 'banner'}.${suf}`;
function itemMsg(state, it, suf, extra = {}, now = Date.now()) {
  return { ev: evOf(it, suf), path: itemPath(it), page: PAGE_OF_KIND[it.kind], related: relatedOf(state, it), data: { ...itemData(state, it, now), ...extra } };
}

// 改了什么:按字段说人话(没认识的算「其他设置」)
const DIFF_CN = {
  title: '标题', name: '名称', subtitle: '副标题', text: '文字', image: '图片', mobileImage: '手机图', video: '视频', link: '链接', url: '链接', btn: '按钮文字', buttonText: '按钮文字',
  badge: '角标', tag: '角标', start: '开始时间', end: '结束时间', campaign: '跟随的活动', parent: '主活动', collections: '产品范围', tags: '产品范围', products: '产品',
  exProducts: '排除的产品', exTags: '排除的标签', tabs: '页签', rules: '条件', ruleGroups: '条件', promo: '推广产品', promos: '推广产品', bg: '底色', color: '文字颜色',
  accent: '强调色', effect: '特效', decoLeft: '装饰', decoRight: '装饰', collection: 'Collection', hidden: '不显示的产品', fullOrder: '完全按本次排序', onlyListed: '只显示前 N 个',
  countdown: '倒计时', owner: '负责人', approver: '审批人', cc: '抄送', due: '截止时间', note: '备注', larkLinks: '飞书任务', paused: '暂停',
  lensCollection: '兼容产品 Collection', promoCollection: '推广产品 Collection', dealPct: '折扣', lpSteps: '玩法', kits: '套装', suffix: '链接后缀', sort: '排序方式',
};
const NO_DIFF = new Set(['id', 'kind', 'by', 'at', 'createdAt', 'updatedAt', 'state', 'syncedStatus', 'syncedAt', 'syncError', 'shopifyId', 'pendingChange', 'counts',
  'approvedBy', 'approvedAt', 'order', 'lastReject', 'rejectNote', 'isDefault', 'history', 'mountFilter', 'badMounts']);
export function diffText(a = {}, b = {}) {
  const keys = changedKeys(a, b).filter((k) => !NO_DIFF.has(k));
  return [...new Set(keys.map((k) => DIFF_CN[k] || '其他设置'))].join('、');
}

// ---------- 有人动手(/api/schedule/act 之后):已创建 / 已修改 / 调整顺序 / 暂停恢复结束 / 已删除 ----------
export function changeEvents(before, after, action = {}, actorId = null, { now = Date.now(), id = null } = {}) {
  const actor = actorId ? who(after, actorId) : '';
  const base = { actor: actorId };
  const t = action.type;
  if (t === 'save') {
    const itA = findItem(after, id || action.id); if (!itA) return [];
    const itB = action.isNew ? null : findItem(before, action.id);
    if (!itB) return [{ ...itemMsg(after, itA, 'created', { actor }, now), ...base }];
    return [{ ...itemMsg(after, itA, 'updated', { actor, changes: diffText(itB, itA) || '重新保存(内容没变)' }, now), ...base }];
  }
  if (t === 'pause' || t === 'end') {
    const it = findItem(after, action.id); if (!it) return [];
    return [{ ...itemMsg(after, it, 'paused', { actor, action: t === 'end' ? '结束' : it.paused ? '暂停' : '恢复显示' }, now), ...base }];
  }
  if (t === 'delete') {
    const it = findItem(before, action.id); if (!it) return [];
    return [{ ...itemMsg(before, it, 'deleted', { actor }, now), path: `/${PAGE_OF_KIND[it.kind] || ''}`, ...base }];
  }
  if (t === 'order' && ['banner', 'topbar'].includes(action.kind)) {
    const camps = campaignIndex(after.campaigns || []);
    const list = (after[LIST[action.kind]] || []).filter((x) => ['live', 'scheduled'].includes(itemStatus(x, camps, now))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return [{ ev: `${action.kind}.order`, path: `/${PAGE_OF_KIND[action.kind]}`, page: PAGE_OF_KIND[action.kind], related: [], ...base,
      data: { order: list.map((x, i) => `${i + 1}. ${titleOf(x)}`), actor } }];
  }
  return [];
}

// ---------- 审批(只有开了审批才有):提交审核 / 批准或退回 ----------
export function actionEvents(state, effect, { now = Date.now() } = {}) {
  const actor = effect.actor || null;
  if (effect.event === 'submit') {
    if (effect.order) {
      const what = effect.order.kind === 'banner' ? '首页 Banner' : '顶栏';
      return [{ ev: 'content.submit', path: '/reviews', page: PAGE_OF_KIND[effect.order.kind], related: [effect.order.by], approvers: orderApprovers(state, effect.order.kind), actor,
        data: { kind: what, name: `${what}的轮播顺序`, submitter: who(state, effect.order.by), note: '批准前前台保持原顺序' } }];
    }
    const it = findItem(state, effect.id); if (!it) return [];
    return [{ ...itemMsg(state, it, 'x', { submitter: who(state, effect.change ? it.pendingChange?.by : it.by), approver: apprName(state, it), note: effect.change ? '批准前线上保持原版本' : '不批准不会上线' }, now),
      ev: 'content.submit', approvers: approversOf(state, it), actor }];
  }
  if (effect.event === 'decision') {
    if (effect.order) {
      const what = effect.order.kind === 'banner' ? '首页 Banner' : '顶栏';
      return [{ ev: 'content.decision', path: `/${PAGE_OF_KIND[effect.order.kind]}`, page: PAGE_OF_KIND[effect.order.kind], related: [effect.order.by], actor,
        data: { kind: what, name: `${what}的轮播顺序`, result: effect.approved ? '已批准' : '被退回', submitter: who(state, effect.order.by), note: effect.note ? `意见:${effect.note}` : '' } }];
    }
    const it = findItem(state, effect.id); if (!it) return [];
    const camps = campaignIndex(state.campaigns); const s = itemStatus(it, camps, now); const w = effectiveWindow(it, camps);
    return [{ ...itemMsg(state, it, 'x', {
      result: effect.approved ? (effect.edited ? '已批准(审批人改过再保存)' : '已批准') : '被退回', approver: who(state, effect.actor), submitter: who(state, effect.to),
      note: effect.approved ? (s === 'scheduled' ? `将在 ${fDT(w.start)} 自动上线` : s === 'live' ? '已上线' : '') : `意见:${effect.note || '(没写原因)'}` }, now),
    ev: 'content.decision', related: relatedOf(state, it, [effect.to]), actor }];
  }
  return [];
}

// ---------- 定时器一轮之后 ----------
const allItems = (state) => [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles, ...(state.pmodules || []), ...(state.pins || []), ...(state.salelinks || []), ...(state.callouts || [])];
export function schedulerEvents(state, { changes = [], failures = [] }, { now = Date.now() } = {}) {
  const out = [];
  // 自动上线 / 下线:一条一个;同一轮同一种的,消息中心会合成一张卡片
  for (const c of changes) { const it = findItem(state, c.id); if (it) out.push(itemMsg(state, it, c.to === 'ACTIVE' ? 'live' : 'off', {}, now)); }
  for (const f of failures) {
    const it = f.id && findItem(state, f.id);
    if (!it) { out.push({ ev: 'system.failure', key: `sysfail:${londonDate(now)}:${londonHour(now)}:${f.message}`, path: '/', related: [], data: { reason: f.message, note: '下一分钟会自动重试' } }); continue; }
    out.push({ ...itemMsg(state, it, 'failure', { reason: f.message, note: '下一分钟会自动重试' }, now), key: `failure:${it.id}:${londonDate(now)}:${londonHour(now)}` }); // 同一条同一小时只报一次
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
    out.push({ ...itemMsg(state, it, 'notlive', waitDraft
      ? { reason: `原定 ${fDT(w.start)} 上线,它跟随的活动「${camp ? titleOf(camp) : ''}」还是草稿,所以前台没显示`, note: '打开那个活动,点「保存并排期」就会上线' }
      : { reason: `原定 ${fDT(w.start)} 上线,${s === 'waiting' ? '它跟随的活动' : '它'}${soon ? '快到时间了还' : ''}没批准,不批准就不会显示`, note: `审批人:${apprName(state, camp || it)}` }, now),
    key: `unapproved:${it.id}:${w.start}`, approvers: approversOf(state, camp || it), ...(waitDraft && camp ? { path: `/campaigns/${encodeURIComponent(camp.id)}/edit` } : {}) });
  }
  for (const it of allItems(state)) {
    if (it.due == null || !['new', 'draft', 'rejected'].includes(it.state)) continue;
    const owner = relatedOf(state, { owner: it.owner || it.by });
    const d = itemData(state, it, now);
    if (it.due > now && it.due - now <= DAY) out.push({ ev: 'content.due', key: `due-soon:${it.id}:${it.due}`, path: itemPath(it), page: PAGE_OF_KIND[it.kind], related: owner,
      data: { ...d, time: `截止 ${fDT(it.due)}`, note: it.state === 'rejected' ? '上次被退回了,改好后重新提交' : '做好后点「提交审核」' } });
    if (it.due <= now && now - it.due <= 7 * DAY) out.push({ ev: 'content.due', key: `due-over:${it.id}:${it.due}`, path: itemPath(it), page: PAGE_OF_KIND[it.kind], related: owner, approvers: approversOf(state, it),
      data: { ...d, time: `截止 ${fDT(it.due)}(已过)`, owner: who(state, it.owner || it.by), note: '已过截止时间,还没提交' } });
  }
  return out;
}

// ---------- 每天 10:00 ----------
export function digestEvents(state, { now = Date.now() } = {}) {
  const out = [];
  if (londonHour(now) < DIGEST_HOUR) return out;
  const today = londonDate(now);
  const camps = campaignIndex(state.campaigns);
  const items = [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles].filter((x) => !x.isDefault);
  const tomorrow = londonDate(now + DAY);
  const up = items.filter((x) => { const w = effectiveWindow(x, camps); return w.start != null && londonDate(w.start) === tomorrow && ['scheduled', 'pending', 'waiting'].includes(itemStatus(x, camps, now)); });
  if (up.length) out.push({ ev: 'daily.tomorrow', key: `dayBefore:${today}`, path: '/', related: [...new Set(up.flatMap((x) => relatedOf(state, x)))],
    data: { items: up.map((x) => { const s = itemStatus(x, camps, now); return `${fHM(effectiveWindow(x, camps).start)} · ${KIND_CN[x.kind]} · ${titleOf(x)}${s !== 'scheduled' ? (s === 'waiting' && !approvalsOn() ? '(⚠️ 跟随的活动还是草稿,到点不会上线)' : '(⚠️ 还没批准,到点不会上线)') : ''}`; }) } });
  const ending = items.filter((x) => { const w = effectiveWindow(x, camps); return itemStatus(x, camps, now) === 'live' && w.end != null && w.end - now <= ENDING_SOON_MS; });
  if (ending.length) out.push({ ev: 'daily.ending', key: `endingSoon:${today}`, path: '/', related: [...new Set(ending.flatMap((x) => relatedOf(state, x)))],
    data: { items: ending.map((x) => `${fDT(effectiveWindow(x, camps).end)} 下架 · ${KIND_CN[x.kind]} · ${titleOf(x)}`), note: '要继续显示就改结束时间;要替换就提前做好新的' } });
  return out;
}
