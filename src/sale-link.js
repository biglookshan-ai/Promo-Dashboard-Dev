// 促销链接(合集 ?onsale=<后缀>)的规则 —— 和主题 assets/cgp-search-app.js 的 SALE 一模一样,改一边要同步另一边。
// 纯函数,服务器和浏览器共用(浏览器通过 /lib/sale-link.js 加载),编辑器右边的预览就是用它算的。
//
// 链接的设置(app 里的一条 salelink):
//   slug 后缀 · collection 合集 · inStock 只显示有货 · minDiscount 最低折扣 % · products 置顶(按顺序)
//   · limit 最多几个(空 / 0 = 不限)· sort 排序 · heading 页面上的标题
// 前台的产品数据来自主题的 cgp-json(每个产品:id、discount 折扣最大的变体的 %、status instock / preorder / oos、created、price)。
//
// ★ 2026-10-26 用户定:链接**有自定义**(固定了产品,或选了排序方式)= 完全独立 —— 固定的排最前,其余按链接自己的排序
//   (固定了产品又没选排序 = 折扣从大到小),一样大再按最新、产品 id;**不看 Collection 的顺序,置顶清单 / 默认设置都影响不到**。
//   链接**什么都没自定义**才跟着 Collection 平时的顺序(生效中的置顶清单 → Collection 默认设置)。
//   固定位置最多前 100 个算数(2026-10-26 从 50 提到 100:metaobjects.js 另写 pin_ids 产品编号,主题优先读它;
//   店里的内容类型还没补建 pin_ids 时,主题只读得到前 50 个 —— 编辑器会提醒去补建)。

export const SALE_SORTS = [
  ['', '和 Collection 平时一样'], ['discount', '折扣从大到小'], ['newest', '最新上架在前'], ['price-asc', '价格从低到高'], ['price-desc', '价格从高到低'],
];
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const slugOf = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const nid = (id) => Number(String(id ?? '').split('/').pop()) || 0;
export const MAX_FIXED = 100; // 2026-10-26 从 50 提到 100(店里另存 pin_ids,主题优先读它)
// 有没有自定义排序;实际用哪种排序('' = 跟着 Collection)
export const isCustom = (link = {}) => !!link.sort || (link.products || []).length > 0;
export const effSort = (link = {}) => link.sort || ((link.products || []).length ? 'discount' : '');

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

const NEWEST = (a, b) => (+b.created || 0) - (+a.created || 0) || nid(b.id) - nid(a.id);
const BY = {
  discount: (a, b) => (b.discount || 0) - (a.discount || 0),
  newest: NEWEST,
  'price-asc': (a, b) => (a.price || 0) - (b.price || 0),
  'price-desc': (a, b) => (b.price || 0) - (a.price || 0),
};

// 打开这条链接时顾客看到的产品(按顺序)。products = 合集后台顺序的全部产品
// 返回 { list: 显示的, total: 不算「最多几个」时有几个, pins: [{ id, title, shown, why }] }
// 不算置顶时的顺序(合集平时的顺序 → 按链接的排序方式)。all = 连没打折 / 不符合条件的也排进来
// (排序编辑器「也显示现在不会出现的产品」用:活动开始前先排好,开始后才打折的产品照这个位置出现)
export function saleBase(products, link = {}, opts = {}, all = false) {
  const list = all ? products : products.filter((p) => !whyOut(p, link));
  const by = BY[effSort(link)];
  if (!by) return featuredOrder(list, opts);                // 没自定义:跟着 Collection 平时的顺序(置顶清单 → 默认设置)
  return [...list].sort((a, b) => by(a, b) || NEWEST(a, b)); // 有自定义:只按链接自己的排序,不看 Collection 的先后
}

export function saleView(products, link = {}, opts = {}) {
  let list = saleBase(products, link, opts);
  const pinIds = (link.products || []).slice(0, MAX_FIXED).map((x) => nid(x.id)); // 网站只认前 100 个
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
    const why = !p ? '不在这个 Collection 里' : whyOut(p, link) || (shown.has(nid(x.id)) ? '' : `排在「最多 ${limit} 个」以外`);
    // 第 101 个以后:网站不认这个固定位置(照样可能显示,只是按排序规则排)
    return { id: x.id, title: x.title || p?.title || '', shown: !why, why };
  });
  return { list, total, pins };
}

// 结束后去哪(2026-10-17 用户):'' = 不跳转(退回「这个合集所有打折的产品」;短链接照样用模板打开)
//   'collection' = 跳回合集原来的页面;'url' = 跳到指定链接(站内路径 /… 或 https://…)
export const AFTER_END = [['', '不跳转'], ['collection', '跳回 Collection 原来的页面'], ['url', '跳到指定链接']];
export const AFTER_URL_RE = /^(\/[^\/\s][^\s]*|https:\/\/[^\s]+)$/;

// 页面模板:?view= 后面那段(主题里 templates/collection.<名字>.json),留空 = 合集原来的模板
export const VIEW_RE = /^[\w][\w -]{0,59}$/;
// 后缀和模板名一样(不分大小写)→ 只写 ?view=<模板名> 就够了(主题按名字自动套用这条链接)
export const viewBound = (slug, view) => !!slug && !!view && String(view).trim().toLowerCase() === slug;
// 完整链接:/collections/<合集>?view=<模板>&onsale=<后缀>;后缀和模板名一样时是短链接 /collections/<合集>?view=<模板>
export const saleUrl = (domain, handle, slug, view) => {
  const base = `${String(domain || '').replace(/\/$/, '')}/collections/${handle}?`;
  if (viewBound(slug, view)) return `${base}view=${encodeURIComponent(view)}`;
  return `${base}${view ? `view=${encodeURIComponent(view)}&` : ''}onsale${slug ? `=${slug}` : ''}`;
};
