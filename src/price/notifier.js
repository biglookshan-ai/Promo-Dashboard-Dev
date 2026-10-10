// 改价的飞书通知:**只私信给相关的人,不发群**(改价 / 成本是敏感信息)。
//   相关的人 = 计划的负责人、审批人、提交人、抄送;没人就发给管理员。
//   即时:提交审核 / 批准或退回 / 暂停、继续、停止 / 改价生效、恢复 / 暂停接管 / 失败 / 快开始了还没批准
// 去重:state.notified(同一个失败一小时只报一次,同一计划的「还没批准」只报一次)。
import { sendDMs } from '../lark-bot.js';
import { LAYER_CN, planStatus } from './price-core.js';
import { planSummary } from './price-actions.js';

const TZ = 'Europe/London';
const HOUR = 3600_000;
const fmt = (ms) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const nameOf = (members, id) => members.find((m) => m.id === id)?.name || '同事';
const admins = (members) => members.filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.id);
const planLine = (p) => `**${p.name}** · ${p.kind === 'window' ? `${LAYER_CN[p.layer] || ''} · 限时` : '永久调价'}`;
function windowLine(p) {
  const s = planSummary(p);
  return `${s.products} 个产品 / ${s.variants} 个变体 · ${fmt(s.start)}${s.end ? ` → ${fmt(s.end)}` : ' 起'}${s.slots > 1 ? `(${s.slots} 个时段)` : ''}`;
}
// 这个计划相关的人
export function peopleOf(p, members, { approverOnly = false } = {}) {
  const ids = approverOnly ? [p.approver] : [p.owner, p.approver, p.submittedBy, p.createdBy, ...(p.cc || [])];
  const active = new Set(members.filter((m) => m.status === 'active').map((m) => m.id));
  const out = [...new Set(ids.filter((id) => id && active.has(id)))];
  return out.length ? out : admins(members);
}

export function eventMessages(state, effect, { appUrl, members = [] } = {}) {
  const n = state.settings.notify; const btn = { text: '打开改价', url: appUrl };
  const p = state.plans.find((x) => x.id === effect.id);
  if (!p) return [];
  if (effect.event === 'submit' && n.submit) {
    return [{ to: peopleOf(p, members, { approverOnly: true }), card: { title: effect.change ? '📝 改价计划有修改等你审批' : '📝 有改价计划等你审批', color: 'orange', button: btn,
      lines: [planLine(p), windowLine(p), `提交人:${nameOf(members, effect.change ? p.pendingChange?.by : p.submittedBy)}`,
        effect.change ? '批准前按原计划执行' : '不批准不会改价'] } }];
  }
  if (effect.event === 'decision' && n.decision) {
    const st = planStatus(p);
    return [{ to: peopleOf(p, members), card: { title: effect.ok ? '✅ 改价计划已批准' : '↩️ 改价计划被退回', color: effect.ok ? 'green' : 'red', button: btn,
      lines: [planLine(p), windowLine(p), effect.ok ? (st === 'scheduled' ? '到时间自动改价' : '一分钟内开始改价') : `意见:${effect.note || '(没写原因)'}`] } }];
  }
  if (['pause', 'resume', 'stop'].includes(effect.event) && n.decision) {
    const t = { pause: '⏸ 改价计划已暂停', resume: '▶️ 改价计划已继续', stop: '⏹ 改价计划已提前结束' }[effect.event];
    const d = { pause: '一分钟内恢复原价', resume: '一分钟内重新套用活动价', stop: p.kind === 'window' ? '一分钟内全部恢复原价' : '还没执行的不再执行' }[effect.event];
    return [{ to: peopleOf(p, members), card: { title: t, color: effect.event === 'resume' ? 'blue' : 'grey', button: btn, lines: [planLine(p), d] } }];
  }
  return [];
}

const OP_CN = { start: '开始活动价', switch: '换时段价', restore: '恢复原价', permanent: '永久调价' };
const HOLD_CN = { manual: '有人手动改过价', 'not-lower': '原价已不比活动价高' };

// 执行器一轮之后
export function reportMessages(state, rep, { appUrl, now = Date.now(), members = [] } = {}) {
  const n = state.settings.notify; const out = []; const btn = { text: '打开改价', url: appUrl };
  const planOf = (id) => state.plans.find((x) => x.id === id);
  const toPlan = (id) => { const p = planOf(id); return p ? peopleOf(p, members) : admins(members); };
  const byPlan = new Map();
  for (const w of rep.written) {
    const k = w.planId || '-';
    if (!byPlan.has(k)) byPlan.set(k, { planId: w.planId, plan: w.plan, ops: {} });
    byPlan.get(k).ops[w.op] = (byPlan.get(k).ops[w.op] || 0) + 1;
  }
  for (const g of byPlan.values()) {
    const restoring = g.ops.restore && Object.keys(g.ops).length === 1;
    if (restoring ? !n.end : !n.start) continue;
    out.push({ to: toPlan(g.planId), card: { title: restoring ? '🔙 改价已恢复' : '💷 改价已生效', color: restoring ? 'grey' : 'green', button: btn,
      lines: [`**${g.plan || '改价计划'}**`, Object.entries(g.ops).map(([op, c]) => `${OP_CN[op] || op} ${c} 个变体`).join(' · '), '全部已读回核对 ✓'] } });
  }
  for (const c of rep.collections) if (n.start) out.push({ to: admins(members), card: { title: '🗂 合集已更新', color: 'blue', button: btn, lines: [`合集「${c.title}」:加入 ${c.added} 个、移出 ${c.removed} 个产品`] } });
  if (rep.holds.length && n.hold) {
    const groups = new Map();
    for (const h of rep.holds) { const k = h.planId || '-'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
    for (const [pid, hs] of groups) {
      out.push({ to: [...new Set([...toPlan(pid === '-' ? null : pid), ...admins(members)])], card: { title: '⚠️ 有产品暂停接管,等你处理', color: 'red', button: btn,
        lines: [...hs.slice(0, 10).map((h) => `· ${h.title || h.variantId}(${h.plan || '—'}):${HOLD_CN[h.reason] || h.reason}${h.seen ? `,店里现价 £${h.seen.price}` : ''}`),
          hs.length > 10 ? `……共 ${hs.length} 个` : '', '这些产品 app 不会再动,请在「改价 → 受管产品」里选择处理方式'] } });
    }
  }
  if (rep.recovered.length && n.failure) out.push({ to: admins(members), card: { title: 'ℹ️ 上次改价中途中断,已核对补记', color: 'blue', button: btn, lines: [`${rep.recovered.length} 个变体确认已生效,原价记录无误`] } });
  const fresh = rep.failures.filter((f) => {
    const k = `fail:${f.variantId || f.collection || ''}:${f.message}`;
    if (state.notified[k] && now - state.notified[k] < HOUR) return false;
    state.notified[k] = now; return true;
  });
  if (fresh.length && n.failure) {
    out.push({ to: [...new Set([...fresh.flatMap((f) => toPlan(f.planId)), ...admins(members)])], card: { title: '❌ 改价失败', color: 'red', button: btn,
      lines: [...fresh.slice(0, 8).map((f) => `· ${f.title || f.collection || ''}${f.title || f.collection ? ':' : ''}${f.message}`), fresh.length > 8 ? `……共 ${fresh.length} 条` : '', '执行器下一分钟自动重试'] } });
  }
  for (const m of rep.moved || []) if (n.decision) {
    const p = planOf(m.planId);
    out.push({ to: p ? peopleOf(p, members) : admins(members), card: { title: '🕑 改价时间跟着活动改了', color: 'blue', button: btn,
      lines: [`**${m.plan}**`, `活动「${m.campaign}」改了时间,这个计划跟着改成:`, `${fmt(m.to.start)}${m.to.end ? ` → ${fmt(m.to.end)}` : ' 起'}`] } });
  }
  for (const f of rep.finished) if (n.end) out.push({ to: toPlan(f.planId), card: { title: '✅ 永久调价已全部完成', color: 'green', button: btn, lines: [`**${f.plan}**`] } });
  if (n.unapproved) {
    for (const p of state.plans) {
      if (p.state !== 'pending' && !p.pendingChange) continue;
      const start = planSummary(p).start;
      const k = `unapproved:${p.id}:${start}`;
      if (start - now > 2 * HOUR || start < now - HOUR || state.notified[k]) continue;
      state.notified[k] = now;
      out.push({ to: peopleOf(p, members, { approverOnly: true }), card: { title: '⏰ 改价计划快开始了,还没批准', color: 'orange', button: btn, lines: [planLine(p), `开始时间:${fmt(start)}`, '不批准就不会改价'] } });
    }
  }
  for (const [k, t] of Object.entries(state.notified)) if (now - t > 7 * 24 * HOUR) delete state.notified[k];
  return out;
}

// 私信发出去;没开飞书就不发(改价通知不进群)
export async function deliver(state, msgs, { send = sendDMs } = {}) {
  let failed = [];
  for (const m of msgs) failed = failed.concat(await send(m.to, m.card));
  if (failed.length) console.error('[lark-dm]', failed.slice(0, 3).map((f) => f.message).join(' / '));
  return failed;
}
