// 改价要发的通知:只说「发生了什么、和谁有关」,发给谁 / 发群还是私信 / 马上还是汇总,由通知中心(src/notify-center.js)按规则定。
// 2026-11-09 起:以前「只私信、不发群」写死在这里;现在管理员在通知中心定(用户:可以选发群还是发不同的人)。
//   相关的人 = 计划的负责人、审批人、建的人、提交的人、最后保存的人、抄送(只要启用中的成员;一个都没有时由通知中心按规则兜底)
// 去重:state.notified(同一个失败一小时只报一次,同一计划的「还没批准」只报一次)。
import { prioOf, PRIO_MAX, planStatus } from './price-core.js';
import { planSummary } from './price-actions.js';

const TZ = 'Europe/London';
const HOUR = 3600_000;
const fmt = (ms) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const nameOf = (members, id) => members.find((m) => m.id === id)?.name || '同事';
const planLine = (p) => `**${p.name}** · ${p.kind === 'window' ? `限时${prioOf(p) !== PRIO_MAX ? ` · 优先级 ${prioOf(p)}` : ''}` : '永久调价'}`;
function windowLine(p) {
  const s = planSummary(p);
  return `${s.products} 个产品 / ${s.variants} 个变体 · ${fmt(s.start)}${s.end ? ` → ${fmt(s.end)}` : ' 起'}${s.slots > 1 ? `(${s.slots} 个时段)` : ''}`;
}
const activeSet = (members) => new Set(members.filter((m) => m.status === 'active').map((m) => m.id));
// 这个计划相关的人(不再自动补管理员:管理员收不收由通知中心的规则定)
export function relatedOf(p, members) {
  if (!p) return [];
  const act = activeSet(members);
  return [...new Set([p.owner, p.approver, p.createdBy, p.submittedBy, p.approvedBy, ...(p.cc || [])].filter((id) => id && act.has(id)))];
}
export function approversOf(p, members) {
  const act = activeSet(members);
  if (p?.approver && act.has(p.approver)) return [p.approver];
  return members.filter((m) => m.status === 'active' && (m.roles || []).includes('admin')).map((m) => m.id);
}

// 动作(提交 / 批准退回 / 暂停继续提前结束);actor = 点按钮的人
export function eventMessages(state, effect, { appUrl, members = [], actor = null } = {}) {
  const btn = { text: '打开改价', url: appUrl };
  const p = state.plans.find((x) => x.id === effect.id);
  if (!p) return [];
  const base = { related: relatedOf(p, members), approvers: approversOf(p, members), actor };
  if (effect.event === 'submit') {
    return [{ ...base, ev: 'price.submit', card: { title: effect.change ? '📝 改价计划有修改等你审批' : '📝 有改价计划等你审批', color: 'orange', button: btn,
      lines: [planLine(p), windowLine(p), `提交人:${nameOf(members, effect.change ? p.pendingChange?.by : p.submittedBy)}`,
        effect.change ? '批准前按原计划执行' : '不批准不会改价'] } }];
  }
  if (effect.event === 'decision') {
    const st = planStatus(p);
    return [{ ...base, ev: 'price.decision', card: { title: effect.ok ? '✅ 改价计划已批准' : '↩️ 改价计划被退回', color: effect.ok ? 'green' : 'red', button: btn,
      lines: [planLine(p), windowLine(p), effect.ok ? (st === 'scheduled' ? '到时间自动改价' : '一分钟内开始改价') : `意见:${effect.note || '(没写原因)'}`] } }];
  }
  if (['pause', 'resume', 'stop'].includes(effect.event)) {
    const t = { pause: '⏸ 改价计划已暂停', resume: '▶️ 改价计划已继续', stop: '⏹ 改价计划已提前结束' }[effect.event];
    const d = { pause: '一分钟内回到改价前的价格', resume: '一分钟内重新套用活动价', stop: p.kind === 'window' ? '一分钟内全部回到改价前的价格' : '还没执行的不再执行' }[effect.event];
    return [{ ...base, ev: 'price.control', card: { title: t, color: effect.event === 'resume' ? 'blue' : 'grey', button: btn,
      lines: [planLine(p), d, actor ? `操作人:${nameOf(members, actor)}` : ''] } }];
  }
  return [];
}

const OP_CN = { start: '开始活动价', switch: '换时段价', restore: '回到改价前', permanent: '永久调价' };
const HOLD_CN = { manual: '有人手动改过价', 'not-lower': '原价已不比活动价高' };

// 执行器一轮之后
export function reportMessages(state, rep, { appUrl, now = Date.now(), members = [] } = {}) {
  const out = []; const btn = { text: '打开改价', url: appUrl };
  const planOf = (id) => state.plans.find((x) => x.id === id);
  const rel = (id) => relatedOf(planOf(id), members);
  const byPlan = new Map();
  for (const w of rep.written) {
    const k = w.planId || '-';
    if (!byPlan.has(k)) byPlan.set(k, { planId: w.planId, plan: w.plan, ops: {} });
    byPlan.get(k).ops[w.op] = (byPlan.get(k).ops[w.op] || 0) + 1;
  }
  for (const g of byPlan.values()) {
    const restoring = g.ops.restore && Object.keys(g.ops).length === 1;
    out.push({ ev: restoring ? 'price.restored' : 'price.live', related: rel(g.planId), card: { title: restoring ? '🔙 改价已恢复' : '💷 改价已生效', color: restoring ? 'grey' : 'green', button: btn,
      lines: [`**${g.plan || '改价计划'}**`, Object.entries(g.ops).map(([op, c]) => `${OP_CN[op] || op} ${c} 个变体`).join(' · '), '全部已读回核对 ✓'] } });
  }
  // Collection 加入 / 移出:相关的人 = 设了加进这个 Collection 的计划的人
  const collPlans = (cid) => state.plans.filter((p) => (p.slots || []).some((s) => s.collection?.id === cid));
  for (const c of rep.collections) {
    out.push({ ev: 'price.collection', related: [...new Set(collPlans(c.collectionId).flatMap((p) => relatedOf(p, members)))],
      card: { title: '🗂 Collection 已更新', color: 'blue', button: btn, lines: [`Collection「${c.title}」:加入 ${c.added} 个、移出 ${c.removed} 个产品`] } });
  }
  if (rep.holds.length) {
    const groups = new Map();
    for (const h of rep.holds) { const k = h.planId || '-'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
    for (const [pid, hs] of groups) {
      out.push({ ev: 'price.hold', related: pid === '-' ? [] : rel(pid), card: { title: '⚠️ 有产品暂停接管,等你处理', color: 'red', button: btn,
        lines: [...hs.slice(0, 10).map((h) => `· ${h.title || h.variantId}(${h.plan || '—'}):${HOLD_CN[h.reason] || h.reason}${h.seen ? `,店里现价 £${h.seen.price}` : ''}`),
          hs.length > 10 ? `……共 ${hs.length} 个` : '', '这些产品 app 不会再动,请在「改价 → 受管产品」里选择处理方式'] } });
    }
  }
  // Collection 在店里被删了:只通知这一次(执行器之后不再管它,不会再报失败)
  for (const c of rep.goneCollections || []) {
    out.push({ ev: 'price.gone', related: [...new Set(c.plans.flatMap((p) => rel(p.id)))], card: { title: '🗂 Collection 已被删除', color: 'orange', button: btn,
      lines: [`Collection「${c.title || '—'}」在店里已经不存在了(被删除了)。`,
        c.plans.length ? `改价计划 ${c.plans.map((p) => `「${p.name}」`).join('')} 设了生效期间把产品加进它。` : '',
        '**价格照常改**,只是不再往这个 Collection 里加 / 移出产品,也不会再报错。',
        '要把产品加进别的 Collection,请在「改价」里打开计划处理。'].filter(Boolean) } });
  }
  if (rep.recovered.length) out.push({ ev: 'price.recovered', related: [...new Set(rep.recovered.flatMap((r) => rel(r.planId)))],
    card: { title: 'ℹ️ 上次改价中途中断,已核对补记', color: 'blue', button: btn, lines: [`${rep.recovered.length} 个变体确认已生效,原价记录无误`] } });
  const fresh = rep.failures.filter((f) => {
    const k = `fail:${f.variantId || f.collection || ''}:${f.message}`;
    if (state.notified[k] && now - state.notified[k] < HOUR) return false;
    state.notified[k] = now; return true;
  });
  if (fresh.length) {
    out.push({ ev: 'price.failure', related: [...new Set(fresh.flatMap((f) => rel(f.planId)))], card: { title: '❌ 改价失败', color: 'red', button: btn,
      lines: [...fresh.slice(0, 8).map((f) => `· ${f.title || f.collection || ''}${f.title || f.collection ? ':' : ''}${f.message}`), fresh.length > 8 ? `……共 ${fresh.length} 条` : '', '执行器下一分钟自动重试'] } });
  }
  for (const m of rep.moved || []) {
    out.push({ ev: 'price.moved', related: rel(m.planId), card: { title: '🕑 改价时间跟着活动改了', color: 'blue', button: btn,
      lines: [`**${m.plan}**`, `活动「${m.campaign}」改了时间,这个计划跟着改成:`, `${fmt(m.to.start)}${m.to.end ? ` → ${fmt(m.to.end)}` : ' 起'}`] } });
  }
  for (const f of rep.finished) out.push({ ev: 'price.restored', related: rel(f.planId), card: { title: '✅ 永久调价已全部完成', color: 'green', button: btn, lines: [`**${f.plan}**`] } });
  for (const p of state.plans) {
    if (p.state !== 'pending' && !p.pendingChange) continue;
    const start = planSummary(p).start;
    const k = `unapproved:${p.id}:${start}`;
    if (start - now > 2 * HOUR || start < now - HOUR || state.notified[k]) continue;
    state.notified[k] = now;
    out.push({ ev: 'price.unapproved', related: relatedOf(p, members), approvers: approversOf(p, members),
      card: { title: '⏰ 改价计划快开始了,还没批准', color: 'orange', button: btn, lines: [planLine(p), `开始时间:${fmt(start)}`, '不批准就不会改价'] } });
  }
  for (const [k, t] of Object.entries(state.notified)) if (now - t > 7 * 24 * HOUR) delete state.notified[k];
  return out;
}
