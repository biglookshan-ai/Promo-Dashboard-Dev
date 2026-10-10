// 改价计划的所有「动作」:存草稿 / 提交审核 / 发布 / 批准 / 退回 / 暂停 / 继续 / 停止 / 删除 / 排除产品 / 处理异常。
// 纯函数,服务器和浏览器共用(浏览器通过 /lib/price-actions.js 加载);权限只在这里检查。
// doc:{ plans, vault, staff, log, settings }   actor:{ id, name, role: 'approver' | 'editor' }
// 返回 { doc, effects, message };effects 交给服务器(发飞书、立刻跑一轮引擎)。
import { planStatus, itemWarnings, toCents, isLive } from './price-core.js';

export class ActionError extends Error {}
const fail = (msg) => { throw new ActionError(msg); };
const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
// 谁能批准这个计划:计划指定的审批人;没指定就只有管理员(actor.role = 'approver' 表示管理员)
const isAdminActor = (a) => a?.role === 'approver';
export const canApprove = (a, plan) => !!a && (isAdminActor(a) || (!!plan?.approver && plan.approver === a.id));

// 计划里可编辑的字段
export const EDIT_KEYS = ['name', 'kind', 'layer', 'compare', 'campaign', 'note', 'slots', 'rule', 'approver', 'owner', 'cc',
  'color', 'scope', 'tagsAdd', 'tagsRemove'];
const pick = (v) => Object.fromEntries(EDIT_KEYS.filter((k) => k in v).map((k) => [k, clone(v[k])]));

export function addLog(doc, now, action, plan, note, actor) {
  doc.log ||= [];
  doc.log.unshift({ at: now, action, planId: plan?.id || null, plan: plan?.name || '', note: note || '', by: actor?.name || '' });
  doc.log = doc.log.slice(0, 2000);
}

export function validate(p, settings = {}) {
  if (!String(p.name || '').trim()) return '请填写计划名称';
  if (!['window', 'permanent'].includes(p.kind)) return '请选择类型(限时 / 永久)';
  if (p.kind === 'window' && !['flash', 'brand', 'sitewide'].includes(p.layer)) return '请选择层级';
  const slots = p.slots || [];
  if (!slots.length) return '至少要有一个时段';
  if (p.kind === 'permanent' && slots.length !== 1) return '永久调价只能有一个生效时间';
  for (const [i, s] of slots.entries()) {
    const name = slots.length > 1 ? `第 ${i + 1} 个时段` : '时段';
    if (s.start == null) return `${name}还没设开始时间`;
    if (p.kind === 'window' && (s.end == null || s.end <= s.start)) return `${name}的结束时间要晚于开始时间`;
    if (!(s.items || []).length) return `${name}还没加产品`;
    const seen = new Set();
    for (const it of s.items) {
      if (seen.has(it.variantId)) return `${name}里有重复的变体:${it.title || it.variantId}`;
      seen.add(it.variantId);
      if (it.price == null && p.kind === 'window') return `${name}「${it.title || it.variantId}」还没设活动价`;
      if (it.price == null && p.compare !== 'set' && p.compare !== 'clear') return `${name}「${it.title || it.variantId}」没有任何改动(售价和划线价都没变)`;
      const err = itemWarnings(p, it, settings).find((w) => w.level === 'error');
      if (err) return `${name}「${it.title || it.variantId}」:${err.text}`;
    }
  }
  // 同一计划里两个时段时间重叠、又有同一个变体 → 说不清用哪个价
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      const overlap = (a.end == null || a.end > b.start) && (b.end == null || b.end > a.start);
      if (overlap && a.items.some((x) => b.items.some((y) => y.variantId === x.variantId))) return `第 ${i + 1} 和第 ${j + 1} 个时段时间重叠,又有相同的产品`;
    }
  }
  return '';
}

// 已经开始的时段锁死:不能改时间、不能改价格、不能删(要停就用暂停 / 停止 / 排除产品)
const slotKey = (s) => JSON.stringify({ start: s.start, end: s.end, collection: s.collection?.id || null, items: s.items.map((i) => [i.variantId, i.price ?? null, i.compareAt ?? null]) });
function checkLocked(plan, next, now) {
  if (plan.state !== 'approved') return;
  if (plan.kind === 'permanent' && Object.keys(plan.applied || {}).length) fail('这个永久调价已经开始执行,不能再改;要停就点「停止」');
  for (const s of plan.slots) {
    if (s.start > now) continue;
    const n = (next.slots || []).find((x) => x.id === s.id);
    if (!n) fail('已经开始的时段不能删除;要提前结束请用「停止」或「排除产品」');
    if (slotKey(n) !== slotKey(s)) fail('已经开始的时段不能改(时间、产品、价格都锁定了);只能暂停、停止或排除产品');
  }
  if (['kind', 'layer', 'compare'].some((k) => k in next && next[k] !== plan[k]) && plan.slots.some((s) => s.start <= now)) fail('计划已经开始,类型 / 层级 / 划线价方式不能再改');
}

export function applyAction(input, action, actor, now = Date.now()) {
  const doc = clone(input);
  doc.plans ||= []; doc.vault ||= {}; doc.log ||= [];
  const effects = [];
  let message = '';
  const settings = doc.settings || {};
  const find = (id) => doc.plans.find((p) => p.id === id) || fail('这个计划已经不存在(可能被别人删了),请刷新');

  switch (action.type) {
    case 'save': {
      const { mode, values = {} } = action;
      let plan = action.id ? doc.plans.find((p) => p.id === action.id) : null;
      if (action.id && !plan && !action.isNew) fail('这个计划已经不存在(可能被别人删了),请刷新');
      const isNew = !plan;
      if (isNew) {
        const id = values.id || action.id;
        if (!id || doc.plans.some((p) => p.id === id)) fail('新计划的编号无效');
        plan = { id, state: 'new', createdBy: actor.id, createdAt: now, paused: false, stopped: false, excluded: [], applied: {}, pendingChange: null, campaign: null, compare: null, note: '' };
      }
      const v = pick(values);
      const merged = { ...plan, ...v };
      if (mode !== 'draft') { const err = validate(merged, settings); if (err) fail(err); }
      const approved = plan.state === 'approved';
      if (approved) checkLocked(plan, v, now);

      if (mode === 'draft') {
        if (approved) fail('已批准的计划不能存草稿;要改就提交修改审核');
        Object.assign(plan, v, { state: 'draft', updatedAt: now });
        if (isNew) doc.plans.push(plan);
        addLog(doc, now, 'draft', plan, '', actor);
        message = '已存草稿';
      } else if (mode === 'submit' && !canApprove(actor, merged)) {
        if (approved) {
          plan.pendingChange = { ...v, by: actor.id, at: now };
          addLog(doc, now, 'submit', plan, '提交修改,批准前按原计划执行', actor);
        } else {
          Object.assign(plan, v, { state: 'pending', submittedBy: actor.id, submittedAt: now, rejectNote: null, updatedAt: now });
          if (isNew) doc.plans.push(plan);
          addLog(doc, now, 'submit', plan, '', actor);
        }
        effects.push({ type: 'notify', event: 'submit', id: plan.id, change: approved });
        message = '已提交审核';
      } else if (mode === 'submit' || mode === 'publish') {
        // 审核人自己提交 = 直接批准
        if (!canApprove(actor, merged)) fail('只有这个计划的审批人(或管理员)可以直接批准');
        Object.assign(plan, v, { state: 'approved', approvedBy: actor.id, approvedAt: now, pendingChange: null, rejectNote: null, updatedAt: now });
        if (isNew) { plan.submittedBy = actor.id; doc.plans.push(plan); }
        addLog(doc, now, 'approve', plan, approved ? '审核人修改并直接生效' : '审核人发布', actor);
        effects.push({ type: 'run' });
        message = '已批准,到时间自动执行';
      } else fail('未知的保存方式');
      return { doc, effects, message, id: plan.id };
    }

    case 'approve': {
      const plan = find(action.id);
      if (!canApprove(actor, plan.pendingChange ? { ...plan, ...plan.pendingChange } : plan)) fail('只有这个计划的审批人(或管理员)可以批准');
      if (plan.pendingChange) {
        const { by, at, ...change } = plan.pendingChange;
        checkLocked(plan, change, now);
        const err = validate({ ...plan, ...change }, settings); if (err) fail(err);
        Object.assign(plan, change, { pendingChange: null, approvedBy: actor.id, approvedAt: now });
        addLog(doc, now, 'approve', plan, '批准修改', actor);
      } else {
        if (plan.state !== 'pending') fail('这个计划不在待审核状态');
        const err = validate(plan, settings); if (err) fail(err);
        Object.assign(plan, { state: 'approved', approvedBy: actor.id, approvedAt: now, rejectNote: null });
        addLog(doc, now, 'approve', plan, '', actor);
      }
      effects.push({ type: 'notify', event: 'decision', id: plan.id, ok: true }, { type: 'run' });
      return { doc, effects, message: '已批准' };
    }

    case 'reject': {
      const plan = find(action.id);
      if (!canApprove(actor, plan)) fail('只有这个计划的审批人(或管理员)可以退回');
      const note = String(action.note || '').trim();
      if (plan.pendingChange) { plan.pendingChange = null; addLog(doc, now, 'reject', plan, `退回修改${note ? ':' + note : ''},按原计划继续`, actor); }
      else {
        if (plan.state !== 'pending') fail('这个计划不在待审核状态');
        Object.assign(plan, { state: 'rejected', rejectNote: note || null });
        addLog(doc, now, 'reject', plan, note, actor);
      }
      effects.push({ type: 'notify', event: 'decision', id: plan.id, ok: false, note });
      return { doc, effects, message: '已退回' };
    }

    case 'pause':
    case 'resume': {
      const plan = find(action.id);
      if (!canApprove(actor, plan)) fail('只有这个计划的审批人(或管理员)可以暂停 / 继续');
      if (plan.state !== 'approved' || plan.stopped) fail('只有已批准、没停止的计划能暂停 / 继续');
      plan.paused = action.type === 'pause';
      addLog(doc, now, action.type, plan, plan.paused ? '暂停:下一轮恢复原价' : '继续:按计划重新套用', actor);
      effects.push({ type: 'notify', event: action.type, id: plan.id }, { type: 'run' });
      return { doc, effects, message: plan.paused ? '已暂停,马上恢复原价' : '已继续' };
    }

    case 'stop': {
      // 停止 = 提前结束(不能再继续)。暂停是可以恢复的。任何人都能停 —— 停只会把价格恢复,是安全方向
      const plan = find(action.id);
      if (plan.state !== 'approved') fail('只有已批准的计划需要停止');
      if (plan.stopped) fail('已经停止了');
      plan.stopped = true; plan.stoppedAt = now; plan.stoppedBy = actor.id; plan.pendingChange = null;
      addLog(doc, now, 'stop', plan, plan.kind === 'window' ? '提前结束:下一轮全部恢复原价' : '停止:还没执行的不再执行', actor);
      effects.push({ type: 'notify', event: 'stop', id: plan.id }, { type: 'run' });
      return { doc, effects, message: '已停止' };
    }

    case 'delete': {
      const plan = find(action.id);
      const st = planStatus(plan, now);
      if (plan.state === 'approved' && !canApprove(actor, plan)) fail('已批准的计划只有审批人(或管理员)能删');
      if (['running', 'paused'].includes(st)) fail('进行中的计划不能删,先「停止」');
      if (Object.values(doc.vault).some((v) => v.written?.planId === plan.id || v.hold?.planId === plan.id)) fail('还有产品没恢复原价,等恢复完再删');
      if (plan.kind === 'permanent' && Object.keys(plan.applied || {}).length && !plan.done && !plan.stopped) fail('永久调价执行到一半,先「停止」');
      doc.plans = doc.plans.filter((p) => p !== plan);
      addLog(doc, now, 'delete', plan, '', actor);
      return { doc, effects, message: '已删除' };
    }

    case 'exclude': {
      // 把产品移出计划:正在促销的下一轮恢复原价(安全方向,任何人都能做)
      const plan = find(action.id);
      const ids = (action.variantIds || []).filter(Boolean);
      if (!ids.length) fail('没选要移出的产品');
      plan.excluded = [...new Set([...(plan.excluded || []), ...ids])];
      addLog(doc, now, 'exclude', plan, `移出 ${ids.length} 个变体${isLive(plan) ? ',下一轮恢复原价' : ''}`, actor);
      effects.push({ type: 'run' });
      return { doc, effects, message: `已移出 ${ids.length} 个变体` };
    }

    case 'resolve': {
      // 处理暂停接管的变体。三种选择都交给执行器去写(写后读回核对),这里只改保险库;
      // 注意店里现在的划线价可能是 app 当初写进去的 —— 一律沿用保险库里的「原划线价」,免得活动结束后产品永远挂着划线价。
      //   reapply:以店里现在的售价为原价,重新套用活动价
      //   keep:退出相关计划,售价保持现在的,划线价还原
      //   restore:恢复成保险库里的原价,并退出相关计划
      const vs = doc.vault[action.variantId] || fail('这个产品已经不在异常清单里了');
      const holdPlan = doc.plans.find((p) => p.id === vs.hold?.planId);
      if (!isAdminActor(actor) && !canApprove(actor, holdPlan)) fail('只有相关计划的审批人(或管理员)可以处理异常');
      if (!vs.hold) fail('这个产品没有暂停接管');
      const v = action.variantId;
      const plans = doc.plans.filter((p) => p.slots?.some((s) => s.items.some((i) => i.variantId === v)) && p.state === 'approved');
      const exit = () => plans.forEach((p) => { p.excluded = [...new Set([...(p.excluded || []), v])]; });
      const label = vs.title || v;
      const seen = vs.hold.seen || null;
      const origCompare = vs.base?.compareAt ?? null;
      if (!['reapply', 'keep', 'restore'].includes(action.choice)) fail('未知的处理方式');

      if (!vs.written) {
        // app 还没写过这个变体(比如原价已经低于活动价没开始):店里就是它自己的价,不用写回
        if (action.choice !== 'reapply') exit();
        delete doc.vault[v];
      } else {
        const curWritten = { ...seen, planId: vs.written.planId, slotId: vs.written.slotId, at: now };
        if (action.choice === 'reapply') vs.base = { price: seen.price, compareAt: origCompare };
        if (action.choice === 'keep') { exit(); vs.base = { price: seen.price, compareAt: origCompare }; }
        if (action.choice === 'restore') { if (!vs.base) fail('没有原价记录,没法恢复;请选别的处理方式'); exit(); }
        // 把「已写价」对齐成店里现价,下一轮执行器就按新的原价去套用 / 恢复
        vs.written = curWritten; vs.hold = null;
      }
      const note = { reapply: `以现价 £${seen?.price} 为原价,重新套用活动价`, keep: `退出计划,保持现价 £${seen?.price}`, restore: `恢复原价${vs.base ? ' £' + vs.base.price : ''}并退出计划` }[action.choice];
      addLog(doc, now, 'resolve', null, `${label}:${note}`, actor);
      effects.push({ type: 'run' });
      return { doc, effects, message: '已处理' };
    }

    default:
      fail('未知动作');
  }
  return { doc, effects, message };
}

// 计划汇总(列表 / 飞书用)
export function planSummary(plan) {
  const items = plan.slots.flatMap((s) => s.items);
  const products = new Set(items.map((i) => i.productId));
  return { slots: plan.slots.length, variants: new Set(items.map((i) => i.variantId)).size, products: products.size,
    start: Math.min(...plan.slots.map((s) => s.start)), end: plan.kind === 'window' ? Math.max(...plan.slots.map((s) => s.end)) : null,
    lowest: items.reduce((m, i) => (i.price != null && toCents(i.price) < m ? toCents(i.price) : m), Infinity) };
}
