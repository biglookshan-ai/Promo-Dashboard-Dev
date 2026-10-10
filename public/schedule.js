// 排期系统前端 —— 目前是「演示模式」:数据来自 demo-seed.json(真实 Banner / 顶栏 / 合集 / 标签 + 示例活动),
// 操作只存浏览器 localStorage,不调用任何写接口。阶段 1b 接上真实数据后替换数据层即可,界面不变。
//
// 用到 app.js / registry.js 的全局:$ $$ esc toast showSection。整个文件包在 IIFE 里,
// 避免和 registry.js 的顶层 const(svg / ICONS …)重名。
(() => {
  const DEMO_KEY = 'cgp-schedule-demo-v4'; // 数据结构变了就升版本,旧的演示数据自动作废
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

  // ================= 数据 =================
  // 两种模式:
  //   demo —— 本地预览 / 店里还没建好内容类型时。数据来自 demo-seed.json,只存浏览器。
  //   live —— 在 Shopify 后台里打开且已建好内容类型。数据在服务器,动作走 /api/schedule/act,
  //           服务器按同一份规则(/lib/schedule-actions.js)检查权限并写进店铺。
  let MODE = 'demo';
  let core = null, A = null; // 共用规则模块,启动时加载
  let liveSetup = null; // 在后台里打开但还没建好时,记下连接状态
  const FORCE_DEMO = 'cgp-force-demo';
  const save = () => { if (MODE === 'demo') localStorage.setItem(DEMO_KEY, JSON.stringify(S)); };
  function materialize(seed) {
    // 种子里的日期:数字 = 相对今天的天数;'YYYY-MM-DD' = 固定日期(节日类)
    const md = (v) => (v == null ? null : typeof v === 'string' ? fromInput(v + 'T00:00') : dayStart(v));
    const conv = (it, kind) => ({
      ...it, kind, start: md(it.start), end: md(it.end), campaign: it.campaign || null, paused: false,
      submittedAt: it.state === 'pending' ? now() - 0.3 * DAY : null,
      pendingChange: it.pendingChange ? { ...it.pendingChange, at: now() + (it.pendingChange.at || 0) * DAY } : null,
    });
    return {
      ...seed, mode: 'demo',
      banners: seed.banners.map((b) => conv(b, 'banner')),
      topbar: seed.topbar.map((t) => conv(t, 'topbar')),
      tbstyles: seed.tbstyles.map((t) => conv(t, 'tbstyle')),
      pmodules: (seed.pmodules || []).map((m) => conv(m, 'pmodule')),
      campaigns: seed.campaigns.map((c) => conv(c, 'campaign')),
      pins: [], designs: [], materials: [],
      log: seed.log.map((l) => ({ ...l, at: now() + l.at * DAY })),
      pendingOrder: null,
    };
  }
  let seedCache = null;
  const getSeed = async () => (seedCache ||= await fetch('demo-seed.json', { cache: 'no-store' }).then((r) => r.json()));
  // 服务器给的数据补齐成页面要的样子(主题样式读不到时用演示里的默认值)
  async function normalizeLive(v) {
    const seed = v.site ? null : await getSeed();
    const tagCounts = {};
    v.campaigns.forEach((c) => {
      Object.assign(tagCounts, c.counts?.tags || {});
      Object.entries(c.counts?.collections || {}).forEach(([gid, x]) => { liveColCounts[gid] = x.count; });
    });
    return { ...v, site: v.site || seed.site, tagCounts, collections: v.collections || [], products: v.products || [], pins: v.pins || [], designs: v.designs || [], materials: v.materials || [] };
  }
  async function load(force) {
    if (MODE === 'live') { S = await normalizeLive(await api('GET', '/api/schedule/state')); return; }
    const raw = !force && localStorage.getItem(DEMO_KEY);
    if (raw) { S = JSON.parse(raw); S.pins ||= []; S.designs ||= []; S.materials ||= []; return; }
    S = materialize(await getSeed());
    save();
  }
  // 在后台里打开 → 问服务器;建好内容类型了就用正式数据
  async function detectMode() {
    if (!(window.shopify && window.shopify.idToken) && !window.CGP_ME) return 'demo'; // 飞书登录后直接开网页也算正式数据
    try {
      const v = await api('GET', '/api/schedule/state');
      liveSetup = v.setup;
      if (v.setup?.ready && localStorage.getItem(FORCE_DEMO) !== '1') { S = await normalizeLive(v); return 'live'; }
    } catch (e) { console.warn('[schedule] 连不上正式数据,用演示模式', e); }
    return 'demo';
  }

  // 所有改动都走这里:演示模式在本地跑规则,正式模式交给服务器
  async function act(action) {
    try {
      if (MODE === 'demo') {
        const r = A.applyAction(S, action, me(), now());
        ['banners', 'topbar', 'tbstyles', 'campaigns', 'pmodules', 'pins', 'designs', 'materials', 'pendingOrder', 'log'].forEach((k) => { S[k] = r.doc[k] ?? S[k]; });
        save(); renderAll();
        return r;
      }
      const v = await api('POST', '/api/schedule/act', { action });
      S = await normalizeLive(v); renderAll();
      if (v.syncErrors?.length) toast('已保存,但写进店铺时出错:' + v.syncErrors[0], false);
      else if (v.larkErrors?.length) toast('已保存,但飞书通知没发出去:' + v.larkErrors[0], false);
      return v;
    } catch (e) {
      toast(e.message || String(e), false);
      return null;
    }
  }

  const all = () => [...S.campaigns, ...S.banners, ...S.topbar, ...S.tbstyles, ...(S.pmodules || []), ...(S.pins || []), ...(S.designs || []), ...(S.materials || [])];
  const listOf = (k) => ({ banner: S.banners, topbar: S.topbar, tbstyle: S.tbstyles, campaign: S.campaigns, pmodule: (S.pmodules ||= []), pin: (S.pins ||= []), design: (S.designs ||= []), material: (S.materials ||= []) }[k]);
  const byId = (id) => all().find((x) => x.id === id);
  const camp = (id) => S.campaigns.find((c) => c.id === id);
  const me = () => S.staff.find((u) => u.id === S.me) || S.staff[0] || { id: '?', name: '我', role: 'editor' };
  const isApprover = () => me().role === 'approver';
  const who = (id) => (S.staff.find((u) => u.id === id) || {}).name || '同事';
  const KIND = { banner: 'Banner', topbar: '顶栏', tbstyle: '顶栏样式', campaign: '活动', pmodule: '商品模块', pin: '合集置顶', design: '设计需求', material: '宣传物料', price: '改价' };
  const titleOf = (it) => (it.kind === 'banner' ? (it.title || '未命名 Banner')
    : it.kind === 'topbar' ? `${it.emoji || ''} ${it.text || ''}`.trim() || '未命名公告' : it.name || '未命名');
  const rid = (p) => p + Math.random().toString(36).slice(2, 9);
  const byOrder = (a, b) => a.order - b.order;

  // ================= 状态(规则在 /lib/schedule-core.js,和服务器同一份) =================
  const win = (it) => core.effectiveWindow(it, core.campaignIndex(S.campaigns));
  const status = (it, t = now()) => core.itemStatus(it, core.campaignIndex(S.campaigns), t);
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
  // 正式数据:已批准但写进店铺失败 / 还没写进去的,标出来
  const syncTag = (x) => (MODE !== 'live' || x.state !== 'approved' ? ''
    : x.syncError ? `<span class="tag tag--danger" title="${esc(x.syncError)}">⚠️ 写进店铺失败</span>`
      : !x.shopifyId ? '<span class="tag tag--warn">还没写进店铺</span>' : '');
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
  // 产品数:演示 = 前台公开数据;正式 = 服务器用 Admin API 算的(存在活动的 counts 里,编辑时实时再算)
  const gidOf = (type, id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${id}`);
  const liveColCounts = {};
  const colCount = (c) => (MODE === 'live' ? liveColCounts[gidOf('Collection', c.id)] ?? c.count ?? null
    : (S.collections.find((x) => x.handle === c.handle) || c).count ?? null);
  const tagCount = (t) => S.tagCounts[t] ?? null;
  function scopeTotal(c) {
    // 正式数据:服务器算过「去重后的合计」且可信,就直接用
    if (MODE === 'live' && c.counts?.total != null && c.counts.totalReliable) return { total: c.counts.total, unknown: false, overlap: false, exact: true };
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
    if (x.kind === 'pmodule') { const c = pmColors(x); return `<span class="mthumb mthumb--sw" style="background:${esc(c.tabActiveBg)};color:${esc(c.tabActiveText)}" title="${(x.tabs || []).length} 个页签">${(x.tabs || []).length}</span>`; }
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
    } else if (x.kind === 'pmodule') {
      body = moduleHtml(x, { small: true }) + `<div class="pop__tabs">${(x.tabs || []).map((t) => `<div>· <b>${esc(tabLabel(t))}</b> <span class="muted">${tabSummary(t)}</span></div>`).join('')}</div>`
        + `<div class="muted">${MODULE_CN[x.module]}${x.isDefault ? ' · 平时版本' : ` · 优先级 ${x.priority ?? 0}`}</div>`;
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
  const ov = { zoom: 'month', offset: 0, kinds: { campaign: true, banner: true, topbar: true, tbstyle: true, pmodule: true }, onlyActive: true };
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
    const gantt = group('campaign', '促销活动', S.campaigns) + group('banner', 'Banner', S.banners) + group('topbar', '顶栏公告', S.topbar) + group('tbstyle', '顶栏样式(节日主题)', S.tbstyles) + group('pmodule', '首页商品模块', S.pmodules || []);
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
      ${alertsHtml(['banner', 'topbar', 'campaign', 'tbstyle', 'pmodule'])}
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
            ${kchip('campaign', '促销活动', S.campaigns)}${kchip('banner', 'Banner', S.banners)}${kchip('topbar', '顶栏', S.topbar)}${kchip('tbstyle', '顶栏样式', S.tbstyles)}${kchip('pmodule', '商品模块', S.pmodules || [])}
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
  async function saveOrder(kind) {
    const ids = ord[kind]; ord[kind] = null;
    const r = await act({ type: 'order', kind, ids });
    if (r?.message) toast(r.message); else renderAll();
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
        ${endingTag(b)}${syncTag(b)}
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
            ${endingTag(t)}${syncTag(t)}${t.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}${badge(t)}
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
  // ================= 活动总控台 =================
  // 一个活动下面的全部工作:网站内容 / 改价 / 设计需求 / 宣传物料,准备进度一眼看清,每类都能直接新建(自动挂在这个活动下)
  let cpHub = null; // 正在看的活动 id
  let hubPrice = { plans: null, err: '', at: 0 };
  async function loadHubPrice() {
    if (MODE !== 'live' || !(window.cgpCanSee && window.cgpCanSee('price'))) { hubPrice = { plans: null, err: '', at: now() }; return; }
    try { hubPrice = { plans: (await api('GET', '/api/price/state')).plans, err: '', at: now() }; }
    catch (e) { hubPrice = { plans: null, err: e.message, at: now() }; }
    if (cpHub) renderCampaigns();
  }
  const PLAN_ST = { draft: '草稿', pending: '待审核', rejected: '被退回', scheduled: '已排期', running: '进行中', paused: '暂停中', ended: '已结束', done: '已完成' };
  function hubRow(x) {
    const ws = workState(x);
    const sub = x.kind === 'design' ? `${x.assignee ? '设计师 ' + esc(x.assignee) + ' · ' : ''}${x.due ? `截止 ${fDate(x.due)}` : '没设截止'}${overdue(x) ? ' · <b class="tx-danger">已逾期</b>' : ''}`
      : x.kind === 'material' ? `${CHANNEL[x.channel] || ''}${x.channel === 'social' && x.platform ? ' · ' + esc(x.platform) : ''} · ${x.publishAt ? fDT(x.publishAt) + ' 发布' : '没设发布时间'}${x.owner ? ' · ' + esc(who(x.owner)) : ''}`
        : esc(winText(x));
    const pic = x.kind === 'banner' ? `<span class="hrow__slide">${slideHtml(x, { w: 160 })}</span>`
      : x.kind === 'design' && (x.chosen || x.deliverables?.[0]) ? `<span class="hrow__img" style="background-image:url('${esc(thumb(x.chosen || x.deliverables[0].url, 160))}')"></span>`
        : x.kind === 'material' && x.assets?.[0] ? `<span class="hrow__img" style="background-image:url('${esc(thumb(x.assets[0].url, 160))}')"></span>` : `<span class="hrow__ico">${kindChip(x.kind)}</span>`;
    const chipInPic = pic.includes('hrow__ico');
    return `<button class="hrow" type="button" data-open="${x.id}">${pic}<span class="hrow__b"><span class="hrow__t">${chipInPic ? '' : kindChip(x.kind) + ' '}${esc(titleOf(x))}</span><span class="hrow__s">${sub}</span></span>${ws ? workBadge(x) : badge(x)}</button>`;
  }
  // ---- 一致性检查(活动总控台)----
  // 文案里说的折扣 vs 实际改价、各项时间 vs 活动时间、设计截止 vs Banner 上线、物料发布时间、快开始了还没批准
  const pctClaims = (text) => {
    const t = String(text || '');
    const out = [];
    for (const m of t.matchAll(/up\s*to\s*(\d{1,2})\s*%/gi)) out.push({ pct: +m[1], upTo: true });
    for (const m of t.matchAll(/(\d{1,2})\s*%\s*off/gi)) if (!out.some((x) => x.pct === +m[1])) out.push({ pct: +m[1], upTo: false });
    for (const m of t.matchAll(/(\d)(?:\.\d)?\s*折/g)) out.push({ pct: 100 - +m[1] * 10, upTo: false, zh: true });
    return out;
  };
  const textsOf = (x) => (x.kind === 'banner' ? [x.title, x.subtitle, x.description] : x.kind === 'topbar' ? [x.text]
    : x.kind === 'pmodule' ? [x.title, x.title2] : x.kind === 'material' ? [x.subject, x.copy] : []).join(' ');
  const HOUR = 3600000;
  function consistencyChecks(c, plans) {
    const out = [];
    const mine = (k) => listOf(k).filter((x) => x.campaign === c.id);
    const content = [...mine('banner'), ...mine('topbar'), ...mine('pmodule'), ...mine('pin')];
    const mats = mine('material'), designs = mine('design');
    // 1. 文案里的折扣
    const livePlans = (plans || []).filter((p) => ['approved', 'pending'].includes(p.state) && !p.stopped);
    const maxOff = livePlans.reduce((m, p) => Math.max(m, ...p.slots.flatMap((s) => s.items.filter((i) => i.price != null).map((i) => Math.round((1 - Number(i.price) / Number(i.refPrice)) * 100)))), 0);
    for (const x of plans === undefined ? [] : [...content, ...mats]) { // undefined = 改价数据还在加载
      for (const cl of pctClaims(textsOf(x))) {
        const name = `${KIND[x.kind]}「${titleOf(x)}」`;
        if (plans == null) { out.push({ level: 'info', id: x.id, text: `${name}写了 ${cl.pct}%${cl.upTo ? '(up to)' : ' off'},你没有改价页权限,没法核对实际折扣` }); continue; }
        if (!livePlans.length) { out.push({ level: 'warn', id: x.id, text: `${name}写了 ${cl.pct}%${cl.upTo ? '(up to)' : ' off'},但这个活动还没有改价计划` }); continue; }
        if (maxOff < cl.pct - 1) out.push({ level: 'warn', id: x.id, text: `${name}写${cl.upTo ? ' up to' : ''} ${cl.pct}%,但本活动改价最多只降 ${maxOff}%` });
        else if (cl.upTo && maxOff > cl.pct + 5) out.push({ level: 'info', id: x.id, text: `${name}写 up to ${cl.pct}%,实际最多降 ${maxOff}%,文案可以写得更吸引人` });
      }
    }
    // 2. 时间对不上
    const cs = c.start, ce = c.end;
    for (const x of content) {
      if (x.start == null && x.end == null) continue; // 跟随活动时间
      const name = `${KIND[x.kind]}「${titleOf(x)}」`;
      if (cs != null && x.start != null && x.start < cs - HOUR) out.push({ level: 'warn', id: x.id, text: `${name}比活动早 ${relSpan(cs - x.start)}上线(${fDT(x.start)})` });
      if (ce != null && (x.end == null || x.end > ce + HOUR)) out.push({ level: 'warn', id: x.id, text: `${name}${x.end == null ? '没设结束时间,活动结束后还会一直显示' : `比活动晚 ${relSpan(x.end - ce)}下线(${fDT(x.end)})`}` });
    }
    for (const p of livePlans) {
      if (p.kind !== 'window') continue;
      const ps = Math.min(...p.slots.map((s) => s.start)), pe = Math.max(...p.slots.map((s) => s.end));
      if (cs != null && Math.abs(ps - cs) > HOUR) out.push({ level: 'warn', price: p.id, text: `改价「${p.name}」${ps < cs ? '比活动早' : '比活动晚'} ${relSpan(Math.abs(ps - cs))}开始:${ps < cs ? '价格先降了,网站内容还没上' : '网站内容上了,价格还没降'}` });
      if (ce != null && Math.abs(pe - ce) > HOUR) out.push({ level: 'warn', price: p.id, text: `改价「${p.name}」${pe > ce ? '比活动晚' : '比活动早'} ${relSpan(Math.abs(pe - ce))}结束` });
    }
    // 3. 设计截止 vs Banner 上线
    for (const d of designs) {
      const b = d.target && byId(d.target); if (!b || !d.due || d.state === 'approved') continue;
      const bs = win(b).start;
      if (bs != null && d.due > bs) out.push({ level: 'warn', id: d.id, text: `设计「${titleOf(d)}」截止(${fDate(d.due)})比要用它的 Banner 上线(${fDT(bs)})还晚` });
    }
    // 4. 物料发布时间
    for (const m of mats) {
      if (!m.publishAt || m.publishedAt) continue;
      if (ce != null && m.publishAt > ce) out.push({ level: 'warn', id: m.id, text: `${CHANNEL[m.channel]}「${titleOf(m)}」计划在活动结束后才发(${fDT(m.publishAt)})` });
      if (cs != null && m.publishAt < cs - 7 * DAY) out.push({ level: 'info', id: m.id, text: `${CHANNEL[m.channel]}「${titleOf(m)}」比活动早一周以上发(${fDT(m.publishAt)}),确认是预热吗` });
    }
    // 5. 快开始了还没批准
    if (cs != null && cs > now() && cs - now() < 2 * DAY) {
      const notYet = [...content, ...mats].filter((x) => x.state !== 'approved').length + designs.filter((d) => d.state !== 'approved').length + livePlans.filter((p) => p.state !== 'approved').length;
      if (notYet) out.push({ level: 'warn', text: `活动 ${relSpan(cs - now())}后开始,还有 ${notYet} 项没批准 / 没完成` });
    }
    return out;
  }
  const relSpan = (ms) => (ms >= DAY ? `${Math.round(ms / DAY)} 天` : `${Math.max(1, Math.round(ms / HOUR))} 小时`);
  function checksHtml(c, plans) {
    const list = consistencyChecks(c, plans);
    return `<section class="panel hubsec"><div class="panel__h"><h3>一致性检查</h3><span class="muted">文案折扣 vs 实际改价、各项时间 vs 活动时间、设计和物料的时间</span></div>
      ${list.length ? `<div class="hchecks">${list.map((x) => `<div class="hcheck hcheck--${x.level}">${x.level === 'warn' ? '⚠️' : 'ℹ️'} <span>${esc(x.text)}</span>${x.id ? `<button type="button" class="linkbtn" data-open="${x.id}">去改</button>` : x.price ? `<button type="button" class="linkbtn" data-price="${x.price}">去改</button>` : ''}</div>`).join('')}</div>`
        : '<p class="muted">✓ 没发现对不上的地方</p>'}</section>`;
  }
  function hubHtml(c) {
    const mine = (k) => listOf(k).filter((x) => x.campaign === c.id);
    const content = [...mine('banner'), ...mine('topbar'), ...mine('tbstyle'), ...mine('pmodule'), ...mine('pin')];
    const designs = mine('design'), mats = mine('material');
    const canPrice = MODE === 'live' && window.cgpCanSee && window.cgpCanSee('price');
    const plans = (hubPrice.plans || []).filter((p) => p.campaign?.id === c.id);
    const work = [...content, ...designs, ...mats];
    const isDone = (x) => (workState(x) ? workState(x)[0] === 'done' || (x.kind === 'material' && x.state === 'approved') : x.state === 'approved');
    const done = work.filter(isDone).length + plans.filter((p) => p.state === 'approved').length;
    const total = work.length + plans.length;
    const waiting = work.filter((x) => x.state === 'pending' || x.pendingChange).length + plans.filter((p) => p.state === 'pending' || p.pendingChange).length;
    const late = designs.filter(overdue).length + mats.filter((m) => workState(m)[0] === 'late').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const add = (kind, label, extra = '') => `<button type="button" class="btn btn-sm" data-new="${kind}" data-for="${c.id}" ${extra}>${I.plus}${label}</button>`;
    const sec = (title, sub, rows, adds, emptyMsg) => `<section class="panel hubsec"><div class="panel__h"><h3>${title}</h3><span class="muted">${sub}</span></div>
      <div class="hrows">${rows || `<p class="muted">${emptyMsg}</p>`}</div><div class="hubsec__add">${adds}</div></section>`;
    const priceRows = plans.map((p) => `<button class="hrow" type="button" data-price="${p.id}"><span class="hrow__ico">${kindChip('price')}</span><span class="hrow__b"><span class="hrow__t">${esc(p.name)}</span>
      <span class="hrow__s">${p.kind === 'permanent' ? '永久调价' : '限时'} · ${p.slots.length} 个时段 · ${new Set(p.slots.flatMap((s) => s.items.map((i) => i.productId))).size} 个产品</span></span><span class="tag">${PLAN_ST[p.state === 'approved' ? 'scheduled' : p.state] || p.state}</span></button>`).join('');
    return `
      <button class="btn btn-ghost btn-back" type="button" data-hubback>← 全部活动</button>
      <div class="hubhead">
        <div><h2>${esc(c.name)} ${badge(c)}</h2><div class="muted">${I.clock}${esc(winText(c))} · 产品:${campScope(c, true)}</div></div>
        <button class="btn" type="button" data-open="${c.id}">编辑活动设置</button>
      </div>
      <div class="hubprog">
        <div class="hubprog__bar"><span style="width:${pct}%"></span></div>
        <div class="hubprog__n"><b>${done}</b> / ${total} 项已就绪(${pct}%)${waiting ? ` · <span class="tx-warn">${waiting} 项等审批</span>` : ''}${late ? ` · <span class="tx-danger">${late} 项逾期 / 该发了</span>` : ''}</div>
      </div>
      ${checksHtml(c, canPrice ? (hubPrice.plans || undefined) : null)}
      ${sec('网站内容', '到点自动上线、结束自动下线', content.map(hubRow).join(''),
        add('banner', 'Banner') + add('topbar', '顶栏公告') + add('tbstyle', '顶栏样式') + add('pmodule', '首页促销模块版本')
          + (MODE === 'live' && S.setup && S.setup.pinReady === false ? '<button type="button" class="btn btn-sm" data-go="settings" title="先到「设置 → 店铺连接」点「在店里创建内容类型」补建">合集置顶清单(要先补建内容类型)</button>' : add('pin', '合集置顶清单')), '还没有内容')}
      ${sec('改价', canPrice ? '定价同事负责;到点自动改、到期自动恢复' : '改价信息保密,只有定价同事和管理员能看', canPrice ? priceRows : '',
        canPrice ? `<button type="button" class="btn btn-sm" data-pricenew="${c.id}">${I.plus}改价计划</button>` : '', canPrice ? (hubPrice.err ? esc(hubPrice.err) : hubPrice.plans ? '还没有改价计划' : '加载中…') : '你没有改价页的权限')}
      ${sec('设计需求', '写清需求 → 设计交稿 → 审批 → 一键套用到 Banner', designs.map(hubRow).join(''), add('design', '设计需求'), '还没有设计需求')}
      ${sec('宣传物料', 'app 不替你发,到时间提醒负责人;发完回填链接', mats.map(hubRow).join(''), add('material', '邮件', 'data-channel="email"') + add('material', '社媒帖子', 'data-channel="social"'), '还没有物料')}`;
  }

  function renderCampaigns() {
    const hubC = cpHub && camp(cpHub);
    if (hubC) { $('#cp-root').innerHTML = hubHtml(hubC); if (!hubPrice.at || now() - hubPrice.at > 30000) loadHubPrice(); return; }
    cpHub = null;
    const rows = S.campaigns.filter((c) => inTab(c, cpF.st)).sort((a, b) => RANK[status(a)] - RANK[status(b)] || (a.start ?? 0) - (b.start ?? 0));
    const card = (c) => {
      const bn = S.banners.filter((b) => b.campaign === c.id), tb = S.topbar.filter((t) => t.campaign === c.id), sty = S.tbstyles.filter((t) => t.campaign === c.id);
      const st = scopeTotal(c);
      const zero = [...(c.collections || []).filter((x) => colCount(x) === 0).map((x) => x.title), ...(c.tags || []).filter((t) => tagCount(t) === 0)];
      return `<button class="ccard ${status(c) === 'ended' ? 'is-dim' : ''}" data-hub="${c.id}" type="button">
        <span class="ccard__top"><b>${esc(c.name)}</b>${badge(c)}</span>
        <span class="ccard__when">${I.clock}${winText(c)}</span>
        ${endingTag(c)}${syncTag(c)}
        <span class="ccard__row"><span class="muted">产品</span><span class="ccard__v ccard__v--col">${campScope(c, false, '<br>')}<br><span class="muted">合计${st.exact ? '' : '约'} <b>${st.total}${st.unknown ? '+' : ''}</b> 个${st.exact ? '(已去重)' : st.overlap ? '(可能有重叠)' : ''}</span></span></span>
        ${zero.length ? `<span class="tag tag--danger">⚠️ ${esc(zero.join('、'))} 里没有产品</span>` : ''}
        <span class="ccard__row"><span class="muted">产品页</span><span class="ccard__v">${c.badge ? `<span class="pbadge">${esc(c.badge)}</span>` : '<span class="muted">无徽章</span>'}${c.countdown ? '<span class="tag">倒计时</span>' : ''}</span></span>
        <span class="ccard__row"><span class="muted">包含</span><span class="ccard__v">${bn.length} 张 Banner · ${tb.length} 条顶栏${sty.length ? ` · ${sty.length} 个顶栏样式` : ''}${(S.designs || []).some((d) => d.campaign === c.id) ? ` · ${(S.designs || []).filter((d) => d.campaign === c.id).length} 个设计需求` : ''}${(S.materials || []).some((m) => m.campaign === c.id) ? ` · ${(S.materials || []).filter((m) => m.campaign === c.id).length} 个物料` : ''}</span></span>
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
      <div class="cgrid">${rows.map(card).join('') || empty('没有这个状态的活动')}</div>
      <section class="panel lookup">
        <div class="panel__h"><h3>查一个产品在哪些活动里</h3><span class="muted">Shopify 的产品页上看不到这个,在这里查</span></div>
        <div class="rowin"><input class="inp" id="lk-q" placeholder="粘贴产品链接、handle 或 id,比如 https://www.cinegearpro.co.uk/products/…"/><button class="btn btn-sm btn-primary" id="lk-go" type="button">查</button></div>
        <div id="lk-out"></div>
      </section>`;
    $$('#cp-root .ftab').forEach((b) => b.addEventListener('click', () => { cpF.st = b.dataset.st; renderCampaigns(); }));
    const go = async () => {
      const q = $('#lk-q').value.trim(); const out = $('#lk-out'); if (!q) return;
      if (MODE !== 'live') { out.innerHTML = '<p class="muted">演示模式查不了(要读产品的合集和标签)。切到正式数据后,这里会列出这个产品参加的活动,以及是因为哪个合集 / 标签 / 单独指定参加的。</p>'; return; }
      out.innerHTML = '<p class="muted">查询中…</p>';
      try {
        const r = await api('GET', `/api/schedule/product?q=${encodeURIComponent(q)}`);
        const p = r.product;
        out.innerHTML = `<div class="lk">
          ${p.image ? `<img class="lk__img" src="${esc(p.image)}" alt="">` : ''}
          <div class="lk__b"><b>${esc(p.title)}</b> ${linkPair('products', p)}
            <div class="muted">在 ${p.collections.length} 个合集里 · ${p.tags.length} 个标签</div>
            ${r.campaigns.length ? r.campaigns.map((c) => { const x = byId(c.id); return `<div class="lk__c">${x ? badge(x) : ''}<button class="linkbtn" data-open="${c.id}" type="button">${esc(c.name)}</button><span class="muted">${esc(c.why.join(' · '))}</span></div>`; }).join('')
              : '<p class="muted">不在任何已批准的活动里。</p>'}
          </div></div>`;
      } catch (e) { out.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    };
    $('#lk-go').addEventListener('click', go);
    $('#lk-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  // ================= 首页商品模块 =================
  // 每个模块(促销 / 推荐)有一个「平时版本」+ 若干排期版本;同一时间生效的里面优先级高的赢,整套替换(标题 + 页签)。
  const MODULE_CN = { sale: '促销模块', feature: '推荐 / 新品模块' };
  const PM_FALLBACK = {
    sale: { titleColor: '#525258', title2Color: '#ee8849', tabActiveBg: '#ee8849', tabActiveText: '#f9f9f9' },
    feature: { titleColor: '#525258', title2Color: '#da5959', tabActiveBg: '#fcc900', tabActiveText: '#1b1c1d' },
  };
  const pmList = (mod) => (S.pmodules || []).filter((m) => m.module === mod);
  function activeVersion(mod, t = now()) {
    const list = pmList(mod);
    const on = list.filter((m) => !m.isDefault && status(m, t) === 'live')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (win(b).start ?? 0) - (win(a).start ?? 0));
    return on[0] || list.find((m) => m.isDefault && status(m, t) === 'live') || null;
  }
  const pmColors = (v) => ({ ...PM_FALLBACK[v.module || 'sale'], ...Object.fromEntries(['titleColor', 'title2Color', 'tabActiveBg', 'tabActiveText'].filter((k) => v[k]).map((k) => [k, v[k]])) });
  const tabLabel = (t) => t.title || t.collection?.title || (t.source === 'products' ? '手选产品' : '未命名页签');
  const tabSummary = (t) => `${t.source === 'products' ? `手选 ${(t.products || []).length} 个产品` : `合集 ${t.collection ? esc(t.collection.title) : '(未选)'}`}${t.onlyDiscounted ? ' · 只看打折' : ''}${t.newestFirst ? ' · 最新在前' : ''} · ${Number(t.limit) ? `最多 ${t.limit} 个` : '不限数量'}`;
  // 首页上的样子:标题两段 + 页签 + 产品卡(正式数据里取真实产品,演示时是占位)
  const pmPreviewCache = {};
  const tabKey = (t) => JSON.stringify([t.source, t.collection?.id, (t.products || []).map((p) => p.id), t.onlyDiscounted, t.sortByDiscount, t.newestFirst, t.limit]);
  function moduleHtml(v, { activeTab = 0, small = false } = {}) {
    const c = pmColors(v); const tabs = v.tabs || []; const t = tabs[activeTab] || tabs[0];
    const cached = t && pmPreviewCache[tabKey(t)];
    const cards = cached?.items?.length ? cached.items.slice(0, 5).map((p) => `<span class="pmv__card">
        <span class="pmv__img" style="background-image:url('${esc(thumb(p.image, 300))}')">${p.off ? `<span class="pmv__off">${p.off}% OFF</span>` : ''}</span>
        <span class="pmv__t">${esc(p.title)}</span>
        <span class="pmv__p">${p.compareAt ? `<s>£${Number(p.compareAt).toFixed(2)}</s>` : ''}<b>£${Number(p.price).toFixed(2)}</b></span></span>`).join('')
      : Array.from({ length: 5 }, () => '<span class="pmv__card pmv__card--ph"><span class="pmv__img"></span><span class="pmv__t"></span></span>').join('');
    return `<div class="pmv ${small ? 'pmv--sm' : ''}">
      <div class="pmv__h">${v.title ? `<span style="color:${esc(c.titleColor)}">${esc(v.title)}</span>` : ''}${v.title2 ? `<span style="color:${esc(c.title2Color)}">${esc(v.title2)}</span>` : ''}${!v.title && !v.title2 ? '<span class="muted">(没有标题)</span>' : ''}</div>
      <div class="pmv__tabs">${tabs.map((x, i) => `<span class="pmv__tab" data-pmtab="${i}" style="${i === activeTab ? `background:${esc(c.tabActiveBg)};color:${esc(c.tabActiveText)}` : ''}">${esc(tabLabel(x))}</span>`).join('')}</div>
      ${small ? '' : `<div class="pmv__grid">${cards}</div>
      <div class="pmv__foot">${t ? `${tabSummary(t)}${cached ? ` · 现在符合条件的有 ${cached.shown}${cached.approx ? '+' : ''} 个` : MODE === 'live' ? ' · 正在取产品…' : ' · 演示数据只画占位,正式数据里显示真实产品'}` : ''}</div>`}
    </div>`;
  }
  // 正式数据:取某个页签的前几个产品(只给后台预览用)
  async function loadTabPreview(t, after) {
    if (MODE !== 'live' || !t || pmPreviewCache[tabKey(t)]) return;
    if (t.source === 'products' ? !(t.products || []).length : !t.collection) return;
    try { pmPreviewCache[tabKey(t)] = await api('POST', '/api/schedule/tab-products', t); after && after(); }
    catch (e) { pmPreviewCache[tabKey(t)] = { items: [], shown: 0, error: e.message }; }
  }

  const pmActiveTab = {};
  function renderPmodules() {
    const root = $('#pm-root'); if (!root) return;
    const needSetup = MODE === 'live' && S.setup && S.setup.pmReady === false;
    const panel = (mod) => {
      const list = pmList(mod).sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || RANK[status(a)] - RANK[status(b)] || (win(a).start ?? 0) - (win(b).start ?? 0));
      const cur = activeVersion(mod);
      const at = pmActiveTab[mod] || 0;
      return `<section class="panel pm">
        <div class="panel__h"><h3>${MODULE_CN[mod]}</h3>
          <span class="muted">${cur ? `现在显示:<b>${esc(cur.name)}</b>${cur.isDefault ? '(平时版本)' : ''}` : '现在显示:主题编辑器里的设置(还没导入平时版本)'}
          <button class="btn btn-sm btn-primary" data-new="pmodule" data-module="${mod}" type="button" ${needSetup ? 'disabled' : ''}>${I.plus}新建版本</button></span></div>
        ${cur ? `<div class="pm__now" data-pmnow="${mod}">${moduleHtml(cur, { activeTab: at })}</div>` : ''}
        <div class="pm__list">${list.map((m) => `<button class="pmrow ${status(m) === 'ended' ? 'is-dim' : ''}" data-open="${m.id}" data-pop="${m.id}" type="button">
          ${miniThumb(m)}
          <span class="pmrow__b"><b>${esc(m.name || '未命名版本')}</b>${m.isDefault ? '<span class="tag">平时版本</span>' : ''}${cur === m ? '<span class="tag tag--ok">正在显示</span>' : ''}
            <span class="pmrow__w">${m.isDefault ? '没有别的版本生效时显示' : `${I.clock}${winText(m)}`}</span>
            <span class="pmrow__tabs">${(m.tabs || []).map((t) => `<span class="chip chip--sm">${esc(tabLabel(t))}</span>`).join('')}</span></span>
          ${endingTag(m)}${syncTag(m)}${m.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}${badge(m)}
        </button>`).join('') || empty('还没有版本。先在「设置 → 店铺连接」点「从主题导入」把现在的配置导进来当平时版本。')}</div>
      </section>`;
    };
    root.innerHTML = `
      ${pageHead('首页商品模块', '首页的促销模块和推荐 / 新品模块。每个模块有一个「平时版本」,到时间整套换成别的版本(标题 + 页签),结束自动回到平时版本;同一时间有多个版本时,优先级高的生效。')}
      ${needSetup ? '<div class="note note--warn">店里还缺这个功能用的 2 个内容类型。到「设置 → 店铺连接」点「在店里创建内容类型」补上,再点「从主题导入」把两个模块现在的配置导进来当平时版本。</div>' : ''}
      ${alertsHtml(['pmodule'])}
      ${panel('sale')}${panel('feature')}`;
    // 页签切换(只换预览)+ 取真实产品
    $$('#pm-root [data-pmnow]').forEach((box) => {
      const mod = box.dataset.pmnow; const cur = activeVersion(mod);
      box.addEventListener('click', (e) => { const t = e.target.closest('[data-pmtab]'); if (!t) return; pmActiveTab[mod] = +t.dataset.pmtab; renderPmodules(); });
      loadTabPreview((cur.tabs || [])[pmActiveTab[mod] || 0], renderPmodules);
    });
  }

  // ================= 审核 =================
  const FIELD = {
    title: '标题', subtitle: '副标题', description: '描述', image: '图片', tag: '角标', button1_text: '按钮 1 文字', button1_url: '按钮 1 链接',
    button2_text: '按钮 2 文字', button2_url: '按钮 2 链接', emoji: 'Emoji', text: '文字', link: '链接', category: '分类',
    name: '名称', collections: '合集', tags: '标签', products: '指定产品', badge: '徽章文字', countdown: '倒计时', priority: '优先级',
    bg: '底色', color: '文字颜色', accent: '点缀色', effect: '特效', decoLeft: '左侧装饰', decoRight: '右侧装饰',
    module: '模块', title2: '标题第二段', titleColor: '第一段颜色', title2Color: '第二段颜色', tabActiveBg: '页签高亮底色', tabActiveText: '页签高亮文字', tabs: '页签', isDefault: '平时版本',
    start: '开始', end: '结束', campaign: '所属活动',
  };
  const showVal = (k, v) => {
    if (v == null || v === '') return '<span class="muted">(空)</span>';
    if (k === 'start' || k === 'end') return esc(fDT(v));
    if (k === 'campaign') return esc((camp(v) || {}).name || v);
    if (k === 'countdown') return v ? '开' : '关';
    if (k === 'tag') return esc(TAGCN[v] || v);
    if (k === 'effect') return esc(EFFECT[v] || v);
    if (k === 'module') return esc(MODULE_CN[v] || v);
    if (k === 'tabs') return (v || []).map((t, i) => `<div>${i + 1}. <b>${esc(tabLabel(t))}</b> <span class="muted">${tabSummary(t)}</span></div>`).join('') || '<span class="muted">(空)</span>';
    if (['bg', 'color', 'accent', 'titleColor', 'title2Color', 'tabActiveBg', 'tabActiveText'].includes(k)) return `<span class="swatch" style="background:${esc(v)}"></span> <span class="mono">${esc(v)}</span>`;
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
          : it.kind === 'pmodule' ? `<span class="rv__bar">${moduleHtml(it, { small: true })}</span>`
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
  async function approve(id) {
    const r = await act({ type: 'approve', id });
    if (!r) return;
    if (id === '__order') return toast(r.message);
    const it = byId(id); const s = it ? status(it) : '';
    toast(s === 'scheduled' ? `已批准 · 将在 ${fDT(win(it).start)} 自动上线` : s === 'live' ? '已批准 · 已上线' : `已批准${s ? ' · ' + ST[s] : ''}`);
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
  async function reject(id, note) {
    const r = await act({ type: 'reject', id, note });
    if (r) toast(MODE === 'live' ? '已退回 · 已通知提交人' : '已退回 · 已在飞书通知提交人(演示)');
  }

  // ================= 设置 =================
  const ACT = { up: '上线', down: '下线', approve: '批准', reject: '退回', submit: '提交审核', draft: '存草稿', reorder: '调整顺序', pause: '暂停', resume: '恢复', delete: '删除', edit: '修改' };
  const logRow = (l) => `<div class="logrow"><span class="logrow__t">${fDT(l.at)}</span><span class="lact lact--${l.action}">${ACT[l.action] || l.action}</span>${kindChip(l.kind)}<span class="logrow__x">${esc(l.title)}</span><span class="muted">${esc(l.note || '')}${l.by ? ' · ' + esc(l.by) : ''}</span></div>`;
  // ---- v3 飞书登录:我 / 成员与角色(管理员)/ 角色能看的页面 ----
  let MEM = null; // { members, roles, pages }(管理员才有)
  function larkPanelsHtml() {
    const me = window.CGP_ME || {};
    const roleName = (k) => (me.roles || []).find((r) => r.key === k)?.name || k;
    const mine = `<section class="panel"><div class="panel__h"><h3>我</h3><span class="tag tag--ok">飞书登录</span></div>
      <div class="mrow">${me.member?.avatar ? `<img class="avatar-img" src="${esc(me.member.avatar)}" alt=""/>` : ''}<b>${esc(me.member?.name || '')}</b>
        <span class="muted">${(me.member?.roles || []).map(roleName).join('、') || '—'}</span>
        <button class="btn btn-sm btn-ghost" id="st-logout" type="button" style="margin-left:auto">退出登录</button></div>
      <p class="muted">名字和头像来自飞书。能看哪些页面由管理员分配的角色决定。</p>
      ${me.admin ? `<p class="muted">你的飞书 ID:<code>${esc(me.member?.id || '')}</code>。${me.adminPinned
        ? '<span class="tag tag--ok">已锁定</span> Railway 里设了管理员名单(LARK_ADMIN_IDS),只有名单里的人能自动成为管理员。'
        : '建议把它填进 Railway 变量 <code>LARK_ADMIN_IDS</code>(多个用逗号隔开):以后只有名单里的人能成为管理员,就算数据丢失也不会被别人抢先;你被误停用时重新登录也能找回管理员。'}</p>` : ''}</section>`;
    if (!me.admin) return `<div class="stgrid">${mine}</div>`;
    return `<div class="stgrid">${mine}
      <section class="panel"><div class="panel__h"><h3>怎么加同事</h3></div>
        <p class="muted">让同事在 Shopify 后台打开这个 app(或直接打开 app 网址)用飞书登录一次,他就会出现在下面「待分配」里;给他勾上角色就能用了。
        飞书应用的「可用范围」里也要有他,否则飞书不让他授权。</p></section></div>
      <section class="panel"><div class="panel__h"><h3>成员</h3><span class="muted">管理员能看全部页面、管成员;其他角色只看勾选的页面</span></div><div id="st-members"><p class="muted">加载中…</p></div></section>
      <section class="panel"><div class="panel__h"><h3>角色能看的页面</h3><span class="muted">设置、工具只有管理员能看</span></div><div id="st-roles"><p class="muted">加载中…</p></div></section>`;
  }
  async function bindLarkPanels() {
    $('#st-logout')?.addEventListener('click', () => window.cgpLogout());
    if (!window.CGP_ME?.admin) return;
    try { MEM = await api('GET', '/api/members'); } catch (e) { $('#st-members').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    drawMembers(); drawRoles();
  }
  const ST_CN = { pending: '待分配', active: '启用', disabled: '停用' };
  function drawMembers() {
    const el = $('#st-members'); if (!el || !MEM) return;
    const list = [...MEM.members].sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
    // 每个人实际能看哪些页面(按他的角色算出来,和服务器的规则一致)
    const canSeeOf = (m) => {
      if (m.status === 'pending') return '<span class="tag tag--warn">待分配:什么都看不到</span>';
      if (m.status === 'disabled') return '<span class="tag">已停用:什么都看不到</span>';
      if ((m.roles || []).includes('admin')) return '<b>全部页面</b>,能管成员和设置';
      const set = new Set(MEM.roles.filter((r) => (m.roles || []).includes(r.key)).flatMap((r) => r.pages));
      const names = Object.entries(MEM.pages).filter(([k]) => set.has(k) && !['settings', 'tools'].includes(k)).map(([, v]) => v);
      return names.length ? names.join('、') : '<span class="tag tag--warn">没勾页面:什么都看不到</span>';
    };
    el.innerHTML = `<table class="mtable"><thead><tr><th>成员</th><th>状态</th><th>角色</th><th>能看的页面</th><th>最近登录</th></tr></thead><tbody>
      ${list.map((m) => `<tr data-mid="${esc(m.id)}"><td>${m.avatar ? `<img class="avatar-img" src="${esc(m.avatar)}" alt=""/>` : ''}<b>${esc(m.name)}</b>${m.id === window.CGP_ME.member.id ? ' <span class="muted">(我)</span>' : ''}</td>
        <td><select class="sel sel--sm" data-mstatus>${Object.entries(ST_CN).map(([k, v]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${MEM.roles.map((r) => `<label class="chk"><input type="checkbox" data-mrole="${esc(r.key)}" ${(m.roles || []).includes(r.key) ? 'checked' : ''}/>${esc(r.name)}</label>`).join('')}</td>
        <td style="font-size:12.5px">${canSeeOf(m)}</td>
        <td class="muted">${m.lastSeen ? fAgo(m.lastSeen) : '—'}</td></tr>`).join('')}</tbody></table>
      ${list.some((m) => m.status === 'pending') ? '<p class="muted">「待分配」的人勾上角色后会自动启用。</p>' : ''}`;
    $$('#st-members tr[data-mid]').forEach((tr) => {
      const id = tr.dataset.mid;
      const save = async (patch) => {
        try { await api('PUT', `/api/members/${encodeURIComponent(id)}`, patch); toast('已更新'); MEM = await api('GET', '/api/members'); drawMembers(); }
        catch (e) { toast(e.message, false); drawMembers(); }
      };
      tr.querySelector('[data-mstatus]').addEventListener('change', (e) => save({ status: e.target.value }));
      tr.querySelectorAll('[data-mrole]').forEach((c) => c.addEventListener('change', () => save({ roles: [...tr.querySelectorAll('[data-mrole]:checked')].map((x) => x.dataset.mrole) })));
    });
  }
  function drawRoles() {
    const el = $('#st-roles'); if (!el || !MEM) return;
    const pages = Object.entries(MEM.pages).filter(([k]) => !['settings', 'tools'].includes(k));
    el.innerHTML = `<table class="mtable"><thead><tr><th>角色</th>${pages.map(([, v]) => `<th>${esc(v)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${MEM.roles.map((r) => `<tr data-rkey="${esc(r.key)}"><td><b>${esc(r.name)}</b></td>
        ${pages.map(([k]) => `<td><input type="checkbox" data-rpage="${k}" ${r.key === 'admin' ? 'checked disabled' : r.pages.includes(k) ? 'checked' : ''}/></td>`).join('')}
        <td>${r.key === 'admin' || r.builtin ? '' : `<button class="linkbtn" data-rdel="${esc(r.key)}">删除</button>`}</td></tr>`).join('')}</tbody></table>
      <div class="rowin" style="margin-top:10px"><input class="inp" id="st-newrole" placeholder="新角色名称,比如:摄影" maxlength="20"/><button class="btn btn-sm" id="st-addrole" type="button">加角色</button>
        <button class="btn btn-sm btn-primary" id="st-saveroles" type="button">保存角色设置</button></div>`;
    const collect = () => MEM.roles.map((r) => {
      const tr = el.querySelector(`tr[data-rkey="${CSS.escape(r.key)}"]`);
      return { ...r, pages: tr ? [...tr.querySelectorAll('[data-rpage]:checked')].map((x) => x.dataset.rpage) : r.pages };
    });
    $('#st-addrole').addEventListener('click', () => {
      const name = $('#st-newrole').value.trim(); if (!name) return toast('先填角色名称', false);
      MEM.roles = [...collect(), { key: 'r' + Date.now().toString(36), name, pages: ['overview', 'campaigns'] }]; drawRoles();
    });
    el.querySelectorAll('[data-rdel]').forEach((b) => b.addEventListener('click', () => { MEM.roles = collect().filter((r) => r.key !== b.dataset.rdel); drawRoles(); }));
    $('#st-saveroles').addEventListener('click', async () => {
      try { const r = await api('PUT', '/api/roles', { roles: collect() }); MEM.roles = r.roles; toast('角色设置已保存;成员下次刷新页面生效'); drawRoles(); drawMembers(); }
      catch (e) { toast(e.message, false); }
    });
  }

  function renderSettings() {
    const N = S.settings.notify;
    const live = MODE === 'live';
    const larkOn = !!window.CGP_ME?.larkEnabled; // 开了飞书登录:成员管理和数据模式无关,一直显示
    const tg = (k, label, hint) => `<label class="tgl"><input type="checkbox" data-notify="${k}" ${N[k] ? 'checked' : ''} ${live && !isApprover() ? 'disabled' : ''}/><span class="tgl__ui"></span><span><b>${label}</b><span class="muted">${hint}</span></span></label>`;
    const hookVal = live ? '' : esc(S.settings.larkWebhook || '');
    const hookPh = live && S.settings.larkWebhookSet ? `已设置(结尾 ${esc(S.settings.larkWebhookTail)}),要换就粘贴新地址` : 'https://open.larksuite.com/open-apis/bot/v2/hook/…';
    $('#st-root').innerHTML = `
      ${pageHead('设置', '店铺连接、成员与审核、飞书通知、定时器和操作日志')}
      <section class="panel conn" id="st-conn"><div class="panel__h"><h3>店铺连接(正式数据)</h3></div><p class="muted">检查中…</p></section>
      ${larkOn ? larkPanelsHtml() : ''}
      <div class="stgrid">
        ${larkOn ? '' : `<section class="panel">
          ${live ? `<div class="panel__h"><h3>我</h3><span class="tag ${isApprover() ? 'tag--ok' : ''}">${isApprover() ? '审核人' : '编辑'}</span></div>
            <p class="muted">系统按登录 Shopify 后台的员工账号认人。第一个打开的人自动成为审核人。起个名字,飞书通知和日志里会显示。</p>
            <div class="rowin"><input class="inp" id="st-myname" value="${esc(me().name)}" maxlength="30"/><button class="btn btn-sm" id="st-myname-save" type="button">保存</button></div>`
          : `<div class="panel__h"><h3>当前身份</h3><span class="tag tag--warn">演示用</span></div>
            <p class="muted">正式版会自动识别登录 Shopify 后台的员工。演示时切换身份,就能分别体验「编辑提交」和「审核人批准」两边。</p>
            <select class="sel" id="st-me">${S.staff.map((u) => `<option value="${u.id}" ${u.id === S.me ? 'selected' : ''}>${esc(u.name)} · ${u.role === 'approver' ? '审核人' : '编辑'}</option>`).join('')}</select>`}
        </section>
        <section class="panel">
          <div class="panel__h"><h3>成员与角色</h3></div>
          <p class="muted"><b>审核人</b>:自己的改动直接生效,能批准 / 退回别人的。<b>编辑</b>:改动要提交审核才会上线。${live ? '同事第一次打开这个 app 后会出现在这里,默认是编辑。' : ''}</p>
          ${S.staff.map((u) => `<div class="mrow"><span class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</span><b>${esc(u.name)}${u.id === S.me ? ' <span class="muted">(我)</span>' : ''}</b>
            ${live && u.lastSeen ? `<span class="muted">${fAgo(u.lastSeen)}来过</span>` : ''}
            <select class="sel sel--sm" data-role="${u.id}" ${live && !isApprover() ? 'disabled' : ''}><option value="approver" ${u.role === 'approver' ? 'selected' : ''}>审核人</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>编辑</option></select></div>`).join('')}
        </section>`}
        <section class="panel">
          <div class="panel__h"><h3>飞书通知</h3>${live ? (S.settings.larkWebhookSet ? '<span class="tag tag--ok">已连接</span>' : '<span class="tag tag--warn">未设置</span>') : ''}</div>
          <p class="muted">在飞书群里:设置 → 群机器人 → 添加机器人 → 自定义机器人,复制它的 webhook 地址粘贴到这里。建议同时开「签名校验」,把密钥也填上。</p>
          <label class="fld"><span>群机器人 Webhook 地址</span>
            <input class="inp" id="st-hook" placeholder="${hookPh}" value="${hookVal}" ${live && !isApprover() ? 'disabled' : ''}/></label>
          <label class="fld"><span>签名校验密钥(可选)</span>
            <input class="inp" id="st-secret" type="password" placeholder="${live && S.settings.larkSecretSet ? '已设置,要换就粘贴新的' : '没开签名校验就留空'}" ${live && !isApprover() ? 'disabled' : ''}/></label>
          ${live && isApprover() ? '<button class="btn btn-sm" id="st-hook-save" type="button">保存飞书设置</button>' : ''}
          <div class="tgls">
            ${tg('submit', '有人提交审核', '通知审核人')}
            ${tg('decision', '批准 / 退回', '通知提交人,附退回意见')}
            ${tg('dayBefore', '上线前一天提醒', '每天 10:00 汇总明天要上线的,没批准的会标出来')}
            ${tg('endingSoon', `下架前 ${ENDING_DAYS} 天提醒`, '每天 10:00 汇总快到期的 Banner / 公告 / 活动,方便决定延长还是准备替换')}
            ${tg('upDown', '上线 / 下线', '定时器每次自动切换都通知')}
            ${tg('unapproved', '到点还没批准', '内容没按时上线时提醒审核人')}
            ${tg('failure', '定时切换失败', '附错误原因;同一小时只报一次')}
          </div>
          <button class="btn btn-sm" id="st-test" type="button" ${live && !isApprover() ? 'disabled' : ''}>发送测试消息</button>
        </section>
        <section class="panel">
          <div class="panel__h"><h3>定时器</h3><span class="stb stb--live"><span class="dot"></span>运行中</span></div>
          <div class="kv"><span>检查频率</span><b>每分钟</b></div>
          <div class="kv"><span>时区</span><b>英国时间(Europe/London,自动处理夏令时)</b></div>
          <div class="kv"><span>上次运行</span><b>${live ? (S.scheduler?.lastRun ? fDT(S.scheduler.lastRun) : '还没运行') : fDT(now() - 40000)}</b></div>
          ${live && S.scheduler?.lastError ? `<div class="note note--danger">上次出错:${esc(S.scheduler.lastError)}</div>` : ''}
          <p class="muted">每分钟检查一次:到了开始时间且已批准的内容自动上线,到了结束时间的自动下线。服务器短暂宕机的话,恢复后会自动补上。</p>
        </section>
      </div>
      <section class="panel">
        <div class="panel__h"><h3>操作日志</h3><span class="muted">谁、什么时候、做了什么</span></div>
        <div class="loglist">${S.log.slice(0, 60).map(logRow).join('') || '<p class="muted">暂无</p>'}</div>
      </section>`;

    const post = async (path, body, okMsg) => {
      try { const v = await api('POST', path, body); if (v.banners) { S = await normalizeLive(v); renderAll(); } if (okMsg) toast(okMsg); return v; }
      catch (e) { toast(e.message, false); return null; }
    };
    if (larkOn) bindLarkPanels();
    if (live) {
      $('#st-myname-save')?.addEventListener('click', () => post('/api/schedule/staff', { id: S.me, name: $('#st-myname').value }, '名字已保存'));
      $$('[data-role]').forEach((el) => el.addEventListener('change', () => post('/api/schedule/staff', { id: el.dataset.role, role: el.value }, '角色已更新')));
      $$('[data-notify]').forEach((c) => c.addEventListener('change', () => post('/api/schedule/settings', { notify: { [c.dataset.notify]: c.checked } })));
      $('#st-hook-save')?.addEventListener('click', () => {
        const body = {}; const h = $('#st-hook').value.trim(), k = $('#st-secret').value.trim();
        if (h) body.larkWebhook = h; if (k) body.larkSecret = k;
        if (!Object.keys(body).length) return toast('没有要保存的改动', false);
        post('/api/schedule/settings', body, '飞书设置已保存,可以点「发送测试消息」试一下');
      });
      $('#st-test').addEventListener('click', () => post('/api/schedule/lark-test', {}, '测试消息已发到飞书群'));
    } else {
      $('#st-me')?.addEventListener('change', (e) => { S.me = e.target.value; ord.banner = null; ord.topbar = null; save(); renderAll(); toast(`现在的身份:${me().name} · ${isApprover() ? '审核人' : '编辑'}`); });
      $$('[data-role]').forEach((el) => el.addEventListener('change', () => { S.staff.find((u) => u.id === el.dataset.role).role = el.value; save(); renderAll(); }));
      $$('[data-notify]').forEach((c) => c.addEventListener('change', () => { N[c.dataset.notify] = c.checked; save(); }));
      $('#st-hook').addEventListener('change', (e) => { S.settings.larkWebhook = e.target.value.trim(); save(); toast('已保存 Webhook 地址(演示)'); });
      $('#st-test').addEventListener('click', () => toast('演示模式:不会真的发送。正式版会往飞书群发一条测试消息。'));
    }
    renderConn();
  }

  // ---- 店铺连接(真实接口):权限 / 4 个内容类型 / 定时器 ----
  // 只有在 Shopify 后台里打开才有 session token;本地预览会提示。
  const DEF_CN = { cgp_campaign: '活动(促销)', cgp_banner_slide: '首页 Banner', cgp_topbar_message: '顶栏公告', cgp_topbar_style: '顶栏样式', cgp_product_tab: '首页商品页签', cgp_product_module: '首页商品模块版本' };
  let connCache = null;
  async function renderConn(force) {
    const box = $('#st-conn'); if (!box) return;
    const head = `<div class="panel__h"><h3>店铺连接(正式数据)</h3>${MODE === 'live' ? '<span class="tag tag--ok">正在用正式数据</span>' : '<span class="tag tag--warn">现在是演示模式</span>'}</div>`;
    let st = !force && connCache;
    if (!st) {
      try {
        st = connCache = await api('GET', '/api/schedule/status');
        // 页面上只留一份连接状态:查到新的就同步给其他页(比如商品模块页的「缺类型」提示)
        if (S.setup && (S.setup.pmReady !== st.pmReady || S.setup.ready !== st.ready)) { Object.assign(S.setup, { pmReady: st.pmReady, ready: st.ready, upgrade: st.upgrade }); renderPmodules(); }
      }
      catch (e) {
        box.innerHTML = `${head}<p class="muted">${/后台里打开/.test(e.message) ? '本地预览连不到店铺。在 Shopify 后台里打开这个 app,这里会显示权限、内容类型和定时器的真实状态。' : `读取失败:${esc(e.message)}`}</p>
          ${/后台里打开/.test(e.message) ? '' : '<button class="btn btn-sm" data-conn="retry" type="button">重试</button>'}`;
        box.querySelector('[data-conn=retry]')?.addEventListener('click', () => renderConn(true));
        return;
      }
    }
    const ok = (b) => (b ? '<span class="ok">✓</span>' : '<span class="no">✗</span>');
    const missingDefs = st.definitions.filter((d) => !d.exists);
    const canSetup = !st.missingScopes.length && missingDefs.length;
    box.innerHTML = `${head}
      <div class="conn__grid">
        <div><div class="conn__k">1. 权限</div>
          ${st.requiredScopes.map((s) => `<div class="conn__r">${ok(!st.missingScopes.includes(s))}<span class="mono">${s}</span></div>`).join('')}
          ${st.missingScopes.length ? `<div class="note note--warn">还缺 ${st.missingScopes.length} 个权限。在 Partner 后台 → 应用「Promo Dashboard Dev」→ 配置 → 访问权限里加上,发布新版本,再回店铺后台打开这个 app 点同意。
            <button class="btn btn-sm" data-conn="reconnect" type="button">已同意,重新检查</button></div>` : ''}</div>
        <div><div class="conn__k">2. 店里的内容类型</div>
          ${st.definitions.map((d) => `<div class="conn__r">${ok(d.exists)}<span>${DEF_CN[d.type] || d.type}</span><span class="mono muted">${d.type}</span>${d.exists ? `<span class="muted">${d.entries} 条</span>` : ''}</div>`).join('')}
          ${missingDefs.length && st.ready ? `<div class="note note--warn">新功能「首页商品模块」要再补建 ${missingDefs.length} 个内容类型。点下面的按钮补上,再点「从主题导入」把两个模块现在的配置导进来当平时版本。已有的内容不受影响。</div>` : ''}
          ${missingDefs.length ? `<p class="muted">点下面的按钮在店里建好 ${missingDefs.length} 个空的内容类型。<b>前台不会读取它们,顾客看不到任何变化</b>;要等主题改造(阶段 1d)发布后才会用上。可以重复点,已建的会跳过。</p>
            <button class="btn btn-sm btn-primary" data-conn="setup" type="button" ${canSetup ? '' : 'disabled'}>在店里创建内容类型</button>${st.missingScopes.length ? '<span class="muted"> 先补齐权限</span>' : ''}` : '<p class="muted">都建好了。</p>'}</div>
        <div><div class="conn__k">3. 定时器</div>
          <div class="conn__r">${ok(st.scheduler.running)}<span>${st.scheduler.running ? `运行中 · 每 ${st.scheduler.intervalSec} 秒检查一次` : '没有运行'}</span></div>
          <div class="conn__r"><span class="muted">上次检查</span><span>${st.scheduler.lastRun ? fDT(st.scheduler.lastRun) : '还没有需要检查的内容'}</span></div>
          ${st.scheduler.lastError ? `<div class="note note--danger">上次出错:${esc(st.scheduler.lastError)}</div>` : ''}
          <p class="muted">${Object.values(st.items || {}).some((n) => n) ? '已写进店铺的内容由定时器按时间上下线。' : '店里还没有排期内容,定时器空转。'}</p></div>
        ${st.ready ? `<div><div class="conn__k">4. 导入现有内容</div>
          ${S.imported && MODE === 'live' ? `<div class="conn__r"><span class="ok">✓</span><span>${fDT(S.imported.at)} 从「${esc(S.imported.theme)}」导入了 ${S.imported.banners} 张 Banner、${S.imported.topbar} 条顶栏${S.imported.pmodules ? `、${S.imported.pmodules} 个商品模块平时版本` : ''}</span></div>
            ${S.imported.skipped?.length ? `<div class="note note--warn">跳过 ${S.imported.skipped.length} 个:${S.imported.skipped.map((x) => `${esc(x.title || '')}(${esc(x.reason)})`).join('、')}</div>` : ''}` : ''}
          <p class="muted">把线上主题首页<b>正在显示的 Banner</b>、顶栏公告和顶栏配色,以及首页两个商品模块现在的标题和页签(当「平时版本」)导进来,变成「已批准 · 长期显示」,和现在网站上一样。只读主题、不改主题;可以重复点,导过的会跳过。</p>
          <button class="btn btn-sm ${S.imported && MODE === 'live' ? '' : 'btn-primary'}" data-conn="import" type="button">从主题导入</button><span class="muted" id="imp-prev"></span></div>` : ''}
      </div>
      ${st.app ? `<p class="muted conn__ver">app 版本 <span class="mono">${esc(st.app.commit)}</span> · 启动于 ${fDT(st.app.startedAt)}</p>` : ''}
      ${st.ready ? `<div class="conn__mode">${MODE === 'live'
        ? '现在看到的是店里的正式数据,所有改动按审核规则写进店铺。<button class="linkbtn" data-conn="demo" type="button">临时看演示数据</button>'
        : '<b>内容类型已建好。</b><button class="btn btn-sm btn-primary" data-conn="live" type="button">切换到正式数据</button><span class="muted">切换后你在这里的操作会真的写进店铺(前台要等主题改造发布后才读这些内容)。</span>'}</div>` : ''}`;
    box.querySelector('[data-conn=live]')?.addEventListener('click', () => { localStorage.removeItem(FORCE_DEMO); location.reload(); });
    box.querySelector('[data-conn=demo]')?.addEventListener('click', () => { localStorage.setItem(FORCE_DEMO, '1'); location.reload(); });
    if (box.querySelector('[data-conn=import]')) {
      api('GET', '/api/schedule/import-preview').then((p) => {
        const el = $('#imp-prev'); if (!el) return;
        el.textContent = ` 主题「${p.theme}」里现在显示 ${p.slides} 张 Banner、${p.topbarMessages} 条顶栏(另有 ${p.disabledSlides} 张停用的不导入)${(p.modules || []).length ? `;首页商品模块:${p.modules.map((m) => `${m.module === 'sale' ? '促销' : '推荐'}模块「${m.title}」${m.tabs} 个页签`).join('、')}` : ''}`;
        // 商品模块的类型建好了、但还没导平时版本 → 提醒去点导入
        const missing = st.pmReady === false || !(st.definitions || []).filter((d) => !d.core).every((d) => d.exists) ? []
          : (p.modules || []).filter((m) => !(S.pmodules || []).some((x) => x.isDefault && x.module === m.module));
        if (missing.length) {
          const b = box.querySelector('[data-conn=import]'); if (b) { b.classList.add('btn-primary'); }
          el.insertAdjacentHTML('beforebegin', `<div class="note note--warn">首页商品模块(${missing.map((m) => (m.module === 'sale' ? '促销模块' : '推荐模块')).join('、')})的平时版本还没导入,点「从主题导入」就会导进来。已经导过的 Banner、顶栏会自动跳过。</div>`);
        }
      }).catch(() => {});
      box.querySelector('[data-conn=import]').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次确认导入'; return; }
        b.disabled = true; b.textContent = '导入中…(要逐张在文件库里找图,约 1 分钟)';
        try {
          const r = await api('POST', '/api/schedule/import', {});
          toast(r.message + (r.syncErrors?.length ? `;${r.syncErrors.length} 条写进店铺时出错` : ''), !r.syncErrors?.length);
          localStorage.removeItem(FORCE_DEMO); setTimeout(() => location.reload(), 1200);
        } catch (err) { toast('导入失败:' + err.message, false); b.disabled = false; b.textContent = '从主题导入'; }
      });
    }
    box.querySelector('[data-conn=reconnect]')?.addEventListener('click', async () => {
      try { await api('POST', '/api/reconnect'); } catch (e) { /* 忽略,下面重新检查 */ }
      renderConn(true);
    });
    box.querySelector('[data-conn=setup]')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次确认创建'; return; }
      b.disabled = true; b.textContent = '创建中…';
      try {
        const r = await api('POST', '/api/schedule/setup', { by: me().name });
        toast(r.errors.length ? `建好 ${r.created.length} 个,失败 ${r.errors.length} 个:${r.errors[0].message}` : `已建好 ${r.created.length} 个内容类型`, !r.errors.length);
      } catch (err) { toast('创建失败:' + err.message, false); }
      if (MODE === 'live') { try { await load(); renderAll(); } catch (e) { /* 下面照样刷新连接面板 */ } }
      renderConn(true);
    });
  }

  // ================= 编辑抽屉 =================
  let pvTimer = null;
  let ed = null; // 当前编辑中活动的产品范围(合集 / 标签 / 产品),不在普通输入框里,单独存
  // ---- 首页商品模块的版本编辑器:页签列表 ----
  let edTabs = null; let pvTab = 0;
  const newTab = (o = {}) => ({ id: rid('tab-'), title: '', source: 'collection', collection: null, products: [], onlyDiscounted: false, sortByDiscount: false,
    newestFirst: false, countdown: false, limit: 20, shopAllUrl: '', shopAllText: '', ...o });
  function tabsEditorHtml() {
    const chk = (i, k, label) => `<label class="tabed__ck"><input type="checkbox" data-tck="${k}" data-i="${i}" ${edTabs[i][k] ? 'checked' : ''}/> ${label}</label>`;
    return edTabs.map((t, i) => `<div class="tabed" data-i="${i}">
      <div class="tabed__h"><b>页签 ${i + 1}</b>
        <span class="tabed__acts"><button type="button" class="btn btn-sm btn-ghost" data-tact="up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="上移">${I.up}</button><button type="button" class="btn btn-sm btn-ghost" data-tact="down" data-i="${i}" ${i < edTabs.length - 1 ? '' : 'disabled'} aria-label="下移">${I.down}</button><button type="button" class="btn btn-sm btn-ghost btn-danger-t" data-tact="del" data-i="${i}">删除</button></span></div>
      <div class="fld2">
        <label class="fld"><span>页签名</span><input class="inp" data-tf="title" data-i="${i}" value="${esc(t.title)}" placeholder="${esc(t.collection?.title || '如:Top Picks')}"/><em>留空 = 用合集名</em></label>
        <div class="fld"><span>产品从哪来</span><div class="seg">${[['collection', '一个合集'], ['products', '手选产品']].map(([k, l]) => `<button type="button" data-tsrc="${k}" data-i="${i}" class="${t.source === k ? 'is-active' : ''}">${l}</button>`).join('')}</div></div>
      </div>
      <div class="tabed__pick">${t.source === 'collection'
        ? `${t.collection ? `<span class="chip"><span class="chip__t">${esc(t.collection.title)}</span>${colCount(t.collection) != null ? `<span class="chip__n">${colCount(t.collection)} 个产品</span>` : ''}${linkPair('collections', t.collection)}</span>` : '<span class="muted">还没选合集</span>'}
           <button type="button" class="chipadd" data-tpick="collection" data-i="${i}">${I.plus}${t.collection ? '换合集' : '选择合集'}</button>`
        : `${(t.products || []).map((p) => `<span class="chip chip--p">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span class="chip__t">${esc(p.title)}</span></span>`).join('')}
           <button type="button" class="chipadd" data-tpick="products" data-i="${i}">${I.plus}选择产品</button>`}</div>
      <div class="tabed__cks">${chk(i, 'onlyDiscounted', '只显示打折的')}${chk(i, 'sortByDiscount', '按折扣从大到小')}${chk(i, 'newestFirst', '最新上架在前')}${chk(i, 'countdown', '显示倒计时')}</div>
      <div class="tabed__row"><span class="muted">最多显示</span><div class="seg">${[[20, '20 个'], [0, '不限(最多 250)']].map(([n, l]) => `<button type="button" data-tlim="${n}" data-i="${i}" class="${Number(t.limit) === n ? 'is-active' : ''}">${l}</button>`).join('')}</div>
        <span class="muted">${Number(t.limit) ? '首页更轻,其余的点 Shop All 去合集页看' : '合集里符合条件的都画在首页(Shopify 一次最多 250 个)'}</span></div>
      <div class="fld2">
        <label class="fld"><span>Shop All 链接</span><input class="inp" data-tf="shopAllUrl" data-i="${i}" value="${esc(t.shopAllUrl)}" placeholder="留空 = 这个合集的页面"/></label>
        <label class="fld"><span>Shop All 文字</span><input class="inp" data-tf="shopAllText" data-i="${i}" value="${esc(t.shopAllText)}" placeholder="Shop All"/></label>
      </div>
    </div>`).join('') + `<button type="button" class="btn btn-sm" data-tact="add">${I.plus}加一个页签</button>`;
  }
  // 给某个页签选合集(单选)/ 产品(多选):后台里用 Shopify 自带的选择器,本地预览用演示列表
  async function pickForTab(i, type) {
    const t = edTabs[i];
    if (window.shopify && typeof window.shopify.resourcePicker === 'function') {
      try {
        const sel = await window.shopify.resourcePicker({ type: type === 'products' ? 'product' : 'collection', multiple: type === 'products', action: 'select',
          selectionIds: type === 'products' ? (t.products || []).filter((x) => String(x.id).startsWith('gid://')).map((x) => ({ id: x.id })) : [] });
        if (!sel) return;
        if (type === 'products') t.products = sel.map((x) => ({ id: x.id, handle: x.handle, title: x.title, image: x.images?.[0]?.originalSrc || '' }));
        else t.collection = { id: sel[0].id, handle: sel[0].handle, title: sel[0].title, count: sel[0].productsCount ?? null };
        return refreshTabs();
      } catch (e) { /* 不在后台 → 演示列表 */ }
    }
    const src = type === 'products' ? S.products : S.collections;
    const chosen = new Set(type === 'products' ? (t.products || []).map((x) => x.handle) : t.collection ? [t.collection.handle] : []);
    const box = document.createElement('div'); box.className = 'picker';
    box.innerHTML = `<div class="picker__box"><div class="picker__h"><b>${type === 'products' ? '选择产品' : '选一个合集'}</b><input class="inp" placeholder="搜索" id="pk-q"/></div>
      <div class="picker__list" id="pk-list"></div>
      <div class="picker__f"><span class="muted">演示列表。在 Shopify 后台打开时会换成 Shopify 自带的选择器,可以搜全店。</span>
        <span class="picker__acts"><button class="btn btn-sm" data-pk="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-pk="ok" type="button">确定</button></span></div></div>`;
    $('#drawer').appendChild(box);
    const kind = type === 'products' ? 'checkbox' : 'radio';
    const list = () => {
      const q = $('#pk-q').value.trim().toLowerCase();
      $('#pk-list').innerHTML = src.filter((x) => !q || x.title.toLowerCase().includes(q) || x.handle.includes(q)).map((x) => `
        <label class="picker__row"><input type="${kind}" name="pk" value="${esc(x.handle)}" ${chosen.has(x.handle) ? 'checked' : ''}/>
          ${type === 'products' ? `<span class="picker__img" ${x.image ? `style="background-image:url('${esc(x.image)}')"` : ''}></span>` : ''}
          <span class="picker__t">${esc(x.title)}</span><span class="muted picker__m">${type === 'products' ? esc(x.handle) : `${nTxt(x.count)} 个产品`}</span></label>`).join('') || '<p class="muted">没有匹配的</p>';
    };
    list();
    $('#pk-q').addEventListener('input', list);
    $('#pk-list').addEventListener('change', (e) => { if (kind === 'radio') chosen.clear(); if (e.target.checked) chosen.add(e.target.value); else chosen.delete(e.target.value); });
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-pk]'); if (!b && e.target !== box) return;
      if (b && b.dataset.pk === 'ok') {
        if (type === 'products') t.products = src.filter((x) => chosen.has(x.handle));
        else { const c = src.find((x) => chosen.has(x.handle)); if (c) t.collection = c; }
        refreshTabs();
      }
      box.remove();
    });
    $('#pk-q').focus();
  }
  function refreshTabs() {
    const el = $('#ed-tabs'); if (!el) return;
    el.innerHTML = tabsEditorHtml(); pvTab = Math.min(pvTab, edTabs.length - 1);
    $('#ed-form').dispatchEvent(new Event('change'));
  }

  function newItem(kind, preset = {}) {
    const baseIt = { kind, state: 'new', by: S.me, campaign: preset.campaign || null, paused: false, pendingChange: null };
    if (kind === 'banner') return { ...baseIt, id: rid('b-'), image: '', title: '', subtitle: '', description: '', button1_text: 'Shop Now', button1_url: '', button2_text: '', button2_url: '', tag: 'new', order: S.banners.length, start: preset.campaign ? null : dayStart(1), end: null };
    if (kind === 'topbar') return { ...baseIt, id: rid('t-'), emoji: '📣', text: '', link: '', category: '公告', order: S.topbar.length, start: null, end: null };
    if (kind === 'tbstyle') return { ...baseIt, id: rid('s-'), name: '', bg: '#9b1c1c', color: '#ffffff', accent: '#f5d06f', effect: 'snow', decoLeft: '🎄', decoRight: '', priority: 10, start: preset.campaign ? null : dayStart(7), end: preset.campaign ? null : dayStart(14) };
    if (kind === 'pmodule') {
      // 从活动里点「+ 促销模块版本」:名字 / 标题用活动名,第一个页签用活动的第一个合集(只显示打折的、按折扣排)
      const c = preset.campaign ? camp(preset.campaign) : null;
      const mod = preset.module || 'sale';
      const dflt = pmList(mod).find((m) => m.isDefault) || PM_FALLBACK[mod];
      return { ...baseIt, id: rid('pm-'), module: mod, isDefault: false, name: c ? c.name : '', title: '', title2: c ? c.name : '',
        titleColor: dflt.titleColor || '', title2Color: dflt.title2Color || '', tabActiveBg: dflt.tabActiveBg || '', tabActiveText: dflt.tabActiveText || '',
        tabs: c && c.collections?.length ? [newTab({ title: 'Top Picks', collection: c.collections[0], onlyDiscounted: true, sortByDiscount: true, countdown: !!c.countdown })] : [newTab()],
        priority: 10, order: (S.pmodules || []).length, start: c ? null : dayStart(7), end: c ? null : dayStart(14) };
    }
    if (kind === 'pin') return { ...baseIt, id: rid('pin-'), name: '', collection: null, products: [], onlyListed: false, start: preset.campaign ? null : dayStart(1), end: preset.campaign ? null : dayStart(2) };
    if (kind === 'design') return { ...baseIt, id: rid('d-'), name: '', brief: '', spec: '', refs: '', due: dayStart(3), assignee: '', target: preset.target || '', deliverables: [], chosen: '', start: null, end: null };
    if (kind === 'material') return { ...baseIt, id: rid('m-'), name: '', channel: preset.channel || 'email', platform: 'Instagram', subject: '', copy: '', assets: [], publishAt: dayStart(2) + 10 * 3600000, owner: S.me, start: null, end: null };
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
    const st = scopeTotal({ ...ed, counts: ed.counts });
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
      <div class="scope__sum">${st.exact ? `合计 <b>${st.total}</b> 个产品(已去重,Shopify 实时计数)` : `合计约 <b>${st.total}${st.unknown ? '+' : ''}</b> 个产品${st.overlap ? (MODE === 'live' ? ',正在算去重后的准确数量…' : ',合集和标签之间可能有重叠(正式数据里会算出准确的去重数量)') : ''}`}</div>`;
  }

  // ================= v3 工作项:合集置顶清单 / 设计需求 / 宣传物料 =================
  let wx = null; // 编辑中的列表数据:置顶的合集和产品、设计稿、物料素材
  const CHANNEL = { email: '邮件营销', social: '社媒帖子' };
  const PLATFORMS = ['Instagram', 'Facebook', 'YouTube', 'TikTok', 'LinkedIn', 'X'];
  const bannerSpec = () => `Banner 竖图 ${S.site.slide.w}×${S.site.slide.h}(电脑)/ ${S.site.slide.mw}×${S.site.slide.mh}(手机),一张图两边通用`;
  const staffOpts = (sel) => S.staff.map((u) => `<option value="${esc(u.id)}" ${sel === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const campaignOf = (it) => fld('所属活动', `<select class="sel" name="campaignOf"><option value="">不属于活动</option>${S.campaigns.map((c) => `<option value="${c.id}" ${it.campaign === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(winText(c))}</option>`).join('')}</select>`);
  // 设计需求 / 物料自己的状态(它们不上线下线,看的是做到哪一步)
  function workState(x) {
    if (x.kind === 'design') {
      if (x.state === 'approved') return ['done', '已完成'];
      if (x.state === 'pending') return ['pending', '待审批'];
      if (x.state === 'rejected') return ['rejected', '退回修改'];
      return (x.deliverables || []).length ? ['doing', '进行中'] : ['todo', '未开始'];
    }
    if (x.kind === 'material') {
      if (x.publishedAt) return ['done', '已发布'];
      if (x.state === 'approved') return x.publishAt && x.publishAt < now() ? ['late', '该发了'] : ['scheduled', '待发布'];
      if (x.state === 'pending') return ['pending', '待审批'];
      if (x.state === 'rejected') return ['rejected', '退回修改'];
      return ['todo', '草稿'];
    }
    return null;
  }
  const workBadge = (x) => { const [k, l] = workState(x); return `<span class="wst wst--${k}">${l}</span>`; };
  const overdue = (d) => d.kind === 'design' && d.due && d.due < now() && d.state !== 'approved';

  function pinBoxHtml() {
    return `<div class="fld"><span>合集</span><div class="rowin">${wx.collection ? `<span class="chip"><span class="chip__t">${esc(wx.collection.title)}</span>${linkPair('collections', wx.collection)}</span>` : '<span class="muted">还没选</span>'}
        <button type="button" class="btn btn-sm" data-wx="pickcoll">${wx.collection ? '换一个' : '选择合集'}</button></div>
        <em>合集页按下面的顺序把这些产品排在最前面,其他产品照原来的规则排在后面</em></div>
      <div class="fld"><span>排在最前面的产品(按顺序)</span>
        <div class="pinlist">${wx.products.map((p, i) => `<div class="pinrow"><b>${i + 1}</b>${p.image ? `<img src="${esc(thumb(p.image, 80))}" alt="">` : '<span class="pinrow__img"></span>'}<span class="pinrow__t">${esc(p.title)}</span>
          <button type="button" class="btn btn-ghost btn-xs" data-wx="up" data-i="${i}" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn btn-ghost btn-xs" data-wx="down" data-i="${i}" ${i < wx.products.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn btn-ghost btn-xs" data-wx="rm" data-i="${i}">✕</button></div>`).join('') || '<span class="muted">还没加</span>'}</div>
        <button type="button" class="btn btn-sm" data-wx="pickprod">${I.plus}添加产品</button></div>`;
  }
  const fileBoxHtml = (list, key, chosen) => `<div class="dlv">${list.map((d, i) => `<div class="dlv__i ${chosen && chosen === d.url ? 'is-on' : ''}">
      <button type="button" class="dlv__img" ${key === 'deliverables' ? `data-wx="choose" data-i="${i}"` : ''} style="background-image:url('${esc(thumb(d.url, 300))}')" title="${key === 'deliverables' ? '点选要用的这张' : ''}"></button>
      <span class="dlv__n">${esc(d.name || '')}</span><button type="button" class="linkbtn" data-wx="rmfile" data-key="${key}" data-i="${i}">删除</button></div>`).join('') || '<span class="muted">还没有</span>'}</div>
    ${MODE === 'live' ? `<label class="btn btn-sm upl">上传${key === 'deliverables' ? '设计稿' : '素材'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-wx="upload" data-key="${key}" hidden/></label>` : '<em>演示模式不能上传,正式数据里可以</em>'}`;

  function wxFormHtml(it) {
    if (it.kind === 'pin') {
      return `${fld('名称', inp('name', it.name, '如:Flash Sale 第 1 天'))}
        <div id="wx-box">${pinBoxHtml()}</div>
        <label class="tgl"><input type="checkbox" name="onlyListed" ${it.onlyListed ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>只显示清单里的产品</b><span class="muted">比如 Flash Sale:合集里放着所有候选产品,每天只显示当天这一组</span></span></label>
        ${timeBlock(it, 'pin')}`;
    }
    if (it.kind === 'design') {
      const banners = S.banners.filter((b) => status(b) !== 'ended' || b.id === it.target);
      const target = it.target ? byId(it.target) : null;
      return `${fld('标题', inp('name', it.name, '如:Early BF 主 Banner'))}
        ${fld('需求说明', `<textarea class="inp" name="brief" rows="5" placeholder="要表达什么、主打哪些产品、文案、风格…">${esc(it.brief || '')}</textarea>`)}
        <div class="fld2">${fld('用在哪张 Banner', `<select class="sel" name="target"><option value="">不对应 Banner(其他用途)</option>${banners.map((b) => `<option value="${b.id}" ${it.target === b.id ? 'selected' : ''}>${esc(titleOf(b))}</option>`).join('')}</select>`, '批准后可以一键把设计稿套用到这张 Banner')}
          ${fld('尺寸规格', inp('spec', it.spec || (target ? bannerSpec() : ''), '如:1080×1080 社媒方图'))}</div>
        ${fld('参考链接', `<textarea class="inp" name="refs" rows="2" placeholder="每行一个">${esc(it.refs || '')}</textarea>`)}
        <div class="fld2">${fld('设计师', `<input class="inp" name="assignee" list="dz-staff" value="${esc(it.assignee || '')}" placeholder="名字"/><datalist id="dz-staff">${S.staff.map((u) => `<option value="${esc(u.name)}">`).join('')}</datalist>`)}
          ${fld('截止日期', `<input class="inp" type="date" name="due" value="${it.due ? toInput(it.due).slice(0, 10) : ''}"/>`)}</div>
        ${campaignOf(it)}
        <div class="fld"><span>设计稿 <em>上传后点选要用的那张;交稿后点「提交审核」</em></span><div id="wx-box">${fileBoxHtml(wx.deliverables, 'deliverables', wx.chosen)}</div></div>
        ${it.state === 'approved' && it.target && wx.chosen ? `<button type="button" class="btn btn-primary" data-wx="apply">把选中的设计稿套用到「${esc(titleOf(byId(it.target) || {}))}」</button>` : ''}`;
    }
    const ch = it.channel || 'email';
    return `<div class="fld"><span>渠道</span><div class="seg" id="ed-channel">${Object.entries(CHANNEL).map(([k, l]) => `<button type="button" data-channel="${k}" class="${ch === k ? 'is-active' : ''}">${l}</button>`).join('')}</div></div>
      ${fld('标题(后台看的)', inp('name', it.name, '如:EBF 开场邮件'))}
      <div data-ch="email" ${ch === 'email' ? '' : 'hidden'}>${fld('邮件主题', inp('subject', it.subject, '收件人看到的标题'))}</div>
      <div data-ch="social" ${ch === 'social' ? '' : 'hidden'}>${fld('平台', `<select class="sel" name="platform">${PLATFORMS.map((x) => `<option ${it.platform === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
      ${fld('文案 / 正文要点', `<textarea class="inp" name="copy" rows="6">${esc(it.copy || '')}</textarea>`)}
      <div class="fld"><span>素材</span><div id="wx-box">${fileBoxHtml(wx.assets, 'assets')}</div></div>
      <div class="fld2">${fld('发布时间', `<input class="inp" type="datetime-local" name="publishAt" value="${toInput(it.publishAt)}"/>`, '到时间提醒负责人去发;app 不会替你发')}
        ${fld('负责人', `<select class="sel" name="owner"><option value="">不指定</option>${staffOpts(it.owner)}</select>`)}</div>
      ${campaignOf(it)}
      ${it.state === 'approved' ? `<div class="fld"><span>发布情况</span>${it.publishedAt
        ? `<div class="note">已发布 ${fDT(it.publishedAt)}${it.publishedUrl ? ` · <a href="${esc(it.publishedUrl)}" target="_blank" rel="noopener">查看</a>` : ''} <button type="button" class="linkbtn" data-wx="unpublish">撤销</button></div>`
        : `<div class="rowin"><input class="inp" id="pub-url" placeholder="发出去后粘贴链接(可不填)"/><button type="button" class="btn btn-sm btn-primary" data-wx="publish">标记已发布</button></div>`}</div>` : ''}`;
  }

  function wxPreviewHtml(v) {
    if (v.kind === 'pin') {
      return `<div class="pv-label">合集页最前面的样子</div>
        <div class="pv-pins">${(v.products || []).slice(0, 12).map((p, i) => `<div class="pv-pin"><span class="pv-pin__n">${i + 1}</span><span class="pv-pin__img" ${p.image ? `style="background-image:url('${esc(thumb(p.image, 300))}')"` : ''}></span><span class="pv-pin__t">${esc(p.title)}</span></div>`).join('') || '<p class="muted">加了产品这里会按顺序显示</p>'}</div>
        <p class="muted pv-cap">${v.collection ? `合集「${esc(v.collection.title)}」` : '合集'}${v.onlyListed ? '在生效期间只显示这些产品' : '先显示这些产品,后面接原来的顺序'};结束后恢复原来的排序。</p>`;
    }
    if (v.kind === 'design') {
      const img = v.chosen || v.deliverables?.[0]?.url;
      const target = v.target ? byId(v.target) : null;
      return `${target ? `<div class="pv-label">套用到 Banner 后的样子</div><div class="pv-stage">${slideHtml({ ...target, image: img || target.image }, { w: 700, cls: 'is-main' })}</div>` : img ? `<div class="pv-label">选中的设计稿</div><img class="pv-dlv" src="${esc(thumb(img, 900))}" alt="">` : ''}
        <div class="pv-label">需求</div><div class="pv-brief">${esc(v.brief || '(还没写需求说明)').replace(/\n/g, '<br>')}</div>
        ${v.due ? `<p class="muted pv-cap">截止 ${fDate(v.due)}${overdue(v) ? ' · <b style="color:var(--danger)">已逾期</b>' : ''}${v.assignee ? ` · 设计师 ${esc(v.assignee)}` : ''}</p>` : ''}`;
    }
    const img = v.assets?.[0]?.url;
    if ((v.channel || 'email') === 'email') {
      return `<div class="pv-label">邮件预览</div><div class="pv-mail"><div class="pv-mail__h"><b>${esc(v.subject || '(邮件主题)')}</b><span class="muted">CineGearPro</span></div>
        ${img ? `<img src="${esc(thumb(img, 900))}" alt="">` : ''}<div class="pv-mail__b">${esc(v.copy || '').replace(/\n/g, '<br>')}</div></div>
        ${v.publishAt ? `<p class="muted pv-cap">计划 ${fDT(v.publishAt)} 发出</p>` : ''}`;
    }
    return `<div class="pv-label">${esc(v.platform || '社媒')} 帖子预览</div><div class="pv-post">${img ? `<img src="${esc(thumb(img, 900))}" alt="">` : '<div class="pv-post__ph"></div>'}<div class="pv-post__b">${esc(v.copy || '').replace(/\n/g, '<br>')}</div></div>
      ${v.publishAt ? `<p class="muted pv-cap">计划 ${fDT(v.publishAt)} 发布</p>` : ''}`;
  }

  // 选合集 / 产品(置顶清单用)。在后台里用 Shopify 自带的选择器;演示时从演示数据里挑
  async function pickPin(type) {
    const m = (x) => ({ id: x.id, handle: x.handle, title: x.title, image: x.images?.[0]?.originalSrc || x.image || '' });
    if (window.shopify && typeof window.shopify.resourcePicker === 'function') {
      try {
        const sel = await window.shopify.resourcePicker({ type: type === 'coll' ? 'collection' : 'product', multiple: type !== 'coll', action: 'select' });
        if (!sel?.length) return;
        if (type === 'coll') wx.collection = m(sel[0]);
        else { const have = new Set(wx.products.map((p) => p.id)); wx.products.push(...sel.map(m).filter((p) => !have.has(p.id))); }
        return true;
      } catch { /* 不在后台 → 用演示数据 */ }
    }
    if (type === 'coll') { const c = S.collections[0]; if (c) wx.collection = m(c); }
    else { const have = new Set(wx.products.map((p) => p.handle)); wx.products.push(...S.products.filter((p) => !have.has(p.handle)).slice(0, 3).map(m)); }
    return true;
  }

  function formHtml(it) {
    if (['pin', 'design', 'material'].includes(it.kind)) return wxFormHtml(it);
    if (it.kind === 'banner') {
      const seenImg = new Set();
      const imgs = S.banners.filter((b) => b.image && !seenImg.has(b.image) && seenImg.add(b.image)).slice(0, 40);
      const p = it.state !== 'new' ? bannerPos(it) : null;
      return `
        ${p ? `<div class="note">${p.future ? `上线后在首页轮播排 <b>第 ${p.n} 张</b>` : `现在在首页轮播排 <b>第 ${p.n} 张</b>`}。要换位置,去 Banner 页点「调整顺序」。</div>` : ''}
        <div class="fld"><span>图片</span>
          <div class="imgpick" id="ed-imgs">${imgs.map((b) => `<button type="button" class="imgpick__i ${b.image === it.image ? 'is-on' : ''}" data-img="${esc(b.image)}" data-imgid="${esc(b.imageId || '')}" style="background-image:url('${esc(thumb(b.image, 200))}')"></button>`).join('')}</div>
          <div class="rowin"><input class="inp" name="image" value="${esc(it.image)}" placeholder="或粘贴图片地址"/>
            ${MODE === 'live' ? '<label class="btn btn-sm upl">上传新图<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" id="ed-upload" hidden/></label>' : ''}</div>
          <input type="hidden" name="imageId" value="${esc(it.imageId || '')}"/>
          <em>竖图 ${S.site.slide.w}×${S.site.slide.h}(电脑)/ ${S.site.slide.mw}×${S.site.slide.mh}(手机),两边比例几乎一样,一张图就够。${MODE === 'live' ? '上传的图存进 Shopify 文件库;也可以从上面已有的图里选。' : '演示时从现有图片里选;正式数据里可以直接上传。'}</em>
        </div>
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
    if (it.kind === 'pmodule') {
      const color = (n, v, l) => `<label class="clr"><input type="color" name="${n}" value="${esc(v || '#000000')}"/><span>${l}</span><span class="mono">${esc(v || '')}</span></label>`;
      return `
        <div class="fld"><span>哪个模块</span><div class="seg" id="ed-module">${Object.entries(MODULE_CN).map(([k, l]) => `<button type="button" data-module="${k}" class="${it.module === k ? 'is-active' : ''}" ${it.isDefault ? 'disabled' : ''}>${l}</button>`).join('')}</div></div>
        ${fld('版本名(后台看的)', inp('name', it.name, '如:Black Friday 2026'))}
        <div class="fld"><span>首页标题 <em>两段,第二段一般用彩色</em></span>
          <div class="fld2">${inp('title', it.title, '第一段,如:Black Friday')}${inp('title2', it.title2, '第二段,如:Deals')}</div>
          <div class="clrs">${color('titleColor', it.titleColor, '第一段颜色')}${color('title2Color', it.title2Color, '第二段颜色')}${color('tabActiveBg', it.tabActiveBg, '页签高亮底色')}${color('tabActiveText', it.tabActiveText, '页签高亮文字')}</div></div>
        <div class="fld"><span>页签 <em>按这个顺序显示;到时间整套替换现在的页签</em></span><div id="ed-tabs">${tabsEditorHtml()}</div></div>
        ${it.isDefault ? '' : fld('优先级', `<input class="inp" type="number" name="priority" value="${esc(it.priority ?? 10)}"/>`, '同一时间有几个版本都生效时,数字大的显示')}
        ${it.isDefault ? '<div class="fld"><span>什么时候显示</span><em>平时版本一直有效:没有别的版本生效时就显示它。</em></div>' : timeBlock(it, 'pmodule')}`;
    }
    const bn = S.banners.filter((b) => b.campaign === it.id), tb = S.topbar.filter((t) => t.campaign === it.id), sty = S.tbstyles.filter((t) => t.campaign === it.id), pm = (S.pmodules || []).filter((m) => m.campaign === it.id);
    return `
      ${fld('活动名称', inp('name', it.name, '如:Autumn Sale'))}
      ${timeBlock(it, 'campaign')}
      <div class="fld"><span>参加活动的产品 <em>满足任一条件就参加</em></span>
        <div class="scope" id="ed-scope">${scopeHtml()}</div>
        <em>在任一合集里、带任一标签、或被单独指定的产品,都会显示本活动的徽章和倒计时。点「后台↗ / 前台↗」可以核对具体是哪些产品。</em></div>
      <div class="fld2">${fld('产品页徽章文字', inp('badge', it.badge, '如:Autumn Sale -20%'))}${fld('优先级', `<input class="inp" type="number" name="priority" value="${esc(it.priority)}"/>`, '一个产品同时在多个活动里时,数字大的优先')}</div>
      <label class="tgl"><input type="checkbox" name="countdown" ${it.countdown ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>产品页显示倒计时</b><span class="muted">全站统一样式,倒数到活动结束,到期自动消失</span></span></label>
      ${it.state !== 'new' ? `<div class="fld"><span>挂在本活动下的内容</span>
        <div class="attach">${[...bn, ...tb, ...sty, ...pm].map((x) => `<button type="button" class="attach__i" data-open="${x.id}" data-pop="${x.id}">
          ${x.kind === 'banner' ? `<span class="attach__slide">${slideHtml(x, { w: 200 })}</span>` : miniThumb(x)}
          <span class="attach__t">${kindChip(x.kind)} ${esc(titleOf(x))}</span>${badge(x)}</button>`).join('') || '<span class="muted">还没有</span>'}</div>
        <div class="attach__add"><button type="button" class="btn btn-sm" data-new="banner" data-for="${it.id}">${I.plus}Banner</button><button type="button" class="btn btn-sm" data-new="topbar" data-for="${it.id}">${I.plus}顶栏公告</button><button type="button" class="btn btn-sm" data-new="tbstyle" data-for="${it.id}">${I.plus}顶栏样式</button><button type="button" class="btn btn-sm" data-new="pmodule" data-for="${it.id}">${I.plus}首页促销模块版本</button></div></div>` : ''}`;
  }

  function previewHtml(v) {
    if (['pin', 'design', 'material'].includes(v.kind)) return wxPreviewHtml(v);
    if (v.kind === 'pmodule') {
      return `<div class="pv-label">首页上的样子</div>${moduleHtml(v, { activeTab: pvTab })}
        <p class="muted pv-cap">点页签切换预览。${MODE === 'live' ? '产品是按这个页签的设置从店里取的前几个。' : '演示数据只画占位;正式数据里会显示这个页签真实会出现的产品。'}到时间后首页这个模块整套换成它,结束回到平时版本。</p>`;
    }
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
  function refreshScope(fromCounts) {
    const el = $('#ed-scope'); if (!el) return;
    if (!fromCounts) delete ed.counts;
    el.innerHTML = scopeHtml(); $('#ed-form').dispatchEvent(new Event('change'));
    if (!fromCounts) fetchCounts();
  }
  // 正式数据:选好的合集 / 标签 / 产品变了就让服务器重新算(稍等半秒,连续改只算一次)
  let countsTimer = null;
  function fetchCounts() {
    if (MODE !== 'live' || !ed) return;
    clearTimeout(countsTimer);
    const mine = ed;
    countsTimer = setTimeout(async () => {
      if (!mine.collections.length && !mine.tags.length && !mine.products.length) return;
      try {
        const r = await api('POST', '/api/schedule/counts', { collections: mine.collections, tags: mine.tags, products: mine.products });
        Object.entries(r.collections).forEach(([gid, c]) => { liveColCounts[gid] = c.count; });
        Object.assign(S.tagCounts, r.tags);
        if (ed !== mine) return; // 抽屉已经换了
        mine.counts = r; refreshScope(true);
      } catch (e) { console.warn('[counts]', e); }
    }, 500);
  }

  function readForm(base) {
    const f = $('#ed-form'); const g = (n) => f.querySelector(`[name="${n}"]`);
    const v = { ...base };
    f.querySelectorAll('input[name],select[name],textarea[name]').forEach((el) => {
      if (['start', 'end', 'campaign', 'countdown', 'priority'].includes(el.name)) return;
      v[el.name] = el.value.trim();
    });
    if (!base.isDefault && !['design', 'material'].includes(base.kind)) {
      const mode = ($('#ed-mode .is-active') || {}).dataset?.mode || 'range';
      if (mode === 'long') { v.start = null; v.end = null; v.campaign = null; }
      else if (mode === 'campaign') { v.start = null; v.end = null; v.campaign = g('campaign').value || null; }
      else { v.start = fromInput(g('start').value); v.end = fromInput(g('end').value); } // 自己设时间:仍可挂在活动下(分组),但不跟随活动时间
    }
    if (base.kind === 'banner') v.tag = ($('#ed-tag .is-active') || {}).dataset?.tag || 'none';
    if (base.kind === 'pmodule') {
      v.tabs = edTabs.map((t) => ({ ...t, title: t.title.trim(), shopAllUrl: (t.shopAllUrl || '').trim(), shopAllText: (t.shopAllText || '').trim() }));
      v.module = ($('#ed-module .is-active') || {}).dataset?.module || base.module;
      if (g('priority')) v.priority = +g('priority').value || 0;
    }
    if (base.kind === 'tbstyle') { v.effect = ($('#ed-effect .is-active') || {}).dataset?.effect || 'none'; if (g('priority')) v.priority = +g('priority').value || 0; }
    if (base.kind === 'pin') { v.collection = wx.collection; v.products = wx.products.map(({ id, handle, title, image }) => ({ id, handle, title, image })); v.onlyListed = !!g('onlyListed')?.checked; }
    if (base.kind === 'design' || base.kind === 'material') { v.campaign = g('campaignOf')?.value || null; v.start = null; v.end = null; }
    delete v.campaignOf;
    if (base.kind === 'design') { v.deliverables = [...wx.deliverables]; v.chosen = wx.chosen; v.due = g('due').value ? fromInput(g('due').value + 'T18:00') : null; }
    if (base.kind === 'material') { v.channel = ($('#ed-channel .is-active') || {}).dataset?.channel || 'email'; v.assets = [...wx.assets]; v.publishAt = fromInput(g('publishAt').value); }
    if (base.kind === 'campaign') {
      v.collections = [...ed.collections]; v.tags = [...ed.tags]; v.products = [...ed.products];
      v.countdown = g('countdown').checked; v.priority = +g('priority').value || 0;
    }
    return v;
  }
  function validate(v) {
    if (v.kind === 'pin' && !v.collection) return '请选要排序的合集';
    if (v.kind === 'pin' && !v.products.length) return '至少放一个要排在前面的产品';
    if ((v.kind === 'design' || v.kind === 'material') && !v.name) return '请填写标题';
    if (v.kind === 'design' && !v.deliverables.length) return '还没上传设计稿;先点「保存需求」,交稿时再提交审核';
    if (v.kind === 'banner' && !v.image) return '请选一张图片';
    if (v.kind === 'topbar' && !v.text) return '请填写公告文字';
    if ((v.kind === 'campaign' || v.kind === 'tbstyle' || v.kind === 'pmodule') && !v.name) return '请填写名称';
    if (v.kind === 'campaign' && v.start == null) return '活动需要开始时间';
    if (v.start != null && v.end != null && v.end <= v.start) return '结束时间要晚于开始时间';
    if (v.kind !== 'campaign' && v.campaign === null && ($('#ed-mode .is-active') || {}).dataset?.mode === 'campaign') return '请选择要跟随的活动';
    return '';
  }
  function openEditor(kind, id, preset) {
    hidePop();
    const isNew = !id; const it = id ? byId(id) : newItem(kind, preset);
    if (!it) return;
    // 编辑看到的是「自己待审核的修改」,没有就看线上版本
    // preset.override:从别处带入的改动(比如把设计稿套用到 Banner),保存时照常走审核
    const base = { ...it, ...(it.pendingChange && !isApprover() ? it.pendingChange : {}), ...(id && preset?.override ? preset.override : {}) };
    ed = { collections: [...(base.collections || [])], tags: [...(base.tags || [])], products: [...(base.products || [])], counts: base.pendingChange ? null : base.counts };
    edTabs = (base.tabs || []).map((t) => ({ ...t, products: [...(t.products || [])] })); pvTab = 0;
    wx = { collection: base.kind === 'pin' ? base.collection || null : null, products: base.kind === 'pin' ? [...(base.products || [])] : [],
      deliverables: [...(base.deliverables || [])], chosen: base.chosen || '', assets: [...(base.assets || [])] };
    const s = status(it);
    const approver = isApprover();
    const live = it.state === 'approved';
    let acts = '';
    if (kind === 'design' && it.state !== 'approved') {
      acts += '<button class="btn" data-act="draft" type="button">保存需求</button>';
      acts += `<button class="btn btn-primary" data-act="submit" type="button">${it.state === 'pending' ? '更新交稿' : '交稿,提交审核'}</button>`;
    } else if (approver) {
      if (!isNew && live && !it.isDefault) acts += `<button class="btn" data-act="pause" type="button">${it.paused ? '恢复显示' : s === 'live' ? '暂停(立即下线)' : '暂停'}</button>`;
      if (isNew || it.state !== 'approved') acts += '<button class="btn" data-act="draft" type="button">存草稿</button>';
      acts += `<button class="btn btn-primary" data-act="publish" type="button">${live ? '保存修改' : '保存并排期'}</button>`;
    } else {
      if (isNew || ['draft', 'new', 'rejected'].includes(it.state)) acts += '<button class="btn" data-act="draft" type="button">存草稿</button>';
      acts += `<button class="btn btn-primary" data-act="submit" type="button">${live ? '提交修改审核' : '提交审核'}</button>`;
    }
    const canDelete = !isNew && !it.isDefault && (['design', 'material'].includes(it.kind) ? it.state !== 'pending' : ['draft', 'rejected', 'ended'].includes(s));
    const notes = [];
    if (endingSoon(it)) notes.push(`<div class="note note--warn">⚠️ ${relDay(win(it).end)}(${fDT(win(it).end)})自动下架。要继续显示就把结束时间往后改${win(it).via ? '(它跟随活动,要改活动的结束时间)' : ''}。</div>`);
    if (it.pendingChange) notes.push(`<div class="note note--warn">${esc(who(it.pendingChange.by))} 提交了修改,正在等审核。${approver ? '去「审核」页批准后才会替换线上版本。' : '批准前线上保持原来的版本。'}</div>`);
    if (!approver && live && !it.pendingChange) notes.push('<div class="note">这条已经批准。你的修改会先提交审核,<b>批准前线上保持原来的版本</b>。</div>');
    if (it.state === 'rejected') notes.push(`<div class="note note--danger">被退回:${esc(it.rejectNote || '')}。修改后可以重新提交。</div>`);
    if (it.lastReject) notes.push(`<div class="note note--danger">上次的修改被退回:${esc(it.lastReject.note)}</div>`);
    if (it.note) notes.push(`<div class="note">${esc(it.note)}</div>`);
    if (MODE === 'live' && it.state === 'approved' && it.syncError) notes.push(`<div class="note note--danger">写进店铺时出错:${esc(it.syncError)}。${approver ? '点「保存修改」会重试。' : '请审核人处理。'}</div>`);

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
      if (v.kind === 'pmodule') loadTabPreview(v.tabs[pvTab], () => { if ($('#ed-pv') && edTabs) $('#ed-pv').innerHTML = previewHtml(readForm(base)); });
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
    if (kind === 'campaign' && MODE === 'live' && !ed.counts) fetchCounts();
    const f = $('#ed-form');
    f.addEventListener('input', (e) => {
      if (e.target.dataset.tf) { edTabs[+e.target.dataset.i][e.target.dataset.tf] = e.target.value; }
      if (e.target.name === 'image' && f.querySelector('[name="imageId"]')) f.querySelector('[name="imageId"]').value = '';
      refreshPv();
    });
    // 上传新图(正式数据):传到服务器 → Shopify 文件库 → 拿回文件 id 和图片地址
    f.querySelector('#ed-upload')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 20 * 1024 * 1024) return toast('图片太大了(最多 20MB)', false);
      const lab = e.target.closest('label'); const old = lab.firstChild.textContent; lab.firstChild.textContent = '上传中…';
      try {
        // 请求头和其他接口一样由 auth.js 给(后台里的 Shopify 凭证 + 飞书登录会话)
        const res = await fetch(`/api/schedule/upload?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...(await window.cgpHeaders()), 'Content-Type': file.type }, body: file });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || res.statusText);
        f.querySelector('[name="image"]').value = j.url; f.querySelector('[name="imageId"]').value = j.id;
        refreshPv(); toast('图片已上传到 Shopify 文件库');
      } catch (err) { toast('上传失败:' + err.message, false); }
      lab.firstChild.textContent = old; e.target.value = '';
    });
    f.addEventListener('change', (e) => {
      if (e.target.dataset?.tck) edTabs[+e.target.dataset.i][e.target.dataset.tck] = e.target.checked;
      refreshPv();
    });
    // ---- 合集置顶清单 / 设计需求 / 宣传物料 ----
    const redrawWx = () => {
      const box = $('#wx-box'); if (!box) return;
      box.innerHTML = it.kind === 'pin' ? pinBoxHtml() : it.kind === 'design' ? fileBoxHtml(wx.deliverables, 'deliverables', wx.chosen) : fileBoxHtml(wx.assets, 'assets');
      refreshPv();
    };
    f.addEventListener('click', async (e) => {
      const ch = e.target.closest('#ed-channel button');
      if (ch) {
        $$('#ed-channel button').forEach((b) => b.classList.toggle('is-active', b === ch));
        $$('#ed-form [data-ch]').forEach((x) => { x.hidden = x.dataset.ch !== ch.dataset.channel; });
        return refreshPv();
      }
      const w = e.target.closest('[data-wx]'); if (!w || w.tagName === 'INPUT') return;
      const i = +w.dataset.i; const a = w.dataset.wx;
      if (a === 'pickcoll' || a === 'pickprod') { if (await pickPin(a === 'pickcoll' ? 'coll' : 'prod')) redrawWx(); return; }
      if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; [wx.products[i], wx.products[j]] = [wx.products[j], wx.products[i]]; return redrawWx(); }
      if (a === 'rm') { wx.products.splice(i, 1); return redrawWx(); }
      if (a === 'choose') { wx.chosen = wx.deliverables[i].url; return redrawWx(); }
      if (a === 'rmfile') { const k = w.dataset.key; const [gone] = wx[k].splice(i, 1); if (k === 'deliverables' && gone?.url === wx.chosen) wx.chosen = wx.deliverables[0]?.url || ''; return redrawWx(); }
      if (a === 'publish' || a === 'unpublish') {
        const r = await act({ type: 'markPublished', id: it.id, url: $('#pub-url')?.value || '', undo: a === 'unpublish' });
        if (r) { closeDrawer(); toast(r.message); }
        return;
      }
      if (a === 'apply') {
        const d = wx.deliverables.find((x) => x.url === wx.chosen);
        const target = it.target;
        closeDrawer();
        openEditor('banner', target, { override: { image: d.url, imageId: d.id || '' } });
        toast('已带入设计稿,确认文字后保存(会照常走审核)');
      }
    });
    f.addEventListener('change', async (e) => {
      const up = e.target.closest('input[data-wx="upload"]'); if (!up) return;
      const file = up.files?.[0]; if (!file) return;
      if (file.size > 20 * 1024 * 1024) return toast('图片太大了(最多 20MB)', false);
      const lab = up.closest('label'); const old = lab.firstChild.textContent; lab.firstChild.textContent = '上传中…';
      try {
        const res = await fetch(`/api/schedule/upload?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...(await window.cgpHeaders()), 'Content-Type': file.type }, body: file });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || res.statusText);
        const k = up.dataset.key;
        wx[k].push({ url: j.url, id: j.id, name: file.name, at: now() });
        if (k === 'deliverables' && !wx.chosen) wx.chosen = j.url;
        redrawWx(); toast('已上传到 Shopify 文件库');
      } catch (err) { toast('上传失败:' + err.message, false); lab.firstChild.textContent = old; }
    });
    // 预览里点页签:切换预览的页签
    $('#ed-pv').addEventListener('click', (e) => { const t = e.target.closest('[data-pmtab]'); if (t && edTabs) { pvTab = +t.dataset.pmtab; refreshPv(); } });
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
      // 商品模块:页签的增删排、来源、上限、选合集 / 产品
      const ta = e.target.closest('[data-tact]');
      if (ta) {
        const i = +ta.dataset.i; const a = ta.dataset.tact;
        if (a === 'add') { edTabs.push(newTab()); pvTab = edTabs.length - 1; }
        else if (a === 'del') { if (edTabs.length === 1) return toast('至少要留一个页签', false); edTabs.splice(i, 1); }
        else { const j = a === 'up' ? i - 1 : i + 1; [edTabs[i], edTabs[j]] = [edTabs[j], edTabs[i]]; }
        return refreshTabs();
      }
      const ts = e.target.closest('[data-tsrc]');
      if (ts) { edTabs[+ts.dataset.i].source = ts.dataset.tsrc; return refreshTabs(); }
      const tl = e.target.closest('[data-tlim]');
      if (tl) { edTabs[+tl.dataset.i].limit = +tl.dataset.tlim; return refreshTabs(); }
      const tp = e.target.closest('[data-tpick]');
      if (tp) return pickForTab(+tp.dataset.i, tp.dataset.tpick);
      const seg = e.target.closest('#ed-tag button, #ed-effect button, #ed-module button');
      if (seg) { $$(`#${seg.parentElement.id} button`).forEach((b) => b.classList.toggle('is-active', b === seg)); refreshPv(); return; }
      const im = e.target.closest('.imgpick__i');
      if (im) {
        f.querySelector('[name="image"]').value = im.dataset.img; f.querySelector('[name="imageId"]').value = im.dataset.imgid || '';
        $$('.imgpick__i').forEach((b) => b.classList.toggle('is-on', b === im)); refreshPv(); return;
      }
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
      const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
      const kindOfAct = a.dataset.act;
      if (kindOfAct === 'close') return closeDrawer();
      if (kindOfAct === 'delete' && !a.dataset.sure) { a.dataset.sure = '1'; a.textContent = '再点一次确认删除'; a.classList.add('btn-danger'); return; }
      runDrawerAction(kindOfAct, a);
    };

    // 按钮 → 动作(规则和权限检查都在共用模块 / 服务器里)
    async function runDrawerAction(kindOfAct, btn) {
      const busy = (on) => $$('#drawer .drawer__f .btn').forEach((b) => { b.disabled = on; });
      let r;
      if (kindOfAct === 'pause' || kindOfAct === 'delete') {
        busy(true); r = await act({ type: kindOfAct, id: it.id }); busy(false);
        if (r) { closeDrawer(); toast(r.message); }
        return;
      }
      const v = readForm(base);
      if (kindOfAct !== 'draft') { const err = validate(v); if (err) return toast(err, false); }
      const mode = kindOfAct; // draft / submit / publish
      const values = { ...v }; if (isNew) values.id = it.id;
      busy(true); btn.textContent = MODE === 'live' && mode === 'publish' ? '写进店铺中…' : btn.textContent;
      r = await act({ type: 'save', mode, kind: it.kind, id: it.id, isNew, values });
      busy(false);
      if (!r) return;
      closeDrawer();
      if (mode === 'publish') {
        const saved = byId(it.id); const st2 = saved ? status(saved) : '';
        toast(st2 === 'scheduled' ? `已排期 · ${fDT(win(saved).start)} 自动上线` : st2 === 'live' ? '已上线' : `已保存${st2 ? ' · ' + ST[st2] : ''}`);
      } else toast(mode === 'submit' ? `已提交审核${MODE === 'live' ? ' · 已通知审核人' : ' · 已在飞书 @审核人(演示)'}` : '已存草稿');
    }
  }
  function closeDrawer() {
    clearInterval(pvTimer); ed = null; edTabs = null; wx = null; hidePop();
    $('#drawer').hidden = true; $('#drawer-mask').hidden = true; $('#drawer').innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  // ================= 全局 =================
  function renderAll() {
    applySiteStyle(); hidePop();
    renderOverview(); renderBanners(); renderTopbar(); renderPmodules(); renderCampaigns(); renderReviews(); renderSettings();
    const n = pendingCount(); const b = $('#n-rv'); b.hidden = !n; b.textContent = n;
    const L = window.CGP_ME; // 飞书登录了就显示登录的人和他的角色
    $('#me-chip').innerHTML = L?.larkEnabled
      ? `<button class="mechip" type="button" title="我的账号">${L.member.avatar ? `<img class="avatar-img" src="${esc(L.member.avatar)}" alt=""/>` : `<span class="avatar">${esc(L.member.name.slice(0, 1).toUpperCase())}</span>`}${esc(L.member.name)}<span class="muted">· ${esc(L.member.roles.map((k) => L.roles.find((r) => r.key === k)?.name || k).join('、'))}</span></button>`
      : `<button class="mechip" type="button" title="切换身份(演示)"><span class="avatar">${esc(me().name.slice(0, 1).toUpperCase())}</span>${esc(me().name)}<span class="muted">· ${isApprover() ? '审核人' : '编辑'}</span></button>`;
  }

  // 事件委托:任何地方的 data-open / data-new / data-go / 审核按钮
  document.addEventListener('click', (e) => {
    if (e.target.closest('#drawer')) return;
    const o = e.target.closest('[data-open]');
    if (o && o.closest('.section')) { const x = byId(o.dataset.open); if (x) openEditor(x.kind, x.id); return; }
    const n = e.target.closest('[data-new]');
    if (n && n.closest('.section')) { openEditor(n.dataset.new, null, n.dataset.for ? { campaign: n.dataset.for, channel: n.dataset.channel } : undefined); return; }
    const hb = e.target.closest('[data-hub]');
    if (hb) { cpHub = hb.dataset.hub; hubPrice.at = 0; renderCampaigns(); window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-hubback]')) { cpHub = null; renderCampaigns(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr && window.cgpPriceOpen) { showSection('price'); window.cgpPriceOpen(pr.dataset.price); return; }
    const pn = e.target.closest('[data-pricenew]');
    if (pn && window.cgpPriceNew) { const c = camp(pn.dataset.pricenew); showSection('price'); window.cgpPriceNew({ id: c.id, name: c.name }); return; }
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


  // 顶部横条:告诉用户现在看的是演示还是正式数据
  function renderModeBar() {
    const bar = $('#demobar'); if (!bar) return;
    if (MODE === 'live') {
      bar.className = 'demobar demobar--live';
      bar.innerHTML = `<span class="demobar__tag">正式数据</span><span>改动按审核规则写进店铺 ${esc(S.store?.name || '')};前台要等主题改造发布后才会读这些内容。</span>
        <button class="linkbtn" id="mode-demo" type="button">临时看演示数据</button>`;
      $('#mode-demo').addEventListener('click', () => { localStorage.setItem(FORCE_DEMO, '1'); location.reload(); });
    } else if (liveSetup?.ready) {
      bar.innerHTML = `<span class="demobar__tag">演示模式</span><span>店里的内容类型已经建好,可以用正式数据了。</span>
        <button class="linkbtn" id="mode-live" type="button">切换到正式数据</button><button class="linkbtn" id="demo-reset" type="button">重置演示数据</button>`;
      $('#mode-live').addEventListener('click', () => { localStorage.removeItem(FORCE_DEMO); location.reload(); });
    }
    $('#demo-reset')?.addEventListener('click', onDemoReset);
  }
  async function onDemoReset(e) {
    const b = e.currentTarget;
    if (!b.dataset.sure) {
      b.dataset.sure = '1'; b.dataset.label = b.textContent; b.textContent = '再点一次确认重置';
      setTimeout(() => { delete b.dataset.sure; b.textContent = b.dataset.label; }, 4000); return;
    }
    delete b.dataset.sure; b.textContent = b.dataset.label;
    ord.banner = null; ord.topbar = null;
    await load(true); closeDrawer(); renderAll(); toast('演示数据已重置');
  }

  // 启动:加载共用规则 → 判断模式 → 加载数据 → 画页面
  (async () => {
    try {
      [core, A] = await Promise.all([import('./lib/schedule-core.js'), import('./lib/schedule-actions.js')]);
      await window.CGP_AUTH; // 飞书登录门(没开飞书 / 演示预览时直接放行)
      MODE = await detectMode();
      if (MODE === 'demo') await load();
      renderModeBar(); renderAll();
    } catch (e) {
      $('#ov-root').innerHTML = `<p class="muted">加载失败:${esc(e.message)}</p>`; console.error(e);
    }
  })();
})();
