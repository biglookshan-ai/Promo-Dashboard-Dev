// 从主题的 JSON 配置里读出:首页 Banner(gpt-slider-banner-3 的 slide)、顶栏公告(Top Bar block)、
// 以及前台真实的卡片尺寸 / 字号 / 颜色。纯函数:
//   - scripts/build-demo-seed.mjs 用本地主题文件调用(演示数据)
//   - src/theme-import.js 用 Admin API 读到的线上主题调用(正式导入)
export const parseThemeJson = (text) => JSON.parse(String(text).replace(/^\s*\/\*[\s\S]*?\*\//, ''));

// shopify://products/x → /products/x(存进内容类型的是站内路径,主题直接当 href 用)
export function normalizeLink(url) {
  if (!url) return '';
  const m = String(url).match(/^shopify:\/\/(products|collections|pages|blogs)\/(.+)$/);
  if (m) return `/${m[1]}/${m[2]}`;
  if (url === 'shopify://collections') return '/collections';
  return url;
}
export const shopImageName = (ref) => (ref && ref.startsWith('shopify://shop_images/') ? ref.slice('shopify://shop_images/'.length) : '');

export function findSlider(indexJson) {
  const secs = Object.entries(indexJson.sections || {});
  const hit = secs.find(([, s]) => s.type === 'gpt-slider-banner-3' && !s.disabled);
  if (!hit) return null;
  const [sectionId, sec] = hit;
  const order = sec.block_order || Object.keys(sec.blocks || {});
  const slides = order.map((id, i) => ({ blockId: id, index: i, ...sec.blocks[id].settings, disabled: !!sec.blocks[id].disabled }));
  return { sectionId, settings: sec.settings || {}, slides };
}

export function findTopbar(headerGroupJson) {
  for (const [sectionId, sct] of Object.entries(headerGroupJson.sections || {})) {
    for (const id of sct.block_order || []) {
      const b = sct.blocks[id];
      if (!b.disabled && b.settings && 'announcement_text_1' in b.settings) {
        const s = b.settings;
        const messages = [1, 2, 3, 4, 5].map((n) => ({ n, emoji: s[`announcement_emoji_${n}`] || '', text: s[`announcement_text_${n}`] || '', link: normalizeLink(s[`announcement_link_${n}`] || '') }))
          .filter((m) => m.text.trim());
        return { sectionId, blockId: id, name: b.name || '', settings: s, messages };
      }
    }
  }
  return null;
}

export function siteStyle({ slider, topbar, settingsData }) {
  const ss = slider?.settings || {};
  const cur = settingsData ? (typeof settingsData.current === 'string' ? settingsData.presets?.[settingsData.current] : settingsData.current) || {} : {};
  const tb = topbar?.settings || {};
  return {
    slide: {
      w: ss.desktop_slide_width || 430, h: ss.desktop_slide_height || 600, mw: ss.mobile_slide_width || 320, mh: ss.mobile_slide_height || 450,
      bg: ss.background_color || '#f5f5f5', gap: ss.slide_gap ?? 20, radius: cur.media_radius ?? 12,
      titleSize: ss.title_font_size || 20, subtitleSize: ss.subtitle_font_size || 16, descSize: ss.description_font_size || 18,
      titleColor: ss.title_color || '#ffffff', subtitleColor: ss.subtitle_color || '#ffffff', descColor: ss.description_color || '#ffffff',
      btnSize: ss.desktop_button_font_size || 14, btnPadV: ss.button_padding_vertical ?? 1, btnPadH: ss.button_padding_horizontal ?? 9,
      btnRadius: ss.button_border_radius ?? 50, btnGap: ss.button_gap ?? 10,
      btn1: { bg: ss.button1_bg_color || '#ffffff', color: ss.button1_text_color || '#000000', border: ss.button1_border_color || 'rgba(0,0,0,0)' },
      btn2: { bg: ss.button2_bg_color || 'rgba(0,0,0,0)', color: ss.button2_text_color || '#ffffff', border: ss.button2_border_color || '#ffffff' },
      tags: Object.fromEntries(['new', 'sale', 'event'].map((k) => [k, {
        text: ss[`tag_${k}_text`] || k[0].toUpperCase() + k.slice(1), bg: ss[`tag_${k}_bg_color`] || '#333', color: ss[`tag_${k}_text_color`] || '#fff',
      }])),
      tagTop: ss.tag_margin_top ?? 15, tagLeft: ss.tag_margin_left ?? 15, tagRadius: ss.tag_border_radius ?? 4,
    },
    topbar: { bg: tb.background_color || '#3B4041', color: tb.text_color || '#ffffff', fontSize: tb.font_size || 12, padV: tb.padding_vertical || 14 },
  };
}
