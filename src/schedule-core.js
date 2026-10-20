// 排期的核心判断(纯函数,前端 public/schedule.js 的 status()/win() 是同一套规则,改一处要同步另一处)。
//
// 条目(item)字段:
//   kind: 'banner' | 'topbar' | 'tbstyle' | 'campaign'
//   state: 'draft' | 'pending' | 'rejected' | 'approved'   —— 只有 approved 的才可能上线
//   paused: boolean                                          —— 审核人手动暂停,立即下线
//   start / end: 毫秒时间戳或 null(null = 不限)
//   campaign: 活动 id 或 null                               —— 自己没设时间且挂了活动 → 跟随活动的时间
//   isDefault: 顶栏默认样式,永远生效(不参与上下线)

export const ENDING_SOON_MS = 3 * 86400000; // 下架前 3 天提醒

// 有效时间窗:自己设了时间用自己的;没设且挂了活动 → 继承活动;都没设 = 长期
export function effectiveWindow(item, campaignsById) {
  if (item.kind !== 'campaign' && item.campaign && item.start == null && item.end == null) {
    const c = campaignsById.get(item.campaign);
    if (c) return { start: c.start ?? null, end: c.end ?? null, via: c };
  }
  return { start: item.start ?? null, end: item.end ?? null, via: null };
}

export function itemStatus(item, campaignsById, t = Date.now()) {
  if (item.state === 'draft' || item.state === 'new') return 'draft';
  if (item.state === 'pending') return 'pending';
  if (item.state === 'rejected') return 'rejected';
  if (item.paused) return 'paused';
  const w = effectiveWindow(item, campaignsById);
  if (w.via && w.via.paused) return 'paused';
  if (w.via && w.via.state !== 'approved') return 'waiting';
  if (w.start != null && t < w.start) return 'scheduled';
  if (w.end != null && t >= w.end) return 'ended';
  return 'live';
}

// Shopify 上这条 metaobject 应该是什么状态:只有「此刻上线中」的是 ACTIVE,其余一律 DRAFT(前台看不到)。
// 顶栏默认样式永远 ACTIVE。
// 促销链接设了「结束后去哪」(跳回合集 / 跳到指定链接):结束后也保持 ACTIVE,主题按 ends_at 判断已结束,打开就跳走。
export function desiredPublishStatus(item, campaignsById, t = Date.now()) {
  if (item.isDefault && item.state === 'approved') return 'ACTIVE';
  const s = itemStatus(item, campaignsById, t);
  if (s === 'ended' && item.kind === 'salelink' && item.state === 'approved' && ['collection', 'url'].includes(item.afterEnd)) return 'ACTIVE';
  return s === 'live' ? 'ACTIVE' : 'DRAFT';
}

export function isEndingSoon(item, campaignsById, t = Date.now()) {
  if (itemStatus(item, campaignsById, t) !== 'live') return false;
  const { end } = effectiveWindow(item, campaignsById);
  return end != null && end - t <= ENDING_SOON_MS;
}

export const campaignIndex = (campaigns = []) => new Map(campaigns.map((c) => [c.id, c]));

// ---- 主活动 / 子活动(2026-10-20 用户:多个活动同时跑,比如 Black Friday 下面有 DZO / Thypoch 的 Early BF)----
// 活动可以选「属于哪个主活动」(只有一层:主活动不能再挂到别的下面)。
// 实际优先级(写进店里给主题比徽章用):主活动 / 独立活动 = 自己填的数字;
//   子活动 = 主活动 + 1000 + 在兄弟里的名次(按自己填的数字从小到大、一样就按开始时间从早到晚,越靠后越优先)
//   → 同一个产品同时在主活动和子活动里,总是显示子活动的徽章,不用手填数字;子活动之间默认开始晚的优先。
export const CHILD_BOOST = 1000;
export const parentOf = (c, campaigns = []) => (c?.parent ? campaigns.find((x) => x.id === c.parent && !x.parent) || null : null);
export const childrenOf = (id, campaigns = []) => campaigns.filter((x) => x.parent === id);
export function effPriority(c, campaigns = []) {
  const p = parentOf(c, campaigns);
  if (!p) return Number(c?.priority) || 0;
  const sibs = childrenOf(p.id, campaigns)
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || (a.start ?? 0) - (b.start ?? 0) || String(a.id).localeCompare(String(b.id)));
  return (Number(p.priority) || 0) + CHILD_BOOST + sibs.findIndex((x) => x.id === c.id) + 1;
}
// 首页商品模块的页签可以「只在某个活动期间显示」:那个活动此刻上线中才显示(和主题同一套:活动下线 = 店里是草稿,页签藏起来)
export function tabVisible(tab, campaignsById, t = Date.now()) {
  if (!tab?.campaign) return true;
  const c = campaignsById.get(tab.campaign);
  return !!c && itemStatus(c, campaignsById, t) === 'live';
}
