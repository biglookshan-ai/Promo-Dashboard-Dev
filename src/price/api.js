// 改价模块的接口(挂在 /api/price 下;server.js 里已经限定:只有能看「改价」页面的人 —— 定价角色和管理员)。
import express from 'express';
import { load, save, withLock } from './store.js';
import { applyAction, ActionError } from './price-actions.js';
import { runOnce } from './executor.js';
import { eventMessages, deliver } from './notifier.js';
import * as catalog from './catalog.js';
import { load as loadSchedule } from '../schedule-store.js';
import { actorOf, isAdmin, canSee } from '../members.js';

const TZ = 'Europe/London';
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'); // 带 BOM,Excel 打开中文不乱码
const tLondon = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(ms));
const numId = (gid) => String(gid || '').split('/').pop();
const toGid = (type, id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${id}`);

// 谁在操作:飞书成员(管理员 = 'approver');没开飞书的旧模式下按单个管理员处理
const actorOfReq = (req) => (req.ctx.member ? actorOf(req.ctx.member) : { id: req.ctx.user || 'admin-token', name: '管理员', role: 'approver' });
// 能被选成审批人 / 负责人 / 抄送的人:启用中、能看改价页面的成员
function pricePeople(shop) {
  const s = loadSchedule(shop);
  return (s.members || []).filter((m) => m.status === 'active' && canSee(s, m, 'price')).map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, admin: isAdmin(m) }));
}

export function priceRouter() {
  const r = express.Router();
  const wrap = (fn) => async (req, res) => {
    try { const out = await fn(req, res); if (out !== undefined) res.json(out); }
    catch (e) {
      if (e instanceof ActionError) return res.status(400).json({ error: e.message });
      console.error('[price]', e); res.status(500).json({ error: String(e.message || e) });
    }
  };
  const needAdmin = (req) => { if (actorOfReq(req).role !== 'approver') throw new ActionError('只有管理员能做这个操作'); };

  r.get('/state', wrap(async (req) => {
    const state = load(req.ctx.shop);
    const me = actorOfReq(req);
    const appUrl = loadSchedule(req.ctx.shop).appUrl || '';
    if (appUrl && state.appUrl !== appUrl) { state.appUrl = appUrl; save(req.ctx.shop, state); }
    return {
      me: { id: me.id, name: me.name, admin: me.role === 'approver' }, people: pricePeople(req.ctx.shop),
      plans: state.plans, vault: Object.entries(state.vault).map(([id, v]) => ({ id, ...v })), collState: state.collState,
      log: state.log.slice(0, 300), engine: state.engine, ledgerCount: state.ledger.length,
      settings: { maxDiscountPct: state.settings.maxDiscountPct, sweepMinutes: state.settings.sweepMinutes, notify: state.settings.notify },
    };
  }));

  r.post('/act', wrap(async (req) => {
    const shop = req.ctx.shop;
    const out = await withLock(shop, async () => {
      const state = load(shop);
      const part = { plans: state.plans, vault: state.vault, log: state.log, settings: state.settings };
      const { doc, effects, message, id } = applyAction(part, req.body?.action || {}, actorOfReq(req), Date.now());
      Object.assign(state, { plans: doc.plans, vault: doc.vault, log: doc.log });
      save(shop, state);
      const members = loadSchedule(shop).members || [];
      const msgs = effects.filter((e) => e.type === 'notify').flatMap((e) => eventMessages(state, e, { appUrl: state.appUrl, members }));
      return { state, effects, message, id, msgs };
    });
    if (out.msgs.length) deliver(out.state, out.msgs).catch((e) => console.error('[lark-dm]', e.message));
    if (out.effects.some((e) => e.type === 'run')) runOnce(shop, { token: req.ctx.token }).catch((e) => console.error('[executor]', e));
    return { ok: true, message: out.message, id: out.id };
  }));

  r.post('/run-now', wrap(async (req) => {
    needAdmin(req);
    const rep = await runOnce(req.ctx.shop, { token: req.ctx.token });
    return { written: rep.written.length, holds: rep.holds.length, failures: rep.failures.length };
  }));

  // ---- 账本 / 导出 ----
  r.get('/ledger', wrap((req) => {
    const state = load(req.ctx.shop);
    const qtext = String(req.query.q || '').toLowerCase();
    let rows = state.ledger;
    if (req.query.plan) rows = rows.filter((x) => x.planId === req.query.plan);
    if (req.query.variant) rows = rows.filter((x) => x.variantId === req.query.variant);
    if (qtext) rows = rows.filter((x) => `${x.title} ${x.sku} ${x.plan}`.toLowerCase().includes(qtext));
    const offset = Number(req.query.offset) || 0; const limit = Math.min(Number(req.query.limit) || 100, 500);
    return { total: rows.length, rows: rows.slice(offset, offset + limit) };
  }));
  // 还原表格:app 万一挂了,照这张表在后台手工改回原价
  r.get('/export/vault.csv', wrap((req, res) => {
    const state = load(req.ctx.shop);
    const plan = (id) => state.plans.find((p) => p.id === id)?.name || '';
    const rows = [['产品', 'SKU', '变体ID', '产品ID', '原价', '原划线价', '现在的活动价', '现在的划线价', '计划', '状态']];
    for (const [id, v] of Object.entries(state.vault)) {
      rows.push([v.title, v.sku, numId(id), numId(v.productId), v.base?.price, v.base?.compareAt, v.written?.price, v.written?.compareAt,
        plan(v.written?.planId || v.hold?.planId), v.hold ? '暂停接管(需处理)' : v.intent ? '正在改' : '接管中']);
    }
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="price-restore.csv"').send(csv(rows));
  }));
  r.get('/export/ledger.csv', wrap((req, res) => {
    const state = load(req.ctx.shop);
    let rows = state.ledger;
    if (req.query.plan) rows = rows.filter((x) => x.planId === req.query.plan);
    const out = [['时间(英国)', '产品', 'SKU', '变体ID', '动作', '原售价', '原划线价', '新售价', '新划线价', '计划', '备注']];
    const OP = { start: '开始活动价', switch: '换时段价', restore: '恢复原价', permanent: '永久调价' };
    for (const x of rows) out.push([tLondon(x.at), x.title, x.sku, numId(x.variantId), OP[x.op] || x.op, x.from?.price, x.from?.compareAt, x.to?.price, x.to?.compareAt, x.plan, x.note]);
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="price-ledger.csv"').send(csv(out));
  }));

  // ---- 选产品 ----
  r.get('/catalog/products', wrap((req) => catalog.productsByIds(req.ctx, String(req.query.ids || '').split(',').filter(Boolean)).then((products) => ({ products }))));
  r.get('/catalog/collection', wrap((req) => catalog.collectionProducts(req.ctx, String(req.query.id || ''))));
  r.get('/catalog/search', wrap((req) => catalog.searchProducts(req.ctx, { vendor: req.query.vendor, tag: req.query.tag, type: req.query.type, all: req.query.all === '1' })));
  r.get('/catalog/collections', wrap((req) => catalog.findCollections(req.ctx, String(req.query.q || '')).then((collections) => ({ collections }))));
  r.get('/catalog/vendors', wrap((req) => catalog.vendors(req.ctx).then((vendors) => ({ vendors }))));
  // 本 app 的活动(排期里的活动,含还没批准的)
  const campaignsOf = (shop) => (loadSchedule(shop).campaigns || []).map((c) => ({ id: c.id, name: c.name || '未命名活动', start: c.start, end: c.end, state: c.state, collections: c.collections || [], tags: c.tags || [], products: c.products || [] }));
  r.get('/campaigns', wrap((req) => ({ campaigns: campaignsOf(req.ctx.shop).map(({ id, name, start, end, state }) => ({ id, name, start, end, state })) })));
  // 某个活动圈定的产品(合集 + 标签 + 指定产品,合起来去重)——活动和改价只圈一次
  r.get('/catalog/campaign', wrap(async (req) => {
    const camp = campaignsOf(req.ctx.shop).find((c) => c.id === req.query.id);
    if (!camp) throw new ActionError('找不到这个活动');
    const map = new Map();
    for (const c of camp.collections) for (const p of (await catalog.collectionProducts(req.ctx, toGid('Collection', c.id || c))).products) map.set(p.id, p);
    for (const tag of camp.tags) for (const p of (await catalog.searchProducts(req.ctx, { tag })).products) map.set(p.id, p);
    if (camp.products.length) for (const p of await catalog.productsByIds(req.ctx, camp.products.map((p) => toGid('Product', p.id || p)))) map.set(p.id, p);
    return { campaign: { id: camp.id, name: camp.name }, products: [...map.values()] };
  }));

  // ---- 改价的设置(管理员):降幅上限、巡检间隔、通知开关 ----
  r.put('/settings', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const state = load(req.ctx.shop); const b = req.body || {}; const s = state.settings;
    if (b.maxDiscountPct != null) { const v = Number(b.maxDiscountPct); if (!(v > 0 && v < 100)) throw new ActionError('降幅上限要在 1–99 之间'); s.maxDiscountPct = v; }
    if (b.sweepMinutes != null) { const v = Number(b.sweepMinutes); if (!(v >= 1 && v <= 60)) throw new ActionError('巡检间隔要在 1–60 分钟之间'); s.sweepMinutes = v; }
    if (b.notify) s.notify = { ...s.notify, ...Object.fromEntries(Object.entries(b.notify).map(([k, v]) => [k, !!v])) };
    save(req.ctx.shop, state);
    return { ok: true };
  })));

  return r;
}
