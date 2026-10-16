// 上线前对照正式主题:app 里的首页内容对齐成编辑器里现在的样子
import test from 'node:test';
import assert from 'node:assert/strict';
import { planThemeSync, applyThemeSync, planCount } from '../src/theme-sync.js';

const T = Date.UTC(2026, 9, 16, 12);
const slide = (blockId, o = {}) => ({ blockId, image: `shopify://shop_images/${blockId}.jpg`, title: blockId.toUpperCase(), subtitle: '', description: '', button1_text: 'Shop', button1_url: 'shopify://collections/x', button2_text: '', button2_url: '', tag: 'none', ...o });
const theme = (slides, msgs, modules = []) => ({
  slider: { sectionId: 'S', slides }, topbar: { sectionId: 'H', blockId: 'TB', messages: msgs }, style: { topbar: { bg: '#3b4041', color: '#ffffff' } }, modules,
});
const banner = (blockId, o = {}) => ({ id: `b-${blockId}`, kind: 'banner', source: `theme:S:${blockId}`, image: `https://cdn/x/${blockId}.jpg?v=1`, title: blockId.toUpperCase(), subtitle: '', description: '',
  button1_text: 'Shop', button1_url: '/collections/x', button2_text: '', button2_url: '', tag: 'none', order: 0, start: null, end: null, campaign: null, paused: false, state: 'approved', ...o });
const state = (o = {}) => ({ banners: [], topbar: [], tbstyles: [{ id: 's-default', kind: 'tbstyle', isDefault: true, bg: '#3b4041', color: '#ffffff', state: 'approved' }], campaigns: [], pmodules: [], pins: [], log: [], ...o });
const acts = (L) => L.map((x) => `${x.act}:${x.title}`);

test('一样的时候什么都不用做', () => {
  const s = state({ banners: [banner('a', { order: 0 }), banner('b', { order: 1 })], topbar: [{ id: 't1', kind: 'topbar', source: 'theme:H:TB:1', emoji: '', text: 'Free UK', link: '', order: 0, state: 'approved' }] });
  const p = planThemeSync(s, theme([slide('a'), slide('b')], [{ n: 1, emoji: '', text: 'Free UK', link: '' }]), T);
  assert.equal(planCount(p), 0);
});

test('Banner:新加 / 删掉的结束 / 改过的更新 / 顺序 / app 里自己建的上线中的提示暂停', () => {
  const s = state({ banners: [banner('a', { order: 0 }), banner('gone', { order: 1 }), banner('b', { order: 2, title: 'OLD' }), banner('c', { order: 3, paused: true }),
    { ...banner('mine'), source: undefined, id: 'b-mine', order: 4 }, { ...banner('promo'), source: undefined, id: 'b-promo', campaign: 'c1', order: 5 }] });
  const p = planThemeSync(s, theme([slide('new'), slide('b'), slide('a'), slide('c'), slide('off', { disabled: true })], []), T);
  assert.deepEqual(acts(p.banners).sort(), ['add:NEW', 'order:轮播顺序', 'pause:MINE', 'pause:PROMO', 'retire:GONE', 'revive:C', 'update:OLD'].sort());
  assert.equal(p.banners.find((x) => x.act === 'pause' && x.title === 'PROMO').pick, false, '挂在活动下的默认不勾');
  assert.match(p.banners.find((x) => x.act === 'update').why, /标题/);
  // 按勾选应用
  const built = { banners: [{ ...banner('new'), id: 'b-new', title: 'NEW' }, { ...banner('b'), title: 'B' }], bannerOrder: ['theme:S:new', 'theme:S:b', 'theme:S:a', 'theme:S:c'] };
  const picks = new Set(p.banners.filter((x) => x.pick).map((x) => x.key));
  const { effects, done } = applyThemeSync(s, p, picks, { built, now: T, actor: { name: '老板' } });
  const by = (id) => s.banners.find((x) => x.id === id);
  assert.equal(by('b-gone').end, T); assert.equal(by('b-b').title, 'B'); assert.equal(by('b-c').paused, false); assert.equal(by('b-mine').paused, true); assert.ok(!by('b-promo').paused);
  assert.deepEqual(s.banners.sort((x, y) => x.order - y.order).map((x) => x.id).slice(0, 4), ['b-new', 'b-b', 'b-a', 'b-c']);
  assert.ok(effects.some((e) => e.type === 'syncOrder' && e.kind === 'banner'));
  assert.ok(done.length >= 5); assert.equal(s.log[0].title, '对照正式主题');
  assert.equal(planCount(planThemeSync(s, theme([slide('new'), slide('b', { title: 'B' }), slide('a'), slide('c')], []), T)) - 1, 0, '对齐后只剩没勾的那条');
});

test('顶栏:新消息加进来、文字不一样的改、没了的结束;默认样式颜色', () => {
  const s = state({ topbar: [{ id: 't1', kind: 'topbar', source: 'theme:H:TB:1', emoji: '', text: 'Free UK', link: '', order: 0, state: 'approved' },
    { id: 't3', kind: 'topbar', source: 'theme:H:TB:3', emoji: '', text: 'Old', link: '', order: 1, state: 'approved' }] });
  const th = theme([], [{ n: 1, emoji: '🇬🇧', text: 'Free UK', link: '' }, { n: 2, emoji: '✈️', text: 'Worldwide', link: '' }]);
  th.style.topbar.bg = '#000000';
  const p = planThemeSync(s, th, T);
  assert.deepEqual(acts(p.topbar).sort(), ['add:✈️ Worldwide', 'retire:Old', 'update:Free UK'].sort());
  assert.equal(p.tbstyle[0].act, 'update');
  const picks = new Set([...p.topbar, ...p.tbstyle].map((x) => x.key));
  applyThemeSync(s, p, picks, { built: { topbar: [{ id: 't-theme2', kind: 'topbar', source: 'theme:H:TB:2', emoji: '✈️', text: 'Worldwide', state: 'approved', order: 1 }], topbarOrder: ['theme:H:TB:1', 'theme:H:TB:2'] }, now: T });
  assert.equal(s.topbar.find((x) => x.id === 't1').emoji, '🇬🇧'); assert.equal(s.topbar.find((x) => x.id === 't3').end, T);
  assert.equal(s.tbstyles[0].bg, '#000000');
});

test('商品模块:平时版本和编辑器不一样就更新;生效中的其他版本提示暂停', () => {
  const m = { module: 'sale', sectionId: 'P', title: 'Autumn', title2: 'Savings', titleColor: '', title2Color: '', tabActiveBg: '', tabActiveText: '',
    tabs: [{ blockId: 'k1', title: 'Top Picks', source: 'collection', collectionHandle: 'top', productHandles: [], onlyDiscounted: true, sortByDiscount: true, countdown: false, shopAllUrl: '', shopAllText: '' }] };
  const def = { id: 'pm-sale-default', kind: 'pmodule', module: 'sale', isDefault: true, source: 'theme:P:module', state: 'approved', title: 'Featured', title2: '',
    tabs: [{ title: 'Featured', source: 'collection', collection: { handle: 'featured' }, onlyDiscounted: false }] };
  const extra = { id: 'pm-x', kind: 'pmodule', module: 'sale', isDefault: false, state: 'approved', name: '测试版', start: null, end: null, tabs: [] };
  const s = state({ pmodules: [def, extra] });
  const p = planThemeSync(s, theme([], [], [m]), T);
  assert.deepEqual(acts(p.pmodules).sort(), ['pause:测试版', 'update:促销模块的平时版本'].sort());
  assert.match(p.pmodules.find((x) => x.act === 'update').why, /标题.*页签/);
  const built = { pmodules: [{ ...def, title: 'Autumn', title2: 'Savings', tabs: [{ id: 'tab-k1', title: 'Top Picks', source: 'collection', collection: { handle: 'top' }, onlyDiscounted: true, sortByDiscount: true }] }] };
  applyThemeSync(s, p, new Set(p.pmodules.map((x) => x.key)), { built, now: T });
  assert.equal(def.title, 'Autumn'); assert.equal(def.tabs[0].title, 'Top Picks'); assert.equal(extra.paused, true);
});
