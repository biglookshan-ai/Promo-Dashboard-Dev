const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let DATA = null; // last inventory result, for tab re-render + filters

// ---- Shopify deep links ----
const adminBase = () => `https://admin.shopify.com/store/${DATA.store.handle}`;
const productAdminUrl = (id) => `${adminBase()}/products/${id}`;
const productFrontUrl = (handle) => `${DATA.store.storefrontUrl.replace(/\/$/, '')}/products/${handle}`;
const entryAdminUrl = (type, id) => `${adminBase()}/content/entries/${type}/${id}`;
const linkOut = (href, text, cls = '') => `<a class="lnk ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} <span class="lnk__i">↗</span></a>`;
const prodLinks = (p) => `${linkOut(productAdminUrl(p.id), '后台')}${linkOut(productFrontUrl(p.handle), '前台', 'lnk--front')}`;

async function sessionToken() {
  if (!window.shopify || !window.shopify.idToken) throw new Error('请在 Shopify 后台里打开此 app(嵌入式)');
  return await window.shopify.idToken();
}
async function api(method, path, body) {
  const t = await sessionToken();
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + (ok ? 'ok' : 'err');
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 4000);
}

function card(label, value, tone) {
  return `<div class="card ${tone || ''}"><div class="card__val">${esc(value)}</div><div class="card__lbl">${esc(label)}</div></div>`;
}

// A priority "fix" block: colored left border, headline, what-to-do note, body.
function fixBlock({ pri, tone, count, title, note, body }) {
  return `<section class="fix ${tone}">
    <div class="fix__head">
      <span class="fix__pri">${esc(pri)}</span>
      <span class="fix__badge">${count}</span>
      <span class="fix__title">${esc(title)}</span>
    </div>
    ${note ? `<p class="fix__note">建议动作：${esc(note)}</p>` : ''}
    <div class="fix__body">${body || '<p class="muted">无</p>'}</div>
  </section>`;
}
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—');
function prodList(items, render) {
  return `<ul class="plist">${items.slice(0, 300).map(render).join('')}</ul>${items.length > 300 ? `<p class="muted">…共 ${items.length} 项,仅显示前 300</p>` : ''}`;
}

function table(rows, cols) {
  if (!rows.length) return '<p class="muted">无条目</p>';
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${cols.map((c) => `<td>${esc(c.get(r))}</td>`).join('')}</tr>`
  ).join('');
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- 种类目录 view ----
function renderCatalog(d) {
  const mo = d.catalog.metaobjects.map((m) => {
    const unusedRows = m.entries.filter((e) => !e.inUse);
    const usedRows = m.entries.filter((e) => e.inUse);
    const row = (e) => `<tr class="${e.inUse ? '' : 'row--unused'}">
      <td><b>${esc(e.title || e.handle)}</b><div class="muted">${esc(e.handle)}</div></td>
      <td class="num">${e.ownProducts}</td>
      <td class="num">${e.refByProducts}</td>
      <td>${e.inUse ? '<span class="tag tag--ok">在用</span>' : '<span class="tag tag--danger">未使用 · 可删</span>'}</td>
      <td>${linkOut(entryAdminUrl(m.type, e.id), '打开')}</td>
    </tr>`;
    return `<div class="catcard">
      <div class="catcard__head">
        <b>${esc(m.label)}</b> <span class="muted">${esc(m.type)}</span>
        <span class="pill">共 ${m.total}</span>
        <span class="pill pill--ok">在用 ${m.inUse}</span>
        <span class="pill ${m.unused ? 'pill--danger' : ''}">未使用 ${m.unused}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>条目</th><th class="num">列表内产品</th><th class="num">被产品引用</th><th>状态</th><th>链接</th></tr></thead>
        <tbody>${[...usedRows, ...unusedRows].map(row).join('') || '<tr><td colspan="5" class="muted">无条目</td></tr>'}</tbody>
      </table>
    </div>`;
  }).join('');

  const pm = d.catalog.productMetafields.map((f) => {
    const timeCells = f.isTime && f.valid != null
      ? `<span class="tag tag--ok">有效 ${f.valid}</span> <span class="tag tag--danger">过期 ${f.expired}</span>`
      : (f.isTime ? '<span class="muted">时间字段</span>' : '');
    return `<tr>
      <td><b>${esc(f.name)}</b><div class="muted">custom.${esc(f.key)}</div></td>
      <td>${esc(f.type)}</td>
      <td class="num">${f.productCount}</td>
      <td>${timeCells}</td>
    </tr>`;
  }).join('');

  $('#catalog').innerHTML = `
    <h3>Metaobject 定义</h3>${mo}
    <h3>产品 Metafield 定义</h3>
    <div class="tablewrap"><table class="tbl">
      <thead><tr><th>字段</th><th>类型</th><th class="num">应用产品数</th><th>时间有效性</th></tr></thead>
      <tbody>${pm}</tbody></table></div>`;
}

// ---- 按产品 view (with filters) ----
function renderProducts() {
  const d = DATA;
  const onlyExpired = $('#filter-expired').checked;
  const q = ($('#prod-search').value || '').trim().toLowerCase();
  let rows = d.byProduct;
  if (onlyExpired) rows = rows.filter((p) => p.expired);
  if (q) rows = rows.filter((p) => (p.title + ' ' + p.handle).toLowerCase().includes(q));
  $('#prod-count').textContent = `${rows.length} / ${d.byProduct.length} 个产品`;

  const chip = (t, cls) => `<span class="tag ${cls || ''}">${esc(t)}</span>`;
  const body = rows.map((p) => {
    const promo = p.promos.length ? p.promos.map((h) => chip(h)).join(' ') : '';
    const act = p.activity.length ? p.activity.map((h) => chip('活动:' + h)).join(' ') : '';
    const time = p.end
      ? `${fmtDate(p.start) !== '—' ? fmtDate(p.start) + ' → ' : ''}${fmtDate(p.end)} ${p.expired ? chip('已过期', 'tag--danger') : chip('有效', 'tag--ok')}`
      : (p.start ? fmtDate(p.start) + ' →' : '<span class="muted">—</span>');
    return `<tr class="${p.expired ? 'row--exp' : ''}">
      <td><b>${esc(p.title)}</b><div class="muted">${esc(p.handle)}</div></td>
      <td>${promo || act || '<span class="muted">—</span>'}</td>
      <td>${time}</td>
      <td class="nowrap">${prodLinks(p)}</td>
    </tr>`;
  }).join('');
  $('#products').innerHTML = `<table class="tbl">
    <thead><tr><th>产品</th><th>促销 / 活动引用</th><th>限时倒计时</th><th>链接</th></tr></thead>
    <tbody>${body || '<tr><td colspan="4" class="muted">无匹配</td></tr>'}</tbody></table>`;
}

function render(d) {
  DATA = d;
  const c = d.counts;
  const mf = Object.entries(c.metafields || {}).map(([k, v]) => card('custom.' + k, v)).join('');
  $('#overview').innerHTML =
    card('活动/体验条目', c.activityEntries) +
    card('促销条目', c.promotionEntries) +
    card('扫描产品', c.productsScanned) +
    card('带促销 metafield 产品', c.productsWithPromoMetafields) +
    mf;

  const ck = d.checks;
  const groups = (d.groups && d.groups.orphanGroups) || [];

  // P1 — orphan countdown timers, grouped by shared window (= likely one campaign).
  const orphanBody = groups.length
    ? groups.map((g) => {
        const expired = g.expired;
        const label = `${g.start ? fmtDate(g.start) + ' → ' : '到期 '}${fmtDate(g.end)}`;
        return `<details class="grp ${expired ? 'grp--exp' : ''}">
          <summary>
            <span class="grp__count">${g.products.length}</span>
            <span class="grp__win">${esc(label)}</span>
            ${expired ? '<span class="tag tag--danger">已过期 · 应清理</span>' : '<span class="tag">同一时间窗 · 可归入一个活动</span>'}
          </summary>
          ${prodList(g.products, (p) => `<li><b>${esc(p.title)}</b> <span class="muted">${esc(p.handle)}</span></li>`)}
        </details>`;
      }).join('')
    : '<p class="muted">无</p>';
  const p1 = fixBlock({
    pri: 'P1', tone: 'danger', count: ck.orphanTimers.length,
    title: '限时倒计时在裸奔 — 有到期时间但没挂任何活动',
    note: '每一组共享同一时间窗,基本就是同一场活动。为每组建一个促销活动,把这些产品批量挂进去、时间搬进活动;过期的组直接清掉时间字段。',
    body: orphanBody,
  });

  // P2 — reference drift (product ↔ metaobject mismatch).
  const driftItems = [
    ...ck.refButNotListed.map((h) => `<li><b>${esc(h.title)}</b> <span class="muted">${esc(h.handle)}</span> → 指向 ${esc((h.targets || []).join(', ') || '?')}<span class="tag">产品端有,活动列表没有</span></li>`),
    ...ck.missingReverse.map((m) => `<li><span class="muted">product ${esc(m.gid.split('/').pop())}</span> ← ${esc(m.labels.join(', '))}<span class="tag">活动列表有,产品端没有</span></li>`),
  ];
  const p2 = fixBlock({
    pri: 'P2', tone: 'warn', count: ck.refButNotListed.length + ck.missingReverse.length,
    title: '产品与活动互指对不上 — 双向引用不同步',
    note: '定「活动为唯一数据源」后跑一次同步引擎即可全部自动修正,无需手动处理。',
    body: driftItems.length ? `<ul class="plist">${driftItems.join('')}</ul>` : '<p class="muted">无</p>',
  });

  // P3 — empty / invalid activity entries.
  const ea = ck.emptyActivities || [];
  const p3 = fixBlock({
    pri: 'P3', tone: 'neutral', count: ea.length,
    title: '空 / 无效的活动条目',
    note: '有内容的补齐日期与产品;纯占位的(0 产品且无日期)直接删除。',
    body: ea.length
      ? `<ul class="plist">${ea.map((e) => `<li><b>${esc(e.title || e.handle)}</b> <span class="muted">${esc(e.handle)}</span> — ${e.productCount} 个产品${e.noDates ? ' · 无日期' : ''}${e.productCount === 0 && e.noDates ? '<span class="tag tag--danger">建议删除</span>' : '<span class="tag">建议补齐</span>'}</li>`).join('')}</ul>`
      : '<p class="muted">无</p>',
  });

  $('#fixes').innerHTML = p1 + p2 + p3;

  $('#act-table').innerHTML = table(d.tables.activity, [
    { label: 'handle', get: (r) => r.handle },
    { label: '标题', get: (r) => r.title },
    { label: 'start', get: (r) => r.start },
    { label: 'end', get: (r) => r.end },
    { label: 'active', get: (r) => r.active },
    { label: '挂载产品数', get: (r) => r.productCount },
  ]);
  $('#promo-table').innerHTML = table(d.tables.promotion, [
    { label: 'handle', get: (r) => r.handle },
    { label: '标题', get: (r) => r.title },
    { label: 'Show in Search', get: (r) => r.search },
    { label: '挂载产品数', get: (r) => r.productCount },
  ]);

  renderCatalog(d);
  renderProducts();
  $('#result').hidden = false;
}

// Tab switching
$$('#tabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    $$('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    $$('.tabpane').forEach((p) => p.classList.toggle('is-active', p.id === 'pane-' + t));
  });
});
// Product filters
$('#filter-expired').addEventListener('change', () => DATA && renderProducts());
$('#prod-search').addEventListener('input', () => DATA && renderProducts());

async function run() {
  const btn = $('#run');
  btn.disabled = true;
  $('#status').textContent = '正在扫描全站产品与 metaobject,请稍候(视产品数量可能需要 10-60 秒)…';
  try {
    const d = await api('GET', '/api/inventory');
    $('#status').textContent = `完成 · 店铺 ${d.shop} · ${new Date(d.generatedAt).toLocaleString()}`;
    render(d);
    toast('盘点完成');
  } catch (e) {
    $('#status').textContent = '出错: ' + e.message;
    toast(e.message, false);
  } finally {
    btn.disabled = false;
  }
}

$('#run').addEventListener('click', run);
