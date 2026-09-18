// 元数据总账前端。复用 app.js 里的 $ / $$ / esc / api / toast / linkOut 等全局帮手
// (app.js 先加载,顶层 const 在全局词法作用域里,这里直接用)。

let REG = null;

// ---- 顶层大板块切换:总账 / 促销盘点 ----
$$('#toptabs .toptab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.section;
    $$('#toptabs .toptab').forEach((b) => b.classList.toggle('is-active', b === btn));
    $$('.section').forEach((p) => p.classList.toggle('is-active', p.id === 'section-' + s));
    if (s === 'promo') window.loadPromoOnce();   // 切过去才扫,别拖慢总账
  });
});

const annotationOf = (key) => (REG.annotations && REG.annotations[key]) || {};

// 主题命中:显示「主题在用」+ 文件:行号(悬停看代码片段)
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

function mfRow(r) {
  const count = r.dataCount == null ? '—' : r.dataCount;
  return `<tr class="${r.stale ? 'row--stale' : ''}">
    <td>
      <b>${esc(r.name)}</b>
      ${r.stale ? '<span class="tag tag--danger">疑似废弃</span>' : ''}
      <div class="muted mono">${esc(r.full)}</div>
    </td>
    <td><span class="tag">${esc(r.ownerLabel)}</span></td>
    <td class="mono">${esc(r.type)}</td>
    <td class="num"><b>${count}</b></td>
    <td>${esc(r.source)}<div class="muted">${esc(r.ownerGuess)}</div></td>
    <td>${themeCell(r)}</td>
    <td>${annCell(r.annotationKey)}</td>
  </tr>`;
}

function moRow(r) {
  const count = r.entryCount == null ? '—' : r.entryCount;
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
    <td class="num"><b>${count}</b></td>
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

  // 下拉筛选项
  const owners = REG.ownerTypes.map((o) => `<option value="${esc(o.type)}">${esc(o.label)}</option>`).join('');
  $('#reg-owner').innerHTML = `<option value="">全部资源类型</option>${owners}<option value="METAOBJECT">仅 Metaobject</option>`;
  const sources = [...new Set([...mf.map((r) => r.source)])].sort();
  $('#reg-source').innerHTML = `<option value="">全部来源</option>` +
    sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}

// ---- 标注编辑(事件委托,表格重绘也不会失效) ----
$('#registry').addEventListener('click', (e) => {
  const editBtn = e.target.closest('.ann__edit');
  if (editBtn) return openEditor(editBtn.closest('.ann'));
  const saveBtn = e.target.closest('.ann__save');
  if (saveBtn) return saveEditor(saveBtn.closest('.ann'));
  const cancelBtn = e.target.closest('.ann__cancel');
  if (cancelBtn) { renderRegistry(); }
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

// 打开 app 默认进总账
loadRegistry(false);
