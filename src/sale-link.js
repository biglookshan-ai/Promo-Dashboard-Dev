// 促销链接(合集 ?onsale=<后缀>)的规则 —— 和主题 assets/cgp-search-app.js 的 SALE 一模一样,改一边要同步另一边。
// 纯函数,服务器和浏览器共用(浏览器通过 /lib/sale-link.js 加载),编辑器右边的预览就是用它算的。
//
// 链接的设置(app 里的一条 salelink):
//   slug 后缀 · collection 合集 · inStock 只显示有货 · minDiscount 最低折扣 % · products 置顶(按顺序)
//   · limit 最多几个(空 / 0 = 不限)· sort 排序 · heading 页面上的标题
// 前台的产品数据来自主题的 cgp-json(每个产品:id、discount 折扣最大的变体的 %、status instock / preorder / oos、created、price)。

export const SALE_SORTS = [
  ['', '和合集平时一样'], ['discount', '折扣从大到小'], ['newest', '最新上架在前'], ['price-asc', '价格从低到高'], ['price-desc', '价格从高到低'],
];
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const slugOf = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const nid = (id) => Number(String(id ?? '').split('/').pop()) || 0;

// 一个产品能不能出现在这条链接里(不算「最多几个」)。为什么不行也说出来,编辑器提示用
export function whyOut(p, link = {}) {
  if (!(p.discount > 0)) return '没打折';
  if (link.minDiscount && p.discount < link.minDiscount) return `折扣不到 ${link.minDiscount}%`;
  if (link.inStock && p.status !== 'instock') return p.status === 'preorder' ? '预订(不算有货)' : '没货';
  return '';
}

// 合集「平时的顺序」(搜索引擎合集页的 Featured):生效中的置顶清单排最前,其余按合集的排序规则
// (默认手动前 12 个 + 其余新到旧;sortRule.off = 完全按合集后台的顺序)。list 是合集后台的顺序。
export function featuredOrder(list, { sortRule = null, pinIds = [] } = {}) {
  const byId = new Map(list.map((p) => [nid(p.id), p]));
  const head = []; const used = new Set();
  for (const id of pinIds.map(nid)) if (byId.has(id) && !used.has(id)) { head.push(byId.get(id)); used.add(id); }
  const rest = list.filter((p) => !used.has(nid(p.id)));
  if (!sortRule || sortRule.off) return [...head, ...rest];
  const N = Math.max(0, sortRule.pinNew | 0), M = Math.max(0, sortRule.pinManual ?? 12);
  const byNew = [...rest].sort((a, b) => (+b.created || 0) - (+a.created || 0));
  if (!N && !M) return [...head, ...byNew];
  const out = []; const u = new Set();
  for (const p of byNew.slice(0, N)) { out.push(p); u.add(p); }
  let added = 0;
  for (const p of rest) { if (added >= M) break; if (!u.has(p)) { out.push(p); u.add(p); added++; } }
  for (const p of byNew) if (!u.has(p)) out.push(p);
  return [...head, ...out];
}

const BY = {
  discount: (a, b) => (b.discount || 0) - (a.discount || 0),
  newest: (a, b) => (+b.created || 0) - (+a.created || 0),
  'price-asc': (a, b) => (a.price || 0) - (b.price || 0),
  'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
};

// 打开这条链接时顾客看到的产品(按顺序)。products = 合集后台顺序的全部产品
// 返回 { list: 显示的, total: 不算「最多几个」时有几个, pins: [{ id, title, shown, why }] }
export function saleView(products, link = {}, opts = {}) {
  const base = featuredOrder(products.filter((p) => !whyOut(p, link)), opts);
  const by = BY[link.sort];
  let list = by ? base.map((p, i) => ({ p, i })).sort((a, b) => by(a.p, b.p) || a.i - b.i).map((o) => o.p) : base;
  const pinIds = (link.products || []).map((x) => nid(x.id));
  if (pinIds.length) {
    const byId = new Map(list.map((p) => [nid(p.id), p]));
    const head = pinIds.filter((id, i) => byId.has(id) && pinIds.indexOf(id) === i).map((id) => byId.get(id));
    const hs = new Set(head);
    list = [...head, ...list.filter((p) => !hs.has(p))];
  }
  const total = list.length;
  const limit = Math.max(0, parseInt(link.limit, 10) || 0);
  if (limit) list = list.slice(0, limit);
  const all = new Map(products.map((p) => [nid(p.id), p]));
  const shown = new Set(list.map((p) => nid(p.id)));
  const pins = (link.products || []).map((x) => {
    const p = all.get(nid(x.id));
    const why = !p ? '不在这个合集里' : whyOut(p, link) || (shown.has(nid(x.id)) ? '' : `排在「最多 ${limit} 个」以外`);
    return { id: x.id, title: x.title || p?.title || '', shown: !why, why };
  });
  return { list, total, pins };
}

// 完整链接
export const saleUrl = (domain, handle, slug) => `${String(domain || '').replace(/\/$/, '')}/collections/${handle}?onsale${slug ? `=${slug}` : ''}`;
