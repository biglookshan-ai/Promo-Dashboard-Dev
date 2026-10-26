// 上线前「对照正式主题」:把 app 里的 Banner / 顶栏公告 / 顶栏默认样式 / 两个商品模块的平时版本,对齐成正式主题(编辑器里)现在的样子。
// 为什么要它:主题改造一上线,首页就改成显示 app 里的内容;app 里的是某天「从主题导入」的,之后编辑器里换过的(加了新 Banner、删了旧的、
// 改了文案、换了页签)都没跟上。上线前先对齐,上线那一刻首页才和现在一模一样。
//
// planThemeSync(state, theme, now) —— 纯函数,列出每一处不同(给页面勾选)
// applyThemeSync(state, plan, picks, { built, now, actor }) —— 按勾选改 state,返回要写店铺的 effects
//   built = buildImport(...) 的结果(新加 / 要更新的那些,图片已经在文件库里找好)
import { itemStatus, campaignIndex } from './schedule-core.js';
import { normalizeLink, shopImageName } from './theme-content.js';
import { titleOf } from './schedule-actions.js';

const baseName = (url) => String(url || '').split('?')[0].split('/').pop();
const norm = (v) => String(v ?? '').trim();
const active = (it, camps, now) => ['live', 'scheduled', 'waiting'].includes(itemStatus(it, camps, now));
const isLive = (it, camps, now) => itemStatus(it, camps, now) === 'live';

// 主题里一张 slide 和 app 里那张 Banner 哪些字段不一样
const BANNER_FIELDS = [['title', '标题'], ['subtitle', '副标题'], ['description', '描述'], ['button1_text', '按钮 1 文字'], ['button1_url', '按钮 1 链接'],
  ['button2_text', '按钮 2 文字'], ['button2_url', '按钮 2 链接'], ['button1_video', '按钮 1 视频'], ['button2_video', '按钮 2 视频'], ['tag', '角标']];
function bannerDiff(slide, b) {
  const out = [];
  for (const [k, cn] of BANNER_FIELDS) {
    const tv = k.endsWith('_url') ? normalizeLink(slide[k]) : k === 'tag' ? (slide.tag || 'none') : slide[k];
    if (norm(tv) !== norm(b[k])) out.push(cn);
  }
  const img = shopImageName(slide.image);
  if (img && img !== baseName(b.image)) out.push('图片');
  return out;
}
const tabSig = (t) => JSON.stringify([norm(t.title), t.source, t.source === 'products' ? (t.productHandles || (t.products || []).map((p) => p.handle)) : (t.collectionHandle || t.collection?.handle || ''),
  !!t.onlyDiscounted, !!t.sortByDiscount, !!t.countdown, norm(t.shopAllUrl), norm(t.shopAllText)]);
function moduleDiff(m, v) {
  const out = [];
  if (norm(m.title) !== norm(v.title) || norm(m.title2) !== norm(v.title2)) out.push('标题');
  if ([['titleColor'], ['title2Color'], ['tabActiveBg'], ['tabActiveText']].some(([k]) => norm(m[k]).toLowerCase() !== norm(v[k]).toLowerCase())) out.push('颜色');
  const a = m.tabs.map(tabSig).join('|'), b = (v.tabs || []).map(tabSig).join('|');
  if (a !== b) out.push(`页签(主题:${m.tabs.map((t) => t.title || t.collectionHandle).join(' / ') || '无'};app:${(v.tabs || []).map((t) => t.title || t.collection?.title || '').join(' / ') || '无'})`);
  return out;
}

export function planThemeSync(state, theme, now = Date.now()) {
  const camps = campaignIndex(state.campaigns);
  const plan = { banners: [], topbar: [], tbstyle: [], pmodules: [], notes: [] };
  // ---- Banner ----
  const slides = (theme.slider?.slides || []).filter((s) => !s.disabled);
  const srcOf = (s) => `theme:${theme.slider.sectionId}:${s.blockId}`;
  const bySrc = new Map(state.banners.filter((b) => b.source).map((b) => [b.source, b]));
  const want = new Set(slides.map(srcOf));
  slides.forEach((s, i) => {
    const b = bySrc.get(srcOf(s));
    if (!b) { plan.banners.push({ key: `add:${srcOf(s)}`, act: 'add', source: srcOf(s), title: s.title || '(无标题)', why: '正式网站有,app 里没有 → 加进来(长期显示)', pick: true, pos: i }); return; }
    const d = bannerDiff(s, b);
    if (d.length) plan.banners.push({ key: `update:${b.id}`, act: 'update', id: b.id, source: b.source, title: titleOf(b), why: `内容不一样:${d.join('、')} → 改成正式网站上的`, pick: true });
    if (!isLive(b, camps, now)) plan.banners.push({ key: `revive:${b.id}`, act: 'revive', id: b.id, title: titleOf(b), why: '正式网站在显示,app 里是暂停 / 已结束 / 没批准 → 改成长期显示', pick: true });
  });
  for (const b of state.banners) {
    if (b.source?.startsWith('theme:') && !want.has(b.source) && active(b, camps, now)) {
      plan.banners.push({ key: `retire:${b.id}`, act: 'retire', id: b.id, title: titleOf(b), why: '正式网站已经删掉或停用了 → 结束(下线)', pick: true });
    } else if (!b.source?.startsWith('theme:') && isLive(b, camps, now)) {
      plan.banners.push({ key: `pause:${b.id}`, act: 'pause', id: b.id, title: titleOf(b), why: `app 里建的,现在算「上线中」;正式网站现在没有它 → 勾上 = 先暂停,不勾 = 上线后就出现${b.campaign ? '(它挂在活动下)' : ''}`, pick: !b.campaign });
    }
  }
  const curOrder = state.banners.filter((b) => b.source && want.has(b.source)).sort((a, b) => a.order - b.order).map((b) => b.source);
  if (curOrder.join('|') !== slides.map(srcOf).filter((x) => bySrc.has(x)).join('|')) plan.banners.push({ key: 'order:banner', act: 'order', title: '轮播顺序', why: '顺序和正式网站不一样 → 按正式网站排(app 里自己建的排在后面)', pick: true });
  // ---- 顶栏公告 ----
  if (theme.topbar) {
    const tsrc = (m) => `theme:${theme.topbar.sectionId}:${theme.topbar.blockId}:${m.n}`;
    const tBySrc = new Map(state.topbar.filter((t) => t.source).map((t) => [t.source, t]));
    const tWant = new Set(theme.topbar.messages.map(tsrc));
    theme.topbar.messages.forEach((m, i) => {
      const t = tBySrc.get(tsrc(m));
      if (!t) { plan.topbar.push({ key: `add:${tsrc(m)}`, act: 'add', source: tsrc(m), title: `${m.emoji} ${m.text}`.trim(), why: '正式网站有,app 里没有 → 加进来(长期显示)', pick: true, pos: i }); return; }
      const d = [['emoji', 'Emoji'], ['text', '文字'], ['link', '链接']].filter(([k]) => norm(k === 'link' ? normalizeLink(m[k]) : m[k]) !== norm(t[k])).map(([, cn]) => cn);
      if (d.length) plan.topbar.push({ key: `update:${t.id}`, act: 'update', id: t.id, title: titleOf(t), why: `内容不一样:${d.join('、')} → 改成正式网站上的`, pick: true, msg: m });
      if (!isLive(t, camps, now)) plan.topbar.push({ key: `revive:${t.id}`, act: 'revive', id: t.id, title: titleOf(t), why: '正式网站在显示,app 里不是上线中 → 改成长期显示', pick: true });
    });
    for (const t of state.topbar) {
      if (t.source?.startsWith('theme:') && !tWant.has(t.source) && active(t, camps, now)) plan.topbar.push({ key: `retire:${t.id}`, act: 'retire', id: t.id, title: titleOf(t), why: '正式网站上已经没有这条 → 结束(下线)', pick: true });
      else if (!t.source?.startsWith('theme:') && isLive(t, camps, now)) plan.topbar.push({ key: `pause:${t.id}`, act: 'pause', id: t.id, title: titleOf(t), why: `app 里建的,现在算「上线中」;正式网站现在没有它 → 勾上 = 先暂停${t.campaign ? '(它挂在活动下)' : ''}`, pick: !t.campaign });
    }
    const tOrder = state.topbar.filter((t) => t.source && tWant.has(t.source)).sort((a, b) => a.order - b.order).map((t) => t.source);
    if (tOrder.join('|') !== theme.topbar.messages.map(tsrc).filter((x) => tBySrc.has(x)).join('|')) plan.topbar.push({ key: 'order:topbar', act: 'order', title: '轮播顺序', why: '顺序和正式网站不一样 → 按正式网站排', pick: true });
    // 顶栏默认样式的颜色
    const def = state.tbstyles.find((s) => s.isDefault);
    const st = theme.style?.topbar;
    if (def && st && (norm(def.bg).toLowerCase() !== norm(st.bg).toLowerCase() || norm(def.color).toLowerCase() !== norm(st.color).toLowerCase())) {
      plan.tbstyle.push({ key: `update:${def.id}`, act: 'update', id: def.id, title: def.name || '默认样式', why: `颜色不一样(正式网站:底色 ${st.bg} / 文字 ${st.color})→ 改成正式网站上的`, pick: true, bg: st.bg, color: st.color });
    }
    for (const s of state.tbstyles) {
      if (!s.isDefault && isLive(s, camps, now)) plan.tbstyle.push({ key: `pause:${s.id}`, act: 'pause', id: s.id, title: s.name || '顶栏样式', why: `现在算「上线中」,会盖住默认样式;正式网站现在用的是默认颜色 → 勾上 = 先暂停${s.campaign ? '(它挂在活动下)' : ''}`, pick: !s.campaign });
    }
  }
  // ---- 首页两个商品模块:平时版本对齐编辑器;生效中的其他版本会盖住平时版本 ----
  for (const m of theme.modules || []) {
    const src = `theme:${m.sectionId}:module`;
    const def = (state.pmodules || []).find((v) => v.isDefault && v.module === m.module);
    const cn = m.module === 'sale' ? '促销模块' : '推荐 / 新品模块';
    if (!def) plan.pmodules.push({ key: `add:${src}`, act: 'add', source: src, title: `${cn}的平时版本`, why: 'app 里还没有平时版本 → 按正式网站现在的标题和页签建一个', pick: true });
    else {
      const d = moduleDiff(m, def);
      if (d.length || def.source !== src) plan.pmodules.push({ key: `update:${def.id}`, act: 'update', id: def.id, source: src, title: `${cn}的平时版本`, why: `和正式网站不一样:${d.join(';') || '来源'} → 改成正式网站上的`, pick: true });
      if (def.state !== 'approved' || def.paused) plan.pmodules.push({ key: `revive:${def.id}`, act: 'revive', id: def.id, title: `${cn}的平时版本`, why: '平时版本没在生效 → 恢复', pick: true });
    }
    for (const v of (state.pmodules || []).filter((x) => !x.isDefault && x.module === m.module && isLive(x, camps, now))) {
      plan.pmodules.push({ key: `pause:${v.id}`, act: 'pause', id: v.id, title: v.name || cn, why: `现在算「上线中」,上线后会盖住平时版本(正式网站现在显示的是「${m.title} ${m.title2}」)→ 勾上 = 先暂停${v.campaign ? '(它挂在活动下)' : ''}`, pick: !v.campaign });
    }
  }
  // ---- 只提醒:上线后会新出现在前台的东西 ----
  const liveCamps = state.campaigns.filter((c) => isLive(c, camps, now) && (c.badge || c.countdown));
  if (liveCamps.length) plan.notes.push(`上线后,产品页和产品卡会显示这些活动的徽章 / 倒计时:${liveCamps.map((c) => `「${c.name}」`).join('、')}`);
  return plan;
}

const ALL_KINDS = ['banners', 'topbar', 'tbstyle', 'pmodules'];
export const planCount = (plan) => ALL_KINDS.reduce((n, k) => n + plan[k].length, 0);

// 按勾选改 state。picks = 勾上的 key 集合。返回 { effects, done: [人话] }
export function applyThemeSync(state, plan, picks, { built = {}, now = Date.now(), actor = null } = {}) {
  const want = (r) => picks.has(r.key);
  const effects = []; const done = [];
  const sync = (id) => effects.push({ type: 'sync', id });
  const listOf = { banners: state.banners, topbar: state.topbar, tbstyle: state.tbstyles, pmodules: (state.pmodules ||= []) };
  const builtOf = { banners: built.banners || [], topbar: built.topbar || [], pmodules: built.pmodules || [] };
  for (const kind of ALL_KINDS) {
    const L = listOf[kind];
    for (const r of plan[kind].filter(want)) {
      const it = r.id ? L.find((x) => x.id === r.id) : null;
      if (r.act === 'add') {
        const nb = builtOf[kind]?.find((x) => x.source === r.source);
        if (!nb) { done.push(`⚠️ 没加上「${r.title}」(图片 / Collection 在店里找不到)`); continue; }
        if (L.some((x) => x.id === nb.id)) nb.id = `${nb.id}-${now.toString(36).slice(-4)}`;
        L.push({ ...nb, note: '上线前对照正式主题加的' }); sync(nb.id); done.push(`加了「${r.title}」`);
      } else if (r.act === 'update' && it) {
        if (kind === 'banners') {
          const nb = builtOf.banners.find((x) => x.source === it.source);
          if (!nb) { done.push(`⚠️ 没改成「${r.title}」(图片在店里找不到)`); continue; }
          for (const k of ['image', 'imageId', 'title', 'subtitle', 'description', 'button1_text', 'button1_url', 'button2_text', 'button2_url', 'button1_video', 'button2_video', 'tag']) it[k] = nb[k] ?? '';
        } else if (kind === 'topbar') Object.assign(it, { emoji: r.msg.emoji, text: r.msg.text, link: normalizeLink(r.msg.link) });
        else if (kind === 'tbstyle') Object.assign(it, { bg: r.bg, color: r.color });
        else if (kind === 'pmodules') {
          const nv = builtOf.pmodules.find((x) => x.source === r.source);
          if (!nv) { done.push(`⚠️ 没改成「${r.title}」(页签的 Collection 在店里找不到)`); continue; }
          for (const k of ['title', 'title2', 'titleColor', 'title2Color', 'tabActiveBg', 'tabActiveText', 'tabs', 'source']) it[k] = nv[k];
        }
        it.pendingChange = null; sync(it.id); done.push(`改了「${r.title}」`);
      } else if (r.act === 'revive' && it) {
        Object.assign(it, { state: 'approved', paused: false, pendingChange: null });
        if (it.end != null && it.end <= now) it.end = null;
        if (!it.isDefault && it.start != null && it.start > now) it.start = null;
        sync(it.id); done.push(`恢复显示「${r.title}」`);
      } else if (r.act === 'retire' && it) {
        it.end = now; it.pendingChange = null; sync(it.id); done.push(`结束了「${r.title}」`);
      } else if (r.act === 'pause' && it) {
        it.paused = true; sync(it.id); done.push(`暂停了「${r.title}」`);
      }
    }
  }
  // 顺序:跟着正式网站(主题来的按主题顺序,app 里自己建的排后面)
  for (const [kind, key, srcOrder] of [['banners', 'order:banner', built.bannerOrder], ['topbar', 'order:topbar', built.topbarOrder]]) {
    const r = plan[kind].find((x) => x.key === key);
    const needed = (r && picks.has(key)) || plan[kind].some((x) => x.act === 'add' && picks.has(x.key));
    if (!needed || !srcOrder) continue;
    const L = listOf[kind];
    const rank = new Map(srcOrder.map((s, i) => [s, i]));
    const sorted = [...L].sort((a, b) => (rank.has(a.source) ? rank.get(a.source) : 1e6 + a.order) - (rank.has(b.source) ? rank.get(b.source) : 1e6 + b.order));
    sorted.forEach((x, i) => { x.order = i; });
    effects.push({ type: 'syncOrder', kind: kind === 'banners' ? 'banner' : 'topbar' });
    done.push(`${kind === 'banners' ? 'Banner' : '顶栏'}按正式网站的顺序排好了`);
  }
  if (done.length) state.log.unshift({ at: now, action: 'import', kind: 'system', title: '对照正式主题', note: done.join(';').slice(0, 900), by: actor?.name || '' });
  return { effects, done };
}

// 两栏对照用:左边 = 正式网站(编辑器)现在显示的,右边 = app 里此刻会显示的(上线后首页就是右边)
export function compareView(state, theme, now = Date.now()) {
  const camps = campaignIndex(state.campaigns);
  const live = (x) => isLive(x, camps, now);
  const slides = (theme.slider?.slides || []).filter((s) => !s.disabled);
  const appBanners = state.banners.filter(live).sort((a, b) => a.order - b.order);
  const tbSrc = (m) => `theme:${theme.topbar?.sectionId}:${theme.topbar?.blockId}:${m.n}`;
  const modWinner = (mod) => {
    const vs = (state.pmodules || []).filter((v) => v.module === mod && (v.isDefault ? v.state === 'approved' && !v.paused : live(v)));
    return vs.filter((v) => !v.isDefault).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || vs.find((v) => v.isDefault) || null;
  };
  return {
    banners: {
      site: slides.map((s) => ({ key: `theme:${theme.slider.sectionId}:${s.blockId}`, title: s.title || '(无标题)', image: shopImageName(s.image) })),
      app: appBanners.map((b) => ({ key: b.source || b.id, title: titleOf(b), image: b.image, mine: !b.source?.startsWith('theme:') })),
    },
    topbar: {
      site: (theme.topbar?.messages || []).map((m) => ({ key: tbSrc(m), title: `${m.emoji} ${m.text}`.trim() })),
      app: state.topbar.filter(live).sort((a, b) => a.order - b.order).map((t) => ({ key: t.source || t.id, title: titleOf(t), mine: !t.source?.startsWith('theme:') })),
    },
    modules: (theme.modules || []).map((m) => {
      const w = modWinner(m.module);
      return { module: m.module, site: { title: `${m.title} ${m.title2}`.trim(), tabs: m.tabs.map((t) => t.title || t.collectionHandle) },
        app: w ? { title: `${w.title || ''} ${w.title2 || ''}`.trim() || w.name, tabs: (w.tabs || []).map((t) => t.title || t.collection?.title || ''), name: w.name, isDefault: !!w.isDefault } : null };
    }),
  };
}
