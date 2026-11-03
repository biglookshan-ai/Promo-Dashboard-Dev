// 说明文字收成 ⓘ 小图标(2026-11-03 用户:界面说明文字太多,看着难用 —— 鼠标停上去 / 点一下才显示)。
// 整个 app 通用:页面画好后,自动把固定写法的说明换成图标(字段提示、分段标题后的提示、页头那一句话……),不用每个页面各改一遍。
// 想手动用:写 <span class="tipify">说明</span>,或 window.cgpTip('说明 HTML') 拿到图标的 HTML。
// ⛔ 只换不带 class 的 <em> / 指定的提示;报错(.fld__err)、提醒条(.note / .banner)不会被收起来。
(() => {
  // [选择器, 图标放在哪]:'self' = 原地换成图标;函数 = 放进返回的那个元素末尾;'afterText' = 放在第一段文字后面(标签名后面)
  const RULES = [
    // 字段提示:放在字段名后面;没有字段名的(比如 Banner「图片」那一块)并进这一段标题的图标里
    ['.fld > em:not([class])', (el) => el.parentElement.querySelector(':scope > span') || el.closest('.edsec')?.querySelector('.edsec__h') || 'self'],
    ['.panel > p.oc__help', (el) => el.parentElement.querySelector('.panel__h h3')],
    // 面板标题右边的说明(只收纯文字的;带按钮 / 粗体数字的是会变的状态,比如「看哪一刻:现在」,不动)
    ['.panel__h > span.muted:not(:has(button, b, select, input, a))', (el) => el.parentElement.querySelector('h3')],
    ['.edsec__h > em:not([class])', 'self'],
    ['.phead > div > p.muted', (el) => el.parentElement.querySelector('h2')],
    ['#section-price .pr-head > div > p.muted', (el) => el.parentElement.querySelector('h2')],
    ['#section-price .pr-fld > em:not([class])', 'afterText'],
    ['#section-price .pr-sec__h > span.muted', 'self'],
    ['#section-price .pr-group__lab > span.muted', 'self'],
    ['#section-price .pr-card__t > span.muted', 'self'],
    ['#section-price .pr-stockf > em', 'self'],
    ['.tipify', 'self'],
  ];
  const tipHtml = (html) => `<button type="button" class="tip" aria-label="说明" tabindex="0"><span class="tip__i" aria-hidden="true">i</span><span class="tip__c">${html}</span></button>`;
  window.cgpTip = tipHtml;
  const make = (html) => { const t = document.createElement('template'); t.innerHTML = tipHtml(html); return t.content.firstElementChild; };

  function run() {
    if (cur && !document.contains(cur)) hide(); // 页面重画了,图标没了:气泡也收起
    for (const [sel, where] of RULES) {
      for (const el of document.querySelectorAll(sel)) {
        const html = el.innerHTML.trim();
        if (!html) { el.remove(); continue; }
        const tip = make(html);
        if (where === 'self') { el.replaceWith(tip); continue; }
        if (where === 'afterText') {
          const host = el.parentElement; el.remove();
          // 标签名和图标包在一起(标签常是上下排的 flex,不包的话图标会单独占一行)
          const txt = [...host.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
          const row = document.createElement('span'); row.className = 'tip-row';
          if (txt) { txt.textContent = txt.textContent.replace(/\s+$/, ''); txt.replaceWith(row); row.append(txt, tip); } else { row.append(tip); host.prepend(row); }
          continue;
        }
        const anchor = where(el);
        if (anchor === 'self' || !anchor) { el.replaceWith(tip); continue; }
        el.remove();
        const has = anchor.querySelector(':scope > .tip .tip__c'); // 已经有图标了:说明并进同一个气泡,别并排两个
        if (has) has.insertAdjacentHTML('beforeend', `<br>${html}`); else anchor.append(tip);
      }
    }
  }
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; run(); }); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', schedule);

  // ---- 气泡:鼠标停上去显示、移开收起;点一下固定显示(手机 / 触控板),点别处或按 Esc 收起 ----
  let box = null, cur = null, pinned = false;
  function show(tip) {
    if (!box) { box = document.createElement('div'); box.className = 'tipbox'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box); }
    cur = tip; box.innerHTML = tip.querySelector('.tip__c')?.innerHTML || ''; box.hidden = false;
    const r = tip.getBoundingClientRect(); const b = box.getBoundingClientRect(); const pad = 8;
    let x = r.left + r.width / 2 - b.width / 2; x = Math.max(pad, Math.min(x, innerWidth - b.width - pad));
    let y = r.bottom + 6; if (y + b.height > innerHeight - pad) y = Math.max(pad, r.top - b.height - 6);
    box.style.left = `${x}px`; box.style.top = `${y}px`;
  }
  function hide() { if (box) box.hidden = true; cur = null; pinned = false; }
  document.addEventListener('mouseover', (e) => { const t = e.target.closest?.('.tip'); if (t && t !== cur) { pinned = false; show(t); } });
  document.addEventListener('mouseout', (e) => { const t = e.target.closest?.('.tip'); if (t && !pinned && !t.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('.tip'); if (t) show(t); });
  document.addEventListener('focusout', (e) => { if (e.target.closest?.('.tip') && !pinned) hide(); });
  // 捕获阶段处理点击:图标常常在可点的标题 / 标签里,别让点图标顺便打开分组、勾上复选框
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('.tip');
    if (t) { e.preventDefault(); e.stopPropagation(); if (pinned && cur === t) hide(); else { show(t); pinned = true; } return; }
    if (pinned && !e.target.closest?.('.tipbox')) hide();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  document.addEventListener('scroll', () => { if (cur && !pinned) hide(); else if (cur) show(cur); }, true);
})();
