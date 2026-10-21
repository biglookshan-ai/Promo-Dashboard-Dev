// 合集页「平时」的默认排序(自研搜索引擎合集页 Featured 规则)—— 浏览器和服务器共用(/lib/col-sort.js)。
// 主题读合集字段(namespace custom,见主题 snippets/cgp-search-head.liquid、templates/collection.cgp-json.liquid):
//   cgp_sort_off = true → 完全按 Shopify 合集自己的排序方式(手动 / 畅销 / 最新…)
//   cgp_pin_manual = N  → 前 N 个照合集顺序,其余按新到旧(没设 = 12;0 = 全部按新到旧)
//   cgp_pin_new = N     → 最前面先放最新 N 个(一般不用,没设 = 0;这里只显示、不改)
// 生效中的置顶清单永远优先;顾客自己选了别的 Sort by 也照常。
// 三种方式:top = 前 N 个按手动顺序,其余按新到旧(默认 12) / manual = 完全按手动顺序 / shopify = 完全按 Shopify 的自动排序
export const DEFAULT_N = 12;
export const MAX_N = 250;
export const SORT_CN = { MANUAL: '手动', BEST_SELLING: '最畅销', CREATED_DESC: '最新上架', CREATED: '最早上架', PRICE_ASC: '价格从低到高', PRICE_DESC: '价格从高到低', ALPHA_ASC: '字母 A–Z', ALPHA_DESC: '字母 Z–A' };
export const AUTO_SORTS = ['BEST_SELLING', 'CREATED_DESC', 'CREATED', 'PRICE_ASC', 'PRICE_DESC', 'ALPHA_ASC', 'ALPHA_DESC'];
export const sortCn = (s) => SORT_CN[s] || s || '未知';

// c = { sortOrder, off, offSet(字段存在), pinManual(null = 没设), pinNew }
export function modeOf(c) {
  const n = c.pinManual ?? DEFAULT_N;
  if (c.off) return { mode: c.sortOrder === 'MANUAL' ? 'manual' : 'shopify', n, sortOrder: c.sortOrder };
  return { mode: 'top', n, sortOrder: c.sortOrder };
}
// 没单独设过(和全站默认一样)
export const isDefault = (c) => !c.off && (c.pinManual == null || c.pinManual === DEFAULT_N) && !(c.pinNew > 0);

// 顾客在合集页默认看到的顺序,一句话
export function describe(c) {
  const m = modeOf(c);
  const by = !c.sortOrder || c.sortOrder === 'MANUAL' ? '手动顺序' : `「${sortCn(c.sortOrder)}」`;
  if (m.mode === 'manual') return '完全按手动顺序';
  if (m.mode === 'shopify') return `完全按${by}`;
  if (m.n <= 0) return '全部按新到旧';
  return `${c.pinNew > 0 ? `最新 ${c.pinNew} 个放最前,再` : ''}前 ${m.n} 个按${by},其余按新到旧`;
}

// 要改哪些:cur = 现在的样子,want = { mode, n, sortOrder, toManual }
// 返回 { ops: { off: true | null(删掉) | undefined(不动), n: 数字 | null(删掉) | undefined, sortOrder: 'X' | null(不动) }, after }
export function planSort(cur, want) {
  const mode = want?.mode;
  if (!['top', 'manual', 'shopify'].includes(mode)) throw new Error('请选一种排序方式');
  const ops = { off: undefined, n: undefined, sortOrder: null };
  if (mode === 'top') {
    const n = Number(want.n);
    if (!Number.isInteger(n) || n < 0 || n > MAX_N) throw new Error(`前几个要填 0–${MAX_N} 的整数`);
    if (cur.offSet || cur.off) ops.off = null;
    if (n === DEFAULT_N) { if (cur.pinManual != null) ops.n = null; } else if (cur.pinManual !== n) ops.n = n;
    if (want.toManual && cur.sortOrder !== 'MANUAL') ops.sortOrder = 'MANUAL';
  } else {
    if (!cur.off) ops.off = true;
    const so = mode === 'manual' ? 'MANUAL' : want.sortOrder;
    if (mode === 'shopify' && !AUTO_SORTS.includes(so)) throw new Error('请选 Shopify 的排序方式(畅销 / 最新 / 价格…)');
    if (so !== cur.sortOrder) ops.sortOrder = so;
  }
  const after = {
    sortOrder: ops.sortOrder || cur.sortOrder,
    off: ops.off === undefined ? !!cur.off : ops.off === true,
    pinManual: ops.n === undefined ? cur.pinManual ?? null : ops.n,
    pinNew: cur.pinNew || 0,
  };
  const changed = ops.off !== undefined || ops.n !== undefined || !!ops.sortOrder;
  return { ops, after, changed };
}
