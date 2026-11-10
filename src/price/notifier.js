// 改价要发的通知:只给「发生了什么 + 数据」,推给谁 / 怎么推 / 什么时候推 / 卡片长什么样由消息中心(src/notify-center.js)按规则定。
// 每条消息:{ ev: 'price.<事件>', data: { 字段: 值 }, path: '/price/<计划 id>', related, approvers, actor?, key? }(有哪些事件 / 字段见 src/notify-catalog.js)
//   相关的人 = 计划的负责人、审批人、建的人、提交的人、最后保存的人、抄送(只要启用中的成员;一个都没有时由消息中心按规则兜底)
//   有人动手(/api/price/act 之后):已创建 / 已修改 / 已删除 —— planChangeEvents;审批、暂停继续提前结束 —— eventMessages
//   执行器一轮之后:开始 / 换下一段 / 结束 / 永久调价完成 / 被接管 / 失败 / Collection / 时间跟着活动改 —— reportMessages
// 去重:state.notified(同一个失败一小时只报一次,同一计划的「还没批准」只报一次)。
import { planStatus, STATUS_CN } from './price-core.js';
import { planSummary } from './price-actions.js';
import { planPath } from '../app-links.js';
import { leadApprovers } from '../members.js';
import { changedKeys } from '../item-history.js';

const TZ = 'Europe/London';
const HOUR = 3600_000;
const fmt = (ms) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const nameOf = (members, id) => members.find((m) => m.id === id)?.name || '同事';
const activeSet = (members) => new Set(members.filter((m) => m.status === 'active').map((m) => m.id));
// 这个计划相关的人(不再自动补管理员:管理员收不收由消息中心的规则定)
export function relatedOf(p, members) {
  if (!p) return [];
  const act = activeSet(members);
  return [...new Set([p.owner, p.approver, p.createdBy, p.submittedBy, p.approvedBy, ...(p.cc || [])].filter((id) => id && act.has(id)))];
}
// 审批人:计划指定的 → 提交人所在部门里「改价」能上线的负责人(2026-11-10,要传 sched)→ 管理员们
export function approversOf(p, members, sched = null) {
  const act = activeSet(members);
  if (p?.approver && act.has(p.approver)) return [p.approver];
  const leads = sched ? leadApprovers(sched, p?.pendingChange?.by || p?.submittedBy || p?.createdBy, 'price') : [];
  if (leads.length) return leads;
  return members.filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.id);
}

// ---------- 一个计划的数据(卡片上能显示的信息)----------
const MODE_CN = { percent_off: (v) => `降 ${v}%`, amount_off: (v) => `减 £${v}`, fixed: (v) => `统一 £${v}`, percent_up: (v) => `涨 ${v}%`, keep: () => '售价不变', manual: () => '逐个填价' };
const ruleCn = (r) => (r && MODE_CN[r.mode] ? MODE_CN[r.mode](r.value) : '');
const vName = (p, id) => { const v = (p.versions || []).find((x) => x.id === id); return v?.name || (id ? `价格 ${id}` : ''); };
function discountText(p, ver) {
  const groups = p.groups?.length ? p.groups : [{ rule: p.rule }];
  const one = (g) => ruleCn(ver && ver !== 'A' && g.vrules?.[ver] ? g.vrules[ver] : g.rule);
  const parts = groups.slice(0, 3).map((g, i) => `${groups.length > 1 ? `${g.name || `分组 ${i + 1}`}:` : ''}${one(g)}`).filter((x) => !/:$/.test(x) && x);
  return parts.join(';') + (groups.length > 3 ? ` 等 ${groups.length} 组` : '');
}
const slotNow = (p, now) => (p.slots || []).find((s) => s.start <= now && (s.end == null || now < s.end)) || null;
export function planData(p, members = [], now = Date.now()) {
  if (!p) return {};
  const s = planSummary(p);
  const sl = slotNow(p, now);
  const multi = (p.versions || []).length > 1;
  return {
    plan: p.name || '改价计划', pkind: p.kind === 'window' ? '限时改价' : '永久调价',
    time: `${fmt(s.start)}${s.end ? ` → ${fmt(s.end)}` : ' 起'}${s.slots > 1 ? `(${s.slots} 段)` : ''}`,
    scope: `${s.products} 个产品 / ${s.variants} 个变体`, discount: discountText(p, sl?.version),
    price: multi ? (sl?.version ? vName(p, sl.version) : (p.versions || []).map((v) => v.name || `价格 ${v.id}`).join('、')) : '',
    campaign: p.campaign?.name || '', owner: p.owner ? nameOf(members, p.owner) : '', status: STATUS_CN[planStatus(p, now)] || '',
  };
}
const msgOf = (p, ev, members, extra = {}, now = Date.now()) => ({ ev, path: planPath(p?.id), related: relatedOf(p, members), approvers: approversOf(p, members), data: { ...planData(p, members, now), ...extra } });

// 改了什么(改价计划)
const PLAN_DIFF_CN = { name: '计划名', kind: '改价类型', slots: '时间 / 产品 / 价格', rule: '折扣', groups: '改价分组 / 折扣', scope: '产品范围', compare: '划线价', priority: '优先级', layer: '优先级',
  campaign: '关联活动', campaigns: '关联活动', tagsAdd: '加标签', tagsRemove: '去掉标签', countdown: '倒计时', versions: '价格', schedule: '时间安排', followCampaign: '跟随活动时间',
  owner: '负责人', approver: '审批人', cc: '抄送', note: '备注', color: '颜色', folder: '列表分组', excluded: '排除的产品', paused: '暂停', stopped: '提前结束' };
const PLAN_NO_DIFF = new Set(['id', 'state', 'applied', 'pendingChange', 'createdBy', 'createdAt', 'updatedAt', 'submittedBy', 'submittedAt', 'approvedBy', 'approvedAt', 'log', 'series']);
export const planDiffText = (a = {}, b = {}) => [...new Set(changedKeys(a, b).filter((k) => !PLAN_NO_DIFF.has(k)).map((k) => PLAN_DIFF_CN[k] || '其他设置'))].join('、');

// ---------- 有人动手:已创建 / 已修改 / 已删除 ----------
export function planChangeEvents(beforePlans = [], afterPlans = [], action = {}, actorId = null, { members = [], id = null, now = Date.now() } = {}) {
  const actor = actorId ? nameOf(members, actorId) : '';
  if (action.type === 'save') {
    const pA = afterPlans.find((x) => x.id === (id || action.id)); if (!pA) return [];
    const pB = action.isNew ? null : beforePlans.find((x) => x.id === action.id);
    if (!pB) return [{ ...msgOf(pA, 'price.created', members, { actor }, now), actor: actorId }];
    return [{ ...msgOf(pA, 'price.updated', members, { actor, changes: planDiffText(pB, pA) || '重新保存(内容没变)' }, now), actor: actorId }];
  }
  if (action.type === 'delete') {
    const pB = beforePlans.find((x) => x.id === action.id); if (!pB) return [];
    return [{ ...msgOf(pB, 'price.deleted', members, { actor }, now), path: '/price', actor: actorId }];
  }
  return [];
}

// ---------- 审批 / 暂停继续提前结束;actor = 点按钮的人 ----------
export function eventMessages(state, effect, { members = [], actor = null, now = Date.now(), sched = null } = {}) {
  const p = state.plans.find((x) => x.id === effect.id);
  if (!p) return [];
  if (effect.event === 'submit') {
    return [{ ...msgOf(p, 'price.submit', members, { submitter: nameOf(members, effect.change ? p.pendingChange?.by : p.submittedBy), note: effect.change ? '批准前按原计划执行' : '不批准不会改价' }, now), approvers: approversOf(p, members, sched), actor }];
  }
  if (effect.event === 'decision') {
    const st = planStatus(p);
    return [{ ...msgOf(p, 'price.decision', members, { result: effect.ok ? '已批准' : '被退回', approver: nameOf(members, actor),
      note: effect.ok ? (st === 'scheduled' ? '到时间自动改价' : '一分钟内开始改价') : `意见:${effect.note || '(没写原因)'}` }, now), actor }];
  }
  if (['pause', 'resume', 'stop'].includes(effect.event)) {
    const a = { pause: '暂停', resume: '继续', stop: '提前结束' }[effect.event];
    const d = { pause: '一分钟内回到改价前的价格', resume: '一分钟内重新套用活动价', stop: p.kind === 'window' ? '一分钟内全部回到改价前的价格' : '还没执行的不再执行' }[effect.event];
    return [{ ...msgOf(p, 'price.control', members, { action: a, note: d, actor: actor ? nameOf(members, actor) : '' }, now), actor }];
  }
  return [];
}

const OP_CN = { start: '开始活动价', switch: '换到下一段的价', restore: '回到改价前', permanent: '永久调价' };
const HOLD_CN = { manual: '有人在后台手动改过价', 'not-lower': '原价已不比活动价高' };

// ---------- 执行器一轮之后 ----------
export function reportMessages(state, rep, { now = Date.now(), members = [] } = {}) {
  const out = [];
  const planOf = (id) => state.plans.find((x) => x.id === id) || null;
  const rel = (id) => relatedOf(planOf(id), members);
  const named = (id, name) => planOf(id) || { id, name: name || '改价计划', slots: [], kind: 'window' };
  const safeData = (id, name) => { try { return planData(planOf(id), members, now); } catch { return { plan: name || '改价计划' }; } };
  const msg = (id, name, ev, extra) => ({ ev, path: planPath(id), related: rel(id), approvers: approversOf(planOf(id), members), data: { ...(planOf(id) ? safeData(id, name) : { plan: name || '改价计划' }), ...extra } });
  // 改了价:一个计划一条(开始 / 换下一段 / 结束)
  const byPlan = new Map();
  for (const w of rep.written || []) {
    const k = w.planId || '-';
    if (!byPlan.has(k)) byPlan.set(k, { planId: w.planId, plan: w.plan, ops: {}, products: new Set() });
    const g = byPlan.get(k); g.ops[w.op] = (g.ops[w.op] || 0) + 1; if (w.title) g.products.add(w.title);
  }
  for (const g of byPlan.values()) {
    const ops = Object.keys(g.ops);
    const ev = ops.every((o) => o === 'restore') ? 'price.restored' : ops.some((o) => o === 'start' || o === 'permanent') ? 'price.live' : 'price.switch';
    out.push(msg(g.planId, g.plan, ev, { ops: Object.entries(g.ops).map(([op, c]) => `${OP_CN[op] || op} ${c} 个变体`).join(' · '), products: [...g.products], check: '全部已读回核对 ✓' }));
  }
  // Collection 加入 / 移出:相关的人 = 设了加进这个 Collection 的计划的人
  const collPlans = (cid) => state.plans.filter((p) => (p.slots || []).some((s) => s.collection?.id === cid));
  for (const c of rep.collections || []) {
    const ps = collPlans(c.collectionId);
    out.push({ ev: 'price.collection', path: ps.length === 1 ? planPath(ps[0].id) : '/price', related: [...new Set(ps.flatMap((p) => relatedOf(p, members)))],
      data: { collection: `${c.title}:加入 ${c.added} 个、移出 ${c.removed} 个产品`, plan: ps.map((p) => p.name).join('、') } });
  }
  // 被接管(有人手动改价 / 原价不比活动价高):一个计划一条
  const holds = new Map();
  for (const h of rep.holds || []) { const k = h.planId || '-'; if (!holds.has(k)) holds.set(k, []); holds.get(k).push(h); }
  for (const [pid, hs] of holds) {
    out.push({ ...msg(pid === '-' ? null : pid, hs[0].plan, 'price.hold', {
      holds: hs.map((h) => `${h.title || h.variantId}${h.sku ? `(${h.sku})` : ''}:${HOLD_CN[h.reason] || h.reason}${h.seen ? `,店里现价 £${h.seen.price}` : ''}`),
      reason: [...new Set(hs.map((h) => HOLD_CN[h.reason] || h.reason))].join('、'), note: '这些产品 app 不会再动,请在「改价 → 受管产品」里选择处理方式' }),
    ...(pid === '-' ? { related: [], path: '/price/vault' } : {}) });
  }
  // Collection 在店里被删了:只通知这一次(执行器之后不再管它,不会再报失败)
  for (const c of rep.goneCollections || []) {
    out.push({ ev: 'price.gone', path: c.plans.length === 1 ? planPath(c.plans[0].id) : '/price', related: [...new Set(c.plans.flatMap((p) => rel(p.id)))],
      data: { collection: c.title || '—', plan: c.plans.map((p) => p.name).join('、'), note: '价格照常改,只是不再往这个 Collection 里加 / 移出产品,也不会再报错;要换 Collection 请打开计划处理' } });
  }
  const rec = new Map();
  for (const r of rep.recovered || []) { const k = r.planId || '-'; rec.set(k, (rec.get(k) || 0) + 1); }
  for (const [pid, n] of rec) out.push({ ...msg(pid === '-' ? null : pid, named(pid).name, 'price.recovered', { note: `${n} 个变体确认已生效,原价记录无误` }), ...(pid === '-' ? { path: '/price' } : {}) });
  // 失败:同一个错误一小时只报一次;一个计划一条
  const fresh = (rep.failures || []).filter((f) => {
    const k = `fail:${f.variantId || f.collection || ''}:${f.message}`;
    if (state.notified[k] && now - state.notified[k] < HOUR) return false;
    state.notified[k] = now; return true;
  });
  const fails = new Map();
  for (const f of fresh) { const k = f.planId || '-'; if (!fails.has(k)) fails.set(k, []); fails.get(k).push(f); }
  for (const [pid, fs] of fails) {
    out.push({ ...msg(pid === '-' ? null : pid, fs[0].plan, 'price.failure', { failures: fs.map((f) => `${f.title || f.collection || ''}${f.title || f.collection ? ':' : ''}${f.message}`), note: '执行器下一分钟自动重试' }),
      ...(pid === '-' ? { path: '/price' } : {}) });
  }
  for (const m of rep.moved || []) out.push(msg(m.planId, m.plan, 'price.moved', { campaign: m.campaign, time: `${fmt(m.to.start)}${m.to.end ? ` → ${fmt(m.to.end)}` : ' 起'}` }));
  for (const f of rep.finished || []) out.push(msg(f.planId, f.plan, 'price.finished', {}));
  for (const p of state.plans) {
    if (p.state !== 'pending' && !p.pendingChange) continue;
    const start = planSummary(p).start;
    const k = `unapproved:${p.id}:${start}`;
    if (start - now > 2 * HOUR || start < now - HOUR || state.notified[k]) continue;
    state.notified[k] = now;
    out.push(msgOf(p, 'price.unapproved', members, { note: '不批准就不会改价' }, now));
  }
  for (const [k, t] of Object.entries(state.notified)) if (now - t > 7 * 24 * HOUR) delete state.notified[k];
  return out;
}
