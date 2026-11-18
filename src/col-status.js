// Shopify 后台 Collection 页面上的「产品排序」卡片(2026-11-18 用户:在每个 Collection 的后台页面提示排序有没有被 app 接管,能一键去 app)。
// 纯函数:排期数据 + 这个 Collection 在店里的排序设置 → 卡片要画的东西。
// ★ 文字都在服务器这边拼好,卡片扩展只负责画 —— 以后排序逻辑 / 说法改了只改这里,不用重新部署扩展。
// 时间写成 {{t:毫秒}},卡片按看的人电脑的时区显示(和 app 页面一样)。
// 按钮的 path 是 app 里的网址(schedule.js 的 cgpNav.open 认的那几种),卡片里变成 app:<path> 打开。
//
// 叫法(2026-11-18 用户定,第四版):
//   · 排序计划 = app 里排好、按时间生效的那份;后台排序 = Shopify 后台 Collection 里的顺序
//   · 角标两种 = 网站前台现在按哪个显示:APP 排序生效中(有排序计划在网站上生效)/ 后台排序生效中
//   · 同步状态 = 后台顺序和排序计划一致吗(网站听谁的由角标说,别重复):
//       已同步 / 同步中 / 同步中断(本来同步了,被后台接管)/ 未设置同步(后台不是手动,app 改不了后台 → 给「一键同步」)/
//       已设置同步(后台是手动,当前没有计划)/ 同步已关闭(选了保留后台排序)/ 未同步(其他原因)/ 还原中
//   · 排序计划一行带状态:生效中(绿)/ 网站上暂停(黄)/ 已排期(蓝)/ 已结束(灰)
//   · 网站显示按位置分段(第 1–3 位 排序计划指定的 3 个 / 第 4–15 位 后台顺序 / 第 16 位起 上架时间新到旧)—— 用户:箭头读起来像一步一步,其实是叠起来的几块
// 每一行:{ label, value(纯文字,老卡片用), tone?, parts?(一行里分段上色), segs?(网站显示的分段) }
import { itemStatus, campaignIndex, effectiveWindow } from './schedule-core.js';
import { sortCn, DEFAULT_N } from './col-sort.js';

const nid = (x) => String(x ?? '').split('/').pop();
const T = (ms) => `{{t:${ms}}}`;
const DAY = 86400_000;
const FRONT_MAX = 50;   // 网站那一层:Liquid 一次只读得到排序计划 / 不显示列表的前 50 个
const MAX_REMOVE = 100; // 和 collection-order.js 一样:要临时移出超过这么多,就不改后台顺序
const PLAN_TONE = { '生效中': { tone: 'success' }, '网站上暂停': { tone: 'warning' }, '已排期': { tone: 'info' }, '已结束': { color: 'subdued' } };

// 网站显示:按位置分段。total = 这一页大概有几个产品(知道就截掉用不上的段)
export function siteSegs({ plan = 0, onlyListed = false, off = false, manual = true, sortName = '手动', n = DEFAULT_N, pinNew = 0, total = null }) {
  const segs = [];
  const range = (a, b) => (a === b ? `第 ${a} 位` : `第 ${a}–${b} 位`);
  const push = (a, b, v, tone) => { // b = null:从 a 往后全部
    if (total != null && a > total) return;
    const end = b != null && total != null ? Math.min(b, total) : b;
    segs.push({ k: end == null ? (a === 1 ? '全部' : `第 ${a} 位起`) : range(a, end), v, ...(tone ? { tone } : {}) });
  };
  let pos = 1;
  if (plan > 0) {
    push(1, plan, `排序计划指定的 ${plan} 个`, 'success');
    if (onlyListed) { segs.push({ k: '其余', v: '这段时间不显示' }); return segs; }
    pos = plan + 1;
  }
  const src = manual ? '后台顺序' : `后台「${sortName}」顺序`;
  if (off) { push(pos, null, src); return segs; }
  if (n <= 0 && !(pinNew > 0)) { push(pos, null, '上架时间新到旧'); return segs; }
  if (pinNew > 0) { push(pos, pos + pinNew - 1, `最新上架的 ${pinNew} 个`); pos += pinNew; }
  if (n > 0) { push(pos, pos + n - 1, src); pos += n; }
  push(pos, null, '上架时间新到旧');
  return segs;
}

// col = readColSort 的一行:{ id, title, sortOrder, off, pinManual, pinNew, count }
export function colCard(state, col, now = Date.now()) {
  const cid = nid(col.id);
  const camps = campaignIndex(state.campaigns || []);
  const mine = (state.pins || []).filter((p) => p?.collection && nid(p.collection.id) === cid);
  const stOf = (p) => itemStatus(p, camps, now);
  const win = (p) => effectiveWindow(p, camps);
  // 这一刻生效的:开始最晚的那份赢,一样的话列表里靠前的赢(和 collection-order.js 的 livePins、主题一致)
  let live = null;
  for (const p of mine) if (stOf(p) === 'live' && (!live || (win(p).start ?? 0) > (win(live).start ?? 0))) live = p;
  const next = mine.filter((p) => stOf(p) === 'scheduled').sort((a, b) => (win(a).start ?? 0) - (win(b).start ?? 0))[0] || null;
  const cs = (state.colState || {})[cid] || null;
  const sf = (state.sortFlags || {})[cid] || null; // 排序计划勾了「完全按本次排序」:生效期间店里 cgp_sort_off 临时是 true
  const manual = col.sortOrder === 'MANUAL';
  const sortName = sortCn(col.sortOrder);
  // 平时的排法(Collection 默认设置):临时改着的时候,平时的值在 flag.prev
  const usual = sf ? { ...col, off: sf.prev?.value === 'true' } : col;
  const n = usual.pinManual ?? DEFAULT_N;
  const off = !!sf || !!usual.off; // 这一刻店里的 cgp_sort_off(计划开了「完全按本次排序」= 临时完全按后台)

  const nm = (name) => (name && name !== '未命名' ? name : '未命名');
  const until = (p) => (win(p).end != null ? `到 ${T(win(p).end)}` : '长期');
  const btn = (label, path, primary) => (path ? { label, path, ...(primary ? { primary: true } : {}) } : null);
  const pinPath = (id) => (id && mine.some((p) => p.id === id) ? `/pins/${id}` : null);
  const B = {
    settings: btn('排序设置', `/pins/collection/${cid}`),
    newPin: btn('新建排序计划', `/pins/new/${cid}`),
    list: btn('去 app 处理', '/pins'),
    sync: btn('一键同步', `/pins/collection/${cid}/sync`, true),
  };
  const row = (label, value, tone) => (value ? { label, value, ...(tone ? { tone } : {}) } : null);
  // 排序计划:名字 · 时间 + 彩色状态
  const planRow = (text, status) => ({ label: '排序计划', value: `${text}(${status})`, parts: [{ t: text }, { t: `(${status})`, ...PLAN_TONE[status] }] });
  const siteRow = (list) => { const segs = list.length ? list : [{ k: '—', v: '这个 Collection 现在没有产品' }]; return { label: '网站显示', value: segs.map((s) => `${s.k} ${s.v}`).join(';'), segs }; };
  const base = () => siteSegs({ off, manual, sortName, n, pinNew: usual.pinNew || 0, total: col.count ?? null });
  const sortRow = row('后台排序方式', sortName);
  const out = (appOn, rows, buttons) => {
    const rs = rows.filter(Boolean);
    return {
      heading: '产品排序',
      badge: appOn ? { text: 'APP 排序生效中', tone: 'success' } : { text: '后台排序生效中', tone: 'neutral' },
      rows: rs,
      lines: rs.map((r) => ({ text: `${r.label}:${r.value}`, ...(r.tone ? { tone: r.tone } : {}) })), // 11/18 第一版卡片只认 lines,新卡片部署后可以删
      buttons: buttons.filter(Boolean),
      collection: { id: cid, title: col.title }, at: now,
    };
  };
  const HANDLE = row('注意', '需在 app 里选「按本次排序」或「保留后台排序」', 'warning');
  const broken = (h) => row('同步状态', h === 'rollback' ? '同步中断(回滚过,待处理)' : '同步中断(被后台接管,待处理)', 'warning');

  // ── 没有排序计划在网站上生效 ──
  if (!live || (cs?.restoring && cs.pinId !== live.id)) {
    if (cs?.hold) { // 被后台接管后计划已经结束、还没人处理(collection-order 不会自己还原)
      return out(false, [broken(cs.hold), planRow(nm(cs.pinName), '已结束'), sortRow, siteRow(base()), HANDLE], [B.list, B.settings]);
    }
    if (cs?.restoring) {
      return out(false, [row('同步状态', '还原中', 'info'), planRow(nm(cs.pinName), '已结束'), sortRow, siteRow(base()),
        row('注意', '一般 1–2 分钟内还原成排序计划之前的顺序')], [B.settings]);
    }
    return out(false, [
      manual ? row('同步状态', '已设置同步(当前没有排序计划)', 'success') : row('同步状态', '未设置同步(保留后台排序)'),
      next ? planRow(`无 · 下一份 ${nm(next.name)} ${T(win(next).start)} 开始`, '已排期') : row('排序计划', '无'),
      sortRow,
      siteRow(base()),
      manual && !off ? row('注意', n > 0 ? `后台拖动只影响前 ${n} 个` : '后台拖动不影响网站(全部按上架时间新到旧)', 'caution') : null,
    ], manual ? [B.settings, B.newPin] : [B.sync, B.settings]);
  }

  // ── 有排序计划在生效 ──
  const k = (live.products || []).filter(Boolean).length;
  const hidden = (live.hidden || []).filter(Boolean).length;
  const pinBtn = btn('打开这份排序计划', `/pins/${live.id}`);
  const plan = `${nm(live.name)} · ${until(live)}`;
  const mineNow = cs && cs.pinId === live.id;

  // 选过「保留后台排序」:app 不再排,网站上也暂停这份计划(schedule-core pinFrontPaused)
  if (mineNow && cs.released) {
    return out(false, [row('同步状态', '同步已关闭(保留后台排序)'), planRow(plan, '网站上暂停'), sortRow, siteRow(base()),
      row('注意', '结束时后台顺序不还原,只复原临时加进 / 移出的产品')], [B.list, pinBtn]);
  }
  // 本来同步了,被后台接管(有人在后台改了顺序 / 回滚过):app 暂停,网站上也暂停这份计划、先按后台顺序;点「按本次排序」才恢复
  if (mineNow && cs.hold) {
    return out(false, [broken(cs.hold), planRow(plan, '网站上暂停'), sortRow, siteRow(base()), HANDLE], [B.list, pinBtn]);
  }

  // 网站上按计划:网站那一层只认前 50 个;app 已经改了后台的不受限
  const shown = mineNow ? k : Math.min(k, FRONT_MAX);
  const total = col.count != null ? Math.max(0, col.count - hidden) : null;
  const site = siteRow(siteSegs({ plan: shown, onlyListed: !!live.onlyListed, off, manual, sortName, n, pinNew: usual.pinNew || 0, total }));
  const counts = (extra) => row('计划产品', [live.onlyListed ? `只显示这 ${k} 个` : `${k} 个`, ...extra].filter(Boolean).join(' · '));

  // app 已经(或马上)把后台排成计划的顺序
  if (mineNow) {
    // signature = app 上一次按这份计划写进后台时记下的;点了「按本次排序」会清掉,等下一分钟重新排完才算同步好
    const sync = cs.pending ? row('同步状态', '同步中(等 Shopify 算完加减的产品)', 'info')
      : !cs.signature ? row('同步状态', '同步中(1 分钟内)', 'info') : row('同步状态', '已同步', 'success');
    return out(true, [sync, planRow(plan, '生效中'), sortRow, site,
      counts([cs.removed?.length ? `临时移出 ${cs.removed.length} 个` : '', cs.added?.length ? `临时加进 ${cs.added.length} 个` : '']),
      row('注意', '计划生效期间在后台拖动,app 会暂停同步', 'caution')], [pinBtn, B.settings]);
  }

  // 后台和计划不一样,网站按计划(后台不是手动 / 没权限 / 要移出太多 / 刚保存还没执行)
  const removeN = hidden + (live.onlyListed && col.count != null ? Math.max(0, col.count - k) : 0);
  const sync = !manual ? row('同步状态', '未设置同步(保留后台排序)')
    : state.colNoScope && now - state.colNoScope < DAY ? row('同步状态', '未同步(app 没有改 Collection 的权限)')
      : removeN > MAX_REMOVE ? row('同步状态', `未同步(要临时移出超过 ${MAX_REMOVE} 个产品,只在网站上排)`)
        : row('同步状态', '同步中(1 分钟内)', 'info');
  return out(true, [sync, planRow(plan, '生效中'), sortRow, site, counts([hidden ? `不显示 ${hidden} 个` : '']),
    k > FRONT_MAX ? row('注意', `网站只认计划的前 ${FRONT_MAX} 个`) : null,
  ], manual ? [pinBtn, B.settings] : [B.sync, pinBtn]);
}
