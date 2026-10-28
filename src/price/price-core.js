// 定时改价的规则(纯函数,服务器和浏览器共用):
//   - 价格怎么算:打几折 / 减多少 / 指定价 / 涨几 %,尾数 .99 / 整数
//   - 划线价怎么处理:显示原价 / 不动 / 清空 / 指定
//   - 此刻每个变体「应该」是什么价:多个限时计划重叠时按优先级(1–10,数字大的说了算;一样大开始晚的说了算)
//   - 定时器这一轮要做什么(开始 / 切换 / 恢复 / 永久改价 / 改原价),拿到店里现价后再定最终写什么
//     (有人手动改过 → 暂停接管这个变体,绝不覆盖)
// 价格内部一律用「分」做整数运算,对外存 '123.45' 字符串(和 Shopify 一致)。

export const LAYERS = { flash: 30, brand: 20, sitewide: 10 };
export const LAYER_CN = { flash: '限时抢购', brand: '品牌 / Collection', sitewide: '全场' }; // 老计划的「层级」,只用来显示历史版本
// 优先级(2026-10-26 用户:层级改成数字优先级,默认最高):1–10,数字大的说了算;一样大开始晚的说了算,再看批准晚的。
// 老计划只有 layer:限时抢购 10 / 品牌 9 / 全场 8(保持原来的先后)
export const PRIO_MAX = 10;
export const prioOf = (plan) => {
  const n = Math.round(Number(plan?.priority));
  return n >= 1 && n <= PRIO_MAX ? n : ({ flash: 10, brand: 9, sitewide: 8 }[plan?.layer] ?? PRIO_MAX);
};
export const KIND_CN = { window: '限时(到期恢复)', permanent: '永久' };
// 划线价(2026-10-28 用户定的五种):original 原来的划线价,没有就用原来的现价(限时默认)/ keep 只用原来的划线价(没有就不显示,永久默认)
//   / price 只用原来的现价 / clear 不显示 / set 逐个指定
export const COMPARE_CN = { original: '显示原来的划线价,没有就显示原来的现价', keep: '只显示原来的划线价', price: '只显示原来的现价', clear: '不显示划线价', set: '逐个指定划线价' };

export const toCents = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const fromCents = (c) => (c == null ? null : (c / 100).toFixed(2));
// 划线价 0 / 空 都算没有
const cmpCents = (v) => { const c = toCents(v); return c && c > 0 ? c : null; };

export const pair = (price, compareAt) => ({ price: fromCents(toCents(price)), compareAt: cmpCents(compareAt) ? fromCents(cmpCents(compareAt)) : null });
export const samePair = (a, b) => !!a && !!b && toCents(a.price) === toCents(b.price) && cmpCents(a.compareAt) === cmpCents(b.compareAt);
export const fmtPair = (p) => (p ? `£${p.price}${p.compareAt ? `(划线 £${p.compareAt})` : ''}` : '—');

// ---------- 价格计算 ----------

// 尾数:'' 不取整 / '99' 向下取到 .99 / '00' 向下取整。取完 ≤ 0 就不取。
export function roundCents(c, rounding) {
  if (rounding === '99') { const r = Math.floor((c + 1) / 100) * 100 - 1; return r > 0 ? r : c; }
  if (rounding === '00') { const r = Math.floor(c / 100) * 100; return r > 0 ? r : c; }
  return c;
}

// rule:{ mode, value, rounding, from }
//   mode:percent_off 打折(value=减几 %)/ amount_off 减金额 / fixed 指定价 / percent_up 涨几 % / keep 售价不变(只改划线价)
//   from:'price' 按现售价算(默认)/ 'compare' 按划线价算(产品本来就有划线价时,比如「RRP 的 8 折」)
export function priceByRule(base, rule) {
  const p = toCents(base.price);
  if (p == null) throw new Error('缺少现价');
  if (rule.mode === 'keep') return fromCents(p);
  const v = Number(rule.value);
  if (!Number.isFinite(v) || v < 0) throw new Error('改价数值不对');
  const c = cmpCents(base.compareAt);
  const ref = rule.from === 'compare' && c && c > p ? c : p;
  let out;
  switch (rule.mode) {
    case 'percent_off': if (v >= 100) throw new Error('折扣要小于 100%'); out = ref * (1 - v / 100); break;
    case 'amount_off': out = ref - v * 100; break;
    case 'fixed': out = v * 100; break;
    case 'percent_up': out = p * (1 + v / 100); break;
    default: throw new Error('未知的改价方式');
  }
  out = Math.round(out);
  if (rule.mode !== 'fixed') out = roundCents(out, rule.rounding);
  return fromCents(Math.max(out, 0));
}

// 目标价 = 条目的售价 + 按计划的划线价方式算出的划线价。base = 原价(保险库里的,或店里现价)
// item.price 为 null = 售价不变(只改划线价)
export function targetFor(base, plan, item) {
  const price = item.price ?? base.price;
  const pc = toCents(price);
  // 单独例外(2026-10-28 用户):试算表格里给这个变体改过划线价 → 不管上面选哪种都用它(compareAt 空 = 这个变体不显示划线价)
  if (item.cmpManual) return pair(price, cmpCents(item.compareAt) ? item.compareAt : null);
  let compareAt = null;
  switch (plan.compare || (plan.kind === 'permanent' ? 'keep' : 'original')) {
    case 'original': { const o = Math.max(toCents(base.price), cmpCents(base.compareAt) || 0); compareAt = o > pc ? fromCents(o) : null; break; }
    case 'keep': compareAt = cmpCents(base.compareAt) ? base.compareAt : null; break;
    case 'price': { const o = toCents(base.price); compareAt = o > pc ? fromCents(o) : null; break; } // 原来的现价(比新价高才显示)
    case 'clear': compareAt = null; break;
    case 'set': compareAt = cmpCents(item.compareAt) ? item.compareAt : null; break;
    default: throw new Error('未知的划线价方式');
  }
  return pair(price, compareAt);
}

export const discountPct = (from, to) => {
  const a = toCents(from), b = toCents(to);
  return a && b != null ? Math.round((1 - b / a) * 1000) / 10 : 0;
};

// ---------- 计划 / 时段状态 ----------

export const isLive = (plan) => plan.state === 'approved' && !plan.paused && !plan.stopped;
export const slotActive = (slot, now) => slot.start != null && slot.start <= now && (slot.end == null || now < slot.end);
const minStart = (plan) => Math.min(...plan.slots.map((s) => s.start ?? Infinity));

// draft 草稿 / pending 待审核 / rejected 被退回 / scheduled 已排期 / running 进行中 / paused 暂停 / ended 已结束 / done 已完成(永久)
export function planStatus(plan, now = Date.now()) {
  if (plan.state === 'pending') return 'pending';
  if (plan.state === 'rejected') return 'rejected';
  if (plan.state !== 'approved') return 'draft';
  if (plan.stopped) return 'ended';
  if (plan.kind === 'permanent') return plan.done ? 'done' : plan.paused ? 'paused' : minStart(plan) <= now ? 'running' : 'scheduled';
  if (plan.paused) return 'paused';
  if (now < minStart(plan)) return 'scheduled';
  if (plan.slots.every((s) => s.end != null && s.end <= now)) return 'ended';
  return 'running';
}
export const STATUS_CN = { draft: '草稿', pending: '待审核', rejected: '被退回', scheduled: '已排期', running: '进行中', paused: '暂停中', ended: '已结束', done: '已完成' };

// 变体 → 出现在哪些(计划, 时段, 条目)里。每轮建一次,省得反复扫
export function indexItems(plans) {
  const m = new Map();
  for (const plan of plans) {
    const ex = new Set(plan.excluded || []);
    for (const slot of plan.slots || []) {
      for (const item of slot.items || []) {
        if (ex.has(item.variantId)) continue;
        if (!m.has(item.variantId)) m.set(item.variantId, []);
        m.get(item.variantId).push({ plan, slot, item });
      }
    }
  }
  return m;
}

const rankOf = ({ plan, slot }) => [prioOf(plan), slot.start || 0, plan.approvedAt || 0];
const higher = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

// 此刻这个变体归哪个限时时段管(优先级最高的;一样高开始晚的;再看批准晚的)
export function assignmentAt(entries, now) {
  let best = null;
  for (const e of entries || []) {
    if (e.plan.kind !== 'window' || !isLive(e.plan) || !slotActive(e.slot, now)) continue;
    if (!best || higher(rankOf(e), rankOf(best))) best = e;
  }
  return best;
}
// 已开始、还没执行到这个变体的永久改价(多个就取开始最晚的)
function pendingPermanent(entries, now) {
  let best = null;
  for (const e of entries || []) {
    if (e.plan.kind !== 'permanent' || !isLive(e.plan) || e.plan.done) continue;
    if (e.slot.start == null || e.slot.start > now || (e.plan.applied || {})[e.item.variantId]) continue;
    if (!best || e.slot.start > best.slot.start) best = e;
  }
  return best;
}

// ---------- 引擎:这一轮要做什么 ----------
// state:{ plans, vault: { [变体]: { productId, title, base, written, hold } } }
// 返回 ops:每个要处理的变体一条 { variantId, productId, op, asg?, perm? }
//   start 开始接管(要用店里现价当原价) / switch 换到另一个时段的价 / restore 恢复原价 / permanent 永久改价(不接管)
//   rebase 正在促销的变体碰上永久改价:只改保险库里的原价(和 switch / restore 同一条 op 里带 perm)
export function planWork(state, now) {
  const idx = indexItems(state.plans);
  const vault = state.vault || {};
  const ids = new Set(Object.keys(vault).filter((v) => vault[v].written));
  for (const [v, entries] of idx) {
    if (entries.some((e) => (e.plan.kind === 'window' && isLive(e.plan) && slotActive(e.slot, now)) || (e.plan.kind === 'permanent' && pendingPermanent([e], now)))) ids.add(v);
  }
  const ops = [];
  for (const v of ids) {
    const vs = vault[v];
    if (vs?.hold) continue; // 暂停接管的,等人处理
    const entries = idx.get(v) || [];
    const asg = assignmentAt(entries, now);
    const perm = pendingPermanent(entries, now);
    const productId = vs?.productId || (asg || perm)?.item.productId;
    const controlled = !!vs?.written;
    if (!controlled) {
      if (asg) ops.push({ variantId: v, productId, op: 'start', asg, perm });
      else if (perm) ops.push({ variantId: v, productId, op: 'permanent', perm });
      continue;
    }
    const base = perm ? targetFor(vs.base, perm.plan, perm.item) : vs.base;
    if (asg) {
      const want = targetFor(base, asg.plan, asg.item);
      const moved = vs.written.planId !== asg.plan.id || vs.written.slotId !== asg.slot.id;
      if (moved || !samePair(want, vs.written) || perm) ops.push({ variantId: v, productId, op: 'switch', asg, perm });
    } else {
      ops.push({ variantId: v, productId, op: 'restore', perm });
    }
  }
  return ops;
}

// 拿到店里现价后定最终写什么。current:Map 变体 → { price, compareAt, productId } (查不到 = 变体被删了)
// 返回 writes(要写的)、holds(要暂停接管的)、done(不用写但要记账的,比如现价已经等于目标)
export function decide(state, ops, current) {
  const vault = state.vault || {};
  const writes = [], holds = [], done = [], missing = [];
  for (const o of ops) {
    const cur = current.get(o.variantId);
    if (!cur) { missing.push(o); continue; }
    const vs = vault[o.variantId];
    if (vs?.written && !samePair(cur, vs.written)) {
      holds.push({ ...o, reason: 'manual', seen: pair(cur.price, cur.compareAt), expected: vs.written });
      continue;
    }
    const curPair = pair(cur.price, cur.compareAt);
    let base, want;
    if (o.op === 'permanent') { base = curPair; want = targetFor(curPair, o.perm.plan, o.perm.item); }
    else {
      base = o.op === 'start' ? curPair : vs.base;
      if (o.perm) base = targetFor(base, o.perm.plan, o.perm.item); // 永久改价先落到原价上
      if (o.op === 'restore') want = base;
      else {
        want = targetFor(base, o.asg.plan, o.asg.item);
        // 原价后来降到活动价以下:不能打着促销的名义涨价
        if (o.asg.item.price != null && toCents(want.price) >= toCents(base.price)) {
          holds.push({ ...o, reason: 'not-lower', seen: curPair, expected: want, base });
          continue;
        }
      }
    }
    const rec = { ...o, productId: o.productId || cur.productId, from: curPair, to: want, base };
    (samePair(curPair, want) ? done : writes).push(rec);
  }
  return { writes, holds, done, missing };
}

// 一条写成功(或本来就不用写)之后,更新保险库 / 计划的执行记录。直接改 state。
export function commit(state, rec, now, meta = {}) {
  state.vault ||= {};
  const v = rec.variantId;
  if (rec.perm?.plan) { rec.perm.plan.applied ||= {}; rec.perm.plan.applied[v] = now; }
  if (rec.op === 'permanent') { if (state.vault[v]?.intentOnly) delete state.vault[v]; return; }
  if (rec.op === 'restore') { delete state.vault[v]; return; }
  const prev = state.vault[v] || {};
  state.vault[v] = {
    productId: rec.productId, title: meta.title || prev.title || '', sku: meta.sku ?? prev.sku ?? '',
    base: rec.base, written: { ...rec.to, planId: rec.asg.plan.id, slotId: rec.asg.slot.id, at: now }, hold: null,
    since: prev.since || now,
  };
}

export function holdVariant(state, rec, now, meta = {}) {
  state.vault ||= {};
  const prev = state.vault[rec.variantId] || { productId: rec.productId, base: rec.base || null, written: null, since: now };
  state.vault[rec.variantId] = { ...prev, title: meta.title || prev.title || '', sku: meta.sku ?? prev.sku ?? '', hold: { reason: rec.reason, seen: rec.seen, expected: rec.expected, planId: rec.asg?.plan.id || prev.written?.planId || null, at: now } };
}

// 巡检:正在接管的变体,店里现价和 app 写进去的对不上 = 有人手动改过 → 暂停接管(不等到下次改价才发现)
export function sweep(state, current) {
  const holds = [];
  for (const [v, vs] of Object.entries(state.vault || {})) {
    if (!vs.written || vs.hold) continue;
    const cur = current.get(v);
    if (cur && !samePair(cur, vs.written)) holds.push({ variantId: v, productId: vs.productId, op: 'sweep', reason: 'manual', seen: pair(cur.price, cur.compareAt), expected: vs.written });
  }
  return holds;
}

// 永久计划:全部条目执行完 → done
export function finishPlans(state, now) {
  const finished = [];
  for (const plan of state.plans) {
    if (plan.kind !== 'permanent' || plan.done || !isLive(plan)) continue;
    const ex = new Set(plan.excluded || []);
    const all = plan.slots.flatMap((s) => s.items).filter((i) => !ex.has(i.variantId));
    if (all.length && all.every((i) => (plan.applied || {})[i.variantId])) { plan.done = true; plan.doneAt = now; finished.push(plan); }
  }
  return finished;
}

// ---------- 预览检查(编辑器 / 审核用)----------
// 每个条目给出 { level: 'error' | 'warn', code, text }。error 不能提交,warn 要审核人看过。
export function itemWarnings(plan, item, { maxDiscountPct = 60 } = {}) {
  const out = [];
  const ref = { price: item.refPrice, compareAt: item.refCompareAt };
  if (item.price != null) {
    const p = toCents(item.price);
    if (p == null || p <= 0) out.push({ level: 'error', code: 'zero', text: '价格必须大于 0' });
    else {
      const d = discountPct(ref.price, item.price);
      if (plan.kind === 'window' && p >= toCents(ref.price)) out.push({ level: 'error', code: 'not-lower', text: '限时活动价不比现价低' });
      if (plan.kind === 'permanent' && p > toCents(ref.price)) out.push({ level: 'warn', code: 'up', text: `涨价 ${Math.abs(d)}%` });
      if (d > maxDiscountPct) out.push({ level: 'warn', code: 'deep', text: `降幅 ${d}%,超过上限 ${maxDiscountPct}%` });
      if (item.cost != null && p < toCents(item.cost)) out.push({ level: 'warn', code: 'below-cost', text: `低于成本价 £${item.cost}` });
    }
  }
  try {
    const t = targetFor(pair(ref.price, ref.compareAt), plan, item);
    if (toCents(t.price) < toCents(ref.price) && !t.compareAt) out.push({ level: 'warn', code: 'no-strike', text: '降价了但没有划线价,前台看不出在打折' });
    if (t.compareAt && toCents(t.compareAt) <= toCents(t.price)) out.push({ level: 'warn', code: 'low-strike', text: '划线价不比新价高,前台不会显示成打折' });
  } catch (e) { out.push({ level: 'error', code: 'bad', text: e.message }); }
  return out;
}

// 和别的计划重叠的时段(同一变体、时间有交集)。返回 [{ variantId, other: { planId, name, priority }, wins }]
export function overlaps(plan, plans) {
  const out = [];
  const others = plans.filter((p) => p.id !== plan.id && p.kind === 'window' && ['approved', 'pending'].includes(p.state) && !p.stopped);
  if (plan.kind !== 'window') return out;
  for (const slot of plan.slots) {
    for (const item of slot.items) {
      for (const p of others) {
        for (const s of p.slots) {
          const hit = s.items.some((i) => i.variantId === item.variantId) && (s.end == null || s.end > slot.start) && (slot.end == null || slot.end > s.start);
          if (!hit) continue;
          const wins = higher(rankOf({ plan, slot }), rankOf({ plan: p, slot: s }));
          out.push({ variantId: item.variantId, slotId: slot.id, other: { planId: p.id, name: p.name, priority: prioOf(p), start: s.start }, wins });
        }
      }
    }
  }
  return out;
}

// 列表页用:还没结束的限时计划之间,谁和谁改到了同一个产品、时间又重叠(2026-10-26 用户:这种情况要有提示)
// 返回 Map(计划 id → [{ planId, name, n: 重叠的变体数, wins: 这个计划说了算 }])
export function overlapIndex(plans, now = Date.now()) {
  const live = plans.filter((p) => p.kind === 'window' && ['approved', 'pending'].includes(p.state) && !p.stopped
    && (p.slots || []).some((s) => s.end == null || s.end > now));
  const out = new Map();
  for (const [vid, es] of indexItems(live)) {
    if (es.length < 2) continue;
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      const a = es[i], b = es[j];
      if (a.plan.id === b.plan.id) continue;
      const hit = (a.slot.end == null || a.slot.end > (b.slot.start ?? 0)) && (b.slot.end == null || b.slot.end > (a.slot.start ?? 0));
      if (!hit) continue;
      const aw = higher(rankOf(a), rankOf(b));
      for (const [x, y, w] of [[a, b, aw], [b, a, !aw]]) {
        if (!out.has(x.plan.id)) out.set(x.plan.id, new Map());
        const m = out.get(x.plan.id);
        if (!m.has(y.plan.id)) m.set(y.plan.id, { planId: y.plan.id, name: y.plan.name, n: new Set(), wins: w });
        m.get(y.plan.id).n.add(vid);
      }
    }
  }
  return new Map([...out].map(([k, m]) => [k, [...m.values()].map((o) => ({ ...o, n: o.n.size }))]));
}

// ---------- 改价倒计时(2026-10-27 用户)----------
// 限时计划可以在产品上显示倒计时,倒数到这一段结束(恢复原价)。只给「此刻真的在这个计划价格上」的产品
// (保险库里 written.planId = 这个计划、没暂停接管);一个产品几个变体在不同计划里 → 用最早结束的那个。
// 写在产品字段 custom.cgp_price_cd(json):{ e: 结束秒, s: 开始显示秒(0 = 一直显示), l: 文字, st: 样式 }。
// 主题 snippets/cgp-campaign-offer.liquid 读它:比合集置顶清单 / 活动的倒计时优先(活动的徽章照常显示)。
export const CD_DAYS = [0, 1, 3, 7, 15];
export const CD_STYLES = ['classic', 'pill', 'dark', 'minimal'];
const CD_DAY = 86_400_000;
export function cdValue(plan, slot) {
  const c = plan.countdown || {};
  const days = CD_DAYS.includes(Number(c.days)) ? Number(c.days) : 0;
  return { e: Math.floor(slot.end / 1000), s: days ? Math.floor((slot.end - days * CD_DAY) / 1000) : 0,
    l: String(c.label || '').trim().slice(0, 60), st: CD_STYLES.includes(c.style) ? c.style : 'classic' };
}
// → { set: [{ productId, value(json 字符串) }], del: [productId] }(和 state.cdState 比,只给有变化的)
export function planCountdowns(state, now) {
  const plans = new Map((state.plans || []).map((p) => [p.id, p]));
  const want = new Map();
  for (const v of Object.values(state.vault || {})) {
    if (!v?.written || v.hold || !v.productId) continue;
    const plan = plans.get(v.written.planId);
    if (!plan || plan.kind !== 'window' || !plan.countdown?.on || !isLive(plan)) continue;
    const slot = (plan.slots || []).find((s) => s.id === v.written.slotId);
    if (!slot?.end || slot.end <= now) continue;
    const val = cdValue(plan, slot);
    const cur = want.get(v.productId);
    if (!cur || val.e < cur.e) want.set(v.productId, val);
  }
  const have = state.cdState || {};
  const set = [], del = [];
  for (const [productId, val] of want) { const value = JSON.stringify(val); if (have[productId] !== value) set.push({ productId, value }); }
  for (const productId of Object.keys(have)) if (!want.has(productId)) del.push(productId);
  return { set, del };
}

// ---------- 写前意图(防止改到一半重启后把活动价误当原价)----------
// 调 Shopify 之前先把「从多少改成多少」存进保险库;读回核对成功后由 commit 清掉。
export function setIntent(state, w, now) {
  state.vault ||= {};
  const vs = state.vault[w.variantId] ||= { productId: w.productId, base: null, written: null, hold: null, since: now, intentOnly: true };
  vs.intent = { op: w.op, from: w.from, to: w.to, base: w.base, planId: w.asg?.plan.id || null, slotId: w.asg?.slot.id || null, permPlanId: w.perm?.plan.id || null, at: now };
}
export function clearIntent(state, v) {
  const vs = state.vault?.[v];
  if (!vs) return;
  delete vs.intent;
  if (vs.intentOnly) delete state.vault[v];
}
// 把意图还原成 commit 能用的记录
export function recFromIntent(state, v) {
  const vs = state.vault[v]; const it = vs.intent;
  const permPlan = it.permPlanId ? state.plans.find((p) => p.id === it.permPlanId) : null;
  return { variantId: v, productId: vs.productId, op: it.op, from: it.from, to: it.to, base: it.base,
    asg: it.planId ? { plan: { id: it.planId }, slot: { id: it.slotId } } : null, perm: permPlan ? { plan: permPlan } : null };
}
// 每轮开头:上一轮留下的意图(说明改到一半中断了),对照店里现价判断到底改没改成
//   现价 = 目标价 → 改成功了,补记;现价 = 改前价 → 没改成,清掉;都不是 → 有人动过,暂停接管
export function recoverIntents(state, current, now) {
  const out = { committed: [], dropped: [], holds: [] };
  for (const v of Object.keys(state.vault || {})) {
    const vs = state.vault[v];
    if (!vs.intent) continue;
    const rec = recFromIntent(state, v);
    const cur = current.get(v);
    if (!cur) { clearIntent(state, v); out.dropped.push(rec); continue; }
    if (samePair(cur, rec.to)) { commit(state, rec, now); out.committed.push(rec); }
    else if (samePair(cur, rec.from)) { clearIntent(state, v); out.dropped.push(rec); }
    else {
      clearIntent(state, v);
      const h = { ...rec, reason: 'manual', seen: pair(cur.price, cur.compareAt), expected: rec.to };
      holdVariant(state, h, now); out.holds.push(h);
    }
  }
  return out;
}

// ---------- 时段的「加入合集」----------
// 和改价一样按「此刻应有」对齐,按合集记账(不按时段),Flash 一天天交接也不会漏移出:
// collState[合集] = { title, managed: [app 加进去的产品], preexisting: [本来就在合集里的产品(不归 app 管,永远不移出)] }
// 返回每个合集这一轮要做的:remove(app 加的、现在不需要了)、check(需要但还不知道在不在合集里,执行器查完再决定加不加)
export function planCollections(state, now) {
  const needed = new Map();
  for (const plan of state.plans) {
    if (plan.kind !== 'window' || !isLive(plan)) continue;
    const ex = new Set(plan.excluded || []);
    for (const slot of plan.slots || []) {
      if (!slot.collection?.id || !slotActive(slot, now)) continue;
      const n = needed.get(slot.collection.id) || { title: slot.collection.title || '', products: new Set() };
      slot.items.filter((i) => !ex.has(i.variantId)).forEach((i) => n.products.add(i.productId));
      needed.set(slot.collection.id, n);
    }
  }
  const out = [];
  const cs = state.collState || {};
  for (const cid of new Set([...needed.keys(), ...Object.keys(cs)])) {
    const c = cs[cid] || { managed: [], preexisting: [] };
    const need = needed.get(cid)?.products || new Set();
    const remove = c.managed.filter((p) => !need.has(p));
    const check = [...need].filter((p) => !c.managed.includes(p) && !c.preexisting.includes(p));
    const prune = c.preexisting.some((p) => !need.has(p));
    if (remove.length || check.length || prune || (!need.size && cs[cid])) out.push({ collectionId: cid, title: needed.get(cid)?.title || c.title || '', remove, check, need: [...need] });
  }
  return out;
}

// ---------- 改价时顺便加减产品标签 ----------
// 计划上的 tagsAdd / tagsRemove:生效期间给参加的产品加上 / 去掉标签,结束自动还原。
// 用来驱动「按标签自动归类」的合集(FlashDeal、TOP DEALS 这类)。
// tagState[产品] = { added: [app 加的标签], removed: [app 去掉的、原来有的标签] }
// 返回每个要处理的产品:want = 现在应该有的(app 负责加),unwant = 现在应该没有的(app 负责去掉)
export function planTags(state, now) {
  const want = new Map(); // 产品 → Set(标签)
  const unwant = new Map();
  const put = (m, pid, tags) => { if (!m.has(pid)) m.set(pid, new Set()); tags.forEach((t) => m.get(pid).add(t)); };
  for (const plan of state.plans) {
    const add = (plan.tagsAdd || []).filter(Boolean), rm = (plan.tagsRemove || []).filter(Boolean);
    if (!isLive(plan) || (!add.length && !rm.length)) continue;
    const ex = new Set(plan.excluded || []);
    for (const slot of plan.slots || []) {
      // 永久调价:执行过就一直算数(它不恢复);限时:只在时段内
      if (plan.kind === 'window' ? !slotActive(slot, now) : slot.start == null || slot.start > now) continue;
      const pids = [...new Set(slot.items.filter((i) => !ex.has(i.variantId)).map((i) => i.productId))];
      for (const pid of pids) { put(want, pid, add); put(unwant, pid, rm); }
    }
  }
  const ts = state.tagState || {};
  const out = [];
  for (const pid of new Set([...want.keys(), ...unwant.keys(), ...Object.keys(ts)])) {
    const w = [...(want.get(pid) || [])], u = [...(unwant.get(pid) || [])];
    const st = ts[pid] || { added: [], removed: [] };
    // 不再需要的:app 加过但现在不该有 → 去掉;app 去掉过但现在不该去 → 加回来
    const undoAdd = st.added.filter((t) => !w.includes(t));
    const undoRemove = st.removed.filter((t) => !u.includes(t));
    const todoAdd = w.filter((t) => !st.added.includes(t));
    const todoRemove = u.filter((t) => !st.removed.includes(t));
    if (undoAdd.length || undoRemove.length || todoAdd.length || todoRemove.length) out.push({ productId: pid, want: w, unwant: u, undoAdd, undoRemove, todoAdd, todoRemove });
  }
  return out;
}

// ---------- 跟随活动时间 ----------
// 计划勾了「跟随活动时间」时,开始 / 结束用活动的。活动改了时间,改价跟着一起改(用户 2026-10-10 要求)。
// campaigns:[{ id, name, start, end }](网站更新中心的活动)。直接改 state,返回有变化的计划。
export function syncCampaignTimes(state, campaigns = []) {
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const changed = [];
  for (const plan of state.plans || []) {
    if (!plan.followCampaign || !plan.campaign?.id) continue;
    const c = byId.get(plan.campaign.id);
    if (!c || c.start == null) continue;
    const s = plan.slots?.[0]; if (!s) continue;
    const end = plan.kind === 'window' ? c.end ?? null : null;
    if (s.start === c.start && s.end === end) continue;
    changed.push({ plan, from: { start: s.start, end: s.end }, to: { start: c.start, end } });
    s.start = c.start; s.end = end;
    if (plan.campaign.name !== c.name) plan.campaign.name = c.name;
  }
  return changed;
}
