// 生成排期界面的「演示数据」public/demo-seed.json。
// 用主题里真实的 Banner(36 张)和顶栏内容,再配几个示例活动 / 审核 / 日志,
// 让用户在不写入店铺的前提下体验管理、更新、审核、设置的完整流程。
//
// 日期一律存「相对今天的天数」,前端加载时再换算成具体时间 —— 这样哪天打开演示都合理。
//
//   node scripts/build-demo-seed.mjs [主题目录]
// 默认主题目录 = 排期分支的 worktree。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseThemeJson, findSlider, findTopbar, siteStyle, normalizeLink, shopImageName, findProductModules } from '../src/theme-content.js';

const THEME = process.argv[2]
  || path.join(os.homedir(), 'Vibe Coding Dev/Shopify Dev/_worktrees/cgp-theme-campaign');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-seed.json');
const FILES = 'https://cdn.shopify.com/s/files/1/1258/4351/files/';

const rd = (f) => parseThemeJson(fs.readFileSync(path.join(THEME, f), 'utf8'));
const img = (ref) => (shopImageName(ref) ? FILES + shopImageName(ref) : ref || '');
const fileName = (ref) => (ref || '').split('/').pop().replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ');

// ---- Banner / 顶栏 / 前台样式:和正式导入用同一套解析(src/theme-content.js)----
const slider = findSlider(rd('templates/index.json'));
const tbBlock = findTopbar(rd('sections/header-group.json'));
const style = siteStyle({ slider, topbar: tbBlock, settingsData: rd('config/settings_data.json') });
const slideStyle = style.slide, topbarStyle = style.topbar;
const slides = slider.slides.map((x) => ({ ...x, id: x.blockId }));

// 选择器用的合集 / 产品:从首页和顶栏里真实出现过的链接里取(演示用;正式版用 Shopify 自带的选择器)
const human = (h) => h.replace(/(\d)-(\d)/g, '$1.$2').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const linkText = fs.readFileSync(path.join(THEME, 'templates/index.json'), 'utf8') + fs.readFileSync(path.join(THEME, 'sections/header-group.json'), 'utf8');
const handles = (kind) => [...new Set([...linkText.matchAll(new RegExp(`(?:shopify://|cinegearpro\\.co\\.uk/)${kind}/([a-z0-9-]+)`, 'g'))].map((m) => m[1]))].sort();
// 有 scripts/demo-catalog.json(fetch-demo-catalog.mjs 从前台公开 JSON 读的)就用真实的产品数 / 标签数 / 产品图
const CATALOG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-catalog.json');
const cat = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : null;
const small = (src) => (src ? src.replace(/(\.[a-z]+)(\?|$)/i, '_200x$1$2') : '');
const collections = cat
  ? cat.collections.filter((c) => !c.missing).map((c) => ({ id: c.id, handle: c.handle, title: c.title, count: c.count }))
  : handles('collections').filter((h) => h !== 'frontpage').map((h) => ({ handle: h, title: human(h) }));
const catProduct = (h) => cat?.products.find((p) => p.handle === h);
const toP = (p) => ({ id: p.id, handle: p.handle, title: p.title, image: small(p.image) });
const products = [
  ...handles('products').map((h) => (catProduct(h) ? toP(catProduct(h)) : { id: null, handle: h, title: human(h) })),
  ...(cat ? cat.products.filter((p) => p.tags.includes('New Gear')).slice(0, 150).map(toP) : []),
].filter((p, i, a) => a.findIndex((q) => q.handle === p.handle) === i);
const USED_TAGS = ['Clearance', 'DZOFILM Prime Lens', 'BFCM', 'Gift idea', 'DailySale'];
const tagCounts = cat
  ? Object.fromEntries(Object.entries(cat.tagCounts).filter(([t, n]) => n >= 10 || USED_TAGS.includes(t)).sort((a, b) => b[1] - a[1]).slice(0, 120))
  : {};

const live = slides.filter((s) => !s.disabled);
const off = slides.filter((s) => s.disabled);

let saleEnd = [2, 12, 20, 26];
const banners = [];
live.forEach((s, i) => {
  const isSale = s.tag === 'sale';
  banners.push({
    id: 'b-' + s.id.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, ''), image: img(s.image),
    title: s.title || fileName(s.image), subtitle: s.subtitle || '', description: s.description || '',
    button1_text: s.button1_text || '', button1_url: normalizeLink(s.button1_url),
    button2_text: s.button2_text || '', button2_url: normalizeLink(s.button2_url),
    tag: s.tag || 'none', order: i,
    // 促销类给结束时间(演示「快到期」),新品类长期显示
    start: -(10 + i * 3), end: isSale ? saleEnd.shift() ?? null : null,
    state: 'approved', by: 'u1',
  });
});
// 停用的 19 张:2 张「已排期」(演示提前做好的新品 Banner)、1 张待审核、2 张草稿,其余已结束
off.forEach((s, i) => {
  const base = {
    id: 'b-' + s.id.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, ''), image: img(s.image),
    title: s.title || fileName(s.image), subtitle: s.subtitle || '', description: s.description || '',
    button1_text: s.button1_text || '', button1_url: normalizeLink(s.button1_url),
    button2_text: s.button2_text || '', button2_url: normalizeLink(s.button2_url),
    tag: s.tag || 'none', order: live.length + i, by: 'u1',
  };
  if (i === 0) banners.push({ ...base, tag: 'new', start: 9, end: null, state: 'approved', note: '提前一周做好,9 天后自动上线' });
  else if (i === 1) banners.push({ ...base, start: 16, end: 40, state: 'approved' });
  else if (i === 2) banners.push({ ...base, start: 4, end: 13, state: 'pending', by: 'u2', campaign: 'c1' });
  else if (i <= 4) banners.push({ ...base, start: null, end: null, state: 'draft', by: 'u2' });
  else banners.push({ ...base, start: -(120 - i * 4), end: -(80 - i * 4), state: 'approved' });
});

// ---- 顶栏:线上现有的包邮公告 + 示例 ----
const topbar = [
  { id: 't1', emoji: '🚚', text: 'Free UK Delivery - On all online orders over £100 🇬🇧', link: '', category: '服务', start: null, end: null, state: 'approved', by: 'u1', order: 0,
    pendingChange: { text: 'Free UK Delivery on orders over £100 · Next-day available', by: 'u2', at: -0.2 } },
  { id: 't2', emoji: '🍂', text: 'Autumn Sale — up to 30% off cine lenses', link: '/collections/autumn-sale', category: '促销', campaign: 'c1', start: null, end: null, state: 'approved', by: 'u1', order: 1 },
  { id: 't3', emoji: '🆕', text: 'DZOFILM Arles Zoom now available', link: '/collections/dzofilm', category: '新品', start: 9, end: 30, state: 'approved', by: 'u1', order: 2 },
  { id: 't4', emoji: '🎄', text: 'Order by 20 Dec for Christmas delivery', link: '', category: '节日', start: '2026-11-20', end: '2026-12-21', state: 'approved', by: 'u1', order: 3 },
  { id: 't5', emoji: '🛒', text: 'Limited-time Deals on DZOFILM Vespid lenses 🔥', link: '/collections/dzofilm-vespid-prime-cine-lens', category: '促销', campaign: 'c3', start: null, end: null, state: 'approved', by: 'u1', order: 4 },
  { id: 't6', emoji: '🏖️', text: 'Spring Bank Holiday Deals', link: '/collections/spring-bank-holiday', category: '促销', campaign: 'c6', start: null, end: null, state: 'approved', by: 'u1', order: 5 },
  { id: 't7', emoji: '🎁', text: 'Holiday Deals — gifts for filmmakers', link: '/collections/holiday-deals', category: '节日', campaign: 'c5', start: null, end: null, state: 'draft', by: 'u2', order: 6 },
];

// ---- 活动(促销):参加的产品 = 合集 + 标签 + 手动指定的产品,满足任一即参加 ----
const P = (h) => products.find((p) => p.handle === h) || { id: 'demo-' + h, handle: h, title: human(h) };
const C = (h) => collections.find((c) => c.handle === h) || { handle: h, title: human(h) };
const campaigns = [
  { id: 'c1', name: 'Autumn Sale', start: 4, end: 13, collections: [C('cinediskpro-sale'), C('flash-sale')], tags: ['Clearance'],
    products: [P('blazar-talon-1-5x-autofocus-full-frame-anamorphic-lens')], badge: 'Autumn Sale', countdown: true, priority: 10, state: 'approved', by: 'u1' },
  { id: 'c2', name: 'Fujifilm Cashback', start: -28, end: 32, collections: [C('fujifilm-cashback')], tags: [], products: [],
    badge: 'Claim cashback', countdown: false, priority: 5, state: 'approved', by: 'u1' },
  { id: 'c3', name: 'DZOFILM Vespid Limited Offer', start: -9, end: 2, collections: [C('dzofilm-vespid-prime-cine-lens'), C('dzofilm-vespid-prime-ii-cine-lens')], tags: ['DZOFILM Prime Lens'], products: [],
    badge: 'Limited Time Offer', countdown: true, priority: 15, state: 'approved', by: 'u1' },
  { id: 'c4', name: 'Black Friday 2026', start: '2026-11-20', end: '2026-12-01', collections: [C('flash-sale')], tags: ['BFCM'], products: [],
    badge: 'Black Friday', countdown: true, priority: 20, state: 'draft', by: 'u1' },
  { id: 'c5', name: 'Holiday Deals', start: '2026-12-08', end: '2027-01-02', collections: [C('holiday-deals')], tags: ['Gift idea'],
    products: [P('tilta-boulder-36-camera-cart'), P('pdmovie-3d-air-solo-3d-filming-system')], badge: 'Holiday Deals', countdown: true, priority: 10, state: 'approved', by: 'u1' },
  { id: 'c6', name: 'Spring Bank Holiday Deals', start: -125, end: -118, collections: [C('spring-bank-holiday')], tags: [], products: [],
    badge: 'Bank Holiday', countdown: true, priority: 5, state: 'approved', by: 'u1' },
];

// ---- 顶栏样式(节日主题):默认 = 主题里现在的配色;其他按时间或跟随活动自动换 ----
const tbstyles = [
  { id: 's0', name: '默认样式', isDefault: true, bg: topbarStyle.bg, color: topbarStyle.color, accent: '#fcc900', effect: 'none', decoLeft: '', decoRight: '',
    start: null, end: null, state: 'approved', by: 'u1', priority: 0 },
  { id: 's1', name: 'Black Friday', bg: '#0b0b0b', color: '#ffd400', accent: '#ffffff', effect: 'sparkle', decoLeft: '⚡', decoRight: '⚡',
    campaign: 'c4', start: null, end: null, state: 'approved', by: 'u1', priority: 20 },
  { id: 's2', name: '圣诞节', bg: '#9b1c1c', color: '#ffffff', accent: '#f5d06f', effect: 'snow', decoLeft: '🎄', decoRight: '🎅',
    start: '2026-12-01', end: '2026-12-27', state: 'approved', by: 'u1', priority: 10 },
  { id: 's3', name: '新年', bg: '#1b2a4a', color: '#ffffff', accent: '#f5d06f', effect: 'confetti', decoLeft: '🎉', decoRight: '',
    start: '2026-12-31', end: '2027-01-03', state: 'draft', by: 'u2', priority: 10 },
];

// 挂到活动下、跟随活动时间的 Banner
const vespid = banners.find((b) => /vespid prime sale/i.test(b.title));
if (vespid) Object.assign(vespid, { campaign: 'c3', start: null, end: null });
const gifts = banners.find((b) => /gift ideas/i.test(b.title));
if (gifts) Object.assign(gifts, { campaign: 'c5', start: null, end: null });

// ---- 首页商品模块:平时版本 = 主题里现在的配置;另外几个版本跟着活动换 ----
const tabOf = (id, title, handle, o = {}) => ({ id, title, source: 'collection', collection: C(handle), products: [], onlyDiscounted: false, sortByDiscount: false,
  newestFirst: false, countdown: false, limit: 20, shopAllUrl: '', shopAllText: '', ...o });
const pmodules = findProductModules(rd('templates/index.json')).map((m) => ({
  id: `pm-${m.module}-default`, module: m.module, isDefault: true, name: m.module === 'sale' ? '平时版本(促销模块)' : '平时版本(推荐模块)',
  title: m.title, title2: m.title2, titleColor: m.titleColor, title2Color: m.title2Color, tabActiveBg: m.tabActiveBg, tabActiveText: m.tabActiveText,
  tabs: m.tabs.filter((t) => t.source === 'collection').map((t, i) => tabOf(`tab-${m.module}-${i}`, t.title || C(t.collectionHandle).title, t.collectionHandle,
    { onlyDiscounted: t.onlyDiscounted, sortByDiscount: t.sortByDiscount, countdown: t.countdown, limit: 0, shopAllUrl: t.shopAllUrl, shopAllText: t.shopAllText })),
  priority: 0, start: null, end: null, state: 'approved', by: 'u1', order: 0, note: '从主题导入',
}));
pmodules.push(
  { id: 'pm-autumn', module: 'sale', name: 'Autumn Sale', title: '', title2: 'Autumn Sale', titleColor: '#525258', title2Color: '#ee8849', tabActiveBg: '#ee8849', tabActiveText: '#f9f9f9',
    tabs: [tabOf('tab-a1', 'Top Picks', 'flash-sale', { onlyDiscounted: true, sortByDiscount: true }), tabOf('tab-a2', 'Clearance', 'clearance', { onlyDiscounted: true, sortByDiscount: true, countdown: true })],
    priority: 10, campaign: 'c1', start: null, end: null, state: 'approved', by: 'u1', order: 1 },
  { id: 'pm-bf', module: 'sale', name: 'Black Friday', title: 'Black Friday', title2: 'Deals', titleColor: '#111111', title2Color: '#d10000', tabActiveBg: '#111111', tabActiveText: '#ffd400',
    tabs: [tabOf('tab-b1', 'Doorbusters', 'flash-sale', { onlyDiscounted: true, sortByDiscount: true, countdown: true }), tabOf('tab-b2', 'DZOFILM', 'dzofilm', { onlyDiscounted: true })],
    priority: 20, campaign: 'c4', start: null, end: null, state: 'pending', by: 'u2', order: 2 },
  { id: 'pm-holiday', module: 'sale', name: 'Holiday Deals', title: 'Holiday', title2: 'Deals', titleColor: '#525258', title2Color: '#9b1c1c', tabActiveBg: '#9b1c1c', tabActiveText: '#ffffff',
    tabs: [tabOf('tab-h1', 'Gift Picks', 'gift-ideas'), tabOf('tab-h2', 'Holiday Deals', 'holiday-deals', { onlyDiscounted: true, sortByDiscount: true })],
    priority: 10, campaign: 'c5', start: null, end: null, state: 'approved', by: 'u1', order: 3 },
  { id: 'pm-newin', module: 'feature', name: 'New In 十月', title: 'New', title2: 'Arrivals', titleColor: '#525258', title2Color: '#fcc900', tabActiveBg: '#fcc900', tabActiveText: '#1b1c1d',
    tabs: [tabOf('tab-n1', 'Just Landed', 'dzofilm', { newestFirst: true, limit: 20 }), tabOf('tab-n2', 'Staff Picks', 'gift-ideas')],
    priority: 10, start: 2, end: 30, state: 'approved', by: 'u1', order: 1 },
);

const seed = {
  version: 1,
  generatedFrom: 'theme cinegearpro-2-0-1 @ ' + new Date().toISOString().slice(0, 10),
  staff: [
    { id: 'u1', name: 'biglook shan', role: 'approver' },
    { id: 'u2', name: '编辑 A', role: 'editor' },
  ],
  me: 'u1',
  site: { slide: slideStyle, topbar: topbarStyle },
  store: { handle: 'cinegearpro', domain: 'https://www.cinegearpro.co.uk' },
  catalogFetchedAt: cat?.fetchedAt || null,
  collections, products, tagCounts,
  banners, topbar, tbstyles, campaigns, pmodules,
  log: [
    { at: -0.5, action: 'down', kind: 'banner', title: 'Spring Bank Holiday Deals', note: '到期自动下线' },
    { at: -1.2, action: 'up', kind: 'topbar', title: 'Free UK Delivery', note: '长期显示' },
    { at: -3, action: 'approve', kind: 'campaign', title: 'Autumn Sale', note: 'biglook shan 批准' },
    { at: -3.1, action: 'submit', kind: 'campaign', title: 'Autumn Sale', note: '编辑 A 提交审核' },
  ],
  settings: {
    larkWebhook: '',
    notify: { submit: true, decision: true, dayBefore: true, endingSoon: true, upDown: true, unapproved: true, failure: true },
  },
};

fs.writeFileSync(OUT, JSON.stringify(seed, null, 1));
console.log(`✓ ${OUT}\n  Banner ${banners.length} 张(线上 ${live.length}) · 顶栏 ${topbar.length} 条 · 活动 ${campaigns.length} 个 · 合集 ${collections.length} · 产品 ${products.length}`);
console.log('  卡片', slideStyle.w + '×' + slideStyle.h, '手机', slideStyle.mw + '×' + slideStyle.mh, '圆角', slideStyle.radius, '顶栏', JSON.stringify(topbarStyle));
