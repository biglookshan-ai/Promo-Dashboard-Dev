// Shopify 后台 Collection 页面上的「CGP 排序」卡片(2026-11-18 用户:在每个 Collection 的后台页面提示排序有没有被 app 接管,能一键去 app)。
// 纯函数:排期数据 + 这个 Collection 在店里的排序设置 → 卡片要画的东西(徽章 / 几行字 / 按钮)。
// ★ 文字都在服务器这边拼好,卡片扩展只负责画 —— 以后排序逻辑 / 说法改了只改这里,不用重新部署扩展。
// 时间写成 {{t:毫秒}},卡片按看的人电脑的时区显示(和 app 页面一样)。
// 按钮的 path 是 app 里的网址(public/nav.js / schedule.js 的 cgpNav.open 认的那几种),卡片里变成 app:<path> 打开。
import { itemStatus, campaignIndex, effectiveWindow } from './schedule-core.js';
import { describe, sortCn, DEFAULT_N } from './col-sort.js';

const nid = (x) => String(x ?? '').split('/').pop();
const T = (ms) => `{{t:${ms}}}`;
const DAY = 86400_000;
const FRONT_MAX = 50;   // 网站前台排序:Liquid 一次只读得到置顶 / 不显示列表的前 50 个
const MAX_REMOVE = 100; // 和 collection-order.js 一样:要临时移出超过这么多,就不改后台顺序

// col = readColSort 的一行:{ id, title, sortOrder, off, pinManual, pinNew }
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
  const sf = (state.sortFlags || {})[cid] || null;
  const manual = col.sortOrder === 'MANUAL';
  // 平时的排法:置顶排序勾了「完全按本次排序」正生效时,店里的 cgp_sort_off 是临时改的,平时的值在 flag.prev
  const usual = sf ? { ...col, off: sf.prev?.value === 'true' } : col;
  const n = usual.pinManual ?? DEFAULT_N;
  const rule = describe(usual);

  // 置顶排序的名字:没起名字(编辑器里留空 = 用 Collection 名)就直接叫「置顶排序」,免得读成「APARO 正在排 APARO」
  const nm = (s) => (s && s !== '未命名' ? `「${s}」` : '');
  const nameOf = (p) => nm(p?.name) || '置顶排序';
  const pinPath = (id) => (mine.some((p) => p.id === id) ? `/pins/${id}` : null);
  const btn = (label, path) => (path ? { label, path } : null);
  const B = {
    settings: btn('排序设置', `/pins/collection/${cid}`),
    newPin: btn('新建置顶排序', `/pins/new/${cid}`),
    list: btn('去 app 处理', '/pins'),
  };
  const nextLine = next ? { text: `下一份置顶排序${nm(next.name) || ' '}${T(win(next).start)} 开始`, color: 'subdued' } : null;
  // 置顶的产品之后,网站怎么排剩下的
  const afterPinned = () => (sf || usual.off ? '置顶的之后:完全照这里的顺序'
    : n <= 0 ? '置顶的之后:全部按新到旧'
      : `置顶的之后:${manual ? `再照这里的顺序显示 ${n} 个` : `再按「${sortCn(col.sortOrder)}」显示 ${n} 个`},其余按新到旧`);
  const endText = (p) => (win(p).end != null ? `${T(win(p).end)} 结束` : '长期生效');
  const out = (badge, tone, lines, buttons) => ({
    heading: 'CGP 排序', badge: { text: badge, tone },
    lines: lines.filter(Boolean), buttons: buttons.filter(Boolean), collection: { id: cid, title: col.title }, at: now,
  });

  // ① 有人在后台改了顺序 / 回滚过 → app 暂停接管
  if (cs?.hold) {
    const p = mine.find((x) => x.id === cs.pinId) || null;
    return out('接管已暂停', 'warning', [
      { text: cs.hold === 'rollback'
        ? `回滚过这个 Collection 的顺序,${nameOf(p || { name: cs.pinName })}剩下的时间 app 暂停接管,不会再排回去`
        : '有人在这里改了顺序,app 已经停手,没有覆盖你的改动' },
      { text: '到 app 里选「按本次排序」或「保留后台排序」', color: 'subdued' },
      p ? { text: `${nameOf(p)}${endText(p)}`, color: 'subdued' } : null,
    ], [B.list, btn('打开这份置顶排序', pinPath(cs.pinId))]);
  }
  // ② 置顶排序结束了,正在把顺序还原
  if (cs?.restoring && (!live || cs.pinId !== live.id)) {
    return out('正在还原', 'info', [
      { text: `${nameOf({ name: cs.pinName })}已经结束,app 正在把这里的顺序还原成接管前的样子` },
      { text: '一般 1–2 分钟内完成', color: 'subdued' },
    ], [B.settings]);
  }

  if (live) {
    const prods = (live.products || []).filter(Boolean).length;
    const hidden = (live.hidden || []).filter(Boolean).length;
    const counts = [
      live.onlyListed ? `只显示置顶排序指定的 ${prods} 个` : `最前面 ${prods} 个由置顶排序指定`,
      hidden ? `${hidden} 个这段时间不显示` : '',
    ].filter(Boolean).join(' · ');
    const pinBtn = btn('打开这份置顶排序', `/pins/${live.id}`);
    // ③ 选过「保留后台排序」:这份置顶排序剩下的时间不排
    if (cs?.released && cs.pinId === live.id) {
      return out('顺序交给后台', 'info', [
        { text: `${nameOf(live)}生效中,但之前选了「保留后台排序」:app 不再排这里的顺序,结束时也不还原` },
        { text: '临时加进 / 移出的产品,结束时照样复原', color: 'subdued' },
        { text: `${nameOf(live)}${endText(live)}`, color: 'subdued' },
      ], [B.list, pinBtn]);
    }
    // ④ app 真的在改这里的顺序
    if (cs && !cs.released && cs.pinId === live.id) {
      return out('app 接管中', 'success', [
        { text: `${nameOf(live)}正在排这个 Collection,${win(live).end != null ? `${T(win(live).end)} 结束后自动还原` : '长期生效(暂停 / 删除后自动还原)'}` },
        // 真的改后台时「不显示」= 临时移出 Collection,只说一次
        { text: [live.onlyListed ? `只显示置顶排序指定的 ${prods} 个` : `最前面 ${prods} 个由置顶排序指定`,
          cs.removed?.length ? `临时移出 ${cs.removed.length} 个(这段时间不显示)` : hidden ? `${hidden} 个这段时间不显示` : '',
          cs.added?.length ? `临时加进 ${cs.added.length} 个` : ''].filter(Boolean).join(' · '), color: 'subdued' },
        live.onlyListed ? null : { text: afterPinned(), color: 'subdued' },
        cs.pending ? { text: '正在等 Shopify 算完加进 / 排除的产品,然后排顺序', color: 'subdued' } : null,
        { text: '生效期间在这里拖动顺序,app 会暂停接管(不会覆盖你的改动)', tone: 'caution' },
      ], [pinBtn, B.settings]);
    }
    // ⑤ 生效中,但不改这里的顺序,只在网站上排
    // 要临时移出多少个:不显示的 +「只显示前几个」时其余的(大约数,够判断有没有超过 100)
    const removeN = hidden + (live.onlyListed && col.count != null ? Math.max(0, col.count - prods) : 0);
    const why = !manual ? `这个 Collection 的排序方式是「${sortCn(col.sortOrder)}」,Shopify 不让 app 改这里的顺序`
      : state.colNoScope && now - state.colNoScope < DAY ? 'app 现在没有改 Collection 的权限'
        : removeN > MAX_REMOVE ? `要临时移出的产品超过 ${MAX_REMOVE} 个,所以不改这里的顺序`
          : '刚保存,app 1 分钟内会把这里的顺序也排好';
    return out('只在网站上排', 'info', [
      { text: `${nameOf(live)}生效中:网站上按它排,这里的顺序不变,${endText(live)}` },
      { text: counts, color: 'subdued' },
      live.onlyListed ? null : { text: afterPinned(), color: 'subdued' },
      { text: `${why}${prods > FRONT_MAX ? `;网站上只认前 ${FRONT_MAX} 个` : ''}`, color: 'subdued' },
    ], [pinBtn, B.settings]);
  }

  // ⑥ 没有置顶排序生效:网站按 Collection 默认设置排
  const lines = [{ text: `网站上:${rule}` }];
  if (manual && !usual.off) {
    lines.push(n > 0
      ? { text: `在这里拖动顺序,网站只照前 ${n} 个,第 ${n + 1} 个起按新到旧`, tone: 'caution' }
      : { text: '在这里拖动顺序不影响网站(全部按新到旧)', tone: 'caution' });
  }
  if (!manual) lines.push({ text: `排序方式是「${sortCn(col.sortOrder)}」:置顶排序只能在网站上排,这里的顺序不会变`, color: 'subdued' });
  lines.push(nextLine);
  return out('未接管', 'neutral', lines, [B.settings, B.newPin]);
}
