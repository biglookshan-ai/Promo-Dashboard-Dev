import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-sync-'));
const { runEffects, syncItem } = await import('../src/sync.js');
const { fieldsFor, handleFor } = await import('../src/metaobjects.js');
const { buildImport } = await import('../src/theme-import.js');
const { findSlider, findTopbar, siteStyle, normalizeLink } = await import('../src/theme-content.js');
const { larkSign, isLarkWebhook } = await import('../src/lark.js');
const { digestMessages } = await import('../src/notifier.js');

const T = Date.UTC(2026, 9, 1, 12), H = 3600_000, D = 24 * H;
function fakeShopify() {
  const upserts = []; let n = 1;
  const gql = async (ctx, query, vars) => {
    if (query.includes('metaobjectUpsert')) {
      upserts.push(vars);
      return { metaobjectUpsert: { metaobject: { id: `gid://shopify/Metaobject/${n++}`, handle: vars.handle.handle, capabilities: { publishable: { status: vars.metaobject.capabilities.publishable.status } } }, userErrors: [] } };
    }
    if (query.includes('metaobjectUpdate')) return { metaobjectUpdate: { metaobject: { id: vars.id }, userErrors: [] } };
    if (query.includes('metaobjectDelete')) return { metaobjectDelete: { deletedId: vars.id, userErrors: [] } };
    throw new Error('unexpected: ' + query.slice(0, 60));
  };
  return { gql, upserts };
}
const state = (o) => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], log: [], staff: [], notified: {}, settings: { larkWebhook: '', notify: {} }, ...o });

test('同步:活动先写,Banner 的「所属活动」指向活动的 Shopify id;状态按此刻算', async () => {
  const s = state({
    campaigns: [{ id: 'c1', kind: 'campaign', state: 'approved', name: 'Sale', start: T + D, end: T + 2 * D, collections: [{ id: 123, title: 'X' }], tags: ['BFCM'], products: [], countdown: true, priority: 5 }],
    banners: [{ id: 'b1', kind: 'banner', state: 'approved', title: 'A', image: 'u', imageId: 'gid://shopify/MediaImage/7', campaign: 'c1', start: null, end: null, order: 3, tag: 'sale' }],
  });
  const f = fakeShopify();
  const r = await runEffects({}, s, [{ type: 'sync', id: 'b1' }], { gql: f.gql, now: T });
  assert.deepEqual(r.errors, []);
  assert.equal(f.upserts[0].handle.type, 'cgp_campaign');
  assert.equal(f.upserts[1].handle.type, 'cgp_banner_slide');
  const bf = Object.fromEntries(f.upserts[1].metaobject.fields.map((x) => [x.key, x.value]));
  assert.equal(bf.campaign, s.campaigns[0].shopifyId);
  assert.equal(bf.position, '3');
  assert.equal(bf.starts_at, new Date(T + D).toISOString(), '跟随活动的时间');
  assert.equal(f.upserts[1].metaobject.capabilities.publishable.status, 'DRAFT', '还没到活动开始时间');
  const cf = Object.fromEntries(f.upserts[0].metaobject.fields.map((x) => [x.key, x.value]));
  assert.equal(cf.collections, JSON.stringify(['gid://shopify/Collection/123']));
  assert.equal(cf.tags, JSON.stringify(['BFCM']));
  assert.equal(cf.show_countdown, 'true');
  assert.ok(s.banners[0].shopifyId && s.banners[0].syncedStatus === 'DRAFT');
});

test('同步:未批准的不写;Shopify 报错记在条目上', async () => {
  const s = state({ banners: [{ id: 'b1', kind: 'banner', state: 'pending', image: 'u', imageId: 'x' }, { id: 'b2', kind: 'banner', state: 'approved', image: 'u', imageId: 'x', order: 0 }] });
  const r = await runEffects({}, s, [{ type: 'sync', id: 'b1' }, { type: 'sync', id: 'b2' }], { gql: async () => { throw new Error('Throttled'); }, now: T });
  assert.equal(r.errors.length, 1);
  assert.match(s.banners[1].syncError, /Throttled/);
  assert.equal(s.banners[0].shopifyId, undefined);
});

test('字段:空值、颜色、默认样式', () => {
  const f = Object.fromEntries(fieldsFor({ kind: 'tbstyle', name: '圣诞', bg: '#9b1c1c', color: 'red', effect: 'snow', isDefault: false, priority: 10 }).map((x) => [x.key, x.value]));
  assert.equal(f.background, '#9b1c1c');
  assert.equal(f.text_color, '', '不是 #RRGGBB 的颜色不写');
  assert.equal(f.effect, 'snow');
  assert.equal(f.is_default, 'false');
  assert.equal(handleFor({ id: 'B-e_JpN' }), 'cgp-b-e-jpn');
});

// ---- 主题解析 / 导入 ----
const indexJson = { sections: {
  old: { type: 'gpt-slider-banner-3', disabled: true, blocks: {}, block_order: [] },
  s1: { type: 'gpt-slider-banner-3', settings: { desktop_slide_width: 430, desktop_slide_height: 600, tag_new_bg_color: '#6d9c6d' }, block_order: ['k1', 'k2', 'k3'], blocks: {
    k1: { type: 'slide', settings: { image: 'shopify://shop_images/a.jpg', title: 'A', tag: 'new', button1_text: 'Shop', button1_url: 'shopify://collections/x' } },
    k2: { type: 'slide', disabled: true, settings: { image: 'shopify://shop_images/b.jpg', title: 'B' } },
    k3: { type: 'slide', settings: { image: 'shopify://shop_images/missing.jpg', title: 'C' } },
  } } } };
const headerJson = { sections: { h: { type: '_blocks', block_order: ['t'], blocks: { t: { type: 'x', settings: {
  background_color: '#3B4041', text_color: '#ffffff', font_size: 12, announcement_text_1: 'Free UK Delivery', announcement_emoji_1: '🚚', announcement_link_1: '',
  announcement_text_2: '', announcement_link_5: 'shopify://collections/clearance' } } } } } };

test('主题解析:只认没停用的轮播区块;空公告位不算;链接转站内路径', () => {
  const slider = findSlider(indexJson);
  assert.equal(slider.sectionId, 's1');
  assert.equal(slider.slides.length, 3);
  const tb = findTopbar(headerJson);
  assert.equal(tb.messages.length, 1, 'clearance 那个只有链接没文字的残留位不算');
  assert.equal(normalizeLink('shopify://products/abc'), '/products/abc');
  const st = siteStyle({ slider, topbar: tb, settingsData: { current: { media_radius: 12 } } });
  assert.equal(st.slide.w, 430); assert.equal(st.slide.tags.new.bg, '#6d9c6d'); assert.equal(st.topbar.bg, '#3B4041');
});

test('导入:正在显示的 Banner 按原顺序导入、找不到图的跳过;不重复导入', async () => {
  const slider = findSlider(indexJson), topbar = findTopbar(headerJson);
  const style = siteStyle({ slider, topbar });
  const resolveImage = async (ref) => (ref.endsWith('a.jpg') ? { id: 'gid://shopify/MediaImage/1', url: 'https://cdn/a.jpg' } : null);
  const gql = async (ctx, q) => { if (q.includes('fileCreate')) return { fileCreate: { files: [], userErrors: [{ message: 'nope' }] } }; throw new Error('x'); };
  const imp = await buildImport({ shop: 'x.myshopify.com' }, { slider, topbar, style }, new Set(), { resolveImage, actor: { id: 'u1' } }, gql);
  assert.equal(imp.banners.length, 1);
  assert.equal(imp.banners[0].button1_url, '/collections/x');
  assert.equal(imp.banners[0].state, 'approved');
  assert.equal(imp.skipped.length, 1);
  assert.equal(imp.disabledSlides, 1);
  assert.equal(imp.topbar.length, 1);
  assert.equal(imp.tbstyles[0].isDefault, true);
  const again = await buildImport({ shop: 'x' }, { slider, topbar, style }, new Set([imp.banners[0].source, imp.topbar[0].source, 'theme:topbar-style']), { resolveImage }, gql);
  assert.equal(again.banners.length + again.topbar.length + again.tbstyles.length, 0);
});

// ---- 飞书 ----
test('飞书:签名算法 & 地址校验', () => {
  // 官方文档的算法:以「timestamp + 换行 + 密钥」为 key 做 HmacSHA256,消息为空,结果 base64
  const crypto = require('node:crypto');
  const want = crypto.createHmac('sha256', '1599360473\ndemo').update('').digest('base64');
  assert.equal(larkSign('demo', 1599360473), want);
  assert.ok(isLarkWebhook('https://open.feishu.cn/open-apis/bot/v2/hook/abc-123'));
  assert.ok(!isLarkWebhook('https://evil.com/open-apis/bot/v2/hook/abc'));
});

test('每日汇总:10 点前不发;明天上线的 + 3 天内下架的', () => {
  const s = state({ settings: { notify: { dayBefore: true, endingSoon: true } }, banners: [
    { id: 'a', kind: 'banner', state: 'approved', title: 'Tomorrow', start: T + D, end: null },
    { id: 'b', kind: 'banner', state: 'approved', title: 'Ending', start: null, end: T + 2 * D },
    { id: 'c', kind: 'banner', state: 'pending', title: 'NotApproved', start: T + D, end: null },
  ] });
  const at9 = Date.UTC(2026, 9, 1, 8); // 英国夏令时 09:00
  assert.equal(digestMessages(s, { now: at9 }).length, 0);
  const at10 = Date.UTC(2026, 9, 1, 9, 5);
  const m = digestMessages(s, { now: at10 });
  assert.equal(m.length, 2);
  assert.match(m[0].card.lines.join('\n'), /NotApproved.*还没批准/);
  assert.match(m[1].card.title, /3 天内下架/);
});

test('写入:Shopify 不收空字符串时,去掉空字段再写一次', async () => {
  const { upsertItem } = await import('../src/metaobjects.js');
  const calls = [];
  const gql = async (ctx, q, vars) => {
    calls.push(vars.metaobject.fields.length);
    const hasEmpty = vars.metaobject.fields.some((f) => f.value === '');
    return { metaobjectUpsert: hasEmpty
      ? { metaobject: null, userErrors: [{ field: ['fields', '3'], message: "Value can't be blank" }] }
      : { metaobject: { id: 'gid://shopify/Metaobject/1', handle: 'h', capabilities: { publishable: { status: 'ACTIVE' } } }, userErrors: [] } };
  };
  const r = await upsertItem({}, { id: 'b1', kind: 'banner', title: 'A', subtitle: '', imageId: 'gid://shopify/MediaImage/1', order: 0, tag: 'new' }, { status: 'ACTIVE', win: {} }, gql);
  assert.equal(r.id, 'gid://shopify/Metaobject/1');
  assert.equal(calls.length, 2);
  assert.ok(calls[1] < calls[0]);
});

// ---- 首页商品模块 ----
test('同步商品模块:先写页签,版本按顺序引用页签;去掉的页签从店里删掉', async () => {
  const upserts = [], removed = []; let n = 1;
  const gql = async (ctx, q, vars) => {
    if (q.includes('metaobjectUpsert')) { upserts.push(vars); return { metaobjectUpsert: { metaobject: { id: `gid://shopify/Metaobject/${n++}`, handle: vars.handle.handle, capabilities: { publishable: { status: vars.metaobject.capabilities?.publishable?.status || 'ACTIVE' } } }, userErrors: [] } }; }
    if (q.includes('metaobjectDelete')) { removed.push(vars.id); return { metaobjectDelete: { deletedId: vars.id, userErrors: [] } }; }
    throw new Error('unexpected');
  };
  const m = { id: 'pm1', kind: 'pmodule', module: 'sale', name: 'BF', title: 'Black', title2: 'Friday', titleColor: '#111111', state: 'approved', start: null, end: null, campaign: null,
    tabs: [{ id: 'ta', title: 'Deals', source: 'collection', collection: { id: 9 }, limit: 20, onlyDiscounted: true },
           { id: 'tb', title: 'Picks', source: 'products', products: [{ id: 5 }, { id: 'gid://shopify/Product/6' }], limit: 0, newestFirst: true }],
    syncedTabIds: ['gid://old-tab'] };
  const s = state({ pmodules: [m] });
  const r = await runEffects({}, s, [{ type: 'sync', id: 'pm1' }], { gql, now: T });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(upserts.map((u) => u.handle.type), ['cgp_product_tab', 'cgp_product_tab', 'cgp_product_module']);
  assert.equal(upserts[0].metaobject.capabilities, undefined, '页签不开上下线');
  const tf = Object.fromEntries(upserts[1].metaobject.fields.map((x) => [x.key, x.value]));
  assert.equal(tf.products, JSON.stringify(['gid://shopify/Product/5', 'gid://shopify/Product/6']));
  assert.equal(tf.limit, '0'); assert.equal(tf.newest_first, 'true'); assert.equal(tf.collection, '');
  const mf = Object.fromEntries(upserts[2].metaobject.fields.map((x) => [x.key, x.value]));
  assert.equal(mf.tabs, JSON.stringify([s.pmodules[0].tabs[0].shopifyId, s.pmodules[0].tabs[1].shopifyId]));
  assert.equal(mf.module, 'sale'); assert.equal(mf.title_color, '#111111');
  assert.deepEqual(removed, ['gid://old-tab']);
});

test('导入:首页两个商品模块 → 各一个平时版本(页签不限数量,和现在一样);找不到的合集跳过', async () => {
  const { findProductModules } = await import('../src/theme-content.js');
  const idx = { order: ['a', 'b'], sections: {
    a: { type: 'GPT-Custom-Product-List', settings: { title2: 'Autumn Sale', title2_color: '#ee8849', tab_active_bg_color: '#ee8849' }, block_order: ['x', 'y', 'z'], blocks: {
      x: { type: 'collection_group', settings: { collection: 'flashdeal', custom_title: 'Top Picks', show_only_discounted: true, sort_by_discount: true } },
      y: { type: 'collection_group', disabled: true, settings: { collection: 'dzofilm' } },
      z: { type: 'collection_group', settings: { collection: 'gone', custom_title: 'Gone' } } } },
    b: { type: 'gpt-555', settings: { title: 'Feature Products' }, block_order: ['k'], blocks: { k: { type: 'collection', settings: { collection: 'staff-picks' } } } } } };
  const mods = findProductModules(idx);
  assert.deepEqual(mods.map((m) => [m.module, m.tabs.length]), [['sale', 2], ['feature', 1]]);
  const resolveCollection = async (h) => (h === 'gone' ? null : { id: `gid://shopify/Collection/${h}`, handle: h, title: h });
  const imp = await buildImport({}, { modules: mods }, new Set(), { resolveCollection, actor: { id: 'u1' } }, async () => { throw new Error('x'); });
  assert.equal(imp.pmodules.length, 2);
  const sale = imp.pmodules.find((m) => m.module === 'sale');
  assert.equal(sale.isDefault, true); assert.equal(sale.title2, 'Autumn Sale');
  assert.deepEqual(sale.tabs.map((t) => [t.title, t.limit, t.onlyDiscounted]), [['Top Picks', 0, true]]);
  assert.equal(imp.skipped.length, 1);
  const again = await buildImport({}, { modules: mods }, new Set(imp.pmodules.map((m) => m.source)), { resolveCollection }, async () => { throw new Error('x'); });
  assert.equal(again.pmodules.length, 0);
});
