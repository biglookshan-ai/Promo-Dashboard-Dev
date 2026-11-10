// 「部门」页(2026-11-10 部门负责人,方案 docs/departments/PLAN.md)。管理员和部门负责人才有这一页。
//   负责人:本部门员工 × 每页档位(不能看 / 只看 / 能编辑 / 能上线,不超过部门上限)+ 敏感功能;把待分配的新同事拉进来、移出。改了马上存。
//   管理员:所有部门,另外能改部门名字、每页上限、负责人、整个部门关掉的敏感功能,加 / 删部门。
// 规则在 src/members.js(服务器也拦);这里只画和改。用 app.js 的 api / toast / esc。
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const LV_SHORT = ['不能看', '只看', '能编辑', '能上线'];
  const LV_TIP = ['导航里没有这一页', '能看、能复制链接,不能改', '新建、修改、存草稿;保存要提交给负责人批准', '直接生效、暂停、删除、调顺序、批准别人的修改'];
  let D = null;     // GET /api/depts
  let ROLES = null; // 管理员:GET /api/members 的 roles(改部门设置时整套存)
  let MEMBERS = []; // 管理员:全部成员(选负责人)
  let open = new Set(); // 展开了「部门设置」/「部门通知」的部门
  let busy = false;
  let C = null; // /lib/notify-catalog.js(通知目录)

  const pagesOf = (d) => Object.keys(D.pages).filter((p) => !['settings', 'tools'].includes(p) && (d.ceiling?.[p] || 0) > 0);
  const allPages = () => Object.keys(D.pages).filter((p) => !['settings', 'tools'].includes(p));
  const lvSel = (attrs, val, max, disabled) => `<select class="sel sel--xs dp-lv dp-lv--${val}" ${attrs} ${disabled ? 'disabled' : ''}>${LV_SHORT.slice(0, max + 1).map((t, i) => `<option value="${i}" ${i === val ? 'selected' : ''} title="${LV_TIP[i]}">${t}</option>`).join('')}</select>`;

  function memberRows(d) {
    const pages = pagesOf(d); const caps = Object.entries(D.caps).filter(([k, c]) => (d.ceiling?.[c.page] || 0) >= 3 && !(d.capsOff || []).includes(k));
    if (!d.members.length) return '<p class="muted">这个部门还没有人。</p>';
    return `<div class="dp-scroll"><table class="mtable dp-t"><thead><tr><th>员工</th>${pages.map((p) => `<th>${esc(D.pages[p])}</th>`).join('')}${caps.length ? '<th>敏感功能</th>' : ''}<th></th></tr></thead><tbody>
      ${d.members.map((m) => {
        const fixed = m.lead || m.admin;
        return `<tr data-mid="${esc(m.id)}" data-dept="${esc(d.key)}">
          <td class="dp-who">${m.avatar ? `<img class="avatar-img" src="${esc(m.avatar)}" alt=""/>` : `<span class="avatar">${esc((m.name || '?').slice(0, 1).toUpperCase())}</span>`}<b>${esc(m.name)}</b>
            ${m.lead ? '<span class="tag tag--accent">负责人</span>' : ''}${m.admin ? '<span class="tag">管理员</span>' : ''}${m.status === 'pending' ? '<span class="tag tag--warn">待分配</span>' : ''}</td>
          ${pages.map((p) => `<td>${lvSel(`data-lv="${p}"`, fixed ? d.ceiling[p] : m.levels[p], d.ceiling[p], fixed)}</td>`).join('')}
          ${caps.length ? `<td class="dp-caps">${caps.map(([k, c]) => {
            const lvOk = (fixed ? d.ceiling[c.page] : m.levels[c.page]) >= 3;
            return `<label class="chk" title="${esc(c.name)}${lvOk ? '' : '(那一页要「能上线」才有)'}"><input type="checkbox" data-cap="${k}" ${!fixed && lvOk && !m.capsOff.includes(k) ? 'checked' : fixed && lvOk ? 'checked' : ''} ${fixed || !lvOk ? 'disabled' : ''}/>${esc(c.name.replace(/\s*[（(][^）)]*[）)]/g, ''))}</label>`;
          }).join('')}</td>` : ''}
          <td class="nowrap">${m.lead && !D.admin ? '' : m.id === window.CGP_ME?.member?.id ? '<span class="muted">(我)</span>' : `<button class="linkbtn" type="button" data-leave>移出</button>`}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function addHtml(d) {
    const cands = D.candidates.filter((c) => !c.depts.includes(d.key));
    if (!cands.length) return '';
    const pend = cands.filter((c) => c.status === 'pending'); const other = cands.filter((c) => c.status !== 'pending');
    const name = (k) => ROLES?.find((r) => r.key === k)?.name || D.depts.find((x) => x.key === k)?.name || k;
    return `<div class="rowin dp-add"><select class="sel sel--sm" data-add="${esc(d.key)}"><option value="">选一个同事拉进${esc(d.name)}…</option>
      ${pend.length ? `<optgroup label="待分配的新同事">${pend.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
      ${other.length ? `<optgroup label="别的部门的同事">${other.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}(${esc(c.depts.map(name).join('、') || '—')})</option>`).join('')}</optgroup>` : ''}</select>
      <button class="btn btn-sm" type="button" data-addgo="${esc(d.key)}">拉进来</button>${pend.length ? `<span class="tag tag--warn">${pend.length} 个新同事等分配</span>` : ''}</div>`;
  }
  // 部门通知:部门群 + 哪些通知本部门自己定(谁收 / 发不发部门群 / 什么时候);没自己定的 = 跟消息中心(管理员定的)
  const WHENS = [['now', '马上发'], ['merge:10', '10 分钟内的合成一条'], ['merge:30', '30 分钟内的合成一条'], ['digest:10:00', '每天 10:00 汇总'], ['digest:18:00', '每天 18:00 汇总'], ['work', '只在工作时间(09:00–18:00)']];
  const whenKey = (w) => (w.mode === 'merge' ? `merge:${w.merge}` : w.mode === 'digest' ? `digest:${w.at}` : w.mode);
  const whenOf = (k) => { const [m, a, b] = k.split(':'); return m === 'merge' ? { mode: 'merge', merge: Number(a) } : m === 'digest' ? { mode: 'digest', at: `${a}:${b}` } : { mode: m }; };
  function notifyHtml(d) {
    if (!C) return '';
    const evs = C.EVENTS.filter((e) => e.page && (d.ceiling?.[e.page] || 0) >= 1 && !e.approvals);
    const g = d.notify?.group; const rules = d.notify?.rules || {};
    const own = Object.keys(rules).filter((k) => evs.some((e) => e.key === k)).length;
    const byCat = new Map(); for (const e of evs) { if (!byCat.has(e.cat)) byCat.set(e.cat, []); byCat.get(e.cat).push(e); }
    return `<details class="dp-set dp-nt" data-nt="${esc(d.key)}" ${open.has(`n:${d.key}`) ? 'open' : ''}><summary>部门通知 <span class="muted">${g ? `部门群「${esc(g.name)}」· ` : ''}${own ? `${own} 种通知本部门自己定` : '全部跟消息中心'}</span></summary>
      <div class="dp-set__b">
        <div class="rowin dp-top"><span class="dp-lab">部门群</span>${g ? `<span><b>${esc(g.name)}</b> <span class="muted mono">${esc(g.tail)}</span>${g.signed ? ' <span class="tag">签名校验</span>' : ''}</span>
          <button class="btn btn-sm" type="button" data-ntest="${esc(d.key)}">发测试消息</button><button class="btn btn-sm btn-ghost" type="button" data-nogroup="${esc(d.key)}">去掉</button>`
          : `<span class="dp-grp"><input class="inp inp--sm" data-gname placeholder="群名,比如:定价群" maxlength="30"/><input class="inp inp--sm" data-ghook placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/…"/><input class="inp inp--sm" data-gsecret type="password" placeholder="签名校验密钥(没开就留空)"/>
            <button class="btn btn-sm btn-primary" type="button" data-gsave="${esc(d.key)}">保存部门群</button></span>`}</div>
        <p class="muted" style="margin:0">选「本部门自己定」的通知:本部门的人按这里收(管理员和公司群照旧按消息中心);卡片样式和内容由管理员在消息中心统一。</p>
        ${[...byCat].map(([c, list]) => `<div class="dp-ntc"><b>${C.CAT[c]?.icon || ''} ${esc(C.CAT[c]?.name || c)}</b>${list.map((e) => {
          const r = rules[e.key];
          return `<div class="dp-ntr" data-ev="${esc(e.key)}"><span class="dp-ntr__n">${esc(e.name)}${e.level === 'problem' ? ' <span class="tag tag--warn">出问题</span>' : ''}</span>
            <select class="sel sel--xs" data-own>${[['', '跟消息中心'], ['own', '本部门自己定']].map(([v, t]) => `<option value="${v}" ${(r ? 'own' : '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
            ${r ? `<select class="sel sel--xs" data-to><option value="related" ${r.on && r.to === 'related' ? 'selected' : ''}>相关的人</option><option value="all" ${r.on && r.to === 'all' ? 'selected' : ''}>部门全部人</option><option value="leads" ${r.on && r.to === 'leads' ? 'selected' : ''}>只有负责人</option><option value="off" ${r.on ? '' : 'selected'}>本部门的人不收</option></select>
              <label class="chk"><input type="checkbox" data-grp ${r.group ? 'checked' : ''} ${g ? '' : 'disabled'}/>发部门群</label>
              <label class="chk" title="比如小王改了 Banner,小王自己不用再收到"><input type="checkbox" data-na ${r.notActor ? 'checked' : ''}/>不发给动手的人</label>
              <select class="sel sel--xs" data-when>${WHENS.filter(([k]) => !k.startsWith('digest') || e.level === 'info').map(([k, t]) => `<option value="${k}" ${whenKey(r.when) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
          </div>`;
        }).join('')}</div>`).join('')}
      </div></details>`;
  }
  const collectRules = (box) => Object.fromEntries($$('.dp-ntr', box).filter((row) => $('[data-own]', row).value === 'own').map((row) => {
    const to = $('[data-to]', row)?.value || 'related';
    return [row.dataset.ev, { on: to !== 'off', to: to === 'off' ? 'related' : to, group: !!$('[data-grp]', row)?.checked, notActor: $('[data-na]', row) ? $('[data-na]', row).checked : true, when: whenOf($('[data-when]', row)?.value || 'now') }];
  }));
  async function saveNotify(key, body, msg) {
    D = { ...D, ...(await api('PUT', `/api/depts/${encodeURIComponent(key)}/notify`, body)) }; toast(msg); draw();
  }
  // 管理员:部门设置(名字、负责人、每页上限、整个部门关掉的敏感功能、删部门)
  function adminHtml(d) {
    const r = ROLES.find((x) => x.key === d.key); if (!r) return '';
    const active = MEMBERS.filter((m) => m.status !== 'disabled' && !(m.roles || []).includes('admin'));
    return `<details class="dp-set" data-set="${esc(d.key)}" ${open.has(d.key) ? 'open' : ''}><summary>部门设置(只有管理员能改)</summary>
      <div class="dp-set__b">
        <div class="rowin"><span class="dp-lab">名字</span><input class="inp inp--sm" data-dname value="${esc(r.name)}" maxlength="20"/></div>
        <div class="rowin dp-top"><span class="dp-lab">负责人</span><span class="dp-picks">${active.length ? active.map((m) => `<label class="chk"><input type="checkbox" data-dlead value="${esc(m.id)}" ${(r.leads || []).includes(m.id) ? 'checked' : ''}/>${esc(m.name)}</label>`).join('') : '<span class="muted">还没有同事登录过</span>'}</span></div>
        <div class="rowin dp-top"><span class="dp-lab">敏感功能</span><span class="dp-picks">${Object.entries(D.caps).map(([k, c]) => `<label class="chk" title="那一页「能上线」的人才有"><input type="checkbox" data-dcap="${k}" ${(r.capsOff || []).includes(k) ? '' : 'checked'}/>${esc(c.name)}</label>`).join('')}</span></div>
        <div class="rowin"><span class="dp-lab"></span><button class="btn btn-sm btn-primary" type="button" data-dsave="${esc(d.key)}">保存部门设置</button>
          ${r.builtin ? '' : `<button class="btn btn-sm btn-ghost btn-danger-t" type="button" data-ddel="${esc(d.key)}">删除这个部门</button>`}</div>
      </div></details>`;
  }
  // 管理员:每个部门能看哪些页面(2026-11-10 用户:「我如何设置每个部门能看什么页面」—— 放在部门页最上面,一行一个部门、一列一个页面,改了马上存)
  function matrixHtml() {
    const depts = ROLES.filter((r) => r.key !== 'admin');
    if (!depts.length) return '';
    const pages = allPages();
    return `<section class="panel dp-mx"><div class="panel__h"><h3>每个部门能看哪些页面</h3><span class="muted">选「不能看」= 导航里没有这一页;这里是部门的上限,负责人只能在这个范围内给员工。管理员能看全部。改了马上保存</span></div>
      <div class="dp-scroll"><table class="mtable dp-t"><thead><tr><th>部门</th>${pages.map((p) => `<th>${esc(D.pages[p])}</th>`).join('')}</tr></thead><tbody>
        ${depts.map((r) => `<tr data-mx="${esc(r.key)}"><td class="dp-who"><b>${esc(r.name)}</b></td>${pages.map((p) => `<td>${lvSel(`data-mxp="${p}"`, r.ceiling?.[p] || 0, 3, false)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></section>`;
  }
  function draw() {
    const root = $('#dp-root'); if (!root || !D) return;
    window.cgpNav?.sync();
    const y = window.scrollY;
    root.innerHTML = `<div class="phead"><div><h2>部门</h2><p class="muted">${D.admin ? '管理员定每个部门的上限和负责人;' : ''}负责人给本部门每个员工定每一页能做到哪一档(不超过部门上限),改了马上生效。「能编辑」的员工保存后要你批准才上线。</p></div></div>
      <div class="dp-legend">${LV_SHORT.map((t, i) => `<span><b class="dp-lv dp-lv--${i}">${t}</b>${LV_TIP[i]}</span>`).join('')}</div>
      ${D.admin && ROLES ? matrixHtml() : ''}
      ${D.depts.map((d) => `<section class="panel dp-dept" data-dk="${esc(d.key)}"><div class="panel__h"><h3>${esc(d.name)}</h3>
          <span class="muted">${d.members.length} 人 · 负责人:${d.leads.length ? esc(d.leads.map((id) => d.members.find((m) => m.id === id)?.name || MEMBERS.find((m) => m.id === id)?.name || id).join('、')) : '还没有'}</span></div>
        ${D.admin ? adminHtml(d) : ''}
        ${memberRows(d)}
        ${addHtml(d)}
        ${notifyHtml(d)}</section>`).join('') || '<p class="muted">你还不是任何部门的负责人。</p>'}
      ${D.admin ? '<section class="panel"><div class="rowin"><input class="inp" id="dp-newname" placeholder="新部门名称,比如:摄影" maxlength="20"/><button class="btn btn-sm" type="button" id="dp-new">加部门</button></div></section>' : ''}`;
    window.scrollTo(0, y);
  }
  async function load() {
    const root = $('#dp-root'); if (!root) return;
    if (!D) root.innerHTML = '<p class="muted">读取中…</p>';
    try {
      C ||= await import('/lib/notify-catalog.js');
      D = await api('GET', '/api/depts');
      if (D.admin) { const m = await api('GET', '/api/members'); ROLES = m.roles; MEMBERS = m.members; }
    } catch (e) { root.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    draw();
  }
  const rowGrant = (tr) => ({
    levels: Object.fromEntries($$('[data-lv]', tr).map((s) => [s.dataset.lv, Number(s.value)])),
    capsOff: $$('[data-cap]', tr).filter((c) => !c.disabled && !c.checked).map((c) => c.dataset.cap),
  });
  async function saveRoles(next, msg) {
    const r = await api('PUT', '/api/roles', { roles: next });
    ROLES = r.roles; toast(msg); await load();
  }
  const collectDept = (key) => {
    const box = $(`[data-set="${CSS.escape(key)}"]`); const r = ROLES.find((x) => x.key === key);
    return { ...r, name: $('[data-dname]', box).value.trim() || r.name,
      ceiling: r.ceiling, // 每页能看到哪一档在页面最上面的总表里改
      capsOff: $$('[data-dcap]', box).filter((c) => !c.checked).map((c) => c.dataset.dcap),
      leads: $$('[data-dlead]:checked', box).map((c) => c.value) };
  };

  document.addEventListener('change', async (e) => {
    if (!e.target.closest('#dp-root')) return;
    const mx = e.target.closest('tr[data-mx]');
    if (mx && e.target.matches('[data-mxp]')) {
      if (busy) return; busy = true;
      const key = mx.dataset.mx; const page = e.target.dataset.mxp; const n = Number(e.target.value);
      try { await saveRoles(ROLES.map((r) => (r.key === key ? { ...r, ceiling: { ...r.ceiling, [page]: n } } : r)), `已保存:${ROLES.find((r) => r.key === key)?.name}在「${D.pages[page]}」是「${LV_SHORT[n]}」;同事刷新页面后生效`); }
      catch (err) { toast(err.message, false); draw(); }
      busy = false; return;
    }
    const nbox = e.target.closest('details[data-nt]');
    if (nbox && e.target.closest('.dp-ntr')) {
      if (busy) return; busy = true;
      try { await saveNotify(nbox.dataset.nt, { rules: collectRules(nbox) }, '部门通知已保存'); } catch (err) { toast(err.message, false); draw(); }
      busy = false; return;
    }
    const tr = e.target.closest('tr[data-mid]');
    if (tr && (e.target.matches('[data-lv]') || e.target.matches('[data-cap]'))) {
      if (busy) return; busy = true;
      try { D = { ...D, ...(await api('PUT', `/api/depts/${encodeURIComponent(tr.dataset.dept)}/grants/${encodeURIComponent(tr.dataset.mid)}`, rowGrant(tr))) }; toast('已保存,他刷新页面后生效'); }
      catch (err) { toast(err.message, false); }
      busy = false; draw();
    }
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('#dp-root details[data-set], #dp-root details[data-nt]'); if (!d) return;
    const k = d.dataset.nt ? `n:${d.dataset.nt}` : d.dataset.set;
    if (d.open) open.add(k); else open.delete(k);
  }, true);
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#dp-root')) return;
    const add = e.target.closest('[data-addgo]');
    if (add) {
      const key = add.dataset.addgo; const id = $(`[data-add="${CSS.escape(key)}"]`)?.value;
      if (!id) return toast('先选一个同事', false);
      add.disabled = true;
      try { D = { ...D, ...(await api('POST', `/api/depts/${encodeURIComponent(key)}/members`, { id })) }; toast('已拉进来,默认是部门上限,可以在表里改'); await load(); }
      catch (err) { toast(err.message, false); add.disabled = false; }
      return;
    }
    const lv = e.target.closest('[data-leave]');
    if (lv) {
      const tr = lv.closest('tr');
      if (!lv.dataset.sure) { lv.dataset.sure = '1'; lv.textContent = '再点一次移出'; return; }
      try { D = { ...D, ...(await api('DELETE', `/api/depts/${encodeURIComponent(tr.dataset.dept)}/members/${encodeURIComponent(tr.dataset.mid)}`)) }; toast('已移出这个部门'); await load(); }
      catch (err) { toast(err.message, false); }
      return;
    }
    const gs = e.target.closest('[data-gsave]');
    if (gs) {
      const box = gs.closest('details'); gs.disabled = true;
      try { await saveNotify(gs.dataset.gsave, { group: { name: $('[data-gname]', box).value, webhook: $('[data-ghook]', box).value, secret: $('[data-gsecret]', box).value } }, '部门群已保存,可以点「发测试消息」试一下'); }
      catch (err) { toast(err.message, false); gs.disabled = false; }
      return;
    }
    const ng = e.target.closest('[data-nogroup]');
    if (ng) {
      if (!ng.dataset.sure) { ng.dataset.sure = '1'; ng.textContent = '再点一次去掉'; return; }
      try { await saveNotify(ng.dataset.nogroup, { group: null }, '部门群已去掉'); } catch (err) { toast(err.message, false); }
      return;
    }
    const nt = e.target.closest('[data-ntest]');
    if (nt) {
      nt.disabled = true;
      try { await api('POST', `/api/depts/${encodeURIComponent(nt.dataset.ntest)}/notify/test`, {}); toast('测试消息已发到部门群'); } catch (err) { toast(err.message, false); }
      nt.disabled = false; return;
    }
    const sv = e.target.closest('[data-dsave]');
    if (sv) {
      const key = sv.dataset.dsave; sv.disabled = true;
      try { await saveRoles(ROLES.map((r) => (r.key === key ? collectDept(key) : r)), '部门设置已保存;成员刷新页面后生效'); }
      catch (err) { toast(err.message, false); sv.disabled = false; }
      return;
    }
    const del = e.target.closest('[data-ddel]');
    if (del) {
      if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = '再点一次删除(部门里的人会失去这个部门的权限)'; return; }
      try { await saveRoles(ROLES.filter((r) => r.key !== del.dataset.ddel), '部门已删除'); } catch (err) { toast(err.message, false); }
      return;
    }
    if (e.target.closest('#dp-new')) {
      const name = $('#dp-newname').value.trim(); if (!name) return toast('先填部门名称', false);
      try { await saveRoles([...ROLES, { key: 'd' + Date.now().toString(36), name, ceiling: { overview: 3, campaigns: 3, history: 3 } }], `已加部门「${name}」,展开「部门设置」定上限和负责人`); }
      catch (err) { toast(err.message, false); }
    }
  });
  // 导航点开 / 设置页「打开部门页」/ 网址 /dept 打开时读
  const show0 = window.showSection;
  window.showSection = (name) => { show0(name); if (name === 'dept') load(); };
})();
