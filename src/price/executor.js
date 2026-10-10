// 改价执行器:每分钟对每个店铺跑一轮,把店里的价格对齐到「此刻应有的价格」。
// 一轮的顺序(别打乱):
//   1. 核对上一轮中断留下的「写前意图」(改成了就补记,没改成就清掉,对不上就暂停接管)
//   2. 巡检:正在接管的变体有没有被人手动改过(每 N 分钟一次)
//   3. 算这一轮要改的 → 读现价 → 定最终写什么 → 先存意图 → 写 Shopify → 读回核对 → 记账
//   4. 时段的「加入合集」:多了移出(只移 app 加的)、少了加入
//   5. 永久计划全部执行完 → 标记完成
// 规则都在 price-core.js;这里只管调用、读写 Shopify、存盘、记日志。
import { load, save, withLock, appendLedger, appendLog, listShops } from './store.js';
import { planWork, decide, commit, holdVariant, sweep, setIntent, clearIntent, recoverIntents, planCollections, planTags, finishPlans, samePair, pair } from './price-core.js';
import { realIO } from './shop-io.js';
import { getToken } from '../token-store.js';
import { reportMessages, deliver as realDeliver } from './notifier.js';
import { load as loadSchedule } from '../schedule-store.js';

export const INTERVAL_MS = 60_000;
const CONCURRENCY = 3;
const HOLD_CN = { manual: '有人手动改过价,暂停接管', 'not-lower': '原价已经不比活动价高,没有改' };

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export function runOnce(shop, { now = Date.now(), token = getToken(shop), io = realIO, deliver = realDeliver } = {}) {
  return withLock(shop, async () => {
    const state = load(shop);
    const ctx = { shop, token };
    const rep = { at: now, written: [], failures: [], holds: [], recovered: [], collections: [], tags: [], finished: [] };
    const planOf = (rec) => rec.asg?.plan || rec.perm?.plan || null;
    const planName = (id) => state.plans.find((p) => p.id === id)?.name || '';
    const brief = (rec, extra = {}) => {
      const vs = state.vault[rec.variantId];
      const pid = planOf(rec)?.id || vs?.written?.planId || vs?.hold?.planId || null;
      return { variantId: rec.variantId, productId: rec.productId, title: rec.title || vs?.title || '', sku: rec.sku ?? vs?.sku ?? '', op: rec.op, from: rec.from || null, to: rec.to || null, planId: pid, plan: planName(pid), ...extra };
    };
    const ledgerOf = (rec, note = '') => ({ at: now, ...brief(rec), note });

    try {
      if (!token) throw new Error('没有店铺授权(请在 Shopify 后台打开一次 app)');

      // 1. 上一轮中断留下的意图
      const intentIds = Object.keys(state.vault).filter((v) => state.vault[v].intent);
      if (intentIds.length) {
        const cur = await io.readVariants(ctx, intentIds);
        const pre = new Map(intentIds.map((v) => [v, state.vault[v]?.written?.planId || null])); // 核对前记下归属,恢复类的 commit 会删条目
        const r = recoverIntents(state, cur, now);
        appendLedger(state, r.committed.map((rec) => ({ ...ledgerOf(rec, '上轮中断后核对:已生效'), ...(!planOf(rec) && pre.get(rec.variantId) ? { planId: pre.get(rec.variantId), plan: planName(pre.get(rec.variantId)) } : {}) })));
        rep.recovered = r.committed.map((rec) => brief(rec));
        rep.holds.push(...r.holds.map((h) => brief(h, { reason: h.reason, seen: h.seen })));
        save(shop, state);
      }

      // 2. 巡检
      const sweepMs = (Number(state.settings.sweepMinutes) || 5) * 60_000;
      if (!state.engine.lastSweep || now - state.engine.lastSweep >= sweepMs) {
        const ids = Object.keys(state.vault).filter((v) => state.vault[v].written && !state.vault[v].hold);
        if (ids.length) {
          const cur = await io.readVariants(ctx, ids);
          for (const h of sweep(state, cur)) { holdVariant(state, h, now); rep.holds.push(brief(h, { reason: h.reason, seen: h.seen })); }
        }
        state.engine.lastSweep = now;
      }

      // 3. 改价
      const ops = planWork(state, now);
      if (ops.length) {
        const cur = await io.readVariants(ctx, ops.map((o) => o.variantId));
        const meta = (v) => ({ title: cur.get(v)?.title || '', sku: cur.get(v)?.sku || '' });
        const { writes, holds, done, missing } = decide(state, ops, cur);
        for (const d of done) commit(state, d, now, meta(d.variantId));
        for (const h of holds) { holdVariant(state, h, now, meta(h.variantId)); rep.holds.push(brief({ ...h, ...meta(h.variantId) }, { reason: h.reason, seen: h.seen })); }
        for (const m of missing) {
          // 变体被删了:正在接管的直接放掉(没法恢复了),其余从计划里移出,免得每分钟报一次
          const p = planOf(m);
          if (state.vault[m.variantId]?.written) delete state.vault[m.variantId];
          else if (p && m.op === 'permanent') { p.applied ||= {}; p.applied[m.variantId] = now; }
          else if (p) p.excluded = [...new Set([...(p.excluded || []), m.variantId])];
          rep.failures.push(brief(m, { message: '这个变体在店里已经被删除,已移出计划' }));
        }

        if (writes.length) {
          for (const w of writes) setIntent(state, w, now);
          save(shop, state); // 写前存盘:就算下面改到一半进程挂了,下一轮也能核对

          const byProduct = new Map();
          for (const w of writes) { if (!byProduct.has(w.productId)) byProduct.set(w.productId, []); byProduct.get(w.productId).push(w); }
          // errs = Shopify 明确拒绝(肯定没改);unknown = 网络异常等,不知道改没改 → 不下结论,靠下面读回判断
          const errs = new Map(), unknown = new Map();
          await pool([...byProduct], CONCURRENCY, async ([pid, ws]) => {
            try {
              const e = await io.writeProductVariants(ctx, pid, ws.map((w) => ({ id: w.variantId, ...w.to })));
              e.forEach((msg, v) => errs.set(v, msg));
            } catch (e) { ws.forEach((w) => unknown.set(w.variantId, String(e.message || e))); }
          });

          // 读回核对:店里真的是目标价才算数(读回本身失败 → 意图留着,下一轮开头核对)
          const okIds = writes.filter((w) => !errs.has(w.variantId)).map((w) => w.variantId);
          const back = okIds.length ? await io.readVariants(ctx, okIds) : new Map();
          const entries = [];
          for (const w of writes) {
            const m = meta(w.variantId);
            const b = back.get(w.variantId);
            if (errs.has(w.variantId)) { clearIntent(state, w.variantId); rep.failures.push(brief({ ...w, ...m }, { message: errs.get(w.variantId) })); }
            else if (b && samePair(b, w.to)) {
              // 先记账再 commit(恢复原价时 commit 会删掉保险库条目,之后就查不到是哪个计划了)
              entries.push(ledgerOf({ ...w, ...m })); rep.written.push(brief({ ...w, ...m }));
              commit(state, w, now, m);
            }
            else if (b && samePair(b, w.from)) { clearIntent(state, w.variantId); rep.failures.push(brief({ ...w, ...m }, { message: unknown.get(w.variantId) || 'Shopify 说改了,但读回来还是原来的价格,下一轮重试' })); }
            else {
              clearIntent(state, w.variantId);
              const h = { ...w, reason: 'manual', seen: b ? pair(b.price, b.compareAt) : null, expected: w.to };
              holdVariant(state, h, now, m); rep.holds.push(brief({ ...h, ...m }, { reason: 'manual', seen: h.seen }));
            }
          }
          appendLedger(state, entries);
        }
      }

      // 4. 合集
      for (const c of planCollections(state, now)) {
        const cs = state.collState[c.collectionId] ||= { title: c.title, managed: [], preexisting: [] };
        cs.title = c.title || cs.title;
        try {
          // 上一轮加入合集没确认完(中断或报错):以店里实际为准 —— 当时确认过不在合集里,现在在的就是 app 加的
          if (cs.pendingAdd) {
            const inside = await io.productsInCollection(ctx, c.collectionId, cs.pendingAdd);
            cs.managed = [...new Set([...cs.managed, ...cs.pendingAdd.filter((p) => inside.has(p))])];
            delete cs.pendingAdd;
          }
          const remove = cs.managed.filter((p) => !c.need.includes(p));
          if (remove.length) { await io.removeFromCollection(ctx, c.collectionId, remove); cs.managed = cs.managed.filter((p) => !remove.includes(p)); }
          cs.preexisting = cs.preexisting.filter((p) => c.need.includes(p));
          const check = c.need.filter((p) => !cs.managed.includes(p) && !cs.preexisting.includes(p));
          let added = 0;
          if (check.length) {
            const inside = await io.productsInCollection(ctx, c.collectionId, check);
            cs.preexisting.push(...check.filter((p) => inside.has(p)));
            const toAdd = check.filter((p) => !inside.has(p));
            if (toAdd.length) {
              cs.pendingAdd = toAdd; save(shop, state);
              await io.addToCollection(ctx, c.collectionId, toAdd);
              cs.managed.push(...toAdd); delete cs.pendingAdd; added = toAdd.length;
            }
          }
          if (added || remove.length) rep.collections.push({ collectionId: c.collectionId, title: cs.title, added, removed: remove.length });
          if (!c.need.length && !cs.managed.length) delete state.collState[c.collectionId];
        } catch (e) {
          rep.failures.push({ collection: cs.title || c.collectionId, message: String(e.message || e) });
        }
      }

      // 4b. 产品标签(改价时顺便加减,结束还原;只动计划里填的那几个标签)
      const tagOps = planTags(state, now);
      if (tagOps.length) {
        state.tagState ||= {};
        const cur = await io.readProductTags(ctx, tagOps.map((o) => o.productId));
        for (const o of tagOps) {
          const has = cur.get(o.productId); if (!has) continue; // 产品没了
          const st = state.tagState[o.productId] ||= { added: [], removed: [] };
          try {
            // 要加的:app 还没加过的,而且产品本来就没有(本来就有的不记账,结束时也不去掉)
            const add = [...o.todoAdd.filter((t) => !has.includes(t)), ...o.undoRemove.filter((t) => !has.includes(t))];
            const del = [...o.todoRemove.filter((t) => has.includes(t)), ...o.undoAdd.filter((t) => has.includes(t))];
            if (add.length) await io.addTags(ctx, o.productId, add);
            if (del.length) await io.removeTags(ctx, o.productId, del);
            st.added = [...new Set([...st.added, ...o.todoAdd.filter((t) => !has.includes(t))])].filter((t) => o.want.includes(t));
            st.removed = [...new Set([...st.removed, ...o.todoRemove.filter((t) => has.includes(t))])].filter((t) => o.unwant.includes(t));
            if (add.length || del.length) rep.tags.push({ productId: o.productId, added: add, removed: del });
            if (!st.added.length && !st.removed.length) delete state.tagState[o.productId];
          } catch (e) { rep.failures.push({ productId: o.productId, message: String(e.message || e) }); }
        }
      }

      // 5. 永久计划
      rep.finished = finishPlans(state, now).map((p) => ({ planId: p.id, plan: p.name }));
    } catch (e) {
      rep.failures.push({ message: String(e.message || e) });
    } finally {
      writeLogs(state, rep, now);
      state.engine = { ...state.engine, lastRun: now, lastError: rep.failures[0]?.message || null, lastWrites: rep.written.length };
      let msgs = [];
      try { msgs = reportMessages(state, rep, { appUrl: state.appUrl, now, members: loadSchedule(shop).members || [] }); } catch (e) { console.error('[notify]', e); }
      save(shop, state); // 去重记录(notified)也在这里一起存
      if (msgs.length) deliver(state, msgs).catch((e) => console.error('[lark]', e.message)); // 发飞书不挡执行器
    }
    return rep;
  });
}

const OP_CN = { start: '开始活动价', switch: '换到另一个时段的价', restore: '恢复原价', permanent: '永久调价' };

// 把这一轮的结果按计划汇总进操作日志(不逐个变体刷屏,明细在价格账本里)
function writeLogs(state, rep, now) {
  const groups = new Map();
  for (const w of rep.written) {
    const k = `${w.planId}|${w.op}`;
    if (!groups.has(k)) groups.set(k, { ...w, n: 0 });
    groups.get(k).n++;
  }
  for (const g of groups.values()) appendLog(state, { at: now, action: g.op, planId: g.planId, plan: g.plan, note: `${OP_CN[g.op] || g.op}:${g.n} 个变体`, by: '执行器' });
  if (rep.recovered.length) appendLog(state, { at: now, action: 'recover', plan: '', note: `上轮中断后核对:${rep.recovered.length} 个变体已生效,已补记`, by: '执行器' });
  for (const h of rep.holds) appendLog(state, { at: now, action: 'hold', planId: h.planId, plan: h.plan, note: `${h.title || h.variantId}:${HOLD_CN[h.reason] || h.reason}${h.seen ? `(店里现价 £${h.seen.price})` : ''}`, by: '执行器' });
  for (const c of rep.collections) appendLog(state, { at: now, action: 'collection', plan: '', note: `合集「${c.title}」:加入 ${c.added} 个、移出 ${c.removed} 个产品`, by: '执行器' });
  if (rep.tags.length) {
    const a = rep.tags.reduce((n, t) => n + t.added.length, 0), d = rep.tags.reduce((n, t) => n + t.removed.length, 0);
    appendLog(state, { at: now, action: 'tag', plan: '', note: `产品标签:${rep.tags.length} 个产品${a ? `,加了 ${a} 个标签` : ''}${d ? `,去掉 ${d} 个标签` : ''}`, by: '执行器' });
  }
  for (const f of rep.failures.slice(0, 20)) appendLog(state, { at: now, action: 'failure', planId: f.planId || null, plan: f.plan || '', note: `${f.title || f.collection || ''}${f.title || f.collection ? ':' : ''}${f.message}`, by: '执行器' });
  if (rep.failures.length > 20) appendLog(state, { at: now, action: 'failure', plan: '', note: `另有 ${rep.failures.length - 20} 条失败,下一轮自动重试`, by: '执行器' });
  for (const f of rep.finished) appendLog(state, { at: now, action: 'done', planId: f.planId, plan: f.plan, note: '永久调价全部执行完成', by: '执行器' });
}

let timer = null;
let running = false;
export function startExecutor({ intervalMs = INTERVAL_MS } = {}) {
  if (timer || process.env.EXECUTOR_DISABLED === '1' || process.env.SCHEDULER_DISABLED === '1') return;
  const tick = async () => {
    if (running) return; // 上一轮没跑完就跳过,不叠加
    running = true;
    try {
      for (const shop of listShops()) {
        const r = await runOnce(shop).catch((e) => ({ written: [], failures: [{ message: String(e.message || e) }] }));
        if (r.written.length || r.failures.length) console.log(`[改价执行器] ${shop} 改价 ${r.written.length} 个,失败 ${r.failures.length} 个`);
      }
    } finally { running = false; }
  };
  timer = setInterval(tick, intervalMs);
  setTimeout(tick, 5000); // 启动后先补跑一轮(停机期间错过的在这里补上)
  console.log(`[改价执行器] 已启动,每 ${intervalMs / 1000} 秒对齐一次`);
}
