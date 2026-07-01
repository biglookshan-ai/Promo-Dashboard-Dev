const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

function checkBlock(title, items, render, tone) {
  const n = items.length;
  const cls = n ? (tone || 'warn') : 'ok';
  const body = n
    ? `<ul class="chklist">${items.slice(0, 200).map(render).join('')}</ul>${n > 200 ? `<p class="muted">…共 ${n} 项,仅显示前 200</p>` : ''}`
    : `<p class="muted">无</p>`;
  return `<details class="chk ${cls}" ${n ? 'open' : ''}>
    <summary><span class="chk__badge">${n}</span> ${esc(title)}</summary>
    <div class="chk__body">${body}</div></details>`;
}

function table(rows, cols) {
  if (!rows.length) return '<p class="muted">无条目</p>';
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${cols.map((c) => `<td>${esc(c.get(r))}</td>`).join('')}</tr>`
  ).join('');
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function render(d) {
  const c = d.counts;
  const mf = Object.entries(c.metafields || {}).map(([k, v]) => card('custom.' + k, v)).join('');
  $('#overview').innerHTML =
    card('活动/体验条目', c.activityEntries) +
    card('促销条目', c.promotionEntries) +
    card('扫描产品', c.productsScanned) +
    card('带促销 metafield 产品', c.productsWithPromoMetafields) +
    mf;

  const ck = d.checks;
  $('#checks').innerHTML =
    checkBlock('孤儿倒计时 — 有时间字段但没挂任何活动引用（迁移/清理目标）', ck.orphanTimers,
      (h) => `<li><b>${esc(h.title)}</b> <span class="muted">${esc(h.handle)}</span> — ${esc(Object.entries(h.mf).map(([k, v]) => k + '=' + v).join(' · '))}</li>`, 'danger') +
    checkBlock('双向漂移 — 活动列表里有该产品,但产品端缺反向引用', ck.missingReverse,
      (m) => `<li>${esc(m.gid.split('/').pop())} ← ${esc(m.labels.join(', '))}</li>`) +
    checkBlock('反向漂移 — 产品端有引用,但不在任何活动列表', ck.refButNotListed,
      (h) => `<li><b>${esc(h.title)}</b> <span class="muted">${esc(h.handle)}</span></li>`) +
    checkBlock('没有起止日期的活动', ck.noDates,
      (h) => `<li>${esc(h)}</li>`) +
    checkBlock('已过期但仍标记 active 的活动', ck.expiredActive,
      (e) => `<li>${esc(e.handle)} <span class="muted">end: ${esc(e.end)}</span></li>`, 'danger');

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

  $('#result').hidden = false;
}

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
