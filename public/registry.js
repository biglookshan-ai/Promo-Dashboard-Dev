// 元数据总账前端。复用 app.js 里的 $ / $$ / esc / api / toast / card 等全局帮手
// (app.js 先加载,顶层 const 在全局词法作用域里,这里直接用)。
// 注意:不要用 app.js 里的 adminBase/productAdminUrl —— 那几个读的是促销模块的
// DATA,促销没加载时是 null。总账用下面这套自己的。

let REG = null;
const detailCache = new Map(); // 明细页缓存,来回切不重复请求

// 老版本缓存里没有 store 字段,从 shop 兜底推导,别让深链把整页打挂。
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

// ---- 板块切换 ----
function showSection(name) {
  $$('.section').forEach((p) => p.classList.toggle('is-active', p.id === 'section-' + name));
  $$('#toptabs .toptab').forEach((b) => b.classList.toggle('is-active', b.dataset.section === name));
  window.scrollTo(0, 0);
}
$$('#toptabs .toptab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.section;
    showSection(s);
    if (s === 'promo') window.loadPromoOnce();   // 切过去才扫,别拖慢总账
  });
});
$('#detail-back').addEventListener('click', () => showSection('registry'));

const annotationOf = (key) => (REG.annotations && REG.annotations[key]) || {};

function themeCell(row) {
  if (row.themeUsage === null) return '<span class="muted">未扫描</span>';
  if (!row.themeUsage.length) return '<span class="tag">主题未引用</span>';
  const files = [...new Set(row.themeUsage.map((h) => h.file))];
  const list = row.themeUsage
    .slice(0, 12)
    .map((h) => `<li><code>${esc(h.file)}:${h.line}</code><div class="snip">${esc(h.snippet)}</div></li>`)
    .join('');
  return `<details class="usage">
    <summary><span class="tag tag--ok">主题在用 · ${files.length} 个文件</span></summary>
    <ul class="usagelist">${list}</ul>
  </details>`;
}

function annCell(key) {
  const a = annotationOf(key);
  const status = a.status || '';
  const statusCls = status === '已废弃' || status === '待废弃' ? 'tag--danger'
    : status === '在用' ? 'tag--ok' : status ? 'tag--warn' : '';
  return `<div class="ann" data-key="${esc(key)}">
    <div class="ann__view">
      ${a.purpose ? `<div class="ann__purpose">${esc(a.purpose)}</div>` : '<div class="muted">未标注用途</div>'}
      ${a.project ? `<span class="tag">${esc(a.project)}</span>` : ''}
      ${status ? `<span class="tag ${statusCls}">${esc(status)}</span>` : ''}
      <button class="linkbtn ann__edit" type="button">${a.purpose || a.project || status ? '编辑' : '标注'}</button>
    </div>
  </div>`;
}

// 「有数据」单元格:数量 + 点进独立明细页
function countCell(count, attrs) {
  if (count == null) return '<span class="muted">—</span>';
  if (count === 0) return '<b>0</b>';
  return `<b>${count}</b><br><button class="linkbtn drill" ${attrs} type="button">查看明细 →</button>`;
}

function mfRow(r) {
  const attrs = `data-kind="mf" data-owner="${esc(r.ownerType)}" data-ns="${esc(r.namespace)}"`
    + ` data-key="${esc(r.key)}" data-name="${esc(r.name)}" data-full="${esc(r.full)}"`
    + ` data-type="${esc(r.type)}" data-ownerlabel="${esc(r.ownerLabel)}"`
    + ` data-expected="${r.dataCount ?? 0}"`;
  return `<tr class="${r.stale ? 'row--stale' : ''}">
    <td>
      <b>${esc(r.name)}</b>
      ${r.stale ? '<span class="tag tag--danger">疑似废弃</span>' : ''}
      <div class="muted mono">${esc(r.full)}</div>
    </td>
    <td><span class="tag">${esc(r.ownerLabel)}</span></td>
    <td class="mono">${esc(r.type)}</td>
    <td class="num">${countCell(r.dataCount, attrs)}</td>
    <td>${esc(r.source)}<div class="muted">${esc(r.ownerGuess)}</div></td>
    <td>${themeCell(r)}</td>
    <td>${annCell(r.annotationKey)}</td>
  </tr>`;
}

function moRow(r) {
  const attrs = `data-kind="mo" data-type="${esc(r.type)}" data-name="${esc(r.name)}"`;
  const by = r.createdByApp
    ? `<span class="tag tag--ok">App: ${esc(r.createdByApp)}</span>`
    : (r.createdByStaff ? `<span class="tag">人工: ${esc(r.createdByStaff)}</span>` : '<span class="muted">未知</span>');
  return `<tr class="${r.stale ? 'row--stale' : ''}">
    <td>
      <b>${esc(r.name)}</b>
      ${r.stale ? '<span class="tag tag--danger">疑似废弃</span>' : ''}
      <div class="muted mono">${esc(r.type)}</div>
    </td>
    <td class="num">${r.fieldCount}</td>
    <td class="num">${countCell(r.entryCount, attrs)}</td>
    <td>${by}</td>
    <td>${themeCell(r)}</td>
    <td>${annCell(r.annotationKey)}</td>
  </tr>`;
}

function renderRegistry() {
  const q = ($('#reg-search').value || '').trim().toLowerCase();
  const owner = $('#reg-owner').value;
  const source = $('#reg-source').value;
  const staleOnly = $('#reg-stale').checked;

  const match = (r, hay) => {
    if (staleOnly && !r.stale) return false;
    if (source && r.source !== source) return false;
    if (!q) return true;
    const a = annotationOf(r.annotationKey);
    return (hay + ' ' + (a.purpose || '') + ' ' + (a.project || '')).toLowerCase().includes(q);
  };

  const mfs = REG.metafields.filter((r) => (!owner || r.ownerType === owner) && match(r, `${r.name} ${r.full}`));
  const mos = REG.metaobjects.filter((r) => (!owner || owner === 'METAOBJECT') && match(r, `${r.name} ${r.type}`));
  $('#reg-count').textContent = `${mfs.length} 个字段 · ${mos.length} 个 metaobject`;

  const mfHead = `<thead><tr>
    <th>字段</th><th>资源</th><th>类型</th><th class="num">有数据</th>
    <th>来源推断</th><th>主题引用</th><th>用途备注（可编辑）</th>
  </tr></thead>`;
  const moHead = `<thead><tr>
    <th>Metaobject</th><th class="num">字段数</th><th class="num">条目</th>
    <th>创建者</th><th>主题引用</th><th>用途备注（可编辑）</th>
  </tr></thead>`;

  $('#registry').innerHTML = `
    <h3>Metafield 定义</h3>
    <div class="tablewrap"><table class="tbl">${mfHead}
      <tbody>${mfs.map(mfRow).join('') || '<tr><td colspan="7" class="muted">无匹配</td></tr>'}</tbody>
    </table></div>
    <h3>Metaobject 定义</h3>
    <div class="tablewrap"><table class="tbl">${moHead}
      <tbody>${mos.map(moRow).join('') || '<tr><td colspan="6" class="muted">无匹配</td></tr>'}</tbody>
    </table></div>`;
}

function renderOverview() {
  const mf = REG.metafields, mo = REG.metaobjects;
  const withData = mf.filter((r) => (r.dataCount || 0) > 0).length;
  const staleCount = mf.filter((r) => r.stale).length + mo.filter((r) => r.stale).length;
  const annotated = Object.keys(REG.annotations || {}).length;
  $('#reg-overview').innerHTML =
    card('Metafield 定义', mf.length) +
    card('其中有数据', withData) +
    card('Metaobject 定义', mo.length) +
    card('疑似废弃', staleCount) +
    card('已标注用途', annotated);

  const owners = REG.ownerTypes.map((o) => `<option value="${esc(o.type)}">${esc(o.label)}</option>`).join('');
  $('#reg-owner').innerHTML = `<option value="">全部资源类型</option>${owners}<option value="METAOBJECT">仅 Metaobject</option>`;
  // 来源下拉要把 metaobject 的来源也算进去,否则选了某个来源会把 metaobject 整表滤空
  const sources = [...new Set([...mf.map((r) => r.source), ...mo.map((r) => r.source)])].filter(Boolean).sort();
  $('#reg-source').innerHTML = `<option value="">全部来源</option>` +
    sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}

// ---- 明细页渲染 ----
function renderMetafieldDetail(d) {
  if (!d.ok) return `<p class="muted">${esc(d.reason)}</p>`;
  if (!d.rows.length) return '<p class="muted">没查到有值的资源</p>';
  const rows = d.rows.map((r) => {
    // linkKind/linkId/linkHandle 由后端算好(变体已指向父产品);
    // 万一拿到的是旧结构 payload,就从 ownerType + id 兜底,别让链接整列消失。
    const kind = r.linkKind || (d.ownerType === 'COLLECTION' ? 'Collection' : 'Product');
    const admin = resourceAdminUrl(kind, r.linkId || r.id);
    const handle = r.linkHandle || r.handle || '';
    const front = handle
      ? `${regFront()}/${kind === 'Collection' ? 'collections' : 'products'}/${handle}`
      : null;
    // 标题本身就是后台链接 —— 直接点产品名进后台,别再单开一列(会被长标题挤出屏幕)
    const title = admin
      ? `<a class="reslink" href="${esc(admin)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
      : `<b>${esc(r.title)}</b>`;
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
  // 实际命中数和总账计数对不上时明说,别让「筛选没生效」这类问题再悄悄混过去
  const mismatch = d.expected && d.count !== d.expected
    ? ` <span class="tag tag--warn">总账计数 ${d.expected},实际命中 ${d.count}</span>` : '';
  return `<p class="muted">命中 ${d.count} 个资源（扫描 ${d.scanned ?? '?'} 个）· 点产品名进后台${mismatch}</p>
    <div class="tablewrap"><table class="tbl tbl--detail">
    <thead><tr><th>资源</th><th>值</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${d.truncated ? '<p class="muted">结果过多,只显示前 500 条</p>' : ''}`;
}

function renderMetaobjectDetail(d) {
  if (!d.ok) return `<p class="muted">${esc(d.reason || '查询失败')}</p>`;
  if (!d.rows.length) return '<p class="muted">这个 metaobject 还没有条目</p>';
  const items = d.rows.map((e) => {
    const fields = e.fields.length
      ? `<dl class="fields">${e.fields.map((f) => `<div class="field"><dt>${esc(f.key)}</dt><dd>${esc(f.value).slice(0, 400)}</dd></div>`).join('')}</dl>`
      : '<p class="muted fields">所有字段为空</p>';
    const refs = e.refs.length
      ? `<ul class="plist">${e.refs.map((r) => {
          const url = resourceAdminUrl(r.kind, r.linkId);
          const title = url
            ? `<a class="reslink" href="${esc(url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
            : `<b>${esc(r.title)}</b>`;
          return `<li>
            <span class="tag">${esc(r.kind)}</span>
            ${title}
            ${r.parentTitle ? `<span class="muted">(${esc(r.parentTitle)})</span>` : ''}
            <span class="muted mono">via ${esc(r.viaField)}</span>
            ${r.handle ? out(`${regFront()}/products/${r.handle}`, '前台', 'lnk--front') : ''}
          </li>`;
        }).join('')}</ul>`
      : '<p class="muted">没有任何资源引用这条 —— 可能是孤儿</p>';
    return `<details class="entry ${e.refCount ? '' : 'entry--orphan'}">
      <summary>
        <b>${esc(e.title)}</b>
        ${e.refCount
          ? `<span class="tag tag--ok">被 ${e.refCount} 处引用</span>`
          : '<span class="tag tag--warn">无引用</span>'}
        <span class="entry__spacer"></span>
        <span class="muted mono">${esc(e.handle)}</span>
        ${out(entryAdminUrlReg(d.type, e.id), '后台')}
      </summary>
      <div class="pctx">
        ${fields}
        <div class="refsec"><div class="refsec__t">被谁引用</div>${refs}</div>
      </div>
    </details>`;
  }).join('');
  return `<div class="entries">${items}</div>${d.truncated ? '<p class="muted">条目过多,只显示前 500 条</p>' : ''}`;
}

async function openDetail(btn) {
  const ds = btn.dataset;
  const isMf = ds.kind === 'mf';
  const cacheKey = isMf ? `mf:${ds.owner}:${ds.ns}.${ds.key}` : `mo:${ds.type}`;

  showSection('detail');
  $('#detail-title').textContent = ds.name || (isMf ? ds.full : ds.type);
  $('#detail-sub').textContent = isMf
    ? `${ds.full} · ${ds.type} · ${ds.ownerlabel}`
    : `metaobject · ${ds.type}`;
  $('#detail-actions').innerHTML = isMf
    ? out(`${regAdmin()}/settings/custom_data`, '定义设置')
    : out(`${regAdmin()}/content/entries/${ds.type}`, '后台条目列表');

  const body = $('#detail-body');
  if (detailCache.has(cacheKey)) { body.innerHTML = detailCache.get(cacheKey); return; }

  body.innerHTML = isMf
    ? '<p class="muted">正在扫描并逐条核对…（命中越少扫得越久,最多几十秒）</p>'
    : '<p class="muted">加载中…</p>';
  try {
    let html;
    if (isMf) {
      const d = await api('GET', `/api/drill/metafield?ownerType=${encodeURIComponent(ds.owner)}`
        + `&namespace=${encodeURIComponent(ds.ns)}&key=${encodeURIComponent(ds.key)}`
        + `&expected=${encodeURIComponent(ds.expected || 0)}`);
      html = renderMetafieldDetail(d);
    } else {
      const d = await api('GET', `/api/drill/metaobject?type=${encodeURIComponent(ds.type)}`);
      html = renderMetaobjectDetail(d);
    }
    detailCache.set(cacheKey, html);
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<p class="muted">出错: ${esc(e.message)}</p>`;
  }
}

// ---- 事件委托:标注编辑 + 进明细页(表格重绘也不失效) ----
$('#registry').addEventListener('click', (e) => {
  const drillBtn = e.target.closest('.drill');
  if (drillBtn) return openDetail(drillBtn);
  const editBtn = e.target.closest('.ann__edit');
  if (editBtn) return openEditor(editBtn.closest('.ann'));
  const saveBtn = e.target.closest('.ann__save');
  if (saveBtn) return saveEditor(saveBtn.closest('.ann'));
  if (e.target.closest('.ann__cancel')) renderRegistry();
});

function openEditor(box) {
  const key = box.dataset.key;
  const a = annotationOf(key);
  const opts = ['', '在用', '待确认', '待废弃', '已废弃']
    .map((s) => `<option value="${s}" ${s === (a.status || '') ? 'selected' : ''}>${s || '(未设状态)'}</option>`)
    .join('');
  box.innerHTML = `<div class="ann__edit-form">
    <input class="ann__purpose-in" placeholder="用途:这个字段干什么的" value="${esc(a.purpose || '')}" />
    <input class="ann__project-in" placeholder="归属项目,如 Setup Kit / 搜索引擎" value="${esc(a.project || '')}" />
    <select class="ann__status-in">${opts}</select>
    <button class="btn btn-sm btn-primary ann__save" type="button">保存</button>
    <button class="btn btn-sm ann__cancel" type="button">取消</button>
  </div>`;
  box.querySelector('.ann__purpose-in').focus();
}

async function saveEditor(box) {
  const key = box.dataset.key;
  const payload = {
    key,
    purpose: box.querySelector('.ann__purpose-in').value.trim(),
    project: box.querySelector('.ann__project-in').value.trim(),
    status: box.querySelector('.ann__status-in').value,
  };
  try {
    const res = await api('PUT', '/api/annotations', payload);
    REG.annotations = REG.annotations || {};
    if (!payload.purpose && !payload.project && !payload.status) delete REG.annotations[key];
    else REG.annotations[key] = res.value;
    renderOverview();
    renderRegistry();
    toast('已保存标注');
  } catch (e) {
    toast(e.message, false);
  }
}

async function loadRegistry(refresh) {
  const btn = $('#reg-refresh');
  btn.disabled = true;
  $('#reg-status').textContent = refresh ? '正在重新读取定义并扫描主题…' : '加载中…';
  try {
    const d = await api('GET', '/api/registry' + (refresh ? '?refresh=1' : ''));
    REG = d;
    if (refresh) detailCache.clear();
    const when = new Date(d.generatedAt).toLocaleString();
    const themeBit = d.themeScanned
      ? `主题「${d.theme.name}」已扫 ${d.theme.fileCount} 个文件`
      : `⚠️ 主题未扫描(${d.themeScanError || '缺 read_themes 权限'})`;
    $('#reg-status').textContent = `${d.shop} · 数据时间 ${when}${d.cached ? ' · 缓存' : ' · 刚刷新'} · ${themeBit}`;
    renderOverview();
    renderRegistry();
    $('#reg-result').hidden = false;
    if (refresh) toast('总账已刷新');
  } catch (e) {
    $('#reg-status').textContent = '出错: ' + e.message;
    toast(e.message, false);
  } finally {
    btn.disabled = false;
  }
}

$('#reg-refresh').addEventListener('click', () => loadRegistry(true));
['#reg-search', '#reg-owner', '#reg-source', '#reg-stale'].forEach((sel) =>
  $(sel).addEventListener('input', () => REG && renderRegistry())
);

loadRegistry(false);
