// 元数据总账前端。复用 app.js 的 $ / $$ / esc / api / toast 全局帮手。
// 注意:别用 app.js 的 adminBase/productAdminUrl —— 那些读的是促销模块的 DATA,
// 促销没加载时是 null。总账用下面这套自己的。
//
// 列表只放「名称 / 数量 / 来源 / 有标注才显示标注」,一行一条尽量密;
// key、类型、主题引用明细、标注编辑全部在详情页 —— 列表页保持可扫。

let REG = null;
const dataCache = new Map();   // 详情页的数据区(资源列表/条目),按定义缓存
let current = null;            // 当前详情页 { kind, row }
const state = {
  metafields: { page: 1, size: 25 },
  metaobjects: { page: 1, size: 25 },
};
let lastModule = 'metafields';

const regStore = () => REG.store || {
  handle: String(REG.shop || '').replace('.myshopify.com', ''),
  storefrontUrl: `https://${REG.shop || ''}`,
};
const regAdmin = () => `https://admin.shopify.com/store/${regStore().handle}`;
const regFront = () => String(regStore().storefrontUrl || '').replace(/\/$/, '');

function resourceAdminUrl(kind, id) {
  const map = { Product: 'products', ProductVariant: 'products', Collection: 'collections' };
  const seg = map[kind];
  return seg && id ? `${regAdmin()}/${seg}/${id}` : null;
}
const entryAdminUrlReg = (type, id) => `${regAdmin()}/content/entries/${type}/${id}`;
const out = (href, text, cls = '') =>
  `<a class="lnk ${cls}" href="${esc(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(text)} <span class="lnk__i">↗</span></a>`;

// ---- 图标 ----
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  text: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  lines: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.8h5M9.5 14.2h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  toggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="2.6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  cube: '<path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  empty: '<circle cx="12" cy="12" r="9"/><path d="M9 9h.01M15 9h.01M9 15.5c1.5-1 4.5-1 6 0"/>',
};
function typeIcon(t = '') {
  const s = String(t).toLowerCase();
  if (s.includes('metaobject_reference')) return ICONS.cube;
  if (s.includes('money')) return ICONS.money;
  if (s.includes('date')) return ICONS.calendar;
  if (s.includes('boolean')) return ICONS.toggle;
  if (s.includes('file_reference') || s.includes('image')) return ICONS.image;
  if (s.includes('reference') || s.includes('url') || s === 'link') return ICONS.link;
  if (s.includes('json')) return ICONS.braces;
  if (s.includes('rich_text') || s.includes('multi_line')) return ICONS.lines;
  if (/integer|decimal|number|rating|weight|dimension|volume/.test(s)) return ICONS.hash;
  if (s.startsWith('list.')) return ICONS.list;
  return ICONS.text;
}

// ---- 板块切换 ----
function showSection(name) {
  $$('.section').forEach((p) => p.classList.toggle('is-active', p.id === 'section-' + name));
  $$('#modnav .modnav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.section === name));
  if (name !== 'detail') lastModule = name;
  window.scrollTo(0, 0);
}
$$('#modnav .modnav__item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.section;
    showSection(s);
    if (s === 'promo') window.loadPromoOnce();
  });
});
$('#detail-back').addEventListener('click', () => showSection(lastModule));

const annotationOf = (key) => (REG.annotations && REG.annotations[key]) || {};
const statusCls = (s) => s === '已废弃' || s === '待废弃' ? 'tag--danger' : s === '在用' ? 'tag--ok' : 'tag--warn';

// ---- 列表行:一行一条,只放名称/标注/来源/数量 ----
function annInline(key) {
  const a = annotationOf(key);
  return [
    a.purpose ? `<span class="rw__ann">${esc(a.purpose)}</span>` : '',
    a.project ? `<span class="tag tag--accent">${esc(a.project)}</span>` : '',
    a.status ? `<span class="tag ${statusCls(a.status)}">${esc(a.status)}</span>` : '',
  ].join('');
}
const themeDot = (r) => (Array.isArray(r.themeUsage) && r.themeUsage.length)
  ? '<span class="tag tag--ok"><span class="dot"></span>主题</span>' : '';

function rowHtml({ akey, kind, icon, name, stale, source, count }) {
  return `<button class="rw ${stale ? 'rw--stale' : ''}" data-akey="${esc(akey)}" data-kind="${kind}" type="button">
    <span class="rw__icon">${svg(icon)}</span>
    <span class="rw__name">${esc(name)}${stale ? '<span class="tag tag--danger">疑似废弃</span>' : ''}${annInline(akey)}</span>
    <span class="rw__src">${esc(source)}</span>
    <span class="rw__n ${count ? '' : 'rw__n--zero'}">${count == null ? '—' : count}</span>
    <span class="rw__go" aria-hidden="true">›</span>
  </button>`;
}
const mfRow = (r) => rowHtml({
  akey: r.annotationKey, kind: 'mf', icon: typeIcon(r.type), name: r.name,
  stale: r.stale, source: r.source, count: r.dataCount,
});
const moRow = (r) => rowHtml({
  akey: r.annotationKey, kind: 'mo', icon: ICONS.cube, name: r.name,
  stale: r.stale, source: r.source, count: r.entryCount,
});

// ---- 分页 ----
function pagerHtml(mod, total, page, size) {
  if (total === 0) return '';
  const pages = Math.max(1, Math.ceil(total / size));
  const from = (page - 1) * size + 1, to = Math.min(total, page * size);
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const btns = nums.map((n) => n === '…' ? '<span class="pgdots">…</span>'
    : `<button class="pgbtn ${n === page ? 'is-active' : ''}" data-mod="${mod}" data-go="${n}" type="button">${n}</button>`).join('');
  return `<div class="pager__info">第 ${from}–${to} 条,共 ${total} 条 · ${pages} 页</div>
    <div class="pager__btns">
      <button class="pgbtn" data-mod="${mod}" data-go="${page - 1}" type="button" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      ${btns}
      <button class="pgbtn" data-mod="${mod}" data-go="${page + 1}" type="button" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>`;
}
const emptyState = (msg) => `<div class="empty">${svg(ICONS.empty)}<div>${esc(msg)}</div></div>`;

// ---- 过滤 ----
function usageMatch(r, mode, count) {
  if (!mode) return true;
  if (mode === 'stale') return !!r.stale;
  if (mode === 'nodata') return (count || 0) === 0;
  if (mode === 'theme') return Array.isArray(r.themeUsage) && r.themeUsage.length > 0;
  if (mode === 'notheme') return Array.isArray(r.themeUsage) && r.themeUsage.length === 0;
  return true;
}
function textMatch(r, q, hay) {
  if (!q) return true;
  const a = annotationOf(r.annotationKey);
  return (hay + ' ' + (a.purpose || '') + ' ' + (a.project || '')).toLowerCase().includes(q);
}

function renderMetafields() {
  const q = ($('#mf-search').value || '').trim().toLowerCase();
  const owner = $('#mf-owner').value, source = $('#mf-source').value, usage = $('#mf-usage').value;
  const st = state.metafields;
  st.size = Number($('#mf-size').value) || 25;
  const rows = REG.metafields.filter((r) =>
    (!owner || r.ownerType === owner) && (!source || r.source === source)
    && usageMatch(r, usage, r.dataCount) && textMatch(r, q, `${r.name} ${r.full}`));
  const pages = Math.max(1, Math.ceil(rows.length / st.size));
  if (st.page > pages) st.page = pages;
  const slice = rows.slice((st.page - 1) * st.size, st.page * st.size);
  $('#mf-list').innerHTML = slice.length ? slice.map(mfRow).join('') : emptyState('没有匹配的字段');
  $('#mf-pager').innerHTML = pagerHtml('metafields', rows.length, st.page, st.size);
}

function renderMetaobjects() {
  const q = ($('#mo-search').value || '').trim().toLowerCase();
  const source = $('#mo-source').value, usage = $('#mo-usage').value;
  const st = state.metaobjects;
  st.size = Number($('#mo-size').value) || 25;
  const rows = REG.metaobjects.filter((r) =>
    (!source || r.source === source) && usageMatch(r, usage, r.entryCount)
    && textMatch(r, q, `${r.name} ${r.type}`));
  const pages = Math.max(1, Math.ceil(rows.length / st.size));
  if (st.page > pages) st.page = pages;
  const slice = rows.slice((st.page - 1) * st.size, st.page * st.size);
  $('#mo-list').innerHTML = slice.length ? slice.map(moRow).join('') : emptyState('没有匹配的 metaobject');
  $('#mo-pager').innerHTML = pagerHtml('metaobjects', rows.length, st.page, st.size);
}

const stat = (n, label, tone = '') => `<div class="stat ${tone}"><div class="stat__n">${esc(n)}</div><div class="stat__l">${esc(label)}</div></div>`;

function renderStats() {
  const mf = REG.metafields, mo = REG.metaobjects;
  $('#n-mf').textContent = mf.length;
  $('#n-mo').textContent = mo.length;
  $('#mf-stats').innerHTML =
    stat(mf.length, '字段定义总数') +
    stat(mf.filter((r) => (r.dataCount || 0) > 0).length, '有数据', 'stat--ok') +
    stat(mf.filter((r) => Array.isArray(r.themeUsage) && r.themeUsage.length).length, '主题在用') +
    stat(mf.filter((r) => r.stale).length, '疑似废弃', 'stat--danger') +
    stat(Object.keys(REG.annotations || {}).length, '已标注用途');
  $('#mo-stats').innerHTML =
    stat(mo.length, '对象定义总数') +
    stat(mo.filter((r) => (r.entryCount || 0) > 0).length, '有条目', 'stat--ok') +
    stat(mo.filter((r) => r.createdByApp).length, 'App 创建') +
    stat(mo.filter((r) => r.stale).length, '疑似废弃', 'stat--danger');
  const owners = REG.ownerTypes.map((o) => `<option value="${esc(o.type)}">${esc(o.label)}</option>`).join('');
  $('#mf-owner').innerHTML = `<option value="">全部资源</option>${owners}`;
  const mfSrc = [...new Set(mf.map((r) => r.source))].filter(Boolean).sort();
  $('#mf-source').innerHTML = `<option value="">全部来源</option>` + mfSrc.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  const moSrc = [...new Set(mo.map((r) => r.source))].filter(Boolean).sort();
  $('#mo-source').innerHTML = `<option value="">全部创建者</option>` + moSrc.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}

// ---- 详情页:定义信息 + 标注设置 + 数据 ----
function themeBlock(row) {
  if (row.themeUsage === null) return '<span class="muted">未扫描主题</span>';
  if (!row.themeUsage.length) return '<span class="tag">主题未引用</span>';
  const files = [...new Set(row.themeUsage.map((h) => h.file))];
  return `<details class="usage" open><summary><span class="tag tag--ok"><span class="dot"></span>${files.length} 个文件在用</span></summary>
    <ul class="usagelist">${row.themeUsage.slice(0, 20)
      .map((h) => `<li><code>${esc(h.file)}:${h.line}</code><div class="snip">${esc(h.snippet)}</div></li>`).join('')}</ul></details>`;
}

function renderDetailInfo() {
  const { kind, row } = current;
  const a = annotationOf(row.annotationKey);
  const info = kind === 'mf'
    ? [['字段', `<span class="mono">${esc(row.full)}</span>`],
       ['类型', `<span class="mono">${esc(row.type)}</span>`],
       ['资源', esc(row.ownerLabel)],
       ['来源', `${esc(row.source)} <span class="muted">${esc(row.ownerGuess)}</span>`],
       ['有数据', `<b>${row.dataCount ?? '—'}</b> 个资源`],
       ['主题引用', themeBlock(row)]]
    : [['类型', `<span class="mono">${esc(row.type)}</span>`],
       ['字段数', String(row.fieldCount)],
       ['条目数', `<b>${row.entryCount ?? '—'}</b>`],
       ['创建者', row.createdByApp ? `App · ${esc(row.createdByApp)}` : (row.createdByStaff ? `人工 · ${esc(row.createdByStaff)}` : '未知')],
       ['主题引用', themeBlock(row)]];

  const opts = ['', '在用', '待确认', '待废弃', '已废弃']
    .map((s) => `<option value="${s}" ${s === (a.status || '') ? 'selected' : ''}>${s || '(未设状态)'}</option>`).join('');

  $('#detail-info').innerHTML = `
    <div class="infocard">
      ${info.map(([k, v]) => `<div class="inforow"><span class="info__k">${esc(k)}</span><span class="info__v">${v}</span></div>`).join('')}
    </div>
    <div class="infocard annopanel" data-key="${esc(row.annotationKey)}">
      <div class="annopanel__t">用途标注</div>
      <div class="annoform">
        <input class="ann__purpose-in" placeholder="用途:这个字段/对象是干什么的" value="${esc(a.purpose || '')}" />
        <input class="ann__project-in" placeholder="归属项目,如 Setup Kit / 搜索引擎" value="${esc(a.project || '')}" />
        <select class="ann__status-in">${opts}</select>
        <button class="btn btn-primary btn-sm ann__save" type="button">保存</button>
      </div>
      ${a.updatedAt ? `<div class="muted">上次更新 ${new Date(a.updatedAt).toLocaleString()}</div>` : ''}
    </div>`;
}

function renderMetafieldData(d) {
  if (!d.ok) return `<p class="muted">${esc(d.reason)}</p>`;
  if (!d.rows.length) return emptyState('没查到有值的资源');
  const mismatch = d.expected && d.count !== d.expected
    ? `<span class="tag tag--warn">总账计数 ${d.expected},实际命中 ${d.count}</span>` : '';
  const rows = d.rows.map((r) => {
    const kind = r.linkKind || (d.ownerType === 'COLLECTION' ? 'Collection' : 'Product');
    const admin = resourceAdminUrl(kind, r.linkId || r.id);
    const handle = r.linkHandle || r.handle || '';
    const front = handle ? `${regFront()}/${kind === 'Collection' ? 'collections' : 'products'}/${handle}` : null;
    const title = admin ? `<a class="reslink" href="${esc(admin)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : `<b>${esc(r.title)}</b>`;
    return `<tr>
      <td class="cell-res">
        <div class="resline">${title}${front ? out(front, '前台', 'lnk--front') : ''}</div>
        ${r.parentTitle ? `<div class="muted">${esc(r.parentTitle)}</div>` : ''}
        ${r.sku ? `<div class="muted mono">SKU ${esc(r.sku)}</div>` : ''}
        ${r.status && r.status !== 'ACTIVE' ? `<span class="tag tag--warn">${esc(r.status)}</span>` : ''}
      </td>
      <td class="drillval">${esc(r.value).slice(0, 400)}</td>
    </tr>`;
  }).join('');
  return `<h3>使用这个字段的资源</h3>
    <div class="detbar">命中 <b>${d.count}</b> 个 · 扫描 ${d.scanned ?? '?'} 个 · 点名称进后台 ${mismatch}</div>
    <div class="tablewrap"><table class="tbl tbl--detail">
      <thead><tr><th>资源</th><th>值</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${d.truncated ? '<p class="muted">结果过多,只显示前 500 条</p>' : ''}`;
}

function renderMetaobjectData(d) {
  if (!d.ok) return `<p class="muted">${esc(d.reason || '查询失败')}</p>`;
  if (!d.rows.length) return emptyState('这个 metaobject 还没有条目');
  const items = d.rows.map((e) => {
    const fields = e.fields.length
      ? `<dl class="fields">${e.fields.map((f) => `<div class="field"><dt>${esc(f.key)}</dt><dd>${esc(f.value).slice(0, 400)}</dd></div>`).join('')}</dl>`
      : '<p class="muted fields">所有字段为空</p>';
    const refs = e.refs.length
      ? `<ul class="plist">${e.refs.map((r) => {
          const url = resourceAdminUrl(r.kind, r.linkId);
          const t = url ? `<a class="reslink" href="${esc(url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : `<b>${esc(r.title)}</b>`;
          return `<li><span class="tag">${esc(r.kind)}</span> ${t}
            ${r.parentTitle ? `<span class="muted">(${esc(r.parentTitle)})</span>` : ''}
            <span class="muted mono">via ${esc(r.viaField)}</span>
            ${r.handle ? out(`${regFront()}/products/${r.handle}`, '前台', 'lnk--front') : ''}</li>`;
        }).join('')}</ul>`
      : '<p class="muted">没有任何资源引用这条 —— 可能是孤儿</p>';
    return `<details class="entry ${e.refCount ? '' : 'entry--orphan'}">
      <summary><b>${esc(e.title)}</b>
        ${e.refCount ? `<span class="tag tag--ok"><span class="dot"></span>被 ${e.refCount} 处引用</span>` : '<span class="tag tag--warn">无引用</span>'}
        <span class="entry__spacer"></span><span class="muted mono">${esc(e.handle)}</span>
        ${out(entryAdminUrlReg(d.type, e.id), '后台')}
      </summary>
      <div class="pctx">${fields}<div class="refsec"><div class="refsec__t">被谁引用</div>${refs}</div></div>
    </details>`;
  }).join('');
  return `<h3>条目</h3><div class="detbar">共 <b>${d.count}</b> 个条目</div>
    <div class="entries">${items}</div>${d.truncated ? '<p class="muted">条目过多,只显示前 500 条</p>' : ''}`;
}

async function openDetail(kind, row) {
  current = { kind, row };
  const isMf = kind === 'mf';
  showSection('detail');
  $('#detail-title').textContent = row.name;
  $('#detail-sub').textContent = isMf ? row.full : row.type;
  $('#detail-actions').innerHTML = isMf
    ? out(`${regAdmin()}/settings/custom_data`, '定义设置')
    : out(`${regAdmin()}/content/entries/${row.type}`, '后台条目列表');
  renderDetailInfo();

  const body = $('#detail-body');
  const count = isMf ? row.dataCount : row.entryCount;
  if (!count) { body.innerHTML = emptyState(isMf ? '这个字段还没有任何资源填值' : '这个 metaobject 还没有条目'); return; }

  const cacheKey = isMf ? `mf:${row.ownerType}:${row.full}` : `mo:${row.type}`;
  if (dataCache.has(cacheKey)) { body.innerHTML = dataCache.get(cacheKey); return; }
  body.innerHTML = isMf
    ? '<p class="muted">正在扫描并逐条核对…（命中越少扫得越久,最多几十秒）</p>'
    : '<p class="muted">加载中…</p>';
  try {
    let html;
    if (isMf) {
      const d = await api('GET', `/api/drill/metafield?ownerType=${encodeURIComponent(row.ownerType)}`
        + `&namespace=${encodeURIComponent(row.namespace)}&key=${encodeURIComponent(row.key)}`
        + `&expected=${encodeURIComponent(row.dataCount || 0)}`);
      html = renderMetafieldData(d);
    } else {
      const d = await api('GET', `/api/drill/metaobject?type=${encodeURIComponent(row.type)}`);
      html = renderMetaobjectData(d);
    }
    dataCache.set(cacheKey, html);
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<p class="muted">出错: ${esc(e.message)}</p>`;
  }
}

// ---- 事件 ----
function wireList(listSel, pagerSel, rerender, mod, pool) {
  $(listSel).addEventListener('click', (e) => {
    const row = e.target.closest('.rw');
    if (!row) return;
    const item = REG[pool].find((x) => x.annotationKey === row.dataset.akey);
    if (item) openDetail(row.dataset.kind, item);
  });
  $(pagerSel).addEventListener('click', (e) => {
    const b = e.target.closest('.pgbtn');
    if (!b || b.disabled) return;
    state[mod].page = Number(b.dataset.go);
    rerender();
    window.scrollTo(0, 0);
  });
}
wireList('#mf-list', '#mf-pager', renderMetafields, 'metafields', 'metafields');
wireList('#mo-list', '#mo-pager', renderMetaobjects, 'metaobjects', 'metaobjects');

// 详情页的标注保存
$('#detail-info').addEventListener('click', async (e) => {
  if (!e.target.closest('.ann__save')) return;
  const panel = e.target.closest('.annopanel');
  const key = panel.dataset.key;
  const payload = {
    key,
    purpose: panel.querySelector('.ann__purpose-in').value.trim(),
    project: panel.querySelector('.ann__project-in').value.trim(),
    status: panel.querySelector('.ann__status-in').value,
  };
  try {
    const res = await api('PUT', '/api/annotations', payload);
    REG.annotations = REG.annotations || {};
    if (!payload.purpose && !payload.project && !payload.status) delete REG.annotations[key];
    else REG.annotations[key] = res.value;
    renderDetailInfo();
    renderStats();
    renderMetafields();
    renderMetaobjects();
    toast('已保存标注');
  } catch (err) {
    toast(err.message, false);
  }
});

async function loadRegistry(refresh) {
  const btn = $('#reg-refresh');
  btn.disabled = true;
  $('#reg-status').textContent = refresh ? '正在重新读取定义并扫描主题…' : '加载中…';
  try {
    const d = await api('GET', '/api/registry' + (refresh ? '?refresh=1' : ''));
    REG = d;
    if (refresh) { dataCache.clear(); state.metafields.page = 1; state.metaobjects.page = 1; }
    const when = new Date(d.generatedAt).toLocaleString();
    const theme = d.themeScanned
      ? `主题「${d.theme.name}」已扫 ${d.theme.fileCount} 个文件`
      : `⚠️ 主题未扫描(${d.themeScanError || '缺 read_themes 权限'})`;
    $('#reg-status').textContent = `${d.shop} · ${when}${d.cached ? ' · 缓存' : ' · 刚刷新'} · ${theme}`;
    renderStats();
    renderMetafields();
    renderMetaobjects();
    if (refresh) toast('总账已刷新');
  } catch (e) {
    $('#reg-status').textContent = '出错: ' + e.message;
    toast(e.message, false);
  } finally {
    btn.disabled = false;
  }
}

$('#reg-refresh').addEventListener('click', () => loadRegistry(true));
['#mf-search', '#mf-owner', '#mf-source', '#mf-usage', '#mf-size'].forEach((s) =>
  $(s).addEventListener('input', () => { state.metafields.page = 1; if (REG) renderMetafields(); }));
['#mo-search', '#mo-source', '#mo-usage', '#mo-size'].forEach((s) =>
  $(s).addEventListener('input', () => { state.metaobjects.page = 1; if (REG) renderMetaobjects(); }));

loadRegistry(false);
