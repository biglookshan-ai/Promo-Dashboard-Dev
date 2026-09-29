// 排期系统前端 —— 目前是「演示模式」:数据来自 demo-seed.json(真实 Banner / 顶栏 / 合集 / 标签 + 示例活动),
// 操作只存浏览器 localStorage,不调用任何写接口。阶段 1b 接上真实数据后替换数据层即可,界面不变。
//
// 用到 app.js / registry.js 的全局:$ $$ esc toast showSection。整个文件包在 IIFE 里,
// 避免和 registry.js 的顶层 const(svg / ICONS …)重名。
(() => {
  const DEMO_KEY = 'cgp-schedule-demo-v3'; // 数据结构变了就升版本,旧的演示数据自动作废
  const DAY = 86400000;
  const TZ = 'Europe/London';
  const ENDING_DAYS = 3; // 下架前几天开始提醒
  let S = null;

  // ================= 时间(一律按英国时间显示和输入) =================
  function londonOffsetMin(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000);
  }
  const toInput = (ms) => (ms == null ? '' : new Date(ms + londonOffsetMin(ms) * 60000).toISOString().slice(0, 16));
  function fromInput(v) {
    if (!v) return null;
    const [d, t] = v.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mi] = t.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, dd, hh, mi);
    return guess - londonOffsetMin(guess) * 60000;
  }
  const now = () => Date.now();
  // 英国时间「今天 + n 天」的 00:00 —— 按日历算,跨夏令时(10 月底 / 3 月底)也不会差一小时
  function dayStart(n = 0) {
    const [y, m, d] = toInput(now()).slice(0, 10).split('-').map(Number);
    return fromInput(new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) + 'T00:00');
  }
  const today0 = () => dayStart(0);
  const fmt = (ms, o) => new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, ...o }).format(new Date(ms));
  const fDate = (ms) => fmt(ms, { month: 'numeric', day: 'numeric', weekday: 'short' });
  const fMD = (ms) => fmt(ms, { month: 'numeric', day: 'numeric' });
  const fDT = (ms) => fmt(ms, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fAgo = (ms) => {
    const d = Math.round((ms - now()) / 60000);
    if (Math.abs(d) < 1) return '刚刚';
    if (Math.abs(d) < 60) return d > 0 ? `${d} 分钟后` : `${-d} 分钟前`;
    const h = Math.round(d / 60);
    if (Math.abs(h) < 24) return h >= 0 ? `${h} 小时后` : `${-h} 小时前`;
    const days = Math.round(h / 24); return days >= 0 ? `${days} 天后` : `${-days} 天前`;
  };
  function relDay(ms) {
    const diff = Math.round((fromInput(toInput(ms).slice(0, 10) + 'T00:00') - today0()) / DAY);
    return diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天' : diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
  }

  // ================= 数据(演示) =================
  const save = () => localStorage.setItem(DEMO_KEY, JSON.stringify(S));
  function materialize(seed) {
    // 种子里的日期:数字 = 相对今天的天数;'YYYY-MM-DD' = 固定日期(节日类)
    const md = (v) => (v == null ? null : typeof v === 'string' ? fromInput(v + 'T00:00') : dayStart(v));
    const conv = (it, kind) => ({
      ...it, kind, start: md(it.start), end: md(it.end), campaign: it.campaign || null, paused: false,
      submittedAt: it.state === 'pending' ? now() - 0.3 * DAY : null,
      pendingChange: it.pendingChange ? { ...it.pendingChange, at: now() + (it.pendingChange.at || 0) * DAY } : null,
    });
    return {
      ...seed,
      banners: seed.banners.map((b) => conv(b, 'banner')),
      topbar: seed.topbar.map((t) => conv(t, 'topbar')),
      tbstyles: seed.tbstyles.map((t) => conv(t, 'tbstyle')),
      campaigns: seed.campaigns.map((c) => conv(c, 'campaign')),
      log: seed.log.map((l) => ({ ...l, at: now() + l.at * DAY })),
      pendingOrder: null,
    };
  }
  async function load(force) {
    const raw = !force && localStorage.getItem(DEMO_KEY);
    if (raw) { S = JSON.parse(raw); return; }
    S = materialize(await fetch('demo-seed.json', { cache: 'no-store' }).then((r) => r.json()));
    save();
  }

  const all = () => [...S.campaigns, ...S.banners, ...S.topbar, ...S.tbstyles];
  const listOf = (k) => ({ banner: S.banners, topbar: S.topbar, tbstyle: S.tbstyles, campaign: S.campaigns }[k]);
  const byId = (id) => all().find((x) => x.id === id);
  const camp = (id) => S.campaigns.find((c) => c.id === id);
  const me = () => S.staff.find((u) => u.id === S.me) || S.staff[0];
  const isApprover = () => me().role === 'approver';
  const who = (id) => (S.staff.find((u) => u.id === id) || {}).name || '未知';
  const KIND = { banner: 'Banner', topbar: '顶栏', tbstyle: '顶栏样式', campaign: '活动' };
  const titleOf = (it) => (it.kind === 'banner' ? (it.title || '未命名 Banner')
    : it.kind === 'topbar' ? `${it.emoji || ''} ${it.text || ''}`.trim() || '未命名公告' : it.name || '未命名');
  const rid = (p) => p + Math.random().toString(36).slice(2, 9);
  const byOrder = (a, b) => a.order - b.order;
  function log(action, it, note) {
    S.log.unshift({ at: now(), action, kind: it.kind, title: titleOf(it), note: note || '', by: me().name });
    S.log = S.log.slice(0, 300);
  }

  // ================= 状态 =================
  // 有效时间窗:自己设了时间用自己的;没设且挂了活动 → 继承活动;都没设 = 长期
  function win(it) {
    if (it.kind !== 'campaign' && it.campaign && it.start == null && it.end == null) {
      const c = camp(it.campaign); if (c) return { start: c.start, end: c.end, via: c };
    }
    return { start: it.start, end: it.end, via: null };
  }
  function status(it, t = now()) {
    if (it.state === 'draft' || it.state === 'new') return 'draft';
    if (it.state === 'pending') return 'pending';
    if (it.state === 'rejected') return 'rejected';
    if (it.paused) return 'paused';
    const w = win(it);
    if (w.via && w.via.paused) return 'paused';
    if (w.via && w.via.state !== 'approved') return 'waiting';
    if (w.start != null && t < w.start) return 'scheduled';
    if (w.end != null && t >= w.end) return 'ended';
    return 'live';
  }
  const ST = {
    live: '上线中', scheduled: '已排期', pending: '待审核', draft: '草稿', ended: '已结束',
    paused: '已暂停', rejected: '已退回', waiting: '等活动批准',
  };
  const badge = (it) => { const s = status(it); return `<span class="stb stb--${s}"><span class="dot"></span>${ST[s]}</span>`; };
  function winText(it) {
    const w = win(it);
    const r = w.start == null && w.end == null ? '长期显示'
      : `${w.start != null ? fDT(w.start) : '立即'} → ${w.end != null ? fDT(w.end) : '长期'}`;
    return w.via ? `跟随「${esc(w.via.name)}」· ${r}` : r;
  }
  // 上线中、且 3 天内就要自动下架的
  const endingSoon = (x) => status(x) === 'live' && win(x).end != null && win(x).end - now() <= ENDING_DAYS * DAY;
  const endingTag = (x) => (endingSoon(x) ? `<span class="tag tag--warn">⚠️ ${relDay(win(x).end)}下架(${fDT(win(x).end)})</span>` : '');
  const pendingList = () => all().filter((x) => x.state === 'pending' || x.pendingChange);
  const pendingCount = () => pendingList().length + (S.pendingOrder ? 1 : 0);

  // ---- Banner 在前台的位置 ----
  const liveBannersAt = (t) => S.banners.filter((b) => status(b, t) === 'live').sort(byOrder);
  // 上线中 → 现在排第几;已排期 / 待审核 → 上线那一刻会排第几
  function bannerPos(b) {
    const s = status(b);
    if (s === 'live') return { n: liveBannersAt(now()).indexOf(b) + 1, future: false };
    if (['scheduled', 'pending', 'waiting'].includes(s)) {
      const t = Math.max(now(), win(b).start ?? now()) + 1000;
      const set = [...liveBannersAt(t).filter((x) => x !== b), b].sort(byOrder);
      return { n: set.indexOf(b) + 1, future: true, at: win(b).start };
    }
    return null;
  }
  const posChip = (b) => {
    const p = bannerPos(b); if (!p) return '';
    return `<span class="poschip ${p.future ? 'poschip--f' : ''}" title="${p.future ? '上线后在首页轮播里的位置' : '现在在首页轮播里的位置'}">${p.future ? '上线后 ' : ''}第 ${p.n} 张</span>`;
  };

  // ---- 活动覆盖的产品(合集 / 标签 / 指定产品)----
  const colCount = (c) => (S.collections.find((x) => x.handle === c.handle) || c).count ?? null;
  const tagCount = (t) => S.tagCounts[t] ?? null;
  function scopeTotal(c) {
    const nums = [...(c.collections || []).map(colCount), ...(c.tags || []).map(tagCount)];
    const known = nums.filter((n) => n != null).reduce((a, b) => a + b, 0) + (c.products || []).length;
    return { total: known, unknown: nums.some((n) => n == null), overlap: nums.length + (c.products?.length ? 1 : 0) > 1 };
  }
  const nTxt = (n) => (n == null ? '?' : n);
  function campScope(c, short, sep = ' + ') {
    const parts = [];
    if (c.collections?.length) parts.push(short ? `合集 ${c.collections.length}` : `合集:${c.collections.map((x) => `${esc(x.title)}(${nTxt(colCount(x))})`).join('、')}`);
    if (c.tags?.length) parts.push(short ? `标签 ${c.tags.length}` : `标签:${c.tags.map((t) => `${esc(t)}(${nTxt(tagCount(t))})`).join('、')}`);
    if (c.products?.length) parts.push(short ? `产品 ${c.products.length}` : `指定 ${c.products.length} 个产品`);
    return parts.join(short ? ' · ' : sep) || (short ? '无产品' : '<span class="muted">没有选产品(只串联 Banner / 顶栏)</span>');
  }

  // ---- 后台 / 前台链接 ----
  const ADMIN = () => `https://admin.shopify.com/store/${S.store.handle}`;
  const numId = (id) => String(id || '').split('/').pop();
  const handleize = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const LINKS = {
    collections: (c) => [c.id ? `${ADMIN()}/collections/${numId(c.id)}` : `${ADMIN()}/collections?query=${encodeURIComponent(c.handle)}`, `${S.store.domain}/collections/${c.handle}`],
    tags: (t) => [`${ADMIN()}/products?tag=${encodeURIComponent(t)}`, `${S.store.domain}/collections/all/${handleize(t)}`],
    products: (p) => [p.id ? `${ADMIN()}/products/${numId(p.id)}` : `${ADMIN()}/products?query=${encodeURIComponent(p.handle)}`, `${S.store.domain}/products/${p.handle}`],
  };
  const linkPair = (k, x) => {
    const [a, f] = LINKS[k](x);
    return `<a class="lk" href="${esc(a)}" target="_blank" rel="noopener" title="在 Shopify 后台打开">后台↗</a><a class="lk" href="${esc(f)}" target="_blank" rel="noopener" title="在网站前台打开">前台↗</a>`;
  };

  // ================= 小部件 =================
  const I = {
    clock: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    plus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    grip: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    up: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    x: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    left: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    sort: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4"/></svg>',
    flag: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>',
  };
  const TAGCN = { new: '新品', sale: '促销', event: '活动', none: '无角标' };
  const EFFECT = { none: '无', snow: '❄️ 飘雪', sparkle: '✨ 闪光', confetti: '🎉 彩带' };
  const thumb = (url, w = 600) => (url ? `${url}${url.includes('?') ? '&' : '?'}width=${w}` : '');
  const kindChip = (k) => `<span class="kchip kchip--${k}">${KIND[k]}</span>`;
  const empty = (msg) => `<div class="empty"><div>${esc(msg)}</div></div>`;
  const pageHead = (title, sub, actions = '') =>
    `<div class="phead"><div><h2>${esc(title)}</h2><p class="muted">${sub}</p></div><div class="phead__act">${actions}</div></div>`;
  const RANK = { live: 0, pending: 1, waiting: 1, scheduled: 2, draft: 3, rejected: 3, paused: 4, ended: 5 };
  const byStatusThenOrder = (a, b) => RANK[status(a)] - RANK[status(b)] || (a.order ?? 0) - (b.order ?? 0);
  // 状态页签:上线中放第一、默认选中;「全部」放最后
  const TABS = [['live', '上线中'], ['scheduled', '已排期'], ['pending', '待审核'], ['draft', '草稿'], ['paused', '已暂停'], ['ended', '已结束'], ['', '全部']];
  // 「待审核」也包括:等活动批准的、以及已上线但有修改在等审核的(线上照常显示)
  const inTab = (x, st) => !st || status(x) === st || (st === 'pending' && (status(x) === 'waiting' || !!x.pendingChange)) || (st === 'draft' && status(x) === 'rejected');
  const tabsHtml = (list, cur) => TABS.map(([k, l]) => {
    const n = list.filter((x) => inTab(x, k)).length;
    if (k === 'paused' && !n) return '';
    return `<button class="ftab ${cur === k ? 'is-active' : ''}" data-st="${k}" type="button">${l}<span>${n}</span></button>`;
  }).join('');

  // ---- 前台同款样式:把主题里的真实尺寸 / 字号 / 颜色换算成 CSS 变量 ----
  // Banner 卡片用 container query(cqw)按宽度等比缩放,所以缩略图、预览、审核页里看到的比例和字号关系都和首页一致
  function applySiteStyle() {
    const s = S.site.slide, t = S.site.topbar, r = document.documentElement.style;
    const cq = (px) => `${(px / s.w) * 100}cqw`;
    Object.entries({
      '--sl-ar': `${s.w} / ${s.h}`, '--sl-rx': `${(s.radius / s.w) * 100}%`, '--sl-ry': `${(s.radius / s.h) * 100}%`, '--sl-bg': s.bg,
      '--sl-title': cq(s.titleSize), '--sl-title-mb': cq(10), '--sl-sub': cq(s.subtitleSize), '--sl-sub-mb': cq(15),
      '--sl-desc': cq(s.descSize), '--sl-desc-mb': cq(20), '--sl-title-c': s.titleColor, '--sl-sub-c': s.subtitleColor, '--sl-desc-c': s.descColor,
      '--sl-btn': cq(s.btnSize), '--sl-btn-pv': cq(s.btnPadV), '--sl-btn-ph': cq(s.btnPadH), '--sl-btn-gap': cq(s.btnGap), '--sl-btn-r': cq(s.btnRadius), '--sl-btn-bw': cq(1),
      '--sl-b1-bg': s.btn1.bg, '--sl-b1-c': s.btn1.color, '--sl-b1-bd': s.btn1.border, '--sl-b2-bg': s.btn2.bg, '--sl-b2-c': s.btn2.color, '--sl-b2-bd': s.btn2.border,
      '--sl-tag': cq(14), '--sl-tag-top': cq(s.tagTop), '--sl-tag-left': cq(s.tagLeft), '--sl-tag-r': cq(s.tagRadius), '--sl-tag-pv': cq(2), '--sl-tag-ph': cq(8),
      '--tb-fs': `${t.fontSize}px`, '--tb-pv': `${t.padV}px`,
    }).forEach(([k, v]) => r.setProperty(k, v));
  }
  function slideHtml(b, { w = 600, cls = '' } = {}) {
    const tg = S.site.slide.tags[b.tag];
    return `<span class="slide ${cls}">
      <span class="slide__img" ${b.image ? `style="background-image:url('${esc(thumb(b.image, w))}')"` : ''}>${b.image ? '' : '<span class="slide__noimg">选一张图片</span>'}</span>
      ${tg ? `<span class="slide__tag" style="background:${tg.bg};color:${tg.color}">${esc(tg.text)}</span>` : ''}
      <span class="slide__c">
        ${b.title ? `<span class="slide__title">${esc(b.title)}</span>` : ''}
        ${b.subtitle ? `<span class="slide__sub">${esc(b.subtitle)}</span>` : ''}
        ${b.description ? `<span class="slide__desc">${esc(b.description)}</span>` : ''}
        ${b.button1_text || b.button2_text ? `<span class="slide__btns">${b.button1_text ? `<span class="slide__btn slide__btn--1">${esc(b.button1_text)}</span>` : ''}${b.button2_text ? `<span class="slide__btn slide__btn--2">${esc(b.button2_text)}</span>` : ''}</span>` : ''}
      </span>
    </span>`;
  }

  // ---- 顶栏:样式(节日主题)+ 特效 ----
  function activeStyle(t = now()) {
    const on = S.tbstyles.filter((x) => !x.isDefault && status(x, t) === 'live')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (win(b).start ?? 0) - (win(a).start ?? 0));
    return on[0] || S.tbstyles.find((x) => x.isDefault) || { bg: S.site.topbar.bg, color: S.site.topbar.color, effect: 'none' };
  }
  function fxHtml(effect) {
    if (!effect || effect === 'none') return '';
    const n = { snow: 26, sparkle: 16, confetti: 22 }[effect] || 0;
    const COL = ['#f5d06f', '#ff6b6b', '#4dabf7', '#69db7c', '#ffffff'];
    return `<span class="fx fx--${effect}" aria-hidden="true">${Array.from({ length: n }, (_, i) => {
      const left = (i * 37 + 11) % 100, top = (i * 53 + 7) % 100, dur = 2.4 + (i % 5) * 0.7, delay = -((i * 0.61) % dur);
      return `<i style="left:${left}%;top:${effect === 'sparkle' ? top + '%' : '-8px'};animation-duration:${dur}s;animation-delay:${delay}s;${effect === 'confetti' ? `background:${COL[i % COL.length]}` : ''}"></i>`;
    }).join('')}</span>`;
  }
  // 主题里正在用的那套 Top Bar:左边社交图标、中间轮播公告、右边语言货币;底色 / 字色 / 特效跟着当前样式走
  const topbarHtml = (msg, { style = activeStyle(), id = '' } = {}) => `<div class="tbar" style="background:${esc(style.bg)};color:${esc(style.color)}">
      ${fxHtml(style.effect)}
      <span class="tbar__side"><i></i><i></i><i></i></span>
      <span class="tbar__msg" ${id ? `id="${id}"` : ''}>${msg}</span>
      <span class="tbar__side tbar__side--r">Language/Currency</span>
    </div>`;
  const tbMsg = (t, style) => `<span class="tbar__in">${style?.decoLeft ? `<span class="tbar__deco">${esc(style.decoLeft)}</span>` : ''}${esc(titleOf(t))}${style?.decoRight ? `<span class="tbar__deco">${esc(style.decoRight)}</span>` : ''}</span>`;

  // ---- 缩略图(时间轴 / 列表用)----
  function miniThumb(x) {
    if (x.kind === 'banner') return `<span class="mthumb mthumb--banner" style="background-image:url('${esc(thumb(x.image, 80))}')"></span>`;
    if (x.kind === 'tbstyle') return `<span class="mthumb mthumb--sw" style="background:${esc(x.bg)};color:${esc(x.color)}">${esc(x.decoLeft || 'Aa')}</span>`;
    if (x.kind === 'topbar') return `<span class="mthumb mthumb--tb">${esc(x.emoji || '📣')}</span>`;
    const b = S.banners.find((y) => y.campaign === x.id && y.image);
    return b ? `<span class="mthumb mthumb--banner" style="background-image:url('${esc(thumb(b.image, 80))}')"></span>` : `<span class="mthumb mthumb--camp">${I.flag}</span>`;
  }

  // ---- 悬停卡片(时间轴、轮播顺序、活动挂载内容都用)----
  function popHtml(x) {
    const w = win(x); const s = status(x);
    const when = `<div class="pop__when">${I.clock}${winText(x)}</div>`;
    const head = `<div class="pop__h">${kindChip(x.kind)}<b>${esc(titleOf(x))}</b>${badge(x)}</div>`;
    let body = '';
    if (x.kind === 'banner') {
      const p = bannerPos(x);
      body = `<div class="pop__row"><span class="pop__slide">${slideHtml(x, { w: 400 })}</span><div class="pop__info">
        ${p ? `<div>${p.future ? `上线后排<b>第 ${p.n} 张</b>` : `首页轮播<b>第 ${p.n} 张</b>`}</div>` : ''}
        ${x.button1_url ? `<div class="muted mono">${esc(x.button1_url)}</div>` : ''}
        ${endingTag(x)}</div></div>`;
    } else if (x.kind === 'topbar') {
      body = topbarHtml(tbMsg(x, activeStyle(Math.max(now(), w.start ?? now()))), { style: activeStyle(Math.max(now(), w.start ?? now())) }) + endingTag(x);
    } else if (x.kind === 'tbstyle') {
      body = topbarHtml(tbMsg(S.topbar.find((t) => status(t) === 'live') || { kind: 'topbar', emoji: '🚚', text: 'Free UK Delivery' }, x), { style: x })
        + `<div class="muted">特效:${EFFECT[x.effect] || '无'}</div>`;
    } else {
      const bn = S.banners.filter((b) => b.campaign === x.id);
      const st = scopeTotal(x);
      body = `<div class="pop__camp">
        <div>${x.badge ? `<span class="pbadge">${esc(x.badge)}</span>` : ''}${x.countdown ? '<span class="tag">倒计时</span>' : ''}</div>
        <div class="muted">${campScope(x)}</div>
        <div>约 <b>${st.total}${st.unknown ? '+' : ''}</b> 个产品${st.overlap ? '<span class="muted">(合集和标签可能有重叠)</span>' : ''}</div>
        ${bn.length ? `<div class="pop__thumbs">${bn.map((b) => `<span class="pop__t">${slideHtml(b, { w: 200 })}</span>`).join('')}</div>` : ''}
      </div>`;
    }
    return `${head}${when}${body}${s === 'pending' ? '<div class="note note--warn">还没批准,到点不会上线</div>' : ''}`;
  }
  let popEl = null;
  function showPop(e, id) {
    const x = byId(id); if (!x) return;
    if (!popEl) { popEl = document.createElement('div'); popEl.className = 'pop'; document.body.appendChild(popEl); }
    if (popEl.dataset.id !== id) { popEl.innerHTML = popHtml(x); popEl.dataset.id = id; }
    popEl.hidden = false; movePop(e);
  }
  function movePop(e) {
    if (!popEl || popEl.hidden) return;
    const r = popEl.getBoundingClientRect(); const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
    popEl.style.left = x + 'px'; popEl.style.top = y + 'px';
  }
  const hidePop = () => { if (popEl) { popEl.hidden = true; popEl.dataset.id = ''; } };

  // ---- 需要留意(3 天内下架 / 快到上线时间还没批准)----
  function alertsHtml(kinds) {
    const items = all().filter((x) => kinds.includes(x.kind));
    const ending = items.filter(endingSoon).sort((a, b) => win(a).end - win(b).end);
    const unapproved = items.filter((x) => ['pending', 'waiting'].includes(status(x)) && win(x).start != null && win(x).start - now() <= ENDING_DAYS * DAY);
    if (!ending.length && !unapproved.length) return '';
    const row = (x, txt) => `<button class="alrow" data-open="${x.id}" data-pop="${x.id}" type="button">${miniThumb(x)}${kindChip(x.kind)}<span class="alrow__t">${esc(titleOf(x))}</span><span class="alrow__w">${txt}</span></button>`;
    return `<section class="alert">
      <div class="alert__h">⚠️ 需要留意</div>
      ${ending.map((x) => row(x, `<b>${relDay(win(x).end)}</b>自动下架 · ${fDT(win(x).end)} <span class="muted">要延长就改结束时间,要替换就提前做好新的</span>`)).join('')}
      ${unapproved.map((x) => row(x, `<b>${relDay(win(x).start)}</b>该上线,但${status(x) === 'waiting' ? '所属活动' : ''}还没批准`)).join('')}
    </section>`;
  }

  // ================= 总览 =================
  const ov = { zoom: 'month', offset: 0, kinds: { campaign: true, banner: true, topbar: true, tbstyle: true }, onlyActive: true };
  const ymd = (ms) => toInput(ms).slice(0, 10).split('-').map(Number);
  const at0 = (y, m, d) => fromInput(new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) + 'T00:00'); // 月 / 日溢出自动进位
  // 时间轴窗口(以今天为锚,今天总在靠左的位置,方便往后看):
  //   周 = 本周一起 7 天(按天);月 = 上周一起 5 周(按周);季度 = 本月 1 号起 3 个月(按月)。左右箭头按一个周期翻
  function viewRange() {
    const [y, m, d] = ymd(now()); const k = ov.offset; const lines = [];
    const mon = d - ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7);
    if (ov.zoom === 'week') {
      const s0 = mon + 7 * k;
      for (let i = 0; i <= 7; i++) lines.push({ at: at0(y, m, s0 + i), major: true, label: i < 7 ? fmt(at0(y, m, s0 + i), { weekday: 'short', month: 'numeric', day: 'numeric' }) : '', mid: true });
      const s = at0(y, m, s0), e = at0(y, m, s0 + 7);
      return { s, e, lines, title: `${fMD(s)} – ${fMD(e - 1)}` };
    }
    if (ov.zoom === 'month') {
      const s0 = mon - 7 + 28 * k;
      for (let i = 0; i <= 35; i++) lines.push({ at: at0(y, m, s0 + i), major: i % 7 === 0, label: i % 7 === 0 && i < 35 ? fMD(at0(y, m, s0 + i)) : '' });
      const s = at0(y, m, s0), e = at0(y, m, s0 + 35);
      return { s, e, lines, title: `${fMD(s)} – ${fMD(e - 1)}` };
    }
    const m0 = m + 3 * k; const s = at0(y, m0, 1), e = at0(y, m0 + 3, 1);
    for (let i = 0; i < 3; i++) lines.push({ at: at0(y, m0 + i, 1), major: true, label: `${ymd(at0(y, m0 + i, 1))[1]} 月`, mid: true, end: at0(y, m0 + i + 1, 1) });
    for (let i = 1; at0(ymd(s)[0], ymd(s)[1], 1 + i * 7) < e; i++) lines.push({ at: at0(ymd(s)[0], ymd(s)[1], 1 + i * 7), major: false, label: '' });
    const [ys, ms] = ymd(s), [ye, me2] = ymd(e - 1);
    return { s, e, lines, title: ys === ye ? `${ys} 年 ${ms}–${me2} 月` : `${ys} 年 ${ms} 月 – ${ye} 年 ${me2} 月` };
  }

  function renderOverview() {
    const items = all(); const t = now(); const in7 = t + 7 * DAY;
    const liveN = items.filter((x) => status(x) === 'live' && !x.isDefault).length;
    const soonN = items.filter((x) => status(x) === 'scheduled' && win(x).start <= in7).length;
    const endN = items.filter((x) => status(x) === 'live' && win(x).end != null && win(x).end <= in7).length;
    const pendN = pendingCount();
    const stat = (n, l, tone, go) => `<button class="stat ${tone}" data-go="${go}" type="button"><div class="stat__n">${n}</div><div class="stat__l">${l}</div></button>`;

    // ---- 时间轴 ----
    const R = viewRange(); const span = R.e - R.s;
    const pct = (ms) => ((Math.min(Math.max(ms, R.s), R.e) - R.s) / span) * 100;
    const showToday = t >= R.s && t < R.e;
    // 刻度文字离「今天」太近就不显示,免得叠在一起
    const head = R.lines.filter((l) => l.label && !(showToday && !l.mid && Math.abs(pct(l.at) - pct(t)) < 4)).map((l) => {
      const left = l.mid ? (pct(l.at) + pct(l.end ?? l.at + DAY)) / 2 : pct(l.at);
      return `<span class="gt__tick ${l.mid ? 'gt__tick--mid' : ''}" style="left:${left}%">${l.label}</span>`;
    }).join('');
    const grid = R.lines.map((l) => `<i class="${l.major ? 'is-major' : ''}" style="left:${pct(l.at)}%"></i>`).join('')
      + (showToday ? `<i class="is-today" style="left:${pct(t)}%"></i>` : '');
    const keep = (x) => {
      const s = status(x);
      if (x.state === 'draft' || x.state === 'new' || x.isDefault) return false;
      if (ov.onlyActive && !['live', 'scheduled', 'pending', 'waiting', 'paused'].includes(s)) return false;
      const w = win(x); const a = w.start ?? -Infinity, b = w.end ?? Infinity;
      return b > R.s && a < R.e;
    };
    const group = (kind, name, list) => {
      if (!ov.kinds[kind]) return '';
      const rows = list.filter(keep).sort((a, b) => (win(a).start ?? 0) - (win(b).start ?? 0)).map((x) => {
        const w = win(x); const s = status(x);
        const a = w.start ?? R.s, b = w.end ?? R.e;
        const L = pct(a), W = Math.max(pct(b) - L, 0.6);
        const txt = `${w.start != null ? fMD(w.start) : '长期'} → ${w.end != null ? fMD(w.end) : '长期'}`;
        const sub = kind === 'campaign' ? `<span class="gt__sub">${campScope(x, true)}</span>`
          : kind === 'banner' && bannerPos(x) ? `<span class="gt__sub">${bannerPos(x).future ? '上线后' : ''}第 ${bannerPos(x).n} 张${w.via ? ' · 跟随 ' + esc(w.via.name) : ''}</span>`
            : w.via ? `<span class="gt__sub">跟随 ${esc(w.via.name)}</span>` : '';
        const ending = endingSoon(x);
        return `<button class="gt__row" data-open="${x.id}" data-pop="${x.id}" type="button">
          <span class="gt__label">${miniThumb(x)}<span class="gt__lt"><span class="gt__name">${esc(titleOf(x))}</span>${sub}</span></span>
          <span class="gt__track"><span class="gt__bar gt__bar--${s} ${kind === 'campaign' ? 'gt__bar--camp' : ''} ${kind === 'tbstyle' ? 'gt__bar--style' : ''} ${ending ? 'is-ending' : ''} ${w.start != null && w.start < R.s ? 'is-cut-l' : ''} ${w.end == null || w.end > R.e ? 'is-cut-r' : ''}"
            style="left:${L}%;width:${W}%;${kind === 'tbstyle' && s === 'live' ? `background:${esc(x.bg)};` : ''}"><span class="gt__bartxt">${ending ? '⚠️ ' : ''}${txt}</span></span></span>
        </button>`;
      }).join('');
      return rows ? `<div class="gt__group gt__group--${kind}">${name}</div>${rows}` : '';
    };
    const gantt = group('campaign', '促销活动', S.campaigns) + group('banner', 'Banner', S.banners) + group('topbar', '顶栏公告', S.topbar) + group('tbstyle', '顶栏样式(节日主题)', S.tbstyles);
    const kchip = (k, label, list) => `<button class="fchip ${ov.kinds[k] ? 'is-active' : ''}" data-kind="${k}" type="button">${label} ${list.filter(keep).length}</button>`;

    // ---- 接下来 14 天(按天分组)----
    const ev = [];
    items.forEach((x) => {
      if (x.state === 'draft' || x.state === 'new' || x.state === 'rejected' || x.isDefault) return;
      const w = win(x); const s = status(x);
      const add = (at, type) => { if (at != null && at > t && at <= t + 14 * DAY) ev.push({ at, type, x, s }); };
      add(w.start, 'up'); add(w.end, 'down');
    });
    ev.sort((a, b) => a.at - b.at || (a.x.kind === 'campaign' ? -1 : 1));
    const days = new Map();
    ev.forEach((e) => { const k = toInput(e.at).slice(0, 10); if (!days.has(k)) days.set(k, []); days.get(k).push(e); });
    const evHtml = days.size ? [...days.values()].map((list) => `<div class="evday">
        <div class="evday__h"><b>${relDay(list[0].at)}</b><span>${fDate(list[0].at)}</span></div>
        ${list.map((e) => `<button class="evrow" data-open="${e.x.id}" data-pop="${e.x.id}" type="button">
          <span class="evrow__time">${fmt(e.at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span>
          <span class="evrow__act evrow__act--${e.type}">${e.type === 'up' ? I.up + '上线' : I.down + '下线'}</span>
          ${miniThumb(e.x)}<span class="evrow__t">${esc(titleOf(e.x))}</span>
          ${e.s === 'pending' || e.s === 'waiting' ? `<span class="tag tag--warn">${e.s === 'pending' ? '还没批准' : '活动未批准'}</span>` : ''}
        </button>`).join('')}
      </div>`).join('') : empty('接下来 14 天没有上线 / 下线变化');

    $('#ov-root').innerHTML = `
      ${pageHead('总览', '现在网站上显示什么、接下来会发生什么')}
      <div class="stats">
        ${stat(liveN, '上线中', 'stat--ok', 'banners')}
        ${stat(soonN, '7 天内上线', '', 'overview')}
        ${stat(endN, '7 天内到期', endN ? 'stat--warn' : '', 'overview')}
        ${stat(pendN, '待审核', pendN ? 'stat--danger' : '', 'reviews')}
      </div>
      ${alertsHtml(['banner', 'topbar', 'campaign', 'tbstyle'])}
      <section class="panel">
        <div class="gtbar">
          <div class="gtbar__l">
            <h3>时间轴</h3>
            <div class="seg" id="ov-zoom">${[['week', '周'], ['month', '月'], ['quarter', '季度']].map(([k, l]) => `<button type="button" data-zoom="${k}" class="${ov.zoom === k ? 'is-active' : ''}">${l}</button>`).join('')}</div>
            <div class="gtnav">
              <button class="btn btn-sm btn-ghost" data-nav="-1" type="button" aria-label="上一段">${I.left}</button>
              <b class="gtnav__t">${R.title}</b>
              <button class="btn btn-sm btn-ghost" data-nav="1" type="button" aria-label="下一段">${I.right}</button>
              ${ov.offset ? '<button class="btn btn-sm" data-nav="0" type="button">回到今天</button>' : ''}
            </div>
          </div>
          <div class="gtbar__r">
            ${kchip('campaign', '促销活动', S.campaigns)}${kchip('banner', 'Banner', S.banners)}${kchip('topbar', '顶栏', S.topbar)}${kchip('tbstyle', '顶栏样式', S.tbstyles)}
            <label class="muted"><input type="checkbox" id="ov-active" ${ov.onlyActive ? 'checked' : ''}/> 只看进行中和将要上线</label>
          </div>
        </div>
        <div class="gt">
          <div class="gt__head"><span class="gt__label"></span><span class="gt__track">${head}${showToday ? `<span class="gt__today" style="left:${pct(t)}%">今天</span>` : ''}</span></div>
          <div class="gt__body">
            <div class="gt__grid"><span class="gt__label"></span><span class="gt__track">${grid}</span></div>
            ${gantt || empty('这段时间没有内容')}
          </div>
        </div>
        <div class="gt__legend">
          <span><i class="lg lg--live"></i>上线中</span><span><i class="lg lg--scheduled"></i>已排期</span>
          <span><i class="lg lg--pending"></i>待审核 / 未批准</span><span><i class="lg lg--paused"></i>已暂停</span><span><i class="lg lg--ended"></i>已结束</span>
          <span><i class="lg lg--ending"></i>${ENDING_DAYS} 天内下架</span>
          <span class="muted">鼠标移到一行上看大图和详情 · 条的端点淡出 = 超出这段时间或没有结束时间</span>
        </div>
      </section>
      <section class="panel">
        <div class="panel__h"><h3>接下来 14 天</h3><span class="muted">会自动上线 / 下线的内容,按天排好</span></div>
        <div class="evdays">${evHtml}</div>
      </section>`;
    $('#ov-active').addEventListener('change', (e) => { ov.onlyActive = e.target.checked; renderOverview(); });
    $$('#ov-zoom button').forEach((b) => b.addEventListener('click', () => { ov.zoom = b.dataset.zoom; ov.offset = 0; renderOverview(); }));
    $$('#ov-root [data-nav]').forEach((b) => b.addEventListener('click', () => { ov.offset = +b.dataset.nav ? ov.offset + +b.dataset.nav : 0; renderOverview(); }));
    $$('#ov-root [data-kind]').forEach((b) => b.addEventListener('click', () => { ov.kinds[b.dataset.kind] = !ov.kinds[b.dataset.kind]; renderOverview(); }));
  }

  // ================= 排序(Banner 轮播 / 顶栏轮播共用)=================
  // 点「调整顺序」进入编辑模式 → 拖动 → 点「保存顺序」才生效(编辑是「提交顺序审核」)。
  // 参与排序的 = 上线中 + 已排期 + 待审核 + 暂停中的(已结束 / 草稿不占位置)
  const ORD_ST = ['live', 'scheduled', 'pending', 'waiting', 'paused'];
  const ord = { banner: null, topbar: null }; // 编辑模式下的草稿顺序(id 数组);null = 没在编辑
  const ordPipeline = (kind) => listOf(kind).filter((x) => ORD_ST.includes(status(x))).sort(byOrder);
  function wireOrderDrag(box, kind, rerender) {
    let dragId = null;
    $$(`${box} [data-ord]`).forEach((el) => {
      el.addEventListener('dragstart', (e) => { dragId = el.dataset.ord; el.classList.add('is-drag'); e.dataTransfer && (e.dataTransfer.effectAllowed = 'move'); });
      el.addEventListener('dragend', () => el.classList.remove('is-drag'));
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('is-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('is-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); el.classList.remove('is-over');
        const ids = ord[kind]; const from = ids.indexOf(dragId), to = ids.indexOf(el.dataset.ord);
        if (from < 0 || to < 0 || from === to) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]); rerender();
      });
    });
  }
  // 把新顺序写回:参与排序的按新顺序占前面,其余(已结束 / 草稿)保持原相对顺序排在后面
  function applyOrder(kind, ids) {
    const L = listOf(kind); const rest = L.filter((x) => !ids.includes(x.id)).sort(byOrder);
    [...ids.map((id) => L.find((x) => x.id === id)).filter(Boolean), ...rest].forEach((x, i) => { x.order = i; });
  }
  function saveOrder(kind) {
    const ids = ord[kind]; ord[kind] = null;
    const before = ordPipeline(kind).map((x) => x.id);
    if (JSON.stringify(before) === JSON.stringify(ids)) { renderAll(); return toast('顺序没有变化'); }
    if (isApprover()) {
      applyOrder(kind, ids); log('reorder', { kind, title: kind === 'banner' ? 'Banner 轮播顺序' : '顶栏轮播顺序' }, '保存新顺序');
      save(); renderAll(); toast('顺序已保存 · 前台立即按新顺序显示(演示)');
    } else {
      S.pendingOrder = { kind, ids, before, by: S.me, at: now() };
      log('submit', { kind, title: kind === 'banner' ? 'Banner 轮播顺序' : '顶栏轮播顺序' }, '提交新顺序,批准前前台保持原顺序');
      save(); renderAll(); toast('新顺序已提交审核 · 批准前前台保持原顺序');
    }
  }

  // ================= Banner =================
  const bnF = { st: 'live', tag: '', day: 0 };
  function orderCard(b, T, list, editing, isNow) {
    const liveAtT = list.filter((x) => status(x, T) === 'live');
    const s = status(b, T);
    let label, n = null;
    if (s === 'live') { n = liveAtT.indexOf(b) + 1; label = endingSoon(b) && isNow ? `<span class="oc__warn">⚠️ ${fMD(win(b).end)} 下架</span>` : ''; }
    else if (s === 'scheduled') { label = `<span class="oc__lab">${fMD(win(b).start)} 上线</span>`; }
    else if (s === 'ended') { label = '<span class="oc__lab">已下架</span>'; }
    else { label = `<span class="oc__lab">${ST[s]}</span>`; }
    if (n == null && ['scheduled', 'pending', 'waiting'].includes(s)) {
      const t2 = Math.max(T, win(b).start ?? T) + 1000;
      const set = list.filter((x) => x === b || status(x, t2) === 'live');
      n = set.indexOf(b) + 1;
    }
    return `<div class="oc ${s === 'live' ? '' : 'is-off'}" ${editing ? `draggable="true" data-ord="${b.id}"` : ''} data-pop="${b.id}" ${editing ? '' : `data-open="${b.id}"`}>
      <span class="oc__n">${n ? (s === 'live' ? n : '→' + n) : '–'}</span>
      ${slideHtml(b, { w: editing ? 400 : 300 })}
      <span class="oc__t">${esc(b.title || '未命名')}</span>${label}
    </div>`;
  }
  function renderBannerOrder() {
    const editing = !!ord.banner;
    const T = bnF.day ? dayStart(bnF.day) + (now() - today0()) : now();
    const list = editing ? ord.banner.map((id) => S.banners.find((b) => b.id === id)).filter(Boolean) : ordPipeline('banner');
    const days = [0, 1, 3, 7, 14, 30].map((d) => `<option value="${d}" ${bnF.day === d ? 'selected' : ''}>${d === 0 ? '此刻' : `${d} 天后(${fDate(dayStart(d))})`}</option>`).join('');
    const pend = S.pendingOrder && S.pendingOrder.kind === 'banner';
    $('#bn-order').innerHTML = `
      <div class="panel__h">
        <h3>${editing ? '调整轮播顺序' : '首页轮播顺序'}</h3>
        <span class="muted">${editing ? '拖动卡片换位置,点「保存顺序」才生效'
          : `看哪天:<select class="sel sel--sm" id="bn-day">${days}</select>`}
          ${editing ? `<button class="btn btn-sm" data-ordact="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-ordact="save" type="button">${isApprover() ? '保存顺序' : '提交顺序审核'}</button>`
            : `<button class="btn btn-sm" data-ordact="edit" type="button" ${pend ? 'disabled' : ''}>${I.sort}调整顺序</button>`}</span>
      </div>
      ${pend ? `<div class="note note--warn">${esc(who(S.pendingOrder.by))} 提交了新的轮播顺序,等审核中;批准前前台保持现在的顺序。</div>` : ''}
      <p class="muted oc__help">数字 = 在首页轮播里的位置;<b>→5</b> = 上线后会排第 5 张。淡色的是这一刻还没上线的,它们已经排好了位置,到点自动插进去。</p>
      <div class="ocs ${editing ? 'ocs--edit' : ''}" id="bn-ocs">${list.map((b) => orderCard(b, T, list, editing, !bnF.day)).join('') || '<span class="muted">没有上线中或已排期的 Banner</span>'}</div>`;
    if (!editing) $('#bn-day').addEventListener('change', (e) => { bnF.day = +e.target.value; renderBannerOrder(); });
    $$('#bn-order [data-ordact]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.ordact;
      if (a === 'edit') { ord.banner = ordPipeline('banner').map((x) => x.id); bnF.day = 0; renderBannerOrder(); }
      else if (a === 'cancel') { ord.banner = null; renderBannerOrder(); }
      else saveOrder('banner');
    }));
    if (editing) wireOrderDrag('#bn-ocs', 'banner', renderBannerOrder);
  }
  function renderBanners() {
    const chips = [['', '全部类型'], ['new', '新品'], ['sale', '促销'], ['event', '活动'], ['none', '无角标']]
      .map(([k, l]) => `<button class="fchip ${bnF.tag === k ? 'is-active' : ''}" data-tag="${k}" type="button">${l}</button>`).join('');
    const rows = S.banners.filter((b) => inTab(b, bnF.st) && (!bnF.tag || b.tag === bnF.tag)).sort(byStatusThenOrder);
    const card = (b) => `<button class="bcard ${status(b) === 'ended' ? 'is-dim' : ''}" data-open="${b.id}" type="button">
      <span class="bcard__slide">${slideHtml(b, { w: 600 })}${posChip(b)}${badge(b)}</span>
      <span class="bcard__body">
        <b class="bcard__t">${esc(b.title || '未命名')}</b>
        <span class="bcard__when">${I.clock}<span>${winText(b)}</span></span>
        ${endingTag(b)}
        ${b.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}
        ${b.state === 'rejected' ? `<span class="tag tag--danger">已退回:${esc(b.rejectNote || '')}</span>` : ''}
      </span>
    </button>`;

    $('#bn-root').innerHTML = `
      ${pageHead('Banner', `首页轮播图,和前台同比例显示(电脑 ${S.site.slide.w}×${S.site.slide.h} · 手机 ${S.site.slide.mw}×${S.site.slide.mh})。每张独立排期,也可以跟随活动。`, `<button class="btn btn-primary" data-new="banner" type="button">${I.plus}新建 Banner</button>`)}
      ${alertsHtml(['banner'])}
      <section class="panel" id="bn-order"></section>
      <div class="fbar"><div class="ftabs">${tabsHtml(S.banners, bnF.st)}</div><div class="fchips">${chips}</div></div>
      <div class="bgrid">${rows.map(card).join('') || empty('没有符合条件的 Banner')}</div>`;
    renderBannerOrder();
    $$('#bn-root .ftab').forEach((b) => b.addEventListener('click', () => { bnF.st = b.dataset.st; renderBanners(); }));
    $$('#bn-root .fchip').forEach((b) => b.addEventListener('click', () => { bnF.tag = b.dataset.tag; renderBanners(); }));
  }

  // ================= 顶栏 =================
  let tbDay = 0; let tbTimer = null; let tbIdx = 0; const tbF = { st: 'live' };
  function renderTopbar() {
    const at = dayStart(tbDay) + (now() - today0());
    const liveAt = S.topbar.filter((t) => status(t, at) === 'live').sort(byOrder);
    const styleAt = activeStyle(at);
    const editing = !!ord.topbar;
    const rows = editing ? ord.topbar.map((id) => S.topbar.find((t) => t.id === id)).filter(Boolean) : S.topbar.filter((t) => inTab(t, tbF.st)).sort(byStatusThenOrder);
    const days = [0, 1, 3, 7, 14, 30, 60, 75, 90].map((d) => `<option value="${d}" ${tbDay === d ? 'selected' : ''}>${d === 0 ? '此刻' : `${d} 天后(${fDate(dayStart(d))})`}</option>`).join('');
    const styles = [...S.tbstyles].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || byStatusThenOrder(a, b));
    const pend = S.pendingOrder && S.pendingOrder.kind === 'topbar';
    $('#tb-root').innerHTML = `
      ${pageHead('顶栏公告', '网站最上方轮播的一行字。公告和「样式」分开管:公告决定说什么,样式决定长什么样(节日可以自动换装)。',
        `<button class="btn" data-new="tbstyle" type="button">${I.plus}新建样式</button><button class="btn btn-primary" data-new="topbar" type="button">${I.plus}新建公告</button>`)}
      ${alertsHtml(['topbar', 'tbstyle'])}
      <section class="panel">
        <div class="panel__h"><h3>预览顶栏</h3>
          <span class="muted">看哪天:<select class="sel sel--sm" id="tb-day">${days}</select>
            <button class="btn btn-sm btn-ghost" id="tb-prev" type="button" aria-label="上一条">${I.left}</button><button class="btn btn-sm btn-ghost" id="tb-next" type="button" aria-label="下一条">${I.right}</button></span></div>
        ${topbarHtml('', { style: styleAt, id: 'tb-msg' })}
        <p class="muted tbpv__note">这一天用 <b>${esc(styleAt.name || '默认样式')}</b> 样式,轮播 <b>${liveAt.length}</b> 条:${liveAt.map((t) => esc(titleOf(t))).join(' · ') || '无'}</p>
      </section>
      <section class="panel">
        <div class="panel__h"><h3>样式(节日主题)</h3><span class="muted">到了时间自动换装,结束后回到默认样式;同时有多个时,优先级高的生效</span></div>
        <div class="tbstyles">${styles.map((x) => `<button class="tbs" data-open="${x.id}" data-pop="${x.id}" type="button">
          <span class="tbs__bar" style="background:${esc(x.bg)};color:${esc(x.color)}">${fxHtml(x.effect)}<span>${esc(x.decoLeft || '')} Aa ${esc(x.decoRight || '')}</span></span>
          <span class="tbs__b"><b>${esc(x.name)}</b>${x.isDefault ? '<span class="tag">默认</span>' : badge(x)}</span>
          <span class="tbs__w">${x.isDefault ? '没有其他样式生效时使用' : winText(x)}</span>
        </button>`).join('')}</div>
      </section>
      <div class="fbar"><div class="ftabs">${editing ? '<b class="fbar__t">调整轮播顺序</b>' : tabsHtml(S.topbar, tbF.st)}</div>
        <span class="muted">${editing ? `拖动左侧把手换位置,点「保存顺序」才生效 <button class="btn btn-sm" data-tbord="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-tbord="save" type="button">${isApprover() ? '保存顺序' : '提交顺序审核'}</button>`
          : `<button class="btn btn-sm" data-tbord="edit" type="button" ${pend ? 'disabled' : ''}>${I.sort}调整顺序</button>`}</span></div>
      ${pend ? `<div class="note note--warn">${esc(who(S.pendingOrder.by))} 提交了新的顶栏顺序,等审核中。</div>` : ''}
      <section class="panel">
        <div class="tblist" id="tb-list">${rows.map((t, i) => `
          <div class="tbrow ${status(t) === 'ended' ? 'is-dim' : ''}" ${editing ? `draggable="true" data-ord="${t.id}"` : ''} data-pop="${t.id}">
            <span class="tbrow__grip">${editing ? I.grip : ''}</span>
            ${editing ? `<span class="tbrow__n">${i + 1}</span>` : ''}
            <button class="tbrow__main" ${editing ? '' : `data-open="${t.id}"`} type="button">
              <span class="tbrow__txt">${esc(titleOf(t))}</span>
              <span class="tbrow__meta"><span class="kchip">${esc(t.category || '')}</span>${I.clock}${winText(t)}${t.link ? ` · <span class="mono">${esc(t.link)}</span>` : ''}</span>
            </button>
            ${endingTag(t)}${t.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}${badge(t)}
          </div>`).join('') || '<p class="muted">没有这个状态的公告</p>'}</div>
      </section>`;
    const show = () => {
      const el = $('#tb-msg'); if (!el) return;
      if (!liveAt.length) { el.innerHTML = '<span class="tbar__empty">这一天顶栏没有内容</span>'; return; }
      el.innerHTML = tbMsg(liveAt[((tbIdx % liveAt.length) + liveAt.length) % liveAt.length], styleAt);
    };
    tbIdx = 0; show();
    clearInterval(tbTimer); tbTimer = setInterval(() => { tbIdx++; show(); }, 4000);
    $('#tb-prev').addEventListener('click', () => { tbIdx--; show(); });
    $('#tb-next').addEventListener('click', () => { tbIdx++; show(); });
    $('#tb-day').addEventListener('change', (e) => { tbDay = +e.target.value; renderTopbar(); });
    $$('#tb-root .ftab').forEach((b) => b.addEventListener('click', () => { tbF.st = b.dataset.st; renderTopbar(); }));
    $$('#tb-root [data-tbord]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.tbord;
      if (a === 'edit') { ord.topbar = ordPipeline('topbar').map((x) => x.id); renderTopbar(); }
      else if (a === 'cancel') { ord.topbar = null; renderTopbar(); }
      else saveOrder('topbar');
    }));
    if (editing) wireOrderDrag('#tb-list', 'topbar', renderTopbar);
  }

  // ================= 活动 =================
  const cpF = { st: 'live' };
  function renderCampaigns() {
    const rows = S.campaigns.filter((c) => inTab(c, cpF.st)).sort((a, b) => RANK[status(a)] - RANK[status(b)] || (a.start ?? 0) - (b.start ?? 0));
    const card = (c) => {
      const bn = S.banners.filter((b) => b.campaign === c.id), tb = S.topbar.filter((t) => t.campaign === c.id), sty = S.tbstyles.filter((t) => t.campaign === c.id);
      const st = scopeTotal(c);
      const zero = [...(c.collections || []).filter((x) => colCount(x) === 0).map((x) => x.title), ...(c.tags || []).filter((t) => tagCount(t) === 0)];
      return `<button class="ccard ${status(c) === 'ended' ? 'is-dim' : ''}" data-open="${c.id}" type="button">
        <span class="ccard__top"><b>${esc(c.name)}</b>${badge(c)}</span>
        <span class="ccard__when">${I.clock}${winText(c)}</span>
        ${endingTag(c)}
        <span class="ccard__row"><span class="muted">产品</span><span class="ccard__v ccard__v--col">${campScope(c, false, '<br>')}<br><span class="muted">合计约 <b>${st.total}${st.unknown ? '+' : ''}</b> 个${st.overlap ? '(可能有重叠)' : ''}</span></span></span>
        ${zero.length ? `<span class="tag tag--danger">⚠️ ${esc(zero.join('、'))} 里没有产品</span>` : ''}
        <span class="ccard__row"><span class="muted">产品页</span><span class="ccard__v">${c.badge ? `<span class="pbadge">${esc(c.badge)}</span>` : '<span class="muted">无徽章</span>'}${c.countdown ? '<span class="tag">倒计时</span>' : ''}</span></span>
        <span class="ccard__row"><span class="muted">包含</span><span class="ccard__v">${bn.length} 张 Banner · ${tb.length} 条顶栏${sty.length ? ` · ${sty.length} 个顶栏样式` : ''}</span></span>
        ${bn.length ? `<span class="ccard__thumbs">${bn.map((b) => `<span class="ccard__t">${slideHtml(b, { w: 200 })}</span>`).join('')}</span>` : ''}
      </button>`;
    };
    const tabs = [['live', '进行中'], ['scheduled', '已排期'], ['draft', '草稿'], ['ended', '已结束'], ['', '全部']]
      .map(([k, l]) => `<button class="ftab ${cpF.st === k ? 'is-active' : ''}" data-st="${k}" type="button">${l}<span>${S.campaigns.filter((c) => inTab(c, k)).length}</span></button>`).join('');
    $('#cp-root').innerHTML = `
      ${pageHead('活动(促销)', '有时间段的促销:选好参加的产品(合集 / 标签 / 手动指定),产品页自动显示徽章和倒计时;挂在活动下的 Banner / 顶栏 / 顶栏样式和它同时上线、同时结束。',
        `<button class="btn btn-primary" data-new="campaign" type="button">${I.plus}新建活动</button>`)}
      ${alertsHtml(['campaign'])}
      <div class="fbar"><div class="ftabs">${tabs}</div>${S.catalogFetchedAt ? `<span class="muted">产品数取自前台,更新于 ${fDT(new Date(S.catalogFetchedAt).getTime())}</span>` : ''}</div>
      <div class="cgrid">${rows.map(card).join('') || empty('没有这个状态的活动')}</div>`;
    $$('#cp-root .ftab').forEach((b) => b.addEventListener('click', () => { cpF.st = b.dataset.st; renderCampaigns(); }));
  }

  // ================= 审核 =================
  const FIELD = {
    title: '标题', subtitle: '副标题', description: '描述', image: '图片', tag: '角标', button1_text: '按钮 1 文字', button1_url: '按钮 1 链接',
    button2_text: '按钮 2 文字', button2_url: '按钮 2 链接', emoji: 'Emoji', text: '文字', link: '链接', category: '分类',
    name: '名称', collections: '合集', tags: '标签', products: '指定产品', badge: '徽章文字', countdown: '倒计时', priority: '优先级',
    bg: '底色', color: '文字颜色', accent: '点缀色', effect: '特效', decoLeft: '左侧装饰', decoRight: '右侧装饰',
    start: '开始', end: '结束', campaign: '所属活动',
  };
  const showVal = (k, v) => {
    if (v == null || v === '') return '<span class="muted">(空)</span>';
    if (k === 'start' || k === 'end') return esc(fDT(v));
    if (k === 'campaign') return esc((camp(v) || {}).name || v);
    if (k === 'countdown') return v ? '开' : '关';
    if (k === 'tag') return esc(TAGCN[v] || v);
    if (k === 'effect') return esc(EFFECT[v] || v);
    if (['bg', 'color', 'accent'].includes(k)) return `<span class="swatch" style="background:${esc(v)}"></span> <span class="mono">${esc(v)}</span>`;
    if (k === 'image') return `<img class="rv__img" src="${esc(thumb(v, 300))}" alt="">`;
    if (Array.isArray(v)) return v.length ? esc(v.map((x) => (typeof x === 'string' ? x : x.title)).join('、')) : '<span class="muted">(空)</span>';
    return esc(v);
  };
  function renderReviews() {
    const list = pendingList();
    const recent = S.log.filter((l) => ['approve', 'reject'].includes(l.action)).slice(0, 8);
    const card = (it) => {
      const isChange = !!it.pendingChange;
      const by = isChange ? it.pendingChange.by : it.by;
      const at = isChange ? it.pendingChange.at : it.submittedAt;
      const w = win(it);
      let body;
      if (isChange) {
        const rows = Object.entries(it.pendingChange).filter(([k]) => !['by', 'at'].includes(k))
          .map(([k, v]) => `<tr><td>${FIELD[k] || k}</td><td>${showVal(k, it[k])}</td><td>${showVal(k, v)}</td></tr>`).join('');
        body = `<table class="rvdiff"><thead><tr><th>改了什么</th><th>线上现在</th><th>改成</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="muted">批准前,线上继续显示原来的版本。</p>`;
      } else {
        const img = it.kind === 'banner' ? `<span class="rv__slide">${slideHtml(it, { w: 400 })}</span>`
          : it.kind === 'tbstyle' ? `<span class="rv__bar">${topbarHtml(tbMsg({ kind: 'topbar', emoji: '🚚', text: 'Free UK Delivery' }, it), { style: it })}</span>` : '';
        const p = it.kind === 'banner' ? bannerPos(it) : null;
        body = `<div class="rvnew">${img}<div>
          <div><b>${esc(titleOf(it))}</b>${it.subtitle ? ` <span class="muted">${esc(it.subtitle)}</span>` : ''}</div>
          <div class="muted">${I.clock}${winText(it)}</div>
          ${p ? `<div class="muted">上线后在首页轮播排第 <b>${p.n}</b> 张</div>` : ''}
          ${it.kind === 'campaign' ? `<div class="muted">产品:${campScope(it)}</div>` : ''}
          ${w.start != null && w.start > now() ? `<div class="muted">批准后会在 <b>${fDT(w.start)}</b>(${relDay(w.start)})自动上线</div>` : '<div class="muted">批准后立即上线</div>'}
        </div></div>`;
      }
      return `<div class="rvcard">
        <div class="rvcard__h">${kindChip(it.kind)}<b>${isChange ? '修改' : '新建'}:${esc(titleOf(it))}</b>
          <span class="muted">${esc(who(by))} · ${at ? fAgo(at) : ''}提交</span></div>
        ${body}
        <div class="rvcard__act">
          <button class="btn btn-sm" data-open="${it.id}" type="button">查看详情</button>
          ${isApprover() ? `<button class="btn btn-sm btn-danger" data-reject="${it.id}" type="button">退回</button>
            <button class="btn btn-sm btn-primary" data-approve="${it.id}" type="button">批准</button>` : '<span class="muted">等待审核人处理</span>'}
        </div>
      </div>`;
    };
    // 轮播顺序的修改:前后对比两排缩略图
    const orderCardRv = () => {
      const o = S.pendingOrder; if (!o) return '';
      const L = listOf(o.kind);
      const strip = (ids) => `<div class="rvord">${ids.map((id, i) => { const x = L.find((y) => y.id === id); if (!x) return '';
        return o.kind === 'banner' ? `<span class="rvord__i"><span class="rvord__n">${i + 1}</span>${slideHtml(x, { w: 200 })}</span>` : `<span class="rvord__tb">${i + 1}. ${esc(titleOf(x))}</span>`; }).join('')}</div>`;
      return `<div class="rvcard">
        <div class="rvcard__h">${kindChip(o.kind)}<b>修改:${o.kind === 'banner' ? '首页轮播顺序' : '顶栏轮播顺序'}</b><span class="muted">${esc(who(o.by))} · ${fAgo(o.at)}提交</span></div>
        <div class="muted">现在</div>${strip(o.before)}<div class="muted">改成</div>${strip(o.ids)}
        <div class="rvcard__act">${isApprover() ? `<button class="btn btn-sm btn-danger" data-reject="__order" type="button">退回</button><button class="btn btn-sm btn-primary" data-approve="__order" type="button">批准</button>` : '<span class="muted">等待审核人处理</span>'}</div>
      </div>`;
    };
    $('#rv-root').innerHTML = `
      ${pageHead('审核', isApprover() ? '同事提交的新内容和修改。批准后按时间自动上线;退回会附上你的意见。' : '你提交的内容在这里等审核人处理。')}
      ${orderCardRv()}
      ${list.length ? list.map(card).join('') : S.pendingOrder ? '' : empty('没有待审核的内容 👍')}
      <section class="panel"><div class="panel__h"><h3>最近的审核记录</h3></div>
        ${recent.length ? `<div class="loglist">${recent.map(logRow).join('')}</div>` : '<p class="muted">还没有记录</p>'}
      </section>`;
  }
  function approve(id) {
    if (id === '__order') {
      const o = S.pendingOrder; applyOrder(o.kind, o.ids); S.pendingOrder = null;
      log('approve', { kind: o.kind, title: o.kind === 'banner' ? 'Banner 轮播顺序' : '顶栏轮播顺序' }, '批准新顺序');
      save(); renderAll(); return toast('已批准 · 前台按新顺序显示(演示)');
    }
    const it = byId(id);
    if (it.pendingChange) {
      const { by, at, ...ch } = it.pendingChange; Object.assign(it, ch); it.pendingChange = null;
      log('approve', it, '批准修改,已替换线上版本');
    } else { it.state = 'approved'; it.rejectNote = null; log('approve', it, '批准'); }
    save(); renderAll();
    const s = status(it);
    toast(s === 'scheduled' ? `已批准 · 将在 ${fDT(win(it).start)} 自动上线` : s === 'live' ? '已批准 · 已上线' : `已批准 · ${ST[s]}`);
  }
  // 嵌入 Shopify 后台的 iframe 里 prompt/confirm 可能被浏览器拦截,一律用页面内的输入框和二次确认
  function askReject(btn) {
    const card = btn.closest('.rvcard'); if (card.querySelector('.rjbox')) return;
    card.querySelector('.rvcard__act').insertAdjacentHTML('beforebegin', `<div class="rjbox">
      <textarea class="inp" rows="2" placeholder="退回原因,会通知提交人(例如:图片换一张 / 结束时间改到周日)"></textarea>
      <div class="rjbox__act"><button class="btn btn-sm" data-rjcancel type="button">取消</button>
      <button class="btn btn-sm btn-danger" data-rjok="${btn.dataset.reject}" type="button">确认退回</button></div></div>`);
    card.querySelector('.rjbox textarea').focus();
  }
  function reject(id, note) {
    if (id === '__order') {
      const o = S.pendingOrder; S.pendingOrder = null;
      log('reject', { kind: o.kind, title: o.kind === 'banner' ? 'Banner 轮播顺序' : '顶栏轮播顺序' }, '退回新顺序:' + note);
      save(); renderAll(); return toast('已退回 · 已在飞书通知提交人(演示)');
    }
    const it = byId(id);
    if (it.pendingChange) { it.lastReject = { note, at: now() }; it.pendingChange = null; log('reject', it, '退回修改:' + note); }
    else { it.state = 'rejected'; it.rejectNote = note; log('reject', it, '退回:' + note); }
    save(); renderAll(); toast('已退回 · 已在飞书通知提交人(演示)');
  }

  // ================= 设置 =================
  const ACT = { up: '上线', down: '下线', approve: '批准', reject: '退回', submit: '提交审核', draft: '存草稿', reorder: '调整顺序', pause: '暂停', resume: '恢复', delete: '删除', edit: '修改' };
  const logRow = (l) => `<div class="logrow"><span class="logrow__t">${fDT(l.at)}</span><span class="lact lact--${l.action}">${ACT[l.action] || l.action}</span>${kindChip(l.kind)}<span class="logrow__x">${esc(l.title)}</span><span class="muted">${esc(l.note || '')}${l.by ? ' · ' + esc(l.by) : ''}</span></div>`;
  function renderSettings() {
    const N = S.settings.notify;
    const tg = (k, label, hint) => `<label class="tgl"><input type="checkbox" data-notify="${k}" ${N[k] ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>${label}</b><span class="muted">${hint}</span></span></label>`;
    $('#st-root').innerHTML = `
      ${pageHead('设置', '成员与审核、飞书通知、定时器和操作日志')}
      <div class="stgrid">
        <section class="panel">
          <div class="panel__h"><h3>当前身份</h3><span class="tag tag--warn">演示用</span></div>
          <p class="muted">正式版会自动识别登录 Shopify 后台的员工。演示时切换身份,就能分别体验「编辑提交」和「审核人批准」两边。</p>
          <select class="sel" id="st-me">${S.staff.map((u) => `<option value="${u.id}" ${u.id === S.me ? 'selected' : ''}>${esc(u.name)} · ${u.role === 'approver' ? '审核人' : '编辑'}</option>`).join('')}</select>
        </section>
        <section class="panel">
          <div class="panel__h"><h3>成员与角色</h3></div>
          <p class="muted"><b>审核人</b>:自己的改动直接生效,能批准 / 退回别人的。<b>编辑</b>:改动要提交审核才会上线。</p>
          ${S.staff.map((u) => `<div class="mrow"><span class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</span><b>${esc(u.name)}</b>
            <select class="sel sel--sm" data-role="${u.id}"><option value="approver" ${u.role === 'approver' ? 'selected' : ''}>审核人</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>编辑</option></select></div>`).join('')}
        </section>
        <section class="panel">
          <div class="panel__h"><h3>飞书通知</h3></div>
          <label class="fld"><span>群机器人 Webhook 地址</span>
            <input class="inp" id="st-hook" placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/…" value="${esc(S.settings.larkWebhook)}"/></label>
          <div class="tgls">
            ${tg('submit', '有人提交审核', '@审核人')}
            ${tg('decision', '批准 / 退回', '@提交人,附退回意见')}
            ${tg('dayBefore', '上线前一天提醒', '附明天要上线的清单和预览')}
            ${tg('endingSoon', `下架前 ${ENDING_DAYS} 天提醒`, '列出快到期的 Banner / 公告 / 活动,方便决定延长还是准备替换')}
            ${tg('upDown', '上线 / 下线', '每次自动切换都通知')}
            ${tg('unapproved', '到点还没批准', '@审核人:内容没上线')}
            ${tg('failure', '定时切换失败', '@审核人 + 错误原因')}
          </div>
          <button class="btn btn-sm" id="st-test" type="button">发送测试消息</button>
        </section>
        <section class="panel">
          <div class="panel__h"><h3>定时器</h3><span class="stb stb--live"><span class="dot"></span>运行中</span></div>
          <div class="kv"><span>检查频率</span><b>每分钟</b></div>
          <div class="kv"><span>时区</span><b>英国时间(Europe/London,自动处理夏令时)</b></div>
          <div class="kv"><span>上次运行</span><b>${fDT(now() - 40000)}</b></div>
          <p class="muted">每分钟检查一次:到了开始时间且已批准的内容自动上线,到了结束时间的自动下线。服务器短暂宕机的话,恢复后会自动补上。</p>
        </section>
      </div>
      <section class="panel">
        <div class="panel__h"><h3>操作日志</h3><span class="muted">谁、什么时候、做了什么</span></div>
        <div class="loglist">${S.log.slice(0, 40).map(logRow).join('') || '<p class="muted">暂无</p>'}</div>
      </section>`;
    $('#st-me').addEventListener('change', (e) => { S.me = e.target.value; ord.banner = null; ord.topbar = null; save(); renderAll(); toast(`现在的身份:${me().name} · ${isApprover() ? '审核人' : '编辑'}`); });
    $$('[data-role]').forEach((s) => s.addEventListener('change', () => { S.staff.find((u) => u.id === s.dataset.role).role = s.value; save(); renderAll(); }));
    $$('[data-notify]').forEach((c) => c.addEventListener('change', () => { N[c.dataset.notify] = c.checked; save(); }));
    $('#st-hook').addEventListener('change', (e) => { S.settings.larkWebhook = e.target.value.trim(); save(); toast('已保存 Webhook 地址(演示)'); });
    $('#st-test').addEventListener('click', () => toast('演示模式:不会真的发送。正式版会往飞书群发一条测试消息。'));
  }

  // ================= 编辑抽屉 =================
  let pvTimer = null;
  let ed = null; // 当前编辑中活动的产品范围(合集 / 标签 / 产品),不在普通输入框里,单独存
  function newItem(kind, preset = {}) {
    const baseIt = { kind, state: 'new', by: S.me, campaign: preset.campaign || null, paused: false, pendingChange: null };
    if (kind === 'banner') return { ...baseIt, id: rid('b-'), image: '', title: '', subtitle: '', description: '', button1_text: 'Shop Now', button1_url: '', button2_text: '', button2_url: '', tag: 'new', order: S.banners.length, start: preset.campaign ? null : dayStart(1), end: null };
    if (kind === 'topbar') return { ...baseIt, id: rid('t-'), emoji: '📣', text: '', link: '', category: '公告', order: S.topbar.length, start: null, end: null };
    if (kind === 'tbstyle') return { ...baseIt, id: rid('s-'), name: '', bg: '#9b1c1c', color: '#ffffff', accent: '#f5d06f', effect: 'snow', decoLeft: '🎄', decoRight: '', priority: 10, start: preset.campaign ? null : dayStart(7), end: preset.campaign ? null : dayStart(14) };
    return { ...baseIt, id: rid('c-'), name: '', start: dayStart(3), end: dayStart(10), collections: [], tags: [], products: [], badge: '', countdown: true, priority: 10 };
  }
  const fld = (label, html, hint = '') => `<label class="fld"><span>${label}</span>${html}${hint ? `<em>${hint}</em>` : ''}</label>`;
  const inp = (name, v, ph = '') => `<input class="inp" name="${name}" value="${esc(v ?? '')}" placeholder="${esc(ph)}"/>`;

  function timeBlock(it, kind) {
    if (it.isDefault) return '<div class="fld"><span>什么时候显示</span><em>默认样式一直有效:没有其他样式生效的时候就用它。</em></div>';
    const mode = kind !== 'campaign' && it.campaign && it.start == null && it.end == null ? 'campaign'
      : it.start == null && it.end == null ? 'long' : 'range';
    const opts = kind === 'campaign' ? [['range', '设定时间']] : [['long', '长期显示'], ['range', '设定时间'], ['campaign', '跟随活动']];
    return `<div class="fld"><span>什么时候显示</span>
      <div class="seg" id="ed-mode" ${opts.length < 2 ? 'hidden' : ''}>${opts.map(([k, l]) => `<button type="button" data-mode="${k}" class="${mode === k ? 'is-active' : ''}">${l}</button>`).join('')}</div>
      <div class="tm tm--range" ${mode === 'range' ? '' : 'hidden'}>
        <label>开始<input class="inp" type="datetime-local" name="start" value="${toInput(it.start)}"/></label>
        <label>结束<input class="inp" type="datetime-local" name="end" value="${toInput(it.end)}"/><em>留空 = 一直显示</em></label>
      </div>
      ${kind !== 'campaign' ? `<div class="tm tm--campaign" ${mode === 'campaign' ? '' : 'hidden'}>
        <select class="sel" name="campaign"><option value="">选择活动…</option>${S.campaigns.map((c) => `<option value="${c.id}" ${it.campaign === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(winText(c))}</option>`).join('')}</select>
        <em>和活动同时上线、同时结束</em></div>
        <div class="tm tm--long" ${mode === 'long' ? '' : 'hidden'}><em>不设时间,批准后一直显示,直到手动暂停</em></div>` : ''}
      <em class="tz">时间按英国时间 · 上线中的内容在下架前 ${ENDING_DAYS} 天会提醒</em>
    </div>`;
  }

  // 活动的产品范围:三行(合集 / 标签 / 指定产品),每个小标签带产品数和后台 / 前台链接
  function scopeHtml() {
    const rm = (key, i) => `<button type="button" class="chip__x" data-rm="${key}:${i}" aria-label="移除">${I.x}</button>`;
    const cnt = (n) => `<span class="chip__n ${n === 0 ? 'is-zero' : ''}">${n == null ? '? 个' : `${n} 个产品`}${n === 0 ? ' ⚠️' : ''}</span>`;
    const st = scopeTotal(ed);
    return `
      <div class="scope__row"><span class="scope__k">合集</span>
        <span class="chips">${ed.collections.map((c, i) => `<span class="chip"><span class="chip__t">${esc(c.title)}</span>${cnt(colCount(c))}${linkPair('collections', c)}${rm('collections', i)}</span>`).join('')}
          <button type="button" class="chipadd" data-pick="collections">${I.plus}选择合集</button></span></div>
      <div class="scope__row"><span class="scope__k">标签</span>
        <span class="chips">${ed.tags.map((t, i) => `<span class="chip"><span class="chip__t mono">${esc(t)}</span>${cnt(tagCount(t))}${linkPair('tags', t)}${rm('tags', i)}</span>`).join('')}
          <input class="chipinp" id="sc-tag" list="sc-tags" placeholder="输入标签,回车添加"/>
          <datalist id="sc-tags">${Object.entries(S.tagCounts).filter(([t]) => !ed.tags.includes(t)).map(([t, n]) => `<option value="${esc(t)}">${n} 个产品</option>`).join('')}</datalist></span></div>
      <div class="scope__row"><span class="scope__k">指定产品</span>
        <span class="chips">${ed.products.map((p, i) => `<span class="chip chip--p">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span class="chip__t">${esc(p.title)}</span>${linkPair('products', p)}${rm('products', i)}</span>`).join('')}
          <button type="button" class="chipadd" data-pick="products">${I.plus}选择产品</button></span></div>
      <div class="scope__sum">合计约 <b>${st.total}${st.unknown ? '+' : ''}</b> 个产品${st.overlap ? ',合集和标签之间可能有重叠(正式版会算出准确的去重数量)' : ''}</div>`;
  }

  function formHtml(it) {
    if (it.kind === 'banner') {
      const imgs = [...new Set(S.banners.map((b) => b.image).filter(Boolean))].slice(0, 30);
      const p = it.state !== 'new' ? bannerPos(it) : null;
      return `
        ${p ? `<div class="note">${p.future ? `上线后在首页轮播排 <b>第 ${p.n} 张</b>` : `现在在首页轮播排 <b>第 ${p.n} 张</b>`}。要换位置,去 Banner 页点「调整顺序」。</div>` : ''}
        ${fld('图片', `<div class="imgpick" id="ed-imgs">${imgs.map((u) => `<button type="button" class="imgpick__i ${u === it.image ? 'is-on' : ''}" data-img="${esc(u)}" style="background-image:url('${esc(thumb(u, 200))}')"></button>`).join('')}</div>
          <input class="inp" name="image" value="${esc(it.image)}" placeholder="或粘贴图片地址"/>`, `竖图 ${S.site.slide.w}×${S.site.slide.h}(电脑)/ ${S.site.slide.mw}×${S.site.slide.mh}(手机),两边比例几乎一样,一张图就够。正式版在这里直接上传(存到 Shopify Files),演示时从现有图片里选。`)}
        ${fld('标题', inp('title', it.title, '如:DZOFILM Arles Zoom'))}
        ${fld('副标题', inp('subtitle', it.subtitle, '如:UP TO 30% OFF'))}
        ${fld('描述', inp('description', it.description))}
        <div class="fld2">${fld('按钮 1 文字', inp('button1_text', it.button1_text))}${fld('按钮 1 链接', inp('button1_url', it.button1_url, '/collections/…'))}</div>
        <div class="fld2">${fld('按钮 2 文字', inp('button2_text', it.button2_text))}${fld('按钮 2 链接', inp('button2_url', it.button2_url))}</div>
        ${fld('角标 / 类型', `<div class="seg" id="ed-tag">${Object.entries(TAGCN).map(([k, l]) => `<button type="button" data-tag="${k}" class="${it.tag === k ? 'is-active' : ''}">${l}</button>`).join('')}</div>`, '卡片左上角的 New / Sale / Event')}
        ${timeBlock(it, 'banner')}`;
    }
    if (it.kind === 'topbar') {
      return `
        <div class="fld2 fld2--emoji">${fld('Emoji', inp('emoji', it.emoji))}${fld('文字', inp('text', it.text, '如:Free UK Delivery on orders over £100'))}</div>
        ${fld('链接', inp('link', it.link, '点击跳转,可留空'))}
        ${fld('分类', `<select class="sel" name="category">${['公告', '促销', '新品', '服务', '节日'].map((c) => `<option ${it.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`, '只用于后台筛选,前台不显示')}
        <div class="note">外观(底色、节日特效)在「顶栏 → 样式」里统一设置,到时间自动换装。</div>
        ${timeBlock(it, 'topbar')}`;
    }
    if (it.kind === 'tbstyle') {
      const color = (n, v, l) => `<label class="clr"><input type="color" name="${n}" value="${esc(v)}"/><span>${l}</span><span class="mono">${esc(v)}</span></label>`;
      return `
        ${fld('样式名称', inp('name', it.name, '如:圣诞节 / Black Friday'))}
        <div class="fld"><span>颜色</span><div class="clrs">${color('bg', it.bg, '底色')}${color('color', it.color, '文字')}${color('accent', it.accent || '#f5d06f', '点缀(链接 / 箭头)')}</div></div>
        ${fld('特效', `<div class="seg" id="ed-effect">${Object.entries(EFFECT).map(([k, l]) => `<button type="button" data-effect="${k}" class="${(it.effect || 'none') === k ? 'is-active' : ''}">${l}</button>`).join('')}</div>`, '轻量的动画,只在顶栏这一条里,不影响页面其他地方')}
        <div class="fld2">${fld('公告前的装饰', inp('decoLeft', it.decoLeft, '如:🎄'))}${fld('公告后的装饰', inp('decoRight', it.decoRight, '如:🎅'))}</div>
        ${it.isDefault ? '' : fld('优先级', `<input class="inp" type="number" name="priority" value="${esc(it.priority ?? 10)}"/>`, '两个样式时间重叠时,数字大的生效')}
        ${timeBlock(it, 'tbstyle')}`;
    }
    const bn = S.banners.filter((b) => b.campaign === it.id), tb = S.topbar.filter((t) => t.campaign === it.id), sty = S.tbstyles.filter((t) => t.campaign === it.id);
    return `
      ${fld('活动名称', inp('name', it.name, '如:Autumn Sale'))}
      ${timeBlock(it, 'campaign')}
      <div class="fld"><span>参加活动的产品 <em>满足任一条件就参加</em></span>
        <div class="scope" id="ed-scope">${scopeHtml()}</div>
        <em>在任一合集里、带任一标签、或被单独指定的产品,都会显示本活动的徽章和倒计时。点「后台↗ / 前台↗」可以核对具体是哪些产品。</em></div>
      <div class="fld2">${fld('产品页徽章文字', inp('badge', it.badge, '如:Autumn Sale -20%'))}${fld('优先级', `<input class="inp" type="number" name="priority" value="${esc(it.priority)}"/>`, '一个产品同时在多个活动里时,数字大的优先')}</div>
      <label class="tgl"><input type="checkbox" name="countdown" ${it.countdown ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>产品页显示倒计时</b><span class="muted">全站统一样式,倒数到活动结束,到期自动消失</span></span></label>
      ${it.state !== 'new' ? `<div class="fld"><span>挂在本活动下的内容</span>
        <div class="attach">${[...bn, ...tb, ...sty].map((x) => `<button type="button" class="attach__i" data-open="${x.id}" data-pop="${x.id}">
          ${x.kind === 'banner' ? `<span class="attach__slide">${slideHtml(x, { w: 200 })}</span>` : miniThumb(x)}
          <span class="attach__t">${kindChip(x.kind)} ${esc(titleOf(x))}</span>${badge(x)}</button>`).join('') || '<span class="muted">还没有</span>'}</div>
        <div class="attach__add"><button type="button" class="btn btn-sm" data-new="banner" data-for="${it.id}">${I.plus}Banner</button><button type="button" class="btn btn-sm" data-new="topbar" data-for="${it.id}">${I.plus}顶栏公告</button><button type="button" class="btn btn-sm" data-new="tbstyle" data-for="${it.id}">${I.plus}顶栏样式</button></div></div>` : ''}`;
  }

  function previewHtml(v) {
    if (v.kind === 'banner') {
      // 首页轮播里的样子:左右是相邻的上线中 Banner(淡一点),中间是正在编辑的这张
      const live = S.banners.filter((b) => status(b) === 'live' && b.id !== v.id).sort(byOrder);
      const idx = Math.max(0, live.findIndex((b) => b.order > v.order));
      const prev = live[(idx - 1 + live.length) % live.length], next = live[idx % live.length];
      return `<div class="pv-label">首页轮播里的样子</div>
        <div class="pv-stage">
          ${prev ? slideHtml(prev, { w: 300, cls: 'is-side' }) : ''}${slideHtml(v, { w: 700, cls: 'is-main' })}${next ? slideHtml(next, { w: 300, cls: 'is-side' }) : ''}
        </div>
        <p class="muted pv-cap">和前台同比例:电脑卡片 ${S.site.slide.w}×${S.site.slide.h},手机 ${S.site.slide.mw}×${S.site.slide.mh}。字号、按钮、角标颜色都取自主题设置。</p>`;
    }
    if (v.kind === 'topbar') {
      const st = activeStyle(Math.max(now(), win(v).start ?? now()) + 1000);
      return `<div class="pv-label">前台预览</div>${topbarHtml(tbMsg(v, st), { style: st })}
        <p class="muted pv-cap">用的是它上线那天生效的样式「${esc(st.name || '默认样式')}」。</p>`;
    }
    if (v.kind === 'tbstyle') {
      const sample = S.topbar.filter((t) => status(t) === 'live').slice(0, 2);
      return `<div class="pv-label">前台预览</div>
        ${(sample.length ? sample : [{ kind: 'topbar', emoji: '🚚', text: 'Free UK Delivery' }]).map((t) => topbarHtml(tbMsg(t, v), { style: v })).join('<div style="height:8px"></div>')}
        <p class="muted pv-cap">预览里用的是现在上线中的公告。样式只换外观,公告内容照常按各自的时间轮播。</p>`;
    }
    const hasScope = v.collections?.length || v.tags?.length || v.products?.length;
    const prod = (v.products || []).find((p) => p.image);
    const bn = S.banners.filter((b) => b.campaign === v.id), tb = S.topbar.filter((t) => t.campaign === v.id);
    const cst = activeStyle((v.start ?? now()) + 1000);
    return `<div class="pv-label">产品页预览</div>
      <div class="pv-pdp">
        <div class="pv-pdp__img" ${prod ? `style="background-image:url('${esc(prod.image)}')"` : ''}></div>
        <div class="pv-pdp__info">
          <div class="pv-pdp__title">${esc(prod?.title || v.products?.[0]?.title || 'DZOFILM VESPID 2 Prime 4 Lens Set')}</div>
          ${v.badge ? `<span class="pbadge">${esc(v.badge)}</span>` : ''}
          <div class="pv-pdp__price">£4,999.00 <s>£5,899.00</s></div>
          ${v.countdown && v.end ? `<div class="pv-cd">Deals Expires in : <span id="pv-cd"></span></div>` : ''}
          <div class="pv-pdp__btn">Add to cart</div>
        </div>
      </div>
      <p class="muted pv-scope">${hasScope ? `活动期间,${campScope(v)} 的产品在产品页显示${v.badge ? '这个徽章' : ''}${v.countdown ? (v.badge ? '和' : '') + '倒计时' : ''};活动结束自动消失。` : '还没选产品:产品页不会显示任何东西,这个活动只用来让挂在它下面的 Banner / 顶栏同时上下线。'}</p>
      ${bn.length ? `<div class="pv-label">挂在活动下的 Banner</div><div class="pv-bns">${bn.map((b) => `<span class="pv-bn" data-pop="${b.id}">${slideHtml(b, { w: 300 })}</span>`).join('')}</div>` : ''}
      ${tb.length ? `<div class="pv-label">挂在活动下的顶栏</div>${tb.map((t) => topbarHtml(tbMsg(t, cst), { style: cst })).join('<div style="height:6px"></div>')}` : ''}`;
  }

  // 合集 / 产品选择器。在 Shopify 后台里打开时优先用 Shopify 自带的选择器(真实数据、可搜全店)
  async function pick(type) {
    if (window.shopify && typeof window.shopify.resourcePicker === 'function') {
      try {
        const sel = await window.shopify.resourcePicker({
          type: type === 'products' ? 'product' : 'collection', multiple: true, action: 'select',
          selectionIds: ed[type].filter((x) => String(x.id || '').startsWith('gid://')).map((x) => ({ id: x.id })),
        });
        if (!sel) return;
        const picked = sel.map((x) => ({ id: x.id, handle: x.handle, title: x.title, image: x.images?.[0]?.originalSrc || '', count: x.productsCount ?? null }));
        ed[type] = [...ed[type].filter((x) => !String(x.id || '').startsWith('gid://')), ...picked];
        return refreshScope();
      } catch (e) { /* 不在后台 / 没权限 → 用下面的演示选择器 */ }
    }
    const src = type === 'products' ? S.products : S.collections;
    const chosen = new Set(ed[type].map((x) => x.handle));
    const box = document.createElement('div');
    box.className = 'picker';
    box.innerHTML = `<div class="picker__box">
      <div class="picker__h"><b>选择${type === 'products' ? '产品' : '合集'}</b><input class="inp" placeholder="搜索" id="pk-q"/></div>
      <div class="picker__list" id="pk-list"></div>
      <div class="picker__f"><span class="muted">演示:${type === 'products' ? '列表是店里标了 New Gear 的真实产品' : '列表是首页链接里出现过的真实合集,数字是前台能看到的产品数'}。在 Shopify 后台打开时,这里会换成 Shopify 自带的选择器,可以搜全店。</span>
        <span class="picker__acts"><button class="btn btn-sm" data-pk="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-pk="ok" type="button">确定</button></span></div>
    </div>`;
    $('#drawer').appendChild(box);
    const list = () => {
      const q = $('#pk-q').value.trim().toLowerCase();
      $('#pk-list').innerHTML = src.filter((x) => !q || x.title.toLowerCase().includes(q) || x.handle.includes(q)).map((x) => `
        <label class="picker__row"><input type="checkbox" value="${esc(x.handle)}" ${chosen.has(x.handle) ? 'checked' : ''}/>
          ${type === 'products' ? `<span class="picker__img" ${x.image ? `style="background-image:url('${esc(x.image)}')"` : ''}></span>` : ''}
          <span class="picker__t">${esc(x.title)}</span>
          <span class="muted picker__m">${type === 'products' ? esc(x.handle) : `${nTxt(x.count)} 个产品`}</span></label>`).join('') || '<p class="muted">没有匹配的</p>';
    };
    list();
    $('#pk-q').addEventListener('input', list);
    $('#pk-list').addEventListener('change', (e) => { if (e.target.checked) chosen.add(e.target.value); else chosen.delete(e.target.value); });
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-pk]'); if (!b && e.target !== box) return;
      if (b && b.dataset.pk === 'ok') {
        const keepOld = ed[type].filter((x) => chosen.has(x.handle));
        const added = src.filter((x) => chosen.has(x.handle) && !keepOld.some((o) => o.handle === x.handle));
        ed[type] = [...keepOld, ...added];
        refreshScope();
      }
      box.remove();
    });
    $('#pk-q').focus();
  }
  function refreshScope() {
    const el = $('#ed-scope'); if (!el) return;
    el.innerHTML = scopeHtml(); $('#ed-form').dispatchEvent(new Event('change'));
  }

  function readForm(base) {
    const f = $('#ed-form'); const g = (n) => f.querySelector(`[name="${n}"]`);
    const v = { ...base };
    f.querySelectorAll('input[name],select[name],textarea[name]').forEach((el) => {
      if (['start', 'end', 'campaign', 'countdown', 'priority'].includes(el.name)) return;
      v[el.name] = el.value.trim();
    });
    if (!base.isDefault) {
      const mode = ($('#ed-mode .is-active') || {}).dataset?.mode || 'range';
      if (mode === 'long') { v.start = null; v.end = null; v.campaign = null; }
      else if (mode === 'campaign') { v.start = null; v.end = null; v.campaign = g('campaign').value || null; }
      else { v.start = fromInput(g('start').value); v.end = fromInput(g('end').value); } // 自己设时间:仍可挂在活动下(分组),但不跟随活动时间
    }
    if (base.kind === 'banner') v.tag = ($('#ed-tag .is-active') || {}).dataset?.tag || 'none';
    if (base.kind === 'tbstyle') { v.effect = ($('#ed-effect .is-active') || {}).dataset?.effect || 'none'; if (g('priority')) v.priority = +g('priority').value || 0; }
    if (base.kind === 'campaign') {
      v.collections = [...ed.collections]; v.tags = [...ed.tags]; v.products = [...ed.products];
      v.countdown = g('countdown').checked; v.priority = +g('priority').value || 0;
    }
    return v;
  }
  function validate(v) {
    if (v.kind === 'banner' && !v.image) return '请选一张图片';
    if (v.kind === 'topbar' && !v.text) return '请填写公告文字';
    if ((v.kind === 'campaign' || v.kind === 'tbstyle') && !v.name) return '请填写名称';
    if (v.kind === 'campaign' && v.start == null) return '活动需要开始时间';
    if (v.start != null && v.end != null && v.end <= v.start) return '结束时间要晚于开始时间';
    if (v.kind !== 'campaign' && v.campaign === null && ($('#ed-mode .is-active') || {}).dataset?.mode === 'campaign') return '请选择要跟随的活动';
    return '';
  }
  const EDIT_KEYS = ['image', 'title', 'subtitle', 'description', 'button1_text', 'button1_url', 'button2_text', 'button2_url', 'tag',
    'emoji', 'text', 'link', 'category', 'name', 'collections', 'tags', 'products', 'badge', 'countdown', 'priority',
    'bg', 'color', 'accent', 'effect', 'decoLeft', 'decoRight', 'start', 'end', 'campaign'];
  function diff(it, v) {
    const d = {};
    const norm = (x) => JSON.stringify(typeof x === 'string' ? x.trim() || null : x ?? null); // 空串 = 空,首尾空格不算改动
    EDIT_KEYS.forEach((k) => { if (k in v && norm(v[k]) !== norm(it[k])) d[k] = v[k]; });
    return d;
  }

  function openEditor(kind, id, preset) {
    hidePop();
    const isNew = !id; const it = id ? byId(id) : newItem(kind, preset);
    if (!it) return;
    // 编辑看到的是「自己待审核的修改」,没有就看线上版本
    const base = { ...it, ...(it.pendingChange && !isApprover() ? it.pendingChange : {}) };
    ed = { collections: [...(base.collections || [])], tags: [...(base.tags || [])], products: [...(base.products || [])] };
    const s = status(it);
    const approver = isApprover();
    const live = it.state === 'approved';
    let acts = '';
    if (approver) {
      if (!isNew && live && !it.isDefault) acts += `<button class="btn" data-act="pause" type="button">${it.paused ? '恢复显示' : s === 'live' ? '暂停(立即下线)' : '暂停'}</button>`;
      if (isNew || it.state !== 'approved') acts += '<button class="btn" data-act="draft" type="button">存草稿</button>';
      acts += `<button class="btn btn-primary" data-act="publish" type="button">${live ? '保存修改' : '保存并排期'}</button>`;
    } else {
      if (isNew || ['draft', 'new', 'rejected'].includes(it.state)) acts += '<button class="btn" data-act="draft" type="button">存草稿</button>';
      acts += `<button class="btn btn-primary" data-act="submit" type="button">${live ? '提交修改审核' : '提交审核'}</button>`;
    }
    const canDelete = !isNew && !it.isDefault && ['draft', 'rejected', 'ended'].includes(s);
    const notes = [];
    if (endingSoon(it)) notes.push(`<div class="note note--warn">⚠️ ${relDay(win(it).end)}(${fDT(win(it).end)})自动下架。要继续显示就把结束时间往后改${win(it).via ? '(它跟随活动,要改活动的结束时间)' : ''}。</div>`);
    if (it.pendingChange) notes.push(`<div class="note note--warn">${esc(who(it.pendingChange.by))} 提交了修改,正在等审核。${approver ? '去「审核」页批准后才会替换线上版本。' : '批准前线上保持原来的版本。'}</div>`);
    if (!approver && live && !it.pendingChange) notes.push('<div class="note">这条已经批准。你的修改会先提交审核,<b>批准前线上保持原来的版本</b>。</div>');
    if (it.state === 'rejected') notes.push(`<div class="note note--danger">被退回:${esc(it.rejectNote || '')}。修改后可以重新提交。</div>`);
    if (it.lastReject) notes.push(`<div class="note note--danger">上次的修改被退回:${esc(it.lastReject.note)}</div>`);
    if (it.note) notes.push(`<div class="note">${esc(it.note)}</div>`);

    $('#drawer').innerHTML = `
      <div class="drawer__h">
        <div>${kindChip(kind)} <b>${isNew ? `新建${KIND[kind]}` : esc(titleOf(it))}</b> ${isNew ? '' : badge(it)}</div>
        <button class="btn btn-ghost" data-act="close" type="button" aria-label="关闭">${I.x}</button>
      </div>
      <div class="drawer__b drawer__b--${kind}">
        <form class="drawer__form" id="ed-form" onsubmit="return false">${notes.join('')}${formHtml(base)}</form>
        <div class="drawer__pv" id="ed-pv">${previewHtml(base)}</div>
      </div>
      <div class="drawer__f">
        ${canDelete ? '<button class="btn btn-ghost btn-danger-t" data-act="delete" type="button">删除</button>' : '<span></span>'}
        <div class="drawer__acts">${acts}</div>
      </div>`;
    $('#drawer').hidden = false; $('#drawer-mask').hidden = false;
    document.body.classList.add('no-scroll');

    const refreshPv = () => {
      const v = readForm(base);
      $('#ed-pv').innerHTML = previewHtml(v);
      $$('#ed-form .clr').forEach((l) => { const i = l.querySelector('input'); l.querySelector('.mono').textContent = i.value; });
      clearInterval(pvTimer);
      if (v.kind === 'campaign' && v.countdown && v.end) {
        const tick = () => {
          const el = $('#pv-cd'); if (!el) return;
          let d = Math.max(0, Math.floor((v.end - now()) / 1000));
          const dd = Math.floor(d / 86400); d %= 86400; const hh = Math.floor(d / 3600); d %= 3600;
          el.textContent = `${dd}d ${hh}h ${Math.floor(d / 60)}m ${d % 60}s`;
        };
        tick(); pvTimer = setInterval(tick, 1000);
      }
    };
    refreshPv();
    const f = $('#ed-form');
    f.addEventListener('input', refreshPv);
    f.addEventListener('change', refreshPv);
    f.addEventListener('keydown', (e) => {
      if (e.target.id !== 'sc-tag' || e.key !== 'Enter') return;
      e.preventDefault();
      const t = e.target.value.trim();
      if (t && !ed.tags.includes(t)) { ed.tags.push(t); refreshScope(); $('#sc-tag').focus(); } else e.target.value = '';
    });
    f.addEventListener('click', (e) => {
      if (e.target.closest('a.lk')) return; // 后台 / 前台链接照常打开
      const m = e.target.closest('#ed-mode button');
      if (m) {
        $$('#ed-mode button').forEach((b) => b.classList.toggle('is-active', b === m));
        $$('#ed-form .tm').forEach((x) => { x.hidden = !x.classList.contains('tm--' + m.dataset.mode); });
        refreshPv(); return;
      }
      const seg = e.target.closest('#ed-tag button, #ed-effect button');
      if (seg) { $$(`#${seg.parentElement.id} button`).forEach((b) => b.classList.toggle('is-active', b === seg)); refreshPv(); return; }
      const im = e.target.closest('.imgpick__i');
      if (im) { f.querySelector('[name="image"]').value = im.dataset.img; $$('.imgpick__i').forEach((b) => b.classList.toggle('is-on', b === im)); refreshPv(); return; }
      const rmb = e.target.closest('[data-rm]');
      if (rmb) { const [k, i] = rmb.dataset.rm.split(':'); ed[k].splice(+i, 1); refreshScope(); return; }
      const pk = e.target.closest('[data-pick]');
      if (pk) pick(pk.dataset.pick);
    });

    $('#drawer').onclick = (e) => {
      if (e.target.closest('.picker') || e.target.closest('a.lk')) return;
      const nb = e.target.closest('[data-new]');
      if (nb && nb.dataset.for) { openEditor(nb.dataset.new, null, { campaign: nb.dataset.for }); return; }
      const op = e.target.closest('.attach__i[data-open]');
      if (op) { openEditor(byId(op.dataset.open).kind, op.dataset.open); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'close') return closeDrawer();
      if (act === 'pause') {
        it.paused = !it.paused; log(it.paused ? 'pause' : 'resume', it); save(); closeDrawer(); renderAll();
        return toast(it.paused ? '已暂停 · 前台立即不再显示' : '已恢复 · 按时间正常显示');
      }
      if (act === 'delete') {
        if (!a.dataset.sure) { a.dataset.sure = '1'; a.textContent = '再点一次确认删除'; a.classList.add('btn-danger'); return; }
        const L = listOf(it.kind); L.splice(L.indexOf(it), 1); log('delete', it); save(); closeDrawer(); renderAll(); return toast('已删除');
      }
      const v = readForm(base); const err = validate(v);
      if (err && act !== 'draft') return toast(err, false);
      const L = listOf(it.kind);
      if (act === 'draft') {
        Object.assign(it, v, { state: 'draft' }); if (isNew) L.push(it); log('draft', it); toast('已存草稿');
      } else if (act === 'submit') {
        if (live) {
          const d = diff(it, v); if (!Object.keys(d).length) return toast('没有改动', false);
          it.pendingChange = { ...d, by: S.me, at: now() }; log('submit', it, '提交修改,线上保持原版本直到批准');
        } else { Object.assign(it, v, { state: 'pending', by: S.me, submittedAt: now(), rejectNote: null }); if (isNew) L.push(it); log('submit', it); }
        toast('已提交审核 · 已在飞书 @审核人(演示)');
      } else if (act === 'publish') {
        const wasNew = isNew || it.state !== 'approved';
        Object.assign(it, v, { state: 'approved', pendingChange: null, rejectNote: null, lastReject: null });
        if (isNew) L.push(it);
        log(wasNew ? 'approve' : 'edit', it, wasNew ? '审核人自己排期(自动批准)' : '审核人直接修改');
        const st2 = status(it);
        toast(st2 === 'scheduled' ? `已排期 · ${fDT(win(it).start)} 自动上线` : st2 === 'live' ? '已上线' : `已保存 · ${ST[st2]}`);
      }
      save(); closeDrawer(); renderAll();
    };
  }
  function closeDrawer() {
    clearInterval(pvTimer); ed = null; hidePop();
    $('#drawer').hidden = true; $('#drawer-mask').hidden = true; $('#drawer').innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  // ================= 全局 =================
  function renderAll() {
    applySiteStyle(); hidePop();
    renderOverview(); renderBanners(); renderTopbar(); renderCampaigns(); renderReviews(); renderSettings();
    const n = pendingCount(); const b = $('#n-rv'); b.hidden = !n; b.textContent = n;
    $('#me-chip').innerHTML = `<button class="mechip" type="button" title="切换身份(演示)"><span class="avatar">${esc(me().name.slice(0, 1).toUpperCase())}</span>${esc(me().name)}<span class="muted">· ${isApprover() ? '审核人' : '编辑'}</span></button>`;
  }

  // 事件委托:任何地方的 data-open / data-new / data-go / 审核按钮
  document.addEventListener('click', (e) => {
    if (e.target.closest('#drawer')) return;
    const o = e.target.closest('[data-open]');
    if (o && o.closest('.section')) { const x = byId(o.dataset.open); if (x) openEditor(x.kind, x.id); return; }
    const n = e.target.closest('[data-new]');
    if (n && n.closest('.section')) { openEditor(n.dataset.new); return; }
    const g = e.target.closest('[data-go]');
    if (g) { showSection(g.dataset.go); return; }
    const ap = e.target.closest('[data-approve]'); if (ap) return approve(ap.dataset.approve);
    const rj = e.target.closest('[data-reject]'); if (rj) return askReject(rj);
    const rk = e.target.closest('[data-rjok]');
    if (rk) return reject(rk.dataset.rjok, rk.closest('.rjbox').querySelector('textarea').value.trim());
    if (e.target.closest('[data-rjcancel]')) return e.target.closest('.rjbox').remove();
    if (e.target.closest('.mechip')) showSection('settings');
  });
  // 悬停卡片
  document.addEventListener('mouseover', (e) => {
    const p = e.target.closest('[data-pop]');
    if (p && !e.target.closest('.is-drag')) showPop(e, p.dataset.pop); else hidePop();
  });
  document.addEventListener('mousemove', movePop);
  document.addEventListener('dragstart', hidePop);
  $('#drawer-mask').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });
  $('#demo-reset').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) {
      b.dataset.sure = '1'; b.dataset.label = b.textContent; b.textContent = '再点一次确认重置';
      setTimeout(() => { delete b.dataset.sure; b.textContent = b.dataset.label; }, 4000); return;
    }
    delete b.dataset.sure; b.textContent = b.dataset.label;
    ord.banner = null; ord.topbar = null;
    await load(true); closeDrawer(); renderAll(); toast('演示数据已重置');
  });

  load().then(renderAll).catch((e) => { $('#ov-root').innerHTML = `<p class="muted">演示数据加载失败:${esc(e.message)}</p>`; console.error(e); });
})();
