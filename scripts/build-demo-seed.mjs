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

const THEME = process.argv[2]
  || path.join(os.homedir(), 'Vibe Coding Dev/Shopify Dev/_worktrees/cgp-theme-campaign');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-seed.json');
const FILES = 'https://cdn.shopify.com/s/files/1/1258/4351/files/';

const rd = (f) => JSON.parse(fs.readFileSync(path.join(THEME, f), 'utf8').replace(/^\/\*[\s\S]*?\*\//, ''));
const img = (ref) => (ref && ref.startsWith('shopify://shop_images/') ? FILES + ref.slice('shopify://shop_images/'.length) : ref || '');
const fileName = (ref) => (ref || '').split('/').pop().replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ');

// ---- Banner:主题里的 36 张 slide ----
const idx = rd('templates/index.json');
const sec = Object.values(idx.sections).find((s) => s.type === 'gpt-slider-banner-3' && !s.disabled);
const order = sec.block_order || Object.keys(sec.blocks);
const slides = order.map((id) => ({ id, ...sec.blocks[id].settings, disabled: !!sec.blocks[id].disabled }));

// 前台真实的卡片尺寸 / 字号 / 角标颜色 —— 预览照这个画,和网站一模一样的比例
const ss = sec.settings;
const slideStyle = {
  w: ss.desktop_slide_width, h: ss.desktop_slide_height, mw: ss.mobile_slide_width, mh: ss.mobile_slide_height,
  bg: ss.background_color, gap: ss.slide_gap,
  titleSize: ss.title_font_size, subtitleSize: ss.subtitle_font_size, descSize: ss.description_font_size,
  titleColor: ss.title_color, subtitleColor: ss.subtitle_color, descColor: ss.description_color,
  btnSize: ss.desktop_button_font_size, btnPadV: ss.button_padding_vertical, btnPadH: ss.button_padding_horizontal,
  btnRadius: ss.button_border_radius, btnGap: ss.button_gap,
  btn1: { bg: ss.button1_bg_color, color: ss.button1_text_color, border: ss.button1_border_color },
  btn2: { bg: ss.button2_bg_color, color: ss.button2_text_color, border: ss.button2_border_color },
  tags: Object.fromEntries(['new', 'sale', 'event'].map((k) => [k, { text: ss[`tag_${k}_text`], bg: ss[`tag_${k}_bg_color`], color: ss[`tag_${k}_text_color`] }])),
  tagTop: ss.tag_margin_top, tagLeft: ss.tag_margin_left, tagRadius: ss.tag_border_radius,
};
const settingsData = rd('config/settings_data.json');
const cur = typeof settingsData.current === 'string' ? settingsData.presets[settingsData.current] : settingsData.current;
slideStyle.radius = cur.media_radius ?? 12;

// 顶栏:header-group 里正在用的那套 Top Bar 的颜色和字号
const hg = rd('sections/header-group.json');
let topbarStyle = { bg: '#3B4041', color: '#ffffff', fontSize: 12, padV: 14 };
for (const sct of Object.values(hg.sections)) {
  for (const id of sct.block_order || []) {
    const b = sct.blocks[id];
    if (!b.disabled && b.settings && 'announcement_text_1' in b.settings) {
      topbarStyle = { bg: b.settings.background_color, color: b.settings.text_color, fontSize: b.settings.font_size, padV: b.settings.padding_vertical };
    }
  }
}

// 选择器用的合集 / 产品:从首页和顶栏里真实出现过的链接里取(演示用;正式版用 Shopify 自带的选择器)
const human = (h) => h.replace(/(\d)-(\d)/g, '$1.$2').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const linkText = fs.readFileSync(path.join(THEME, 'templates/index.json'), 'utf8') + fs.readFileSync(path.join(THEME, 'sections/header-group.json'), 'utf8');
const handles = (kind) => [...new Set([...linkText.matchAll(new RegExp(`(?:shopify://|cinegearpro\\.co\\.uk/)${kind}/([a-z0-9-]+)`, 'g'))].map((m) => m[1]))].sort();
const collections = handles('collections').filter((h) => h !== 'frontpage').map((h) => ({ handle: h, title: human(h) }));
const products = handles('products').map((h) => ({ id: 'demo-' + h, handle: h, title: human(h) }));

const live = slides.filter((s) => !s.disabled);
const off = slides.filter((s) => s.disabled);

let saleEnd = [5, 12, 20, 26];
const banners = [];
live.forEach((s, i) => {
  const isSale = s.tag === 'sale';
  banners.push({
    id: 'b-' + s.id.slice(-8), image: img(s.image),
    title: s.title || fileName(s.image), subtitle: s.subtitle || '', description: s.description || '',
    button1_text: s.button1_text || '', button1_url: s.button1_url || '',
    button2_text: s.button2_text || '', button2_url: s.button2_url || '',
    tag: s.tag || 'none', order: i,
    // 促销类给结束时间(演示「快到期」),新品类长期显示
    start: -(10 + i * 3), end: isSale ? saleEnd.shift() ?? null : null,
    state: 'approved', by: 'u1',
  });
});
// 停用的 19 张:2 张「已排期」(演示提前做好的新品 Banner)、1 张待审核、2 张草稿,其余已结束
off.forEach((s, i) => {
  const base = {
    id: 'b-' + s.id.slice(-8), image: img(s.image),
    title: s.title || fileName(s.image), subtitle: s.subtitle || '', description: s.description || '',
    button1_text: s.button1_text || '', button1_url: s.button1_url || '',
    button2_text: s.button2_text || '', button2_url: s.button2_url || '',
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
  { id: 't4', emoji: '🎄', text: 'Order by 20 Dec for Christmas delivery', link: '', category: '节日', start: 63, end: 82, state: 'approved', by: 'u1', order: 3 },
  { id: 't5', emoji: '🛒', text: 'Limited-time Deals on DZOFILM Vespid lenses 🔥', link: '/collections/dzofilm-vespid-prime-cine-lens', category: '促销', campaign: 'c3', start: null, end: null, state: 'approved', by: 'u1', order: 4 },
  { id: 't6', emoji: '🏖️', text: 'Spring Bank Holiday Deals', link: '/collections/spring-bank-holiday', category: '促销', campaign: 'c6', start: null, end: null, state: 'approved', by: 'u1', order: 5 },
  { id: 't7', emoji: '🎁', text: 'Holiday Deals — gifts for filmmakers', link: '/collections/holiday-deals', category: '节日', campaign: 'c5', start: null, end: null, state: 'draft', by: 'u2', order: 6 },
];

// ---- 活动(促销):参加的产品 = 合集 + 标签 + 手动指定的产品,满足任一即参加 ----
const P = (h) => products.find((p) => p.handle === h) || { id: 'demo-' + h, handle: h, title: human(h) };
const C = (h) => collections.find((c) => c.handle === h) || { handle: h, title: human(h) };
const campaigns = [
  { id: 'c1', name: 'Autumn Sale', start: 4, end: 13, collections: [C('dzofilm-sale'), C('cinediskpro-sale')], tags: ['autumn-sale'],
    products: [P('blazar-talon-1-5x-autofocus-full-frame-anamorphic-lens')], badge: 'Autumn Sale', countdown: true, priority: 10, state: 'approved', by: 'u1' },
  { id: 'c2', name: 'Fujifilm Cashback', start: -28, end: 32, collections: [C('fujifilm-cashback')], tags: [], products: [],
    badge: 'Claim cashback', countdown: false, priority: 5, state: 'approved', by: 'u1' },
  { id: 'c3', name: 'DZOFILM Vespid Limited Offer', start: -9, end: 5, collections: [C('dzofilm-vespid-prime-cine-lens'), C('dzofilm-vespid-prime-ii-cine-lens')], tags: [], products: [],
    badge: 'Limited Time Offer', countdown: true, priority: 15, state: 'approved', by: 'u1' },
  { id: 'c4', name: 'Black Friday 2026', start: 52, end: 63, collections: [C('flash-sale')], tags: ['black-friday'], products: [],
    badge: 'Black Friday', countdown: true, priority: 20, state: 'draft', by: 'u1' },
  { id: 'c5', name: 'Holiday Deals', start: 70, end: 95, collections: [C('holiday-deals')], tags: ['gift'],
    products: [P('tilta-boulder-36-camera-cart'), P('pdmovie-3d-air-solo-3d-filming-system')], badge: 'Holiday Deals', countdown: true, priority: 10, state: 'approved', by: 'u1' },
  { id: 'c6', name: 'Spring Bank Holiday Deals', start: -125, end: -118, collections: [C('spring-bank-holiday')], tags: [], products: [],
    badge: 'Bank Holiday', countdown: true, priority: 5, state: 'approved', by: 'u1' },
];
// 挂到活动下、跟随活动时间的 Banner
const vespid = banners.find((b) => /vespid prime sale/i.test(b.title));
if (vespid) Object.assign(vespid, { campaign: 'c3', start: null, end: null });
const gifts = banners.find((b) => /gift ideas/i.test(b.title));
if (gifts) Object.assign(gifts, { campaign: 'c5', start: null, end: null });

const seed = {
  version: 1,
  generatedFrom: 'theme cinegearpro-2-0-1 @ ' + new Date().toISOString().slice(0, 10),
  staff: [
    { id: 'u1', name: 'biglook shan', role: 'approver' },
    { id: 'u2', name: '编辑 A', role: 'editor' },
  ],
  me: 'u1',
  site: { slide: slideStyle, topbar: topbarStyle },
  collections, products,
  tagSuggestions: ['autumn-sale', 'black-friday', 'gift', 'clearance', 'DZOFILM', 'Anamorphic', 'cat:cine-lens', 'fit:sony-e'],
  banners, topbar, campaigns,
  log: [
    { at: -0.5, action: 'down', kind: 'banner', title: 'Spring Bank Holiday Deals', note: '到期自动下线' },
    { at: -1.2, action: 'up', kind: 'topbar', title: 'Free UK Delivery', note: '长期显示' },
    { at: -3, action: 'approve', kind: 'campaign', title: 'Autumn Sale', note: 'biglook shan 批准' },
    { at: -3.1, action: 'submit', kind: 'campaign', title: 'Autumn Sale', note: '编辑 A 提交审核' },
  ],
  settings: {
    larkWebhook: '',
    notify: { submit: true, decision: true, dayBefore: true, upDown: true, unapproved: true, failure: true },
  },
};

fs.writeFileSync(OUT, JSON.stringify(seed, null, 1));
console.log(`✓ ${OUT}\n  Banner ${banners.length} 张(线上 ${live.length}) · 顶栏 ${topbar.length} 条 · 活动 ${campaigns.length} 个 · 合集 ${collections.length} · 产品 ${products.length}`);
console.log('  卡片', slideStyle.w + '×' + slideStyle.h, '手机', slideStyle.mw + '×' + slideStyle.mh, '圆角', slideStyle.radius, '顶栏', JSON.stringify(topbarStyle));
