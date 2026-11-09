// 消息中心 v2(2026-11-09 用户:每一类通知都要能自定义 —— 样式、内容、推给谁、怎么推、什么时候推;不按活动 / 品牌细分)。
// 纯函数,服务器发飞书和页面预览共用(页面经 /lib/notify-catalog.js 读),保证「预览的样子 = 发出去的样子」。
// 这里定义:有哪些分类、每类有哪些通知、每种通知能显示哪些信息(字段)、默认样式、示例数据,以及按样式把数据拼成卡片。
// 各模块发通知时只给数据:{ ev, data: { 字段: 值 }, path: 这一条在 app 里的网址, related, approvers, actor, key? }。

export const COLORS = [['blue', '蓝'], ['wathet', '浅蓝'], ['green', '绿'], ['yellow', '黄'], ['orange', '橙'], ['red', '红'], ['purple', '紫'], ['grey', '灰']];
export const LEVELS = { info: '日常', problem: '出问题', approval: '审批' };

// ---------- 分类(左边那一列)----------
export const CATS = [
  { key: 'price', name: '改价', icon: '💷', path: '/price', page: 'price' },
  { key: 'banner', name: 'Banner', icon: '🖼', path: '/banners', page: 'banners' },
  { key: 'topbar', name: '顶栏', icon: '📢', path: '/topbar', page: 'topbar' },
  { key: 'pmodule', name: '首页商品模块', icon: '🧩', path: '/pmodules', page: 'pmodules' },
  { key: 'pin', name: 'Collection 排序', icon: '🔢', path: '/pins', page: 'pins' },
  { key: 'salelink', name: '促销链接', icon: '🔗', path: '/salelinks', page: 'salelinks' },
  { key: 'callout', name: '产品页推广', icon: '🏷', path: '/callouts', page: 'callouts' },
  { key: 'campaign', name: '活动', icon: '🎯', path: '/campaigns', page: 'campaigns' },
  { key: 'daily', name: '每日提醒', icon: '📅', path: '/', page: null },
  { key: 'approval', name: '审批', icon: '📝', path: '/reviews', page: null, approvals: true },
  { key: 'system', name: '系统', icon: '⚙️', path: '/', page: null },
];
export const CAT = Object.fromEntries(CATS.map((c) => [c.key, c]));
// 内容类型 → 分类(节日样式算在顶栏里)
export const CAT_OF_KIND = { banner: 'banner', topbar: 'topbar', tbstyle: 'topbar', pmodule: 'pmodule', pin: 'pin', salelink: 'salelink', callout: 'callout', campaign: 'campaign' };

// ---------- 字段(卡片上能显示的信息)----------
// list = 一串(产品清单等),卡片上逐行列出,最多显示样式里设的条数
export const FIELDS = {
  kind: { label: '类型' }, name: { label: '名称' }, status: { label: '状态' }, time: { label: '时间' }, campaign: { label: '活动' },
  changes: { label: '改了什么' }, action: { label: '操作' }, actor: { label: '操作人' }, owner: { label: '负责人' },
  position: { label: '位置' }, order: { label: '现在的顺序', list: true }, reason: { label: '原因' }, note: { label: '提示' },
  items: { label: '清单', list: true },
  plan: { label: '计划' }, pkind: { label: '改价类型' }, price: { label: '价格' }, discount: { label: '折扣' }, scope: { label: '产品数量' },
  ops: { label: '这次改了' }, products: { label: '产品', list: true }, holds: { label: '暂停接管的产品', list: true },
  failures: { label: '失败明细', list: true }, collection: { label: 'Collection' }, check: { label: '核对' },
  submitter: { label: '提交人' }, approver: { label: '审批人' }, result: { label: '结果' },
};
// 按钮:网址由发通知的那一条决定(open = 这一条;list = 这一类的列表页)
export const BUTTONS = {
  open: { text: '打开这一条' }, list: { text: '打开列表' }, app: { text: '打开网站更新中心' },
  vault: { text: '去受管产品处理', path: '/price/vault' }, reviews: { text: '去审批', path: '/reviews' },
};

// ---------- 示例数据(预览 / 「发给我试试」用)----------
const T1 = '11/20 周四 00:00 → 11/30 周日 23:59';
const SAMPLE_ITEM = { kind: 'Banner', name: 'Black Friday 主图', status: '已排期', time: T1, campaign: 'Black Friday 2026', changes: '图片、结束时间', action: '暂停',
  actor: '小王', owner: '小李', position: '第 2 张', reason: 'Shopify 返回错误:Throttled', note: '下一分钟会自动重试',
  order: ['DZOFILM Arles 新品', 'Black Friday 主图', 'SmallRig 秋季促销'], items: ['11/20 00:00 · Banner · Black Friday 主图', '11/20 00:00 · 顶栏 · Free UK Delivery over £99'] };
const SAMPLE_PRICE = { plan: 'Black Friday · DZO 85 折', pkind: '限时改价', price: 'BF 价', discount: 'DZO 镜头 15% off', scope: '12 个产品 / 30 个变体', time: T1,
  ops: '开始活动价 30 个变体', campaign: 'Black Friday 2026', actor: '小王', owner: '小王', check: '全部已读回核对 ✓',
  products: ['DZOFILM Arles 25mm T1.4', 'DZOFILM Arles 35mm T1.4', 'DZOFILM Arles 50mm T1.4'],
  holds: ['DZOFILM Arles 25mm(DZO-A25):有人手动改过价,店里现价 £999'], failures: ['DZOFILM Arles 25mm:Shopify 返回错误 Throttled'],
  collection: 'Black Friday Deals:加入 12 个、移出 0 个', reason: '有人在 Shopify 后台手动改了价', note: '下一分钟会自动重试',
  submitter: '小王', approver: '老板', result: '已批准', status: '已排期', changes: '折扣、结束时间', action: '暂停' };

// ---------- 通知目录 ----------
// level:info 日常(个人能关、能合进汇总)/ problem 出问题(个人关不掉;没人收时兜底给管理员)/ approval 审批(开了审批才有)
// self:做这件事的人自己默认不收(改了 Banner 不用再通知改的人)
const KN = { banner: 'Banner', topbar: '顶栏', pmodule: '首页商品模块', pin: '置顶排序', salelink: '促销链接', callout: '产品页推广', campaign: '活动' };
// 每种通知只能选它真的有的信息(比如「上下线失败」没有「改了什么」)
const IB = ['kind', 'name', 'status', 'time', 'campaign', 'owner'];
const ITEM_AVAIL = [...IB, 'actor', 'note'];
function contentEvents(k) {
  const n = KN[k];
  const ev = (suf, o) => ({ key: `${k}.${suf}`, cat: k, level: 'info', avail: ITEM_AVAIL, buttons: ['open', 'list', 'app'], sample: { ...SAMPLE_ITEM, kind: n }, ...o });
  const out = [
    ev('created', { name: '已创建', desc: `有人新建了${n}(存草稿也算)`, title: `🆕 ${n}已创建`, color: 'blue', fields: ['name', 'status', 'time', 'campaign', 'actor'], self: true }),
    ev('updated', { name: '已修改', desc: `有人改了${n}的内容 / 时间`, title: `✏️ ${n}已修改`, color: 'blue', fields: ['name', 'changes', 'status', 'time', 'actor'], avail: [...IB, 'changes', 'actor'], self: true }),
  ];
  if (k === 'banner' || k === 'topbar') out.push(ev('order', { name: '调整了顺序', desc: '有人调整了轮播顺序', title: `↕️ ${n}顺序调整了`, color: 'blue', fields: ['order', 'actor'], avail: ['order', 'actor', 'note'], buttons: ['list', 'app'], self: true }));
  out.push(
    ev('paused', { name: '暂停 / 恢复 / 结束', desc: '有人手动暂停、恢复显示或结束', title: `⏸ ${n}暂停 / 恢复`, color: 'grey', fields: ['name', 'action', 'status', 'actor'], avail: [...IB, 'action', 'actor'], self: true }),
    ev('deleted', { name: '已删除', desc: `有人删除了${n}`, title: `🗑 ${n}已删除`, color: 'grey', fields: ['name', 'status', 'time', 'actor'], avail: [...IB, 'actor'], buttons: ['list', 'app'], self: true }),
    ev('live', { name: '自动上线', desc: '到点自动上线', title: `⬆️ ${n}已上线`, color: 'green', fields: ['name', 'time', 'campaign'], avail: IB }),
    ev('off', { name: '自动下线', desc: '到点自动下线', title: `⬇️ ${n}已下线`, color: 'grey', fields: ['name', 'time', 'campaign'], avail: IB }),
    ev('notlive', { level: 'problem', name: '到点没上线', desc: '跟随的活动还是草稿,或者还没批准', title: `⏰ ${n}到点了但没上线`, color: 'red', fields: ['name', 'time', 'reason', 'note'], avail: [...IB, 'reason', 'note'] }),
    ev('failure', { level: 'problem', name: '上下线失败', desc: '写进店铺没成功;同一条一小时只报一次,下一分钟自动重试', title: `⚠️ ${n}上下线失败`, color: 'red', fields: ['name', 'reason', 'note'], avail: [...IB, 'reason', 'note'] }),
  );
  return out;
}
const PB = ['plan', 'pkind', 'price', 'discount', 'scope', 'time', 'campaign', 'owner', 'status'];
const PRICE_AVAIL = [...PB, 'ops', 'products', 'check'];
const pev = (suf, o) => ({ key: `price.${suf}`, cat: 'price', level: 'info', page: 'price', avail: PRICE_AVAIL, buttons: ['open', 'list', 'app'], sample: SAMPLE_PRICE, ...o });
const PRICE_EVENTS = [
  pev('created', { name: '改价已创建', desc: '有人新建了改价计划(存草稿也算)', title: '🆕 改价计划已创建', color: 'blue', fields: ['plan', 'pkind', 'discount', 'scope', 'time', 'actor'], avail: [...PB, 'actor'], self: true }),
  pev('updated', { name: '改价已修改', desc: '有人改了改价计划', title: '✏️ 改价计划已修改', color: 'blue', fields: ['plan', 'changes', 'time', 'actor'], avail: [...PB, 'changes', 'actor'], self: true }),
  pev('deleted', { name: '改价已删除', desc: '有人删除了改价计划', title: '🗑 改价计划已删除', color: 'grey', fields: ['plan', 'time', 'actor'], avail: [...PB, 'actor'], buttons: ['list', 'app'], self: true }),
  pev('live', { name: '改价开始', desc: '到点换成活动价;永久调价执行', title: '💷 改价开始了', color: 'green', fields: ['plan', 'price', 'ops', 'time', 'check'] }),
  pev('switch', { name: '换到下一段价格', desc: '分了几段时间的计划,换到下一段的价格', title: '🔁 改价换到下一段', color: 'green', fields: ['plan', 'price', 'ops', 'time'] }),
  pev('restored', { name: '改价结束', desc: '回到改价前的价格', title: '🔙 改价结束,已恢复原价', color: 'grey', fields: ['plan', 'ops', 'check'] }),
  pev('finished', { name: '永久调价完成', desc: '永久调价的全部产品都改好了', title: '✅ 永久调价已全部完成', color: 'green', fields: ['plan', 'scope'], avail: PB }),
  pev('control', { name: '手动暂停 / 继续 / 提前结束', desc: '有人在改价页点了这些按钮', title: '⏸ 改价计划暂停 / 继续', color: 'grey', fields: ['plan', 'action', 'note', 'actor'], avail: [...PB, 'action', 'note', 'actor'], self: true }),
  pev('hold', { level: 'problem', name: '改价被接管', desc: '有人在后台手动改了价,或原价已不比活动价高:app 暂停接管这些产品,要在「受管产品」里选怎么处理', title: '⚠️ 有产品暂停接管,等你处理', color: 'red', fields: ['plan', 'holds', 'note'], avail: ['plan', 'holds', 'reason', 'note', 'owner'], buttons: ['vault', 'open', 'app'], sample: { ...SAMPLE_PRICE, note: '这些产品 app 不会再动,请在「改价 → 受管产品」里选择处理方式' } }),
  pev('failure', { level: 'problem', name: '改价失败', desc: '同一个错误一小时只报一次,下一分钟自动重试', title: '❌ 改价失败', color: 'red', fields: ['plan', 'failures', 'note'], avail: ['plan', 'failures', 'note', 'owner'] }),
  pev('collection', { name: 'Collection 加入 / 移出产品', desc: '改价期间把产品加进 / 移出 Collection', title: '🗂 Collection 已更新', color: 'blue', fields: ['collection', 'plan'], avail: ['collection', 'plan', 'note'] }),
  pev('gone', { level: 'problem', name: 'Collection 被删除了', desc: '计划设了加进这个 Collection,但它在店里不存在了', title: '🗂 Collection 已被删除', color: 'orange', fields: ['collection', 'plan', 'note'], avail: ['collection', 'plan', 'note'] }),
  pev('moved', { name: '时间跟着活动改了', desc: '跟随活动的计划,活动改时间后跟着改', title: '🕑 改价时间跟着活动改了', color: 'blue', fields: ['plan', 'campaign', 'time'], avail: PB }),
  pev('recovered', { name: '中途中断,已核对补记', desc: '服务器重启等原因中断,恢复后核对过价格', title: 'ℹ️ 改价中途中断,已核对补记', color: 'blue', fields: ['plan', 'note'], avail: ['plan', 'note'] }),
  pev('submit', { level: 'approval', name: '改价等审批', desc: '有人提交了改价计划或修改', title: '📝 有改价计划等你审批', color: 'orange', fields: ['plan', 'scope', 'time', 'submitter', 'note'], avail: [...PB, 'submitter', 'approver', 'note'], approvals: true }),
  pev('decision', { level: 'approval', name: '改价批准 / 退回', desc: '告诉计划相关的人结果', title: '✅ 改价计划已批准 / 被退回', color: 'green', fields: ['plan', 'result', 'note'], avail: [...PB, 'result', 'approver', 'note'], approvals: true, self: true }),
  pev('unapproved', { level: 'approval', name: '改价快开始了还没批准', desc: '开始前 2 小时提醒审批人', title: '⏰ 改价计划快开始了,还没批准', color: 'orange', fields: ['plan', 'time', 'note'], avail: [...PB, 'note'], approvals: true }),
];
const OTHER_EVENTS = [
  { key: 'pins.hold', cat: 'pin', level: 'problem', page: 'pins', name: '有人在后台改了 Collection 顺序', desc: 'app 已暂停接管,不覆盖别人的改动;要在 Collection 排序里选怎么处理', title: '✋ 有人在后台手动改了 Collection 顺序', color: 'orange', fields: ['collection', 'name', 'note'], avail: ['collection', 'name', 'note'], buttons: ['open', 'list', 'app'], sample: { collection: 'Black Friday Deals', name: 'BF 置顶排序', note: '请在「Collection 排序」里选「按本次排序」或「保留后台排序」' } },
  { key: 'pins.failure', cat: 'pin', level: 'problem', page: 'pins', name: 'Collection 排序失败', desc: '同一个 Collection 同一个原因一天只报一次', title: '⚠️ Collection 排序失败', color: 'red', fields: ['collection', 'reason', 'note'], avail: ['collection', 'reason', 'note'], buttons: ['open', 'list', 'app'], sample: { collection: 'Black Friday Deals', reason: 'Shopify 返回错误:Throttled', note: '下一分钟会自动重试' } },
  { key: 'joint.failure', cat: 'callout', level: 'problem', page: 'callouts', name: '联合推广同步失败', desc: '兼容产品没能同步进 Collection;同一条一天只报一次', title: '⚠️ 联合推广同步 Collection 失败', color: 'red', fields: ['name', 'reason', 'note'], avail: ['name', 'reason', 'note'], buttons: ['open', 'list', 'app'], sample: { name: 'DZO × Thypoch', reason: 'Collection 不存在', note: '下一个小时会自动再试' } },
  { key: 'daily.tomorrow', cat: 'daily', level: 'info', name: '明天要上线的', desc: '每天英国时间 10:00 列出明天要上线的内容', title: '📅 明天要上线', color: 'blue', fields: ['items'], avail: ['items', 'note'], buttons: ['app'], sample: SAMPLE_ITEM },
  { key: 'daily.ending', cat: 'daily', level: 'info', name: '3 天内要下架的', desc: '每天英国时间 10:00 列出快到期的,方便决定延长还是准备替换', title: '⏳ 3 天内要下架', color: 'orange', fields: ['items', 'note'], avail: ['items', 'note'], buttons: ['app'], sample: { ...SAMPLE_ITEM, note: '要继续显示就改结束时间;要替换就提前做好新的' } },
  { key: 'content.submit', cat: 'approval', level: 'approval', approvals: true, name: '有内容等审批', desc: '有人提交了新内容或修改', title: '📝 有内容等审批', color: 'orange', fields: ['kind', 'name', 'submitter', 'time', 'approver', 'note'], avail: [...IB, 'submitter', 'approver', 'note'], buttons: ['reviews', 'open', 'app'], sample: { ...SAMPLE_ITEM, submitter: '小王', approver: '老板', note: '不批准不会上线' } },
  { key: 'content.decision', cat: 'approval', level: 'approval', approvals: true, self: true, name: '批准 / 退回', desc: '告诉提交的人结果', title: '✅ 已批准 / 被退回', color: 'green', fields: ['kind', 'name', 'result', 'approver', 'note'], avail: [...IB, 'result', 'approver', 'submitter', 'note'], buttons: ['open', 'app'], sample: { ...SAMPLE_ITEM, result: '已批准', approver: '老板', note: '将在 11/20 00:00 自动上线' } },
  { key: 'content.due', cat: 'approval', level: 'approval', approvals: true, name: '截止提醒', desc: '截止前一天还没提交;过了截止也告诉审批人', title: '⏳ 快到截止时间了', color: 'orange', fields: ['kind', 'name', 'time', 'owner', 'note'], avail: [...IB, 'note'], buttons: ['open', 'app'], sample: { ...SAMPLE_ITEM, time: '截止 11/18 周二 18:00', note: '做好后点「提交审核」' } },
  { key: 'system.failure', cat: 'system', level: 'problem', name: '系统问题', desc: '店铺授权失效等,所有定时上下线都受影响', title: '⚠️ 定时上下线出问题了', color: 'red', fields: ['reason', 'note'], avail: ['reason', 'note'], buttons: ['app'], sample: { reason: '没有店铺授权(请在 Shopify 后台打开一次 app)', note: '下一分钟会自动重试' } },
];
export const EVENTS = [...PRICE_EVENTS, ...['banner', 'topbar', 'pmodule', 'pin', 'salelink', 'callout', 'campaign'].flatMap(contentEvents), ...OTHER_EVENTS]
  .map((e) => ({ ...e, page: e.page || CAT[e.cat]?.page || null, avail: [...new Set([...e.fields, ...(e.avail || [])])] }));
export const EV = Object.fromEntries(EVENTS.map((e) => [e.key, e]));
// 老的通知 key(2026-11-09 第一版)→ 新的(已存的规则照着带过来)
export const OLD_KEY = {
  'content.updown': (k) => /\.(live|off)$/.test(k) && !k.startsWith('price.'),
  'content.failure': (k) => /\.failure$/.test(k) && !k.startsWith('price.') && !['pins.failure', 'joint.failure'].includes(k),
  'content.notlive': (k) => /\.notlive$/.test(k),
  'content.tomorrow': (k) => k === 'daily.tomorrow',
  'content.ending': (k) => k === 'daily.ending',
  'price.live': (k) => k === 'price.switch',
  'price.restored': (k) => k === 'price.finished',
};

// ---------- 样式 ----------
export const defaultStyle = (ev) => ({
  title: ev.title, color: ev.color, layout: 'full', titleName: true, max: 10,
  fields: [...ev.fields],
  buttons: Object.fromEntries(ev.buttons.map((b, i) => [b, { on: i === 0, text: BUTTONS[b].text }])),
});
const str = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
export function cleanStyle(ev, s = {}) {
  const d = defaultStyle(ev);
  const fields = Array.isArray(s.fields) ? [...new Set(s.fields)].filter((k) => ev.avail.includes(k)) : d.fields;
  const buttons = {};
  for (const b of ev.buttons) { const x = s.buttons?.[b] || d.buttons[b]; buttons[b] = { on: !!x.on, text: str(x.text, 20) || BUTTONS[b].text }; }
  return {
    title: str(s.title, 60) || d.title, color: COLORS.some(([c]) => c === s.color) ? s.color : d.color,
    layout: s.layout === 'brief' ? 'brief' : 'full', titleName: s.titleName === undefined ? d.titleName : !!s.titleName,
    max: Math.min(30, Math.max(1, Number(s.max) || d.max)), fields, buttons,
  };
}

// ---------- 拼卡片 ----------
// 卡片(给 src/lark.js 变成飞书卡片、给页面画预览):{ title, color, rows: [{ label, value } | { label, list }], line?, buttons: [{ text, url }], at?: [open_id] }
const subjOf = (data) => data.name || data.plan || data.collection || '';
const valueOf = (v) => (Array.isArray(v) ? v.filter(Boolean) : v == null ? '' : String(v));
export function renderCard(ev, style, data = {}, { url = (p) => p, path = '/' } = {}) {
  const s = style || defaultStyle(ev);
  const subj = subjOf(data);
  const title = s.titleName && subj && !String(s.title).includes(subj) ? `${s.title} · ${subj}` : s.title;
  const rows = [];
  for (const k of s.fields) {
    const f = FIELDS[k]; const v = valueOf(data[k]); if (!f || !v.length) continue;
    if (s.titleName && (k === 'name' || k === 'plan') && v === subj) continue; // 名字已经在标题里了
    if (f.list || Array.isArray(v)) {
      const arr = Array.isArray(v) ? v : [v];
      rows.push({ label: f.label, list: [...arr.slice(0, s.max), ...(arr.length > s.max ? [`……共 ${arr.length} 个`] : [])] });
    } else rows.push({ label: f.label, value: v });
  }
  const buttons = Object.entries(s.buttons).filter(([, b]) => b.on).map(([k, b]) => ({ text: b.text, url: url(BUTTONS[k]?.path || (k === 'open' ? path : k === 'list' ? CAT[ev.cat]?.path || '/' : '/')) }));
  if (s.layout === 'brief') return { title, color: s.color, rows: [], line: rows.map((r) => r.value || r.list.slice(0, 2).join('、')).filter(Boolean).slice(0, 3).join(' · '), buttons: buttons.slice(0, 1) };
  return { title, color: s.color, rows, buttons };
}
// 一条的简短说明(合成一张卡片 / 汇总里用):名称 + 后面一两个信息
export function briefLine(ev, style, data = {}) {
  const s = style || defaultStyle(ev);
  const subj = subjOf(data);
  const rest = s.fields.filter((k) => !['name', 'plan', 'collection'].includes(k) && !FIELDS[k]?.list).map((k) => valueOf(data[k])).filter((v) => v && !Array.isArray(v)).slice(0, 2);
  const list = s.fields.map((k) => data[k]).find((v) => Array.isArray(v) && v.length);
  return [subj, ...rest].filter(Boolean).join(' · ') || (list ? list.slice(0, 2).join('、') : '');
}
// 同一种通知几条合成一张(马上发时同一轮的、「几分钟内合成一条」、「只在工作时间发」攒下的)
export function renderList(ev, style, entries, { url = (p) => p } = {}) {
  const s = style || defaultStyle(ev);
  const list = entries.slice(0, 30).map((e) => `${e.line || '—'}${e.url ? ` [打开](${e.url})` : ''}`);
  if (entries.length > 30) list.push(`……共 ${entries.length} 条`);
  const btn = s.buttons.list ? { text: s.buttons.list.text, url: url(CAT[ev.cat]?.path || '/') } : { text: BUTTONS.app.text, url: url('/') };
  return { title: `${s.title} · ${entries.length} 条`, color: s.color, rows: [{ label: '', list }], buttons: [btn] };
}
// 每天汇总:按分类列,每条一行带链接
export function renderDigest(entries, { url = (p) => p, title = '📬 通知汇总' } = {}) {
  const byCat = new Map();
  for (const e of entries) { const c = EV[e.ev]?.cat || 'system'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(e); }
  const rows = [...byCat].map(([c, es]) => ({ label: `${CAT[c]?.icon || ''} ${CAT[c]?.name || c}`, list: [...es.slice(0, 15).map((e) => `${e.name}${e.line ? ` · ${e.line}` : ''}${e.url ? ` [打开](${e.url})` : ''}`), ...(es.length > 15 ? [`……共 ${es.length} 条`] : [])] }));
  return { title: `${title} · ${entries.length} 条`, color: 'blue', rows, buttons: [{ text: BUTTONS.app.text, url: url('/') }] };
}
