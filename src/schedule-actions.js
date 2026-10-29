// 排期系统的所有「动作」:存草稿 / 提交审核 / 发布 / 批准 / 退回 / 暂停 / 删除 / 调整顺序。
// 纯函数,服务器和浏览器共用同一份(浏览器通过 /lib/schedule-actions.js 加载)——
// 演示模式在浏览器里直接跑,正式模式由服务器跑并检查权限,规则只有这一处。
//
// doc 结构:{ banners, topbar, tbstyles, campaigns, pendingOrder, log, staff: [{id,name,role}] }
// actor:{ id, name, role: 'approver' | 'editor' }
// 返回 { doc, effects, message }。effects 交给服务器执行(写 Shopify / 发飞书),浏览器演示模式忽略。
import { itemStatus, campaignIndex, childrenOf } from './schedule-core.js';
import { SLUG_RE, SALE_SORTS, VIEW_RE, AFTER_END, AFTER_URL_RE } from './sale-link.js';

export const LIST = { banner: 'banners', topbar: 'topbar', tbstyle: 'tbstyles', campaign: 'campaigns', pmodule: 'pmodules', pin: 'pins', salelink: 'salelinks', callout: 'callouts' };
export const KIND_CN = { banner: 'Banner', topbar: '顶栏公告', tbstyle: '顶栏样式', campaign: '活动', pmodule: '首页商品模块', pin: 'Collection 置顶排序', salelink: '促销链接', callout: '产品页推广' };
export const MODULE_CN = { sale: '促销模块', feature: '推荐 / 新品模块' };
export const ORDERABLE = ['banner', 'topbar'];

// 可编辑字段(审核对比、修改待审核都以它为准)
export const EDIT_KEYS = ['image', 'imageId', 'title', 'subtitle', 'description', 'button1_text', 'button1_url', 'button2_text', 'button2_url', 'button1_video', 'button2_video', 'tag',
  'emoji', 'text', 'link', 'category', 'name', 'collections', 'tags', 'products', 'badge', 'countdown', 'priority',
  'bg', 'color', 'accent', 'effect', 'decoLeft', 'decoRight', 'start', 'end', 'campaign',
  'module', 'title2', 'titleColor', 'title2Color', 'tabActiveBg', 'tabActiveText', 'tabs', 'isDefault',
  // v3:合集置顶清单;活动关联的飞书任务链接
  'collection', 'onlyListed', 'larkLinks', 'hidden', 'fullOrder',
  // v3 分工:负责人 / 审批人 / 抄送(成员 id)、截止时间(ms)
  'owner', 'approver', 'cc', 'due',
  // 促销链接(?onsale=<后缀>);置顶的产品用 products,合集用 collection
  'slug', 'inStock', 'minDiscount', 'limit', 'sort', 'heading', 'view', 'afterEnd', 'afterEndUrl',
  // 活动的倒计时样式(产品页 / 产品卡 / 首页商品模块都用)
  'countdownStyle', 'countdownLabel', 'countdownBg', 'countdownColor',
  // 活动徽章点了去哪:'' = 自动(促销链接 / 参加的第一个合集);'none' = 不能点;/… 或 https://… = 指定链接
  'badgeLink',
  // 联合推广(产品页推广的升级,2026-10-22):两边卡片 + 兼容产品合集(app 同步、也是活动页)+ 推广产品合集 + 活动页内容
  'joint', 'lensCollection', 'promoCollection', 'promoTitle', 'promoText', 'promoLinkText', 'offer', 'lpTitle', 'lpText', 'lpImage', 'lpImageId', 'lpSteps', 'lpTerms', 'dealPct',
  // 联合推广版本 4(2026-10-26):小标签、视频、弹窗标题、卖点、兼容相机、套装说明(How it works 仍存在 lpSteps)
  'badge', 'video', 'popTitle', 'points', 'cameras', 'camerasNote', 'kits',
  // 联合推广的条件组(2026-10-26):[{ id, name, rules }],组和组之间「或」;rules 仍存第一组(老代码 / 店里 rules 字段用)
  'ruleGroups',
  // 联合推广的卡口过滤(2026-10-27,src/mounts.js):mountFilter = false 才关(没存 = 开);badMounts = 不兼容卡口名单(空 = 默认 RF / L / X / Z / MFT / EF-M / DL)
  'mountFilter', 'badMounts',
  // 产品页推广块:推广的产品、链接文字、品牌、排除的产品 / 标签(其余沿用 title / text / link / image / collections / tags / products / priority)
  'promo', 'promos', 'linkText', 'vendors', 'exProducts', 'exTags', 'rules',
  // 主活动 / 子活动:活动属于哪个主活动(活动 id;只有一层)
  'parent'];
export const COUNTDOWN_STYLES = ['classic', 'pill', 'dark', 'minimal'];

export class ActionError extends Error {}
const fail = (msg) => { throw new ActionError(msg); };

export const titleOf = (it) => (it.kind === 'banner' ? (it.title || '未命名 Banner')
  : it.kind === 'topbar' ? `${it.emoji || ''} ${it.text || ''}`.trim() || '未命名公告' : it.name || '未命名');
export const allOf = (doc) => [...doc.campaigns, ...doc.banners, ...doc.topbar, ...doc.tbstyles, ...(doc.pmodules || []), ...(doc.pins || []), ...(doc.salelinks || []), ...(doc.callouts || [])];
export const findItem = (doc, id) => allOf(doc).find((x) => x.id === id);
const isApprover = (actor) => actor?.role === 'approver'; // 管理员(旧名单里的「审核人」)

// 谁审批这条内容:内容自己指定的 → 这类内容的默认审批人(设置里配)→ 都没有就是管理员(返回 null)
export const effApprover = (doc, it) => it?.approver || doc?.settings?.approvers?.[it?.kind] || null;
// 能不能批准 / 退回 / 暂停 / 直接保存这条:管理员,或者它的审批人
export const canApprove = (actor, doc, it) => !!actor && (isApprover(actor) || (!!it && effApprover(doc, it) === actor.id));
// 轮播顺序:管理员,或者这类内容的默认审批人
export const canOrder = (actor, doc, kind) => !!actor && (isApprover(actor) || (!!doc?.settings?.approvers?.[kind] && doc.settings.approvers[kind] === actor.id));

export function addLog(doc, now, action, it, note, actor) {
  doc.log.unshift({ at: now, action, kind: it.kind, title: it.title && it.kind !== 'banner' ? it.title : titleOf(it), note: note || '', by: actor?.name || '' });
  doc.log = doc.log.slice(0, 1000);
}

// 只挑出真的改了的字段(空串 = 空,首尾空格不算改动)
export function diff(it, v) {
  const d = {};
  const norm = (x) => JSON.stringify(typeof x === 'string' ? x.trim() || null : x ?? null);
  EDIT_KEYS.forEach((k) => { if (k in v && norm(v[k]) !== norm(it[k])) d[k] = v[k]; });
  return d;
}
const pick = (v) => Object.fromEntries(EDIT_KEYS.filter((k) => k in v).map((k) => [k, v[k]]));
export const pickEditable = pick; // 历史版本用:一条内容「能编辑的那些字段」

export function validate(it) {
  if (it.kind === 'banner' && !it.image) return '请选一张图片';
  if (it.kind === 'topbar' && !String(it.text || '').trim()) return '请填写公告文字';
  if ((it.kind === 'campaign' || it.kind === 'tbstyle') && !String(it.name || '').trim()) return '请填写名称';
  if (it.kind === 'campaign' && it.start == null) return '活动需要开始时间';
  if (it.kind === 'campaign' && it.countdownStyle && !COUNTDOWN_STYLES.includes(it.countdownStyle)) return '倒计时样式不对';
  if (it.kind === 'campaign' && [it.countdownBg, it.countdownColor].some((c) => c && !/^#[0-9a-f]{6}$/i.test(c))) return '倒计时颜色要是 #rrggbb 这种写法';
  if (it.kind === 'pmodule') {
    if (!['sale', 'feature'].includes(it.module)) return '请选择是哪个模块';
    if (!(it.tabs || []).length) return '至少要有一个页签';
    for (const [i, t] of it.tabs.entries()) {
      if (t.source === 'products' ? !(t.products || []).length : !t.collection) return `第 ${i + 1} 个页签还没选${t.source === 'products' ? '产品' : ' Collection'}`;
    }
  }
  if (it.kind === 'pin') {
    if (!it.collection?.id) return '请选要排序的 Collection';
    if (!(it.products || []).length) return '至少放一个要排在前面的产品';
  }
  if (it.kind === 'salelink') {
    if (!String(it.name || '').trim()) return '请填写名称';
    if (!it.collection?.id) return '请选 Collection';
    if (!SLUG_RE.test(String(it.slug || ''))) return '链接后缀只能用小写字母、数字和横线(不能以横线开头,最多 40 个字)';
    if (it.sort && !SALE_SORTS.some(([k]) => k === it.sort)) return '排序方式不对';
    if (it.view && !VIEW_RE.test(it.view)) return '页面模板的名字不对(主题里 collection.<名字> 的那个名字)';
    if (it.afterEnd && !AFTER_END.some(([k]) => k === it.afterEnd)) return '「结束后去哪」的选项不对';
    if (it.afterEnd === 'url' && !AFTER_URL_RE.test(String(it.afterEndUrl || '').trim())) return '结束后要跳到的链接不对:填站内路径(/collections/…)或 https:// 开头的完整链接';
  }
  if (it.kind === 'callout') {
    if (!String(it.name || '').trim()) return '请填写名称';
    if (!String(it.title || '').trim()) return '请填写标题(产品页上那一句)';
    if (it.link && !AFTER_URL_RE.test(String(it.link).trim())) return '链接不对:填站内路径(/products/…)或 https:// 开头的完整链接';
    if (!it.joint && !String(it.link || '').trim() && !it.promo?.id) return '请选推广的产品,或者填一个链接';
    if (it.joint) { // 联合推广:两边卡片都链到活动页(= 兼容产品合集的页面)
      if (!it.lensCollection?.id) return '请选兼容产品的 Collection(app 会把命中的产品同步进去,它也是活动页)';
      if (!it.promoCollection?.id) return '请选推广产品的 Collection(比如 Smart Fusion 全系列)';
      if (String(it.lensCollection.id).split('/').pop() === String(it.promoCollection.id).split('/').pop()) return '兼容产品 Collection 和推广产品 Collection 不能是同一个';
      if (!(it.promos || []).length) return '请选推广的产品(可以多选,app 会把它们放进推广产品 Collection)';
      if (it.promos.length > 50) return '推广的产品最多 50 个';
      if (!String(it.promoTitle || '').trim()) return '请填推广产品页上那张卡片的标题';
      const steps = it.lpSteps || [];
      if (!Array.isArray(steps) || steps.length > 4 || steps.some((x) => !x || typeof x.t !== 'string')) return 'How it works 最多 4 步';
      const vid = String(it.video || '').trim();
      if (vid && !/^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(vid) && !/^[\w-]{11}$/.test(vid)) return '视频请填 YouTube 链接(youtube.com/watch?v=… 或 youtu.be/…)';
      if (it.kits != null && (!Array.isArray(it.kits) || it.kits.length > 60 || it.kits.some((k) => !k || !k.v))) return '套装说明的格式不对';
    }
    // 联合推广可以有好几组条件(每个牌子一组,组和组之间「或」);普通推广块只有 rules 一组
    if (it.ruleGroups != null && (!Array.isArray(it.ruleGroups) || it.ruleGroups.length > 20 || it.ruleGroups.some((g) => !g || !Array.isArray(g.rules)))) return '条件组的格式不对(最多 20 组)';
    if (it.ruleGroups?.length && !it.joint) return '只有联合推广能分好几组条件';
    if (it.badMounts != null && (!Array.isArray(it.badMounts) || it.badMounts.length > 30 || it.badMounts.some((m) => typeof m !== 'string' || !m.trim() || m.length > 30))) return '不兼容卡口的写法不对(用逗号隔开,最多 30 个,比如 RF, L, X, Z, MFT)';
    const groups = (it.ruleGroups?.length ? it.ruleGroups.map((g) => g.rules) : [it.rules || []]).map((rs) => (rs || []).filter((r) => (r.v || []).length));
    const rules = groups.flat();
    for (const g of groups) {
      if (g.length > 20) return '每组条件最多 20 行';
      for (const r of g) {
        if (!['vendor', 'type', 'collection', 'tag', 'title'].includes(r.f)) return '条件的类型不对';
        if (r.v.length > 50) return '一行条件最多 50 个值';
        if (r.f === 'collection' ? r.v.some((c) => !c?.id) : r.v.some((x) => typeof x !== 'string' || !x.trim())) return '条件里有空的值';
      }
    }
    if (!rules.length && !(it.products || []).length && ![it.collections, it.tags, it.vendors].some((x) => (x || []).length)) return '请设置放在哪些产品上(至少一条条件,或者选几个一定显示的产品)';
  }
  if (it.kind === 'campaign' && it.badgeLink && it.badgeLink !== 'none' && !AFTER_URL_RE.test(String(it.badgeLink).trim())) return '徽章链接不对:填站内路径(/collections/…)或 https:// 开头的完整链接';
  if (it.start != null && it.end != null && it.end <= it.start) return '结束时间要晚于开始时间';
  return '';
}

const clone = (doc) => (typeof structuredClone === 'function' ? structuredClone(doc) : JSON.parse(JSON.stringify(doc)));
const orderTitle = (kind) => (kind === 'banner' ? 'Banner 轮播顺序' : '顶栏轮播顺序');

// 参与排序的 = 上线中 / 已排期 / 待审核 / 暂停中的;已结束、草稿不占位置
export function orderPipeline(doc, kind, now = Date.now()) {
  const camps = campaignIndex(doc.campaigns);
  return doc[LIST[kind]].filter((x) => ['live', 'scheduled', 'pending', 'waiting', 'paused'].includes(itemStatus(x, camps, now)))
    .sort((a, b) => a.order - b.order);
}
export function applyOrder(doc, kind, ids) {
  const L = doc[LIST[kind]];
  const rest = L.filter((x) => !ids.includes(x.id)).sort((a, b) => a.order - b.order);
  [...ids.map((id) => L.find((x) => x.id === id)).filter(Boolean), ...rest].forEach((x, i) => { x.order = i; });
}

// 每个通知都带上是谁做的(私信时不发给做这件事的人自己)
export function applyAction(input, action, actor, now = Date.now()) {
  const r = run(input, action, actor, now);
  familySyncs(input, r);
  r.effects.forEach((e) => { if (e.type === 'notify') e.actor = actor?.id || null; });
  return r;
}

function run(input, action, actor, now) {
  const doc = clone(input);
  const effects = [];
  let message = '';
  // 老数据里可能还没有某类列表(比如后加的商品模块),用到时补成空列表
  const L = (kind) => (LIST[kind] ? (doc[LIST[kind]] ||= []) : fail('未知类型'));

  switch (action.type) {
    case 'save': {
      const { mode, kind, values = {} } = action;
      const list = L(kind);
      let it = action.id ? list.find((x) => x.id === action.id) : null;
      if (action.id && !it && !action.isNew) fail('这条内容已经不存在(可能被别人删了),请刷新');
      const isNew = !it;
      if (isNew) {
        const id = values.id || action.id;
        if (!id || allOf(doc).some((x) => x.id === id)) fail('新内容的编号无效');
        it = { id, kind, state: 'new', by: actor.id, order: list.length, paused: false, pendingChange: null, campaign: null, start: null, end: null };
      }
      if (it.isDefault && mode !== 'publish' && mode !== 'submit') fail('默认样式只能直接保存或提交修改');
      const v = pick(values);
      // 产品 / 合集列表里的空项(异常数据)去掉,免得页面画不出来
      for (const k of ['products', 'hidden', 'exProducts', 'collections']) if (Array.isArray(v[k])) v[k] = v[k].filter((x) => x && typeof x === 'object' && x.id != null);
      const merged = { ...it, ...v };
      if (mode !== 'draft') { const err = validate(merged); if (err) fail(err); }
      if (kind === 'pmodule' && merged.isDefault && list.some((x) => x !== it && x.isDefault && x.module === merged.module)) fail('这个模块已经有平时版本了');
      if (kind === 'campaign' && merged.parent) { // 主活动 / 子活动只有一层
        const p = doc.campaigns.find((x) => x.id === merged.parent) || fail('选的主活动不存在了(可能刚被删掉),请刷新');
        if (p.id === it.id) fail('不能选自己当主活动');
        if (p.parent) fail(`「${p.name}」本身是子活动,不能再当主活动`);
        if (childrenOf(it.id, doc.campaigns).length) fail('这个活动下面已经有子活动了(它是主活动),不能再挂到别的主活动下面');
      }
      if (kind === 'pmodule') for (const t of merged.tabs || []) if (t.campaign && !doc.campaigns.some((c) => c.id === t.campaign)) fail(`页签「${t.title || ''}」跟随的活动不存在了,请重新选`);
      // 同一个合集的促销链接后缀不能重复(不同合集可以同名)
      if (kind === 'salelink' && merged.slug && merged.collection?.id && list.some((x) => x !== it && x.slug === merged.slug && String(x.collection?.id).split('/').pop() === String(merged.collection.id).split('/').pop())) fail(`这个 Collection 已经有后缀叫「${merged.slug}」的促销链接了,换一个`);
      const approved = it.state === 'approved';
      // 不是管理员的人不能把自己设成审批人(否则等于自己批自己);这类内容的默认审批人本来就是他的除外
      if (v.approver && v.approver === actor.id && it.approver !== actor.id && !isApprover(actor) && doc.settings?.approvers?.[kind] !== actor.id) fail('审批人不能选你自己;要直接生效,请管理员在「设置」里把你设成这类内容的默认审批人');
      // 已批准的:由现在的审批人决定(改审批人本身也要他批);还没批准的:按这次填的审批人
      const mayApprove = canApprove(actor, doc, approved ? it : merged);

      if (mode === 'draft') {
        if (approved) fail('已批准的内容不能存草稿;要改就提交修改审核');
        Object.assign(it, v, { state: 'draft' });
        if (isNew) list.push(it);
        addLog(doc, now, 'draft', it, '', actor);
        message = '已存草稿';
      } else if (mode === 'submit' && !mayApprove) {
        if (approved) {
          const d = diff(it, v);
          if (!Object.keys(d).length) fail('没有改动');
          it.pendingChange = { ...d, by: actor.id, at: now };
          addLog(doc, now, 'submit', it, '提交修改,线上保持原版本直到批准', actor);
        } else {
          Object.assign(it, v, { state: 'pending', by: actor.id, submittedAt: now, rejectNote: null });
          if (isNew) list.push(it);
          addLog(doc, now, 'submit', it, '', actor);
        }
        effects.push({ type: 'notify', event: 'submit', id: it.id, change: approved });
        message = '已提交审核';
      } else if (mode === 'publish' || mode === 'submit') {
        // 审批人自己提交 = 直接生效
        if (!mayApprove) fail('只有这条内容的审批人(或管理员)能直接保存,请提交审核');
        const wasNew = !approved;
        // 别人提交、等我批的,我改了直接保存 = 批准:告诉提交人
        const other = it.state === 'pending' ? it.by : it.pendingChange?.by;
        if (other && other !== actor.id) effects.push({ type: 'notify', event: 'decision', id: it.id, approved: true, to: other, change: approved, edited: true });
        Object.assign(it, v, { state: 'approved', pendingChange: null, rejectNote: null, lastReject: null, approvedBy: actor.id, approvedAt: now });
        if (isNew) list.push(it);
        // 没开审批(actor.direct):就是「发布 / 修改」,别写成「批准」
        if (actor.direct) addLog(doc, now, wasNew ? 'publish' : 'edit', it, '', actor);
        else addLog(doc, now, wasNew ? 'approve' : 'edit', it, wasNew ? '审批人自己排期(自动批准)' : '审批人直接修改', actor);
        effects.push({ type: 'sync', id: it.id });
        if (kind === 'campaign') followersOf(doc, it.id).forEach((f) => effects.push({ type: 'sync', id: f.id }));
        message = '已保存';
      } else fail('未知的保存方式');
      return { doc, effects, message, id: it.id };
    }

    case 'approve': {
      if (action.id === '__order') {
        const o = doc.pendingOrder || fail('没有待审核的顺序');
        if (!canOrder(actor, doc, o.kind)) fail('只有管理员(或这类内容的默认审批人)能批准顺序');
        applyOrder(doc, o.kind, o.ids); doc.pendingOrder = null;
        addLog(doc, now, 'approve', { kind: o.kind, title: orderTitle(o.kind) }, '批准新顺序', actor);
        effects.push({ type: 'syncOrder', kind: o.kind }, { type: 'notify', event: 'decision', order: o, approved: true });
        return { doc, effects, message: '已批准新顺序' };
      }
      const it = findItem(doc, action.id) || fail('找不到这条内容');
      if (!canApprove(actor, doc, it)) fail('只有这条内容的审批人(或管理员)能批准');
      if (it.pendingChange) {
        const { by, at, ...ch } = it.pendingChange; // eslint-disable-line no-unused-vars
        effects.push({ type: 'notify', event: 'decision', id: it.id, approved: true, to: by, change: true });
        Object.assign(it, ch); it.pendingChange = null;
        addLog(doc, now, 'approve', it, '批准修改,已替换线上版本', actor);
      } else if (it.state === 'pending') {
        it.state = 'approved'; it.rejectNote = null;
        addLog(doc, now, 'approve', it, '批准', actor);
        effects.push({ type: 'notify', event: 'decision', id: it.id, approved: true, to: it.by });
      } else fail('这条内容不在待审核状态');
      it.approvedBy = actor.id; it.approvedAt = now;
      effects.push({ type: 'sync', id: it.id });
      if (it.kind === 'campaign') followersOf(doc, it.id).forEach((f) => effects.push({ type: 'sync', id: f.id }));
      return { doc, effects, message: '已批准', id: it.id };
    }

    case 'reject': {
      const note = String(action.note || '').trim();
      if (action.id === '__order') {
        const o = doc.pendingOrder || fail('没有待审核的顺序');
        if (!canOrder(actor, doc, o.kind)) fail('只有管理员(或这类内容的默认审批人)能退回顺序');
        doc.pendingOrder = null;
        addLog(doc, now, 'reject', { kind: o.kind, title: orderTitle(o.kind) }, '退回新顺序:' + note, actor);
        effects.push({ type: 'notify', event: 'decision', order: o, approved: false, note });
        return { doc, effects, message: '已退回' };
      }
      const it = findItem(doc, action.id) || fail('找不到这条内容');
      if (!canApprove(actor, doc, it)) fail('只有这条内容的审批人(或管理员)能退回');
      if (it.pendingChange) {
        effects.push({ type: 'notify', event: 'decision', id: it.id, approved: false, note, to: it.pendingChange.by, change: true });
        it.lastReject = { note, at: now }; it.pendingChange = null;
        addLog(doc, now, 'reject', it, '退回修改:' + note, actor);
      } else if (it.state === 'pending') {
        it.state = 'rejected'; it.rejectNote = note;
        addLog(doc, now, 'reject', it, '退回:' + note, actor);
        effects.push({ type: 'notify', event: 'decision', id: it.id, approved: false, note, to: it.by });
      } else fail('这条内容不在待审核状态');
      return { doc, effects, message: '已退回', id: it.id };
    }

    case 'pause': {
      const it = findItem(doc, action.id) || fail('找不到这条内容');
      if (!canApprove(actor, doc, it)) fail('只有这条内容的审批人(或管理员)能暂停 / 恢复');
      if (it.isDefault) fail('默认样式不能暂停');
      if (it.state !== 'approved') fail('只有已批准的内容能暂停');
      it.paused = !it.paused;
      addLog(doc, now, it.paused ? 'pause' : 'resume', it, '', actor);
      effects.push({ type: 'sync', id: it.id });
      if (it.kind === 'campaign') followersOf(doc, it.id).forEach((f) => effects.push({ type: 'sync', id: f.id }));
      return { doc, effects, message: it.paused ? '已暂停 · 前台立即不再显示' : '已恢复 · 按时间正常显示', id: it.id };
    }

    case 'delete': {
      const it = findItem(doc, action.id) || fail('找不到这条内容');
      if (it.isDefault) fail('默认样式不能删除');
      const s = itemStatus(it, campaignIndex(doc.campaigns), now);
      // 2026-10-21 用户:暂停了的也要能删(暂停 = 已经不在网站上显示,删掉不影响前台)
      if (!['draft', 'rejected', 'ended', 'paused'].includes(s)) fail('只能删除草稿、被退回、已暂停或已结束的内容(正在上线的先暂停)');
      if (!canApprove(actor, doc, it) && it.by !== actor.id && it.owner !== actor.id) fail('只能删除自己建的 / 自己负责的内容');
      if (it.kind === 'campaign' && followersOf(doc, it.id).length) fail('还有 Banner / 顶栏挂在这个活动下,先把它们改成别的时间方式');
      if (it.kind === 'campaign' && tabsFollowing(doc, it.id).length) { const x = tabsFollowing(doc, it.id)[0]; fail(`首页商品模块「${titleOf(x.m)}」的页签「${x.t.title || ''}」只在这个活动期间显示,先把它改成一直显示或跟随别的活动`); }
      const list = L(it.kind); list.splice(list.indexOf(it), 1);
      addLog(doc, now, 'delete', it, '', actor);
      if (it.kind === 'campaign') for (const ch of childrenOf(it.id, doc.campaigns)) { ch.parent = null; if (ch.state === 'approved') effects.push({ type: 'sync', id: ch.id }); } // 子活动变回独立活动
      if (it.shopifyId) effects.push({ type: 'remove', shopifyId: it.shopifyId });
      for (const tab of it.tabs || []) if (tab.shopifyId) effects.push({ type: 'remove', shopifyId: tab.shopifyId });
      return { doc, effects, message: '已删除' };
    }

    // 批量清理(设置 →「清理内容」):管理员一次删掉多条,不管现在什么状态 —— 上线中的会立刻从网站上消失
    case 'purge': {
      if (!isApprover(actor)) fail('只有管理员能批量删除');
      const ids = [...new Set(action.ids || [])];
      if (!ids.length) fail('还没选要删除的内容');
      const items = ids.map((id) => findItem(doc, id) || fail('有内容找不到了(可能刚被删掉),请刷新后再选'));
      const fixed = items.find((it) => it.isDefault);
      if (fixed) fail(`「${titleOf(fixed)}」是默认样式 / 平时版本,不能删`);
      const sel = new Set(ids);
      for (const c of items.filter((x) => x.kind === 'campaign')) {
        const left = followersOf(doc, c.id).filter((f) => !sel.has(f.id));
        if (left.length) fail(`活动「${c.name}」下面还挂着 ${left.length} 条跟随它时间的内容(${left.slice(0, 3).map(titleOf).join('、')}),要一起勾上`);
      }
      for (const it of items) {
        const list = L(it.kind); list.splice(list.indexOf(it), 1);
        addLog(doc, now, 'delete', it, '批量清理', actor);
        if (it.shopifyId) effects.push({ type: 'remove', shopifyId: it.shopifyId });
        for (const tab of it.tabs || []) if (tab.shopifyId) effects.push({ type: 'remove', shopifyId: tab.shopifyId });
      }
      // 留下的内容如果关联着被删的活动(自己有时间的那种),去掉关联;已上线的重写一次店里的条目
      const gone = new Set(items.filter((x) => x.kind === 'campaign').map((x) => x.id));
      for (const id of gone) {
        const tf = tabsFollowing(doc, id).filter(({ m }) => !sel.has(m.id));
        if (tf.length) fail(`首页商品模块「${titleOf(tf[0].m)}」的页签「${tf[0].t.title || ''}」只在被删的活动期间显示,先把页签改掉或者一起勾上`);
      }
      for (const ch of doc.campaigns) if (gone.has(ch.parent)) { ch.parent = null; if (ch.state === 'approved') effects.push({ type: 'sync', id: ch.id }); } // 子活动变回独立活动
      for (const x of allOf(doc)) {
        if (!gone.has(x.campaign)) continue;
        x.campaign = null;
        if (x.state === 'approved') effects.push({ type: 'sync', id: x.id });
      }
      if (doc.pendingOrder?.ids?.some((id) => sel.has(id))) doc.pendingOrder = null;
      return { doc, effects, message: `已删除 ${items.length} 条`, ids };
    }

    case 'order': {
      const { kind, ids } = action;
      if (!ORDERABLE.includes(kind)) fail('这类内容不能排序');
      const before = orderPipeline(doc, kind, now).map((x) => x.id);
      if (!Array.isArray(ids) || ids.length !== before.length || !before.every((id) => ids.includes(id))) fail('顺序里的内容和现在对不上(可能刚有变化),请刷新后再排');
      if (JSON.stringify(before) === JSON.stringify(ids)) return { doc, effects, message: '顺序没有变化' };
      if (canOrder(actor, doc, kind)) {
        applyOrder(doc, kind, ids);
        addLog(doc, now, 'reorder', { kind, title: orderTitle(kind) }, '保存新顺序', actor);
        effects.push({ type: 'syncOrder', kind });
        return { doc, effects, message: '顺序已保存,前台按新顺序显示' };
      }
      if (doc.pendingOrder) fail('已经有一个顺序在等审核');
      doc.pendingOrder = { kind, ids, before, by: actor.id, at: now };
      addLog(doc, now, 'submit', { kind, title: orderTitle(kind) }, '提交新顺序,批准前前台保持原顺序', actor);
      effects.push({ type: 'notify', event: 'submit', order: doc.pendingOrder });
      return { doc, effects, message: '新顺序已提交审核,批准前前台保持原顺序' };
    }

    default:
      fail('未知操作');
  }
  return { doc, effects, message };
}

// 主活动 / 子活动:一个活动要重写进店里时,同一家(主活动 + 所有子活动,改前改后两家都算)也重写一遍
// —— 子活动的实际优先级按兄弟排名算,一个变了别的可能跟着变;页签跟随这些活动的首页模块也重写(活动第一次写进店里才有 id 可引用)
function familySyncs(input, r) {
  const doc = r.doc; if (!doc?.campaigns) return;
  const ids = new Set(r.effects.filter((e) => e.type === 'sync').map((e) => e.id));
  const touched = doc.campaigns.filter((c) => ids.has(c.id));
  if (!touched.length) return;
  const roots = new Set();
  for (const c of touched) {
    roots.add(c.parent || c.id);
    const old = (input.campaigns || []).find((x) => x.id === c.id); if (old?.parent) roots.add(old.parent);
  }
  const fam = doc.campaigns.filter((x) => roots.has(x.id) || roots.has(x.parent));
  const famIds = new Set([...fam.map((x) => x.id), ...touched.map((x) => x.id)]);
  for (const x of fam) if (x.state === 'approved' && !ids.has(x.id)) { r.effects.push({ type: 'sync', id: x.id }); ids.add(x.id); }
  for (const m of doc.pmodules || []) {
    if (m.state === 'approved' && !ids.has(m.id) && (m.tabs || []).some((t) => t.campaign && famIds.has(t.campaign))) { r.effects.push({ type: 'sync', id: m.id }); ids.add(m.id); }
  }
}
// 首页商品模块里跟随这个活动的页签(删活动前要先改掉)
const tabsFollowing = (doc, campaignId) => (doc.pmodules || []).flatMap((m) => (m.tabs || []).filter((t) => t.campaign === campaignId).map((t) => ({ m, t })));

// 挂在活动下、跟随活动时间的内容
export const followersOf = (doc, campaignId) =>
  [...doc.banners, ...doc.topbar, ...doc.tbstyles, ...(doc.pmodules || []), ...(doc.pins || []), ...(doc.salelinks || []), ...(doc.callouts || [])].filter((x) => x.campaign === campaignId && x.start == null && x.end == null);
