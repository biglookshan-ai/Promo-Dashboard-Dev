// 通知中心页面(2026-11-09):通知规则 / 飞书群 / 发送记录(管理员);「我的通知」画在「设置 → 我的账号」里(window.cgpMyNotify)。
// 规则怎么算谁收到在服务器 src/notify-center.js;这里只画和改。用 app.js 的 api / toast / esc。
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fDT = (ms) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Europe/London', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const MOD_ORDER = ['content', 'price', 'pins', 'joint'];
  const LV = { problem: '<span class="tag tag--warn">出问题</span>', approval: '<span class="tag">审批</span>' };
  // 可勾的收件人(相关的人 / 同部门要看每条通知具体和谁有关)
  const TO = [
    ['related', '相关的人', '建 / 改这条内容或这个计划的人(负责人、抄送也算)'],
    ['dept', '同部门', '和相关的人同一个角色、能看这类页面的同事'],
    ['admins', '管理员', '所有管理员'],
    ['page', '能看这页的人', '所有能打开这类页面的同事'],
    ['approver', '审批人', '这条内容 / 计划的审批人'],
  ];
  const PAGE_OF_MOD = { price: 'price', pins: 'pins', joint: 'callouts' };
  const CONTENT_PAGES = ['banners', 'topbar', 'pmodules', 'callouts', 'pins', 'salelinks', 'campaigns'];
  let V = null; let tab = 'rules'; let logRows = []; let logMore = false; let logMod = ''; let busy = false;

  const nameOf = (id) => V.members.find((m) => m.id === id)?.name || id;
  const seesPage = (m, page) => (m.roles || []).some((k) => k === 'admin' || (V.roles.find((r) => r.key === k)?.pages || []).includes(page));
  const seesMod = (m, ev) => (ev.page || PAGE_OF_MOD[ev.mod] ? seesPage(m, ev.page || PAGE_OF_MOD[ev.mod]) : CONTENT_PAGES.some((p) => seesPage(m, p)));
  // 一句话说清这条规则现在发给谁
  function whoText(ev, r) {
    if (!r.on) return '关着,不发';
    const parts = [];
    if (r.to.related) parts.push('相关的人');
    if (r.to.approver && ev.level === 'approval') parts.push('审批人');
    if (r.to.dept) parts.push('同部门');
    const fixed = new Set();
    if (r.to.admins) V.members.filter((m) => m.roles.includes('admin')).forEach((m) => fixed.add(m.name));
    if (r.to.page) V.members.filter((m) => seesMod(m, ev)).forEach((m) => fixed.add(m.name));
    r.to.roles.forEach((k) => V.members.filter((m) => m.roles.includes(k)).forEach((m) => fixed.add(m.name)));
    r.to.people.forEach((id) => fixed.add(nameOf(id)));
    const groups = r.to.groups.map((id) => V.groups.find((g) => g.id === id)?.name).filter(Boolean);
    const who = [parts.join(' + '), fixed.size ? [...fixed].join('、') : ''].filter(Boolean).join(' + ');
    const s = [who ? `私信:${who}` : '', groups.length ? `飞书群:「${groups.join('」「')}」` : ''].filter(Boolean).join(' · ');
    return s || (ev.level === 'info' ? '⚠️ 谁都没选,不会发' : '谁都没选:会发给管理员(出问题的不能没人知道)');
  }
  const dd = (ev, k, label, opts, sel, empty) => `<details class="ndd" data-dd="${k}"><summary class="nchip ${sel.length ? 'is-on' : ''}">${label}${sel.length ? ` · ${sel.length}` : ''} ▾</summary>
    <div class="ndd__pop">${opts.length ? opts.map(([v, n]) => `<label class="chk"><input type="checkbox" data-nr-list="${k}" value="${esc(v)}" ${sel.includes(v) ? 'checked' : ''}/>${esc(n)}</label>`).join('') : `<span class="muted">${empty}</span>`}</div></details>`;
  function ruleRow(ev) {
    const r = V.rules[ev.key];
    return `<div class="nr ${r.on ? '' : 'is-off'}" data-ev="${esc(ev.key)}">
      <label class="tgl nr__on" title="${r.on ? '开着' : '关着'}"><input type="checkbox" data-nr="on" ${r.on ? 'checked' : ''}/><span class="tgl__ui"></span></label>
      <div class="nr__name"><b>${esc(ev.name)}</b>${LV[ev.level] || ''}${ev.desc ? `<span class="tipify">${esc(ev.desc)}</span>` : ''}</div>
      <div class="nr__to">
        ${TO.filter(([k]) => k !== 'approver' || ev.level === 'approval').map(([k, l, h]) => `<button type="button" class="nchip ${r.to[k] ? 'is-on' : ''}" data-nr-to="${k}" title="${esc(h)}">${l}</button>`).join('')}
        ${dd(ev, 'roles', '角色', V.roles.filter((x) => x.key !== 'admin').map((x) => [x.key, x.name]), r.to.roles, '还没有别的角色')}
        ${dd(ev, 'people', '指定的人', V.members.map((m) => [m.id, m.name]), r.to.people, '还没有同事登录过')}
        ${dd(ev, 'groups', '飞书群', V.groups.map((g) => [g.id, g.name]), r.to.groups, '还没加群,去「飞书群」里加')}
      </div>
      <div class="nr__when">${ev.level === 'info' && !ev.noDigest
        ? `<select class="sel sel--sm" data-nr="when"><option value="now">马上发</option><option value="digest" ${r.when === 'digest' ? 'selected' : ''}>每天 10:00 汇总</option></select>`
        : `<span class="muted">${ev.noDigest ? '每天 10:00' : '马上发'}</span>`}</div>
      <div class="nr__sum">${esc(whoText(ev, r))}</div>
    </div>`;
  }
  function rulesHtml() {
    const byMod = {};
    for (const ev of V.events) (byMod[ev.mod] ||= []).push(ev);
    return `${V.team ? '' : '<div class="note">现在没开多人协作(飞书登录),私信发不出去,只有飞书群收得到。</div>'}
      ${MOD_ORDER.filter((m) => byMod[m]).map((m) => `<section class="panel nrs"><div class="panel__h"><h3>${esc(V.mods[m])}</h3></div>
        <div class="nr nr--head"><span>开</span><span>通知</span><span>发给谁</span><span>什么时候</span></div>
        ${byMod[m].map(ruleRow).join('')}</section>`).join('')}`;
  }
  function groupsHtml() {
    const used = (id) => Object.values(V.rules).filter((r) => r.on && r.to.groups.includes(id)).length;
    return `<section class="panel"><div class="panel__h"><h3>飞书群</h3><span class="tipify">在飞书群里:设置 → 群机器人 → 添加机器人 → 自定义机器人,复制它的 webhook 地址。建议同时开「签名校验」,把密钥也填上。改价的通知里有价格,发群前确认群里只有该看的人。</span></div>
      ${V.groups.length ? V.groups.map((g) => `<div class="ngrp" data-g="${esc(g.id)}"><b>${esc(g.name)}</b><span class="muted mono">${esc(g.tail)}</span>${g.signed ? '<span class="tag">签名校验</span>' : ''}
        <span class="muted">用在 ${used(g.id)} 种通知</span><span class="ngrp__act"><button class="btn btn-sm" type="button" data-g-test>发测试消息</button><button class="btn btn-sm btn-ghost" type="button" data-g-del>删除</button></span></div>`).join('')
        : '<p class="muted">还没有群。加了群之后,在「通知规则」里给要发群的通知勾上它。</p>'}
      <div class="ngrp-add"><input class="inp" id="ng-name" placeholder="群名,比如:改价群" maxlength="30"/>
        <input class="inp" id="ng-hook" placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/…"/>
        <input class="inp" id="ng-secret" type="password" placeholder="签名校验密钥(没开就留空)"/>
        <button class="btn btn-sm btn-primary" type="button" id="ng-add">添加</button></div></section>`;
  }
  function logHtml() {
    const mods = [['', '全部'], ...MOD_ORDER.map((m) => [m, V.mods[m]])];
    return `<section class="panel"><div class="panel__h"><h3>发送记录</h3><span class="tipify">最近发出去的通知:发给了谁、发成功没有。「合进汇总」的会在每天 10:00 一起发。</span>
        <span class="seg seg--sm" style="margin-left:auto">${mods.map(([k, l]) => `<button type="button" data-lmod="${k}" class="${logMod === k ? 'is-active' : ''}">${esc(l)}</button>`).join('')}</span></div>
      ${logRows.length ? `<table class="mtable nlog"><thead><tr><th>时间</th><th>通知</th><th>发给</th><th>结果</th></tr></thead><tbody>
        ${logRows.map((r) => `<tr><td class="muted">${fDT(r.at)}</td><td>${esc(r.title)}${r.mode === 'digest' ? ' <span class="tag">合进汇总</span>' : ''}</td>
          <td>${esc((r.people || []).join('、'))}${(r.groups || []).length ? `${(r.people || []).length ? ' · ' : ''}群「${esc(r.groups.join('」「'))}」` : ''}</td>
          <td>${r.ok ? '<span class="nlog__ok">✓</span>' : `<span class="nlog__err">⚠ ${esc((r.errors || []).join(';'))}</span>`}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">还没有发送记录(通知中心上线之后发的才会记在这里)。</p>'}
      ${logMore ? '<button class="btn btn-sm" type="button" id="nl-more">再看早一点的</button>' : ''}</section>`;
  }
  function draw() {
    const root = $('#nt-root'); if (!root || !V) return;
    const open = $$('#nt-root details.ndd[open]').map((d) => `${d.closest('.nr')?.dataset.ev}:${d.dataset.dd}`);
    root.innerHTML = `<div class="phead"><div><h2>通知中心</h2><p class="muted">定哪些通知要发、发给谁、私信还是发群;每个人还能在「我的账号」里关掉自己不想收的日常通知</p></div></div>
      ${V.saved ? '' : '<div class="note note--sm">现在用的是默认规则(按原来的开关和群推出来的),改任何一条就保存成你的规则。</div>'}
      <div class="ptabs"><div class="seg">${[['rules', '通知规则'], ['groups', '飞书群', V.groups.length], ['log', '发送记录']].map(([k, l, n]) => `<button type="button" data-ntab="${k}" class="${tab === k ? 'is-active' : ''}">${l}${n != null ? ` <span class="seg__n">${n}</span>` : ''}</button>`).join('')}</div></div>
      ${tab === 'rules' ? rulesHtml() : tab === 'groups' ? groupsHtml() : logHtml()}`;
    for (const k of open) { const [ev, dd2] = k.split(':'); const d = $(`#nt-root .nr[data-ev="${ev}"] details[data-dd="${dd2}"]`); if (d) d.open = true; }
  }

  async function load() {
    const root = $('#nt-root'); if (!root) return;
    if (!V) root.innerHTML = '<p class="muted">读取中…</p>';
    try { V = await api('GET', '/api/notify'); } catch (e) { root.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    if (tab === 'log') await loadLog(); else draw();
  }
  async function loadLog(more) {
    try {
      const before = more && logRows.length ? logRows[logRows.length - 1].at : '';
      const r = await api('GET', `/api/notify/log?limit=100${before ? `&before=${before}` : ''}${logMod ? `&mod=${logMod}` : ''}`);
      logRows = more ? logRows.concat(r.rows) : r.rows; logMore = r.more;
    } catch (e) { toast(e.message, false); }
    draw();
  }
  async function saveRule(key, change) {
    if (busy) return; busy = true;
    const r = JSON.parse(JSON.stringify(V.rules[key])); change(r);
    try { V = await api('PUT', `/api/notify/rules/${encodeURIComponent(key)}`, r); }
    catch (e) { toast(e.message, false); }
    busy = false; draw();
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#nt-root')) return;
    const t = e.target.closest('[data-ntab]'); if (t) { tab = t.dataset.ntab; if (tab === 'log') loadLog(); else draw(); return; }
    const lm = e.target.closest('[data-lmod]'); if (lm) { logMod = lm.dataset.lmod; loadLog(); return; }
    if (e.target.closest('#nl-more')) { loadLog(true); return; }
    const to = e.target.closest('[data-nr-to]');
    if (to) { const k = to.dataset.nrTo; saveRule(to.closest('.nr').dataset.ev, (r) => { r.to[k] = !r.to[k]; }); return; }
    if (e.target.closest('#ng-add')) {
      const b = e.target.closest('#ng-add'); b.disabled = true;
      try { V = await api('POST', '/api/notify/groups', { name: $('#ng-name').value, webhook: $('#ng-hook').value, secret: $('#ng-secret').value }); toast('群已加好,可以点「发测试消息」试一下'); draw(); }
      catch (err) { toast(err.message, false); b.disabled = false; }
      return;
    }
    const g = e.target.closest('[data-g]');
    if (g && e.target.closest('[data-g-test]')) {
      const b = e.target.closest('[data-g-test]'); b.disabled = true;
      try { await api('POST', `/api/notify/groups/${encodeURIComponent(g.dataset.g)}/test`, {}); toast('测试消息已发到这个群'); } catch (err) { toast(err.message, false); }
      b.disabled = false; return;
    }
    if (g && e.target.closest('[data-g-del]')) {
      const b = e.target.closest('[data-g-del]');
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '再点一次删除'; return; }
      try { V = await api('DELETE', `/api/notify/groups/${encodeURIComponent(g.dataset.g)}`); toast('群已删掉,用到它的通知不再发这个群'); draw(); } catch (err) { toast(err.message, false); }
    }
  });
  document.addEventListener('change', (e) => {
    const row = e.target.closest('#nt-root .nr[data-ev]'); if (!row) return;
    const key = row.dataset.ev;
    if (e.target.dataset.nr === 'on') saveRule(key, (r) => { r.on = e.target.checked; });
    else if (e.target.dataset.nr === 'when') saveRule(key, (r) => { r.when = e.target.value; });
    else if (e.target.dataset.nrList) {
      const k = e.target.dataset.nrList; const v = e.target.value; const on = e.target.checked;
      saveRule(key, (r) => { r.to[k] = on ? [...new Set([...r.to[k], v])] : r.to[k].filter((x) => x !== v); });
    }
  });
  document.querySelector('#modnav [data-section="notify"]')?.addEventListener('click', () => load());
  window.cgpOpenNotify = () => { window.showSection('notify'); load(); };

  // ---------- 我的通知(设置 → 我的账号)----------
  let MY = null;
  function drawMine(el) {
    if (!MY) return;
    if (!MY.events.length) { el.innerHTML = '<div class="panel__h"><h3>我的通知</h3></div><p class="muted">按现在的规则,你不会收到通知。要收哪些找管理员在「通知中心」里设。</p>'; return; }
    const mods = { content: '网站内容', price: '改价', pins: 'Collection 排序', joint: '产品页推广' };
    const byMod = {}; for (const x of MY.events) (byMod[x.mod] ||= []).push(x);
    el.innerHTML = `<div class="panel__h"><h3>我的通知</h3><span class="tipify">按管理员在通知中心定的规则,你可能会收到下面这些(飞书私信)。日常通知可以自己关掉;出问题和审批的关不掉。</span></div>
      ${MY.team ? '' : '<p class="muted">现在没开多人协作,私信暂时发不出去。</p>'}
      ${Object.entries(byMod).map(([m, list]) => `<div class="mynt"><div class="mynt__h">${esc(mods[m] || m)}</div>
        ${list.map((x) => `<div class="mynt__r"><span><b>${esc(x.name)}</b>${x.desc ? `<span class="tipify">${esc(x.desc)}</span>` : ''}<em class="mynt__w">${x.reach === 'always' ? '会收到' : '和你有关时收到'}</em></span>
          ${x.level === 'info' ? `<label class="tgl"><input type="checkbox" data-mynt="${esc(x.key)}" ${x.muted ? '' : 'checked'}/><span class="tgl__ui"></span></label>` : '<span class="tag">必收</span>'}</div>`).join('')}</div>`).join('')}`;
    $$('[data-mynt]', el).forEach((c) => c.addEventListener('change', async () => {
      try { MY = await api('PUT', '/api/notify/me', { key: c.dataset.mynt, mute: !c.checked }); toast(c.checked ? '已打开' : '已关掉,以后不再收这类通知'); }
      catch (err) { toast(err.message, false); }
      drawMine(el);
    }));
  }
  window.cgpMyNotify = async (el) => {
    if (!el) return;
    el.innerHTML = '<div class="panel__h"><h3>我的通知</h3></div><p class="muted">读取中…</p>';
    try { MY = await api('GET', '/api/notify/me'); } catch (e) { el.innerHTML = `<div class="panel__h"><h3>我的通知</h3></div><p class="muted">${esc(e.message)}</p>`; return; }
    drawMine(el);
  };
})();
