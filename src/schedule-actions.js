// 排期系统的所有「动作」:存草稿 / 提交审核 / 发布 / 批准 / 退回 / 暂停 / 删除 / 调整顺序。
// 纯函数,服务器和浏览器共用同一份(浏览器通过 /lib/schedule-actions.js 加载)——
// 演示模式在浏览器里直接跑,正式模式由服务器跑并检查权限,规则只有这一处。
//
// doc 结构:{ banners, topbar, tbstyles, campaigns, pendingOrder, log, staff: [{id,name,role}] }
// actor:{ id, name, role: 'approver' | 'editor' }
// 返回 { doc, effects, message }。effects 交给服务器执行(写 Shopify / 发飞书),浏览器演示模式忽略。
import { itemStatus, campaignIndex } from './schedule-core.js';

export const LIST = { banner: 'banners', topbar: 'topbar', tbstyle: 'tbstyles', campaign: 'campaigns', pmodule: 'pmodules', pin: 'pins', design: 'designs', material: 'materials' };
export const KIND_CN = { banner: 'Banner', topbar: '顶栏公告', tbstyle: '顶栏样式', campaign: '活动', pmodule: '首页商品模块', pin: '合集置顶清单', design: '设计需求', material: '宣传物料' };
// 只存在 app 里、不写进 Shopify 的工作项(审批流程一样,批准了也不上线 / 下线)
export const APP_ONLY = ['design', 'material'];
export const CHANNEL_CN = { email: '邮件营销', social: '社媒帖子' };
export const MODULE_CN = { sale: '促销模块', feature: '推荐 / 新品模块' };
export const ORDERABLE = ['banner', 'topbar'];

// 可编辑字段(审核对比、修改待审核都以它为准)
export const EDIT_KEYS = ['image', 'imageId', 'title', 'subtitle', 'description', 'button1_text', 'button1_url', 'button2_text', 'button2_url', 'tag',
  'emoji', 'text', 'link', 'category', 'name', 'collections', 'tags', 'products', 'badge', 'countdown', 'priority',
  'bg', 'color', 'accent', 'effect', 'decoLeft', 'decoRight', 'start', 'end', 'campaign',
  'module', 'title2', 'titleColor', 'title2Color', 'tabActiveBg', 'tabActiveText', 'tabs', 'isDefault',
  // v3 活动总控台的工作项:合集置顶清单 / 设计需求 / 宣传物料
  'collection', 'onlyListed', 'brief', 'spec', 'refs', 'due', 'assignee', 'target', 'deliverables', 'chosen',
  'channel', 'platform', 'subject', 'copy', 'assets', 'publishAt', 'owner', 'note'];

export class ActionError extends Error {}
const fail = (msg) => { throw new ActionError(msg); };

export const titleOf = (it) => (it.kind === 'banner' ? (it.title || '未命名 Banner')
  : it.kind === 'topbar' ? `${it.emoji || ''} ${it.text || ''}`.trim() || '未命名公告' : it.name || '未命名');
export const allOf = (doc) => [...doc.campaigns, ...doc.banners, ...doc.topbar, ...doc.tbstyles, ...(doc.pmodules || []), ...(doc.pins || []), ...(doc.designs || []), ...(doc.materials || [])];
export const findItem = (doc, id) => allOf(doc).find((x) => x.id === id);
const isApprover = (actor) => actor?.role === 'approver';

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

export function validate(it) {
  if (it.kind === 'banner' && !it.image) return '请选一张图片';
  if (it.kind === 'topbar' && !String(it.text || '').trim()) return '请填写公告文字';
  if ((it.kind === 'campaign' || it.kind === 'tbstyle') && !String(it.name || '').trim()) return '请填写名称';
  if (it.kind === 'campaign' && it.start == null) return '活动需要开始时间';
  if (it.kind === 'pmodule') {
    if (!['sale', 'feature'].includes(it.module)) return '请选择是哪个模块';
    if (!(it.tabs || []).length) return '至少要有一个页签';
    for (const [i, t] of it.tabs.entries()) {
      if (t.source === 'products' ? !(t.products || []).length : !t.collection) return `第 ${i + 1} 个页签还没选${t.source === 'products' ? '产品' : '合集'}`;
    }
  }
  if (it.kind === 'pin') {
    if (!it.collection?.id) return '请选要排序的合集';
    if (!(it.products || []).length) return '至少放一个要排在前面的产品';
  }
  if (it.kind === 'design' && !String(it.name || '').trim()) return '请填写设计需求的标题';
  if (it.kind === 'design' && !(it.deliverables || []).length) return '还没上传设计稿;先存需求,交稿时再提交审核';
  if (it.kind === 'material') {
    if (!String(it.name || '').trim()) return '请填写物料标题';
    if (!CHANNEL_CN[it.channel]) return '请选择是邮件还是社媒帖子';
  }
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

export function applyAction(input, action, actor, now = Date.now()) {
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
      const merged = { ...it, ...v };
      if (mode !== 'draft') { const err = validate(merged); if (err) fail(err); }
      if (kind === 'pmodule' && merged.isDefault && list.some((x) => x !== it && x.isDefault && x.module === merged.module)) fail('这个模块已经有平时版本了');
      const approved = it.state === 'approved';

      if (mode === 'draft') {
        if (approved) fail('已批准的内容不能存草稿;要改就提交修改审核');
        Object.assign(it, v, { state: 'draft' });
        if (isNew) list.push(it);
        addLog(doc, now, 'draft', it, '', actor);
        message = '已存草稿';
      } else if (mode === 'submit') {
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
      } else if (mode === 'publish') {
        if (!isApprover(actor)) fail('只有审核人能直接发布,请提交审核');
        if (kind === 'design' && !approved) fail('设计需求要先交稿、提交审核,批准后才算完成');
        const wasNew = !approved;
        Object.assign(it, v, { state: 'approved', pendingChange: null, rejectNote: null, lastReject: null });
        if (isNew) list.push(it);
        addLog(doc, now, wasNew ? 'approve' : 'edit', it, wasNew ? '审核人自己排期(自动批准)' : '审核人直接修改', actor);
        effects.push({ type: 'sync', id: it.id });
        if (kind === 'campaign') followersOf(doc, it.id).forEach((f) => effects.push({ type: 'sync', id: f.id }));
        message = '已保存';
      } else fail('未知的保存方式');
      return { doc, effects, message, id: it.id };
    }

    case 'approve': {
      if (!isApprover(actor)) fail('只有审核人能批准');
      if (action.id === '__order') {
        const o = doc.pendingOrder || fail('没有待审核的顺序');
        applyOrder(doc, o.kind, o.ids); doc.pendingOrder = null;
        addLog(doc, now, 'approve', { kind: o.kind, title: orderTitle(o.kind) }, '批准新顺序', actor);
        effects.push({ type: 'syncOrder', kind: o.kind }, { type: 'notify', event: 'decision', order: o, approved: true });
        return { doc, effects, message: '已批准新顺序' };
      }
      const it = findItem(doc, action.id) || fail('找不到这条内容');
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
      effects.push({ type: 'sync', id: it.id });
      if (it.kind === 'campaign') followersOf(doc, it.id).forEach((f) => effects.push({ type: 'sync', id: f.id }));
      return { doc, effects, message: '已批准', id: it.id };
    }

    case 'reject': {
      if (!isApprover(actor)) fail('只有审核人能退回');
      const note = String(action.note || '').trim();
      if (action.id === '__order') {
        const o = doc.pendingOrder || fail('没有待审核的顺序');
        doc.pendingOrder = null;
        addLog(doc, now, 'reject', { kind: o.kind, title: orderTitle(o.kind) }, '退回新顺序:' + note, actor);
        effects.push({ type: 'notify', event: 'decision', order: o, approved: false, note });
        return { doc, effects, message: '已退回' };
      }
      const it = findItem(doc, action.id) || fail('找不到这条内容');
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
      if (!isApprover(actor)) fail('只有审核人能暂停 / 恢复');
      const it = findItem(doc, action.id) || fail('找不到这条内容');
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
      if (APP_ONLY.includes(it.kind)) { if (s === 'pending') fail('还在等审批,先批准或退回再删'); }
      else if (!['draft', 'rejected', 'ended'].includes(s)) fail('只能删除草稿、被退回或已结束的内容');
      if (!isApprover(actor) && it.by !== actor.id) fail('只能删除自己建的内容');
      if (it.kind === 'campaign' && followersOf(doc, it.id).length) fail('还有 Banner / 顶栏挂在这个活动下,先把它们改成别的时间方式');
      const list = L(it.kind); list.splice(list.indexOf(it), 1);
      addLog(doc, now, 'delete', it, '', actor);
      if (it.shopifyId) effects.push({ type: 'remove', shopifyId: it.shopifyId });
      for (const tab of it.tabs || []) if (tab.shopifyId) effects.push({ type: 'remove', shopifyId: tab.shopifyId });
      return { doc, effects, message: '已删除' };
    }

    case 'markPublished': {
      const it = findItem(doc, action.id) || fail('找不到这条内容');
      if (it.kind !== 'material') fail('只有宣传物料需要标记发布');
      if (it.state !== 'approved') fail('批准后才能标记已发布');
      if (!isApprover(actor) && it.by !== actor.id && it.owner !== actor.id) fail('只有负责人或审核人能标记');
      it.publishedAt = action.undo ? null : now; it.publishedUrl = action.undo ? '' : String(action.url || '').trim();
      addLog(doc, now, 'publish', it, action.undo ? '撤销「已发布」' : `已发布${it.publishedUrl ? ':' + it.publishedUrl : ''}`, actor);
      return { doc, effects, message: action.undo ? '已撤销' : '已标记为已发布', id: it.id };
    }

    case 'order': {
      const { kind, ids } = action;
      if (!ORDERABLE.includes(kind)) fail('这类内容不能排序');
      const before = orderPipeline(doc, kind, now).map((x) => x.id);
      if (!Array.isArray(ids) || ids.length !== before.length || !before.every((id) => ids.includes(id))) fail('顺序里的内容和现在对不上(可能刚有变化),请刷新后再排');
      if (JSON.stringify(before) === JSON.stringify(ids)) return { doc, effects, message: '顺序没有变化' };
      if (isApprover(actor)) {
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

// 挂在活动下、跟随活动时间的内容
export const followersOf = (doc, campaignId) =>
  [...doc.banners, ...doc.topbar, ...doc.tbstyles, ...(doc.pmodules || []), ...(doc.pins || [])].filter((x) => x.campaign === campaignId && x.start == null && x.end == null);
