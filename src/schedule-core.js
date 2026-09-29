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
export function desiredPublishStatus(item, campaignsById, t = Date.now()) {
  if (item.isDefault && item.state === 'approved') return 'ACTIVE';
  return itemStatus(item, campaignsById, t) === 'live' ? 'ACTIVE' : 'DRAFT';
}

export function isEndingSoon(item, campaignsById, t = Date.now()) {
  if (itemStatus(item, campaignsById, t) !== 'live') return false;
  const { end } = effectiveWindow(item, campaignsById);
  return end != null && end - t <= ENDING_SOON_MS;
}

export const campaignIndex = (campaigns = []) => new Map(campaigns.map((c) => [c.id, c]));
