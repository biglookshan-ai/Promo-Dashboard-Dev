// 促销链接 ?onsale=<后缀>:和主题 cgp-search-app.js 的 SALE 同一套规则
import test from 'node:test';
import assert from 'node:assert/strict';
import { saleView, featuredOrder, whyOut, slugOf, SLUG_RE, saleUrl } from '../src/sale-link.js';
import { applyAction } from '../src/schedule-actions.js';
import { fieldsFor } from '../src/metaobjects.js';

// 合集后台顺序;created 越大越新
const P = (id, discount, status = 'instock', created = id, price = 100000) => ({ id, discount, status, created, price });
const col = [P(1, 0), P(2, 30), P(3, 10, 'oos'), P(4, 50, 'preorder'), P(5, 25), P(6, 15), P(7, 40)];
const ids = (v) => v.list.map((p) => p.id);

test('不带设置:只要打折的,顺序和 Collection 平时一样', () => {
  assert.deepEqual(ids(saleView(col, {})), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ids(saleView(col, {}, { sortRule: { off: false, pinManual: 2, pinNew: 0 } })), [2, 3, 7, 6, 5, 4], '默认规则:手动前 2 个 + 其余新到旧');
});

test('只显示有货 / 最低折扣 / 排序 / 最多几个', () => {
  assert.deepEqual(ids(saleView(col, { inStock: true })), [2, 5, 6, 7]);
  assert.deepEqual(ids(saleView(col, { minDiscount: 25 })), [2, 4, 5, 7]);
  assert.deepEqual(ids(saleView(col, { sort: 'discount' })), [4, 7, 2, 5, 6, 3]);
  const v = saleView(col, { sort: 'discount', limit: 2 });
  assert.deepEqual(ids(v), [4, 7]); assert.equal(v.total, 6);
});

test('置顶:排最前,但照样要打折 / 有货;说清楚为什么没显示', () => {
  const v = saleView(col, { inStock: true, sort: 'discount', limit: 3, products: [{ id: 'gid://shopify/Product/6' }, { id: 1 }, { id: 4 }, { id: 99 }] });
  assert.deepEqual(ids(v), [6, 7, 2]);
  assert.deepEqual(v.pins.map((p) => p.why), ['', '没打折', '预订(不算有货)', '不在这个 Collection 里']);
  const v2 = saleView(col, { sort: 'discount', limit: 1, products: [{ id: 7 }, { id: 2 }] });
  assert.deepEqual(v2.pins.map((p) => p.shown), [true, false]);
  assert.match(v2.pins[1].why, /最多 1 个/);
});

test('Collection 平时的顺序:生效中的置顶清单排最前', () => {
  assert.deepEqual(featuredOrder(col, { pinIds: ['gid://shopify/Product/5'], sortRule: { off: true } }).map((p) => p.id), [5, 1, 2, 3, 4, 6, 7]);
  assert.equal(whyOut(P(1, 5), { minDiscount: 10 }), '折扣不到 10%');
});

test('后缀和链接', () => {
  assert.equal(slugOf(' Autumn Sale 2026! '), 'autumn-sale-2026');
  assert.ok(SLUG_RE.test('bf-dzo')); assert.ok(!SLUG_RE.test('-x')); assert.ok(!SLUG_RE.test('Bad'));
  assert.equal(saleUrl('https://www.cinegearpro.co.uk/', 'dzofilm', 'autumn'), 'https://www.cinegearpro.co.uk/collections/dzofilm?onsale=autumn');
});

const admin = { id: 'a', name: '管理员', role: 'approver' };
const doc = () => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], pmodules: [], pins: [], salelinks: [], pendingOrder: null, log: [], staff: [], settings: {} });
const link = (o = {}) => ({ id: 'sl-1', name: 'Autumn DZO', slug: 'autumn', collection: { id: 'gid://shopify/Collection/9', handle: 'dzofilm', title: 'DZOFiLM' }, products: [], ...o });

test('保存:要名称 / Collection / 合规的后缀;同一个 Collection 后缀不能重复', () => {
  const save = (d, v) => applyAction(d, { type: 'save', mode: 'publish', kind: 'salelink', isNew: true, values: v }, admin, 1);
  assert.throws(() => save(doc(), link({ slug: 'Bad Slug' })), /链接后缀/);
  assert.throws(() => save(doc(), link({ collection: null })), /请选 Collection/);
  const r = save(doc(), link());
  assert.equal(r.doc.salelinks[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync'));
  assert.throws(() => save(r.doc, link({ id: 'sl-2', collection: { id: 9 } })), /已经有后缀叫「autumn」/);
  assert.equal(save(r.doc, link({ id: 'sl-3', collection: { id: 10 } })).doc.salelinks.length, 2, '别的 Collection 可以同名');
});

test('写进店铺的字段', () => {
  const f = Object.fromEntries(fieldsFor({ kind: 'salelink', ...link({ inStock: true, minDiscount: 20, limit: 24, sort: 'discount', heading: 'Autumn Deals', products: [{ id: 5 }] }) }).map((x) => [x.key, x.value]));
  assert.equal(f.slug, 'autumn'); assert.equal(f.collection, 'gid://shopify/Collection/9'); assert.equal(f.products, '["gid://shopify/Product/5"]');
  assert.equal(f.in_stock, 'true'); assert.equal(f.min_discount, '20'); assert.equal(f.limit, '24'); assert.equal(f.sort, 'discount'); assert.equal(f.title, 'Autumn Deals');
});

test('带页面模板的链接', async () => {
  const { saleUrl: u, VIEW_RE } = await import('../src/sale-link.js');
  assert.equal(u('https://x.co.uk', 'dzofilm', 'bfcm', 'sale'), 'https://x.co.uk/collections/dzofilm?view=sale&onsale=bfcm');
  assert.equal(u('https://x.co.uk', 'dzofilm', '', 'Brand Collection'), 'https://x.co.uk/collections/dzofilm?view=Brand%20Collection&onsale');
  assert.ok(VIEW_RE.test('sale-bf')); assert.ok(!VIEW_RE.test('../x'));
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'salelink', isNew: true, values: link({ view: '<x>' }) }, admin, 1), /页面模板/);
});

test('短链接:后缀和模板名一样(不分大小写)就只写 ?view=', async () => {
  const { saleUrl: u, viewBound } = await import('../src/sale-link.js');
  assert.equal(u('https://www.cinegearpro.co.uk', 'dzofilm', 'bfcm-dzo', 'BFCM-DZO'), 'https://www.cinegearpro.co.uk/collections/dzofilm?view=BFCM-DZO');
  assert.equal(u('https://x', 'dzofilm', 'bfcm', 'blackfriday-collection'), 'https://x/collections/dzofilm?view=blackfriday-collection&onsale=bfcm');
  assert.ok(!viewBound('', 'sale')); assert.ok(!viewBound('sale', ''));
});

test('结束后去哪:选项和链接格式校验;写进店铺的字段', async () => {
  const { validate } = await import('../src/schedule-actions.js');
  const { fieldsFor } = await import('../src/metaobjects.js');
  const base = { kind: 'salelink', name: 'x', slug: 'bf', collection: { id: 1 }, start: null, end: null };
  assert.equal(validate({ ...base, afterEnd: 'collection' }), '');
  assert.match(validate({ ...base, afterEnd: 'nope' }), /选项不对/);
  assert.match(validate({ ...base, afterEnd: 'url', afterEndUrl: 'javascript:alert(1)' }), /链接不对/);
  assert.match(validate({ ...base, afterEnd: 'url', afterEndUrl: '//evil.com' }), /链接不对/);
  assert.equal(validate({ ...base, afterEnd: 'url', afterEndUrl: '/collections/black-friday' }), '');
  assert.equal(validate({ ...base, afterEnd: 'url', afterEndUrl: 'https://www.cinegearpro.co.uk/collections/bf' }), '');
  const f = Object.fromEntries(fieldsFor({ ...base, afterEnd: 'url', afterEndUrl: ' /collections/bf ' }).map((x) => [x.key, x.value]));
  assert.equal(f.after_end, 'url'); assert.equal(f.after_end_url, '/collections/bf');
  const g = Object.fromEntries(fieldsFor({ ...base, afterEnd: 'collection', afterEndUrl: '/x' }).map((x) => [x.key, x.value]));
  assert.equal(g.after_end, 'collection'); assert.equal(g.after_end_url, '');
});

test('活动徽章链接:自动 / 不能点 / 指定链接的校验和写进店铺的值', async () => {
  const { validate } = await import('../src/schedule-actions.js');
  const { fieldsFor } = await import('../src/metaobjects.js');
  const c = { kind: 'campaign', name: 'x', start: 1, end: 2, collections: [], tags: [], products: [] };
  assert.equal(validate({ ...c, badgeLink: '' }), '');
  assert.equal(validate({ ...c, badgeLink: 'none' }), '');
  assert.equal(validate({ ...c, badgeLink: '/collections/dzofilm?view=bfcm-dzo' }), '');
  assert.match(validate({ ...c, badgeLink: 'javascript:alert(1)' }), /徽章链接不对/);
  const f = (v) => Object.fromEntries(fieldsFor({ ...c, badgeLink: v }).map((x) => [x.key, x.value])).badge_link;
  assert.equal(f(''), ''); assert.equal(f('none'), 'none'); assert.equal(f(' /collections/x '), '/collections/x');
});

test('排序编辑器:saleBase 不算置顶;all = 连没打折的也排进来;置顶 = 最短前缀(按链接自己的排序算)', async () => {
  const { saleBase, saleView } = await import('../src/sale-link.js');
  const { minimalPrefix } = await import('../src/order-diff.js');
  const P = [{ id: 1, discount: 10 }, { id: 2, discount: 0 }, { id: 3, discount: 30 }, { id: 4, discount: 20 }];
  assert.deepEqual(saleBase(P, {}).map((p) => p.id), [1, 3, 4]);
  assert.deepEqual(saleBase(P, {}, {}, true).map((p) => p.id), [1, 2, 3, 4]);
  assert.deepEqual(saleBase(P, { sort: 'discount' }).map((p) => p.id), [3, 4, 1]);
  // 拖动时链接按自己的排序(没选就是折扣从大到小):把 4 拖到第 1 位 → 只要固定 [4];顾客看到 4,3,1
  const pins = minimalPrefix([3, 4, 1], [4, 3, 1]);
  assert.deepEqual(pins, ['4']);
  assert.deepEqual(saleView(P, { sort: 'discount', products: pins.map((id) => ({ id })) }).list.map((p) => p.id), [4, 3, 1]);
  // 固定了产品又没选排序 = 其余按折扣从大到小
  assert.deepEqual(saleView(P, { products: [{ id: 1 }] }).list.map((p) => p.id), [1, 3, 4]);
  // 没打折的 2 先排在第 1 位:现在不出现,打折后排第一
  assert.deepEqual(saleView(P, { products: [{ id: 2 }] }).list.map((p) => p.id), [3, 4, 1]);
  assert.deepEqual(saleView(P.map((p) => (p.id === 2 ? { ...p, discount: 5 } : p)), { products: [{ id: 2 }] }).list.map((p) => p.id), [2, 3, 4, 1]);
});

test('有自定义的促销链接完全不受置顶清单 / Collection 默认设置影响;没自定义才跟着 Collection(2026-10-26 用户定)', async () => {
  const { saleView, isCustom, effSort } = await import('../src/sale-link.js');
  const P = [{ id: 1, discount: 10, created: 5 }, { id: 2, discount: 20, created: 4 }, { id: 3, discount: 10, created: 9 }, { id: 4, discount: 20, created: 1 }];
  const pinList = { pinIds: [1], sortRule: { off: true } };          // 生效中的置顶清单把 1 排第一
  // 没自定义:跟着 Collection(置顶清单的 1 排第一)
  assert.equal(isCustom({}), false);
  assert.deepEqual(saleView(P, {}, pinList).list.map((p) => p.id), [1, 2, 3, 4]);
  // 选了排序:置顶清单管不到;折扣一样时按最新(created 大的在前)
  assert.deepEqual(saleView(P, { sort: 'discount' }, pinList).list.map((p) => p.id), [2, 4, 3, 1]);
  assert.deepEqual(saleView(P, { sort: 'discount' }, {}).list.map((p) => p.id), [2, 4, 3, 1]);
  // 固定了产品、排序留空:也算自定义 → 其余按折扣从大到小,置顶清单管不到
  const fixed = { products: [{ id: 3 }] };
  assert.equal(isCustom(fixed), true); assert.equal(effSort(fixed), 'discount');
  assert.deepEqual(saleView(P, fixed, pinList).list.map((p) => p.id), [3, 2, 4, 1]);
  assert.deepEqual(saleView(P, fixed, {}).list.map((p) => p.id), [3, 2, 4, 1]);
});

test('固定位置只认前 50 个(和网站一致);第 51 个以后按链接自己的排序', async () => {
  const { saleView, MAX_FIXED } = await import('../src/sale-link.js');
  const P = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, discount: i + 1, created: 0 })); // 折扣:id 越大越高
  const order = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }));                      // 想按 1,2,3…60 排
  const v = saleView(P, { products: order }).list.map((p) => p.id);
  assert.equal(MAX_FIXED, 50);
  assert.deepEqual(v.slice(0, 50), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.deepEqual(v.slice(50), [60, 59, 58, 57, 56, 55, 54, 53, 52, 51]);                  // 51–60 按折扣从大到小
});
