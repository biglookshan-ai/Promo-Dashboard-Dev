// 促销弹窗预览:倒计时、出现 / 停留 / 隐藏、悬停暂停、× 关闭,以及第一次来(有 Cookie 提示)时怎么让位。
// 「一直显示」= 方便同事看和评论;「播放真实效果」= 和网站上一样:等 2 秒出现、停 5 秒、自动隐藏。
(function () {
  var END = Date.parse('2026-12-03T23:59:00Z'); // Early Black Friday 结束:12/3 23:59(英国时间)
  var DELAY = 2000, SHOW = 5000;
  var pop = document.querySelector('.cgpp');
  var cd = pop.querySelector('[data-cd]');
  var bar = pop.querySelector('.cgpp__bar');
  var ckb = document.querySelector('.ckb');
  var note = document.querySelector('.pvbar em');
  var mobile = matchMedia('(max-width: 749px)').matches;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  function tick() {
    var s = Math.max(0, Math.floor((END - Date.now()) / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    cd.innerHTML = '<span>Ends in </span>' + (d ? '<b>' + d + '</b>d ' : '') + '<b>' + pad(h) + '</b>h <b>' + pad(m) + '</b>m <b>' + pad(x) + '</b>s';
  }
  tick(); setInterval(tick, 1000);

  // 第一次来:Cookie 提示还在 → 电脑上卡片排在它上面;手机上等点完 Cookie 再弹
  var cookieOn = function () { return ckb && !ckb.hasAttribute('data-gone'); };
  function place() { pop.style.bottom = (!mobile && cookieOn()) ? (20 + ckb.offsetHeight + 12) + 'px' : ''; }

  var mode = 'keep', timers = [], left = 0, startAt = 0, paused = false;
  function clear() { timers.forEach(clearTimeout); timers = []; }
  function say(t) { if (note) note.textContent = t || ''; }
  function show() { place(); pop.dataset.state = 'on'; }
  function hide() { pop.dataset.state = 'off'; bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; }

  // 自动隐藏计时(悬停 / 按住 / 键盘聚焦时停下)
  function runBar(ms) {
    left = ms; startAt = Date.now(); paused = false;
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(' + (ms / SHOW) + ')';
    requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.transition = 'transform ' + ms + 'ms linear'; bar.style.transform = 'scaleX(0)'; }); });
    timers.push(setTimeout(function () { hide(); say('已自动隐藏 · 1 小时后才会再弹 / Hidden, shows again after 1 hour'); }, ms));
  }
  function pause() {
    if (mode !== 'play' || paused || pop.dataset.state !== 'on') return;
    paused = true; clear(); left -= Date.now() - startAt;
    var k = getComputedStyle(bar).transform; bar.style.transition = 'none'; bar.style.transform = k;
    say('鼠标在上面,先不隐藏 / Paused while hovering');
  }
  function resume() { if (mode !== 'play' || !paused) return; say(''); runBar(Math.max(400, left)); }
  pop.addEventListener('mouseenter', pause); pop.addEventListener('mouseleave', resume);
  pop.addEventListener('touchstart', pause, { passive: true }); pop.addEventListener('touchend', function () { setTimeout(resume, 1500); });
  pop.addEventListener('focusin', pause); pop.addEventListener('focusout', resume);

  function start(m) {
    mode = m; clear(); hide();
    document.querySelectorAll('.pvbar [data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === m)); });
    if (mobile && cookieOn()) { say('手机:先点 Cookie 提示的 Accept / Decline,弹窗才出来 / Shows after the cookie notice is answered'); return; }
    if (m === 'keep') { say(''); timers.push(setTimeout(show, 300)); return; }
    say('等 2 秒出现… / Appears after 2s');
    timers.push(setTimeout(function () { show(); say('停 5 秒,鼠标放上去会暂停 / Stays 5s, hover to pause'); runBar(SHOW); }, DELAY));
  }

  pop.querySelector('.cgpp__x').addEventListener('click', function () { clear(); hide(); say('点了 × · 今天不再弹这个弹窗 / Closed, not shown again today'); });
  pop.querySelector('.cgpp__link').addEventListener('click', function (e) { e.preventDefault(); say('会去 Black Friday 活动页(这一页本身不弹)/ Opens the Black Friday page (no popup there)'); });
  if (ckb) ckb.querySelectorAll('[data-ck]').forEach(function (b) {
    b.addEventListener('click', function () {
      ckb.setAttribute('data-gone', '');
      if (pop.dataset.state === 'on') { place(); return; } // 电脑:卡片落回原位
      if (mobile) { say('Cookie 点完了,1 秒后弹出 / Cookie answered, showing in 1s'); timers.push(setTimeout(function () { start(mode); }, 1000)); }
    });
  });
  document.querySelectorAll('.pvbar [data-mode]').forEach(function (b) { b.addEventListener('click', function () { start(b.dataset.mode); }); });
  var rs = document.querySelector('.pvbar [data-restart]'); // 第一次来:让 Cookie 提示重新出现
  if (rs) rs.addEventListener('click', function () { if (ckb) ckb.removeAttribute('data-gone'); start(mode); });
  addEventListener('resize', function () { if (pop.dataset.state === 'on') place(); });
  start('keep');
})();
