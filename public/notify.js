// 消息中心页面(v1 2026-11-09 上午;v2 同一天下午 —— 用户:每一类通知都要能自定义样式、内容、推给谁、怎么推、什么时候推)。
// 左边分类(改价 / Banner / 顶栏 / …),右边这一类的通知;点一种通知 → 编辑:① 样式 ② 内容 ③ 推给谁 ④ 怎么推 ⑤ 什么时候推,右边实时预览 + 发给我试试。
// 卡片怎么拼和服务器发飞书共用 /lib/notify-catalog.js(预览的样子 = 发出去的样子)。「我的通知」画在「设置 → 我的账号」里(window.cgpMyNotify)。
// 用 app.js 的 api / toast / esc。
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fDT = (ms) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Europe/London', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let C = null; // /lib/notify-catalog.js
  const catalog = async () => (C ||= await import('/lib/notify-catalog.js'));
  const LV = { problem: '<span class="tag tag--warn">出问题</span>', approval: '<span class="tag">审批</span>' };
  const TO = [
    ['related', '相关的人', '建 / 改这条内容或这个计划的人(负责人、抄送也算)'],
    ['dept', '同部门', '和相关的人同一个角色、能看这类页面的同事'],
    ['admins', '管理员', '所有管理员'],
    ['page', '能看这页的人', '所有能打开这类页面的同事'],
    ['approver', '审批人', '这条内容 / 计划的审批人'],
  ];
  const WHEN = [
    ['now', '马上发', '发生了就发;同一时间同一种的几条合成一张卡片'],
    ['merge', '几分钟内的合成一条', '第一条来了先等一会儿,这段时间里同一种的合成一张卡片再发(适合频繁的通知)'],
    ['digest', '合进每天汇总', '攒着,每天到点发一张汇总(只有日常通知能选)'],
    ['work', '只在工作时间发', '工作时间内马上发;下班后的攒到第二天上班一起发'],
  ];
  const SHORT = 26; // 和 src/lark.js 一样:短的两个一行
  const HEAD = { blue: '#3370ff', wathet: '#2f9ef5', green: '#2ea121', yellow: '#d99904', orange: '#f07800', red: '#e5413d', purple: '#7f3bf5', grey: '#8f959e' };
  let V = null; let tab = 'rules'; let cat = 'price'; let logRows = []; let logMore = false; let logCat = ''; let busy = false;
  let E = null; // 正在编辑:{ key, rule, dirty, copy?: { parts, targets } }

  const nameOf = (id) => V.members.find((m) => m.id === id)?.name || id;
  const evs = () => V.events.map((k) => C.EV[k]).filter(Boolean);
  const evsOf = (c) => evs().filter((e) => e.cat === c);
  const styleOf = (key, r) => r.style || C.defaultStyle(C.EV[key]);

  // 一句话:这种通知现在怎么发
  function sumText(ev, r) {
    if (!r.on) return '关着,不发';
    const p = [];
    if (r.to.related) p.push('相关的人');
    if (r.to.approver && ev.level === 'approval') p.push('审批人');
    if (r.to.dept) p.push('同部门');
    if (r.to.admins) p.push('管理员');
    if (r.to.page) p.push('能看这页的人');
    const roles = r.to.roles.map((k) => V.roles.find((x) => x.key === k)?.name).filter(Boolean);
    if (roles.length) p.push(`角色「${roles.join('」「')}」`);
    if (r.to.people.length) p.push(r.to.people.map(nameOf).join('、'));
    const groups = r.via.groups.map((id) => V.groups.find((g) => g.id === id)?.name).filter(Boolean);
    const how = [r.via.dm && p.length ? `私信 ${p.join(' + ')}${r.to.notActor ? '(不含动手的人)' : ''}` : '', groups.length ? `群「${groups.join('」「')}」${r.via.at ? ' @相关的人' : ''}` : ''].filter(Boolean).join(' · ');
    const w = r.when;
    const when = { now: '马上', merge: `${w.merge} 分钟内合成一条`, digest: `每天 ${w.at} 汇总`, work: `工作时间(${w.from}–${w.to})` }[w.mode];
    return how ? `${how} · ${when}` : ev.level === 'info' ? '⚠️ 谁都没选,不会发' : '谁都没选:会私信管理员(出问题的不能没人知道)';
  }

  // ---------- 卡片预览(和飞书卡片同样的排法)----------
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[(.+?)\]\((.+?)\)/g, '<u>$1</u>');
  function cardHtml(c) {
    let body = ''; let shorts = [];
    const flush = () => { if (shorts.length) body += `<div class="mcc__grid">${shorts.map((r) => `<div><b>${esc(r.label)}</b><span>${md(r.value)}</span></div>`).join('')}</div>`; shorts = []; };
    for (const r of c.rows || []) {
      if (r.list) { flush(); body += `<div class="mcc__blk">${r.label ? `<b>${esc(r.label)}</b>` : ''}${r.list.map((x) => `<div>· ${md(x)}</div>`).join('')}</div>`; }
      else if (String(r.value).length <= SHORT) shorts.push(r);
      else { flush(); body += `<div class="mcc__blk"><b>${esc(r.label)}</b>:${md(r.value)}</div>`; }
    }
    flush();
    if (c.line) body += `<div class="mcc__blk">${md(c.line)}</div>`;
    if (c.at?.length) body += '<div class="mcc__blk mcc__at">@相关的人</div>';
    return `<div class="mcc"><div class="mcc__h" style="background:${HEAD[c.color] || HEAD.blue}">${esc(c.title)}</div>
      <div class="mcc__b">${body || '<span class="muted">(没有勾选要显示的信息)</span>'}
      ${(c.buttons || []).length ? `<div class="mcc__btns">${c.buttons.map((b, i) => `<span class="mcc__btn ${i ? '' : 'is-pri'}">${esc(b.text)}</span>`).join('')}</div>` : ''}</div></div>`;
  }
  function previewCard() {
    const ev = C.EV[E.key];
    const card = C.renderCard(ev, E.rule.style, ev.sample || {}, { url: (p) => p, path: C.CAT[ev.cat]?.path || '/' });
    if (E.rule.via.at && E.rule.via.groups.length) card.at = ['x'];
    return cardHtml(card);
  }

  // ---------- 列表 ----------
  function catsHtml() {
    return `<nav class="mc-cats">${V.cats.map((k) => { const c = C.CAT[k]; const list = evsOf(k); if (!list.length) return '';
      const on = list.filter((e) => V.rules[e.key]?.on).length;
      return `<button type="button" class="mc-cat ${cat === k ? 'is-on' : ''}" data-mccat="${k}"><span>${c.icon}</span><b>${esc(c.name)}</b><em>${on}/${list.length}</em></button>`; }).join('')}</nav>`;
  }
  function rowHtml(ev) {
    const r = V.rules[ev.key]; const s = styleOf(ev.key, r);
    return `<div class="mc-row ${r.on ? '' : 'is-off'}" data-ev="${esc(ev.key)}">
      <label class="tgl" title="${r.on ? '开着' : '关着'}"><input type="checkbox" data-mcon ${r.on ? 'checked' : ''}/><span class="tgl__ui"></span></label>
      <button type="button" class="mc-row__main" data-mcedit="${esc(ev.key)}">
        <span class="mc-row__t"><i class="mc-dot" style="background:${HEAD[s.color] || HEAD.blue}"></i><b>${esc(ev.name)}</b>${LV[ev.level] || ''}${r.style ? '<span class="tag tag--accent">改过样式</span>' : ''}</span>
        <span class="mc-row__d">${esc(ev.desc || '')}</span>
        <span class="mc-row__s">${esc(sumText(ev, r))}</span>
      </button>
      <button type="button" class="btn btn-sm" data-mcedit="${esc(ev.key)}">设置</button>
    </div>`;
  }
  function rulesHtml() {
    const c = C.CAT[cat];
    return `${V.team ? '' : '<div class="note note--sm">现在没开多人协作(飞书登录),私信发不出去,只有飞书群收得到。</div>'}
      <div class="mc-wrap">${catsHtml()}
        <section class="panel mc-list"><div class="panel__h"><h3>${c.icon} ${esc(c.name)}</h3><span class="muted">点一种通知设置它的样式、内容、推给谁、怎么推、什么时候推</span></div>
          ${evsOf(cat).map(rowHtml).join('')}</section></div>`;
  }

  // ---------- 编辑 ----------
  const sec = (n, title, tip, body) => `<section class="mc-sec"><div class="mc-sec__h"><span class="mc-sec__n">${n}</span><b>${title}</b>${tip ? `<span class="tipify">${esc(tip)}</span>` : ''}</div>${body}</section>`;
  const chk = (attrs, on, label, title = '') => `<label class="chk" ${title ? `title="${esc(title)}"` : ''}><input type="checkbox" ${attrs} ${on ? 'checked' : ''}/>${label}</label>`;
  function fieldsHtml(ev, s) {
    const on = s.fields.filter((k) => ev.avail.includes(k)); const off = ev.avail.filter((k) => !on.includes(k));
    const row = (k, sel, i) => `<div class="mc-fld ${sel ? 'is-on' : ''}" data-f="${k}">
      ${sel ? '<span class="mc-fld__grip" title="按住拖动排顺序">⋮⋮</span>' : '<span class="mc-fld__grip mc-fld__grip--x"></span>'}
      ${chk(`data-mcf="${k}"`, sel, esc(C.FIELDS[k]?.label || k))}${C.FIELDS[k]?.list ? '<span class="muted">一串</span>' : ''}
      ${sel ? `<span class="mc-fld__mv"><button type="button" class="btn btn-sm btn-ghost" data-mcmv="${k}:-1" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn btn-sm btn-ghost" data-mcmv="${k}:1" ${i < on.length - 1 ? '' : 'disabled'}>↓</button></span>` : ''}</div>`;
    return `<div class="mc-flds" id="mc-flds">${on.map((k, i) => row(k, true, i)).join('')}${off.length ? `<div class="mc-flds__off">不显示的:</div>${off.map((k) => row(k, false, 0)).join('')}` : ''}</div>`;
  }
  function editorHtml() {
    const ev = C.EV[E.key]; const r = E.rule; const s = r.style; const c = C.CAT[ev.cat];
    const hasList = ev.avail.some((k) => C.FIELDS[k]?.list);
    const roles = V.roles.filter((x) => x.key !== 'admin');
    const style = sec(1, '样式', '卡片顶上的标题和颜色;「简洁」= 标题下面只有一行字', `
      <div class="mc-line"><span class="mc-lab">标题</span><input class="inp" data-mcs="title" value="${esc(s.title)}" maxlength="60"/></div>
      <div class="mc-line"><span class="mc-lab"></span>${chk('data-mcs="titleName"', s.titleName, '标题后面带上名称(比如「改价开始了 · 黑五 85 折」)')}</div>
      <div class="mc-line"><span class="mc-lab">颜色</span><span class="mc-colors">${C.COLORS.map(([k, n]) => `<button type="button" class="mc-color ${s.color === k ? 'is-on' : ''}" data-mccolor="${k}" title="${n}" style="background:${HEAD[k]}"></button>`).join('')}</span></div>
      <div class="mc-line"><span class="mc-lab">版式</span><span class="seg seg--sm">${[['full', '详细'], ['brief', '简洁(一行)']].map(([k, l]) => `<button type="button" data-mclayout="${k}" class="${s.layout === k ? 'is-active' : ''}">${l}</button>`).join('')}</span></div>`);
    const content = sec(2, '内容', '勾选卡片上要显示哪些信息,按住 ⋮⋮ 拖动(或点 ↑↓)排顺序;按钮的文字也能改', `
      ${fieldsHtml(ev, s)}
      ${hasList ? `<div class="mc-line"><span class="mc-lab">清单</span>最多显示 <input class="inp inp--xs" type="number" min="1" max="30" data-mcs="max" value="${s.max}"/> 条,多的写「……共 N 个」</div>` : ''}
      <div class="mc-line mc-line--top"><span class="mc-lab">按钮</span><span class="mc-btns">${ev.buttons.map((b) => `<span class="mc-btn">${chk(`data-mcb="${b}"`, s.buttons[b]?.on, '')}<input class="inp inp--sm" data-mcbt="${b}" value="${esc(s.buttons[b]?.text || '')}" maxlength="20"/><em class="muted">${b === 'open' ? '打开这一条' : b === 'list' ? `打开${esc(c.name)}列表` : b === 'vault' ? '改价 → 受管产品' : b === 'reviews' ? '审核页' : '网站更新中心首页'}</em></span>`).join('')}</span></div>`);
    const who = sec(3, '推给哪些人', '「相关的人」「同部门」要看具体哪一条:比如改价失败时,相关的人 = 这个计划的负责人、建的人、最后改的人', `
      <div class="mc-chips">${TO.filter(([k]) => k !== 'approver' || ev.level === 'approval').map(([k, l, h]) => `<button type="button" class="nchip ${r.to[k] ? 'is-on' : ''}" data-mcto="${k}" title="${esc(h)}">${l}</button>`).join('')}</div>
      ${roles.length ? `<div class="mc-line mc-line--top"><span class="mc-lab">角色</span><span class="mc-picks">${roles.map((x) => chk(`data-mclist="roles" value="${esc(x.key)}"`, r.to.roles.includes(x.key), esc(x.name))).join('')}</span></div>` : ''}
      <div class="mc-line mc-line--top"><span class="mc-lab">指定的人</span><span class="mc-picks">${V.members.length ? V.members.map((m) => chk(`data-mclist="people" value="${esc(m.id)}"`, r.to.people.includes(m.id), esc(m.name))).join('') : '<span class="muted">还没有同事用飞书登录过</span>'}</span></div>
      <div class="mc-line"><span class="mc-lab"></span>${chk('data-mcto2="notActor"', r.to.notActor, '不发给做这件事的人自己', '比如小王改了 Banner,小王自己不用再收到「Banner 已修改」')}</div>`);
    const how = sec(4, '怎么推送', '私信 = 用「CGP 网站更新中心」飞书应用私信上面选的人;群 = 群机器人发到群里', `
      <div class="mc-line">${chk('data-mcvia="dm"', r.via.dm, '<b>飞书私信</b> 给上面选的人')}</div>
      <div class="mc-line mc-line--top"><span class="mc-lab">飞书群</span><span class="mc-picks">${V.groups.length ? V.groups.map((g) => chk(`data-mcgrp value="${esc(g.id)}"`, r.via.groups.includes(g.id), esc(g.name))).join('') : '<span class="muted">还没加群</span>'}
        <button type="button" class="linkbtn" data-ntab="groups">管理飞书群</button></span></div>
      <div class="mc-line"><span class="mc-lab"></span>${chk(`data-mcvia="at" ${r.via.groups.length ? '' : 'disabled'}`, r.via.at, '发到群里时 @ 相关的人')}</div>`);
    const w = r.when;
    const when = sec(5, '什么时候推送', `时间按${V.tzs[V.tz]}算(右上角可以换)`, `<div class="mc-whens">${WHEN.filter(([k]) => k !== 'digest' || ev.level === 'info').map(([k, l, h]) => `<label class="mc-when ${w.mode === k ? 'is-on' : ''}">
        <input type="radio" name="mcwhen" value="${k}" ${w.mode === k ? 'checked' : ''}/><span><b>${l}</b>
        ${k === 'merge' ? ` <input class="inp inp--xs" type="number" min="1" max="240" data-mcw="merge" value="${w.merge}"/> 分钟` : ''}
        ${k === 'digest' ? ` 每天 <input class="inp inp--xs" type="time" data-mcw="at" value="${w.at}"/>` : ''}
        ${k === 'work' ? ` <input class="inp inp--xs" type="time" data-mcw="from" value="${w.from}"/> – <input class="inp inp--xs" type="time" data-mcw="to" value="${w.to}"/>` : ''}
        <em class="muted">${h}</em></span></label>`).join('')}</div>`);
    const copy = E.copy ? copyHtml(ev) : '';
    return `<div class="mc-ed">
      <div class="mc-ed__top"><button type="button" class="btn btn-ghost" data-mcback>← ${esc(c.name)}的通知</button>
        <b>${c.icon} ${esc(ev.name)}</b>${LV[ev.level] || ''}<span class="muted">${esc(ev.desc || '')}</span>
        <label class="tgl" style="margin-left:auto" title="这种通知开着 / 关着"><input type="checkbox" data-mcedon ${r.on ? 'checked' : ''}/><span class="tgl__ui"></span></label><span class="muted">${r.on ? '开着' : '关着'}</span></div>
      <div class="mc-ed__grid"><div class="mc-ed__form">${style}${content}${who}${how}${when}</div>
        <aside class="mc-ed__pv"><div class="mc-pv__h">预览 <span class="muted">(示例数据,飞书里就是这样)</span></div><div id="mc-pv">${previewCard()}</div>
          <div class="mc-pv__sum">${esc(sumText(ev, r))}</div>
          <div class="mc-pv__test"><select class="sel sel--sm" id="mc-testto"><option value="">私信给我</option>${V.groups.map((g) => `<option value="${esc(g.id)}">发到群「${esc(g.name)}」</option>`).join('')}</select>
            <button type="button" class="btn btn-sm" data-mctest>发给我试试</button></div></aside></div>
      ${copy}
      <div class="mc-ed__foot"><button type="button" class="btn btn-ghost" data-mcreset>恢复默认</button><button type="button" class="btn btn-ghost" data-mccopy>套用到其他通知…</button>
        <span class="muted" style="margin-left:auto">${E.dirty ? '有没保存的修改' : ''}</span>
        <button type="button" class="btn" data-mcback>${E.dirty ? '放弃' : '返回'}</button><button type="button" class="btn btn-primary" data-mcsave ${E.dirty ? '' : 'disabled'}>保存</button></div></div>`;
  }
  // 套用到其他通知:选套哪几块 + 套到哪些
  const PARTS = [['to', '推给哪些人'], ['via', '怎么推送'], ['when', '什么时候推送'], ['style', '样式(颜色、版式、按钮、显示的信息;标题不套)'], ['on', '开 / 关']];
  function copyHtml(ev) {
    const suf = ev.key.split('.')[1];
    const same = evs().filter((x) => x.key !== ev.key && x.key.split('.')[1] === suf && C.CAT_OF_KIND[x.cat]);
    const all = V.cats.map((k) => [k, evsOf(k).filter((x) => x.key !== ev.key)]).filter(([, l]) => l.length);
    return `<section class="panel mc-copy"><div class="panel__h"><h3>套用到其他通知</h3><span class="muted">用的是这里现在的设置(还没保存的修改也算)</span></div>
      <div class="mc-line mc-line--top"><span class="mc-lab">套用</span><span class="mc-picks">${PARTS.map(([k, l]) => chk(`data-mccp="${k}"`, E.copy.parts.includes(k), l)).join('')}</span></div>
      <div class="mc-line"><span class="mc-lab">快速选</span><button type="button" class="btn btn-sm" data-mcsel="cat">同一类的全部</button>${same.length ? `<button type="button" class="btn btn-sm" data-mcsel="same">每种内容的「${esc(ev.name)}」(${same.length})</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-mcsel="none">清空</button></div>
      <div class="mc-copy__list">${all.map(([k, l]) => `<div class="mc-copy__cat"><b>${C.CAT[k].icon} ${esc(C.CAT[k].name)}</b>${l.map((x) => chk(`data-mctg="${x.key}"`, E.copy.targets.includes(x.key), esc(x.name))).join('')}</div>`).join('')}</div>
      <div class="mc-ed__foot"><span class="muted">选了 ${E.copy.targets.length} 种</span><button type="button" class="btn btn-ghost" data-mccopyx style="margin-left:auto">取消</button><button type="button" class="btn btn-primary" data-mccopygo ${E.copy.targets.length && E.copy.parts.length ? '' : 'disabled'}>套用</button></div></section>`;
  }

  // ---------- 飞书群 / 发送记录 ----------
  function groupsHtml() {
    const used = (id) => Object.values(V.rules).filter((r) => r.on && r.via.groups.includes(id)).length;
    return `<section class="panel"><div class="panel__h"><h3>飞书群</h3><span class="tipify">在飞书群里:设置 → 群机器人 → 添加机器人 → 自定义机器人,复制它的 webhook 地址。建议同时开「签名校验」,把密钥也填上。改价的通知里有价格,发群前确认群里只有该看的人。</span></div>
      ${V.groups.length ? V.groups.map((g) => `<div class="ngrp" data-g="${esc(g.id)}"><b>${esc(g.name)}</b><span class="muted mono">${esc(g.tail)}</span>${g.signed ? '<span class="tag">签名校验</span>' : ''}
        <span class="muted">用在 ${used(g.id)} 种通知</span><span class="ngrp__act"><button class="btn btn-sm" type="button" data-g-test>发测试消息</button><button class="btn btn-sm btn-ghost" type="button" data-g-del>删除</button></span></div>`).join('')
        : '<p class="muted">还没有群。加了群之后,在每种通知的「怎么推送」里勾上它。</p>'}
      <div class="ngrp-add"><input class="inp" id="ng-name" placeholder="群名,比如:改价群" maxlength="30"/>
        <input class="inp" id="ng-hook" placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/…"/>
        <input class="inp" id="ng-secret" type="password" placeholder="签名校验密钥(没开就留空)"/>
        <button class="btn btn-sm btn-primary" type="button" id="ng-add">添加</button></div></section>`;
  }
  const MODE_TAG = { merge: '合成一条', digest: '每天汇总', work: '等上班' };
  function logHtml() {
    const cats = [['', '全部'], ...V.cats.map((k) => [k, C.CAT[k].name]), ['digest', '汇总']];
    return `<section class="panel"><div class="panel__h"><h3>发送记录</h3><span class="tipify">最近的通知:发给了谁、发成功没有。「排队中」的是设了合成一条 / 每天汇总 / 工作时间的,到时间一起发。</span></div>
      <div class="ftabs" style="margin-bottom:10px">${cats.map(([k, l]) => `<button type="button" class="ftab ${logCat === k ? 'is-active' : ''}" data-lcat="${k}">${esc(l)}</button>`).join('')}</div>
      ${logRows.length ? `<table class="mtable nlog"><thead><tr><th>时间</th><th>通知</th><th>发给</th><th>结果</th></tr></thead><tbody>
        ${logRows.map((r) => `<tr><td class="muted">${fDT(r.at)}</td><td>${esc(r.title)}${r.queued ? ` <span class="tag">${MODE_TAG[r.mode] || ''} · 排队中</span>` : r.mode && r.mode !== 'now' ? ` <span class="tag">${MODE_TAG[r.mode] || r.mode}</span>` : ''}${r.count > 1 ? ` <span class="muted">${r.count} 条合成一张</span>` : ''}</td>
          <td>${esc((r.people || []).join('、'))}${(r.groups || []).length ? `${(r.people || []).length ? ' · ' : ''}群「${esc(r.groups.join('」「'))}」` : ''}</td>
          <td>${r.queued ? '<span class="muted">等发送</span>' : r.ok ? '<span class="nlog__ok">✓</span>' : `<span class="nlog__err">⚠ ${esc((r.errors || []).join(';'))}</span>`}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">还没有发送记录。</p>'}
      ${logMore ? '<button class="btn btn-sm" type="button" id="nl-more">再看早一点的</button>' : ''}</section>`;
  }

  function draw() {
    const root = $('#nt-root'); if (!root || !V || !C) return;
    window.cgpNav?.sync(); // 地址栏:/notify、/notify/rule/<通知>、/notify/groups、/notify/log
    const y = window.scrollY;
    root.innerHTML = `<div class="phead"><div><h2>消息中心</h2><p class="muted">每一类通知都能设:卡片长什么样、显示哪些信息、推给谁、私信还是发群、什么时候推;每个人还能在「我的账号」里关掉自己不想收的日常通知</p></div>
        <label class="mc-tz">时间按 <select class="sel sel--sm" id="mc-tz">${Object.entries(V.tzs).map(([k, l]) => `<option value="${k}" ${V.tz === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      ${V.saved ? '' : '<div class="note note--sm">现在用的是默认设置(按原来的开关和群推出来的),改任何一种就保存成你的设置。</div>'}
      ${E ? '' : `<div class="ptabs"><div class="seg">${[['rules', '通知设置'], ['groups', '飞书群', V.groups.length], ['log', '发送记录']].map(([k, l, n]) => `<button type="button" data-ntab="${k}" class="${tab === k ? 'is-active' : ''}">${l}${n != null ? ` <span class="seg__n">${n}</span>` : ''}</button>`).join('')}</div></div>`}
      ${E ? editorHtml() : tab === 'rules' ? rulesHtml() : tab === 'groups' ? groupsHtml() : logHtml()}`;
    if (E) { window.scrollTo(0, y); wireDrag(); }
  }
  // 只换预览 + 一句话(打字时不重画整页,光标不丢)
  function refresh(full) {
    E.dirty = true;
    if (full) return draw();
    const pv = $('#mc-pv'); if (pv) pv.innerHTML = previewCard();
    const sm = $('.mc-pv__sum'); if (sm) sm.textContent = sumText(C.EV[E.key], E.rule);
    const sv = $('[data-mcsave]'); if (sv) sv.disabled = false;
  }
  // 拖动排顺序(用指针事件:原生拖放在后台 iframe 里不稳)
  function wireDrag() {
    const box = $('#mc-flds'); if (!box) return;
    $$('.mc-fld.is-on .mc-fld__grip', box).forEach((g) => g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const row = g.closest('.mc-fld'); row.classList.add('is-drag'); g.setPointerCapture(e.pointerId);
      const move = (ev2) => {
        const rows = $$('.mc-fld.is-on', box).filter((x) => x !== row);
        const after = rows.find((x) => { const b = x.getBoundingClientRect(); return ev2.clientY < b.top + b.height / 2; });
        if (after) box.insertBefore(row, after); else { const last = rows[rows.length - 1]; if (last) last.after(row); }
      };
      const up = () => {
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
        row.classList.remove('is-drag');
        E.rule.style.fields = $$('.mc-fld.is-on', box).map((x) => x.dataset.f);
        refresh(true);
      };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    }));
  }

  async function load() {
    const root = $('#nt-root'); if (!root) return;
    if (!V) root.innerHTML = '<p class="muted">读取中…</p>';
    try { [V] = await Promise.all([api('GET', '/api/notify'), catalog()]); } catch (e) { root.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    if (!V.cats.includes(cat)) cat = V.cats[0];
    if (E && !V.rules[E.key]) E = null;
    if (tab === 'log' && !E) await loadLog(); else draw();
  }
  async function loadLog(more) {
    try {
      const before = more && logRows.length ? logRows[logRows.length - 1].at : '';
      const r = await api('GET', `/api/notify/log?limit=100${before ? `&before=${before}` : ''}${logCat ? `&cat=${logCat}` : ''}`);
      logRows = more ? logRows.concat(r.rows) : r.rows; logMore = r.more;
    } catch (e) { toast(e.message, false); }
    draw();
  }
  function openEditor(key) {
    const r = clone(V.rules[key]); r.style = r.style ? clone(r.style) : C.defaultStyle(C.EV[key]);
    E = { key, rule: r, dirty: false, copy: null };
    cat = C.EV[key].cat; draw(); window.scrollTo(0, 0);
  }
  const leave = (btn) => {
    if (E?.dirty && !btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = '有没保存的修改,再点一次放弃'; return false; }
    E = null; draw(); return true;
  };
  async function saveToggle(key, on) {
    if (busy) return; busy = true;
    const r = clone(V.rules[key]); r.on = on;
    try { V = { ...V, ...(await api('PUT', `/api/notify/rules/${encodeURIComponent(key)}`, r)) }; toast(on ? '已打开' : '已关掉'); } catch (e) { toast(e.message, false); }
    busy = false; draw();
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#nt-root')) return;
    const t = e.target.closest('[data-ntab]');
    if (t) { if (E && !leave(t)) return; E = null; tab = t.dataset.ntab; if (tab === 'log') loadLog(); else draw(); return; }
    const ct = e.target.closest('[data-mccat]'); if (ct) { cat = ct.dataset.mccat; draw(); return; }
    const ed = e.target.closest('[data-mcedit]'); if (ed) { openEditor(ed.dataset.mcedit); return; }
    const lc = e.target.closest('[data-lcat]'); if (lc) { logCat = lc.dataset.lcat; loadLog(); return; }
    if (e.target.closest('#nl-more')) { loadLog(true); return; }
    if (E) {
      const ev = C.EV[E.key]; const r = E.rule; const s = r.style;
      const back = e.target.closest('[data-mcback]'); if (back) { leave(back); return; }
      const col = e.target.closest('[data-mccolor]'); if (col) { s.color = col.dataset.mccolor; refresh(true); return; }
      const lay = e.target.closest('[data-mclayout]'); if (lay) { s.layout = lay.dataset.mclayout; refresh(true); return; }
      const mv = e.target.closest('[data-mcmv]');
      if (mv) { const [k, d] = mv.dataset.mcmv.split(':'); const i = s.fields.indexOf(k); const j = i + Number(d); if (i >= 0 && j >= 0 && j < s.fields.length) { [s.fields[i], s.fields[j]] = [s.fields[j], s.fields[i]]; refresh(true); } return; }
      const to = e.target.closest('[data-mcto]'); if (to) { r.to[to.dataset.mcto] = !r.to[to.dataset.mcto]; refresh(true); return; }
      if (e.target.closest('[data-mcsave]')) {
        const b = e.target.closest('[data-mcsave]'); b.disabled = true;
        try { V = { ...V, ...(await api('PUT', `/api/notify/rules/${encodeURIComponent(E.key)}`, r)) }; toast('已保存'); openEditor(E.key); }
        catch (err) { toast(err.message, false); b.disabled = false; }
        return;
      }
      const rs = e.target.closest('[data-mcreset]');
      if (rs) {
        if (!rs.dataset.sure) { rs.dataset.sure = '1'; rs.textContent = '再点一次恢复默认'; return; }
        try { V = { ...V, ...(await api('POST', `/api/notify/rules/${encodeURIComponent(E.key)}/reset`, {})) }; toast('已恢复默认'); openEditor(E.key); } catch (err) { toast(err.message, false); }
        return;
      }
      if (e.target.closest('[data-mctest]')) {
        const b = e.target.closest('[data-mctest]'); b.disabled = true;
        try { const x = await api('POST', `/api/notify/rules/${encodeURIComponent(E.key)}/test`, { rule: r, group: $('#mc-testto')?.value || '' }); toast(`试发的卡片已发到${x.to}`); } catch (err) { toast(err.message, false); }
        b.disabled = false; return;
      }
      if (e.target.closest('[data-mccopy]')) { E.copy = E.copy ? null : { parts: ['to', 'via', 'when'], targets: [] }; draw(); if (E.copy) $('.mc-copy')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if (e.target.closest('[data-mccopyx]')) { E.copy = null; draw(); return; }
      const sel = e.target.closest('[data-mcsel]');
      if (sel && E.copy) {
        const k = sel.dataset.mcsel; const suf = E.key.split('.')[1];
        E.copy.targets = k === 'none' ? [] : k === 'cat' ? evsOf(ev.cat).map((x) => x.key).filter((x) => x !== E.key) : evs().filter((x) => x.key !== E.key && x.key.split('.')[1] === suf && C.CAT_OF_KIND[x.cat]).map((x) => x.key);
        draw(); return;
      }
      if (e.target.closest('[data-mccopygo]')) {
        const b = e.target.closest('[data-mccopygo]'); b.disabled = true;
        try {
          if (E.dirty) V = { ...V, ...(await api('PUT', `/api/notify/rules/${encodeURIComponent(E.key)}`, r)) }; // 先存这里的
          const x = await api('POST', `/api/notify/rules/${encodeURIComponent(E.key)}/copy`, { parts: E.copy.parts, targets: E.copy.targets });
          V = { ...V, ...x }; toast(`已套用到 ${x.copied} 种通知`); openEditor(E.key);
        } catch (err) { toast(err.message, false); b.disabled = false; }
        return;
      }
    }
    if (e.target.closest('#ng-add')) {
      const b = e.target.closest('#ng-add'); b.disabled = true;
      try { V = { ...V, ...(await api('POST', '/api/notify/groups', { name: $('#ng-name').value, webhook: $('#ng-hook').value, secret: $('#ng-secret').value })) }; toast('群已加好,可以点「发测试消息」试一下'); draw(); }
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
      try { V = { ...V, ...(await api('DELETE', `/api/notify/groups/${encodeURIComponent(g.dataset.g)}`)) }; toast('群已删掉,用到它的通知不再发这个群'); draw(); } catch (err) { toast(err.message, false); }
    }
  });
  document.addEventListener('change', async (e) => {
    if (!e.target.closest('#nt-root')) return;
    if (e.target.id === 'mc-tz') {
      try { V = { ...V, ...(await api('PUT', '/api/notify/settings', { tz: e.target.value })) }; toast(`时间改成按${V.tzs[V.tz]}算`); } catch (err) { toast(err.message, false); }
      draw(); return;
    }
    const row = e.target.closest('.mc-row[data-ev]');
    if (row && e.target.matches('[data-mcon]')) { saveToggle(row.dataset.ev, e.target.checked); return; }
    if (!E) return;
    const r = E.rule; const s = r.style; const d = e.target.dataset;
    if (e.target.matches('[data-mcedon]')) { r.on = e.target.checked; refresh(true); return; }
    if (d.mcs === 'titleName') { s.titleName = e.target.checked; refresh(); return; }
    if (d.mcf) { const k = d.mcf; s.fields = e.target.checked ? [...s.fields, k] : s.fields.filter((x) => x !== k); refresh(true); return; }
    if (d.mcb) { s.buttons[d.mcb].on = e.target.checked; refresh(); return; }
    if (d.mclist) { const k = d.mclist; r.to[k] = e.target.checked ? [...new Set([...r.to[k], e.target.value])] : r.to[k].filter((x) => x !== e.target.value); refresh(); return; }
    if (d.mcto2) { r.to[d.mcto2] = e.target.checked; refresh(); return; }
    if (d.mcvia) { r.via[d.mcvia] = e.target.checked; refresh(); return; }
    if (e.target.matches('[data-mcgrp]')) { r.via.groups = e.target.checked ? [...new Set([...r.via.groups, e.target.value])] : r.via.groups.filter((x) => x !== e.target.value); if (!r.via.groups.length) r.via.at = false; refresh(true); return; }
    if (e.target.name === 'mcwhen') { r.when.mode = e.target.value; refresh(true); return; }
    if (d.mccp && E.copy) { const k = d.mccp; E.copy.parts = e.target.checked ? [...E.copy.parts, k] : E.copy.parts.filter((x) => x !== k); draw(); return; }
    if (d.mctg && E.copy) { const k = d.mctg; E.copy.targets = e.target.checked ? [...E.copy.targets, k] : E.copy.targets.filter((x) => x !== k); draw(); }
  });
  document.addEventListener('input', (e) => {
    if (!E || !e.target.closest('#nt-root')) return;
    const r = E.rule; const s = r.style; const d = e.target.dataset;
    if (d.mcs === 'title') { s.title = e.target.value; refresh(); }
    else if (d.mcs === 'max') { s.max = Math.min(30, Math.max(1, Number(e.target.value) || 1)); refresh(); }
    else if (d.mcbt) { s.buttons[d.mcbt].text = e.target.value; refresh(); }
    else if (d.mcw) { r.when[d.mcw] = d.mcw === 'merge' ? Math.min(240, Math.max(1, Number(e.target.value) || 1)) : e.target.value; refresh(); }
  });
  document.querySelector('#modnav [data-section="notify"]')?.addEventListener('click', () => load());
  window.cgpOpenNotify = () => { window.showSection('notify'); load(); };
  // 网址(public/nav.js):消息中心现在看哪一页;/notify/rule/price-live = 打开「改价开始」的设置(网址里不能有点,点换成 -)
  window.cgpNotifyPath = () => (E ? `/rule/${E.key.replace('.', '-')}` : tab === 'rules' ? '' : `/${tab}`);
  window.cgpNotifyRoute = async (sub, b) => {
    E = null;
    if (sub === 'rule' && b) { await catalog(); const key = b.replace('-', '.'); if (!V) { await load(); } if (V?.rules[key]) { tab = 'rules'; openEditor(key); return; } toast('找不到这种通知', false); }
    tab = ['groups', 'log'].includes(sub) ? sub : 'rules';
    if (V) { if (tab === 'log') loadLog(); else draw(); }
  };

  // ---------- 我的通知(设置 → 我的账号)----------
  let MY = null;
  async function drawMine(el) {
    if (!MY) return;
    await catalog();
    if (!MY.events.length) { el.innerHTML = '<div class="panel__h"><h3>我的通知</h3></div><p class="muted">按现在的设置,你不会收到私信通知。要收哪些找管理员在「消息中心」里设。</p>'; return; }
    const byCat = {}; for (const x of MY.events) (byCat[x.cat] ||= []).push(x);
    el.innerHTML = `<div class="panel__h"><h3>我的通知</h3><span class="tipify">按管理员在消息中心定的设置,你可能会收到下面这些(飞书私信)。日常通知可以自己关掉;出问题和审批的关不掉。</span></div>
      ${MY.team ? '' : '<p class="muted">现在没开多人协作,私信暂时发不出去。</p>'}
      ${Object.entries(byCat).map(([c, list]) => `<details class="mynt" data-c="${c}" ${Object.keys(byCat).length <= 2 ? 'open' : ''}><summary class="mynt__h">${C.CAT[c]?.icon || ''} ${esc(C.CAT[c]?.name || c)} <span class="muted">${list.filter((x) => !x.muted).length}/${list.length}</span></summary>
        ${list.map((x) => `<div class="mynt__r"><span><b>${esc(x.name)}</b>${x.desc ? `<span class="tipify">${esc(x.desc)}</span>` : ''}<em class="mynt__w">${x.reach === 'always' ? '会收到' : '和你有关时收到'}</em></span>
          ${x.level === 'info' ? `<label class="tgl"><input type="checkbox" data-mynt="${esc(x.key)}" ${x.muted ? '' : 'checked'}/><span class="tgl__ui"></span></label>` : '<span class="tag">必收</span>'}</div>`).join('')}</details>`).join('')}`;
    $$('[data-mynt]', el).forEach((c) => c.addEventListener('change', async () => {
      try { MY = await api('PUT', '/api/notify/me', { key: c.dataset.mynt, mute: !c.checked }); toast(c.checked ? '已打开' : '已关掉,以后不再收这类通知'); }
      catch (err) { toast(err.message, false); }
      const open = $$('details.mynt[open]', el).map((x) => x.dataset.c); await drawMine(el);
      $$('details.mynt', el).forEach((d) => { if (open.includes(d.dataset.c)) d.open = true; });
    }));
  }
  window.cgpMyNotify = async (el) => {
    if (!el) return;
    el.innerHTML = '<div class="panel__h"><h3>我的通知</h3></div><p class="muted">读取中…</p>';
    try { MY = await api('GET', '/api/notify/me'); } catch (e) { el.innerHTML = `<div class="panel__h"><h3>我的通知</h3></div><p class="muted">${esc(e.message)}</p>`; return; }
    drawMine(el);
  };
})();
