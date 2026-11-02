// 首页 Banner 的「备用」同步到主题编辑器(2026-11-02 用户:编辑器里那一串 Slide 全部清掉,以后跟着网站更新中心
// 「上线中」的 Banner 自动更新 —— 万一主题读不到 app 的 Banner,首页轮播还有一份一样的;编辑器里尽量简单)。
//
// 主题怎么选(sections/gpt-slider-banner-3.liquid):店里有上线中的 cgp_banner_slide 就只用它们,一张都没有才用编辑器里的 slide。
// 所以这里写进编辑器的只是备份,平时前台根本不读。
//
// ⛔ 只改正在用的主题(MAIN)的 templates/index.json 里「没隐藏的 gpt-slider-banner-3」section 的 blocks + block_order,
//    别的 section、这个 section 自己的设置、隐藏的 section 一个字都不动(读 → 只换这两个键 → 写回)。
// 什么时候写:上线中的 Banner(顺序、图、文字、按钮、角标)和上次写的不一样 → 写一次;就算没变,每天也读一次核对
// (有人在编辑器里改过 / 编辑器开着很久再保存把旧的盖回去 → 改回来)。一张上线的都没有时不写(留着上一次的,免得首页轮播空掉)。
// 写之前把原文件存一份(DATA_DIR/theme-backup/<店>/,只留最近 20 份),要回退直接拿它。
// 要 write_themes 权限;没有就只记状态,Banner 页提示去开(出错后 30 分钟才再试,不刷屏)。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { graphql } from './shopify.js';
import { itemStatus, campaignIndex } from './schedule-core.js';

const SECTION_TYPE = 'gpt-slider-banner-3';
const FILE = 'templates/index.json';
const MAX_SLIDES = 50; // section 默认最多 50 个 block;主题读 app 的 Banner 一次也只读 50 个
export const CHECK_EVERY = 24 * 3600_000;
const RETRY_AFTER = 30 * 60_000;
const BLOCK_NAME = 'App 同步'; // 编辑器列表里显示「App 同步 – 标题」,一看就知道别在这里改
const TAGS = ['none', 'new', 'sale', 'event'];
const BACKUP_DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'theme-backup');

// app 里存的图片地址 → 主题设置用的写法 shopify://shop_images/<文件名>(文件库里的图);不是 Shopify 文件库的图就留空
export function imageRef(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('shopify://shop_images/')) return u;
  const m = u.match(/^https?:\/\/cdn\.shopify\.com\/s\/files\/[^?#]*\/files\/([^/?#]+)/);
  if (!m) return '';
  try { return `shopify://shop_images/${decodeURIComponent(m[1])}`; } catch { return ''; }
}
// /collections/x → shopify://collections/x(编辑器里显示成可点选的 Collection / 产品);带参数的、站外的原样
export function linkRef(url) {
  const u = String(url || '').trim();
  const m = u.match(/^\/(products|collections|pages|blogs)\/([^/?#]+)$/);
  return m ? `shopify://${m[1]}/${m[2]}` : u;
}
const videoRef = (url) => (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i.test(String(url || '').trim()) ? String(url).trim() : '');
const blockKey = (b) => `cgp_${String(b.id || '').replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 60);

// 此刻上线中的 Banner,按前台的顺序(position = order)
export function liveBanners(state, now = Date.now()) {
  const camps = campaignIndex(state.campaigns);
  return (state.banners || []).map((b, i) => ({ b, i }))
    .filter(({ b }) => itemStatus(b, camps, now) === 'live')
    .sort((x, y) => (x.b.order ?? 0) - (y.b.order ?? 0) || x.i - y.i)
    .map(({ b }) => b).slice(0, MAX_SLIDES);
}
export function slideBlocks(banners) {
  const blocks = {}, order = [];
  for (const b of banners) {
    const key = blockKey(b);
    if (blocks[key]) continue;
    blocks[key] = { type: 'slide', name: BLOCK_NAME, settings: {
      image: imageRef(b.image), title: b.title || '', subtitle: b.subtitle || '', description: b.description || '',
      button1_text: b.button1_text || '', button1_url: linkRef(b.button1_url), button1_video: videoRef(b.button1_video),
      button2_text: b.button2_text || '', button2_url: linkRef(b.button2_url), button2_video: videoRef(b.button2_video),
      tag: TAGS.includes(b.tag) ? b.tag : 'none',
    } };
    order.push(key);
  }
  return { blocks, order };
}
const sigOf = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

// 模板文件:开头可能有 Shopify 自动加的 /* ... */ 说明,解析时去掉、写回时原样放回
export function splitTemplate(text) {
  const m = String(text).match(/^\s*\/\*[\s\S]*?\*\/\s*/);
  return { head: m ? m[0] : '', json: JSON.parse(m ? text.slice(m[0].length) : text) };
}
// 把要的 slide 换进去(纯函数,方便测试)。返回新文件内容;没有要改的返回 null
export function applySlides(text, want) {
  const { head, json } = splitTemplate(text);
  const targets = Object.entries(json.sections || {}).filter(([, s]) => s.type === SECTION_TYPE && !s.disabled);
  if (!targets.length) throw new Error('主题首页没有开着的 Banner 轮播模块(gpt-slider-banner-3)');
  let changed = false, removed = 0;
  for (const [, s] of targets) {
    const same = JSON.stringify(s.block_order || []) === JSON.stringify(want.order) && JSON.stringify(s.blocks || {}) === JSON.stringify(want.blocks);
    if (same) continue;
    removed += Object.keys(s.blocks || {}).length;
    s.blocks = JSON.parse(JSON.stringify(want.blocks)); s.block_order = [...want.order];
    changed = true;
  }
  return changed ? { content: head + JSON.stringify(json, null, 2), removed, sections: targets.length } : null;
}

function backup(shop, themeId, content, now) {
  try {
    const dir = path.join(BACKUP_DIR, shop.replace(/[^a-z0-9.-]/gi, '_'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `index-${String(themeId).split('/').pop()}-${now}.json`), content);
    const old = fs.readdirSync(dir).filter((f) => f.startsWith('index-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 20))) fs.unlinkSync(path.join(dir, f));
  } catch (e) { console.error('[theme-banner-sync] 备份失败', e.message); }
}

const UPSERT = `mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $id, files: $files) { upsertedThemeFiles { filename } userErrors { field message code } } }`;

// 跑一次。force = 不管上次写过什么都读主题核对(「立即同步」按钮)。返回 { done, skipped?, count?, removed?, error? }
export async function syncThemeBanners(ctx, state, { now = Date.now(), force = false, gql = graphql, write = true } = {}) {
  const st = state.themeBanners ||= {};
  const live = liveBanners(state, now);
  if (!live.length) return { done: false, skipped: 'none-live' };
  const want = slideBlocks(live);
  const sig = sigOf(want);
  if (!force) {
    if (st.error && now - (st.errorAt || 0) < RETRY_AFTER && st.errorSig === sig) return { done: false, skipped: 'retry-later' };
    if (!st.error && st.sig === sig && now - (st.checkedAt || 0) < CHECK_EVERY) return { done: false, skipped: 'same' };
  }
  try {
    const t = await gql(ctx, '{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }');
    const theme = t.themes.nodes[0]; if (!theme) throw new Error('找不到正在使用的主题');
    const d = await gql(ctx, `query($id: ID!, $f: [String!]) { theme(id: $id) { files(first: 1, filenames: $f) {
      nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`, { id: theme.id, f: [FILE] });
    const text = d.theme?.files?.nodes?.[0]?.body?.content;
    if (!text) throw new Error('读不到主题首页的配置文件');
    const next = applySlides(text, want);
    if (next && write) {
      backup(ctx.shop, theme.id, text, now);
      const r = await gql(ctx, UPSERT, { id: theme.id, files: [{ filename: FILE, body: { type: 'TEXT', value: next.content } }] });
      const errs = r.themeFilesUpsert?.userErrors || [];
      if (errs.length) throw new Error(errs.map((e) => e.message).join(';'));
    }
    Object.assign(st, { sig, checkedAt: now, count: want.order.length, theme: theme.name, error: null, errorAt: null, errorSig: null,
      ...(next ? { syncedAt: now, removed: next.removed } : {}) });
    return { done: !!next, count: want.order.length, removed: next?.removed || 0, theme: theme.name };
  } catch (e) {
    let msg = String(e.message || e);
    if (/write_themes|access denied|ACCESS_DENIED/i.test(msg)) msg = 'app 还没有「改主题」权限(write_themes)';
    Object.assign(st, { error: msg, errorAt: now, errorSig: sig });
    return { done: false, error: msg };
  }
}
