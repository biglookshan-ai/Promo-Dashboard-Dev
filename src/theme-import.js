// 从线上主题(只读)导入现有内容:首页正在显示的 Banner、顶栏公告、顶栏配色(当默认样式)。
// 读主题要 read_themes;图片要在文件库里找到对应文件(write_files 含读)。
// 导入的内容直接是「已批准 + 长期显示」,顺序和主题里一样 —— 和现在网站上看到的一致。
import { graphql } from './shopify.js';
import { parseThemeJson, findSlider, findTopbar, siteStyle, normalizeLink, shopImageName } from './theme-content.js';
import { findImageByFilename, createImageFromUrl } from './files.js';

const FILES = ['templates/index.json', 'sections/header-group.json', 'config/settings_data.json'];

export async function readMainTheme(ctx, gql = graphql) {
  const t = await gql(ctx, '{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }');
  const theme = t.themes.nodes[0];
  if (!theme) throw new Error('找不到正在使用的主题');
  const d = await gql(ctx, `query($id: ID!, $f: [String!]) { theme(id: $id) { files(first: 10, filenames: $f) {
      nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`, { id: theme.id, f: FILES });
  const byName = Object.fromEntries(d.theme.files.nodes.map((n) => [n.filename, n.body?.content || '']));
  const index = byName['templates/index.json'] ? parseThemeJson(byName['templates/index.json']) : { sections: {} };
  const header = byName['sections/header-group.json'] ? parseThemeJson(byName['sections/header-group.json']) : { sections: {} };
  const settings = byName['config/settings_data.json'] ? parseThemeJson(byName['config/settings_data.json']) : null;
  const slider = findSlider(index), topbar = findTopbar(header);
  return { theme, slider, topbar, style: siteStyle({ slider, topbar, settingsData: settings }) };
}

// 生成要导入的条目(不写 Shopify;写入交给同步)。existing = 已有条目的 source 集合,避免重复导入。
export async function buildImport(ctx, { slider, topbar, style }, existingSources = new Set(), { resolveImage, now = Date.now(), actor } = {}, gql = graphql) {
  const resolve = resolveImage || (async (ref) => {
    const name = shopImageName(ref);
    if (!name) return null;
    return (await findImageByFilename(ctx, name, gql)) || null;
  });
  const banners = [], topbar_ = [], tbstyles = [], skipped = [];
  const live = (slider?.slides || []).filter((s) => !s.disabled);
  let order = 0;
  for (const s of live) {
    const source = `theme:${slider.sectionId}:${s.blockId}`;
    if (existingSources.has(source)) { skipped.push({ title: s.title, reason: '已经导入过' }); continue; }
    let file = await resolve(s.image).catch(() => null);
    if (!file && shopImageName(s.image)) file = await createImageFromUrl(ctx, `https://${ctx.shop}/cdn/shop/files/${encodeURIComponent(shopImageName(s.image))}`, gql).catch(() => null);
    if (!file) { skipped.push({ title: s.title, reason: '在文件库里找不到这张图' }); continue; }
    banners.push({
      id: `b-${s.blockId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-10)}`, kind: 'banner', source,
      image: file.url, imageId: file.id, title: s.title || '', subtitle: s.subtitle || '', description: s.description || '',
      button1_text: s.button1_text || '', button1_url: normalizeLink(s.button1_url), button2_text: s.button2_text || '', button2_url: normalizeLink(s.button2_url),
      tag: s.tag || 'none', order: order++, start: null, end: null, campaign: null, paused: false,
      state: 'approved', by: actor?.id || null, note: '从主题导入',
    });
  }
  (topbar?.messages || []).forEach((m, i) => {
    const source = `theme:${topbar.sectionId}:${topbar.blockId}:${m.n}`;
    if (existingSources.has(source)) return;
    topbar_.push({ id: `t-theme${m.n}`, kind: 'topbar', source, emoji: m.emoji, text: m.text, link: m.link, category: '公告', order: i,
      start: null, end: null, campaign: null, paused: false, state: 'approved', by: actor?.id || null, note: '从主题导入' });
  });
  if (topbar && !existingSources.has('theme:topbar-style')) {
    tbstyles.push({ id: 's-default', kind: 'tbstyle', source: 'theme:topbar-style', name: '默认样式', isDefault: true,
      bg: style.topbar.bg, color: style.topbar.color, accent: '#fcc900', effect: 'none', decoLeft: '', decoRight: '', priority: 0,
      start: null, end: null, campaign: null, paused: false, state: 'approved', by: actor?.id || null, order: 0 });
  }
  return { banners, topbar: topbar_, tbstyles, skipped, disabledSlides: (slider?.slides || []).length - live.length, at: now };
}
