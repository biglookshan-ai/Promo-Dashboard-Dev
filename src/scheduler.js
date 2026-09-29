// 定时器:每分钟检查一次,把 Shopify 上每条内容的上下线状态对齐到「此刻应该的状态」。
//   - 只动已批准、并且已经写进 Shopify(有 shopifyId)的条目
//   - 按当前时间算应有状态,而不是「到点触发」—— 服务器停过一阵,恢复后第一次运行就会自动补上
//   - 每次真的切换都记操作日志;失败记下来(阶段 1c 接飞书通知)
import { load, update, listShops, appendLog, allItems } from './schedule-store.js';
import { desiredPublishStatus, campaignIndex } from './schedule-core.js';
import { setPublishStatus as realSetStatus } from './metaobjects.js';
import { getToken } from './token-store.js';

export const INTERVAL_MS = 60_000;

const TITLE = (it) => it.title || it.text || it.name || it.id;

// 跑一个店铺一轮。依赖都可以注入,方便测试。
export async function runOnce(shop, { now = Date.now(), token = getToken(shop), setStatus = realSetStatus } = {}) {
  const state = load(shop);
  const camps = campaignIndex(state.items.campaign);
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
        changes.push({ kind: it.kind, id: it.id, title: TITLE(it), to: want });
      } catch (e) {
        failures.push({ kind: it.kind, id: it.id, title: TITLE(it), message: String(e.message || e) });
      }
    }
  }

  update(shop, (s) => {
    for (const c of changes) {
      const it = s.items[c.kind]?.find((x) => x.id === c.id);
      if (it) { it.syncedStatus = c.to; it.syncedAt = now; }
      appendLog(s, { action: c.to === 'ACTIVE' ? 'up' : 'down', kind: c.kind, title: c.title, note: '定时器自动' + (c.to === 'ACTIVE' ? '上线' : '下线'), by: '定时器' });
    }
    for (const f of failures) appendLog(s, { action: 'failure', kind: f.kind || 'system', title: f.title || '定时器', note: f.message, by: '定时器' });
    s.scheduler = { lastRun: now, lastError: failures[0]?.message || null, lastChanges: changes.length };
  });
  return { changes, failures };
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
