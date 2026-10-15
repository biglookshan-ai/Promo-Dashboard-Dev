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

test('不带设置:只要打折的,顺序和合集平时一样', () => {
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
  assert.deepEqual(v.pins.map((p) => p.why), ['', '没打折', '预订(不算有货)', '不在这个合集里']);
  const v2 = saleView(col, { sort: 'discount', limit: 1, products: [{ id: 7 }, { id: 2 }] });
  assert.deepEqual(v2.pins.map((p) => p.shown), [true, false]);
  assert.match(v2.pins[1].why, /最多 1 个/);
});

test('合集平时的顺序:生效中的置顶清单排最前', () => {
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

test('保存:要名称 / 合集 / 合规的后缀;同一个合集后缀不能重复', () => {
  const save = (d, v) => applyAction(d, { type: 'save', mode: 'publish', kind: 'salelink', isNew: true, values: v }, admin, 1);
  assert.throws(() => save(doc(), link({ slug: 'Bad Slug' })), /链接后缀/);
  assert.throws(() => save(doc(), link({ collection: null })), /请选合集/);
  const r = save(doc(), link());
  assert.equal(r.doc.salelinks[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync'));
  assert.throws(() => save(r.doc, link({ id: 'sl-2', collection: { id: 9 } })), /已经有后缀叫「autumn」/);
  assert.equal(save(r.doc, link({ id: 'sl-3', collection: { id: 10 } })).doc.salelinks.length, 2, '别的合集可以同名');
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
