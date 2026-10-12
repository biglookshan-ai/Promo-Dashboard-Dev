// 合集顺序的「对比 / 压缩」规则 —— 纯函数,服务器和浏览器共用一份(页面经 /lib/order-diff.js 引入)。
//
//   baseline = 原来的顺序(第一次接管前的快照;没接管过就是合集现在的顺序)
//   desired  = 你在网格里排出来的完整顺序(不含「这段时间不显示」的)
//
// 存的时候不存整串顺序,只存「最短的前缀」:前缀里的产品按顺序排最前,其余照原来的顺序跟在后面,
// 就能还原出一模一样的完整顺序。把第 50 个拖到第 20 位,只要存前 20 个;把第 200 个拖到第 1,只要存 1 个。
export const nid = (x) => String(x ?? '').split('/').pop();

// 前缀 + 其余照原顺序 → 完整顺序(hidden 里的不出现;onlyListed = 只要前缀)
export function expandOrder(baselineIds, prefixIds, { hidden = [], onlyListed = false } = {}) {
  const hide = new Set(hidden.map(nid));
  const head = []; const used = new Set();
  for (const id of prefixIds.map(nid)) if (!hide.has(id) && !used.has(id)) { head.push(id); used.add(id); }
  if (onlyListed) return head;
  const tail = baselineIds.map(nid).filter((id) => !used.has(id) && !hide.has(id));
  return [...head, ...tail];
}

// 完整顺序 → 最短前缀(满足 expandOrder(baseline, 前缀, 隐藏) === desired)
export function minimalPrefix(baselineIds, desiredIds) {
  const D = desiredIds.map(nid);
  const inD = new Set(D);
  const B = baselineIds.map(nid).filter((id) => inD.has(id)); // 原顺序里、最后还在的
  // 从后往前找:D 的最长后缀,恰好等于「B 去掉前面那些之后的顺序」的结尾
  // 做法:k 从 0 往上试,维护「B 去掉 D[0..k) 之后」的序列,和 D[k..] 比对
  const removed = new Set();
  for (let k = 0; k <= D.length; k++) {
    if (k > 0) removed.add(D[k - 1]);
    // 比对 B∖removed 和 D[k..]
    let i = 0; let j = k; let ok = true;
    while (i < B.length || j < D.length) {
      while (i < B.length && removed.has(B[i])) i++;
      if (i >= B.length || j >= D.length) { ok = i >= B.length && j >= D.length; break; }
      if (B[i] !== D[j]) { ok = false; break; }
      i++; j++;
    }
    if (ok) return D.slice(0, k);
  }
  return D;
}

// 对比:哪些是新加的、哪些换了位置、哪些拿掉了 —— 换位置只算「真的被拖动过的」
// (把第 50 拖到第 20,中间 30 个被挤下去一格的不算换位置,只有那 1 个算)
export function diffOrder(baselineIds, desiredIds) {
  const B = baselineIds.map(nid); const D = desiredIds.map(nid);
  const posB = new Map(B.map((id, i) => [id, i]));
  const inD = new Set(D);
  const added = new Set(D.filter((id) => !posB.has(id)));
  const removed = B.filter((id) => !inD.has(id));
  // 两边都有的,按 D 的顺序取原来的位置,求最长递增子序列 —— 在里面的就是「相对顺序没变」
  const seq = D.filter((id) => posB.has(id));
  const vals = seq.map((id) => posB.get(id));
  const tails = []; const tailIdx = []; const prev = new Array(vals.length).fill(-1);
  vals.forEach((v, i) => {
    let lo = 0; let hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < v) lo = m + 1; else hi = m; }
    tails[lo] = v; tailIdx[lo] = i; prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  const keep = new Set();
  for (let i = tailIdx[tails.length - 1] ?? -1; i !== -1; i = prev[i]) keep.add(seq[i]);
  const moved = new Set(seq.filter((id) => !keep.has(id)));
  return { added, moved, removed, origPos: posB };
}

// 一句话总结(历史版本列表用)
export function diffSummary(d) {
  const parts = [];
  if (d.added.size) parts.push(`新加 ${d.added.size}`);
  if (d.moved.size) parts.push(`换位置 ${d.moved.size}`);
  if (d.removed.length) parts.push(`拿掉 ${d.removed.length}`);
  return parts.join(' · ') || '顺序没变';
}
