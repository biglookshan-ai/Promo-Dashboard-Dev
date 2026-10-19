// 排期系统前端 —— 目前是「演示模式」:数据来自 demo-seed.json(真实 Banner / 顶栏 / 合集 / 标签 + 示例活动),
// 操作只存浏览器 localStorage,不调用任何写接口。阶段 1b 接上真实数据后替换数据层即可,界面不变。
//
// 用到 app.js / registry.js 的全局:$ $$ esc toast showSection。整个文件包在 IIFE 里,
// 避免和 registry.js 的顶层 const(svg / ICONS …)重名。
(() => {
  const DEMO_KEY = 'cgp-schedule-demo-v5'; // 数据结构变了就升版本,旧的演示数据自动作废
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
  let core = null, A = null, OD = null, SL = null; // 共用规则模块,启动时加载(OD = 合集顺序对比 / 压缩;SL = 促销链接)
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
      pins: [], salelinks: [], callouts: [],
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
    return { ...v, site: v.site || seed.site, tagCounts, collections: v.collections || [], products: v.products || [], pins: v.pins || [], salelinks: v.salelinks || [], callouts: v.callouts || [], colState: v.colState || {}, sortFlags: v.sortFlags || {} };
  }
  async function load(force) {
    if (MODE === 'live') { S = await normalizeLive(await api('GET', '/api/schedule/state')); return; }
    const raw = !force && localStorage.getItem(DEMO_KEY);
    if (raw) { S = JSON.parse(raw); S.pins ||= []; S.salelinks ||= []; S.callouts ||= []; return; }
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
        ['banners', 'topbar', 'tbstyles', 'campaigns', 'pmodules', 'pins', 'salelinks', 'callouts', 'pendingOrder', 'log'].forEach((k) => { S[k] = r.doc[k] ?? S[k]; });
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

  const all = () => [...S.campaigns, ...S.banners, ...S.topbar, ...S.tbstyles, ...(S.pmodules || []), ...(S.pins || []), ...(S.salelinks || []), ...(S.callouts || [])];
  const listOf = (k) => ({ banner: S.banners, topbar: S.topbar, tbstyle: S.tbstyles, campaign: S.campaigns, pmodule: (S.pmodules ||= []), pin: (S.pins ||= []), salelink: (S.salelinks ||= []), callout: (S.callouts ||= []) }[k]);
  const byId = (id) => all().find((x) => x.id === id);
  const camp = (id) => S.campaigns.find((c) => c.id === id);
  // 「多人协作」(飞书登录、分工、我的工作、审核流程)开没开:服务器说了算(Railway 的 TEAM_MODE),演示数据里没有 = 关。
  // 关着时打开 app 的人都是管理员:改动直接生效,不显示负责人 / 审批人 / 抄送、我的工作、成员与角色
  const team = () => !!S.lark;
  const me = () => { const u = S.staff.find((x) => x.id === S.me) || S.staff[0] || { id: '?', name: '我', role: 'editor' }; return team() ? u : { ...u, role: 'approver' }; };
  const isApprover = () => me().role === 'approver'; // 管理员
  const who = (id) => (S.staff.find((u) => u.id === id) || {}).name || '同事';
  // ---- v3 分工:每条内容的负责人 / 审批人 / 抄送 / 截止(规则在 /lib/schedule-actions.js)----
  const appr = () => ((S.settings ||= {}).approvers ||= {});
  const effAppr = (it) => A.effApprover(S, it);
  const canAppr = (it) => A.canApprove(me(), S, it);
  const canOrd = (kind) => A.canOrder(me(), S, kind);
  const apprName = (it) => { const a = effAppr(it); return a ? who(a) : '管理员'; };
  // 能被选进分工的人:正式数据 = 看得到这类内容所在页面的成员;演示 = 名单里所有人
  const PAGE_OF = { banner: 'banners', topbar: 'topbar', tbstyle: 'topbar', pmodule: 'pmodules', pin: 'pmodules', salelink: 'pmodules', callout: 'pmodules', campaign: 'campaigns' };
  const peopleFor = (kind) => S.staff.filter((u) => !u.pages || u.admin || u.pages.includes(PAGE_OF[kind]));
  const KIND = { banner: 'Banner', topbar: '顶栏', tbstyle: '顶栏样式', campaign: '活动', pmodule: '商品模块', pin: '合集置顶', salelink: '促销链接', callout: '产品页推广', price: '改价' };
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
  const badgeAt = (it, t) => { const s = status(it, t); return `<span class="stb stb--${s}"><span class="dot"></span>${ST[s]}</span>`; };
  const badge = (it) => badgeAt(it, now());
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
    return parts.join(short ? ' · ' : sep) || (short ? '无产品' : '<span class="muted">没选产品(不显示徽章;挂在下面的 Banner / 顶栏 / 促销链接照常上下线)</span>');
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
    copy: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
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
  const EFFECT = { none: '无', snow: '❄️ 飘雪', sparkle: '✨ 闪光', confetti: '🎉 彩带', leaves: '🍂 落叶', shine: '⚡ 流光' };
  // 节日模板:一键填好颜色 / 特效 / 装饰(新建样式或在编辑器里套用,填好后还能改)
  const TB_PRESETS = {
    autumn: { label: '🍂 Autumn', v: { name: 'Autumn', bg: '#6a2c0e', color: '#fff3e3', accent: '#f6b54a', effect: 'leaves', decoLeft: '🍂', decoRight: '🍁' } },
    blackfriday: { label: '⚡ Black Friday', v: { name: 'Black Friday', bg: '#0b0b0b', color: '#ffffff', accent: '#f5c518', effect: 'shine', decoLeft: '⚡', decoRight: '' } },
    christmas: { label: '🎄 圣诞', v: { name: 'Christmas', bg: '#9b1c1c', color: '#ffffff', accent: '#f5d06f', effect: 'snow', decoLeft: '🎄', decoRight: '' } },
  };
  const thumb = (url, w = 600) => (url ? `${url}${url.includes('?') ? '&' : '?'}width=${w}` : '');
  const kindChip = (k) => `<span class="kchip kchip--${k}">${KIND[k] || (k === 'system' ? '系统' : k || '')}</span>`;
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
  // 和主题 blocks/ai_gen_block_a08faac.liquid 的特效一样(数量 / 位置 / 速度同一套算法),改一边要同步另一边
  function fxHtml(effect, accent = '#f5d06f') {
    if (!effect || effect === 'none') return '';
    const n = { snow: 18, sparkle: 10, confetti: 14, leaves: 10, shine: 6 }[effect] || 0;
    const COL = ['#f5d06f', '#ff6b6b', '#4dabf7', '#69db7c', '#ffffff'];
    const LEAF = ['#f59e0b', '#ea580c', '#dc2626', '#facc15', '#c2410c'];
    const ac = /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : '#f5d06f';
    return `<span class="fx fx--${effect}" style="--fx-ac:${ac}" aria-hidden="true">${effect === 'shine' ? '<i class="fx__sweep"></i>' : ''}${Array.from({ length: n }, (_, i0) => {
      const i = i0 + 1; // 和主题的 for i in (1..n) 对齐
      // 单数放左边 0–28%,双数放右边 70–98%:中间文字那块被遮住(不挡字)
      const left = i % 2 ? (i * 11) % 29 : 70 + (i * 17) % 29, top = (i * 53 + 7) % 100, dur = 2.4 + (i % 5) * 0.7, delay = -((i * 0.61) % 2.4);
      if (effect === 'leaves') { const sz = (i % 3) * 2 + 7; return `<i style="left:${left}%;width:${sz}px;height:${sz}px;background:${LEAF[i % 5]};animation-duration:${4.2 + (i % 4) * 0.9}s;animation-delay:-${(i * 0.83) % 5}s"></i>`; }
      return `<i style="left:${left}%;top:${effect === 'sparkle' || effect === 'shine' ? top + '%' : '-8px'};animation-duration:${dur}s;animation-delay:${delay}s;${effect === 'confetti' ? `background:${COL[i % COL.length]}` : ''}"></i>`;
    }).join('')}</span>`;
  }
  // 主题里正在用的那套 Top Bar:左边社交图标、中间轮播公告、右边语言货币;底色 / 字色 / 特效跟着当前样式走
  const topbarHtml = (msg, { style = activeStyle(), id = '' } = {}) => `<div class="tbar" style="background:${esc(style.bg)};color:${esc(style.color)}">
      ${fxHtml(style.effect, style.accent)}
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
    if (x.kind === 'callout') return coImg(x) ? `<span class="mthumb mthumb--banner" style="background-image:url('${esc(thumb(coImg(x), 80))}')"></span>` : '<span class="mthumb mthumb--tb">💡</span>';
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

  // ================= 时间线(共用) =================
  // 把「所有内容的上下线时刻」排成一条可点的时间线,代替原来的「看哪天」下拉。
  // kinds 决定看哪些类型的变化;点一个时刻 = 看那一刻网站长什么样。
  function tlPoints(kinds) {
    const t = now(); const map = new Map();
    for (const x of all()) {
      if (!kinds.includes(x.kind) || x.isDefault || x.state !== 'approved' || x.paused) continue;
      const w = win(x);
      for (const [at, up] of [[w.start, true], [w.end, false]]) {
        if (at == null || at <= t || at > t + 120 * DAY) continue;
        if (!map.has(at)) map.set(at, { at, ups: [], downs: [] });
        map.get(at)[up ? 'ups' : 'downs'].push(x);
      }
    }
    return [...map.values()].sort((a, b) => a.at - b.at);
  }
  // id = 这条时间线的名字(每个页面一条);at = 现在看的时刻(null = 此刻)
  function tlHtml(id, points, at) {
    const idx = at == null ? -1 : points.findIndex((p) => p.at === at);
    const dot = (label, sub, v, on, n) => `<button class="tl__dot ${on ? 'is-on' : ''}" type="button" data-tl="${id}" data-at="${v}">
      <span class="tl__lab">${label}</span><span class="tl__pin"></span><span class="tl__sub">${sub}</span>${n ? `<span class="tl__n">${n}</span>` : ''}</button>`;
    return `<div class="tl">
      <button class="btn btn-sm btn-ghost" type="button" data-tlnav="${id}" data-d="-1" ${idx <= -1 ? 'disabled' : ''}>${I.left}</button>
      <div class="tl__rail">
        ${dot('现在', fMD(now()), 'now', at == null, 0)}
        ${points.map((p) => dot(fMD(p.at), fmt(p.at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), p.at, at === p.at, p.ups.length + p.downs.length)).join('')
          || '<span class="muted tl__none">接下来 120 天没有变化</span>'}
      </div>
      <button class="btn btn-sm btn-ghost" type="button" data-tlnav="${id}" data-d="1" ${points.length && idx < points.length - 1 ? '' : 'disabled'}>${I.right}</button>
    </div>`;
  }
  function tlChanges(points, at) {
    const p = points.find((x) => x.at === at); if (!p) return '';
    const one = (x, up) => `<button class="snapchg__i" type="button" data-open="${x.id}" data-pop="${x.id}"><span class="snapchg__a snapchg__a--${up ? 'up' : 'down'}">${up ? '上线' : '下线'}</span>${kindChip(x.kind)} ${esc(titleOf(x))}</button>`;
    return `<div class="snapchg">这一刻:${p.ups.map((x) => one(x, true)).join('')}${p.downs.map((x) => one(x, false)).join('')}</div>`;
  }
  // 点时间线 / 前后翻(各页共用);setter 负责存到各自的变量里并重画
  function wireTimeline(id, points, get, set) {
    $$(`[data-tl="${id}"]`).forEach((b) => b.addEventListener('click', () => set(b.dataset.at === 'now' ? null : +b.dataset.at)));
    $$(`[data-tlnav="${id}"]`).forEach((b) => b.addEventListener('click', () => {
      const cur = get(); const i = cur == null ? -1 : points.findIndex((p) => p.at === cur);
      const j = i + Number(b.dataset.d);
      set(j < 0 ? null : (points[Math.min(j, points.length - 1)]?.at ?? null));
    }));
  }

  // ================= 首页预览(总览里的「首页长什么样」:此刻 / 未来某个时间点) =================
  let pvAt = null;      // 看哪个时刻(null = 现在)
  let pvModTab = { sale: 0, feature: 0 }; // 预览里各模块看哪个页签
  const PV_KINDS = ['banner', 'topbar', 'tbstyle', 'pmodule', 'pin'];
  function renderPreview() {
    const T = pvAt ?? now();
    const points = tlPoints(PV_KINDS);
    const style = activeStyle(T);
    const msgs = S.topbar.filter((x) => status(x, T) === 'live').sort(byOrder);
    const bns = S.banners.filter((b) => status(b, T) === 'live').sort(byOrder);
    const mods = ['sale', 'feature'].map((m) => ({ m, v: activeVersion(m, T) })).filter((x) => x.v);
    const pins = (S.pins || []).filter((p) => status(p, T) === 'live');
    const root = $('#pv-root'); if (!root) return;
    root.innerHTML = `
      <section class="panel">
        <div class="panel__h"><h3>首页长什么样</h3><span class="muted">默认是现在;点时间点看那一刻顾客会看到的顶栏、Banner 轮播和首页商品模块</span></div>
        ${tlHtml('pv', points, pvAt)}
        ${tlChanges(points, pvAt)}
        <div class="pvwrap">
          <div class="pvsite">
            ${msgs.length ? topbarHtml(msgs.map((m) => tbMsg(m, style)).join(''), { style }) : '<div class="snapnone">这一刻顶栏没有公告</div>'}
            <div class="pvsite__b">
              ${bns.length ? `<div class="pvbns">${bns.map((b, i) => `<span class="pvbn" data-open="${b.id}" data-pop="${b.id}" title="${esc(titleOf(b))}"><span class="pvbn__n">${i + 1}</span>${slideHtml(b, { w: 430 })}</span>`).join('')}</div>`
                : '<div class="snapnone">这一刻首页轮播没有排期 Banner(前台会显示主题里原来的 slide)</div>'}
              ${mods.map(({ m, v }) => `<div class="pvmod">
                <div class="pvmod__h">${MODULE_CN[m]}${v.isDefault ? '<span class="tag">平时版本</span>' : `<span class="tag tag--accent">排期版本:${esc(v.name)}</span>`}
                  <button class="linkbtn" data-open="${v.id}" type="button">去编辑</button></div>
                ${moduleHtml(v, { activeTab: Math.min(pvModTab[m] || 0, (v.tabs || []).length - 1), pm: m, at: T })}</div>`).join('')}
            </div>
          </div>
          <aside class="pvside">
            <div class="pvside__t">这一刻在生效的</div>
            <div class="pvside__g"><span>顶栏样式</span><b>${esc(style.name || '默认样式')}</b></div>
            <div class="pvside__g"><span>顶栏公告</span><b>${msgs.length} 条</b>${msgs.map((m) => `<button class="pvside__i" data-open="${m.id}" type="button">${esc(titleOf(m))}</button>`).join('') || '<span class="muted">无</span>'}</div>
            <div class="pvside__g"><span>Banner</span><b>${bns.length} 张</b></div>
            ${mods.map(({ m, v }) => `<div class="pvside__g"><span>${MODULE_CN[m]}</span><b>${esc(v.name || '平时版本')}</b><span class="muted">${(v.tabs || []).map((t) => esc(tabLabel(t))).join(' · ')}</span></div>`).join('')}
            <div class="pvside__g"><span>合集置顶</span>${pins.length ? pins.map((p) => `<button class="pvside__i" data-open="${p.id}" type="button">${esc(p.collection?.title || titleOf(p))}:${(p.products || []).length} 个${p.onlyListed ? '(只显示这些)' : ''}</button>`).join('') : '<span class="muted">无</span>'}</div>
          </aside>
        </div>
        <p class="muted">这里画的是 app 排期的部分。顾客实际看到的还有主题里固定的区块(导航、Top Categories 等),那些不归这里管。</p>
      </section>`;
    wireTimeline('pv', points, () => pvAt, (v) => { pvAt = v; renderPreview(); });
    // 商品模块:取真实产品(正式数据)
    for (const { m, v } of mods) {
      const t = (v.tabs || [])[pvModTab[m] || 0];
      if (t) loadTabPreview(t, () => { if ($('#pv-root') && isActive('overview')) renderPreview(); });
    }
    $$('#pv-root [data-pmtab]').forEach((el) => el.addEventListener('click', () => {
      const wrap = el.closest('[data-pm]'); const m = wrap?.dataset.pm; if (!m) return;
      pvModTab[m] = +el.dataset.pmtab; renderPreview();
    }));
  }
  const isActive = (name) => !!document.getElementById('section-' + name)?.classList.contains('is-active');

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
      ${pageHead('总览', '网站现在长什么样、接下来会发生什么')}
      <div class="stats">
        ${stat(liveN, '上线中', 'stat--ok', 'banners')}
        ${stat(soonN, '7 天内上线', '', 'overview')}
        ${stat(endN, '7 天内到期', endN ? 'stat--warn' : '', 'overview')}
        ${team() || pendN ? stat(pendN, '待审核', pendN ? 'stat--danger' : '', 'reviews') : ''}
      </div>
      ${alertsHtml(['banner', 'topbar', 'campaign', 'tbstyle', 'pmodule'])}
      <div id="pv-root"></div>
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
    renderPreview(); // 首页预览(原来单独的「预览」页)画在总览里
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
  const bnF = { st: 'live', tag: '', at: null };
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
    const T = bnF.at ?? now();
    const list = editing ? ord.banner.map((id) => S.banners.find((b) => b.id === id)).filter(Boolean) : ordPipeline('banner');
    const points = tlPoints(['banner']);
    const pend = S.pendingOrder && S.pendingOrder.kind === 'banner';
    $('#bn-order').innerHTML = `
      <div class="panel__h">
        <h3>${editing ? '调整轮播顺序' : '首页轮播顺序'}</h3>
        <span class="muted">${editing ? '拖动卡片换位置,点「保存顺序」才生效'
          : `看哪一刻:<b>${bnF.at == null ? '现在' : `${fDT(T)} · ${relDay(T)}`}</b>`}
          ${editing ? `<button class="btn btn-sm" data-ordact="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-ordact="save" type="button">${canOrd('banner') ? '保存顺序' : '提交顺序审核'}</button>`
            : `<button class="btn btn-sm" data-ordact="edit" type="button" ${pend ? 'disabled' : ''}>${I.sort}调整顺序</button>`}</span>
      </div>
      ${editing ? '' : tlHtml('bn', points, bnF.at) + tlChanges(points, bnF.at)}
      ${pend ? `<div class="note note--warn">${esc(who(S.pendingOrder.by))} 提交了新的轮播顺序,等审核中;批准前前台保持现在的顺序。</div>` : ''}
      <p class="muted oc__help">数字 = 在首页轮播里的位置;<b>→5</b> = 上线后会排第 5 张。淡色的是这一刻还没上线的,它们已经排好了位置,到点自动插进去。</p>
      <div class="ocs ${editing ? 'ocs--edit' : ''}" id="bn-ocs">${list.map((b) => orderCard(b, T, list, editing, bnF.at == null)).join('') || '<span class="muted">没有上线中或已排期的 Banner</span>'}</div>`;
    if (!editing) wireTimeline('bn', points, () => bnF.at, (v) => { bnF.at = v; renderBannerOrder(); });
    $$('#bn-order [data-ordact]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.ordact;
      if (a === 'edit') { ord.banner = ordPipeline('banner').map((x) => x.id); bnF.at = null; renderBannerOrder(); }
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
  let tbAt = null; let tbTimer = null; let tbIdx = 0; const tbF = { st: 'live' };
  function renderTopbar() {
    const at = tbAt ?? now();
    const points = tlPoints(['topbar', 'tbstyle']);
    const liveAt = S.topbar.filter((t) => status(t, at) === 'live').sort(byOrder);
    const styleAt = activeStyle(at);
    const editing = !!ord.topbar;
    const rows = editing ? ord.topbar.map((id) => S.topbar.find((t) => t.id === id)).filter(Boolean) : S.topbar.filter((t) => inTab(t, tbF.st)).sort(byStatusThenOrder);
    const styles = [...S.tbstyles].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || byStatusThenOrder(a, b));
    const pend = S.pendingOrder && S.pendingOrder.kind === 'topbar';
    $('#tb-root').innerHTML = `
      ${pageHead('顶栏公告', '网站最上方轮播的一行字。公告和「样式」分开管:公告决定说什么,样式决定长什么样(节日可以自动换装)。',
        `<button class="btn" data-new="tbstyle" type="button">${I.plus}新建样式</button><button class="btn btn-primary" data-new="topbar" type="button">${I.plus}新建公告</button>`)}
      ${alertsHtml(['topbar', 'tbstyle'])}
      <section class="panel">
        <div class="panel__h"><h3>预览顶栏</h3>
          <span class="muted">看哪一刻:<b>${tbAt == null ? '现在' : `${fDT(at)} · ${relDay(at)}`}</b>
            <button class="btn btn-sm btn-ghost" id="tb-prev" type="button" aria-label="上一条">${I.left}</button><button class="btn btn-sm btn-ghost" id="tb-next" type="button" aria-label="下一条">${I.right}</button></span></div>
        ${tlHtml('tb', points, tbAt)}
        ${tlChanges(points, tbAt)}
        ${topbarHtml('', { style: styleAt, id: 'tb-msg' })}
        <p class="muted tbpv__note">这一刻用 <b>${esc(styleAt.name || '默认样式')}</b> 样式,轮播 <b>${liveAt.length}</b> 条(下面是每一条的完整内容,前台按这个顺序轮着显示)</p>
        <div class="tbnow">${liveAt.map((t, i) => `<button class="tbnow__i" type="button" data-open="${t.id}" data-pop="${t.id}">
          <span class="tbnow__n">${i + 1}</span>
          <span class="tbnow__bar" style="background:${esc(styleAt.bg)};color:${esc(styleAt.color)}">${tbMsg(t, styleAt)}</span>
          <span class="tbnow__m"><span class="kchip">${esc(t.category || '')}</span>${I.clock}${esc(winText(t))}${t.link ? ` · <span class="mono">${esc(t.link)}</span>` : ''}</span>
        </button>`).join('') || '<span class="muted">这一刻没有公告</span>'}</div>
        <div class="tbnow__style">这一刻的样式:<b>${esc(styleAt.name || '默认样式')}</b> · 底色 <span class="mono">${esc(styleAt.bg)}</span> · 文字 <span class="mono">${esc(styleAt.color)}</span>${styleAt.effect && styleAt.effect !== 'none' ? ` · 特效 ${esc(EFFECT[styleAt.effect] || styleAt.effect)}` : ''}${styleAt.decoLeft || styleAt.decoRight ? ` · 装饰 ${esc(styleAt.decoLeft || '')}${esc(styleAt.decoRight || '')}` : ''}
          ${styleAt.id ? `<button class="linkbtn" data-open="${styleAt.id}" type="button">去编辑样式</button>` : ''}</div>
      </section>
      <section class="panel">
        <div class="panel__h"><h3>样式(节日主题)</h3><span class="muted">到了时间自动换装,结束后回到默认样式;同时有多个时,优先级高的生效</span></div>
        <div class="tbpresets"><span class="muted">用节日模板新建:</span>${Object.entries(TB_PRESETS).map(([k, x]) => `<button class="tbpreset" type="button" data-new="tbstyle" data-tbpreset="${k}"><span class="tbpreset__bar" style="background:${x.v.bg};color:${x.v.color}">${fxHtml(x.v.effect, x.v.accent)}<span>${x.v.decoLeft} Aa ${x.v.decoRight}</span></span><b>${x.label}</b></button>`).join('')}</div>
        <div class="tbstyles">${styles.map((x) => `<button class="tbs" data-open="${x.id}" data-pop="${x.id}" type="button">
          <span class="tbs__bar" style="background:${esc(x.bg)};color:${esc(x.color)}">${fxHtml(x.effect, x.accent)}<span>${esc(x.decoLeft || '')} Aa ${esc(x.decoRight || '')}</span></span>
          <span class="tbs__b"><b>${esc(x.name)}</b>${x.isDefault ? '<span class="tag">默认</span>' : badge(x)}</span>
          <span class="tbs__w">${x.isDefault ? '没有其他样式生效时使用' : winText(x)}</span>
        </button>`).join('')}</div>
      </section>
      <div class="fbar"><div class="ftabs">${editing ? '<b class="fbar__t">调整轮播顺序</b>' : tabsHtml(S.topbar, tbF.st)}</div>
        <span class="muted">${editing ? `拖动左侧把手换位置,点「保存顺序」才生效 <button class="btn btn-sm" data-tbord="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-tbord="save" type="button">${canOrd('topbar') ? '保存顺序' : '提交顺序审核'}</button>`
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
    wireTimeline('tb', points, () => tbAt, (v) => { tbAt = v; renderTopbar(); });
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
  // 一个活动下面所有「网站要更新的东西」:网站内容(Banner / 顶栏 / 首页模块 / 合集置顶)+ 改价;具体要求和分工在关联的飞书任务里
  let cpHub = null; // 正在看的活动 id
  const openHub = (id) => { cpHub = id; hubPrice.at = 0; showSection('campaigns'); renderCampaigns(); window.scrollTo(0, 0); };
  let hubPrice = { plans: null, err: '', at: 0 };
  async function loadHubPrice() {
    if (MODE !== 'live' || !(window.cgpCanSee && window.cgpCanSee('price'))) { hubPrice = { plans: null, err: '', at: now() }; return; }
    try { hubPrice = { plans: (await api('GET', '/api/price/state')).plans, err: '', at: now() }; }
    catch (e) { hubPrice = { plans: null, err: e.message, at: now() }; }
    if (cpHub) renderCampaigns();
  }
  const PLAN_ST = { draft: '草稿', pending: '待审核', rejected: '被退回', scheduled: '已排期', running: '进行中', paused: '暂停中', ended: '已结束', done: '已完成' };
  function hubRow(x) {
    const pic = x.kind === 'banner' ? `<span class="hrow__slide">${slideHtml(x, { w: 160 })}</span>` : `<span class="hrow__ico">${kindChip(x.kind)}</span>`;
    const chipInPic = x.kind !== 'banner';
    const when = win(x).via ? '跟随活动时间' : winText(x); // 活动页里不用再重复活动名和日期
    return `<button class="hrow" type="button" data-open="${x.id}">${pic}<span class="hrow__b"><span class="hrow__t">${chipInPic ? '' : kindChip(x.kind) + ' '}${esc(titleOf(x))}</span><span class="hrow__s">${when}</span></span>${badge(x)}</button>`;
  }

  // ---- 一致性检查:文案折扣 vs 实际改价、各项时间 vs 活动时间、快开始了还没批准 ----
  const pctClaims = (text) => {
    const t = String(text || '');
    const out = [];
    for (const m of t.matchAll(/up\s*to\s*(\d{1,2})\s*%/gi)) out.push({ pct: +m[1], upTo: true });
    for (const m of t.matchAll(/(\d{1,2})\s*%\s*off/gi)) if (!out.some((x) => x.pct === +m[1])) out.push({ pct: +m[1], upTo: false });
    for (const m of t.matchAll(/(\d)(?:\.\d)?\s*折/g)) out.push({ pct: 100 - +m[1] * 10, upTo: false });
    return out;
  };
  const textsOf = (x) => (x.kind === 'banner' ? [x.title, x.subtitle, x.description] : x.kind === 'topbar' ? [x.text] : x.kind === 'pmodule' ? [x.title, x.title2] : []).join(' ');
  const HOUR = 3600000;
  const relSpan = (ms) => (ms >= DAY ? `${Math.round(ms / DAY)} 天` : `${Math.max(1, Math.round(ms / HOUR))} 小时`);
  function consistencyChecks(c, plans) {
    const out = [];
    const content = ['banner', 'topbar', 'pmodule', 'pin'].flatMap((k) => listOf(k).filter((x) => x.campaign === c.id));
    const livePlans = (plans || []).filter((p) => ['approved', 'pending'].includes(p.state) && !p.stopped);
    const maxOff = livePlans.reduce((m, p) => Math.max(m, ...p.slots.flatMap((s) => s.items.filter((i) => i.price != null).map((i) => Math.round((1 - Number(i.price) / Number(i.refPrice)) * 100)))), 0);
    for (const x of plans === undefined ? [] : content) { // undefined = 改价数据还在加载
      for (const cl of pctClaims(textsOf(x))) {
        const name = `${KIND[x.kind]}「${titleOf(x)}」`;
        if (plans == null) { out.push({ level: 'info', id: x.id, text: `${name}写了 ${cl.pct}%,你没有改价页权限,没法核对实际折扣` }); continue; }
        if (!livePlans.length) { out.push({ level: 'warn', id: x.id, text: `${name}写了 ${cl.pct}%${cl.upTo ? '(up to)' : ' off'},但这个活动还没有改价计划` }); continue; }
        if (maxOff < cl.pct - 1) out.push({ level: 'warn', id: x.id, text: `${name}写${cl.upTo ? ' up to' : ''} ${cl.pct}%,但本活动改价最多只降 ${maxOff}%` });
        else if (cl.upTo && maxOff > cl.pct + 5) out.push({ level: 'info', id: x.id, text: `${name}写 up to ${cl.pct}%,实际最多降 ${maxOff}%,文案可以写得更吸引人` });
      }
    }
    const cs = c.start, ce = c.end;
    for (const x of content) {
      if (x.start == null && x.end == null) continue; // 跟随活动时间
      const name = `${KIND[x.kind]}「${titleOf(x)}」`;
      if (cs != null && x.start != null && x.start < cs - HOUR) out.push({ level: 'warn', id: x.id, text: `${name}比活动早 ${relSpan(cs - x.start)}上线(${fDT(x.start)})` });
      if (ce != null && (x.end == null || x.end > ce + HOUR)) out.push({ level: 'warn', id: x.id, text: `${name}${x.end == null ? '没设结束时间,活动结束后还会一直显示' : `比活动晚 ${relSpan(x.end - ce)}下线(${fDT(x.end)})`}` });
    }
    for (const p of livePlans) {
      if (p.kind !== 'window' || p.followCampaign) continue; // 跟随活动时间的本来就一致
      const ps = Math.min(...p.slots.map((s) => s.start)), pe = Math.max(...p.slots.map((s) => s.end));
      if (cs != null && Math.abs(ps - cs) > HOUR) out.push({ level: 'warn', price: p.id, text: `改价「${p.name}」${ps < cs ? '比活动早' : '比活动晚'} ${relSpan(Math.abs(ps - cs))}开始:${ps < cs ? '价格先降了,网站内容还没上' : '网站内容上了,价格还没降'}` });
      if (ce != null && Math.abs(pe - ce) > HOUR) out.push({ level: 'warn', price: p.id, text: `改价「${p.name}」${pe > ce ? '比活动晚' : '比活动早'} ${relSpan(Math.abs(pe - ce))}结束` });
    }
    if (cs != null && cs > now() && cs - now() < 2 * DAY) {
      const notYet = content.filter((x) => x.state !== 'approved').length + livePlans.filter((p) => p.state !== 'approved').length;
      if (notYet) out.push({ level: 'warn', text: team() ? `活动 ${relSpan(cs - now())}后开始,还有 ${notYet} 项没批准` : `活动 ${relSpan(cs - now())}后开始,还有 ${notYet} 项是草稿(没保存生效)` });
    }
    return out;
  }
  // 关联的飞书任务:链接 + 名字(任务状态在接好飞书任务权限后显示)
  const larkTaskGuid = (url) => (String(url).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0] || '';
  // 活动页:① 活动设置(时间 / 产品 / 产品上显示什么,一眼看清)→ ② 需要留意(有问题才出现)→ ③ 网站内容(按类型分组)→ ④ 改价 → ⑤ 飞书任务
  const HUB_KINDS = [['banner', 'Banner'], ['topbar', '顶栏公告'], ['tbstyle', '顶栏样式'], ['pmodule', '首页商品模块'], ['pin', '合集置顶'], ['salelink', '促销链接'], ['callout', '产品页推广']];
  const dhm = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h ${m % 60}m`; };
  // 徽章点了去哪(活动的 badgeLink):'' 自动 / 'none' 不能点 / 链接
  const blMode = (v) => (v === 'none' ? 'none' : v ? 'url' : '');
  const BL_OPTS = [['', '自动(促销链接 / 参加的第一个合集)'], ['url', '指定链接'], ['none', '不能点']];
  const blSelect = (v, attrs) => `<select class="sel sel--sm" ${attrs}>${BL_OPTS.map(([k, l]) => `<option value="${k}" ${blMode(v) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  // 活动下的促销链接(2026-10-19 起自动算参加:主题判断产品出现在这个活动的某条进行中的促销链接里 → 显示徽章)
  const campLinks = (c) => (S.salelinks || []).filter((x) => x.campaign === c.id && x.collection?.id);
  function slCoverHtml(c) {
    const links = campLinks(c); if (!links.length) return '';
    const live = links.filter((x) => status(x) === 'live');
    const noScope = !(c.collections?.length || c.tags?.length || c.products?.length);
    return `<span class="hubset__cover"><span>${noScope ? '' : '另外,'}<b>${links.length}</b> 条促销链接里的产品自动带上${live.length < links.length ? `(现在进行中 ${live.length} 条)` : ''}:
      顾客打开链接会看到的产品(打折的,按每条链接的有货 / 最低折扣条件)都显示这个活动的徽章,点徽章去那条链接。加、改、删促销链接马上跟着变。</span></span>`;
  }
  function hubSettingsHtml(c) {
    const w = win(c); const t = now(); const s = status(c); const st = scopeTotal(c);
    const noScope = !(c.collections?.length || c.tags?.length || c.products?.length);
    const span = w.start != null && w.end != null ? `共 ${relSpan(w.end - w.start)}` : '没有结束时间';
    const left = s === 'live' ? (w.end != null ? `还剩 ${relSpan(w.end - t)}` : '进行中') : w.start != null && w.start > t ? `${relSpan(w.start - t)}后开始` : s === 'ended' ? '已结束' : '';
    const cd = cdOf(c);
    const cdText = w.end != null ? dhm(w.end - Math.max(t, w.start ?? t)) : '';
    const hasProducts = !noScope || campLinks(c).length;
    const shows = !hasProducts ? '<span class="muted">没选产品,产品上不显示</span>' : c.badge || (c.countdown && w.end != null)
      ? `<div class="hubset__pv">${cdPdpHtml(c, c.badge, c.countdown && w.end != null ? `hubcd-${c.id}` : null, cdText)}</div>`
      : '<span class="muted">徽章和倒计时都关着</span>';
    // 常用设置直接在这里改,改了马上保存(2026-10-19 用户:要打开活动设置才看得到有没有开徽章 / 倒计时)
    const quick = `<div class="qset" data-qcamp="${c.id}">
      <label class="qset__r"><span>徽章文字</span><input class="inp inp--sm" data-q="badge" value="${esc(c.badge || '')}" placeholder="留空 = 不显示徽章" maxlength="40"/></label>
      <div class="qset__r"><span>点了去</span>${blSelect(c.badgeLink, 'data-q="blmode"')}
        <input class="inp inp--sm mono" data-q="blurl" value="${esc(blMode(c.badgeLink) === 'url' ? c.badgeLink : '')}" placeholder="/collections/dzofilm?view=bfcm-dzo" ${blMode(c.badgeLink) === 'url' ? '' : 'hidden'}/></div>
      <label class="qset__r qset__ck"><span>倒计时</span><span class="tgl tgl--sm"><input type="checkbox" data-q="countdown" ${c.countdown ? 'checked' : ''}/><span class="tgl__ui"></span><span class="muted">${c.countdown ? '开着' : '关着'}${c.countdown && w.end == null ? '(活动没有结束时间,不会显示)' : ''}</span></span></label>
      <div class="qset__r"><span>样式</span><div class="seg seg--sm">${Object.entries(CD_STY).map(([k, x]) => `<button type="button" data-qsty="${k}" class="${cd.key === k ? 'is-active' : ''}">${x.name}</button>`).join('')}</div></div>
      <label class="qset__r"><span>优先级</span><input class="inp inp--sm inp--num" type="number" data-q="priority" value="${esc(c.priority ?? 0)}"/><span class="muted">同一产品在几个活动里时,大的显示</span></label>
    </div>`;
    const item = (k, main, sub, extra = '') => `<div class="hubset__i"><span class="hubset__k">${k}</span>${main}${sub ? `<span class="muted hubset__s">${sub}</span>` : ''}${extra}</div>`;
    return `<section class="panel hubset">
      <div class="panel__h"><h3>活动设置</h3><button class="btn btn-primary btn-sm" type="button" data-open="${c.id}">修改活动设置</button></div>
      <div class="hubset__g">
        ${item('时间', `<b>${w.start != null ? fDT(w.start) : '立即'} → ${w.end != null ? fDT(w.end) : '不结束'}</b>`, `${span}${left ? ' · ' + left : ''}`)}
        ${item('参加的产品', `<b>${noScope ? (campLinks(c).length ? '促销链接里的产品' : '没选产品') : `${st.total}${st.unknown ? '+' : ''} 个产品`}</b>`, `${noScope ? (campLinks(c).length ? '没另外选合集 / 标签 / 产品' : '参加的产品 = 显示活动徽章和倒计时的产品') : campScope(c, false, '<br>')}${slCoverHtml(c)}`)}
        ${item('产品上显示', shows, '', `${quick}<span class="qset__hint">改了马上保存${c.state === 'approved' ? ',网站马上生效' : '(活动还是草稿,批准后才上网站)'};颜色、倒计时文案在「修改活动设置」里</span>`)}
      </div>
    </section>`;
  }
  function hubHtml(c) {
    const mine = (k) => listOf(k).filter((x) => x.campaign === c.id);
    const content = HUB_KINDS.flatMap(([k]) => mine(k));
    const canPrice = MODE === 'live' && window.cgpCanSee && window.cgpCanSee('price');
    const plans = (hubPrice.plans || []).filter((p) => p.campaign?.id === c.id);
    const add = (kind, label) => `<button type="button" class="btn btn-sm" data-new="${kind}" data-for="${c.id}">${I.plus}${label}</button>`;
    const needType = (flag, label) => `<button type="button" class="btn btn-sm" data-go="settings" title="先到「设置 → 店铺连接」点「在店里创建内容类型」补建">${label}(要先补建内容类型)</button>`;
    const adds = add('banner', 'Banner') + add('topbar', '顶栏公告') + add('tbstyle', '顶栏样式') + add('pmodule', '首页商品模块')
      + (MODE === 'live' && S.setup && S.setup.pinReady === false ? needType('pin', '合集置顶') : add('pin', '合集置顶'))
      + (MODE === 'live' && S.setup && S.setup.slReady === false ? needType('salelink', '促销链接') : add('salelink', '促销链接'))
      + (MODE === 'live' && S.setup && S.setup.coReady === false ? needType('callout', '产品页推广') : add('callout', '产品页推广'));
    const groups = HUB_KINDS.map(([k, label]) => { const list = mine(k); return list.length
      ? `<div class="hgrp"><div class="hgrp__h">${label}<span class="muted">${list.length}</span></div><div class="hrows">${list.map(hubRow).join('')}</div></div>` : ''; }).join('');
    const priceRows = plans.map((p) => `<button class="hrow" type="button" data-price="${p.id}"><span class="hrow__ico">${kindChip('price')}</span><span class="hrow__b"><span class="hrow__t">${esc(p.name)}</span>
      <span class="hrow__s">${p.kind === 'permanent' ? '永久调价' : '限时'} · ${new Set(p.slots.flatMap((s) => s.items.map((i) => i.productId))).size} 个产品 · ${fDT(Math.min(...p.slots.map((s) => s.start)))}</span></span><span class="tag">${PLAN_ST[p.state === 'approved' ? 'scheduled' : p.state] || p.state}</span></button>`).join('');
    // 审批进度:只在「多人协作」开着时有意义
    let prog = '';
    if (team()) {
      const done = content.filter((x) => x.state === 'approved').length + plans.filter((p) => p.state === 'approved').length;
      const total = content.length + plans.length;
      const waiting = content.filter((x) => x.state === 'pending' || x.pendingChange).length + plans.filter((p) => p.state === 'pending' || p.pendingChange).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      prog = total ? `<div class="hubprog"><div class="hubprog__bar"><span style="width:${pct}%"></span></div>
        <div class="hubprog__n"><b>${done}</b> / ${total} 项已批准(${pct}%)${waiting ? ` · <span class="tx-warn">${waiting} 项等审批</span>` : ''}</div></div>` : '';
    }
    const checks = consistencyChecks(c, canPrice ? (hubPrice.plans || undefined) : null);
    const links = c.larkLinks || [];
    return `
      <button class="btn btn-ghost btn-back" type="button" data-hubback>← 全部活动</button>
      <div class="hubhead">
        <div><h2>${esc(c.name)} ${badge(c)}</h2>${endingTag(c)}${syncTag(c)}</div>
      </div>
      ${prog}
      ${hubSettingsHtml(c)}
      ${checks.length ? `<section class="panel hubsec hubsec--warn"><div class="panel__h"><h3>⚠️ 需要留意</h3><span class="muted">文案里的折扣对不上实际改价、时间和活动不一致</span></div>
        <div class="hchecks">${checks.map((x) => `<div class="hcheck hcheck--${x.level}">${x.level === 'warn' ? '⚠️' : 'ℹ️'} <span>${esc(x.text)}</span>${x.id ? `<button type="button" class="linkbtn" data-open="${x.id}">去改</button>` : x.price ? `<button type="button" class="linkbtn" data-price="${x.price}">去改</button>` : ''}</div>`).join('')}</div></section>` : ''}
      <section class="panel hubsec"><div class="panel__h"><h3>网站上跟着活动变的</h3><span class="muted">跟随活动时间的:活动开始自动上线、结束自动下线</span></div>
        ${groups || '<p class="muted">还没有。活动期间想让首页 Banner、顶栏、首页商品模块、合集排序也跟着换,就在下面加。</p>'}
        <div class="hubsec__add">${adds}</div></section>
      <section class="panel hubsec"><div class="panel__h"><h3>改价</h3><span class="muted">${canPrice ? '到点自动改价、到期自动恢复' : '改价信息保密,只有定价同事和管理员能看'}</span></div>
        <div class="hrows">${canPrice ? priceRows || `<p class="muted">${hubPrice.err ? esc(hubPrice.err) : hubPrice.plans ? '还没有改价计划' : '加载中…'}</p>` : '<p class="muted">你没有改价页的权限</p>'}</div>
        ${canPrice ? `<div class="hubsec__add"><button type="button" class="btn btn-sm" data-pricenew="${c.id}">${I.plus}改价计划</button></div>` : ''}</section>
      <section class="panel hubsec"><div class="panel__h"><h3>关联的飞书任务</h3><span class="muted">具体要求、设计、文案放在飞书任务里</span></div>
        ${links.length ? `<div class="larklinks">${links.map((l) => `<a class="larklink" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="larklink__ico">✓</span><span class="larklink__b"><b>${esc(l.label || '飞书任务')}</b><span class="muted">${/task_?list|tasklist/i.test(l.url) ? '任务清单' : '任务'}${larkTaskGuid(l.url) ? '' : ' · 链接里没找到任务编号'}</span></span><span class="larklink__go">↗</span></a>`).join('')}</div>`
          : `<p class="muted">还没关联(可不填)。<button type="button" class="linkbtn" data-open="${c.id}">在活动设置里贴飞书任务链接</button></p>`}</section>`;
  }

  // ================= 促销链接(合集 ?onsale=<后缀>)=================
  // 规则在 /lib/sale-link.js,和主题 cgp-search-app.js 的 SALE 一样。不保存也能用:/collections/<合集>?onsale = 这个合集里所有打折的产品
  let sl = null; // 编辑中的:{ collection, products(置顶)}
  const slPrev = {}; // 合集 handle → 前台数据(两分钟内不重复读)
  const slUrl = (x) => (x.collection?.handle ? SL.saleUrl(S.store?.domain || 'https://www.cinegearpro.co.uk', x.collection.handle, x.slug, x.view) : '');
  // 各主题里的合集模板(?view= 能填的名字),编辑器里提示「正式主题有没有」
  let slTpl = null;
  async function slLoadTpl() {
    if (slTpl || MODE !== 'live') return;
    slTpl = { busy: true };
    try { slTpl = await api('GET', '/api/schedule/collection-templates'); } catch (e) { slTpl = { error: e.message, themes: [] }; }
    redrawSlView();
  }
  function redrawSlView() {
    const dl = $('#sl-views'); const info = $('#sl-viewinfo'); if (!dl || !info) return;
    const themes = slTpl?.themes || [];
    const main = themes.find((t) => t.role === 'MAIN');
    const names = [...new Set(themes.flatMap((t) => t.templates))].sort((a, b) => (a === 'sale' ? -1 : b === 'sale' ? 1 : a.localeCompare(b)));
    dl.innerHTML = names.map((n) => `<option value="${esc(n)}">${main?.templates.includes(n) ? '正式主题有' : '只在未发布的主题里'}</option>`).join('');
    const v = String($('#ed-form [name="view"]')?.value || '').trim();
    if (!v) { info.innerHTML = '留空 = 用这个合集原来的版面。促销页模板叫 <b class="mono">sale</b>(在主题编辑器里排版)'; return; }
    const slug = String($('#ed-form [name="slug"]')?.value || '').trim().toLowerCase();
    const bound = SL.viewBound(slug, v) ? '<br>🔗 后缀和模板名一样,链接只要 <b class="mono">?view=' + esc(v) + '</b>' : SL.SLUG_RE.test(SL.slugOf(v)) && SL.slugOf(v) === v.toLowerCase() ? `<br>想要短链接(只写 ?view=${esc(v)}):把后缀改成 <b class="mono">${esc(v.toLowerCase())}</b> <button type="button" class="btn btn-sm" data-sl="slugview">改成一样</button>` : '';
    if (MODE !== 'live' || !slTpl || slTpl.busy) { info.innerHTML = bound.replace(/^<br>/, ''); return; }
    const inMain = main?.templates.includes(v); const others = themes.filter((t) => t.role !== 'MAIN' && t.templates.includes(v)).map((t) => t.name);
    info.innerHTML = (inMain ? `✅ 正式主题「${esc(main.name)}」里有这个模板`
      : others.length ? `<span class="tag tag--warn">⚠️ 只在「${esc(others.join('、'))}」里,正式主题还没有 —— 顾客打开会看到默认的合集页</span>`
        : '<span class="tag tag--danger">⚠️ 主题里找不到这个模板,顾客打开会看到默认的合集页</span>') + bound;
  }
  const SORT_LABEL = () => Object.fromEntries(SL.SALE_SORTS);
  function slTags(x) {
    const t = [];
    if (x.inStock) t.push('只显示有货');
    if (x.minDiscount) t.push(`至少 ${x.minDiscount}% off`);
    if (x.limit) t.push(`最多 ${x.limit} 个`);
    if (x.sort) t.push(SORT_LABEL()[x.sort] || x.sort);
    if ((x.products || []).length) t.push(`置顶 ${x.products.length} 个`);
    if (x.view) t.push(`模板 ${x.view}`);
    if (x.afterEnd === 'collection') t.push('结束后跳回合集');
    if (x.afterEnd === 'url') t.push(`结束后跳到 ${x.afterEndUrl || ''}`);
    return t.map((s) => `<span class="tag">${esc(s)}</span>`).join('');
  }
  const copyBox = (url, id) => `<span class="slurl"><input class="inp slurl__i mono" id="${id}" readonly value="${esc(url)}"/><button type="button" class="btn btn-sm" data-copy="${id}">复制</button><a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">打开↗</a></span>`;
  // 后台 iframe 里剪贴板可能被拦,拦了就选中让人自己按 ⌘C
  async function copyText(inputId) {
    const el = document.getElementById(inputId); if (!el) return;
    try { await navigator.clipboard.writeText(el.value); toast('链接已复制'); }
    catch { el.focus(); el.select(); try { if (!document.execCommand('copy')) throw new Error(); toast('链接已复制'); } catch { toast('已选中链接,按 Ctrl/⌘ + C 复制', false); } }
  }
  document.addEventListener('click', (e) => { const c = e.target.closest?.('[data-copy]'); if (c) { e.preventDefault(); e.stopPropagation(); copyText(c.dataset.copy); } }, true);

  // ================= 产品页推广块(2026-10-19 用户:镜头页自动加「变成索尼自动对焦 → Smart Fusion」,不用一个个产品去加) =================
  // 放在哪些产品 = 合集 / 标签 / 品牌 / 指定产品(满足任一),再去掉排除的产品 / 标签;一个产品只显示优先级最高的一个。
  // 主题 snippets/cgp-pdp-callout.liquid 画在产品页价格 / 活动徽章下面;「命中多少个」由服务器 /callout-scope 按同一套条件算
  let coVendors = null; // 店里的品牌(打开编辑器时按需读一次)
  let coRes = null; // 编辑器右边的命中结果:null 没算 / 'loading' / { total, sample, maybeAll } / { error }
  const coLink = (x) => String(x.link || '').trim() || (x.promo?.handle ? `/products/${x.promo.handle}` : '');
  const coImg = (x) => x.image || x.promo?.image || '';
  const coHas = (x) => [x.collections, x.tags, x.vendors, x.products].some((a) => (a || []).length);
  const frontUrl = (u) => (/^https:\/\//.test(u) ? u : `${S.store?.domain || ''}${u}`);
  function coScopeText(x) {
    const n = (a) => (a || []).length;
    const inc = [n(x.collections) && `合集 ${x.collections.map((c) => c.title).join('、')}`, n(x.tags) && `标签 ${x.tags.join('、')}`,
      n(x.vendors) && `品牌 ${x.vendors.join('、')}`, n(x.products) && `指定 ${n(x.products)} 个产品`].filter(Boolean);
    const exc = [n(x.exProducts) && `${n(x.exProducts)} 个产品`, n(x.exTags) && `标签 ${x.exTags.join('、')}`].filter(Boolean);
    return inc.length ? `${inc.join(' + ')}${exc.length ? `;排除 ${exc.join('、')}` : ''}` : '还没选放在哪些产品';
  }
  // 产品页上那张小卡片(和主题同一个样子;列表和预览共用)
  const coCardHtml = (x) => `<span class="pv-callout">${coImg(x) ? `<span class="pv-callout__img" style="background-image:url('${esc(thumb(coImg(x), 160))}')"></span>` : ''}<span class="pv-callout__b">
    <span class="pv-callout__t">${esc(x.title || '(还没写标题)')}</span>${x.text ? `<span class="pv-callout__s">${esc(x.text)}</span>` : ''}${coLink(x) ? `<span class="pv-callout__m">${esc(x.linkText || 'Learn more')} →</span>` : ''}</span></span>`;
  function renderCallouts() {
    const root = $('#co-root'); if (!root) return;
    const need = MODE === 'live' && S.setup && S.setup.coReady === false;
    const list = [...(S.callouts || [])].sort((a, b) => (RANK[status(a)] ?? 9) - (RANK[status(b)] ?? 9) || (b.priority ?? 0) - (a.priority ?? 0));
    root.innerHTML = `
      ${pageHead('产品页推广', '在一批产品的产品页(价格 / 活动徽章下面)自动加一张推广小卡片,比如镜头页「Turn this manual lens into a Sony autofocus lens → Smart Fusion」。按合集 / 标签 / 品牌 / 指定产品选放在哪里,以后新上架的产品进了合集就自动带上;一个产品同时符合几张时只显示优先级最高的那张。',
        need ? '' : `<button class="btn btn-primary" data-new="callout" type="button">${I.plus}新建推广块</button>`)}
      ${need ? '<div class="note note--warn">这个功能要先在店里建一个内容类型。到「设置 → 店铺连接」点「在店里创建内容类型」补建一下,再回来。<button class="btn btn-sm" data-go="settings" type="button">去补建</button></div>' : ''}
      ${alertsHtml(['callout'])}
      ${list.length ? `<div class="sllist">${list.map((x) => `<div class="slrow corow">
          <button class="slrow__main" type="button" data-open="${x.id}"><span class="slrow__h"><b>${esc(titleOf(x))}</b>${badge(x)}<span class="muted">优先级 ${esc(x.priority ?? 0)}</span></span>
            <span class="muted">${I.clock}${esc(winText(x))}</span><span class="corow__scope">放在:${esc(coScopeText(x))}</span></button>
          <span class="corow__pv">${coCardHtml(x)}</span>
          <button class="btn btn-sm btn-ghost" data-dup="${x.id}" type="button" title="复制一份出来改">${I.copy}复制</button></div>`).join('')}</div>`
        : (need ? '' : empty('还没有推广块。点右上角新建:写一句标题、选推广的产品(图片和链接自动用它的),再选放在哪些产品上。'))}`;
  }
  // ---- 编辑器 ----
  const coPromoHtml = () => `${ed.promo ? `<span class="chip chip--p">${ed.promo.image ? `<img src="${esc(ed.promo.image)}" alt="">` : ''}<span class="chip__t">${esc(ed.promo.title)}</span>${linkPair('products', ed.promo)}<button type="button" class="chip__x" data-co="unpromo" aria-label="移除">${I.x}</button></span>` : '<span class="muted">还没选</span>'}
    <button type="button" class="btn btn-sm" data-pick="promo">${ed.promo ? '换一个' : '选择产品'}</button>`;
  const coImgSrcHtml = (v) => (v.image ? `<span class="coimg" style="background-image:url('${esc(thumb(v.image, 120))}')"></span><span>用上传的图</span><button type="button" class="btn btn-sm btn-ghost" data-co="noimg">改回用产品主图</button>`
    : `<span class="muted">${v.promo ? '用推广产品的主图' : '没有图(选了推广的产品就用它的主图)'}</span>`);
  function coFormHtml(it) {
    const sec = (n, title, hint, body) => `<div class="edsec"><div class="edsec__h"><span class="edsec__n">${n}</span>${title}${hint ? `<em>${hint}</em>` : ''}</div>${body}</div>`;
    return `
      ${sec(1, '卡片内容', '产品页上显示的是英文,右边是预览', `
        ${fld('名称(后台看的)', inp('name', it.name, '如:Smart Fusion · 手动镜头'))}
        ${fld('标题', inp('title', it.title, 'Turn this manual lens into a Sony autofocus lens'), '加粗的那一句')}
        ${fld('说明(可不填)', inp('text', it.text, 'With PDMOVIE SMART FUSION + LIVE AIR 4 SMART'), '灰色小字')}
        <div class="fld"><span>推广的产品 <em>图片和链接默认用它的</em></span><div class="rowin" id="co-promo">${coPromoHtml()}</div></div>
        <div class="fld2">${fld('链接文字', inp('linkText', it.linkText, 'Learn more'), '留空 = Learn more')}
          ${fld('链接(可不填)', `<input class="inp mono" name="link" value="${esc(it.link || '')}" placeholder="留空 = 推广产品的页面"/>`, '要指定款式就粘贴完整链接,如 /products/pdmovie-smart-fusion?variant=…')}</div>
        <div class="fld"><span>图片</span><div class="rowin coimgrow"><span class="rowin" id="co-imgsrc">${coImgSrcHtml(it)}</span>
          ${MODE === 'live' ? '<label class="btn btn-sm upl">上传图片<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" id="ed-upload" hidden/></label>' : ''}</div>
          <input type="hidden" name="image" value="${esc(it.image || '')}"/><input type="hidden" name="imageId" value="${esc(it.imageId || '')}"/>
          <em>一般不用传,直接用推广产品的主图;想换一张(比如镜头 + Smart Fusion 的合照)再上传,存进 Shopify 文件库。</em></div>`)}
      ${sec(2, '放在哪些产品', '以后新上架的产品进了这些合集 / 带了这些标签,自动带上', `<div class="scope" id="ed-scope">${coScopeHtml()}</div>`)}
      ${sec(3, '什么时候显示', '', `${timeBlock(it, 'callout')}
        ${fld('优先级', `<input class="inp inp--num" type="number" name="priority" value="${esc(it.priority ?? 10)}"/>`, '一个产品同时符合几张推广块时,只显示数字大的那张')}`)}`;
  }
  const coSumHtml = () => {
    if (!coHas(ed)) return '还没选 —— 至少选一个合集 / 标签 / 品牌 / 产品';
    if (MODE !== 'live') return '正式数据里会算出命中多少个产品,并在右边列出前几个';
    if (coRes == null || coRes === 'loading') return '正在算命中多少个产品…';
    if (coRes.error) return `没算出来:${esc(coRes.error)}`;
    return `命中 <b>${coRes.total}</b> 个产品(已去掉排除的)${coRes.maybeAll ? ',和全店数量一样,可能有条件 Shopify 没认出来,以前台为准' : ''};右边列出前几个,点开可以去前台核对`;
  };
  function coScopeHtml() {
    const rm = (key, i) => `<button type="button" class="chip__x" data-rm="${key}:${i}" aria-label="移除">${I.x}</button>`;
    const pchip = (p, key, i) => `<span class="chip chip--p">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span class="chip__t">${esc(p.title)}</span>${linkPair('products', p)}${rm(key, i)}</span>`;
    const tchip = (t, key, i) => `<span class="chip"><span class="chip__t mono">${esc(t)}</span>${linkPair('tags', t)}${rm(key, i)}</span>`;
    const row = (k, body) => `<div class="scope__row"><span class="scope__k">${k}</span><span class="chips">${body}</span></div>`;
    return `
      <div class="scope__lbl">满足任一就显示</div>
      ${row('合集', `${ed.collections.map((c, i) => `<span class="chip"><span class="chip__t">${esc(c.title)}</span>${linkPair('collections', c)}${rm('collections', i)}</span>`).join('')}<button type="button" class="chipadd" data-pick="collections">${I.plus}选择合集</button>`)}
      ${row('标签', `${ed.tags.map((t, i) => tchip(t, 'tags', i)).join('')}<input class="chipinp" id="sc-tag" list="sc-tags" placeholder="输入标签,回车添加"/>`)}
      ${row('品牌', `${ed.vendors.map((v, i) => `<span class="chip"><span class="chip__t">${esc(v)}</span>${rm('vendors', i)}</span>`).join('')}<input class="chipinp" id="sc-vendor" list="sc-vendors" placeholder="输入或选品牌,回车添加"/>`)}
      ${row('指定产品', `${ed.products.map((p, i) => pchip(p, 'products', i)).join('')}<button type="button" class="chipadd" data-pick="products">${I.plus}选择产品</button>`)}
      <div class="scope__lbl">排除 <em>就算符合上面也不显示,比如自动对焦镜头、不兼容的型号</em></div>
      ${row('排除产品', `${ed.exProducts.map((p, i) => pchip(p, 'exProducts', i)).join('')}<button type="button" class="chipadd" data-pick="exProducts">${I.plus}选择产品</button>`)}
      ${row('排除标签', `${ed.exTags.map((t, i) => tchip(t, 'exTags', i)).join('')}<input class="chipinp" id="sc-extag" list="sc-tags" placeholder="输入标签,回车添加"/>`)}
      <datalist id="sc-tags">${Object.entries(S.tagCounts).map(([t, n]) => `<option value="${esc(t)}">${n} 个产品</option>`).join('')}</datalist>
      <datalist id="sc-vendors">${(coVendors || []).filter((v) => !ed.vendors.includes(v)).map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>
      <div class="scope__sum">${coSumHtml()}</div>`;
  }
  let coTimer = null;
  function fetchCoScope() {
    if (MODE !== 'live' || !ed) return;
    clearTimeout(coTimer);
    const mine = ed;
    if (!coHas(mine)) { coRes = null; return; }
    coRes = 'loading';
    coTimer = setTimeout(async () => {
      try {
        const r = await api('POST', '/api/schedule/callout-scope', { collections: mine.collections, tags: mine.tags, vendors: mine.vendors, products: mine.products, exProducts: mine.exProducts, exTags: mine.exTags });
        if (ed !== mine) return; coRes = r;
      } catch (e) { if (ed !== mine) return; coRes = { error: e.message || String(e) }; }
      const sum = $('#ed-scope .scope__sum'); if (sum) sum.innerHTML = coSumHtml();
      $('#ed-form')?.dispatchEvent(new Event('change'));
    }, 500);
  }
  async function coLoadVendors() {
    if (coVendors) return;
    try {
      coVendors = MODE === 'live' ? (await api('GET', '/api/schedule/vendors')).vendors
        : [...new Set((S.products || []).map((p) => p.vendor).filter(Boolean))].sort();
      const dl = $('#sc-vendors'); if (dl && ed) dl.innerHTML = coVendors.filter((v) => !ed.vendors.includes(v)).map((v) => `<option value="${esc(v)}"></option>`).join('');
    } catch (e) { console.warn('[vendors]', e); }
  }
  function coMatchHtml(v) {
    const r = coRes && typeof coRes === 'object' && !coRes.error ? coRes : null;
    if (!coHas(v)) return '<p class="muted">还没选放在哪些产品。</p>';
    if (MODE !== 'live') return `<p class="muted">${esc(coScopeText(v))}。正式数据里这里会列出命中的产品(前 12 个)。</p>`;
    if (!r) return `<p class="muted">${coRes?.error ? '没算出来:' + esc(coRes.error) : '正在算…'}</p>`;
    if (!r.total) return '<p class="muted">一个产品都没命中,检查一下合集 / 标签 / 品牌。</p>';
    return `<p class="muted pv-cap">共 <b>${r.total}</b> 个产品${r.total > r.sample.length ? `,下面是按名称排的前 ${r.sample.length} 个` : ''}${r.maybeAll ? '(和全店数量一样,可能有条件没被识别,以前台为准)' : ''}。推广的那个产品自己的页面不显示。</p>
      <div class="comatch">${r.sample.map((p) => `<a class="comatch__i" href="${esc(frontUrl(`/products/${p.handle}`))}" target="_blank" rel="noopener" title="在前台打开看看">
        <span class="comatch__img" ${p.image ? `style="background-image:url('${esc(thumb(p.image, 120))}')"` : ''}></span><span class="comatch__t">${esc(p.title)}</span>${p.status && p.status !== 'ACTIVE' ? `<span class="muted">${p.status === 'DRAFT' ? '草稿' : '已归档'}</span>` : ''}</a>`).join('')}</div>`;
  }
  function coPreviewHtml(v) {
    const r = coRes && typeof coRes === 'object' && !coRes.error ? coRes : null;
    const prod = r?.sample?.find((p) => p.id !== v.promo?.id) || v.products?.[0] || null;
    return `<div class="pv-label">产品页上的样子 <em>价格 / 活动徽章下面</em></div>
      <div class="pv-pdp">
        <div class="pv-pdp__img" ${prod?.image ? `style="background-image:url('${esc(thumb(prod.image, 300))}')"` : ''}></div>
        <div class="pv-pdp__info">
          <div class="pv-pdp__title">${esc(prod?.title || 'DZOFILM VESPID 2 Prime 6 Lens Set')}</div>
          <div class="pv-pdp__price">£4,099.00</div>
          ${coCardHtml(v)}
          <div class="pv-pdp__btn">Add to cart</div>
        </div>
      </div>
      <p class="muted pv-cap">${coLink(v) ? `整张卡片可以点,去 <a class="lk mono" href="${esc(frontUrl(coLink(v)))}" target="_blank" rel="noopener">${esc(coLink(v))}</a>` : '还没有链接:选推广的产品,或者填一个链接'}</p>
      <div class="pv-label">会显示在这些产品上</div>
      ${coMatchHtml(v)}`;
  }

  function renderSaleLinks() {
    const root = $('#sl-root'); if (!root) return;
    const need = MODE === 'live' && S.setup && S.setup.slReady === false;
    const groups = new Map();
    for (const x of S.salelinks || []) {
      const k = x.collection ? numId(x.collection.id) : '?';
      if (!groups.has(k)) groups.set(k, { title: x.collection?.title || '(没选合集)', handle: x.collection?.handle || '', list: [] });
      groups.get(k).list.push(x);
    }
    const rows = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
    root.innerHTML = `
      ${pageHead('促销链接', '给合集做一条只显示打折产品的链接,比如 /collections/dzofilm?onsale=autumn。可以只显示有货的、置顶几个产品、限制数量、换排序;放进 Banner、邮件、社媒都行。链接发出去以后还能改设置;没生效时退回「这个合集所有打折的产品」。',
        need ? '' : `<button class="btn btn-primary" data-new="salelink" type="button">${I.plus}新建促销链接</button>`)}
      ${need ? '<div class="note note--warn">这个功能要先在店里建一个内容类型。到「设置 → 店铺连接」点「在店里创建内容类型」补建一下,再回来。<button class="btn btn-sm" data-go="settings" type="button">去补建</button></div>' : ''}
      <div class="note">💡 不用保存也能用:任何合集链接后面加 <b class="mono">?onsale</b>,就只显示这个合集里打折的产品(顺序和合集平时一样)。</div>
      ${alertsHtml(['salelink'])}
      ${rows.length ? rows.map((g) => `<section class="panel"><div class="panel__h"><h3>${esc(g.title)}</h3>${g.handle ? `<span class="muted mono">/collections/${esc(g.handle)}</span>` : ''}</div>
        <div class="sllist">${g.list.sort((a, b) => (win(a).start ?? 0) - (win(b).start ?? 0)).map((x) => `<div class="slrow">
          <button class="slrow__main" type="button" data-open="${x.id}"><span class="slrow__h"><b>${esc(titleOf(x))}</b>${badge(x)}${slTags(x)}</span>
            <span class="muted">${I.clock}${esc(winText(x))}${x.heading ? ` · 标题「${esc(x.heading)}」` : ''}</span></button>
          ${copyBox(slUrl(x), `slu-${x.id}`)}</div>`).join('')}</div></section>`).join('')
        : (need ? '' : empty('还没有促销链接。点右上角新建一条:选合集、起个后缀,右边会实时显示这条链接会出现哪些产品。'))}`;
  }
  // ---- 编辑器 ----
  function slFormHtml(it) {
    const c = sl?.collection || it.collection;
    return `${fld('名称', inp('name', it.name, '如:DZOFiLM Autumn Deals'), '给自己人看的名字;后缀没改过会跟着它自动生成')}
      <div class="fld"><span>合集</span><div class="rowin" id="sl-coll">${slCollHtml(c)}</div></div>
      ${fld('链接后缀', `<input class="inp mono" name="slug" value="${esc(it.slug || '')}" placeholder="如:autumn" ${it.slug ? 'data-touched="1"' : ''}/>`, '?onsale= 后面那段:小写字母、数字、横线;同一个合集里不能重复')}
      <div class="fld"><span>页面模板 <em>?view= 后面那段:用主题里单独排版的促销页(比如 sale);留空 = 合集原来的版面</em></span>
        <input class="inp mono" name="view" list="sl-views" value="${esc(it.view || '')}" placeholder="留空 = 合集原来的版面,或填 sale"/><datalist id="sl-views"></datalist>
        <em id="sl-viewinfo"></em></div>
      <div class="fld"><span>完整链接 <em>保存并生效后,这个链接才会按下面的设置显示</em></span><div id="sl-url"></div></div>
      <label class="tgl"><input type="checkbox" name="inStock" ${it.inStock ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>只显示有货的</b><span class="muted">预订(Pre Order)和缺货的不显示,和前台卡片上的「In Stock」一致</span></span></label>
      <div class="fld2">${fld('最低折扣 %', `<input class="inp" type="number" min="0" max="95" name="minDiscount" value="${esc(it.minDiscount ?? '')}" placeholder="不限"/>`, '比如 20 = 只显示 20% off 以上的')}
        ${fld('最多显示几个', `<input class="inp" type="number" min="0" name="limit" value="${esc(it.limit ?? '')}" placeholder="不限"/>`, '按下面的排法取前面几个')}</div>
      ${fld('排序', `<select class="sel" name="sort">${SL.SALE_SORTS.map(([k, l]) => `<option value="${k}" ${(it.sort || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`, '「和合集平时一样」= 合集页默认的 Featured 顺序(包括生效中的合集排序清单)。顾客自己选了 Sort by 就按他选的')}
      <div class="fld"><span>置顶的产品 <em>按顺序排在最前;照样要打折(勾了有货还要有货)才会显示</em></span><div id="sl-pins"></div></div>
      ${fld('页面上的标题', inp('heading', it.heading, '如:DZOFiLM Autumn Deals'), '显示在结果数前面;不填显示「On Sale」')}
      ${timeBlock(it, 'salelink')}
      <div class="fld"><span>结束后去哪 <em>时间到了(或跟随的活动结束)以后,顾客再打开这条链接会怎样</em></span>
        <select class="sel" name="afterEnd">${SL.AFTER_END.map(([k, l]) => `<option value="${k}" ${(it.afterEnd || '') === k ? 'selected' : ''}>${k ? l : '不跳转(显示这个合集所有打折的产品)'}</option>`).join('')}</select>
        <input class="inp mono" name="afterEndUrl" id="sl-afterurl" value="${esc(it.afterEndUrl || '')}" placeholder="/collections/black-friday 或 https://…" ${it.afterEnd === 'url' ? '' : 'hidden'}/>
        <em>不跳转:链接照样能打开,显示这个合集所有打折的产品(短链接 ?view= 还会用这个模板的版面)。跳回合集:回到这个合集原来的页面。暂停中的链接不跳转。</em></div>`;
  }
  const slCollHtml = (c) => `${c ? `<span class="chip"><span class="chip__t">${esc(c.title)}</span>${linkPair('collections', c)}</span>` : '<span class="muted">还没选</span>'}
    <button type="button" class="btn btn-sm" data-sl="coll">${c ? '换一个合集' : '选择合集'}</button>`;
  function redrawSlUrl() {
    const box = $('#sl-url'); if (!box) return;
    const slug = String($('#ed-form [name="slug"]')?.value || '').trim().toLowerCase();
    const view = String($('#ed-form [name="view"]')?.value || '').trim();
    const u = slUrl({ collection: sl?.collection, slug, view });
    redrawSlView();
    box.innerHTML = !sl?.collection ? '<span class="muted">选好合集、填好后缀就会出现</span>'
      : SL.SLUG_RE.test(slug) ? copyBox(u, 'sl-url-i') : '<span class="muted">后缀只能用小写字母、数字和横线</span>';
  }
  function redrawSl() {
    const box = $('#sl-pins'); if (!box) return;
    box.innerHTML = `<div class="slpins">${sl.products.map((p, i) => `<span class="chip chip--p">${p.image ? `<img src="${esc(thumb(p.image, 80))}" alt="">` : ''}<span class="chip__t">${i + 1}. ${esc(p.title)}</span>
        ${i ? `<button type="button" class="chip__x" data-sl="up" data-i="${i}" title="往前挪">${I.up}</button>` : ''}<button type="button" class="chip__x" data-sl="rm" data-i="${i}" aria-label="移除">${I.x}</button></span>`).join('')}
      <button type="button" class="chipadd" data-sl="prod">${I.plus}添加产品</button></div>`;
    const cb = $('#sl-coll'); if (cb) cb.innerHTML = slCollHtml(sl.collection);
    redrawSlUrl();
  }
  // 前台这个合集的产品(服务器读主题的 cgp-json,和顾客看到的一样)
  async function slLoad(done, force) {
    const c = sl?.collection; if (!c?.handle || MODE !== 'live') return;
    const k = c.handle;
    if (!force && slPrev[k] && (slPrev[k].busy || now() - slPrev[k].at < 120000)) return;
    slPrev[k] = { busy: true, at: now() }; done?.();
    try { slPrev[k] = { ...(await api('GET', `/api/schedule/sale-preview?handle=${encodeURIComponent(k)}&id=${encodeURIComponent(c.id)}${force ? `&_=${now()}` : ''}`)), at: now() }; }
    catch (e) { slPrev[k] = { error: e.message, at: now() }; }
    if (sl?.collection?.handle === k) done?.();
  }
  async function slAct(b, done) {
    const a = b.dataset.sl; const i = +b.dataset.i;
    const m = (x) => ({ id: x.id, handle: x.handle, title: x.title, image: x.images?.[0]?.originalSrc || x.image || '' });
    const shopPick = async (type, multiple) => {
      if (!(window.shopify && typeof window.shopify.resourcePicker === 'function')) return null;
      try { return await window.shopify.resourcePicker({ type, multiple, action: 'select' }); } catch { return null; }
    };
    if (a === 'coll') {
      const picked = await shopPick('collection', false);
      if (picked?.length) sl.collection = m(picked[0]);
      else if (!picked) { const L = S.collections || []; if (!L.length) return; const at = L.findIndex((x) => String(x.id) === String(sl.collection?.id)); sl.collection = m(L[(at + 1) % L.length]); } // 演示:每点一次换下一个
      else return;
      const fh = $('#ed-form'); const nameEl = fh.querySelector('[name="name"]'); const sg = fh.querySelector('[name="slug"]');
      if (nameEl && !nameEl.value.trim()) { nameEl.value = `${sl.collection.title} Deals`; if (!sg.dataset.touched) sg.value = SL.slugOf(nameEl.value); }
      redrawSl(); done(); slLoad(done); return;
    }
    if (a === 'prod') {
      const picked = await shopPick('product', true);
      const add = picked ? picked.map(m) : (S.products || []).slice(0, 2).map(m);
      const have = new Set(sl.products.map((p) => numId(p.id)));
      sl.products.push(...add.filter((p) => !have.has(numId(p.id))));
    }
    if (a === 'rm') sl.products.splice(i, 1);
    if (a === 'up' && i > 0) [sl.products[i - 1], sl.products[i]] = [sl.products[i], sl.products[i - 1]];
    if (a === 'reload') { slLoad(done, true); return; }
    if (a === 'slugview') { const fh = $('#ed-form'); const sg = fh.querySelector('[name="slug"]'); sg.value = String(fh.querySelector('[name="view"]').value).trim().toLowerCase(); sg.dataset.touched = '1'; redrawSlUrl(); return; }
    redrawSl(); done();
  }
  function slPreviewHtml(v) {
    const head = (extra = '') => `<div class="pv-label">顾客打开这条链接会看到${extra}</div>`;
    const c = sl?.collection || v.collection;
    if (!c) return `${head()}<p class="muted">先选合集。</p>`;
    if (MODE !== 'live') return `${head()}<p class="muted">演示模式没有前台的折扣和库存数据;正式数据里这里会按前台实时算出会显示哪些产品。</p>`;
    const d = slPrev[c.handle];
    if (!d || d.busy) return `${head()}<p class="muted">正在读前台这个合集的产品…</p>`;
    if (d.error) return `${head(' <button type="button" class="btn btn-sm btn-ghost" data-sl="reload">重试</button>')}<div class="note note--danger">${esc(d.error)}</div>`;
    const ap = activePin(numId(c.id));
    const view = SL.saleView(d.products, { ...v, products: sl.products }, { sortRule: d.sortRule, pinIds: (ap?.products || []).map((p) => p.id) });
    const onSale = d.products.filter((p) => p.discount > 0).length;
    const ST2 = { instock: 'In Stock', preorder: 'Pre Order', oos: 'Out of Stock' };
    const pinned = new Set(sl.products.map((p) => numId(p.id)));
    const card = (p, i) => `<a class="slcard ${pinned.has(numId(p.id)) ? 'is-pin' : ''}" href="${esc((S.store?.domain || '') + (p.url || ''))}" target="_blank" rel="noopener"><span class="slcard__n">${i + 1}</span>
      <span class="slcard__img" ${p.image ? `style="background-image:url('${esc(p.image)}')"` : ''}><span class="slcard__off">${p.discount}% OFF</span></span>
      <span class="slcard__t">${esc(p.title)}</span><span class="slcard__p">${p.compareStr ? `<s>${esc(p.compareStr)}</s> ` : ''}<b>${esc(p.priceStr || '')}</b></span>
      <span class="slcard__s slcard__s--${esc(p.status)}">${ST2[p.status] || esc(p.status)}</span></a>`;
    return `${head(' <button type="button" class="btn btn-sm btn-ghost" data-sl="reload">刷新</button>')}
      <p class="slsum">显示 <b>${view.list.length}</b> 个产品${view.total > view.list.length ? `(符合条件的有 ${view.total} 个,只取前 ${view.list.length} 个)` : ''} · 这个合集一共 ${d.total} 个产品,打折的 ${onSale} 个${d.truncated ? ' · ⚠️ 合集太大,前台只读前 1000 个' : ''}</p>
      ${view.pins.some((p) => !p.shown) ? `<div class="note note--warn">${view.pins.filter((p) => !p.shown).map((p) => `置顶的「${esc(p.title)}」不会显示:${esc(p.why)}`).join('<br>')}</div>` : ''}
      ${ap && !v.sort ? `<p class="muted">「和合集平时一样」包括正在生效的合集排序清单「${esc(titleOf(ap))}」。</p>` : ''}
      ${view.list.length ? `<div class="slgrid">${view.list.slice(0, 60).map(card).join('')}</div>${view.list.length > 60 ? `<p class="muted">……还有 ${view.list.length - 60} 个</p>` : ''}` : '<p class="muted">按现在的设置一个产品都没有,顾客打开会看到「没有产品」。</p>'}
      <p class="muted pv-cap">数据来自前台(和顾客看到的一样),两分钟内不重复读;刚改过价格 / 库存就点「刷新」。</p>`;
  }

  // ================= 合集排序(置顶清单) =================
  // 按合集分组:每个合集下面是按时间排好的清单(Flash 每天一份)。可以「复制成下一天」,不用重填。
  let pnAt = null; // 预览看哪一刻
  // 合集 id 有时是数字、有时是 gid(选择器给的),一律按末尾数字比
  const pinsOf = (cid) => (S.pins || []).filter((p) => p.collection && numId(p.collection.id) === numId(cid));
  // 这一刻这个合集生效的清单(同时有几份时,开始晚的赢 —— 和主题里的规则一致)
  function activePin(cid, t = now()) {
    return pinsOf(cid).filter((p) => status(p, t) === 'live').sort((a, b) => (win(b).start ?? 0) - (win(a).start ?? 0))[0] || null;
  }
  // 哪些首页模块页签用了这个合集(改排序会影响它们)
  function modTabsUsing(cid) {
    const out = [];
    for (const v of S.pmodules || []) for (const t of v.tabs || []) if (t.source !== 'products' && t.collection && numId(t.collection.id) === numId(cid)) out.push({ v, t });
    return out;
  }
  function renderPins() {
    const need = MODE === 'live' && S.setup && S.setup.pinReady === false;
    const T = pnAt ?? now();
    const points = tlPoints(['pin']);
    const groups = new Map();
    for (const p of S.pins || []) {
      const cid = p.collection ? numId(p.collection.id) : '?';
      if (!groups.has(cid)) groups.set(cid, { cid, title: p.collection?.title || '(没选合集)', list: [] });
      groups.get(cid).list.push(p);
    }
    for (const g of groups.values()) g.list.sort((a, b) => (win(a).start ?? 0) - (win(b).start ?? 0));
    const rows = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
    const card = (p) => {
      const on = status(p, T) === 'live';
      const prods = p.products || [];
      return `<div class="pnrow ${on ? 'is-on' : ''}">
        <button class="pnrow__main" type="button" data-open="${p.id}" data-pop="${p.id}">
          <span class="pnrow__h"><b>${esc(titleOf(p))}</b>${badgeAt(p, T)}${p.fullOrder ? '<span class="tag tag--accent">完全按清单顺序</span>' : ''}${p.onlyListed ? '<span class="tag tag--warn">只显示清单里的</span>' : ''}${p.countdown ? '<span class="tag">倒计时</span>' : ''}</span>
          <span class="pnrow__w">${I.clock}${esc(winText(p))}</span>
          <span class="pnrow__ps">${prods.slice(0, 8).map((x, i) => `<span class="pnrow__p" title="${esc(x.title)}"><span class="pnrow__n">${i + 1}</span>${x.image ? `<img src="${esc(thumb(x.image, 100))}" alt="" loading="lazy">` : ''}</span>`).join('')}${prods.length > 8 ? `<span class="muted">…共 ${prods.length} 个</span>` : ''}${prods.length ? '' : '<span class="muted">还没加产品</span>'}</span>
        </button>
        <span class="pnrow__acts"><button class="btn btn-sm" type="button" data-pindup="${p.id}">复制成下一天</button></span>
      </div>`;
    };
    $('#pn-root').innerHTML = `
      ${pageHead('合集排序', '让合集页和首页商品模块里,指定的产品排在最前面。可以按时间排,Flash 每天一组。',
        need ? '' : `${MODE === 'live' && isApprover() ? '<button class="btn" id="pn-run" type="button">立即执行一次</button>' : ''}<button class="btn btn-primary" data-new="pin" type="button">${I.plus}新建置顶清单</button>`)}
      ${need ? '<div class="note note--warn">这个功能要先在店里建一个内容类型。到「设置 → 店铺连接」点「在店里创建内容类型」补建一下,再回来。<button class="btn btn-sm" data-go="settings" type="button">去补建</button></div>' : ''}
      ${alertsHtml(['pin'])}
      <section class="panel">
        <div class="panel__h"><h3>这一刻各合集的排序</h3><span class="muted">${pnAt == null ? '现在' : `${fDT(T)} · ${relDay(T)}`}</span></div>
        ${tlHtml('pn', points, pnAt)}
        ${tlChanges(points, pnAt)}
      </section>
      ${rows.length ? rows.map((g) => {
        const act = activePin(g.cid, T);
        // 首页哪些模块页签也吃这个合集(同名的只说一次)
        const used = [...new Set(modTabsUsing(g.cid).map((u) => `${MODULE_CN[u.v.module]}·${tabLabel(u.t)}`))];
        const cs = (S.colState || {})[String(g.cid)];
        const sf = (S.sortFlags || {})[String(g.cid)];
        return `<section class="panel pngroup">
          <div class="panel__h"><h3>${esc(g.title)}${MODE === 'live' && g.cid !== '?' ? ` <button class="btn btn-sm pn-hist" type="button" data-colhist="${esc(String(g.cid))}" data-title="${esc(g.title)}">${I.clock}历史版本 / 回滚</button>` : ''}</h3>
            <span class="muted">${act ? `这一刻按「${esc(titleOf(act))}」排${act.onlyListed ? ',而且只显示清单里的产品' : ''}` : '这一刻没有清单生效,按合集原来的顺序'}
              ${used.length ? ` · 首页${used.slice(0, 3).map((u) => `「${esc(u)}」`).join('')}${used.length > 3 ? '等' : ''}页签也用这个合集` : ''}</span></div>
          ${cs ? (cs.hold
    ? `<div class="note note--warn">有人在 Shopify 后台手动改过这个合集的顺序,<b>app 已经停手</b>,不会覆盖别人的改动。
        <button class="btn btn-sm" type="button" data-colhold="${esc(String(g.cid))}">按清单重新排</button>
        <button class="btn btn-sm" type="button" data-colrelease="${esc(String(g.cid))}">就用现在的,别管了</button></div>`
    : `<div class="note note--ok">店里这个合集现在<b>真的</b>按「${esc(cs.pinName || '')}」排着${cs.removed?.length ? `,另有 ${cs.removed.length} 个产品临时移出了合集` : ''} · 结束会自动还原成接管前的顺序。</div>`) : ''}
          ${(() => { // 同一个合集这一刻有几份清单同时生效:只有开始时间最晚的那份会用上
            const live = g.list.filter((p) => status(p, T) === 'live');
            if (live.length < 2) return '';
            const st0 = (p) => win(p).start ?? 0;
            const tie = live.filter((p) => st0(p) === st0(act)).length > 1;
            return `<div class="note note--warn">这一刻有 ${live.length} 份清单同时生效:${live.map((p) => `「${esc(titleOf(p))}」`).join('、')}。
              ${tie ? '它们的开始时间一样(比如都是「长期显示」),<b>前台和店里可能各用一份,顺序会打架</b> —— 请暂停不用的那份,或者给它们设不同的开始时间。'
                : `只有开始时间最晚的「${esc(titleOf(act))}」会用上,它结束后才轮到别的。不需要的可以暂停或删掉。`}</div>`;
          })()}
          ${sf ? `<div class="note note--ok">合集页现在<b>完全按清单顺序</b>显示(「${esc(sf.pinName || '')}」生效期间),结束自动恢复原来的排序方式。</div>` : ''}
          <div class="pnlist">${g.list.map(card).join('')}</div>
        </section>`;
      }).join('') : (need ? '' : empty('还没有置顶清单。点右上角新建一个,选合集、拖好顺序就行。'))}`;
    wireTimeline('pn', points, () => pnAt, (v) => { pnAt = v; renderPins(); });
    // 立即执行一次:不用等定时器那一分钟,而且把「做了什么 / 为什么没做」直接说出来
    $('#pn-run')?.addEventListener('click', async (e) => {
      const b = e.currentTarget; const old2 = b.textContent; b.disabled = true; b.textContent = '执行中…';
      try {
        const { rep } = await api('POST', '/api/schedule/col-run');
        const say = colSay(rep);
        await load(); renderAll();
        toast(say.length ? say.join(' · ') : '这一刻没有生效中的清单,什么都不用做', !rep.failures.length);
      } catch (err) { toast(err.message, false); }
      b.disabled = false; b.textContent = old2;
    });
    $$('#pn-root [data-colhist]').forEach((b) => b.addEventListener('click', () => openColHistory(b.dataset.colhist, b.dataset.title)));
    $$('#pn-root [data-colhold], #pn-root [data-colrelease]').forEach((b) => b.addEventListener('click', async () => {
      const release = 'colrelease' in b.dataset;
      b.disabled = true;
      try {
        await api('POST', '/api/schedule/col-hold', { collection: release ? b.dataset.colrelease : b.dataset.colhold, release });
        await load(); renderAll(); toast(release ? '好,这个合集的顺序交回给你' : '好,下一分钟按清单重新排');
      } catch (e) { toast(e.message, false); b.disabled = false; }
    }));
    $$('#pn-root [data-pindup]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = byId(b.dataset.pindup); if (!p) return;
      const w = win(p);
      // 原来有时间 → 整段往后推一天;原来没设时间(长期 / 跟随活动)→ 给它明天一整天
      const start = w.start == null ? dayStart(1) : w.start + DAY;
      const end = w.start == null ? dayStart(2) : (w.end == null ? null : w.end + DAY);
      // 名字:原来叫「… 第 N 天」就自动变成第 N+1 天,否则换成新的日期
      const old = String(p.name || ''); const dayN = old.match(/第\s*(\d+)\s*天\s*$/);
      const stem = old.replace(/[\s·\-—]*(第\s*\d+\s*天|\d+月\d+日|\d+\/\d+(\s*周.)?)\s*$/, '').trim() || p.collection?.title || '置顶清单';
      openEditor('pin', null, { dup: {
        ...p, id: rid('pin-'), state: 'new', shopifyId: null, syncedStatus: null, pendingChange: null, paused: false, by: S.me,
        name: dayN ? `${stem} 第 ${+dayN[1] + 1} 天` : `${stem} ${fDate(start)}`, start, end,
        collection: p.collection || null, products: (p.products || []).map((x) => ({ ...x })), campaign: p.campaign || null,
      } });
      toast('已复制成下一天 —— 换掉产品、确认时间,再提交');
    }));
  }

  // 活动页「产品上显示」里的常用设置:改了马上保存(已批准的直接生效,草稿照旧存草稿)
  function wireQuick(c) {
    const box = $('#cp-root [data-qcamp]'); if (!box) return;
    const save = async (values, msg) => {
      box.classList.add('is-busy');
      const r = await act({ type: 'save', mode: c.state === 'approved' ? 'publish' : 'draft', kind: 'campaign', id: c.id, values });
      if (r) toast(msg + (c.state === 'approved' ? ' · 网站马上生效' : ' · 活动还是草稿'));
      else renderCampaigns();
    };
    box.querySelector('[data-q="badge"]').addEventListener('change', (e) => save({ badge: e.target.value.trim() }, e.target.value.trim() ? `徽章改成「${e.target.value.trim()}」` : '已关掉徽章'));
    box.querySelector('[data-q="badge"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    const bm = box.querySelector('[data-q="blmode"]'), bu = box.querySelector('[data-q="blurl"]');
    bm.addEventListener('change', () => {
      if (bm.value === 'url') { bu.hidden = false; bu.focus(); return; } // 填好链接再保存
      save({ badgeLink: bm.value === 'none' ? 'none' : '' }, bm.value === 'none' ? '徽章改成不能点' : '徽章链接改成自动');
    });
    bu.addEventListener('change', () => { const u = bu.value.trim(); if (u) save({ badgeLink: u }, `徽章点了去 ${u}`); });
    bu.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    box.querySelector('[data-q="countdown"]').addEventListener('change', (e) => save({ countdown: e.target.checked }, e.target.checked ? '已打开倒计时' : '已关掉倒计时'));
    box.querySelector('[data-q="priority"]').addEventListener('change', (e) => save({ priority: +e.target.value || 0 }, `优先级改成 ${+e.target.value || 0}`));
    box.querySelectorAll('[data-qsty]').forEach((b) => b.addEventListener('click', () => { if (!b.classList.contains('is-active')) save({ countdownStyle: b.dataset.qsty }, `样式改成「${CD_STY[b.dataset.qsty].name}」`); }));
  }
  function renderCampaigns() {
    const hubC = cpHub && camp(cpHub);
    if (hubC) { $('#cp-root').innerHTML = hubHtml(hubC); wireQuick(hubC); if (!hubPrice.at || now() - hubPrice.at > 30000) loadHubPrice(); return; }
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
        <span class="ccard__row"><span class="muted">徽章</span><span class="ccard__v">${c.badge ? `<span class="pbadge">${esc(c.badge)}</span>` : '<span class="muted">无徽章</span>'}${c.countdown ? '<span class="tag">倒计时</span>' : ''}</span></span>
        <span class="ccard__row"><span class="muted">包含</span><span class="ccard__v">${bn.length} 张 Banner · ${tb.length} 条顶栏${sty.length ? ` · ${sty.length} 个顶栏样式` : ''}${(S.salelinks || []).filter((x) => x.campaign === c.id).length ? ` · ${(S.salelinks || []).filter((x) => x.campaign === c.id).length} 条促销链接` : ''}${(c.larkLinks || []).length ? ` · ${c.larkLinks.length} 个飞书任务` : ''}</span></span>
        ${bn.length ? `<span class="ccard__thumbs">${bn.map((b) => `<span class="ccard__t">${slideHtml(b, { w: 200 })}</span>`).join('')}</span>` : ''}
      </button>`;
    };
    const tabs = [['live', '进行中'], ['scheduled', '已排期'], ['draft', '草稿'], ['ended', '已结束'], ['', '全部']]
      .map(([k, l]) => `<button class="ftab ${cpF.st === k ? 'is-active' : ''}" data-st="${k}" type="button">${l}<span>${S.campaigns.filter((c) => inTab(c, k)).length}</span></button>`).join('');
    $('#cp-root').innerHTML = `
      ${pageHead('活动(促销)', '有时间段的促销:选好参加的产品(合集 / 标签 / 手动指定),产品页和搜索 / 合集页的产品卡自动显示徽章和倒计时;挂在活动下的 Banner / 顶栏 / 顶栏样式和它同时上线、同时结束。',
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
  // 演示模式里的示例产品:用演示目录里的真实产品(图和标题是真的),价格按 id 算一个稳定的示例值
  function demoItems(t) {
    const pool = S.products || []; if (!pool.length) return [];
    const seed = [...tabKey(t || {})].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return Array.from({ length: 5 }, (_, i) => {
      const p = pool[(seed + i * 37) % pool.length];
      const base = 80 + (p.id % 1200);
      const off = t?.onlyDiscounted || (p.id % 3 === 0) ? 10 + (p.id % 30) : 0;
      return { title: p.title, image: p.image, price: (base * (1 - off / 100)).toFixed(2), compareAt: off ? base.toFixed(2) : null, off };
    });
  }
  function moduleHtml(v, { activeTab = 0, small = false, pm = '', at = null } = {}) {
    const c = pmColors(v); const tabs = v.tabs || []; const t = tabs[activeTab] || tabs[0];
    const cached = t && pmPreviewCache[tabKey(t)];
    const base = cached?.items?.length ? cached.items : (MODE === 'demo' ? demoItems(t) : []);
    // 合集排序:这个页签用的合集在这一刻有置顶清单的话,前几个位置就是清单里的产品(主题里也是这么排的)
    const pin = t && t.source !== 'products' && t.collection?.id ? activePin(t.collection.id, at ?? now()) : null;
    let list = base;
    if (pin) {
      const have = new Set((pin.products || []).map((p) => numId(p.id)));
      const info = new Map(base.map((x) => [numId(x.id), x]));
      const pinned = (pin.products || []).map((p, i) => { const k = info.get(numId(p.id)) || {}; return { ...k, id: p.id, title: p.title || k.title, image: p.image || k.image, price: k.price ?? null, pinned: i + 1 }; });
      list = [...pinned, ...(pin.onlyListed ? [] : base.filter((x) => !have.has(numId(x.id))))];
    }
    list = list.slice(0, 5);
    const cards = list.length ? list.map((p) => `<span class="pmv__card">
        <span class="pmv__img" style="background-image:url('${esc(thumb(p.image, 300))}')">${p.off ? `<span class="pmv__off">${p.off}% OFF</span>` : ''}${p.pinned ? `<span class="pmv__pin">置顶 ${p.pinned}</span>` : ''}</span>
        <span class="pmv__t">${esc(p.title)}</span>
        <span class="pmv__p">${p.price == null ? '<span class="muted">价格看店里</span>' : `${p.compareAt ? `<s>£${Number(p.compareAt).toFixed(2)}</s>` : ''}<b>£${Number(p.price).toFixed(2)}</b>`}</span></span>`).join('')
      : Array.from({ length: 5 }, () => '<span class="pmv__card pmv__card--ph"><span class="pmv__img"></span><span class="pmv__t"></span></span>').join('');
    return `<div class="pmv ${small ? 'pmv--sm' : ''}" ${pm ? `data-pm="${pm}"` : ''}>
      <div class="pmv__h">${v.title ? `<span style="color:${esc(c.titleColor)}">${esc(v.title)}</span>` : ''}${v.title2 ? `<span style="color:${esc(c.title2Color)}">${esc(v.title2)}</span>` : ''}${!v.title && !v.title2 ? '<span class="muted">(没有标题)</span>' : ''}</div>
      <div class="pmv__tabs">${tabs.map((x, i) => `<span class="pmv__tab" data-pmtab="${i}" style="${i === activeTab ? `background:${esc(c.tabActiveBg)};color:${esc(c.tabActiveText)}` : ''}">${esc(tabLabel(x))}</span>`).join('')}</div>
      ${small ? '' : `<div class="pmv__grid">${cards}</div>
      <div class="pmv__foot">${t ? `${tabSummary(t)}${cached ? ` · 现在符合条件的有 ${cached.shown}${cached.approx ? '+' : ''} 个` : MODE === 'live' ? ' · 正在取产品…' : ' · <b>示例产品</b>(演示模式画的是真实产品的图和名字,价格是编的;切到正式数据就是这个页签真正会出现的产品)'}` : ''}
        ${pin ? `<div class="pmv__pinnote">这一刻这个合集按「<b>${esc(titleOf(pin))}</b>」排:${(pin.products || []).length} 个产品置顶${pin.onlyListed ? ',而且只显示这些' : ''} <button class="linkbtn" data-open="${pin.id}" type="button">改清单</button></div>` : ''}</div>`}
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
        <div class="pm__list">${list.map((m) => `<div class="pmrow-w"><button class="pmrow ${status(m) === 'ended' ? 'is-dim' : ''}" data-open="${m.id}" data-pop="${m.id}" type="button">
          ${miniThumb(m)}
          <span class="pmrow__b"><b>${esc(m.name || '未命名版本')}</b>${m.isDefault ? '<span class="tag">平时版本</span>' : ''}${cur === m ? '<span class="tag tag--ok">正在显示</span>' : ''}
            <span class="pmrow__w">${m.isDefault ? '没有别的版本生效时显示' : `${I.clock}${winText(m)}`}</span>
            <span class="pmrow__tabs">${(m.tabs || []).map((t) => `<span class="chip chip--sm">${esc(tabLabel(t))}</span>`).join('')}</span></span>
          ${endingTag(m)}${syncTag(m)}${m.pendingChange ? '<span class="tag tag--warn">有修改待审核</span>' : ''}${badge(m)}
        </button><button class="btn btn-sm btn-ghost pmrow__dup" data-dup="${m.id}" type="button" title="${m.isDefault ? '从平时版本复制一个新版本出来改' : '复制这个版本'}">${I.copy}复制</button></div>`).join('') || empty('还没有版本。先在「设置 → 店铺连接」点「从主题导入」把现在的配置导进来当平时版本。')}</div>
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
    button2_text: '按钮 2 文字', button2_url: '按钮 2 链接', button1_video: '按钮 1 视频', button2_video: '按钮 2 视频', emoji: 'Emoji', text: '文字', link: '链接', category: '分类',
    name: '名称', collections: '合集', tags: '标签', products: '指定产品', badge: '徽章文字', countdown: '倒计时', priority: '优先级',
    bg: '底色', color: '文字颜色', accent: '点缀色', effect: '特效', decoLeft: '左侧装饰', decoRight: '右侧装饰',
    module: '模块', title2: '标题第二段', titleColor: '第一段颜色', title2Color: '第二段颜色', tabActiveBg: '页签高亮底色', tabActiveText: '页签高亮文字', tabs: '页签', isDefault: '平时版本',
    start: '开始', end: '结束', campaign: '所属活动',
    collection: '合集', onlyListed: '只显示前 N 个', hidden: '不显示的产品', fullOrder: '完全按清单顺序', larkLinks: '关联的飞书任务',
    owner: '负责人', approver: '审批人', cc: '抄送', due: '截止时间',
  };
  const showVal = (k, v) => {
    if (v == null || v === '') return '<span class="muted">(空)</span>';
    if (k === 'start' || k === 'end' || k === 'due') return esc(fDT(v));
    if (k === 'owner' || k === 'approver') return esc(who(v));
    if (k === 'cc') return (v || []).length ? esc(v.map(who).join('、')) : '<span class="muted">(空)</span>';
    if (k === 'campaign') return esc((camp(v) || {}).name || v);
    if (['countdown', 'onlyListed', 'fullOrder', 'isDefault'].includes(k)) return v ? '开' : '关';
    if (k === 'collection') return esc(v.title || v.id || '');
    if (k === 'larkLinks') return (v || []).map((l) => `<div><a class="lk" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || '飞书任务')}↗</a></div>`).join('') || '<span class="muted">(空)</span>';
    if (k === 'products' || k === 'hidden') return (v || []).length ? `<span class="hs-ps">${v.slice(0, 12).map((x, i) => `<span title="${esc(x.title || '')}">${i + 1}. ${esc((x.title || '').slice(0, 28))}</span>`).join('')}${v.length > 12 ? `<span class="muted">…共 ${v.length} 个</span>` : ''}</span>` : '<span class="muted">(空)</span>';
    if (k === 'tag') return esc(TAGCN[v] || v);
    if (k === 'effect') return esc(EFFECT[v] || v);
    if (k === 'module') return esc(MODULE_CN[v] || v);
    if (k === 'tabs') return (v || []).map((t, i) => `<div>${i + 1}. <b>${esc(tabLabel(t))}</b> <span class="muted">${tabSummary(t)}</span></div>`).join('') || '<span class="muted">(空)</span>';
    if (['bg', 'color', 'accent', 'titleColor', 'title2Color', 'tabActiveBg', 'tabActiveText'].includes(k)) return `<span class="swatch" style="background:${esc(v)}"></span> <span class="mono">${esc(v)}</span>`;
    if (k === 'image') return `<img class="rv__img" src="${esc(thumb(v, 300))}" alt="">`;
    if (Array.isArray(v)) return v.length ? esc(v.map((x) => (typeof x === 'string' ? x : x.title)).join('、')) : '<span class="muted">(空)</span>';
    return esc(v);
  };
  // ================= 历史记录 =================
  // 每次保存、提交、批准、退回、暂停、删除、回滚都记一版(服务器 src/item-history.js)。这里能回看、对比、复制、回滚。
  let hsRows = null; let hsPeople = []; let hsBusy = false; const hsF = { kind: '', q: '', by: '' };
  const STATE_CN = { draft: '草稿', pending: '待审核', approved: '已批准', rejected: '已退回', new: '新建' };
  const changedText = (keys) => (keys == null ? '第一版' : keys.length ? `改了:${keys.slice(0, 5).map((k) => FIELD[k] || k).join('、')}${keys.length > 5 ? ` 等 ${keys.length} 项` : ''}` : '');
  async function loadHistoryPage() {
    if (MODE !== 'live') { hsRows = []; return renderHistory(); }
    hsBusy = true; renderHistory();
    try {
      const canPrice = window.cgpCanSee && window.cgpCanSee('price');
      const qs = `q=${encodeURIComponent(hsF.q)}&by=${encodeURIComponent(hsF.by)}`;
      const [a, b] = await Promise.all([
        hsF.kind === 'price' ? { rows: [], people: [] } : api('GET', `/api/schedule/history?kind=${encodeURIComponent(hsF.kind)}&${qs}`),
        canPrice && (!hsF.kind || hsF.kind === 'price') ? api('GET', `/api/price/plan-history?${qs}`).catch(() => ({ rows: [], people: [] })) : { rows: [], people: [] },
      ]);
      hsRows = [...a.rows, ...b.rows].sort((x, y) => y.at - x.at).slice(0, 300);
      hsPeople = [...new Set([...a.people, ...b.people])];
    } catch (e) { hsRows = []; toast(e.message, false); }
    hsBusy = false; renderHistory();
  }
  function renderHistory() {
    const root = $('#hs-root'); if (!root) return;
    const kinds = [['', '全部类型'], ['banner', 'Banner'], ['topbar', '顶栏'], ['tbstyle', '顶栏样式'], ['pmodule', '商品模块'], ['pin', '合集排序'], ['campaign', '活动'],
      ...(window.cgpCanSee && window.cgpCanSee('price') ? [['price', '改价']] : [])];
    const byDay = new Map();
    for (const r of hsRows || []) { const d = fDate(r.at); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
    root.innerHTML = `${pageHead('历史记录', '每一次保存、提交、批准、退回、暂停、删除、回滚都记一版 —— 点开能看那一版的完整内容、和现在对比、复制成新的、回滚回去(回滚也走审批)。')}
      <section class="panel">
        <div class="hs-f">
          <select class="sel" id="hs-kind">${kinds.map(([k, l]) => `<option value="${k}" ${hsF.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input class="inp" id="hs-q" placeholder="按名称找…" value="${esc(hsF.q)}"/>
          <select class="sel" id="hs-by"><option value="">所有人</option>${hsPeople.map((p) => `<option ${hsF.by === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          <button class="btn btn-sm" type="button" id="hs-reload">刷新</button>
        </div>
        ${MODE !== 'live' ? empty('演示模式不记历史;切到正式数据后,每次改动都会记一版。')
          : hsBusy && !hsRows ? '<p class="muted">读取中…</p>'
            : !(hsRows || []).length ? empty('还没有记录。从现在起,每次改动都会记在这里。')
              : [...byDay].map(([d, rows]) => `<div class="hs-day"><div class="hs-day__h">${esc(d)} · ${relDay(rows[0].at)}</div>
                ${rows.map((r) => `<button type="button" class="hsrow" data-hist="${esc(r.id)}">
                  <span class="hsrow__t">${fmt(r.at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span>
                  ${kindChip(r.kind)}
                  <span class="hsrow__n"><b>${esc(r.title || '(未命名)')}</b>${r.gone ? '<span class="tag tag--danger">已删除</span>' : ''}</span>
                  <span class="hsrow__a">${esc(r.action || '')}</span>
                  <span class="hsrow__c muted">${esc(r.kind === 'price' ? planChangedText(r.changed) : changedText(r.changed))}${r.pendingKeys.length ? `${r.changed?.length ? ';' : ''}待审核的修改:${esc(r.pendingKeys.slice(0, 4).map((k) => FIELD[k] || k).join('、'))}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</span>
                  <span class="hsrow__by muted">${esc(r.by || '')}</span>
                </button>`).join('')}</div>`).join('')}
      </section>`;
    $('#hs-kind').onchange = (e) => { hsF.kind = e.target.value; loadHistoryPage(); };
    $('#hs-by').onchange = (e) => { hsF.by = e.target.value; loadHistoryPage(); };
    $('#hs-q').onkeydown = (e) => { if (e.key === 'Enter') { hsF.q = e.target.value.trim(); loadHistoryPage(); } };
    $('#hs-reload').onclick = () => loadHistoryPage();
    $$('#hs-root [data-hist]').forEach((b) => b.addEventListener('click', () => (hsRows.find((r) => r.id === b.dataset.hist)?.kind === 'price' ? openPlanHistory(b.dataset.hist) : openItemHistory(b.dataset.hist))));
  }

  // 单条内容的全部版本:左边版本列表,右边「这一版 vs 现在」逐项对比;复制成新的 / 回滚(回滚照常走审批)
  async function openItemHistory(id) {
    hidePop();
    $('#drawer').innerHTML = `<div class="drawer__h"><div><b>历史版本</b> <span class="muted" id="ih-title"></span></div>
        <button class="btn btn-ghost" data-act="close" type="button" aria-label="关闭">${I.x}</button></div>
      <div class="drawer__b drawer__b--hist"><div class="hist__list" id="ih-list"><p class="muted">读取中…</p></div><div class="hist__pv" id="ih-pv"></div></div>
      <div class="drawer__f"><span class="muted" id="ih-tip"></span><div class="drawer__acts" id="ih-acts"></div></div>`;
    $('#drawer').hidden = false; $('#drawer-mask').hidden = false; document.body.classList.add('no-scroll');
    $('#drawer').onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeDrawer(); };
    let r;
    try { r = await api('GET', `/api/schedule/history?id=${encodeURIComponent(id)}`); }
    catch (e) { $('#ih-list').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const cur = r.item; const kind = r.kind || cur?.kind;
    $('#ih-title').innerHTML = `${kindChip(kind)} ${esc(cur ? titleOf(cur) : r.title || '')}${cur ? '' : ' <span class="tag tag--danger">已删除</span>'}`;
    if (!r.versions.length) { $('#ih-list').innerHTML = '<p class="muted">这条内容还没有历史记录(历史功能上线前的改动没有记)。之后每次改动都会记一版。</p>'; return; }
    $('#ih-list').innerHTML = r.versions.map((v, i) => `<button type="button" class="hist__i" data-i="${i}">
        <span class="hist__t"><b>${esc(fDT(v.at))}</b>${i === 0 ? '<span class="tag tag--ok">最新</span>' : ''}</span>
        <span class="hist__w">${esc(v.action || '')}${v.by ? ` · ${esc(v.by)}` : ''}</span>
        <span class="hist__c">${esc(STATE_CN[v.state] || v.state || '')}${v.paused ? ' · 暂停中' : ''}${v.deleted ? ' · 已删除' : ''}${v.changed?.length ? ` · ${esc(changedText(v.changed))}` : ''}</span></button>`).join('');
    const curVals = cur ? (() => { const o = {}; for (const k of Object.keys(FIELD)) if (k in cur) o[k] = cur[k]; return o; })() : null;
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || ((a == null || a === '') && (b == null || b === ''));
    const show = (i) => {
      const v = r.versions[i];
      $$('#ih-list .hist__i').forEach((b) => b.classList.toggle('is-on', +b.dataset.i === i));
      const keys = [...new Set([...Object.keys(v.values), ...(curVals ? Object.keys(curVals) : [])])].filter((k) => FIELD[k]);
      const diffKeys = curVals ? keys.filter((k) => !same(v.values[k], curVals[k])) : [];
      const rows = (curVals ? keys : Object.keys(v.values).filter((k) => FIELD[k])).map((k) => {
        const d = curVals && diffKeys.includes(k);
        return `<tr class="${d ? 'is-diff' : ''}"><td>${FIELD[k]}</td><td>${showVal(k, v.values[k])}</td>${curVals ? `<td>${showVal(k, curVals[k])}</td>` : ''}</tr>`;
      }).join('');
      $('#ih-pv').innerHTML = `<div class="hist__h"><b>${esc(fDT(v.at))} 那一版</b> <span class="muted">${esc(v.action || '')}${v.by ? ` · ${esc(v.by)}` : ''}${v.note ? ` · ${esc(v.note)}` : ''}</span></div>
        <p class="muted">那时的状态:${esc(STATE_CN[v.state] || v.state || '')}${v.paused ? ' · 暂停中' : ''}${v.deleted ? ' · 这一版之后被删除了' : ''}${curVals ? ` · <b>${diffKeys.length ? `和现在有 ${diffKeys.length} 处不一样(标黄的行)` : '和现在一模一样'}</b>` : ''}</p>
        <table class="rvdiff ihdiff"><thead><tr><th>字段</th><th>这一版</th>${curVals ? '<th>现在</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
        ${v.pending ? `<p class="muted" style="margin-top:12px">这一版还有一个<b>等审批的修改</b>(那时线上还是上面的内容):</p>
          <table class="rvdiff ihdiff"><tbody>${Object.entries(v.pending).filter(([k]) => FIELD[k]).map(([k, x]) => `<tr><td>${FIELD[k]}</td><td>${showVal(k, x)}</td></tr>`).join('')}</tbody></table>` : ''}`;
      // 按钮
      const canRollback = cur && diffKeys.length;
      const mode = !cur ? null : cur.state === 'approved' ? (canAppr(cur) ? 'publish' : 'submit') : cur.state === 'pending' ? 'submit' : 'draft';
      $('#ih-tip').textContent = !cur ? '这条内容已经删掉了,可以复制成一条新的(恢复)' : canRollback
        ? (mode === 'publish' ? '你是审批人:回滚马上生效' : mode === 'submit' ? '回滚会提交给审批人,批准前线上保持现在的内容' : '回滚后存为草稿') : '';
      $('#ih-acts').innerHTML = `<button class="btn" type="button" id="ih-copy">${cur ? '复制成新的' : '复制成新的(恢复)'}</button>
        ${canRollback ? `<button class="btn btn-primary" type="button" id="ih-rb">${mode === 'publish' ? '回滚到这一版' : mode === 'submit' ? '回滚到这一版(提交审核)' : '回滚到这一版(存草稿)'}</button>` : ''}`;
      $('#ih-copy').onclick = () => {
        const vals = JSON.parse(JSON.stringify(v.values));
        const prefix = { banner: 'b-', topbar: 't-', tbstyle: 's-', pmodule: 'pm-', pin: 'pin-', campaign: 'c-' }[kind] || 'x-';
        if (kind === 'pmodule') vals.tabs = (vals.tabs || []).map((t) => { const { shopifyId, ...rest } = t; return { ...rest, id: rid('tab-') }; }); // eslint-disable-line no-unused-vars
        if ('name' in vals) vals.name = `${vals.name || ''}(复制)`;
        closeDrawer();
        openEditor(kind, null, { dup: { ...vals, id: rid(prefix), kind, state: 'new', by: S.me, shopifyId: null, syncedStatus: null, syncedTabIds: [], pendingChange: null, paused: false, isDefault: false } });
        toast(`已复制 ${fDT(v.at)} 那一版,改好再保存`);
      };
      if ($('#ih-rb')) $('#ih-rb').onclick = async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = mode === 'publish' ? '再点一次确认回滚(马上生效)' : '再点一次确认'; b.classList.add('btn-danger'); return; }
        b.disabled = true;
        const res = await act({ type: 'save', mode, kind, id: cur.id, isNew: false, values: JSON.parse(JSON.stringify(v.values)), historyNote: `回滚到 ${fDT(v.at)} 那一版` });
        if (!res) { b.disabled = false; return; }
        toast([`已回滚到 ${fDT(v.at)} 那一版${mode === 'submit' ? ',等审批人批准' : mode === 'draft' ? ',存为草稿' : ''}`, ...colSay(res.colRep, cur.collection?.id)].join(' · '));
        openItemHistory(cur.id);
      };
    };
    $$('#ih-list .hist__i').forEach((b) => b.addEventListener('click', () => show(+b.dataset.i)));
    show(Math.min(1, r.versions.length - 1)); // 默认看上一版(和现在比最有用)
  }

  // ---- 改价计划的历史版本(字段和网站内容不一样,单独一套显示)----
  const PFIELD = { name: '名称', kind: '类型', layer: '层级', groups: '改价分组', rule: '改价规则', scope: '改哪些产品', slots: '时间段和产品', compare: '划线价', campaign: '所属活动',
    followCampaign: '跟随活动时间', tagsAdd: '生效时加标签', tagsRemove: '生效时去标签', approver: '审批人', owner: '负责人', cc: '抄送', note: '备注', color: '颜色' };
  const RULE_CN = { percent_off: (v) => `降价 ${v}%`, amount_off: (v) => `每个减 £${v}`, fixed: (v) => `统一改成 £${v}`, percent_up: (v) => `涨价 ${v}%`, keep: () => '售价不变,只改划线价', manual: () => '逐个填价' };
  const planChangedText = (keys) => (keys == null ? '第一版' : keys.length ? `改了:${keys.slice(0, 5).map((k) => PFIELD[k] || k).join('、')}${keys.length > 5 ? ` 等 ${keys.length} 项` : ''}` : '');
  function pShowVal(k, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="muted">(空)</span>';
    if (k === 'kind') return v === 'permanent' ? '永久调价' : '限时(到期恢复原价)';
    if (k === 'layer') return esc({ flash: '限时抢购', brand: '品牌 / 合集', sitewide: '全场' }[v] || v);
    if (k === 'compare') return esc({ original: '原价作为划线价', keep: '划线价不变', none: '不显示划线价' }[v] || v);
    if (k === 'rule') return `${esc((RULE_CN[v.mode] || ((x) => `${v.mode} ${x}`))(v.value))}${v.rounding ? `,尾数 ${esc(v.rounding)}` : ''}`;
    if (k === 'scope') {
      const m = { collections: `指定合集:${(v.collections || []).map((c) => c.title || c.id).join('、')}`, products: `指定产品 ${(v.products || []).length} 个`,
        search: `按品牌 / 标签 / 类型:${[v.vendor, v.tag, v.type].filter(Boolean).join(' / ')}`, all: '全店所有产品' }[v.mode];
      return esc(m || v.mode || '');
    }
    if (k === 'groups') return v.map((g, i) => `<div>${v.length > 1 ? `第 ${i + 1} 组:` : ''}${pShowVal('scope', g.scope)} · ${pShowVal('rule', g.rule)}</div>`).join('');
    if (k === 'slots') return v.map((x) => {
      const ps = (x.items || []).map((i) => Number(i.price)).filter((n) => n > 0);
      const lo = ps.length ? Math.min(...ps) : null; const hi = ps.length ? Math.max(...ps) : null;
      return `<div>${esc(fDT(x.start))} → ${x.end ? esc(fDT(x.end)) : '不结束'} · ${(x.items || []).length} 个变体${lo != null ? ` · 活动价 ${lo === hi ? gbp(lo) : `${gbp(lo)}–${gbp(hi)}`}` : ''}</div>`;
    }).join('');
    if (k === 'campaign') return esc((camp(v) || {}).name || v);
    if (k === 'followCampaign') return v ? '开' : '关';
    if (k === 'approver' || k === 'owner') return esc(who(v));
    if (k === 'cc') return esc((v || []).map(who).join('、'));
    if (k === 'tagsAdd' || k === 'tagsRemove') return esc(v.join('、'));
    if (k === 'color') return `<span class="swatch" style="background:${esc(v)}"></span>`;
    return esc(typeof v === 'object' ? JSON.stringify(v) : v);
  }
  const PSTATE = { draft: '草稿', pending: '待审核', approved: '已批准', rejected: '已退回', new: '新建' };
  async function openPlanHistory(id) {
    hidePop();
    $('#drawer').innerHTML = `<div class="drawer__h"><div><b>改价计划 · 历史版本</b> <span class="muted" id="ih-title"></span></div>
        <button class="btn btn-ghost" data-act="close" type="button" aria-label="关闭">${I.x}</button></div>
      <div class="drawer__b drawer__b--hist"><div class="hist__list" id="ih-list"><p class="muted">读取中…</p></div><div class="hist__pv" id="ih-pv"></div></div>
      <div class="drawer__f"><span class="muted" id="ih-tip"></span><div class="drawer__acts" id="ih-acts"></div></div>`;
    $('#drawer').hidden = false; $('#drawer-mask').hidden = false; document.body.classList.add('no-scroll');
    $('#drawer').onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeDrawer(); };
    let r;
    try { r = await api('GET', `/api/price/plan-history?id=${encodeURIComponent(id)}`); }
    catch (e) { $('#ih-list').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const cur = r.item;
    $('#ih-title').innerHTML = `${esc(cur?.name || r.title || '')}${cur ? '' : ' <span class="tag tag--danger">已删除</span>'}`;
    if (!r.versions.length) { $('#ih-list').innerHTML = '<p class="muted">这个计划还没有历史记录(历史功能上线前的改动没有记)。之后每次改动都会记一版。</p>'; return; }
    $('#ih-list').innerHTML = r.versions.map((v, i) => `<button type="button" class="hist__i" data-i="${i}">
        <span class="hist__t"><b>${esc(fDT(v.at))}</b>${i === 0 ? '<span class="tag tag--ok">最新</span>' : ''}</span>
        <span class="hist__w">${esc(v.action || '')}${v.by ? ` · ${esc(v.by)}` : ''}</span>
        <span class="hist__c">${esc(PSTATE[v.state] || v.state || '')}${v.paused ? ' · 暂停中' : ''}${v.stopped ? ' · 已提前结束' : ''}${v.deleted ? ' · 已删除' : ''}${v.changed?.length ? ` · ${esc(planChangedText(v.changed))}` : ''}</span></button>`).join('');
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const show = (i) => {
      const v = r.versions[i];
      $$('#ih-list .hist__i').forEach((b) => b.classList.toggle('is-on', +b.dataset.i === i));
      const keys = Object.keys(PFIELD).filter((k) => k in v.values || (cur && k in cur));
      const diffKeys = cur ? keys.filter((k) => !same(v.values[k], cur[k])) : [];
      $('#ih-pv').innerHTML = `<div class="hist__h"><b>${esc(fDT(v.at))} 那一版</b> <span class="muted">${esc(v.action || '')}${v.by ? ` · ${esc(v.by)}` : ''}${v.note ? ` · ${esc(v.note)}` : ''}</span></div>
        <p class="muted">那时的状态:${esc(PSTATE[v.state] || v.state || '')}${v.paused ? ' · 暂停中' : ''}${v.stopped ? ' · 已提前结束' : ''}${v.deleted ? ' · 这一版之后被删除了' : ''}${cur ? ` · <b>${diffKeys.length ? `和现在有 ${diffKeys.length} 处不一样(标黄的行)` : '和现在一模一样'}</b>` : ''}</p>
        <table class="rvdiff ihdiff"><thead><tr><th>字段</th><th>这一版</th>${cur ? '<th>现在</th>' : ''}</tr></thead><tbody>
          ${keys.map((k) => `<tr class="${diffKeys.includes(k) ? 'is-diff' : ''}"><td>${PFIELD[k]}</td><td>${pShowVal(k, v.values[k])}</td>${cur ? `<td>${pShowVal(k, cur[k])}</td>` : ''}</tr>`).join('')}</tbody></table>`;
      const canRollback = cur && diffKeys.length && !['ended', 'done'].includes(cur.state);
      const mode = !cur ? null : ['approved', 'pending'].includes(cur.state) ? 'submit' : 'draft';
      $('#ih-tip').textContent = !cur ? '这个计划已经删掉了,可以复制成一个新计划(恢复)'
        : canRollback ? (mode === 'submit' ? '回滚后:你是这个计划的审批人就马上生效,不是就提交给审批人;已经开始的时段按改价规则锁定,改不了' : '回滚后存为草稿') : '';
      $('#ih-acts').innerHTML = `<button class="btn" type="button" id="ih-copy">${cur ? '复制成新计划' : '复制成新计划(恢复)'}</button>
        ${canRollback ? `<button class="btn btn-primary" type="button" id="ih-rb">回滚到这一版</button>` : ''}`;
      $('#ih-copy').onclick = async () => {
        closeDrawer(); showSection('price');
        if (window.cgpPriceCopy) await window.cgpPriceCopy(JSON.parse(JSON.stringify(v.values)), fDT(v.at));
      };
      if ($('#ih-rb')) $('#ih-rb').onclick = async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次确认回滚'; b.classList.add('btn-danger'); return; }
        b.disabled = true;
        try {
          const x = await api('POST', '/api/price/act', { action: { type: 'save', mode, id: cur.id, isNew: false, values: JSON.parse(JSON.stringify(v.values)), historyNote: `回滚到 ${fDT(v.at)} 那一版` } });
          toast(`${x.message || '已回滚'} · 回到 ${fDT(v.at)} 那一版`);
          if (window.cgpPriceRefresh) window.cgpPriceRefresh();
          openPlanHistory(cur.id);
        } catch (err) { toast(err.message, false); b.disabled = false; b.textContent = '回滚到这一版'; delete b.dataset.sure; b.classList.remove('btn-danger'); }
      };
    };
    $$('#ih-list .hist__i').forEach((b) => b.addEventListener('click', () => show(+b.dataset.i)));
    show(Math.min(1, r.versions.length - 1));
  }
  window.cgpPlanHistory = (id) => openPlanHistory(id);

  // ================= 我的工作 =================
  // 等我审批 / 要我处理(被退回、快到截止)/ 我负责的 / 我提交的 / 抄送我的;改价计划也算(能看改价页的人)
  let mwPrice = null; // { at, plans, me }
  async function loadMwPrice(force) {
    if (MODE !== 'live' || !window.cgpCanSee?.('price')) return;
    if (!force && mwPrice && now() - mwPrice.at < 60000) return;
    try { const r = await api('GET', '/api/price/state'); mwPrice = { at: now(), plans: r.plans || [], me: r.me || {} }; }
    catch { mwPrice = { at: now(), plans: [], me: {} }; }
    renderMyWork();
  }
  const planEnded = (p) => p.stopped || p.done || (p.state === 'approved' && p.kind === 'window' && (p.slots || []).every((x) => x.end != null && x.end <= now()));
  function myWork() {
    const mid = me().id; const admin = isApprover();
    const out = { approve: [], fix: [], own: [], submitted: [], cc: [] };
    for (const it of all()) {
      if (it.isDefault) continue;
      const ended = status(it) === 'ended';
      const waiting = it.state === 'pending' || !!it.pendingChange;
      const subBy = it.pendingChange ? it.pendingChange.by : it.by;
      const ea = effAppr(it);
      const row = { kind: it.kind, id: it.id, title: titleOf(it), it };
      if (waiting && subBy !== mid && (ea ? ea === mid : admin)) out.approve.push({ ...row, why: `${who(subBy)} ${fAgo(it.pendingChange?.at || it.submittedAt || now())}提交${it.pendingChange ? '了修改' : ''}` });
      const mine = it.owner === mid || (!it.owner && it.by === mid);
      const dueSoon = it.due != null && ['new', 'draft', 'rejected'].includes(it.state) && it.due - now() <= DAY;
      if (mine && (it.state === 'rejected' || (it.lastReject && !it.pendingChange) || dueSoon)) {
        out.fix.push({ ...row, why: it.state === 'rejected' ? `被退回:${it.rejectNote || '(没写原因)'}` : it.lastReject && !it.pendingChange ? `修改被退回:${it.lastReject.note || ''}` : '', due: it.due, warn: true });
      } else if (it.owner === mid && !ended) out.own.push({ ...row, due: ['new', 'draft', 'rejected'].includes(it.state) ? it.due : null }); // 交了就不再提截止
      if (waiting && subBy === mid) out.submitted.push({ ...row, why: `等「${apprName(it)}」审批` });
      if ((it.cc || []).includes(mid) && !ended) out.cc.push({ ...row, why: it.owner ? `负责人 ${who(it.owner)}` : '' });
    }
    for (const p of mwPrice?.plans || []) {
      const ended = planEnded(p); const waiting = p.state === 'pending' || !!p.pendingChange;
      const subBy = p.pendingChange?.by || p.submittedBy;
      const row = { kind: 'price', id: p.id, title: p.name || '未命名改价计划', plan: p };
      if (waiting && subBy !== mid && (p.approver ? p.approver === mid : mwPrice.me.admin)) out.approve.push({ ...row, why: `${who(subBy)} 提交${p.pendingChange ? '了修改' : ''}` });
      const mine = p.owner === mid || (!p.owner && (p.submittedBy || p.createdBy) === mid);
      if (mine && p.state === 'rejected') out.fix.push({ ...row, why: `被退回:${p.rejectNote || '(没写原因)'}`, warn: true });
      else if (p.owner === mid && !ended) out.own.push(row);
      if (waiting && subBy === mid) out.submitted.push({ ...row, why: `等「${p.approver ? who(p.approver) : '管理员'}」审批` });
      if ((p.cc || []).includes(mid) && !ended) out.cc.push({ ...row, why: p.owner ? `负责人 ${who(p.owner)}` : '' });
    }
    return out;
  }
  const PSTAT = { pending: '待审核', rejected: '已退回', draft: '草稿' };
  function mwRow(r) {
    const due = r.due != null ? `<span class="tag ${r.due < now() ? 'tag--danger' : r.due - now() <= DAY ? 'tag--warn' : ''}">截止 ${esc(relDay(r.due))} ${esc(fmt(r.due, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))}${r.due < now() ? ' · 已过' : ''}</span>` : '';
    const st = r.it ? badge(r.it) : `<span class="stb stb--${r.plan.state === 'approved' ? (planEnded(r.plan) ? 'ended' : 'live') : r.plan.state}"><span class="dot"></span>${PSTAT[r.plan.state] || (planEnded(r.plan) ? '已结束' : '已批准')}</span>`;
    const when = r.it ? winText(r.it) : (r.plan.slots || []).length ? `${fDT(Math.min(...r.plan.slots.map((x) => x.start)))} 起` : '';
    return `<button type="button" class="mwrow ${r.warn ? 'is-warn' : ''}" ${r.it ? `data-open="${esc(r.id)}"` : `data-price="${esc(r.id)}"`}>
      <span class="mwrow__h">${kindChip(r.kind)}<b>${esc(r.title)}</b>${st}${due}</span>
      <span class="mwrow__s muted">${r.why ? `${esc(r.why)} · ` : ''}${when}</span></button>`;
  }
  function renderMyWork() {
    const root = $('#mw-root'); if (!root || !S) return;
    const w = myWork();
    const n = w.approve.length + w.fix.length;
    const b = $('#n-mw'); if (b) { b.hidden = !n; b.textContent = n; }
    if (!isActive('mywork')) return;
    const box = (title, hint, rows, emptyMsg) => `<section class="panel mwbox"><div class="panel__h"><h3>${title} <span class="muted">${rows.length}</span></h3><span class="muted">${hint}</span></div>
      ${rows.length ? `<div class="mwlist">${rows.map(mwRow).join('')}</div>` : `<p class="muted">${emptyMsg}</p>`}</section>`;
    root.innerHTML = `${pageHead('我的工作', `${esc(me().name)} 的待办:要你批的、要你改的、你负责和关注的。点一条直接打开。`)}
      <div class="mwgrid">
        ${box('✅ 等我审批', '你是审批人(没指定审批人的由管理员批)', w.approve, '没有等你批的 👍')}
        ${box('🛠 要我处理', '被退回的、明天截止或已过截止还没提交的', w.fix, '没有要处理的')}
        ${box('📌 我负责的', '负责人是你、还没结束的', w.own, '还没有你负责的内容')}
        ${box('⏳ 我提交的', '等别人审批', w.submitted, '没有在等审批的')}
        ${box('👀 抄送我的', '只通知,不用你操作', w.cc, '没有抄送给你的')}
      </div>
      ${MODE === 'live' && window.cgpCanSee?.('price') && !mwPrice ? '<p class="muted">改价计划读取中…</p>' : ''}`;
  }

  function renderReviews() {
    const list = pendingList().sort((a, b) => canAppr(b) - canAppr(a)); // 轮到我批的排前面
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
          <span class="muted">${esc(who(by))} · ${at ? fAgo(at) : ''}提交 · 审批人 ${esc(apprName(it))}${it.owner ? ` · 负责人 ${esc(who(it.owner))}` : ''}</span></div>
        ${body}
        <div class="rvcard__act">
          <button class="btn btn-sm" data-open="${it.id}" type="button">查看详情</button>
          ${canAppr(it) ? `<button class="btn btn-sm btn-danger" data-reject="${it.id}" type="button">退回</button>
            <button class="btn btn-sm btn-primary" data-approve="${it.id}" type="button">批准</button>` : `<span class="muted">等「${esc(apprName(it))}」审批</span>`}
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
        <div class="rvcard__act">${canOrd(o.kind) ? `<button class="btn btn-sm btn-danger" data-reject="__order" type="button">退回</button><button class="btn btn-sm btn-primary" data-approve="__order" type="button">批准</button>` : `<span class="muted">等「${esc(appr()[o.kind] ? who(appr()[o.kind]) : '管理员')}」审批</span>`}</div>
      </div>`;
    };
    $('#rv-root').innerHTML = `
      ${pageHead('审核', '所有等审批的新内容和修改。轮到你批的排在前面,有「批准 / 退回」按钮;批准后按时间自动上线,退回会附上你的意见。')}
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
    toast([s === 'scheduled' ? `已批准 · 将在 ${fDT(win(it).start)} 自动上线` : s === 'live' ? '已批准 · 已上线' : `已批准${s ? ' · ' + ST[s] : ''}`, ...colSay(r.colRep, it?.collection?.id)].join(' · '), !(r.colRep?.failures?.length));
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
      ${me.testMode?.on ? `<div class="note note--danger">测试模式开着(${esc(me.testMode.byName || '')} 开的),还有 ${Math.max(1, Math.round(me.testMode.left / 60000))} 分钟自动关。
        <button class="btn btn-sm" data-tm="off" type="button">立即关闭</button></div>`
        : me.canStartTestMode ? `<div class="note">想不登录飞书直接试?打开<b>测试模式</b>:从 Shopify 后台打开 app 的人不用登录、直接是管理员(直接开网址的人不受影响,仍要登录)。
        <div class="rowin" style="margin-top:6px"><select class="sel sel--sm" id="tm-hours">${[0.5, 1, 2, 4, 8].filter((h) => h <= (me.testModeMaxHours || 8)).map((h) => `<option value="${h}" ${h === 2 ? 'selected' : ''}>${h < 1 ? '30 分钟' : h + ' 小时'}</option>`).join('')}</select>
        <button class="btn btn-sm btn-danger-t" data-tm="on" type="button">打开测试模式</button></div></div>` : ''}
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
    $$('#st-root [data-tm]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.tm === 'on';
      if (on && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次确认打开'; setTimeout(() => { if (b.dataset.sure) { delete b.dataset.sure; b.textContent = '打开测试模式'; } }, 4000); return; }
      b.disabled = true;
      try {
        await api('POST', '/api/test-mode', { on, hours: on ? Number($('#tm-hours').value) : undefined });
        toast(on ? '测试模式已打开' : '测试模式已关闭'); location.reload();
      } catch (e) { toast(e.message, false); b.disabled = false; }
    }));
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

  // ================= 设置 → 清理内容(一次删掉测试时建的内容;规则在 /lib/schedule-actions.js 的 purge)=================
  const cl = { q: '', sel: new Set(), sure: 0 };
  const CL_KINDS = [['campaign', '活动'], ['banner', 'Banner'], ['topbar', '顶栏公告'], ['tbstyle', '顶栏样式'], ['pmodule', '首页商品模块'], ['pin', '合集置顶'], ['salelink', '促销链接'], ['callout', '产品页推广']];
  const clFollowers = (c) => all().filter((x) => x.campaign === c.id && x.start == null && x.end == null);
  const clMatch = (x) => { const q = cl.q.trim().toLowerCase(); return !q || [titleOf(x), x.name, x.slug, x.collection?.title].some((v) => String(v || '').toLowerCase().includes(q)); };
  const clItems = () => all().filter((x) => !x.isDefault && clMatch(x));
  function drawClean() {
    const box = $('#st-clean'); if (!box) return;
    box.innerHTML = `<section class="panel">
        <div class="panel__h"><h3>清理内容</h3><span class="muted">一次删掉测试时建的内容</span></div>
        <p class="muted">勾上要删的,点「删除选中的」。店铺里对应的条目会一起删掉:<b>正在网站上显示的会立刻消失</b>,合集置顶删了合集会恢复原来的顺序。
          默认样式和商品模块的「平时版本」不能删;改价计划在「改价」页里单独删。</p>
        <div class="cltools"><input class="inp" id="cl-q" placeholder="按名字筛选,比如 test、测试、bfcm" value="${esc(cl.q)}"/>
          <button class="btn btn-sm" data-clpick="draft" type="button">勾上所有草稿</button><button class="btn btn-sm" data-clpick="ended" type="button">勾上所有已结束</button>
          <button class="btn btn-sm btn-ghost" data-clpick="none" type="button">全部取消</button></div>
        <div id="cl-list"></div>
      </section>
      <section class="panel">
        <div class="panel__h"><h3>清理记录</h3><span class="muted">测试留下的日志和历史版本</span></div>
        <p class="muted">「已删除内容的历史版本」= 历史记录页里那些已经删掉的内容;还在的内容的历史版本不动。</p>
        <div class="rowin"><button class="btn btn-sm" data-clh="deleted" type="button">删掉已删除内容的历史版本</button><button class="btn btn-sm btn-danger-t" data-clh="log" type="button">清空操作日志</button></div>
      </section>`;
    drawCleanList();
    $('#cl-q').addEventListener('input', (e) => { cl.q = e.target.value; cl.sure = 0; drawCleanList(); });
    $$('#st-clean [data-clpick]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.clpick;
      if (k === 'none') cl.sel.clear();
      else clItems().filter((x) => status(x) === k).forEach((x) => clPick(x, true));
      cl.sure = 0; drawCleanList();
    }));
    $$('#st-clean [data-clh]').forEach((b) => b.addEventListener('click', () => clearRecords(b)));
  }
  // 勾活动 = 连同跟随它时间的内容一起勾(不然删不掉);取消跟随的内容 = 活动也取消
  function clPick(x, on) {
    if (on) { cl.sel.add(x.id); if (x.kind === 'campaign') clFollowers(x).forEach((f) => cl.sel.add(f.id)); return; }
    cl.sel.delete(x.id);
    if (x.kind === 'campaign') clFollowers(x).forEach((f) => cl.sel.delete(f.id));
    else if (x.campaign && x.start == null && x.end == null) cl.sel.delete(x.campaign);
  }
  function drawCleanList() {
    const el = $('#cl-list'); if (!el) return;
    for (const id of [...cl.sel]) if (!byId(id)) cl.sel.delete(id); // 已经不在的(被删了)去掉
    const items = clItems();
    const groups = CL_KINDS.map(([k, label]) => {
      const list = items.filter((x) => x.kind === k); if (!list.length) return '';
      const allOn = list.every((x) => cl.sel.has(x.id));
      return `<div class="clgrp"><label class="clgrp__h"><input type="checkbox" data-clall="${k}" ${allOn ? 'checked' : ''}/><b>${label}</b><span class="muted">${list.length}</span></label>
        ${list.map((x) => { const w = win(x); const fol = x.kind === 'campaign' ? clFollowers(x).length : 0;
          return `<label class="clrow ${cl.sel.has(x.id) ? 'is-on' : ''}"><input type="checkbox" data-cl="${x.id}" ${cl.sel.has(x.id) ? 'checked' : ''}/>${miniThumb(x)}
            <span class="clrow__t">${esc(titleOf(x))}${fol ? `<span class="muted">(勾上会连同跟随它的 ${fol} 条一起删)</span>` : ''}</span>${badge(x)}
            <span class="muted clrow__w">${w.start != null ? fMD(w.start) : '长期'} → ${w.end != null ? fMD(w.end) : '长期'}</span></label>`; }).join('')}</div>`;
    }).join('');
    const sel = [...cl.sel].map(byId).filter(Boolean);
    const liveN = sel.filter((x) => status(x) === 'live').length;
    el.innerHTML = `<div class="cllist">${groups || `<p class="muted">${cl.q ? '没有名字里带这几个字的内容' : '没有可以删的内容'}</p>`}</div>
      <div class="clfoot"><span>已勾 <b>${sel.length}</b> 条${liveN ? `,其中 <b class="cl-live">${liveN} 条正在网站上显示</b>` : ''}</span>
        <button class="btn ${cl.sure ? 'btn-danger' : 'btn-danger-t'}" id="cl-go" type="button" ${sel.length ? '' : 'disabled'}>${cl.sure ? `确认删除这 ${sel.length} 条(删了不能恢复)` : '删除勾上的'}</button></div>`;
    $$('#cl-list [data-cl]').forEach((c) => c.addEventListener('change', () => { const x = byId(c.dataset.cl); if (x) clPick(x, c.checked); cl.sure = 0; drawCleanList(); }));
    $$('#cl-list [data-clall]').forEach((c) => c.addEventListener('change', () => { items.filter((x) => x.kind === c.dataset.clall).forEach((x) => clPick(x, c.checked)); cl.sure = 0; drawCleanList(); }));
    $('#cl-go').addEventListener('click', async (e) => {
      if (!cl.sure) { cl.sure = Date.now(); drawCleanList(); setTimeout(() => { if (cl.sure && Date.now() - cl.sure >= 5900) { cl.sure = 0; drawCleanList(); } }, 6000); return; }
      e.target.disabled = true; e.target.textContent = '删除中…';
      const ids = sel.map((x) => x.id); cl.sure = 0;
      const r = await act({ type: 'purge', ids });
      if (!r) { drawCleanList(); return; }
      cl.sel.clear(); toast(r.message || `已删除 ${ids.length} 条`);
      if (r.colRep?.failures?.length) toast('合集顺序恢复时出错:' + (r.colRep.failures[0].message || ''), false);
    });
  }
  async function clearRecords(b) {
    const what = b.dataset.clh;
    if (!b.dataset.sure) { b.dataset.sure = '1'; const t = b.textContent; b.textContent = '再点一次确认'; setTimeout(() => { if (b.dataset.sure) { delete b.dataset.sure; b.textContent = t; } }, 4000); return; }
    b.disabled = true;
    if (MODE !== 'live') { if (what === 'log') S.log = []; save(); renderAll(); toast('已清理(演示)'); return; }
    try { const v = await api('POST', '/api/schedule/clear-history', { [what]: true }); S = await normalizeLive(v); renderAll(); toast(v.message || '已清理'); }
    catch (err) { toast(err.message, false); b.disabled = false; }
  }

  function renderSettings() {
    const N = S.settings.notify; if (N.due === undefined) N.due = true;
    const live = MODE === 'live';
    const larkOn = !!window.CGP_ME?.larkEnabled; // 开了飞书登录:成员管理和数据模式无关,一直显示
    const teamOn = team(); // 多人协作关着:不显示成员与角色、默认审批人、只跟分工有关的通知
    const tg = (k, label, hint) => `<label class="tgl"><input type="checkbox" data-notify="${k}" ${N[k] ? 'checked' : ''} ${live && !isApprover() ? 'disabled' : ''}/><span class="tgl__ui"></span><span><b>${label}</b><span class="muted">${hint}</span></span></label>`;
    const hookVal = live ? '' : esc(S.settings.larkWebhook || '');
    const hookPh = live && S.settings.larkWebhookSet ? `已设置(结尾 ${esc(S.settings.larkWebhookTail)}),要换就粘贴新地址` : 'https://open.larksuite.com/open-apis/bot/v2/hook/…';
    $('#st-root').innerHTML = `
      ${pageHead('设置', teamOn ? '店铺连接、成员与审核、飞书通知、定时器、清理和操作日志' : '店铺连接、飞书通知、定时器、清理测试内容和操作日志')}
      <section class="panel conn" id="st-conn"><div class="panel__h"><h3>店铺连接(正式数据)</h3></div><p class="muted">检查中…</p></section>
      ${larkOn ? larkPanelsHtml() : ''}
      <div class="stgrid">
        ${larkOn || (!live && !teamOn) ? '' : `<section class="panel">
          ${live ? `<div class="panel__h"><h3>我</h3>${teamOn ? `<span class="tag ${isApprover() ? 'tag--ok' : ''}">${isApprover() ? '审核人' : '编辑'}</span>` : ''}</div>
            <p class="muted">系统按登录 Shopify 后台的员工账号认人。${teamOn ? '第一个打开的人自动成为审核人。' : ''}起个名字,飞书通知和日志里会显示。</p>
            <div class="rowin"><input class="inp" id="st-myname" value="${esc(me().name)}" maxlength="30"/><button class="btn btn-sm" id="st-myname-save" type="button">保存</button></div>`
          : `<div class="panel__h"><h3>当前身份</h3><span class="tag tag--warn">演示用</span></div>
            <p class="muted">正式版会自动识别登录 Shopify 后台的员工。演示时切换身份,就能分别体验「编辑提交」和「审核人批准」两边。</p>
            <select class="sel" id="st-me">${S.staff.map((u) => `<option value="${u.id}" ${u.id === S.me ? 'selected' : ''}>${esc(u.name)} · ${u.role === 'approver' ? '审核人' : '编辑'}</option>`).join('')}</select>`}
        </section>`}
        ${larkOn || !teamOn ? '' : `<section class="panel">
          <div class="panel__h"><h3>成员与角色</h3></div>
          <p class="muted"><b>审核人</b>:自己的改动直接生效,能批准 / 退回别人的。<b>编辑</b>:改动要提交审核才会上线。${live ? '同事第一次打开这个 app 后会出现在这里,默认是编辑。' : ''}</p>
          ${S.staff.map((u) => `<div class="mrow"><span class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</span><b>${esc(u.name)}${u.id === S.me ? ' <span class="muted">(我)</span>' : ''}</b>
            ${live && u.lastSeen ? `<span class="muted">${fAgo(u.lastSeen)}来过</span>` : ''}
            <select class="sel sel--sm" data-role="${u.id}" ${live && !isApprover() ? 'disabled' : ''}><option value="approver" ${u.role === 'approver' ? 'selected' : ''}>审核人</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>编辑</option></select></div>`).join('')}
        </section>`}
        ${teamOn ? `<section class="panel">
          <div class="panel__h"><h3>默认审批人</h3><span class="muted">每类内容由谁审批</span></div>
          <p class="muted">一条内容没单独选审批人时,就由这里设的人审批;这里也没设 = 管理员审批。审批人自己提交的直接生效,轮播顺序也由他批。</p>
          ${['banner', 'topbar', 'tbstyle', 'pmodule', 'pin', 'salelink', 'callout', 'campaign'].map((k) => `<label class="kv kv--sel"><span>${({ banner: '首页 Banner', topbar: '顶栏公告', tbstyle: '顶栏样式', pmodule: '首页商品模块', pin: '合集排序', salelink: '促销链接', callout: '产品页推广', campaign: '活动' })[k]}</span>
            <select class="sel sel--sm" data-defappr="${k}" ${live && !isApprover() ? 'disabled' : ''}><option value="">管理员审批</option>${peopleFor(k).map((u) => `<option value="${esc(u.id)}" ${appr()[k] === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>`).join('')}
        </section>` : ''}
        <section class="panel">
          <div class="panel__h"><h3>飞书通知</h3>${live ? (S.settings.larkWebhookSet ? '<span class="tag tag--ok">已连接</span>' : '<span class="tag tag--warn">未设置</span>') : ''}</div>
          <p class="muted">在飞书群里:设置 → 群机器人 → 添加机器人 → 自定义机器人,复制它的 webhook 地址粘贴到这里。建议同时开「签名校验」,把密钥也填上。</p>
          <label class="fld"><span>群机器人 Webhook 地址</span>
            <input class="inp" id="st-hook" placeholder="${hookPh}" value="${hookVal}" ${live && !isApprover() ? 'disabled' : ''}/></label>
          <label class="fld"><span>签名校验密钥(可选)</span>
            <input class="inp" id="st-secret" type="password" placeholder="${live && S.settings.larkSecretSet ? '已设置,要换就粘贴新的' : '没开签名校验就留空'}" ${live && !isApprover() ? 'disabled' : ''}/></label>
          ${live && isApprover() ? '<button class="btn btn-sm" id="st-hook-save" type="button">保存飞书设置</button>' : ''}
          <div class="tgls">
            ${teamOn ? tg('submit', '有人提交审核', '私信这条内容的审批人;群里也发') : ''}
            ${teamOn ? tg('decision', '批准 / 退回', '私信提交人、负责人和抄送的人,附退回意见') : ''}
            ${tg('dayBefore', '上线前一天提醒', teamOn ? '每天 10:00 汇总明天要上线的,没批准的会标出来' : '每天 10:00 汇总明天要上线的')}
            ${tg('endingSoon', `下架前 ${ENDING_DAYS} 天提醒`, '每天 10:00 汇总快到期的 Banner / 公告 / 活动,方便决定延长还是准备替换')}
            ${tg('upDown', '上线 / 下线', teamOn ? '定时器每次自动切换都通知;负责人和抄送的人收到私信' : '定时器每次自动切换都通知')}
            ${teamOn ? tg('unapproved', '到点还没批准', '快到上线时间还没批时私信审批人') : ''}
            ${teamOn ? tg('due', '截止提醒', '截止前一天、过了截止还没提交,私信负责人(过期也告诉审批人)') : ''}
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
      ${isApprover() ? '<div id="st-clean"></div>' : ''}
      <section class="panel">
        <div class="panel__h"><h3>操作日志</h3><span class="muted">谁、什么时候、做了什么</span></div>
        <div class="loglist">${S.log.slice(0, 60).map(logRow).join('') || '<p class="muted">暂无</p>'}</div>
      </section>`;

    const post = async (path, body, okMsg) => {
      try { const v = await api('POST', path, body); if (v.banners) { S = await normalizeLive(v); renderAll(); } if (okMsg) toast(okMsg); return v; }
      catch (e) { toast(e.message, false); return null; }
    };
    if (larkOn) bindLarkPanels();
    drawClean();
    if (live) {
      $('#st-myname-save')?.addEventListener('click', () => post('/api/schedule/staff', { id: S.me, name: $('#st-myname').value }, '名字已保存'));
      $$('[data-role]').forEach((el) => el.addEventListener('change', () => post('/api/schedule/staff', { id: el.dataset.role, role: el.value }, '角色已更新')));
      $$('[data-notify]').forEach((c) => c.addEventListener('change', () => post('/api/schedule/settings', { notify: { [c.dataset.notify]: c.checked } })));
      $$('[data-defappr]').forEach((el) => el.addEventListener('change', () => post('/api/schedule/settings', { approvers: { ...appr(), [el.dataset.defappr]: el.value || null } }, '默认审批人已保存')));
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
      $$('[data-defappr]').forEach((el) => el.addEventListener('change', () => { appr()[el.dataset.defappr] = el.value || null; save(); renderAll(); toast('默认审批人已保存(演示)'); }));
      $('#st-hook').addEventListener('change', (e) => { S.settings.larkWebhook = e.target.value.trim(); save(); toast('已保存 Webhook 地址(演示)'); });
      $('#st-test').addEventListener('click', () => toast('演示模式:不会真的发送。正式版会往飞书群发一条测试消息。'));
    }
    renderConn();
  }

  // ---- 上线前对照正式主题:app 里的首页内容 vs 正式网站编辑器里的,勾选后对齐(服务器 src/theme-sync.js)----
  async function openThemeSync() {
    hidePop();
    const ACT = { add: '新加', update: '改内容', revive: '恢复显示', retire: '结束', pause: '暂停', order: '顺序' };
    const GROUPS = [['banners', '首页 Banner'], ['topbar', '顶栏公告'], ['tbstyle', '顶栏样式'], ['pmodules', '首页商品模块']];
    $('#drawer').innerHTML = `<div class="drawer__h"><div><b>对照正式主题</b> <span class="muted" id="ts-theme"></span></div>
        <button class="btn btn-ghost" data-act="close" type="button" aria-label="关闭">${I.x}</button></div>
      <div class="drawer__b"><div class="drawer__form" id="ts-body" style="max-width:none"><p class="muted">正在读正式主题(只读)…</p></div></div>
      <div class="drawer__f"><span class="muted" id="ts-count"></span><div class="drawer__acts"><button class="btn btn-primary" id="ts-go" type="button" disabled>按勾选的对齐</button></div></div>`;
    $('#drawer').hidden = false; $('#drawer-mask').hidden = false; document.body.classList.add('no-scroll');
    $('#drawer').onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeDrawer(); };
    let r;
    try { r = await api('GET', '/api/schedule/theme-sync'); } catch (e) { $('#ts-body').innerHTML = `<div class="note note--danger">${esc(e.message)}</div>`; return; }
    $('#ts-theme').textContent = `正式主题「${r.theme}」`;
    // 左右两栏:正式网站现在 vs app 里(上线后会显示的);不一样的标出来,下面是要做的改动
    const C = r.compare || {};
    const siteImg = (name) => (name ? `${S.store?.domain || ''}/cdn/shop/files/${encodeURIComponent(name)}?width=96` : '');
    const listCol = (head, rows, otherKeys, missTag, isSite) => `<div class="tscmp__col"><div class="tscmp__h">${head} <span class="muted">${rows.length}</span></div>
      ${rows.map((x, i) => { const miss = !otherKeys.has(x.key);
        const img = isSite ? siteImg(x.image) : (x.image ? thumb(x.image, 96) : '');
        return `<div class="tscmp__row ${miss ? 'is-miss' : ''}"><span class="tscmp__n">${i + 1}</span>${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<span class="tscmp__t">${esc(x.title)}</span>
          ${miss ? `<span class="tag ${isSite ? 'tag--warn' : 'tag--danger'}">${missTag}</span>` : ''}${!isSite && x.mine ? '<span class="tag">app 里建的</span>' : ''}</div>`; }).join('') || '<p class="muted">(没有)</p>'}</div>`;
    const cmpLists = (cmp) => {
      if (!cmp) return '';
      const sk = new Set(cmp.site.map((x) => x.key)), ak = new Set(cmp.app.map((x) => x.key));
      const sameSet = sk.size === ak.size && [...sk].every((k) => ak.has(k));
      const sameOrder = sameSet && cmp.site.map((x) => x.key).join('|') === cmp.app.map((x) => x.key).join('|');
      return { html: `<div class="tscmp">${listCol('正式网站现在', cmp.site, ak, 'app 里没有', true)}${listCol('app 里 · 上线后会显示', cmp.app, sk, '正式网站没有', false)}</div>
        ${sameSet && !sameOrder ? '<p class="muted">两边一样的东西,只是顺序不同。</p>' : ''}`, same: sameOrder };
    };
    const modCmp = () => (C.modules || []).map((m) => {
      const same = m.app && m.app.title === m.site.title && m.app.tabs.join('|') === m.site.tabs.join('|');
      const card = (head, x, note) => `<div class="tscmp__col"><div class="tscmp__h">${head}</div>${x ? `<div class="tscmp__mod"><b>${esc(x.title || '(无标题)')}</b>${note || ''}<div>${x.tabs.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : '<p class="muted">(没有)</p>'}</div>`;
      return `<div class="tscmp__modh">${m.module === 'sale' ? '促销模块' : '推荐 / 新品模块'} ${same ? '<span class="tag tag--ok">一样</span>' : '<span class="tag tag--danger">不一样</span>'}</div>
        <div class="tscmp">${card('正式网站现在', m.site)}${card('app 里 · 上线后会显示', m.app, m.app ? `<span class="muted"> · ${m.app.isDefault ? '平时版本' : `版本「${esc(m.app.name || '')}」`}</span>` : '')}</div>`;
    }).join('');
    const actList = (k) => { const L = r.plan[k] || []; return L.length ? `<details class="tsacts" open><summary>要做的改动 ${L.length} 处 <span class="muted">(默认已勾好;勾上的会让右边变成和左边一样)</span></summary>
      ${L.map((x) => `<label class="tsrow"><input type="checkbox" data-ts="${esc(x.key)}" ${x.pick ? 'checked' : ''}/>
        <span class="tag tsrow__act tsrow__act--${x.act}">${ACT[x.act] || x.act}</span><span><b>${esc(x.title)}</b><span class="muted"> · ${esc(x.why)}</span></span></label>`).join('')}</details>` : ''; };
    const bc = cmpLists(C.banners), tc = cmpLists(C.topbar);
    const sec = (title, same, body, k) => `<section class="panel"><div class="panel__h"><h3>${title}</h3>${same ? '<span class="tag tag--ok">✅ 两边一样</span>' : `<span class="tag tag--danger">${(r.plan[k] || []).length} 处不一样</span>`}</div>${body}${actList(k)}</section>`;
    const rows = [
      sec('首页 Banner', !(r.plan.banners || []).length, bc.html || '', 'banners'),
      sec('顶栏公告', !(r.plan.topbar || []).length, tc.html || '', 'topbar'),
      (r.plan.tbstyle || []).length ? sec('顶栏样式', false, '', 'tbstyle') : '',
      sec('首页商品模块', !(r.plan.pmodules || []).length, modCmp(), 'pmodules'),
    ].join('');
    $('#ts-body').innerHTML = `<div class="note">左边是<b>正式网站现在</b>的样子,右边是 <b>app 里的</b>(主题改造上线后,首页显示的就是右边)。点「按勾选的对齐」会把右边改成和左边一样;没勾的保持原样。每一处都会记进历史记录,结束 / 暂停的随时能在各自页面恢复。</div>
      ${rows}${(r.plan.notes || []).map((n) => `<div class="note note--warn">ℹ️ ${esc(n)}</div>`).join('')}
      ${r.total ? '' : '<div class="note note--ok">✅ 两边完全一样,可以放心上线。</div>'}`;
    const count = () => { const n = $$('#ts-body [data-ts]:checked').length; $('#ts-count').textContent = r.total ? `勾了 ${n} / ${r.total} 处` : ''; $('#ts-go').disabled = !n; };
    $('#ts-body').addEventListener('change', count); count();
    $('#ts-go').onclick = async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次确认(会写进店铺)'; b.classList.add('btn-danger'); return; }
      b.disabled = true; b.textContent = '对齐中…(要在文件库里找图,可能要一分钟)';
      try {
        const out = await api('POST', '/api/schedule/theme-sync', { picks: $$('#ts-body [data-ts]:checked').map((x) => x.dataset.ts) });
        S = await normalizeLive(out); renderAll();
        toast(`${out.done.length} 处已对齐${out.syncErrors?.length ? `;${out.syncErrors.length} 条写进店铺时出错:${out.syncErrors[0]}` : ''}${out.left ? `;还剩 ${out.left} 处不同(没勾的)` : ';和正式网站一样了'}`, !out.syncErrors?.length);
        openThemeSync();
      } catch (err) { toast(err.message, false); b.disabled = false; b.textContent = '按勾选的对齐'; delete b.dataset.sure; b.classList.remove('btn-danger'); }
    };
  }

  // ---- 店铺连接(真实接口):权限 / 4 个内容类型 / 定时器 ----
  // 只有在 Shopify 后台里打开才有 session token;本地预览会提示。
  const DEF_CN = { cgp_campaign: '活动(促销)', cgp_banner_slide: '首页 Banner', cgp_topbar_message: '顶栏公告', cgp_topbar_style: '顶栏样式', cgp_product_tab: '首页商品页签', cgp_product_module: '首页商品模块版本', cgp_collection_pin: '合集置顶清单', cgp_sale_link: '促销链接', cgp_pdp_callout: '产品页推广块' };
  let connCache = null;
  async function renderConn(force) {
    const box = $('#st-conn'); if (!box) return;
    const head = `<div class="panel__h"><h3>店铺连接(正式数据)</h3>${MODE === 'live' ? '<span class="tag tag--ok">正在用正式数据</span>' : '<span class="tag tag--warn">现在是演示模式</span>'}</div>`;
    let st = !force && connCache;
    if (!st) {
      try {
        st = connCache = await api('GET', '/api/schedule/status');
        // 页面上只留一份连接状态:查到新的就同步给其他页(比如商品模块页的「缺类型」提示)
        if (S.setup && ['pmReady', 'ready', 'pinReady', 'slReady', 'coReady'].some((k) => S.setup[k] !== st[k])) { Object.assign(S.setup, { pmReady: st.pmReady, pinReady: st.pinReady, slReady: st.slReady, coReady: st.coReady, ready: st.ready, upgrade: st.upgrade }); renderPmodules(); renderSaleLinks(); renderCallouts(); if (cpHub) renderCampaigns(); }
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
    const missingFields = st.fieldsMissing || [];
    const canSetup = !st.missingScopes.length && (missingDefs.length || missingFields.length);
    box.innerHTML = `${head}
      <div class="conn__grid">
        <div><div class="conn__k">1. 权限</div>
          ${st.requiredScopes.map((s) => `<div class="conn__r">${ok(!st.missingScopes.includes(s))}<span class="mono">${s}</span></div>`).join('')}
          ${st.missingScopes.length ? `<div class="note note--warn">还缺 ${st.missingScopes.length} 个权限。在 Partner 后台 → 应用「Promo Dashboard Dev」→ 配置 → 访问权限里加上,发布新版本,再回店铺后台打开这个 app 点同意。
            <button class="btn btn-sm" data-conn="reconnect" type="button">已同意,重新检查</button></div>` : ''}</div>
        <div><div class="conn__k">2. 店里的内容类型</div>
          ${st.definitions.map((d) => `<div class="conn__r">${ok(d.exists && !(d.missingFields || []).length && !(d.staleFields || []).length)}<span>${DEF_CN[d.type] || d.type}</span><span class="mono muted">${d.type}</span>${d.exists ? `<span class="muted">${d.entries} 条${(d.missingFields || []).length ? ` · 缺 ${d.missingFields.length} 个新字段` : ''}${(d.staleFields || []).length ? ' · 有新选项要更新(如顶栏新特效)' : ''}</span>` : ''}</div>`).join('')}
          ${(missingDefs.length || missingFields.length) && st.ready ? `<div class="note note--warn">新功能要${missingDefs.length ? `补建 ${missingDefs.length} 个内容类型` : ''}${missingDefs.length && missingFields.length ? '、' : ''}${missingFields.length ? `给已有类型补 / 更新 ${missingFields.length} 个字段` : ''}。点下面的按钮补上;已有的内容不受影响。${missingDefs.some((d) => d.type.startsWith('cgp_product')) ? '首页商品模块补好后,再点「从主题导入」把两个模块现在的配置导进来当平时版本。' : ''}</div>` : ''}
          ${missingDefs.length || missingFields.length ? `<p class="muted">点下面的按钮在店里补齐。只是建好空的类型,<b>顾客看不到任何变化</b>,在 app 里保存内容后才会显示。可以重复点,已建的会跳过。</p>
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
        ${st.ready && MODE === 'live' ? `<div><div class="conn__k">5. 上线前对照正式主题</div>
          <p class="muted">主题改造上线后,首页的 Banner、顶栏、两个商品模块显示的是 <b>app 里的内容</b>。导入之后编辑器里又换过的(加了新 Banner、删了旧的、改了文案、换了页签),app 里还是旧的。
            上线前点这里,列出 app 和正式网站首页每一处不同,勾选后一键对齐,上线那一刻首页才和现在一模一样。</p>
          <button class="btn btn-sm" data-conn="themesync" type="button">对照正式主题</button></div>` : ''}
      </div>
      ${st.app ? `<p class="muted conn__ver">app 版本 <span class="mono">${esc(st.app.commit)}</span> · 启动于 ${fDT(st.app.startedAt)}</p>` : ''}
      ${st.ready ? `<div class="conn__mode">${MODE === 'live'
        ? `现在看到的是店里的正式数据,所有改动${team() ? '按审核规则' : '保存后直接'}写进店铺。<button class="linkbtn" data-conn="demo" type="button">临时看演示数据</button>`
        : '<b>内容类型已建好。</b><button class="btn btn-sm btn-primary" data-conn="live" type="button">切换到正式数据</button><span class="muted">切换后你在这里的操作会真的写进店铺,正式网站马上按这些内容显示。</span>'}</div>` : ''}`;
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
    box.querySelector('[data-conn=themesync]')?.addEventListener('click', () => openThemeSync());
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
        const upd = (r.updated || []).length;
        toast(r.errors.length ? `建好 ${r.created.length} 个,失败 ${r.errors.length} 个:${r.errors[0].message}`
          : [r.created.length ? `已建好 ${r.created.length} 个内容类型` : '', upd ? `已给 ${upd} 个类型补上新字段` : '', r.resynced ? `店里已有的 ${r.resynced} 条重新写了一次(带上新字段)` : ''].filter(Boolean).join(';') || '都是最新的,不用补', !r.errors.length);
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
      <div class="tabed__cks">${chk(i, 'onlyDiscounted', '只显示打折的')}${chk(i, 'sortByDiscount', '按折扣从大到小')}${chk(i, 'newestFirst', '最新上架在前')}${chk(i, 'countdown', '显示活动徽章和倒计时')}</div>
      <p class="muted tabed__hint">「显示活动徽章和倒计时」:产品参加了生效中的活动就在卡片上标出来;<b>整个页签都是同一个活动时自动不显示</b>(比如全是 Autumn Sale 的就不用每张都标),混合了不同活动的照常显示。</p>
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
    const baseIt = { kind, state: 'new', by: S.me, owner: S.me, campaign: preset.campaign || null, paused: false, pendingChange: null };
    if (kind === 'banner') return { ...baseIt, id: rid('b-'), image: '', title: '', subtitle: '', description: '', button1_text: 'Shop Now', button1_url: '', button2_text: '', button2_url: '', tag: 'new', order: S.banners.length, start: preset.campaign ? null : dayStart(1), end: null };
    if (kind === 'topbar') return { ...baseIt, id: rid('t-'), emoji: '📣', text: '', link: '', category: '公告', order: S.topbar.length, start: null, end: null };
    if (kind === 'tbstyle') return { ...baseIt, id: rid('s-'), name: '', bg: '#9b1c1c', color: '#ffffff', accent: '#f5d06f', effect: 'snow', decoLeft: '🎄', decoRight: '', priority: 10, start: preset.campaign ? null : dayStart(7), end: preset.campaign ? null : dayStart(14), ...(TB_PRESETS[preset.tbpreset]?.v || {}) };
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
    if (kind === 'callout') return { ...baseIt, id: rid('co-'), name: '', title: '', text: '', linkText: '', link: '', promo: null, image: '', imageId: '', collections: [], tags: [], vendors: [], products: [], exProducts: [], exTags: [], priority: 10, start: null, end: null };
    if (kind === 'salelink') return { ...baseIt, id: rid('sl-'), name: '', slug: '', collection: null, products: [], inStock: false, minDiscount: null, limit: null, sort: '', heading: '', start: null, end: null };
    if (kind === 'pin') return { ...baseIt, id: rid('pin-'), name: '', collection: null, products: [], onlyListed: false, countdown: false, badge: '', start: preset.campaign ? null : dayStart(1), end: preset.campaign ? null : dayStart(2) };
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
  let wxPlans = null; // 能导入的改价计划(按需加载)
  function wxPlansHtml() {
    if (wxPlans == null) return '<button type="button" class="btn btn-sm" data-wx="loadplans">看看有哪些改价计划</button>';
    if (!wxPlans.length) return '<span class="muted">还没有改价计划</span>';
    return `<div class="results">${wxPlans.map((p) => `<div class="result"><b style="flex:1">${esc(p.name)}</b>
      <span class="muted">${p.n} 个产品 · ${p.when}</span><button type="button" class="btn btn-sm" data-wx="useplan" data-id="${esc(p.id)}">用它的产品</button></div>`).join('')}</div>`;
  }
  // ---- 合集排序编辑器:照 Shopify 新版合集那样,网格里列出合集**全部**产品,随便拖到任意位置 ----
  //   wx.order  = 生效时合集页从上往下的完整顺序(不含「这段时间不显示」的)
  //   wx.hidden = 这段时间不显示的
  //   wx.onlyN  = 「只显示前 N 个」(null = 关)
  //   wxBase    = 原来的顺序(对比的基准:app 正在接管时是接管前的快照,没接管就是合集现在的顺序)
  // 存的时候只存「最短前缀」(order-diff.js 的 minimalPrefix),展开回去和网格里一模一样。
  let wxAll = null; let wxBusy = false; let wxBase = []; let wxQ = ''; let wxPosEdit = null; let wxDrag = null;
  const SORT_CN = { BEST_SELLING: '最畅销', ALPHA_ASC: '字母 A–Z', ALPHA_DESC: '字母 Z–A', CREATED: '最早上架', CREATED_DESC: '最新上架', PRICE_ASC: '价格从低到高', PRICE_DESC: '价格从高到低', MANUAL: '手动' };
  const pidOf = (p) => numId(p.id);
  const keepP = (p) => ({ id: p.id, handle: p.handle, title: p.title, image: p.image || '', off: p.off, draft: p.draft, price: p.price, compareAt: p.compareAt, from: p.from });
  // 卡片上的价格:划线原价 + 现价(变体价格不一样时标「起」)
  const gbp = (x) => `£${Number(x).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const priceRow = (p) => (p.price == null ? '' : `<span class="pg__pr">${p.compareAt ? `<s>${gbp(p.compareAt)}</s>` : ''}<b class="${p.compareAt ? 'is-sale' : ''}">${gbp(p.price)}</b>${p.from ? '<em>起</em>' : ''}</span>`);
  async function loadWxAll(redraw) {
    const c = wx.collection; wxAll = null; wxBase = []; wxQ = ''; wxPosEdit = null;
    if (!c) return redraw && redraw();
    if (MODE !== 'live') { // 演示模式读不到店里的合集成员,只能拿演示目录凑一组让人试手感(界面上会写明不是真的)
      const seed = [...(c.handle || c.title || '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const pool = (S.products || []); const n = Math.min(24, pool.length);
      wxAll = { title: c.title, demo: true, truncated: false, total: n,
        products: Array.from({ length: n }, (_, i) => { const p = pool[(seed + i * 11) % pool.length]; return { id: p.id, title: p.title, handle: p.handle, image: p.image }; }) };
    } else {
      // 读完之前只画占位卡片,读完(连价格)一次画出来 —— 不要先画一遍没价格的卡片再跳
      wxBusy = true; redraw && redraw();
      try { wxAll = await api('GET', `/api/schedule/collection-products?id=${encodeURIComponent(c.id)}`); }
      catch (e) { wxAll = { error: e.message, products: [] }; }
      buildWx();
      // 网格里有、但现在不在这个合集里的产品(设成不显示后真的移出去了 / 合集外加进来的),合集的产品列表里没有它们的价格 → 单独补
      const missing = [...new Set([...wx.order, ...wx.hidden].filter((p) => p.price == null).map(pidOf))];
      if (missing.length && !wxAll.error) {
        try {
          const { products } = await api('GET', `/api/schedule/products-info?ids=${missing.slice(0, 250).join(',')}`);
          for (const x of products) { const p = wx.info.get(pidOf(x)); if (p) Object.assign(p, { price: x.price, compareAt: x.compareAt, off: x.off, from: x.from, image: p.image || x.image, draft: x.draft }); }
        } catch { /* 补不到价格不影响排序 */ }
      }
      wxBusy = false;
      return redraw && redraw();
    }
    buildWx();
    redraw && redraw();
  }
  // 拿到合集之后,把存着的「前缀 + 隐藏」展开成网格里的完整顺序
  function buildWx() {
    const info = new Map();
    for (const p of [...(wxAll?.products || []), ...(wx.init?.products || []), ...(wx.init?.hidden || [])]) if (!info.has(pidOf(p))) info.set(pidOf(p), keepP(p));
    for (const p of wxAll?.products || []) info.set(pidOf(p), keepP(p)); // 店里的最新信息优先(价格、草稿状态)
    wxBase = (wxAll?.baseline || (wxAll?.products || []).map(pidOf)).map(String).filter((id) => info.has(id));
    const init = wx.init || { products: [], hidden: [] };
    const ids = OD.expandOrder(wxBase, init.products.map(pidOf), { hidden: init.hidden.map(pidOf) });
    wx.order = ids.filter((id) => info.has(id)).map((id) => info.get(id));
    wx.hidden = init.hidden.filter((p) => info.has(pidOf(p))).map((p) => info.get(pidOf(p)));
    wx.info = info;
  }
  const wxVisible = () => (wx.onlyN != null ? wx.order.slice(0, wx.onlyN) : wx.order);
  // 这一刻和原来比:新加 / 换了位置 / 拿掉
  // (开了「只显示前 N 个」时,红框照整串顺序算,免得一开关标记就跳来跳去;切掉的那些算「拿掉」)
  const wxDiff = () => {
    const full = OD.diffOrder(wxBase, wx.order.map(pidOf));
    if (wx.onlyN == null) return full;
    const vis = new Set(wxVisible().map(pidOf));
    return { ...full, added: new Set([...full.added].filter((id) => vis.has(id))), moved: new Set([...full.moved].filter((id) => vis.has(id))), removed: wxBase.filter((id) => !vis.has(id)) };
  };
  // 能不能真的改店里的合集:顺序(排序方式是「手动」就行,带条件的也可以)/ 加减单个产品(只做纯手动合集)
  const canWrite = () => !(MODE === 'live' && S.setup && S.setup.canWriteProducts === false);
  const realModeOf = () => !!(wxAll?.manualOk && canWrite());
  const realMemberOf = () => !!((wxAll?.membershipOk || wxAll?.selectionOk) && canWrite());
  function wxCard(p, i, d, cut) {
    const id = pidOf(p);
    const isNew = d.added.has(id); const isMoved = d.moved.has(id);
    const orig = d.origPos.get(id);
    const q = wxQ.trim().toLowerCase(); const dim = q && !p.title.toLowerCase().includes(q);
    return `<div class="pg__card ${cut ? 'is-cut' : isNew ? 'is-new' : isMoved ? 'is-moved' : ''} ${dim ? 'is-dim' : ''}" data-pg="${i}">
      ${wxPosEdit === i ? `<input class="pg__posin" id="pg-posin" type="number" min="1" max="${wx.order.length}" value="${i + 1}"/>`
        : `<button type="button" class="pg__pos" data-wx="pos" data-i="${i}" title="点一下,输入要移到第几位">${i + 1}</button>`}
      <span class="pg__img">${p.image ? `<img src="${esc(thumb(p.image, 240))}" alt="" loading="lazy" draggable="false">` : ''}</span>
      <span class="pg__t">${esc(p.title)}</span>
      ${priceRow(p)}
      <span class="pg__m">${cut ? '<span class="pg__b pg__b--cut">这段时间不显示</span>'
        : isNew ? '<span class="pg__b pg__b--new">新加</span>'
          : isMoved ? `<span class="pg__b pg__b--moved">原 #${orig + 1}</span>` : ''}${p.off ? `<span class="pg__off">${p.off}% OFF</span>` : ''}${p.draft ? '<span class="pg__b">草稿</span>' : ''}</span>
      <span class="pg__acts"><button type="button" data-wx="totop" data-i="${i}" title="排到第 1 位">置顶</button><button type="button" data-wx="hide" data-i="${i}" title="这段时间不显示它">不显示</button></span>
    </div>`;
  }
  function pinBoxHtml() {
    const realMode = realModeOf(); const realMember = realMemberOf();
    const d = wxAll && !wxAll.error ? wxDiff() : { added: new Set(), moved: new Set(), removed: [], origPos: new Map() };
    const ids = wx.order.map(pidOf);
    const prefix = wx.onlyN != null ? wx.onlyN : OD.minimalPrefix(wxBase, ids).length;
    const outside = wxAll && !wxAll.demo && !wxAll.error ? wx.order.filter((p) => !wxBase.includes(pidOf(p)) && !(wxAll.products || []).some((x) => pidOf(x) === pidOf(p))).length : 0;
    const removeN = wx.hidden.length + (wx.onlyN != null ? Math.max(0, wx.order.length - wx.onlyN) : 0);
    const warns = [];
    const why = wxAll?.needsNewApi ? '(要让 app 能改带条件的合集,先把 API 版本升到 2026-07)' : wxAll?.sharedSource ? '(这个合集的条件来源是共享的,改了会连带改到别的合集,app 不碰)' : '';
    if (outside && !realMember) warns.push(`有 <b>${outside} 个产品不在这个合集里</b> —— <b>它们显示不出来</b>${why}。要让它出现,先在 Shopify 后台把它单独加进这个合集。`);
    if (outside && realMember) warns.push(`红框「新加」的 ${outside} 个产品本来不在这个合集里 —— 生效时会自动<b>加进合集</b>${wxAll?.selectionOk ? '(加进这个合集的「单独加的产品」名单,不动条件)' : ''},结束再拿掉。`);
    if (realMode && !realMember && removeN) warns.push(`有 ${removeN} 个产品设成了「这段时间不显示」:它们<b>还留在 Shopify 的合集里</b>,只在顾客看到的页面上隐藏${why}${S.themePin === false ? '(正在用的主题还没装上前台代码,现在只在测试主题上有效)' : ''}。`);
    if (realMember && wxAll?.selectionOk && removeN) warns.push(`「这段时间不显示」的 ${removeN} 个产品,生效时会加进这个合集的「排除」名单(不动条件),结束再拿掉。`);
    if (!realMode && wxAll && !wxAll.demo && prefix > 50) warns.push(`前台排序最多能固定前 50 个位置,你现在排到了第 ${prefix} 位 —— 第 51 位以后的调整前台不会生效。`);
    if (!realMember && wxAll && !wxAll.demo && wx.hidden.length > 50) warns.push(`前台排序最多能隐藏 50 个产品,你现在隐藏了 ${wx.hidden.length} 个。`);
    if (realMember && removeN > 100) warns.push(`要临时移出合集的产品有 ${removeN} 个(超过 100 个)—— 这份清单会改用前台排序,不动店里的合集。`);
    const colNote = !wx.collection ? '' : wxBusy ? '<em>正在读这个合集现在的顺序…</em>'
      : wxAll?.error ? `<em class="warn">读不到这个合集的产品:${esc(wxAll.error)}</em>`
        : wxAll?.demo ? `<em class="warn">演示模式:下面是<b>随便凑的示例产品,不是「${esc(wxAll.title)}」真正的成员</b> —— 演示模式读不到店里的合集。切到正式数据(设置 → 店铺连接)后,这里会列出这个合集现在真正的产品和顺序。</em>`
          : wxAll ? `<em>${!wxAll.manualOk
            ? `这个合集现在的排序方式是<b>「${esc(SORT_CN[wxAll.sortOrder] || wxAll.sortOrder || '别的方式')}」</b>,不是「手动」—— Shopify 只让手动排序的合集调顺序,所以这份清单<b>用前台排序</b>:后台里的顺序不会变,顾客看到的合集页和首页模块按你排的显示。
              想让后台也变,在 Shopify 后台把这个合集的排序改成「手动」(带条件的合集也可以)。${S.themePin === false ? '<b class="warn">正在用的主题还没装上前台排序的代码(现在只装在测试主题上),顾客暂时看不到效果。</b>' : ''}`
            : !canWrite() ? '手动排序的合集,但 app 现在<b>没有「改产品 / 合集」的权限</b> —— 先用前台排序;装上权限后就会真的改店里的合集。'
              : wxAll.selectionOk ? '带条件的合集,排序方式是「手动」—— 到点会<b>真的</b>改店里的合集:顺序照网格,合集外的产品加进「单独加的产品」、不显示的加进「排除」名单,<b>你设的条件不动</b>;结束自动撤掉、顺序还原。'
                : wxAll.automated ? `带条件的合集,排序方式是「手动」—— 到点会<b>真的</b>按网格里的顺序改店里的合集,结束自动还原;单个产品的加 / 移出交给前台${wxAll.needsNewApi ? '(把 API 版本升到 2026-07 后,app 就能直接改这个合集的「单独加的产品 / 排除」名单)' : wxAll.sharedSource ? '(这个合集的条件来源是共享的,app 不碰)' : ''}。`
                : '手动合集 —— 到点会<b>真的</b>按网格里的顺序改店里的合集(包括加 / 移出产品),结束自动还原。'}共 ${wxAll.total ?? wxAll.products.length} 个产品${wxAll.truncated ? `(太多了,只列出前 ${wxAll.products.length} 个)` : ''}${wxAll.takenBy ? ` · 现在由「${esc(wxAll.takenBy.pinName || '')}」接管着,网格里的对比基准是接管前的原样` : ''}
              ${MODE === 'live' ? ' · <button type="button" class="linkbtn" data-wx="hist">看这个合集的历史版本 / 回滚</button>' : ''}</em>` : '';
    const sum = OD.diffSummary(d);
    // 搜索引擎在合集页默认「手动前 N 个 + 其余新到旧」:没开「完全按我排的顺序」时,网格第 (前缀 + N) 位以后前台会按新到旧
    const rule = wxAll?.sortRule || { off: false, pinManual: 12, pinNew: 0 };
    const nativeAll = rule.off;                                  // 这个合集本来就完全按合集顺序
    const newestFrom = !wx.fullOrder && !nativeAll && !rule.pinNew && wx.onlyN == null ? prefix + rule.pinManual : null;
    const grid = wx.order.map((p, i) => {
      const cut = wx.onlyN != null && i >= wx.onlyN;
      const line = wx.onlyN != null && i === wx.onlyN ? `<div class="pg__cutline">—— 只显示前 ${wx.onlyN} 个,下面的这段时间不显示 ——</div>`
        : newestFrom != null && i === newestFrom ? `<div class="pg__cutline pg__cutline--new">—— 前台从这里开始按「新到旧」显示,不是网格里的顺序(合集页默认只照手动顺序显示前 ${rule.pinManual} 个)· 打开上面的「完全按我排的顺序」就一模一样 ——</div>` : '';
      return line + wxCard(p, i, d, cut);
    }).join('');
    return `<div class="fld"><span>合集</span><div class="rowin">${wx.collection ? `<span class="chip"><span class="chip__t">${esc(wx.collection.title)}</span>${linkPair('collections', wx.collection)}</span>` : '<span class="muted">还没选</span>'}
        <button type="button" class="btn btn-sm" data-wx="pickcoll">${wx.collection ? '换一个' : '选择合集'}</button></div>${colNote}</div>
      ${window.cgpCanSee && window.cgpCanSee('price') && MODE === 'live' ? `<div class="fld"><span>从改价计划导入 <em>Flash 当天改价的那批产品,一键放到最前面</em></span>
        <div id="wx-plans">${wxPlansHtml()}</div></div>` : ''}
      ${!wx.collection ? '<p class="muted">选了合集之后,这里会用网格列出合集里现在的全部产品,可以随便拖到任意位置。</p>'
        : wxBusy ? `<div class="pg">${Array.from({ length: 10 }, () => '<div class="pg__card pg__card--ph"><span class="pg__img"></span><span class="pg__t"></span><span class="pg__pr"></span></div>').join('')}</div>` : `
      <div class="pg__bar">
        <div class="pg__legend"><span class="lg lg--new"></span>新加 <span class="lg lg--moved"></span>换了位置 <span class="lg lg--cut"></span>这段时间不显示 <span class="lg"></span>没动
          <b class="pg__sum">${esc(sum)}</b></div>
        <div class="pg__tools">
          <input class="inp inp--sm" id="wx-q" placeholder="找产品(不会打乱顺序)" value="${esc(wxQ)}"/>
          <button type="button" class="btn btn-sm" data-wx="pickprod">${I.plus}添加产品</button>
          ${sum !== '顺序没变' ? '<button type="button" class="btn btn-sm btn-ghost" data-wx="reset" title="撤销所有调整,回到原来的顺序">全部撤销</button>' : ''}
        </div>
      </div>
      <label class="tgl pg__only"><input type="checkbox" id="wx-only" ${wx.onlyN != null ? 'checked' : ''}/><span class="tgl__ui"></span>
        <span><b>只显示前 <input class="inp inp--xs" id="wx-onlyn" type="number" min="1" max="${Math.max(1, wx.order.length)}" value="${wx.onlyN ?? Math.max(1, Math.min(prefix || 5, wx.order.length))}" ${wx.onlyN != null ? '' : 'disabled'}/> 个</b>
          <span class="muted">比如 Flash Sale:合集里放着所有候选产品,每天只显示当天这一组;后面的这段时间不显示</span></span></label>
      <label class="tgl pg__only"><input type="checkbox" id="wx-full" ${wx.fullOrder || nativeAll ? 'checked' : ''} ${nativeAll ? 'disabled' : ''}/><span class="tgl__ui"></span>
        <span><b>生效期间完全按我排的顺序显示</b><span class="muted">${nativeAll
          ? '这个合集本来就完全按合集顺序显示,不用开'
          : `合集页默认${rule.pinNew ? `先放最新 ${rule.pinNew} 个、再` : ''}只照手动顺序显示前 ${rule.pinManual} 个,其余按新到旧;打开后这份清单生效期间完全按网格里的顺序(顾客自己选别的排序时照常),清单结束自动恢复。只改这个合集,不影响别的合集`}${rule.byPin ? `(现在由「${esc(rule.byPin)}」临时打开着)` : ''}</span></span></label>
      ${!wx.fullOrder && !nativeAll && rule.pinNew ? `<div class="note note--warn note--sm">这个合集前台默认会把最新的 ${rule.pinNew} 个产品放最前,和网格的顺序不完全一样 —— 打开「完全按我排的顺序」就一模一样。</div>` : ''}
      ${warns.map((w) => `<div class="note note--warn note--sm">${w}</div>`).join('')}
      <p class="muted pg__tip">拖动卡片到任意位置;或点左上角的序号直接输入要移到第几位。存的时候只记你动过的部分,没动的照原来的顺序。</p>
      <div class="pg" id="pg">${grid || '<p class="muted">这个合集里还没有产品</p>'}</div>
      ${wx.hidden.length ? `<div class="pg__hidh">这段时间不显示的产品(${wx.hidden.length} 个)<em>只在这份清单生效时藏起来,结束自动恢复</em></div>
        <div class="pg pg--hidden">${wx.hidden.map((p, i) => `<div class="pg__card is-cut">
          <span class="pg__img">${p.image ? `<img src="${esc(thumb(p.image, 240))}" alt="" loading="lazy">` : ''}</span>
          <span class="pg__t">${esc(p.title)}</span>
          ${priceRow(p)}
          <span class="pg__m"><span class="pg__b pg__b--cut">不显示</span>${d.origPos.has(pidOf(p)) ? `<span class="muted">原 #${d.origPos.get(pidOf(p)) + 1}</span>` : ''}</span>
          <span class="pg__acts pg__acts--on"><button type="button" data-wx="unhide" data-i="${i}">恢复显示</button></span></div>`).join('')}</div>` : ''}`}`;
  }
  // 网格里的操作:移到某一位 / 置顶 / 不显示 / 恢复
  function wxMove(from, to) {
    to = Math.max(0, Math.min(wx.order.length - 1, to));
    if (from === to) return;
    const [x] = wx.order.splice(from, 1); wx.order.splice(to, 0, x);
  }
  // 添加产品:放到最前面;已经在网格里的挪上来,在「不显示」里的拿回来
  function wxAddTop(list) {
    let added = 0; let lifted = 0; const top = [];
    for (const p of list) {
      const id = pidOf(p);
      const i = wx.order.findIndex((x) => pidOf(x) === id); const h = wx.hidden.findIndex((x) => pidOf(x) === id);
      if (i !== -1) { top.push(wx.order.splice(i, 1)[0]); lifted++; } else if (h !== -1) { top.push(wx.hidden.splice(h, 1)[0]); lifted++; } else { top.push(p); added++; }
    }
    wx.order.unshift(...top);
    if (list.length) toast([added && `加了 ${added} 个产品`, lifted && `${lifted} 个本来就在,挪到了最前面`].filter(Boolean).join(',') || '没有变化');
  }
  function wxUnhide(i) {
    const [p] = wx.hidden.splice(i, 1); if (!p) return;
    // 放回它原来的位置附近:排在原顺序里它前面那个产品的后面
    const at = wxBase.indexOf(pidOf(p));
    let to = 0;
    for (let k = at - 1; k >= 0; k--) { const j = wx.order.findIndex((x) => pidOf(x) === wxBase[k]); if (j !== -1) { to = j + 1; break; } }
    wx.order.splice(to, 0, p);
  }
  function wxFormHtml(it) {
    if (it.kind === 'pin') {
      return `${fld('名称', inp('name', it.name, '如:Flash Sale 第 1 天'))}
        ${timeBlock(it, 'pin')}
        <div id="wx-box">${pinBoxHtml()}</div>
        <div class="pg__opts">
          <label class="tgl"><input type="checkbox" name="countdown" ${it.countdown ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>这些产品显示倒计时</b><span class="muted">产品页和搜索 / 合集页的产品卡上都显示,倒数到这份清单结束(Flash 每天那一组用),到期自动消失</span></span></label>
          ${fld('徽章文字', inp('badge', it.badge, '如:Flash Deal · 今日限时'), '可留空;和倒计时一起显示在产品页和产品卡上')}
        </div>`;
    }
    return '';
  }
  // 置顶清单不要右边那栏预览了 —— 网格本身就是合集页生效时的样子
  function wxPreviewHtml() { return ''; }

  // 选合集 / 产品(置顶清单用)。在后台里用 Shopify 自带的选择器;演示时从演示数据里挑
  async function pickPin(type) {
    const m = (x) => ({ id: x.id, handle: x.handle, title: x.title, image: x.images?.[0]?.originalSrc || x.image || '' });
    if (window.shopify && typeof window.shopify.resourcePicker === 'function') {
      try {
        const sel = await window.shopify.resourcePicker({ type: type === 'coll' ? 'collection' : 'product', multiple: type !== 'coll', action: 'select' });
        if (!sel?.length) return;
        if (type === 'coll') wx.collection = m(sel[0]);
        else wxAddTop(sel.map(m));
        return true;
      } catch { /* 不在后台 → 用演示数据 */ }
    }
    if (type === 'coll') { // 演示:每点一次换下一个合集
      const L = S.collections || []; if (!L.length) return;
      const at = Math.max(0, L.findIndex((x) => String(x.id) === String(wx.collection?.id)));
      wx.collection = m(L[(at + 1) % L.length]);
    }
    else { const have = new Set(wx.order.map(pidOf)); wxAddTop(S.products.filter((p) => !have.has(pidOf(p))).slice(0, 2).map(m)); }
    return true;
  }

  const larkEdHtml = () => (ed.larkLinks.length ? `<div class="chips">${ed.larkLinks.map((l, i) => `<span class="chip"><span class="chip__t">${esc(l.label || '飞书任务')}</span><a class="lk" href="${esc(l.url)}" target="_blank" rel="noopener">打开↗</a><button type="button" class="chip__x" data-lk="rm" data-i="${i}" aria-label="移除">${I.x}</button></span>`).join('')}</div>` : '<span class="muted">还没关联</span>');
  // 分工:负责人 / 审批人 / 截止 / 抄送(所有内容都有,放在表单最后)
  function assignHtml(it) {
    if (it.isDefault || !team()) return '';
    const P = peopleFor(it.kind); const mine = me().id;
    const def = appr()[it.kind];
    const opt = (u, sel) => `<option value="${esc(u.id)}" ${sel === u.id ? 'selected' : ''}>${esc(u.name)}${u.admin || u.role === 'approver' ? '(管理员)' : ''}</option>`;
    // 不是管理员的人不能把自己设成审批人(除非他本来就是这类内容的默认审批人,或已经是这条的审批人)
    const apprList = P.filter((u) => isApprover() || u.id !== mine || def === mine || it.approver === mine);
    return `<div class="fld asg"><span>分工 <em>审批人不选 = ${def ? `这类内容的默认审批人「${esc(who(def))}」` : '管理员审批'};审批人自己提交直接生效</em></span>
      <div class="asg__row">
        <label class="asg__f">负责人<select class="sel" id="asg-owner"><option value="">不指定</option>${P.map((u) => opt(u, it.owner)).join('')}</select></label>
        <label class="asg__f">审批人<select class="sel" id="asg-approver"><option value="">${def ? `默认:${esc(who(def))}` : '管理员审批'}</option>${apprList.map((u) => opt(u, it.approver)).join('')}</select></label>
        <label class="asg__f" title="做好并提交的时间;快到了 / 过了还没提交会私信负责人">截止(可不填)<input class="inp" type="datetime-local" id="asg-due" value="${toInput(it.due)}"/></label>
      </div>
      <div class="asg__cc"><span class="muted">抄送(只通知,不能批准):</span>${P.filter((u) => u.id !== it.owner).map((u) => `<label class="asg__ck"><input type="checkbox" data-asg-cc value="${esc(u.id)}" ${(it.cc || []).includes(u.id) ? 'checked' : ''}/>${esc(u.name)}</label>`).join('') || '<span class="muted">没有别的成员</span>'}</div>
    </div>`;
  }
  function formHtml(it) {
    if (it.kind === 'pin') return wxFormHtml(it);
    if (it.kind === 'salelink') return slFormHtml(it);
    if (it.kind === 'callout') return coFormHtml(it);
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
        <div class="fld2">${fld('按钮 1 视频(可不填)', inp('button1_video', it.button1_video, 'YouTube / Vimeo 链接'), '填了 = 点按钮弹出视频,不跳转链接')}${fld('按钮 2 视频(可不填)', inp('button2_video', it.button2_video, 'YouTube / Vimeo 链接'), '比如「Watch Video」按钮')}</div>
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
      const color = (n, v, l) => `<label class="clr"><input type="color" name="${n}" value="${esc(v)}"/><span>${l}</span>${hexBox(v)}</label>`;
      return `
        <div class="fld"><span>从节日模板开始 <em>一键填好颜色、特效和装饰,填好后还能再改</em></span><div class="rowin">${Object.entries(TB_PRESETS).map(([k, x]) => `<button type="button" class="btn btn-sm" data-tbfill="${k}">${x.label}</button>`).join('')}</div></div>
        ${fld('样式名称', inp('name', it.name, '如:圣诞节 / Black Friday'))}
        <div class="fld"><span>颜色</span><div class="clrs">${color('bg', it.bg, '底色')}${color('color', it.color, '文字')}${color('accent', it.accent || '#f5d06f', '点缀(链接 / 箭头)')}</div></div>
        ${fld('特效', `<div class="seg" id="ed-effect">${Object.entries(EFFECT).map(([k, l]) => `<button type="button" data-effect="${k}" class="${(it.effect || 'none') === k ? 'is-active' : ''}">${l}</button>`).join('')}</div>`, '轻量的动画,只在顶栏这一条里,不影响页面其他地方')}
        <div class="fld2">${fld('公告前的装饰', inp('decoLeft', it.decoLeft, '如:🎄'))}${fld('公告后的装饰', inp('decoRight', it.decoRight, '如:🎅'))}</div>
        ${it.isDefault ? '' : fld('优先级', `<input class="inp" type="number" name="priority" value="${esc(it.priority ?? 10)}"/>`, '两个样式时间重叠时,数字大的生效')}
        ${timeBlock(it, 'tbstyle')}`;
    }
    if (it.kind === 'pmodule') {
      const color = (n, v, l) => `<label class="clr"><input type="color" name="${n}" value="${esc(v || '#000000')}"/><span>${l}</span>${hexBox(v || '#000000')}</label>`;
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
    // 活动设置:1 活动(名称 / 时间)→ 2 参加的产品 → 3 产品上显示什么(徽章 / 倒计时 / 样式)→ 4 飞书任务;挂在活动下的内容在活动页里管
    const attached = HUB_KINDS.flatMap(([k]) => listOf(k).filter((x) => x.campaign === it.id)).length;
    const sec = (n, title, hint, body) => `<div class="edsec"><div class="edsec__h"><span class="edsec__n">${n}</span>${title}${hint ? `<em>${hint}</em>` : ''}</div>${body}</div>`;
    return `
      ${sec(1, '活动', '', `${fld('活动名称', inp('name', it.name, '如:Autumn Sale'))}${timeBlock(it, 'campaign')}`)}
      ${sec(2, '参加的产品', '在任一合集里、带任一标签、或单独指定的产品都算', `<div class="scope" id="ed-scope">${scopeHtml()}</div>
        <p class="muted edsec__hint">点「后台↗ / 前台↗」可以核对具体是哪些产品。</p>`)}
      ${sec(3, '产品上显示什么', '产品页、搜索 / 合集页的产品卡、首页商品模块都按这里显示,右边是预览', `
        ${fld('徽章文字', inp('badge', it.badge, '如:Autumn Sale -20%'), '留空 = 不显示徽章')}
        <div class="fld"><span>徽章点了去哪 <em>自动 = 去这个产品所在的促销链接(没有就去参加的第一个合集);想统一去一个页面(比如 DZOFILM 总促销页)就选「指定链接」</em></span>
          <div class="rowin">${blSelect(it.badgeLink, 'name="badgeLinkMode" id="ed-blmode"')}
          <input class="inp mono" name="badgeLinkUrl" id="ed-blurl" value="${esc(blMode(it.badgeLink) === 'url' ? it.badgeLink : '')}" placeholder="/collections/dzofilm?view=bfcm-dzo" ${blMode(it.badgeLink) === 'url' ? '' : 'hidden'}/></div></div>
        <label class="tgl"><input type="checkbox" name="countdown" ${it.countdown ? 'checked' : ''}/><span class="tgl__ui"></span><span><b>显示倒计时</b><span class="muted">倒数到活动结束,到期自动消失</span></span></label>
        <div class="fld"><span>样式 <em>徽章和倒计时一起用;挂在这个活动下的合集置顶清单(Flash)也一样</em></span>
          <div class="cdsty" id="ed-cdsty">${Object.entries(CD_STY).map(([k, x]) => `<button type="button" data-cdsty="${k}" class="cdsty__i ${(it.countdownStyle || 'classic') === k ? 'is-active' : ''}">
            <span class="cdsty__demo" style="background:${x.bg};color:${x.fg};${k === 'minimal' ? '' : 'padding:4px 9px;'}border-radius:${k === 'classic' ? '6px' : '999px'}">${k === 'classic' || k === 'minimal' ? '' : CLOCK}${esc(x.lbl)} 2 days</span>
            <b>${x.name}</b><em>${x.hint}</em></button>`).join('')}</div></div>
        ${fld('倒计时文案', inp('countdownLabel', it.countdownLabel, CD_STY[it.countdownStyle || 'classic']?.lbl || ''), '空 = 用样式默认的,如「Black Friday ends in」')}
          <div class="fld"><span>颜色 <em>不改 = 用样式默认的;右边的框可以直接粘贴颜色代码</em></span><div class="rowin rowin--wrap">
            ${((bg, fg) => `<label class="clr2">底色 <input type="color" id="cd-bg" value="${esc(bg)}"/>${hexBox(bg)}</label>
            <label class="clr2">文字 <input type="color" id="cd-fg" value="${esc(fg)}"/>${hexBox(fg)}</label>`)(it.countdownBg || (CD_STY[it.countdownStyle]?.bg !== 'transparent' && CD_STY[it.countdownStyle]?.bg) || '#ffefef', it.countdownColor || CD_STY[it.countdownStyle || 'classic'].fg)}
            <button type="button" class="btn btn-sm" data-cdreset="1" ${it.countdownBg || it.countdownColor ? '' : 'hidden'}>用默认颜色</button></div></div>
        ${fld('优先级', `<input class="inp inp--num" type="number" name="priority" value="${esc(it.priority)}"/>`, '一个产品同时在几个活动里时,显示数字大的那个活动的徽章和倒计时')}`)}
      ${sec(4, '关联的飞书任务', '可不填 · 具体要求、设计、文案放在飞书任务里', `
        <div id="ed-lark">${larkEdHtml()}</div>
        <div class="rowin"><input class="inp" id="lk-url" placeholder="粘贴飞书任务 / 任务清单链接"/><input class="inp" id="lk-label" placeholder="名字,如「设计」(可不填)" style="max-width:170px"/><button type="button" class="btn btn-sm" data-lk="add">添加</button></div>`)}
      ${it.state === 'new' ? '<div class="note">保存后会打开这个活动的页面,在那里加 Banner、顶栏、首页商品模块、合集置顶、促销链接和改价。</div>'
        : cpHub === it.id && isActive('campaigns') ? '' : `<div class="note">挂在这个活动下的内容(${attached} 条)在活动页里管理。<button type="button" class="linkbtn" data-hubgo="${it.id}">打开活动页</button></div>`}`;
  }

  // 倒计时样式(和主题 snippets/cgp-campaign-offer.liquid 的默认颜色 / 文案一样,改一边要同步另一边)
  // 颜色代码:#abc / abc / #AABBCC / aabbcc 都认,统一成 #aabbcc;认不出返回 null
  const normHex = (x) => { const m = String(x || '').trim().replace(/^#/, '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i); return m ? '#' + (m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]).toLowerCase() : null; };
  // 色块旁边的十六进制输入框(没有 name,不会被 readForm 读走;和色块双向联动)
  const hexBox = (v) => `<input class="clr__hex mono" type="text" value="${esc(v)}" maxlength="7" spellcheck="false" autocomplete="off" title="十六进制颜色代码,可直接粘贴,如 #a23f3f"/>`;
  const CD_STY = {
    classic: { name: '经典红框', bg: '#ffefef', fg: '#d10000', lbl: 'Deals Expires in :', hint: '现在产品页用的' },
    pill: { name: '胶囊', bg: '#fdecec', fg: '#c8102e', lbl: 'Deal ends in', hint: '时钟图标,最后一天变实心' },
    dark: { name: '黑金', bg: '#111111', fg: '#f5c518', lbl: 'Deal ends in', hint: '适合 Black Friday' },
    minimal: { name: '只有文字', bg: 'transparent', fg: '#d10000', lbl: 'Ends in', hint: '不要底色' },
  };
  const cdOf = (v) => { const p = CD_STY[v.countdownStyle] || CD_STY.classic; return { key: CD_STY[v.countdownStyle] ? v.countdownStyle : 'classic', bg: v.countdownBg || p.bg, fg: v.countdownColor || p.fg, lbl: v.countdownLabel || p.lbl, custom: !!(v.countdownStyle && v.countdownStyle !== 'classic') || !!v.countdownBg || !!v.countdownColor }; };
  const CLOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>';
  // 产品页那一块:徽章和倒计时合成一条(和主题 cgp-campaign-offer.liquid 一样:只有一个就显示一个,都有 =「徽章 | 倒计时」)
  // timeId:倒计时数字的 id(给走秒用),不要倒计时传空
  function cdPdpHtml(v, badge, timeId, timeText = '0d 0h 0m 0s') {
    if (!badge && !timeId) return '';
    const c = cdOf(v);
    const sep = badge && timeId ? (c.key === 'minimal' ? '<span class="pv-co__dot">·</span>' : '<span class="pv-co__bar"></span>') : '';
    const cd = timeId ? `<span class="pv-co__cd">${c.key === 'pill' || c.key === 'dark' ? CLOCK : ''}<span class="pv-co__lbl">${esc(c.lbl)}</span> <b id="${timeId}">${esc(timeText)}</b></span>` : '';
    return `<div class="pv-co pv-co--${c.key}${badge && timeId ? ' pv-co--both' : ''}${timeId ? '' : ' pv-co--solo'}" style="${c.key === 'minimal' ? '' : `background:${c.bg};`}color:${c.fg}">${badge ? (() => { const link = v.badgeLink === 'none' ? '' : v.badgeLink ? v.badgeLink : v.collections?.length ? `合集 ${v.collections[0].title || ''}` : (S.salelinks || []).some((x) => x.campaign === v.id) ? '这个产品所在的促销链接' : '';
      return `<b class="${link ? 'is-link' : ''}" title="${link ? `点了去 ${esc(link)}` : '不能点'}">${esc(badge)}</b>`; })() : ''}${sep}${cd}</div>`;
  }
  function previewHtml(v) {
    if (v.kind === 'pin') return wxPreviewHtml(v);
    if (v.kind === 'salelink') return slPreviewHtml(v);
    if (v.kind === 'callout') return coPreviewHtml(v);
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
          <div class="pv-pdp__price">£4,999.00 <s>£5,899.00</s></div>
          ${cdPdpHtml(v, v.badge, v.countdown && v.end ? 'pv-cd' : '')}
          <div class="pv-pdp__btn">Add to cart</div>
        </div>
      </div>
      ${v.badge || (v.countdown && v.end) ? `<div class="pv-label">搜索 / 合集页的产品卡</div>
      <div class="pv-card">
        <div class="pv-card__img" ${prod ? `style="background-image:url('${esc(prod.image)}')"` : ''}></div>
        ${(() => { const c = cdOf(v); const st = c.custom ? `background:${c.bg};color:${c.fg}` : '';
          return `<div class="pv-cmp">${v.badge ? `<span class="pv-cmp__badge" style="${st}">${esc(v.badge)}</span>` : ''}${v.countdown && v.end ? `<span class="pv-cmp__cd ${c.custom ? 'is-chip' : ''}" style="${st}" id="pv-cd2"></span>` : ''}</div>`; })()}
        <div class="pv-card__title">${esc(prod?.title || v.products?.[0]?.title || 'DZOFILM VESPID 2 Prime 4 Lens Set')}</div>
        <div class="pv-card__price"><s>£5,899.00</s> £4,999.00</div>
      </div>` : ''}
      <p class="muted pv-scope">${hasScope ? `活动期间,${campScope(v)} 的产品在产品页和产品卡上显示${v.badge ? '这个徽章' : ''}${v.countdown ? (v.badge ? '和' : '') + '倒计时' : ''};活动结束自动消失。` : ((S.salelinks || []).some((x) => x.campaign === v.id) ? '没另外选产品:挂在这个活动下的促销链接里的产品(打折的,按链接条件)会显示这个徽章。' : '还没选产品:产品页不会显示任何东西,这个活动只用来让挂在它下面的 Banner / 顶栏同时上下线。')}</p>
      ${bn.length ? `<div class="pv-label">挂在活动下的 Banner</div><div class="pv-bns">${bn.map((b) => `<span class="pv-bn" data-pop="${b.id}">${slideHtml(b, { w: 300 })}</span>`).join('')}</div>` : ''}
      ${tb.length ? `<div class="pv-label">挂在活动下的顶栏</div>${tb.map((t) => topbarHtml(tbMsg(t, cst), { style: cst })).join('<div style="height:6px"></div>')}` : ''}`;
  }

  // 合集 / 产品选择器。在 Shopify 后台里打开时优先用 Shopify 自带的选择器(真实数据、可搜全店)
  async function pick(type) {
    // type:collections / products / exProducts(推广块排除的产品)/ promo(推广块推广的那一个产品,单选)
    const isProd = type !== 'collections'; const single = type === 'promo';
    const cur = () => (single ? (ed.promo ? [ed.promo] : []) : ed[type]);
    const put = (arr) => { if (single) { ed.promo = arr[arr.length - 1] || null; const el = $('#co-promo'); if (el) el.innerHTML = coPromoHtml(); $('#ed-form').dispatchEvent(new Event('change')); } else { ed[type] = arr; refreshScope(); } };
    if (window.shopify && typeof window.shopify.resourcePicker === 'function') {
      try {
        const sel = await window.shopify.resourcePicker({
          type: isProd ? 'product' : 'collection', multiple: !single, action: 'select',
          selectionIds: cur().filter((x) => String(x.id || '').startsWith('gid://')).map((x) => ({ id: x.id })),
        });
        if (!sel) return;
        const picked = sel.map((x) => ({ id: x.id, handle: x.handle, title: x.title, image: x.images?.[0]?.originalSrc || '', count: x.productsCount ?? null }));
        return put(single ? picked : [...cur().filter((x) => !String(x.id || '').startsWith('gid://')), ...picked]);
      } catch (e) { /* 不在后台 / 没权限 → 用下面的演示选择器 */ }
    }
    const src = isProd ? S.products : S.collections;
    const chosen = new Set(cur().map((x) => x.handle));
    const box = document.createElement('div');
    box.className = 'picker';
    box.innerHTML = `<div class="picker__box">
      <div class="picker__h"><b>选择${isProd ? '产品' : '合集'}</b><input class="inp" placeholder="搜索" id="pk-q"/></div>
      <div class="picker__list" id="pk-list"></div>
      <div class="picker__f"><span class="muted">演示:${isProd ? '列表是店里标了 New Gear 的真实产品' : '列表是首页链接里出现过的真实合集,数字是前台能看到的产品数'}。在 Shopify 后台打开时,这里会换成 Shopify 自带的选择器,可以搜全店。</span>
        <span class="picker__acts"><button class="btn btn-sm" data-pk="cancel" type="button">取消</button><button class="btn btn-sm btn-primary" data-pk="ok" type="button">确定</button></span></div>
    </div>`;
    $('#drawer').appendChild(box);
    const list = () => {
      const q = $('#pk-q').value.trim().toLowerCase();
      $('#pk-list').innerHTML = src.filter((x) => !q || x.title.toLowerCase().includes(q) || x.handle.includes(q)).map((x) => `
        <label class="picker__row"><input type="checkbox" value="${esc(x.handle)}" ${chosen.has(x.handle) ? 'checked' : ''}/>
          ${isProd ? `<span class="picker__img" ${x.image ? `style="background-image:url('${esc(x.image)}')"` : ''}></span>` : ''}
          <span class="picker__t">${esc(x.title)}</span>
          <span class="muted picker__m">${isProd ? esc(x.handle) : `${nTxt(x.count)} 个产品`}</span></label>`).join('') || '<p class="muted">没有匹配的</p>';
    };
    list();
    $('#pk-q').addEventListener('input', list);
    $('#pk-list').addEventListener('change', (e) => {
      if (single && e.target.checked) { chosen.clear(); $$('#pk-list input').forEach((i) => { if (i !== e.target) i.checked = false; }); } // 单选
      if (e.target.checked) chosen.add(e.target.value); else chosen.delete(e.target.value);
    });
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-pk]'); if (!b && e.target !== box) return;
      if (b && b.dataset.pk === 'ok') {
        const keepOld = cur().filter((x) => chosen.has(x.handle));
        const added = src.filter((x) => chosen.has(x.handle) && !keepOld.some((o) => o.handle === x.handle));
        put([...keepOld, ...added]);
      }
      box.remove();
    });
    $('#pk-q').focus();
  }
  function refreshScope(fromCounts) {
    const el = $('#ed-scope'); if (!el) return;
    if (ed.co) { fetchCoScope(); el.innerHTML = coScopeHtml(); $('#ed-form').dispatchEvent(new Event('change')); return; } // 产品页推广块
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
    if (!base.isDefault) {
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
    if (base.kind === 'pin') {
      const slim = ({ id, handle, title, image }) => ({ id, handle, title, image });
      const ids = wx.order.map(pidOf);
      // 只存「最短前缀」:前缀按顺序排最前,其余照原来的顺序 —— 展开回去和网格里一模一样;只显示前 N 个就存前 N 个
      const keepIds = wx.onlyN != null ? ids.slice(0, wx.onlyN) : (wxBase.length ? OD.minimalPrefix(wxBase, ids) : ids);
      const byId = new Map(wx.order.map((p) => [pidOf(p), p]));
      v.collection = wx.collection; v.products = keepIds.map((id) => slim(byId.get(id)));
      v.hidden = wx.hidden.map(slim);
      v.onlyListed = wx.onlyN != null; v.fullOrder = !!wx.fullOrder; v.countdown = !!g('countdown')?.checked;
    }
    // 分工(没有 name 属性,不走上面的通用读取)。空的抄送 / 截止不写成 [] / null,免得没改也算「改了」
    if ($('#asg-owner')) {
      v.owner = $('#asg-owner').value || null; v.approver = $('#asg-approver').value || null;
      const cc = $$('#ed-form [data-asg-cc]:checked').map((x) => x.value);
      v.cc = cc.length ? cc : base.cc ? [] : undefined;
      v.due = fromInput($('#asg-due').value) ?? (base.due != null ? null : undefined);
    }
    if (base.kind === 'callout') {
      const slim = (p) => (p ? { id: p.id, handle: p.handle, title: p.title, image: p.image || '' } : null);
      v.collections = [...ed.collections]; v.tags = [...ed.tags]; v.vendors = [...ed.vendors];
      v.products = ed.products.map(slim); v.exProducts = ed.exProducts.map(slim); v.exTags = [...ed.exTags]; v.promo = slim(ed.promo);
      v.link = String(v.link || '').trim(); if (g('priority')) v.priority = +g('priority').value || 0;
    }
    if (base.kind === 'salelink') {
      const num = (n) => { const x = Math.round(Number(g(n)?.value)); return x > 0 ? x : null; };
      v.collection = sl.collection; v.products = sl.products.map(({ id, handle, title, image }) => ({ id, handle, title, image }));
      v.slug = String(g('slug').value || '').trim().toLowerCase(); v.inStock = !!g('inStock').checked;
      v.minDiscount = num('minDiscount'); v.limit = num('limit'); v.sort = g('sort').value || '';
    }
    if (base.kind === 'campaign') {
      v.larkLinks = ed.larkLinks.map((l) => ({ url: l.url, label: l.label }));
      v.collections = [...ed.collections]; v.tags = [...ed.tags]; v.products = [...ed.products];
      v.countdown = g('countdown').checked; v.priority = +g('priority').value || 0;
      { const m = g('badgeLinkMode')?.value || ''; v.badgeLink = m === 'none' ? 'none' : m === 'url' ? String(g('badgeLinkUrl')?.value || '').trim() : ''; delete v.badgeLinkMode; delete v.badgeLinkUrl; }
      v.countdownStyle = ($('#ed-cdsty .is-active') || {}).dataset?.cdsty || '';
      if (v.countdownStyle === 'classic') v.countdownStyle = '';
      v.countdownBg = ed.cdBg ?? base.countdownBg ?? ''; v.countdownColor = ed.cdFg ?? base.countdownColor ?? '';
    }
    return v;
  }
  function validate(v) {
    if (v.kind === 'salelink') {
      if (!v.name) return '请填写名称';
      if (!v.collection) return '请选合集';
      if (!SL.SLUG_RE.test(v.slug)) return '链接后缀只能用小写字母、数字和横线(不能以横线开头,最多 40 个字)';
    }
    if (v.kind === 'pin' && !v.collection) return '请选要排序的合集';
    if (v.kind === 'pin' && !v.products.length && !(v.hidden || []).length) return '还没做任何调整:拖动产品换位置,或者把某些产品设为「不显示」';
    if (v.kind === 'pin' && wxAll && !wxAll.error && !wxAll.demo && wx.order.length === 0) return '合集里的产品全部设成了不显示,至少留一个';
    if (v.kind === 'banner' && !v.image) return '请选一张图片';
    if (v.kind === 'topbar' && !v.text) return '请填写公告文字';
    if ((v.kind === 'campaign' || v.kind === 'tbstyle' || v.kind === 'pmodule') && !v.name) return '请填写名称';
    if (v.kind === 'campaign' && v.start == null) return '活动需要开始时间';
    if (v.start != null && v.end != null && v.end <= v.start) return '结束时间要晚于开始时间';
    if (v.kind !== 'campaign' && v.campaign === null && ($('#ed-mode .is-active') || {}).dataset?.mode === 'campaign') return '请选择要跟随的活动';
    return '';
  }
  // 复制一份(所有内容都能复制,2026-10-16 用户:商品模块想从平时版本复制出来改,不用一个个重选)
  //   字段原样带过来,换新 id、变成还没保存的新内容;后台用的名字加「(复制)」(顾客看得到的标题 / 公告文字不动)。
  //   平时版本复制出来是普通版本 → 给下周的时间段,免得一保存就把首页换掉;促销链接的后缀要唯一,清空让人重填。
  function dupItem(src) {
    const prefix = { banner: 'b-', topbar: 't-', tbstyle: 's-', pmodule: 'pm-', pin: 'pin-', campaign: 'c-', salelink: 'sl-', callout: 'co-' }[src.kind] || 'x-';
    const v = JSON.parse(JSON.stringify(src));
    for (const k of ['shopifyId', 'syncedStatus', 'syncedTabIds', 'syncError', 'pendingChange', 'rejectNote', 'lastReject', 'counts']) delete v[k];
    Object.assign(v, { id: rid(prefix), state: 'new', by: S.me, owner: S.me, paused: false, isDefault: false });
    if (['pmodule', 'tbstyle', 'pin', 'campaign', 'salelink', 'callout'].includes(v.kind)) v.name = `${v.name || ''}(复制)`;
    if (v.kind === 'pmodule') v.tabs = (v.tabs || []).map((t) => { const { shopifyId, ...rest } = t; return { ...rest, id: rid('tab-'), products: [...(t.products || [])] }; }); // eslint-disable-line no-unused-vars
    if (v.kind === 'salelink') { v.slug = ''; v.view = ''; }
    if (v.kind === 'banner') v.order = S.banners.length;
    if (v.kind === 'topbar') v.order = S.topbar.length;
    if (src.isDefault) { v.start = dayStart(7); v.end = dayStart(14); v.campaign = null; v.priority = v.priority || 10; }
    openEditor(v.kind, null, { dup: v });
    toast(src.isDefault ? '已从平时版本复制一份 —— 改好内容、确认时间(默认下周)再保存' : '已复制一份 —— 改好、确认时间再保存');
  }
  function openEditor(kind, id, preset) {
    hidePop();
    const isNew = !id; const it = id ? byId(id) : (preset?.dup || newItem(kind, preset));
    if (!it) return;
    // 编辑看到的是「自己待审核的修改」,没有就看线上版本
    // preset.override:从别处带入的改动(比如把设计稿套用到 Banner),保存时照常走审核
    const base = { ...it, ...(it.pendingChange && !canAppr(it) ? it.pendingChange : {}), ...(id && preset?.override ? preset.override : {}) };
    ed = { collections: [...(base.collections || [])], tags: [...(base.tags || [])], products: [...(base.products || [])], counts: base.pendingChange ? null : base.counts, larkLinks: [...(base.larkLinks || [])],
      co: base.kind === 'callout', vendors: [...(base.vendors || [])], exProducts: [...(base.exProducts || [])], exTags: [...(base.exTags || [])], promo: base.promo || null };
    coRes = null;
    edTabs = (base.tabs || []).map((t) => ({ ...t, products: [...(t.products || [])] })); pvTab = 0;
    sl = base.kind === 'salelink' ? { collection: base.collection || null, products: [...(base.products || [])] } : null;
    wx = base.kind === 'pin' ? { collection: base.collection || null, order: [...(base.products || [])], hidden: [...(base.hidden || [])],
      onlyN: base.onlyListed ? (base.products || []).length : null, fullOrder: !!base.fullOrder, init: { products: base.products || [], hidden: base.hidden || [] } } : null;
    wxAll = null; wxBase = []; wxQ = ''; wxPosEdit = null; wxBusy = false;
    wxPlans = null; // 每次打开抽屉重新按需加载
    const s = status(it);
    const live = it.state === 'approved';
    // 能不能直接生效:已批准的看现在的审批人;还没批准的看表单里选的审批人(换了审批人按钮跟着变)
    const mayAppr = (formApprover) => canAppr(live ? it : { ...it, approver: formApprover === undefined ? base.approver : formApprover || null });
    const approver = mayAppr();
    const actsHtml = (ok) => {
      let h = '';
      if (ok) {
        if (!isNew && live && !it.isDefault && canAppr(it)) h += `<button class="btn" data-act="pause" type="button">${it.paused ? '恢复显示' : s === 'live' ? '暂停(立即下线)' : '暂停'}</button>`;
        if (isNew || it.state !== 'approved') h += '<button class="btn" data-act="draft" type="button">存草稿</button>';
        h += `<button class="btn btn-primary" data-act="publish" type="button">${live ? '保存修改' : '保存并排期'}</button>`;
      } else {
        if (isNew || ['draft', 'new', 'rejected'].includes(it.state)) h += '<button class="btn" data-act="draft" type="button">存草稿</button>';
        h += `<button class="btn btn-primary" data-act="submit" type="button">${live ? '提交修改审核' : '提交审核'}</button>`;
      }
      return h;
    };
    const acts = actsHtml(approver);
    const canDelete = !isNew && !it.isDefault && ['draft', 'rejected', 'ended'].includes(s);
    const notes = [];
    if (endingSoon(it)) notes.push(`<div class="note note--warn">⚠️ ${relDay(win(it).end)}(${fDT(win(it).end)})自动下架。要继续显示就把结束时间往后改${win(it).via ? '(它跟随活动,要改活动的结束时间)' : ''}。</div>`);
    if (it.pendingChange) notes.push(`<div class="note note--warn">${esc(who(it.pendingChange.by))} 提交了修改,正在等「${esc(apprName(it))}」审批。${approver ? '去「审核」页批准后才会替换线上版本。' : '批准前线上保持原来的版本。'}</div>`);
    if (it.state === 'pending') notes.push(`<div class="note note--warn">${esc(who(it.by))} 已提交,正在等「${esc(apprName(it))}」审批。</div>`);
    if (!approver && live && !it.pendingChange) notes.push(`<div class="note">这条已经批准。你的修改会先提交给「${esc(apprName(it))}」审批,<b>批准前线上保持原来的版本</b>。</div>`);
    if (it.state === 'rejected') notes.push(`<div class="note note--danger">被退回:${esc(it.rejectNote || '')}。修改后可以重新提交。</div>`);
    if (it.lastReject) notes.push(`<div class="note note--danger">上次的修改被退回:${esc(it.lastReject.note)}</div>`);
    if (it.note) notes.push(`<div class="note">${esc(it.note)}</div>`);
    if (MODE === 'live' && it.state === 'approved' && it.syncError) notes.push(`<div class="note note--danger">写进店铺时出错:${esc(it.syncError)}。${approver ? '点「保存修改」会重试。' : '请审核人处理。'}</div>`);

    $('#drawer').innerHTML = `
      <div class="drawer__h">
        <div>${kindChip(kind)} <b>${isNew ? `新建${KIND[kind]}` : esc(titleOf(it))}</b> ${isNew ? '' : badge(it)}
          ${!isNew && MODE === 'live' ? `<button class="btn btn-sm btn-ghost" type="button" data-act="history">${I.clock}历史版本</button>` : ''}
          ${!isNew ? `<button class="btn btn-sm btn-ghost" type="button" data-act="dup" title="复制成一条新的(连同你还没保存的修改),原来这条不变">${I.copy}复制一份</button>` : ''}</div>
        <button class="btn btn-ghost" data-act="close" type="button" aria-label="关闭">${I.x}</button>
      </div>
      <div class="drawer__b drawer__b--${kind}">
        <form class="drawer__form" id="ed-form" onsubmit="return false">${notes.join('')}${formHtml(base)}${assignHtml(base)}</form>
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
      if (v.kind === 'callout' && $('#co-imgsrc')) $('#co-imgsrc').innerHTML = coImgSrcHtml(v);
      if (v.kind === 'pmodule') loadTabPreview(v.tabs[pvTab], () => { if ($('#ed-pv') && edTabs) $('#ed-pv').innerHTML = previewHtml(readForm(base)); });
      // 代码框跟着色块走;正在输入的那个框只要和色块一致就不打断(别把用户敲到一半的写法改掉)
      $$('#ed-form .clr__hex').forEach((h) => { const c = h.closest('label')?.querySelector('input[type="color"]'); if (!c || (h === document.activeElement && normHex(h.value) === c.value)) return; h.value = c.value; h.classList.remove('is-bad'); });
      clearInterval(pvTimer);
      if (v.kind === 'campaign' && v.countdown && v.end) {
        const tick = () => {
          const left = Math.max(0, Math.floor((v.end - now()) / 1000));
          const c2 = $('#pv-cd2'); // 产品卡上的写法和主题一致:一天以上「Ends in 5d 21h」,一天以内走秒
          if (c2) c2.textContent = left >= 86400 ? `Ends in ${Math.floor(left / 86400)}d ${Math.floor(left % 86400 / 3600)}h`
            : `Ends in ${[left / 3600, left % 3600 / 60, left % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join(':')}`;
          const el = $('#pv-cd'); if (!el) return;
          let d = left;
          const dd = Math.floor(d / 86400); d %= 86400; const hh = Math.floor(d / 3600); d %= 3600;
          const p2 = (x) => String(x).padStart(2, '0');
          el.textContent = cdOf(v).key === 'classic' ? `${dd}d ${hh}h ${Math.floor(d / 60)}m ${d % 60}s`
            : `${dd > 0 ? `${dd} ${dd === 1 ? 'day' : 'days'} ` : ''}${p2(hh)}:${p2(Math.floor(d / 60))}:${p2(d % 60)}`;
        };
        tick(); pvTimer = setInterval(tick, 1000);
      }
    };
    refreshPv();
    if (kind === 'campaign' && MODE === 'live' && !ed.counts) fetchCounts();
    const f = $('#ed-form');
    // 倒计时色块显示成「现在实际用的颜色」:没自定义的那个跟着样式默认色走(onlyUnset = 只改没自定义的)
    const cdPaint = (k, onlyUnset) => {
      const p = CD_STY[k] || CD_STY.classic;
      if ($('#cd-bg') && !(onlyUnset && (ed.cdBg ?? base.countdownBg))) $('#cd-bg').value = p.bg === 'transparent' ? '#ffffff' : p.bg;
      if ($('#cd-fg') && !(onlyUnset && (ed.cdFg ?? base.countdownColor))) $('#cd-fg').value = p.fg;
    };
    f.addEventListener('input', (e) => {
      if (e.target.id === 'sc-vendor' && (e.inputType === 'insertReplacementText' || e.inputType == null) && (coVendors || []).includes(e.target.value) && !ed.vendors.includes(e.target.value)) { // 从下拉里点选的品牌直接加上
        ed.vendors.push(e.target.value); refreshScope(); $('#sc-vendor')?.focus(); return;
      }
      if (e.target.classList.contains('clr__hex')) { // 输入 / 粘贴颜色代码:认得出就同步到色块(走色块自己的流程:记录改动、刷新预览)
        const h = normHex(e.target.value); e.target.classList.toggle('is-bad', !h && !!e.target.value.trim());
        const c = e.target.closest('label')?.querySelector('input[type="color"]');
        if (h && c && c.value !== h) { c.value = h; c.dispatchEvent(new Event('input', { bubbles: true })); }
        return;
      }
      if (e.target.id === 'wx-q') { // 找产品:只把不匹配的变淡、滚到第一个匹配的,不打乱顺序
        wxQ = e.target.value; const q = wxQ.trim().toLowerCase(); let first = null;
        $$('#pg .pg__card[data-pg]').forEach((c) => {
          const hit = !q || (wx.order[+c.dataset.pg]?.title || '').toLowerCase().includes(q);
          c.classList.toggle('is-dim', !hit); if (q && hit && !first) first = c;
        });
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (e.target.id === 'wx-onlyn') { const n = Math.round(+e.target.value); if (n >= 1) { wx.onlyN = Math.min(n, wx.order.length); redrawWx(); const el = $('#wx-onlyn'); if (el) { el.focus(); el.setSelectionRange?.(9, 9); } } return; }
      if (e.target.id === 'pg-posin') return;
      if (e.target.dataset.tf) { edTabs[+e.target.dataset.i][e.target.dataset.tf] = e.target.value; }
      if (e.target.id === 'cd-bg' || e.target.id === 'cd-fg') { ed[e.target.id === 'cd-bg' ? 'cdBg' : 'cdFg'] = e.target.value; const rb = $('#ed-form [data-cdreset]'); if (rb) rb.hidden = false; }
      if (it.kind === 'salelink') { // 后缀:没手动改过就跟着名称自动生成;链接那一行实时更新
        const sg = f.querySelector('[name="slug"]');
        if (e.target.name === 'name' && !sg.dataset.touched) sg.value = SL.slugOf(e.target.value);
        if (e.target.name === 'slug') sg.dataset.touched = '1';
        // 选了页面模板:后缀跟着模板名走(一样才能用短链接 ?view=模板名);手动改过后缀就不动
        if (e.target.name === 'view' && !sg.dataset.touched && SL.VIEW_RE.test(e.target.value.trim()) && SL.SLUG_RE.test(SL.slugOf(e.target.value))) sg.value = SL.slugOf(e.target.value);
        redrawSlUrl();
      }
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
    // ---- 合集排序网格:「只显示前 N 个」开关、输入序号移动、拖拽 ----
    f.addEventListener('change', (e) => { // 颜色代码框离开时:认不出就恢复成色块现在的颜色,认得出就统一写法
      if (!e.target.classList.contains('clr__hex')) return;
      const c = e.target.closest('label')?.querySelector('input[type="color"]');
      e.target.value = normHex(e.target.value) || c?.value || ''; e.target.classList.remove('is-bad');
    });
    f.addEventListener('focusin', (e) => { if (e.target.classList?.contains('clr__hex')) e.target.dataset.sel = '1'; });
    f.addEventListener('change', (e) => {
      if (e.target.id === 'wx-full') { wx.fullOrder = e.target.checked; return redrawWx(); }
      if (e.target.id !== 'wx-only') return;
      if (e.target.checked) { const n = +($('#wx-onlyn')?.value) || 5; wx.onlyN = Math.max(1, Math.min(n, wx.order.length)); } else wx.onlyN = null;
      redrawWx();
    });
    const applyPos = (el) => {
      if (wxPosEdit == null) return;
      const from = wxPosEdit; wxPosEdit = null;
      const n = Math.round(+el.value);
      if (n >= 1) wxMove(from, n - 1);
      redrawWx();
      const card = $(`#pg .pg__card[data-pg="${Math.max(0, Math.min(wx.order.length, n) - 1)}"]`); if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('is-flash'); }
    };
    f.addEventListener('keydown', (e) => {
      if (e.target.id !== 'pg-posin') return;
      if (e.key === 'Enter') { e.preventDefault(); applyPos(e.target); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); wxPosEdit = null; redrawWx(); }
    });
    f.addEventListener('focusout', (e) => { if (e.target.id === 'pg-posin' && wxPosEdit != null) applyPos(e.target); });
    // 拖拽:用指针事件自己做(比浏览器自带的拖放稳,在 Shopify 后台的 iframe 里、触控板上都好用)
    //   按住卡片移动超过 6px 才算开始拖;松手时落在哪张卡的左半边 / 右半边,就插到它前面 / 后面
    const clearDrop = () => $$('#pg .drop-before, #pg .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    f.addEventListener('pointerdown', (e) => {
      const card = e.target.closest?.('#pg .pg__card[data-pg]');
      if (!card || e.button !== 0 || e.target.closest('button, input')) return;
      const sc = f.closest('.drawer__b');
      wxDrag = { from: +card.dataset.pg, x: e.clientX, y: e.clientY, card, ghost: null, target: null, after: false };
      let timer = null;
      const autoScroll = (y) => {
        clearInterval(timer); if (!sc) return;
        const r = sc.getBoundingClientRect(); const v = y < r.top + 80 ? -18 : y > r.bottom - 80 ? 18 : 0;
        if (v) timer = setInterval(() => sc.scrollBy(0, v), 30);
      };
      const move = (ev) => {
        const d = wxDrag; if (!d) return;
        if (!d.ghost) {
          if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 6) return;
          const r = d.card.getBoundingClientRect();
          d.ghost = d.card.cloneNode(true); d.ghost.classList.add('pg__ghost'); d.ghost.style.width = `${r.width}px`;
          d.dx = d.x - r.left; d.dy = d.y - r.top;
          document.body.appendChild(d.ghost); d.card.classList.add('is-dragging'); document.body.classList.add('is-pgdrag');
        }
        ev.preventDefault();
        d.ghost.style.transform = `translate(${ev.clientX - d.dx}px, ${ev.clientY - d.dy}px)`;
        autoScroll(ev.clientY);
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('#pg .pg__card[data-pg]');
        if (!over) { clearDrop(); d.target = null; return; }
        const r = over.getBoundingClientRect(); const after = ev.clientX > r.left + r.width / 2;
        if (d.target !== over || d.after !== after) { clearDrop(); over.classList.add(after ? 'drop-after' : 'drop-before'); d.target = over; d.after = after; }
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        clearInterval(timer);
        const d = wxDrag; wxDrag = null; if (!d) return;
        d.ghost?.remove(); d.card.classList.remove('is-dragging'); document.body.classList.remove('is-pgdrag'); clearDrop();
        if (!d.ghost || !d.target) return;
        const t = +d.target.dataset.pg; let to = d.after ? t + 1 : t; if (d.from < to) to -= 1;
        wxMove(d.from, to); redrawWx();
        const moved = $(`#pg .pg__card[data-pg="${Math.max(0, Math.min(wx.order.length - 1, to))}"]`); if (moved) moved.classList.add('is-flash');
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    f.addEventListener('change', (e) => {
      if (e.target.dataset?.tck) edTabs[+e.target.dataset.i][e.target.dataset.tck] = e.target.checked;
      if (e.target.name === 'afterEnd') { const u = $('#sl-afterurl'); if (u) { u.hidden = e.target.value !== 'url'; if (!u.hidden) u.focus(); } }
      if (e.target.name === 'badgeLinkMode') { const u = $('#ed-blurl'); if (u) { u.hidden = e.target.value !== 'url'; if (!u.hidden) u.focus(); } }
      if (e.target.id === 'asg-approver' && !live) $('#drawer .drawer__acts').innerHTML = actsHtml(mayAppr(e.target.value)); // 换了审批人:能不能直接生效跟着变
      refreshPv();
    });
    // ---- 合集置顶清单 / 设计需求 / 宣传物料 ----
    const redrawWx = () => {
      const box = $('#wx-box'); if (!box) return;
      const had = document.activeElement?.id === 'wx-q';
      box.innerHTML = pinBoxHtml();
      const pb = $('#wx-plans'); if (pb) pb.innerHTML = wxPlansHtml();
      if (had) { const q = $('#wx-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
      refreshPv();
    };
    if (it.kind === 'pin' && wx.collection) loadWxAll(redrawWx); // 打开就去读这个合集现在的顺序
    if (it.kind === 'salelink') { redrawSl(); slLoad(refreshPv); slLoadTpl(); }
    if (it.kind === 'callout') { refreshScope(); coLoadVendors(); }
    f.addEventListener('click', async (e) => {
      const lk = e.target.closest('[data-lk]');
      if (lk) {
        if (lk.dataset.lk === 'rm') ed.larkLinks.splice(+lk.dataset.i, 1);
        else {
          const url = $('#lk-url').value.trim(); const label = $('#lk-label').value.trim();
          if (!/^https:\/\/[^\s]*(larksuite|feishu|larkoffice)\.(com|cn)\//i.test(url)) return toast('请粘贴飞书任务或任务清单的链接', false);
          if (ed.larkLinks.some((x) => x.url === url)) return toast('这个链接已经加过了', false);
          ed.larkLinks.push({ url, label: label.slice(0, 30) }); $('#lk-url').value = ''; $('#lk-label').value = '';
        }
        $('#ed-lark').innerHTML = larkEdHtml(); return;
      }
      const sb = e.target.closest('[data-sl]');
      if (sb) { await slAct(sb, refreshPv); return; }
      const w = e.target.closest('[data-wx]'); if (!w || w.tagName === 'INPUT') return;
      const i = +w.dataset.i; const a = w.dataset.wx;
      if (a === 'pickcoll' || a === 'pickprod') {
        const before = wx.collection?.id;
        if (await pickPin(a === 'pickcoll' ? 'coll' : 'prod')) redrawWx();
        if (a === 'pickcoll' && wx.collection?.id !== before) loadWxAll(redrawWx); // 换了合集 → 重新读这个合集现在的顺序
        return;
      }
      if (a === 'loadplans') {
        try {
          const d = await api('GET', '/api/price/state');
          wxPlans = d.plans.filter((p) => p.slots?.some((x) => x.items?.length)).map((p) => {
            const its = p.slots.flatMap((x) => x.items);
            const prods = [...new Map(its.map((i) => [i.productId, i])).values()];
            return { id: p.id, name: p.name, n: prods.length, when: fDT(Math.min(...p.slots.map((x) => x.start))), prods };
          });
        } catch (e) { toast(e.message, false); wxPlans = []; }
        $('#wx-plans').innerHTML = wxPlansHtml(); return;
      }
      if (a === 'useplan') { // 改价计划里的产品按顺序放到最前面(已经在网格里的就挪上来)
        const pl = wxPlans.find((x) => x.id === w.dataset.id); if (!pl) return;
        const ids = pl.prods.map((x) => numId(x.productId));
        const fromGrid = new Map(wx.order.map((p) => [pidOf(p), p]));
        wx.order = wx.order.filter((p) => !ids.includes(pidOf(p)));
        wx.hidden = wx.hidden.filter((p) => !ids.includes(pidOf(p)));
        wx.order.unshift(...pl.prods.map((x) => fromGrid.get(numId(x.productId)) || { id: x.productId, title: x.product || x.title, image: x.image || '' }));
        toast(`${pl.prods.length} 个产品放到了最前面(按改价计划里的顺序)`);
        redrawWx(); return;
      }
      if (a === 'hist') { // 打开历史会关掉编辑窗口:有没保存的调整就先提醒一次
        const key = (o) => JSON.stringify([(o.products || []).map((p) => numId(p.id)), (o.hidden || []).map((p) => numId(p.id)), !!o.onlyListed]);
        if (key(readForm(base)) !== key(base) && !w.dataset.sure) { w.dataset.sure = '1'; w.textContent = '有还没保存的调整,再点一次会丢掉并打开历史'; return; }
        const c = wx.collection; closeDrawer(); openColHistory(numId(c.id), c.title); return;
      }
      if (a === 'pos') { wxPosEdit = i; redrawWx(); const inpEl = $('#pg-posin'); if (inpEl) { inpEl.focus(); inpEl.select(); } return; }
      if (a === 'totop') { wxMove(i, 0); return redrawWx(); }
      if (a === 'hide') { const [p] = wx.order.splice(i, 1); if (p) wx.hidden.push(p); if (wx.onlyN != null && i < wx.onlyN) wx.onlyN = Math.max(1, wx.onlyN - 1); return redrawWx(); }
      if (a === 'unhide') { wxUnhide(i); return redrawWx(); }
      if (a === 'reset') { // 全部撤销:回到原来的顺序
        const info = wx.info || new Map();
        wx.order = wxBase.filter((id) => info.has(id)).map((id) => info.get(id)); wx.hidden = []; wx.onlyN = null;
        toast('已撤销所有调整,回到原来的顺序'); return redrawWx();
      }
    });
    // 预览里点页签:切换预览的页签
    $('#ed-pv').addEventListener('click', (e) => { const t = e.target.closest('[data-pmtab]'); if (t && edTabs) { pvTab = +t.dataset.pmtab; refreshPv(); } });
    f.addEventListener('keydown', (e) => {
      const key = { 'sc-tag': 'tags', 'sc-extag': 'exTags', 'sc-vendor': 'vendors' }[e.target.id]; // 推广块多了排除标签、品牌
      if (!key || e.key !== 'Enter') return;
      e.preventDefault();
      const t = e.target.value.trim(); const id = e.target.id;
      if (t && !ed[key].includes(t)) { ed[key].push(t); refreshScope(); $('#' + id)?.focus(); } else e.target.value = '';
    });
    f.addEventListener('click', (e) => {
      if (e.target.classList?.contains('clr__hex')) { if (e.target.dataset.sel) { delete e.target.dataset.sel; e.target.select(); } return; } // 点进去先全选,方便复制
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
      const cs = e.target.closest('[data-cdsty]');
      if (cs) { $$('#ed-cdsty [data-cdsty]').forEach((b) => b.classList.toggle('is-active', b === cs)); const lbl = $('#ed-form [name="countdownLabel"]'); if (lbl) lbl.placeholder = CD_STY[cs.dataset.cdsty].lbl;
        cdPaint(cs.dataset.cdsty, true);
        refreshPv(); return; }
      if (e.target.closest('[data-cdreset]')) { ed.cdBg = ''; ed.cdFg = ''; cdPaint(($('#ed-cdsty .is-active') || {}).dataset?.cdsty); e.target.closest('[data-cdreset]').hidden = true; refreshPv(); return; }
      const tf = e.target.closest('[data-tbfill]');
      if (tf) {
        const v = TB_PRESETS[tf.dataset.tbfill].v;
        for (const k of ['bg', 'color', 'accent', 'decoLeft', 'decoRight']) { const el = f.querySelector(`[name="${k}"]`); if (el) el.value = v[k]; }
        const nm = f.querySelector('[name="name"]'); if (nm && !nm.value.trim()) nm.value = v.name;
        $$('#ed-effect button').forEach((b) => b.classList.toggle('is-active', b.dataset.effect === v.effect));
        refreshPv(); return;
      }
      const seg = e.target.closest('#ed-tag button, #ed-effect button, #ed-module button');
      if (seg) { $$(`#${seg.parentElement.id} button`).forEach((b) => b.classList.toggle('is-active', b === seg)); refreshPv(); return; }
      const im = e.target.closest('.imgpick__i');
      if (im) {
        f.querySelector('[name="image"]').value = im.dataset.img; f.querySelector('[name="imageId"]').value = im.dataset.imgid || '';
        $$('.imgpick__i').forEach((b) => b.classList.toggle('is-on', b === im)); refreshPv(); return;
      }
      const rmb = e.target.closest('[data-rm]');
      if (rmb) { const [k, i] = rmb.dataset.rm.split(':'); ed[k].splice(+i, 1); refreshScope(); return; }
      const co = e.target.closest('[data-co]');
      if (co) { // 推广块:不要推广的产品 / 图片改回用产品主图
        if (co.dataset.co === 'unpromo') { ed.promo = null; $('#co-promo').innerHTML = coPromoHtml(); }
        if (co.dataset.co === 'noimg') { f.querySelector('[name="image"]').value = ''; f.querySelector('[name="imageId"]').value = ''; }
        refreshPv(); return;
      }
      const pk = e.target.closest('[data-pick]');
      if (pk) pick(pk.dataset.pick);
    });

    $('#drawer').onclick = (e) => {
      if (e.target.closest('.picker') || e.target.closest('a.lk')) return;
      const nb = e.target.closest('[data-new]');
      if (nb && nb.dataset.for) { openEditor(nb.dataset.new, null, { campaign: nb.dataset.for }); return; }
      const op = e.target.closest('.attach__i[data-open]');
      if (op) { openEditor(byId(op.dataset.open).kind, op.dataset.open); return; }
      const hg = e.target.closest('[data-hubgo]');
      if (hg) { closeDrawer(); openHub(hg.dataset.hubgo); return; }
      const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
      const kindOfAct = a.dataset.act;
      if (kindOfAct === 'close') return closeDrawer();
      if (kindOfAct === 'history') return openItemHistory(it.id);
      if (kindOfAct === 'dup') return dupItem({ ...readForm(base), kind: it.kind, isDefault: !!it.isDefault });
      if (kindOfAct === 'delete' && !a.dataset.sure) { a.dataset.sure = '1'; a.textContent = '再点一次确认删除'; a.classList.add('btn-danger'); return; }
      runDrawerAction(kindOfAct, a);
    };

    // 按钮 → 动作(规则和权限检查都在共用模块 / 服务器里)
    async function runDrawerAction(kindOfAct, btn) {
      const busy = (on) => $$('#drawer .drawer__f .btn').forEach((b) => { b.disabled = on; });
      let r;
      if (kindOfAct === 'pause' || kindOfAct === 'delete') {
        busy(true); r = await act({ type: kindOfAct, id: it.id }); busy(false);
        if (r) { closeDrawer(); toast([r.message, ...colSay(r.colRep, it.collection?.id)].join(' · '), !(r.colRep?.failures?.length)); }
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
      if (isNew && it.kind === 'campaign' && byId(it.id)) openHub(it.id); // 新建的活动:直接进活动页继续加内容
      if (mode === 'publish') {
        const saved = byId(it.id); const st2 = saved ? status(saved) : '';
        const col = colSay(r.colRep, saved?.collection?.id);
        toast([st2 === 'scheduled' ? `已排期 · ${fDT(win(saved).start)} 自动上线` : st2 === 'live' ? '已上线' : `已保存${st2 ? ' · ' + ST[st2] : ''}`, ...col].join(' · '), !(r.colRep?.failures?.length));
      } else toast(mode === 'submit' ? `已提交给「${apprName({ ...it, ...v })}」审批${MODE === 'live' ? ' · 已私信通知' : '(演示)'}` : '已存草稿');
    }
  }
  // 合集排序执行结果 → 人话(立即执行一次、保存后自动执行共用)
  function colSay(rep, onlyCol) { // onlyCol:只说这个合集的(保存某份清单时,别把其他合集的情况也念一遍)
    if (!rep) return [];
    if (onlyCol) { const k = numId(onlyCol); const f = (x) => !x.collection || numId(x.collection) === k; rep = { applied: rep.applied.filter(f), restored: rep.restored.filter(f), skipped: rep.skipped.filter(f), holds: rep.holds.filter(f), failures: rep.failures.filter(f), sortOn: (rep.sortOn || []).filter(f), sortOff: (rep.sortOff || []).filter(f) }; }
    const WHY = { 'too-many': '要临时移出的产品太多,改用前台排序(店里的合集不动)', 'no-scope': 'app 还没有「改产品 / 合集」的权限' };
    const sortWhy = (x) => `这个合集的排序方式是「${SORT_CN[String(x.why).slice(5)] || String(x.why).slice(5)}」,不是「手动」→ 后台顺序没法改,只在前台按你排的显示(在 Shopify 后台把排序改成「手动」就能真的改)`;
    return [
      ...rep.applied.map((x) => `✅ 店里的「${x.title}」已按「${x.pin}」排好:${x.moved} 个产品换了位置${x.added ? `,${x.added} 个加进了合集` : ''}${x.removed ? `,${x.removed} 个临时移出` : ''}${!x.moved && !x.added && !x.removed ? '(本来就已经是这个顺序,没动)' : ''}${x.front?.hidden ? `;${x.front.hidden} 个「不显示」的由前台隐藏(产品还在合集里)` : ''}${x.front?.outside ? `;${x.front.outside} 个合集外的产品加不进去(要先在后台单独加进合集)` : ''}${x.front?.needsNewApi && (x.front.hidden || x.front.outside) ? '。把 API 版本升到 2026-07,app 就能直接改带条件的合集' : ''}${x.pending ? ';加进 / 排除的产品 Shopify 还在后台生效中,生效后会自动把顺序排好' : ''}`),
      ...rep.restored.map((x) => `↩️ 「${x.title}」已还原成接管前的顺序`),
      ...rep.skipped.map((x) => `⏭ ${x.title ? `「${x.title}」` : ''}${WHY[x.why] || (String(x.why || '').startsWith('sort:') ? sortWhy(x) : x.why)}`),
      ...rep.holds.map((x) => `⏸ 「${x.title}」有人在后台手动改过,app 已停手`),
      ...(rep.sortOn || []).map((x) => `📐 「${x.title}」合集页改成完全按清单顺序显示`),
      ...(rep.sortOff || []).map((x) => `📐 「${x.title}」合集页的排序方式恢复成原来的设置`),
      ...rep.failures.map((x) => `❌ ${x.message}`),
    ];
  }

  // ================= 合集顺序的历史版本 / 回滚 =================
  // 左边:每一版(什么时候、为什么、谁、和上一版比变了什么);右边:选中那一版的网格,和「现在」对比 ——
  // 红框 = 回滚后会加回合集,红虚线 = 会换位置,灰 = 后来才加进来的(回滚不删,排到最后)
  async function openColHistory(cid, title) {
    hidePop();
    const fmtAt = (ms) => fmt(ms, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    $('#drawer').innerHTML = `<div class="drawer__h"><div><span class="kchip">合集排序</span> <b>${esc(title)} · 历史版本</b></div>
        <button class="btn btn-ghost" data-act="close" type="button" aria-label="关闭">${I.x}</button></div>
      <div class="drawer__b drawer__b--hist"><div class="hist__list" id="hist-list"><p class="muted">读取中…</p></div><div class="hist__pv" id="hist-pv"></div></div>
      <div class="drawer__f"><span class="muted">每一版只记产品的先后顺序;每个合集保留最近 100 版 / 90 天</span><div class="drawer__acts" id="hist-acts"></div></div>`;
    $('#drawer').hidden = false; $('#drawer-mask').hidden = false; document.body.classList.add('no-scroll');
    $('#drawer').onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeDrawer(); };
    let versions = [];
    try { versions = (await api('GET', `/api/schedule/col-history?id=${encodeURIComponent(cid)}`)).versions; }
    catch (e) { $('#hist-list').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    if (!versions.length) { $('#hist-list').innerHTML = '<p class="muted">还没有记录。app 第一次接管这个合集时会先记下原样,之后每次改动都会记一版。</p>'; return; }
    $('#hist-list').innerHTML = versions.map((v, i) => `<button type="button" class="hist__i" data-at="${v.at}">
        <span class="hist__t"><b>${esc(fmtAt(v.at))}</b>${i === 0 ? '<span class="tag tag--ok">最新</span>' : ''}</span>
        <span class="hist__w">${esc(v.why || '')}${v.by ? ` · ${esc(v.by)}` : ''}</span>
        <span class="hist__c">${esc(v.change)} · ${v.n} 个产品</span></button>`).join('');
    const show = async (at) => {
      $$('#hist-list .hist__i').forEach((b) => b.classList.toggle('is-on', b.dataset.at === String(at)));
      $('#hist-pv').innerHTML = '<p class="muted">读取中…</p>'; $('#hist-acts').innerHTML = '';
      let r;
      try { r = await api('GET', `/api/schedule/col-history/version?id=${encodeURIComponent(cid)}&at=${at}`); }
      catch (e) { $('#hist-pv').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
      const info = new Map(r.products.map((p) => [numId(p.id), p]));
      const cur = r.current.map(String); const ver = r.version.ids.map(String);
      const target = [...ver, ...cur.filter((id) => !ver.includes(id))];       // 回滚后的样子(后来加的排最后)
      const d = OD.diffOrder(cur, target);
      const extra = new Set(cur.filter((id) => !ver.includes(id)));
      const card = (id, i) => { const p = info.get(id) || { title: `(产品 ${id} 已删除)` };
        const cls = extra.has(id) ? 'is-cut' : d.added.has(id) ? 'is-new' : d.moved.has(id) ? 'is-moved' : '';
        return `<div class="pg__card ${cls}"><span class="pg__pos">${i + 1}</span>
          <span class="pg__img">${p.image ? `<img src="${esc(thumb(p.image, 240))}" alt="" loading="lazy">` : ''}</span>
          <span class="pg__t">${esc(p.title)}</span>
          ${priceRow(p)}
          <span class="pg__m">${extra.has(id) ? '<span class="pg__b pg__b--cut">后来才加的,排到最后</span>' : d.added.has(id) ? '<span class="pg__b pg__b--new">会加回合集</span>' : d.moved.has(id) ? `<span class="pg__b pg__b--moved">现在 #${cur.indexOf(id) + 1}</span>` : ''}</span></div>`; };
      const same = !d.added.size && !d.moved.size;
      $('#hist-pv').innerHTML = `<div class="hist__h"><b>${esc(fmtAt(r.version.at))} 那一版</b> <span class="muted">${esc(r.version.why || '')}</span></div>
        <div class="pg__legend"><span class="lg lg--new"></span>会加回合集 <span class="lg lg--moved"></span>会换位置 <span class="lg lg--cut"></span>后来才加的(不删) <span class="lg"></span>不变
          <b class="pg__sum">${same ? '和现在一模一样' : `回滚会:${esc(OD.diffSummary(d))}`}</b></div>
        <div class="pg pg--ro">${target.map(card).join('')}</div>`;
      if (!same && isApprover()) {
        $('#hist-acts').innerHTML = '<button class="btn btn-primary" id="hist-rb" type="button">回滚到这个版本</button>';
        $('#hist-rb').onclick = async (e) => {
          const b = e.currentTarget;
          if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次确认回滚(会马上改店里的合集)'; b.classList.add('btn-danger'); return; }
          b.disabled = true; b.textContent = '回滚中…';
          try {
            const x = await api('POST', '/api/schedule/col-rollback', { id: cid, at });
            toast(`已回滚:${x.moved} 个换位置${x.added ? `、${x.added} 个加回合集` : ''}${x.extra ? `;${x.extra} 个后来加的排到了最后` : ''}${x.paused ? ';这个合集的清单接管已暂停' : ''}`);
            await load(); renderAll(); openColHistory(cid, title);
          } catch (err) { toast(err.message, false); b.disabled = false; b.textContent = '回滚到这个版本'; delete b.dataset.sure; b.classList.remove('btn-danger'); }
        };
      }
    };
    $$('#hist-list .hist__i').forEach((b) => b.addEventListener('click', () => show(b.dataset.at)));
    show(versions[0].at);
  }
  function closeDrawer() {
    clearInterval(pvTimer); ed = null; edTabs = null; wx = null; hidePop();
    $('#drawer').hidden = true; $('#drawer-mask').hidden = true; $('#drawer').innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  // ================= 全局 =================
  function renderAll() {
    applySiteStyle(); hidePop();
    renderOverview(); renderBanners(); renderTopbar(); renderPmodules(); renderPins(); renderSaleLinks(); renderCallouts(); renderCampaigns(); renderReviews(); renderSettings(); renderMyWork();
    if (isActive('history')) renderHistory();
    const n = pendingCount(); const b = $('#n-rv'); b.hidden = !n; b.textContent = n;
    if (!team()) { // 多人协作关着:不显示「我的工作」;「审核」只在还有遗留的待审核时显示
      const navOf = (k) => document.querySelector(`#modnav [data-section="${k}"]`);
      navOf('mywork').hidden = true; navOf('reviews').hidden = !n;
      if (['mywork', 'reviews'].some((k) => navOf(k).hidden && isActive(k))) showSection('overview');
    }
    const L = window.CGP_ME; // 飞书登录了就显示登录的人和他的角色
    $('#me-chip').innerHTML = L?.larkEnabled
      ? `<button class="mechip" type="button" title="我的账号">${L.member.avatar ? `<img class="avatar-img" src="${esc(L.member.avatar)}" alt=""/>` : `<span class="avatar">${esc(L.member.name.slice(0, 1).toUpperCase())}</span>`}${esc(L.member.name)}<span class="muted">· ${esc(L.member.roles.map((k) => L.roles.find((r) => r.key === k)?.name || k).join('、'))}</span></button>`
      : `<button class="mechip" type="button" title="${team() ? '切换身份(演示)' : '设置'}"><span class="avatar">${esc(me().name.slice(0, 1).toUpperCase())}</span>${esc(me().name)}${team() ? `<span class="muted">· ${isApprover() ? '审核人' : '编辑'}</span>` : ''}</button>`;
  }

  // 事件委托:任何地方的 data-open / data-new / data-go / 审核按钮
  document.addEventListener('click', (e) => {
    if (e.target.closest('#drawer')) return;
    const dp = e.target.closest('[data-dup]');
    if (dp && dp.closest('.section')) { const x = byId(dp.dataset.dup); if (x) dupItem(x); return; }
    const o = e.target.closest('[data-open]');
    if (o && o.closest('.section')) { const x = byId(o.dataset.open); if (x) openEditor(x.kind, x.id); return; }
    const n = e.target.closest('[data-new]');
    if (n && n.closest('.section')) { openEditor(n.dataset.new, null, n.dataset.for ? { campaign: n.dataset.for, channel: n.dataset.channel } : n.dataset.tbpreset ? { tbpreset: n.dataset.tbpreset } : undefined); return; }
    const hb = e.target.closest('[data-hub]');
    if (hb) { openHub(hb.dataset.hub); return; }
    if (e.target.closest('[data-hubback]')) { cpHub = null; renderCampaigns(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr && window.cgpPriceOpen) { showSection('price'); window.cgpPriceOpen(pr.dataset.price); return; }
    const pn = e.target.closest('[data-pricenew]');
    if (pn && window.cgpPriceNew) { const c = camp(pn.dataset.pricenew); showSection('price'); window.cgpPriceNew({ id: c.id, name: c.name }); return; }
    const g = e.target.closest('[data-go]');
    if (g) { showSection(g.dataset.go); if (g.dataset.go === 'history') loadHistoryPage(); return; }
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
  // 历史记录页:点开才去读(不跟着每次刷新一起读)
  document.querySelector('#modnav [data-section="history"]')?.addEventListener('click', () => loadHistoryPage());
  // 我的工作:点开时画一遍,顺便读改价计划(一分钟内不重复读)
  document.querySelector('#modnav [data-section="mywork"]')?.addEventListener('click', () => { renderMyWork(); loadMwPrice(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });


  // 顶部横条:告诉用户现在看的是演示还是正式数据
  function renderModeBar() {
    const bar = $('#demobar'); if (!bar) return;
    if (MODE === 'live') {
      bar.className = 'demobar demobar--live';
      bar.innerHTML = `<span class="demobar__tag">正式数据</span><span>改动${team() ? '按审核规则' : '保存后直接'}写进店铺 ${esc(S.store?.name || '')},正式网站跟着变。</span>
        <button class="linkbtn" id="mode-demo" type="button">临时看演示数据</button>`;
      $('#mode-demo').addEventListener('click', () => { localStorage.setItem(FORCE_DEMO, '1'); location.reload(); });
    } else if (liveSetup?.ready) {
      bar.className = 'demobar demobar--ready';
      bar.innerHTML = `<span class="demobar__tag">演示模式</span><span>现在看到的是<b>示例数据</b> —— 商品模块里的产品、价格都是编的。店里的内容类型已经建好了,切过去就能看到真实产品和真实排期。</span>
        <button class="btn btn-sm btn-primary" id="mode-live" type="button">切换到正式数据</button><button class="linkbtn" id="demo-reset" type="button">重置演示数据</button>`;
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
      [core, A, OD, SL] = await Promise.all([import('./lib/schedule-core.js'), import('./lib/schedule-actions.js'), import('./lib/order-diff.js'), import('./lib/sale-link.js')]);
      await window.CGP_AUTH; // 飞书登录门(没开飞书 / 演示预览时直接放行)
      MODE = await detectMode();
      if (MODE === 'demo') await load();
      renderModeBar(); renderAll();
      loadMwPrice(); // 「我的工作」的数字也算上等你批的改价计划
    } catch (e) {
      $('#ov-root').innerHTML = `<p class="muted">加载失败:${esc(e.message)}</p>`; console.error(e);
    }
  })();
})();
