import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tbsync-'));
const { imageRef, linkRef, liveBanners, slideBlocks, applySlides, syncThemeBanners, CHECK_EVERY } = await import('../src/theme-banner-sync.js');

const T = Date.UTC(2026, 10, 2, 12), D = 86400000;
const HEAD = '/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n';
const bn = (o = {}) => ({ id: 'b1', kind: 'banner', state: 'approved', order: 0, start: null, end: null, campaign: null, title: 'A', subtitle: '', description: '',
  image: 'https://cdn.shopify.com/s/files/1/1258/4351/files/Arles_Zoom%203-4.jpg?v=17', button1_text: 'Shop Now', button1_url: '/collections/arles', button2_text: '', button2_url: '', tag: 'new', ...o });
const template = () => HEAD + JSON.stringify({
  sections: {
    old_hidden: { type: 'gpt-slider-banner-3', disabled: true, blocks: { x: { type: 'slide', settings: { title: 'old' } } }, block_order: ['x'], settings: { speed: 5 } },
    main: { type: 'gpt-slider-banner-3', blocks: { s1: { type: 'slide', settings: { title: 'S1' } }, s2: { type: 'slide', disabled: true, settings: { title: 'S2' } } }, block_order: ['s1', 's2'], settings: { speed: 7 } },
    other: { type: 'gpt-collection-list-2', settings: { title: 'Keep me' } },
  },
  order: ['old_hidden', 'main', 'other'],
}, null, 2);

test('图片 / 链接换成主题设置的写法', () => {
  assert.equal(imageRef('https://cdn.shopify.com/s/files/1/1258/4351/files/Arles_Zoom%203-4.jpg?v=17'), 'shopify://shop_images/Arles_Zoom 3-4.jpg');
  assert.equal(imageRef('shopify://shop_images/a.jpg'), 'shopify://shop_images/a.jpg');
  assert.equal(imageRef('https://example.com/a.jpg'), ''); // 不是文件库的图:主题引用不了
  assert.equal(linkRef('/collections/dzofilm'), 'shopify://collections/dzofilm');
  assert.equal(linkRef('/products/x'), 'shopify://products/x');
  assert.equal(linkRef('/collections/dzofilm?sort_by=price'), '/collections/dzofilm?sort_by=price');
  assert.equal(linkRef('https://rental.cinegearpro.co.uk/'), 'https://rental.cinegearpro.co.uk/');
});

test('只拿此刻上线中的,按前台顺序;视频只认 YouTube / Vimeo;角标不认识的当无角标', () => {
  const state = { campaigns: [], banners: [bn({ id: 'b2', order: 2, title: 'B' }), bn({ id: 'b1', order: 1 }), bn({ id: 'p', paused: true }), bn({ id: 'e', end: T - D }),
    bn({ id: 's', start: T + D }), bn({ id: 'd', state: 'draft' }), bn({ id: 'v', order: 3, button1_video: 'https://youtu.be/xx', button2_video: 'nope', tag: 'weird' })] };
  const live = liveBanners(state, T);
  assert.deepEqual(live.map((b) => b.id), ['b1', 'b2', 'v']);
  const w = slideBlocks(live);
  assert.deepEqual(w.order, ['cgp_b1', 'cgp_b2', 'cgp_v']);
  assert.equal(w.blocks.cgp_b1.name, 'App 同步');
  assert.deepEqual(w.blocks.cgp_b1.settings, { image: 'shopify://shop_images/Arles_Zoom 3-4.jpg', title: 'A', subtitle: '', description: '', button1_text: 'Shop Now',
    button1_url: 'shopify://collections/arles', button1_video: '', button2_text: '', button2_url: '', button2_video: '', tag: 'new' });
  assert.equal(w.blocks.cgp_v.settings.button1_video, 'https://youtu.be/xx');
  assert.equal(w.blocks.cgp_v.settings.button2_video, '');
  assert.equal(w.blocks.cgp_v.settings.tag, 'none');
});

test('只换开着的轮播 section 的 slide:隐藏的 section、别的 section、section 设置、开头说明都不动;一样就不改', () => {
  const want = slideBlocks([bn()]);
  const out = applySlides(template(), want);
  assert.ok(out.content.startsWith(HEAD));
  const j = JSON.parse(out.content.slice(HEAD.length));
  assert.deepEqual(j.sections.main.block_order, ['cgp_b1']);
  assert.deepEqual(Object.keys(j.sections.main.blocks), ['cgp_b1']); // 隐藏的 s2 也清掉
  assert.deepEqual(j.sections.main.settings, { speed: 7 });
  assert.deepEqual(j.sections.old_hidden.block_order, ['x']);
  assert.deepEqual(j.sections.other, { type: 'gpt-collection-list-2', settings: { title: 'Keep me' } });
  assert.deepEqual(j.order, ['old_hidden', 'main', 'other']);
  assert.equal(out.removed, 2);
  assert.equal(applySlides(out.content, want), null);
  assert.throws(() => applySlides(JSON.stringify({ sections: { a: { type: 'x' } }, order: ['a'] }), want), /没有开着的 Banner 轮播模块/);
});

function fakeShop({ canWrite = true } = {}) {
  const files = { 'templates/index.json': template() }; const calls = { reads: 0, writes: 0 };
  const gql = async (ctx, q, v) => {
    if (q.includes('themes(first: 1, roles: [MAIN])')) return { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/9', name: '正式主题' }] } };
    if (q.includes('files(first: 1')) { calls.reads++; return { theme: { files: { nodes: v.f.map((f) => ({ filename: f, body: { content: files[f] } })) } } }; }
    if (q.includes('themeFilesUpsert')) {
      if (!canWrite) throw new Error('Access denied for themeFilesUpsert field. Required access: `write_themes` access scope.');
      calls.writes++; for (const f of v.files) files[f.filename] = f.body.value;
      return { themeFilesUpsert: { upsertedThemeFiles: [], userErrors: [] } };
    }
    throw new Error('没想到的查询 ' + q);
  };
  return { gql, files, calls };
}
const ctx = { shop: 'test.myshopify.com', token: 't' };

test('同步:有变化才写、写前备份;没变化不读主题;每天核对一次;一张上线的都没有不动', async () => {
  const shop = fakeShop();
  const state = { campaigns: [], banners: [bn(), bn({ id: 'b2', order: 1, title: 'B' })] };
  let r = await syncThemeBanners(ctx, state, { now: T, gql: shop.gql });
  assert.equal(r.done, true); assert.equal(r.count, 2); assert.equal(r.removed, 2);
  assert.deepEqual(JSON.parse(shop.files['templates/index.json'].slice(HEAD.length)).sections.main.block_order, ['cgp_b1', 'cgp_b2']);
  const bak = path.join(process.env.DATA_DIR, 'theme-backup', 'test.myshopify.com');
  assert.equal(fs.readdirSync(bak).length, 1);
  assert.equal(fs.readFileSync(path.join(bak, fs.readdirSync(bak)[0]), 'utf8'), template());
  // 没变:不读主题
  r = await syncThemeBanners(ctx, state, { now: T + 60_000, gql: shop.gql });
  assert.equal(r.skipped, 'same'); assert.equal(shop.calls.reads, 1);
  // 有人在编辑器里改回去了:每天核对一次时改回来
  shop.files['templates/index.json'] = template();
  r = await syncThemeBanners(ctx, state, { now: T + CHECK_EVERY + 1, gql: shop.gql });
  assert.equal(r.done, true); assert.equal(shop.calls.writes, 2);
  // Banner 变了:马上写
  state.banners[1].title = 'B2';
  r = await syncThemeBanners(ctx, state, { now: T + CHECK_EVERY + 120_000, gql: shop.gql });
  assert.equal(r.done, true); assert.equal(shop.calls.writes, 3);
  // 全部下线:不动(留着上一次的)
  state.banners.forEach((b) => { b.paused = true; });
  r = await syncThemeBanners(ctx, state, { now: T + CHECK_EVERY + 180_000, gql: shop.gql });
  assert.equal(r.skipped, 'none-live'); assert.equal(shop.calls.writes, 3);
});

test('没有改主题权限:记下原因,30 分钟内不重试(Banner 变了或手动点就马上试)', async () => {
  const shop = fakeShop({ canWrite: false });
  const state = { campaigns: [], banners: [bn()] };
  let r = await syncThemeBanners(ctx, state, { now: T, gql: shop.gql });
  assert.match(r.error, /write_themes/); assert.match(state.themeBanners.error, /改主题/);
  r = await syncThemeBanners(ctx, state, { now: T + 60_000, gql: shop.gql });
  assert.equal(r.skipped, 'retry-later');
  r = await syncThemeBanners(ctx, state, { now: T + 120_000, gql: shop.gql, force: true });
  assert.match(r.error, /write_themes/);
  state.banners[0].title = 'changed';
  r = await syncThemeBanners(ctx, state, { now: T + 180_000, gql: shop.gql });
  assert.match(r.error, /write_themes/); // Banner 变了:不等 30 分钟
});
