// 网址 ↔ 页面(2026-11-09 用户:整个 app 只有一个网址,去哪个功能都要打开后逐个点)
// 每个页面、每条内容、每个改价计划都有自己的网址,在 app 里换页面时地址栏跟着变(能直接复制、浏览器后退也能用):
//   /                          概览
//   /<页面>                     banners topbar pmodules callouts pins salelinks campaigns price mywork reviews history audit notify settings metafields metaobjects promo
//   /<内容页面>/<内容 id>        打开那条内容的编辑(Banner / 顶栏 / 商品模块 / 推广块 / 置顶排序 / 促销链接)
//   /campaigns/<活动 id>[/web|/price|/lark|/edit]   活动页(哪个分页)/ 活动设置
//   /pins/collection/<Collection id>                 Collection 默认排序设置
//   /price[/<计划 id>|/vault|/ledger|/settings]       改价:某个计划 / 受管产品 / 价格账本 / 改价设置
//   /notify[/groups|/log]                            通知中心
//   /settings[/members|/roles|/conn|/my-notify]      设置里的某一块
// 在 Shopify 后台里:app 换页面时改 iframe 的网址(history.pushState),Shopify 同步到后台地址栏;
// 后台网址 admin.shopify.com/store/<店>/apps/<app>/banners/xxx 打开时,Shopify 把 /banners/xxx 带进 iframe。
// Shopify 带来的参数(shop / host / id_token…)原样留在 iframe 网址上(app 里有好几处整页刷新,刷新时还要用)。
// 谁算网址 / 谁打开网址:schedule.js 给 cgpNav.pathOf / cgpNav.open;改价、通知中心各自给 cgpPricePath / cgpPriceRoute、cgpNotifyPath / cgpNotifyRoute。
(function () {
  const clean = (p) => { p = String(p || '/').replace(/\/index\.html$/, '/').replace(/\/+$/, ''); return p || '/'; };
  const START = clean(location.pathname); // 打开时的网址(启动过程中会自动切页面,先记下来)
  let ready = false; let applying = 0; let queued = false; let lastPush = 0;

  function push(replace) {
    const p = N.pathOf?.();
    if (p == null) return; // 这个界面不单独记网址(比如还没保存的新计划)
    if (clean(p) === clean(location.pathname)) return;
    const url = p + location.search;
    const t = Date.now();
    // 一次点击里先后换了两次(比如先切到改价页、再打开计划):只记最后那个,后退不用按两次
    if (replace || t - lastPush < 250) history.replaceState(null, '', url); else history.pushState(null, '', url);
    lastPush = t;
  }
  async function apply(path) {
    applying++;
    try { await N.open?.(clean(path)); } catch (e) { console.error('[nav]', e); }
    finally { applying--; }
    push(true); // 打不开(找不到 / 没权限)时网址改回现在真正看到的页面
  }

  const N = window.cgpNav = {
    start: START,
    pathOf: null, // () => 现在界面对应的网址;null = 不改
    open: null,   // async (path) => 打开这个网址对应的界面
    // 界面变了就调;同一轮里调多少次都只算一次
    sync() {
      if (!ready || applying || queued) return;
      queued = true;
      setTimeout(() => { queued = false; if (!applying) push(false); }, 0);
    },
    // 数据都读好后由 schedule.js 调一次:打开启动时的网址
    async ready() {
      if (ready) return; ready = true;
      if (START !== '/') await apply(START); else push(true);
    },
    go: (path) => apply(path),
    // 等某个模块把接口挂上(改价是 module 脚本,加载得晚)
    when(name, ms = 15000) {
      return new Promise((res) => {
        const t0 = Date.now();
        (function tick() { if (window[name]) return res(window[name]); if (Date.now() - t0 > ms) return res(null); setTimeout(tick, 50); })();
      });
    },
    // 给同事的链接:有 Shopify 后台地址就用后台地址(同事点开直接进 app 里那一页),没有就用当前网站
    link(path) {
      const p = path == null ? (N.pathOf?.() ?? location.pathname) : path;
      const base = (window.CGP_APP_URL || location.origin).replace(/\/$/, '');
      return base + (p === '/' ? '' : p);
    },
    async copy(path, label = '链接') {
      const url = N.link(path);
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch { /* 后台 iframe 里可能不让用剪贴板,换老办法 */ }
      if (!ok) {
        const ta = document.createElement('textarea'); ta.value = url; ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
      }
      if (ok) window.toast?.(`${label}已复制,发给同事点开就是这一页`);
      else window.prompt('复制这个链接:', url);
      return url;
    },
  };
  // 浏览器 / Shopify 后台的后退、前进
  window.addEventListener('popstate', () => { if (ready) apply(location.pathname); });
})();
