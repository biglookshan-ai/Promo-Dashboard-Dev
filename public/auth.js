// v3 飞书登录门:在 app.js / schedule.js 之前加载。
//   - 没配飞书(服务器说 larkEnabled = false)或本地演示预览(没有接口)→ 直接放行,和以前一样
//   - 没登录 → 显示「用飞书登录」;后台里打开用弹窗 + 轮询,直接开网页就整页跳转
//   - 已登录但「待分配」→ 显示等管理员分配角色
//   - 已登录且启用 → 按角色隐藏看不到的页面,window.CGP_ME 记下当前用户
// 其他脚本用 window.cgpHeaders() 拿请求头,启动前 await window.CGP_AUTH。
(function () {
  const KEY = 'cgp-app-session';
  const SECTION_PAGE = { overview: 'overview', campaigns: 'campaigns', banners: 'banners', topbar: 'topbar', pmodules: 'pmodules', reviews: 'reviews', price: 'price', settings: 'settings', metafields: 'tools' };
  const embedded = () => !!(window.shopify && window.shopify.idToken);

  window.cgpHeaders = async function () {
    const h = {};
    if (embedded()) h.Authorization = 'Bearer ' + await window.shopify.idToken();
    const s = localStorage.getItem(KEY); if (s) h['X-App-Session'] = s;
    return h;
  };
  window.cgpLogout = function () { localStorage.removeItem(KEY); location.reload(); };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function gate(html) {
    document.body.classList.add('is-gated');
    let g = document.getElementById('auth-gate');
    if (!g) { g = document.createElement('div'); g.id = 'auth-gate'; g.className = 'authgate'; document.body.appendChild(g); }
    g.innerHTML = `<div class="authgate__card"><div class="authgate__logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/></svg></div>${html}</div>`;
    return g;
  }

  function showLogin(msg) {
    const g = gate(`<h2>网站更新中心</h2><p>请用你自己的飞书账号登录。第一次登录后,管理员给你分配角色就能用了。</p>
      ${msg ? `<p class="authgate__err">${esc(msg)}</p>` : ''}
      <button class="btn btn-primary" id="lark-login" type="button">用飞书登录</button>
      <p class="authgate__hint" id="lark-hint"></p>`);
    g.querySelector('#lark-login').addEventListener('click', () => (embedded() ? popupLogin(g) : location.assign('/auth/lark/start')));
  }

  // 后台(iframe)里:先同步开一个空弹窗(避免被拦截),拿到授权地址再跳过去;然后轮询服务器拿登录结果
  // 后台(iframe)里:先同步开一个空弹窗(避免被拦截),拿到授权地址再跳过去。
  // 飞书授权完,弹窗页显示 6 位验证码并自动传回这里;传不回来(浏览器隔离 / 弹窗被拦改用新窗口)就让用户手动输入。
  // 弹窗被拦 → 换成「在新窗口打开」的链接(用户自己点的链接一般不会被拦)。
  async function popupLogin(g) {
    const hint = g.querySelector('#lark-hint');
    const w = window.open('', 'cgp-lark-login', 'width=520,height=680');
    hint.textContent = '正在打开飞书登录…';
    let state;
    try {
      const r = await fetch('/api/auth/lark/start', { method: 'POST', headers: await window.cgpHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '打不开飞书登录');
      state = j.state;
      if (w) w.location.href = j.url;
      hint.innerHTML = `${w ? '请在弹出的窗口里完成飞书登录。' : `浏览器拦截了弹窗,<a href="${esc(j.url)}" target="_blank" rel="opener">点这里在新窗口打开飞书登录</a>。`}
        <span class="authgate__code">登录后输入它显示的验证码:<input class="inp" id="lark-code" inputmode="numeric" maxlength="6" placeholder="6 位数字"/><button class="btn btn-sm" id="lark-code-ok" type="button">确认</button></span>`;
    } catch (e) { try { w && w.close(); } catch (_) { /* 忽略 */ } hint.textContent = e.message; return; }

    let busy = false;
    const redeem = async (code) => {
      if (busy) return; busy = true;
      try {
        const r = await fetch('/api/auth/lark/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await window.cgpHeaders()) }, body: JSON.stringify({ state, code }) });
        const j = await r.json();
        if (!r.ok || !j.session) throw new Error(j.error || '登录失败');
        localStorage.setItem(KEY, j.session); location.reload();
      } catch (e) { const err = g.querySelector('.authgate__err') || hint.insertAdjacentElement('afterend', Object.assign(document.createElement('p'), { className: 'authgate__err' })); err.textContent = e.message; }
      finally { busy = false; }
    };
    g.querySelector('#lark-code-ok').addEventListener('click', () => redeem(g.querySelector('#lark-code').value));
    g.querySelector('#lark-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(e.target.value); });
    // 弹窗自动传回验证码(只认同一个网址发来的、这次登录的)
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'cgp-login' || e.data.state !== state) return;
      g.querySelector('#lark-code').value = e.data.code; redeem(e.data.code);
    });
    // 飞书那边完成了就提示输验证码
    const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60_000) {
      await new Promise((res) => setTimeout(res, 2000));
      const st = await fetch(`/api/auth/lark/status?state=${encodeURIComponent(state)}`, { headers: await window.cgpHeaders() }).then((x) => x.json()).catch(() => ({}));
      if (st.gone) { hint.textContent = '登录已过期,请重新点「用飞书登录」'; return; }
      if (st.done) { g.querySelector('#lark-code')?.focus(); return; }
    }
  }

  function showPending(me) {
    const g = gate(`<h2>你好,${esc(me.member.name)}</h2>
      <p>${me.member.status === 'disabled' ? '你的账号已被管理员停用。' : '你已经用飞书登录,等管理员给你分配角色后就能用了。'}</p>
      <p class="authgate__hint">分配好后刷新这个页面即可。</p>
      <div class="authgate__row"><button class="btn" id="g-refresh" type="button">刷新</button><button class="btn btn-ghost" id="g-out" type="button">换个账号登录</button></div>`);
    g.querySelector('#g-refresh').addEventListener('click', () => location.reload());
    g.querySelector('#g-out').addEventListener('click', window.cgpLogout);
  }

  // 按角色隐藏看不到的页面;当前页看不到就跳到第一个能看的
  function applyPages(pages) {
    const ok = new Set(pages);
    document.querySelectorAll('#modnav .modnav__item').forEach((b) => { b.hidden = !ok.has(SECTION_PAGE[b.dataset.section]); });
    const first = [...document.querySelectorAll('#modnav .modnav__item')].find((b) => !b.hidden);
    const active = document.querySelector('#modnav .modnav__item.is-active');
    if (first && (!active || active.hidden)) setTimeout(() => window.showSection && window.showSection(first.dataset.section), 0);
  }
  // 测试模式开着:顶部一直显示红条,免得忘了关
  function showTestModeBar(tm) {
    const nav = document.getElementById('modnav'); if (!nav) return;
    const bar = document.createElement('div');
    bar.className = 'tmbar';
    const left = () => { const m = Math.max(0, Math.round(tm.left / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`; };
    bar.innerHTML = `<b>测试模式开着</b><span>从 Shopify 后台打开的人不用登录飞书、直接是管理员(${esc(tm.byName || '')} 开的)。还有 <b id="tm-left">${left()}</b> 自动关闭。</span><button class="btn btn-sm" type="button">立即关闭</button>`;
    bar.querySelector('button').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await fetch('/api/test-mode', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await window.cgpHeaders()) }, body: JSON.stringify({ on: false }) });
        if (!r.ok) throw new Error((await r.json()).error || '关不掉');
        location.reload();
      } catch (err) { e.target.disabled = false; bar.querySelector('span').textContent = err.message; }
    });
    nav.parentNode.insertBefore(bar, nav);
    setInterval(() => { tm.left -= 30000; const el = document.getElementById('tm-left'); if (el) el.textContent = left(); if (tm.left <= 0) location.reload(); }, 30000);
  }

  // 管理员:有新同事登录、等分配角色 → 顶部提示 +「设置」上的红点
  function showPendingNotice(n) {
    const nav = document.getElementById('modnav'); if (!nav) return;
    const set = nav.querySelector('[data-section="settings"]');
    if (set && !set.querySelector('.modnav__n')) set.insertAdjacentHTML('beforeend', `<span class="modnav__n modnav__n--alert">${n}</span>`);
    const bar = document.createElement('div');
    bar.className = 'pendbar';
    bar.innerHTML = `<span>有 <b>${n}</b> 个同事用飞书登录了,等你分配角色(没分配前他们什么都看不到)。</span><button class="btn btn-sm" type="button">去分配</button>`;
    bar.querySelector('button').addEventListener('click', () => { window.showSection && window.showSection('settings'); setTimeout(() => document.getElementById('st-members')?.scrollIntoView({ block: 'center' }), 300); });
    nav.parentNode.insertBefore(bar, nav);
  }
  window.cgpCanSee = (page) => !window.CGP_ME || !window.CGP_ME.larkEnabled || (window.CGP_ME.pages || []).includes(page);

  const never = new Promise(() => {});
  window.CGP_AUTH = (async () => {
    let cfg;
    try {
      const r = await fetch('/api/auth/config');
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return { offline: true }; // 本地演示预览
      cfg = await r.json();
    } catch { return { offline: true }; }
    if (!cfg.larkEnabled) return { legacy: true };
    const r = await fetch('/api/me', { headers: await window.cgpHeaders() });
    const me = await r.json().catch(() => ({}));
    if (r.status === 401 || !me.member) { if (r.status === 401 && me.needsAuth && !me.needLogin) showLogin(me.error); else showLogin(); return never; }
    if (me.member.status !== 'active') { showPending(me); return never; }
    window.CGP_ME = me;
    applyPages(me.pages);
    if (me.testMode?.on) showTestModeBar(me.testMode);
    if (me.pendingCount) showPendingNotice(me.pendingCount);
    return me;
  })();
})();
