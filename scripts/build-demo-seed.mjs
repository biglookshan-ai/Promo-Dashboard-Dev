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
  { id: 't5', emoji: '🛒', text: 'Limited-time Deals on DZOFILM Vespid lenses 🔥', link: '/collections/dzofilm-vespid-prime-cine-lens', category: '促销', start: -60, end: -30, state: 'approved', by: 'u1', order: 4 },
  { id: 't6', emoji: '🏖️', text: 'Spring Bank Holiday Deals', link: '/collections/spring-bank-holiday-deals', category: '促销', start: -125, end: -118, state: 'approved', by: 'u1', order: 5 },
];

// ---- 活动 ----
const summer = banners.find((b) => /summer/i.test(b.title));
const campaigns = [
  { id: 'c1', name: 'Autumn Sale', start: 4, end: 13, collection: 'autumn-sale', extra: ['DZOFILM VESPID 2 Prime 4 Lens Set'], badge: 'Autumn Sale', countdown: true, priority: 10, state: 'approved', by: 'u1' },
  { id: 'c2', name: 'Fujifilm Cashback', start: -28, end: 32, collection: 'fujifilm-promotion', extra: [], badge: 'Claim cashback', countdown: false, priority: 5, state: 'approved', by: 'u1' },
  { id: 'c3', name: 'Black Friday 2026', start: 52, end: 63, collection: 'black-friday', extra: [], badge: 'Black Friday', countdown: true, priority: 20, state: 'draft', by: 'u1' },
  { id: 'c4', name: 'Godox Summer Sale', start: -90, end: -29, collection: 'godox', extra: [], badge: 'Summer Sale', countdown: true, priority: 5, state: 'approved', by: 'u1' },
];
if (summer) { summer.campaign = 'c4'; summer.start = null; summer.end = null; }

const seed = {
  version: 1,
  generatedFrom: 'theme cinegearpro-2-0-1 @ ' + new Date().toISOString().slice(0, 10),
  staff: [
    { id: 'u1', name: 'biglook shan', role: 'approver' },
    { id: 'u2', name: '编辑 A', role: 'editor' },
  ],
  me: 'u1',
  collections: ['autumn-sale', 'fujifilm-promotion', 'black-friday', 'godox', 'dzofilm', 'dzofilm-vespid-prime-cine-lens',
    'clearance', 'staff-picks', 'cine-lenses', 'camera-dept', 'spring-bank-holiday-deals', 'easter-deals', 'thypoch', 'cinediskpro'],
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
console.log(`✓ ${OUT}\n  Banner ${banners.length} 张(线上 ${live.length}) · 顶栏 ${topbar.length} 条 · 活动 ${campaigns.length} 个`);
