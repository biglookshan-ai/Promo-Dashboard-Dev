// 定时器:每分钟检查一次,把 Shopify 上每条内容的上下线状态对齐到「此刻应该的状态」。
//   - 只动已批准、并且已经写进 Shopify(有 shopifyId)的条目
//   - 按当前时间算应有状态,而不是「到点触发」—— 服务器停过一阵,恢复后第一次运行就会自动补上
//   - 每次真的切换都记操作日志;失败记下来,下一轮自动重试
//   - 顺便发飞书:上下线、失败、到点还没批准;每天 10:00(英国时间)发一次汇总
import { load, replace, listShops, appendLog, allItems } from './schedule-store.js';
import { desiredPublishStatus, campaignIndex } from './schedule-core.js';
import { titleOf } from './schedule-actions.js';
import { setPublishStatus as realSetStatus } from './metaobjects.js';
import { getToken } from './token-store.js';
import { withLock } from './sync.js';
import { schedulerMessages, digestMessages, deliver, schedulerDMs, deliverDMs } from './notifier.js';
import { alignCollections } from './collection-order.js';
import { historyRecorder } from './col-history.js';
import { graphql } from './shopify.js';

export const INTERVAL_MS = 60_000;

// 合集排序一轮的结果写进操作日志(定时器、保存后自动执行共用)
export function logColReport(state, col, by, now = Date.now()) {
  for (const a of col.applied) appendLog(state, { at: now, action: 'up', kind: 'pin', title: a.title, by,
    note: `按「${a.pin}」排了店里的合集:${a.moved} 个产品换位置${a.added ? `、${a.added} 个加进合集` : ''}${a.removed ? `、${a.removed} 个临时移出` : ''}${a.back ? `、${a.back} 个加回来` : ''}` });
  for (const r of col.restored) appendLog(state, { at: now, action: 'down', kind: 'pin', title: r.title, by,
    note: `「${r.pin}」结束,合集顺序已还原${r.added ? `(${r.added} 个产品加回合集)` : ''}` });
  for (const h of col.holds) if (h.fresh) appendLog(state, { at: now, action: 'failure', kind: 'pin', title: h.title, by,
    note: '有人在 Shopify 后台手动改过这个合集的顺序 —— 已暂停接管,不覆盖别人的改动' });
  for (const f of col.failures) appendLog(state, { at: now, action: 'failure', kind: 'pin', title: f.collection || '合集排序', note: f.message, by });
  for (const x of col.sortOn || []) appendLog(state, { at: now, action: 'up', kind: 'pin', title: x.title, by,
    note: `「${x.pin}」生效:合集页改成完全按清单顺序显示(不套「手动前 12 个 + 其余新到旧」)${x.already ? ',原来就是这样' : ''}` });
  for (const x of col.sortOff || []) appendLog(state, { at: now, action: 'down', kind: 'pin', title: x.title, by,
    note: `「${x.pin}」结束:合集页的排序方式恢复成原来的设置` });
}

// 跑一个店铺一轮。依赖都可以注入,方便测试。
export function runOnce(shop, { now = Date.now(), token = getToken(shop), setStatus = realSetStatus, send, sendDm, gql = graphql, collections = alignCollections } = {}) {
  return withLock(shop, async () => {
    const state = load(shop);
    const camps = campaignIndex(state.campaigns);
    const todo = allItems(state)
      .filter((it) => it.state === 'approved' && it.shopifyId)
      .map((it) => ({ it, want: desiredPublishStatus(it, camps, now) }))
      .filter(({ it, want }) => it.syncedStatus !== want);

    const changes = [], failures = [];
    if (todo.length && !token) failures.push({ id: null, message: '没有店铺授权(请在 Shopify 后台打开一次 app)' });
    else {
      for (const { it, want } of todo) {
        try {
          await setStatus({ shop, token }, it.shopifyId, want);
          it.syncedStatus = want; it.syncedAt = now; it.syncError = null;
          changes.push({ kind: it.kind, id: it.id, title: titleOf(it), to: want });
        } catch (e) {
          it.syncError = String(e.message || e);
          failures.push({ kind: it.kind, id: it.id, title: titleOf(it), message: it.syncError });
        }
      }
    }
    for (const c of changes) appendLog(state, { at: now, action: c.to === 'ACTIVE' ? 'up' : 'down', kind: c.kind, title: c.title, note: '定时器自动' + (c.to === 'ACTIVE' ? '上线' : '下线'), by: '定时器' });
    for (const f of failures) appendLog(state, { at: now, action: 'failure', kind: f.kind || 'system', title: f.title || '定时器', note: f.message, by: '定时器' });
    state.scheduler = { lastRun: now, lastError: failures[0]?.message || null, lastChanges: changes.length };

    // 合集排序:把手动合集真的对齐到「这一刻该有的顺序」(自动归类的合集跳过,由主题前台排)
    let col = { applied: [], restored: [], holds: [], failures: [], skipped: [] };
    if (token && collections) {
      const record = historyRecorder(shop);
      try { col = await collections({ shop, token }, state, { now, gql, record }); }
      catch (e) { col.failures.push({ message: String(e.message || e) }); }
      record.flush();
      logColReport(state, col, '定时器', now);
    }

    const opts = { appUrl: state.appUrl || '', now };
    const msgs = [...schedulerMessages(state, { changes, failures }, opts), ...digestMessages(state, opts)];
    await deliver(state, msgs, { send, now });
    await deliverDMs(state, schedulerDMs(state, { changes }, opts), { send: sendDm, now }); // 私信:负责人 / 审批人
    replace(shop, state);
    return { changes, failures, collections: col };
  });
}

let timer = null;
let running = false;
export function startScheduler({ intervalMs = INTERVAL_MS } = {}) {
  if (timer || process.env.SCHEDULER_DISABLED === '1') return;
  const tick = async () => {
    if (running) return; // 上一轮还没跑完就跳过,不叠加
    running = true;
    try {
      for (const shop of listShops()) {
        const r = await runOnce(shop).catch((e) => ({ changes: [], failures: [{ message: String(e.message || e) }] }));
        if (r.changes.length || r.failures.length) console.log(`[scheduler] ${shop} 切换 ${r.changes.length} 条,失败 ${r.failures.length} 条`);
      }
    } finally { running = false; }
  };
  timer = setInterval(tick, intervalMs);
  setTimeout(tick, 5000); // 启动后先补跑一次(宕机期间错过的切换在这里补上)
  console.log(`[scheduler] 已启动,每 ${intervalMs / 1000} 秒检查一次`);
}
export const schedulerInfo = (shop) => ({ running: !!timer, intervalSec: INTERVAL_MS / 1000, ...load(shop).scheduler });
