// 每个页面 / 每条内容有自己的网址(2026-11-09):飞书通知的按钮直接打开那一条
import test from 'node:test';
import assert from 'node:assert/strict';
import { appLink, itemPath, planPath, oneOr } from '../src/app-links.js';
import { actionEvents, schedulerEvents, digestEvents, changeEvents } from '../src/notifier.js';
import { eventMessages, reportMessages, planChangeEvents } from '../src/price/notifier.js';
import { EV, renderCard, defaultStyle } from '../src/notify-catalog.js';
import { pinEvents } from '../src/scheduler.js';

const APP = 'https://admin.shopify.com/store/cinegearpro/apps/promo-dashboard-dev';
const T = Date.UTC(2026, 10, 9, 12), H = 3600000;
const members = [{ id: 'boss', name: '老板', status: 'active', roles: ['admin'] }, { id: 'des', name: '设计', status: 'active', roles: ['design'] }];
const doc = (o = {}) => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], pmodules: [], pins: [], salelinks: [], callouts: [], log: [], staff: [], members, settings: { notify: {} }, notified: {}, ...o });
const banner = (o = {}) => ({ id: 'b1', kind: 'banner', state: 'approved', image: 'x.jpg', title: '黑五', order: 0, start: null, end: null, campaign: null, by: 'des', ...o });

test('网址:后台地址后面接 app 里的网址;首页不加斜杠;没有后台地址就不给', () => {
  assert.equal(appLink(APP + '/', '/banners/b1'), `${APP}/banners/b1`);
  assert.equal(appLink(APP, '/'), APP);
  assert.equal(appLink('', '/price'), '');
  assert.equal(itemPath({ kind: 'tbstyle', id: 's 1' }), '/topbar/s%201');
  assert.equal(itemPath({ kind: 'campaign', id: 'c1' }), '/campaigns/c1');
  assert.equal(planPath('p1'), '/price/p1');
  assert.equal(planPath('-'), '/price');
  assert.equal(oneOr(['/a', '/a', null], '/'), '/a');
  assert.equal(oneOr(['/a', '/b'], '/'), '/');
});

// 2026-11-09 消息中心 v2:模块只给这一条的网址(path),按钮由消息中心按样式拼(打开这一条 / 打开列表…)
const btnUrl = (m) => renderCard(EV[m.ev], defaultStyle(EV[m.ev]), m.data, { url: (p) => appLink(APP, p), path: m.path }).buttons[0]?.url;
test('网站内容的通知:批准 → 打开那一条;等审批 → 审核页;每日提醒 → 概览', () => {
  const d = doc({ banners: [banner(), banner({ id: 'b2', title: '周末' })] });
  const [dec] = actionEvents(d, { event: 'decision', id: 'b1', approved: true, actor: 'boss', to: 'des' }, { now: T });
  assert.equal(btnUrl(dec), `${APP}/banners/b1`);
  const [sub] = actionEvents(d, { event: 'submit', id: 'b1' }, { now: T });
  assert.equal(btnUrl(sub), `${APP}/reviews`);
  const ups = schedulerEvents(d, { changes: [{ id: 'b1', kind: 'banner', title: '黑五', to: 'ACTIVE' }, { id: 'b2', kind: 'banner', title: '周末', to: 'PAUSED' }] }, { now: T });
  assert.deepEqual(ups.map((m) => [m.ev, m.path]), [['banner.live', '/banners/b1'], ['banner.off', '/banners/b2']]);
  assert.equal(btnUrl(ups[0]), `${APP}/banners/b1`);
  const tom = doc({ banners: [banner({ start: T + 20 * H })] });
  const dg = digestEvents(tom, { now: Date.UTC(2026, 10, 9, 10, 30) });
  assert.equal(btnUrl(dg[0]), APP);
});

test('改价的通知:打开那个计划;暂停接管 → 受管产品;好几个计划一起失败 → 每个计划一条', () => {
  const plan = (id) => ({ id, name: id, kind: 'window', state: 'approved', owner: 'boss', slots: [{ id: 's1', start: T, end: T + H, items: [] }] });
  const st = { plans: [plan('p1'), plan('p2')], notified: {} };
  assert.equal(btnUrl(eventMessages(st, { event: 'pause', id: 'p1' }, { members })[0]), `${APP}/price/p1`);
  const rep = { written: [{ planId: 'p1', plan: 'p1', op: 'start', title: '镜头' }], collections: [], holds: [{ planId: 'p1', variantId: 'v1', reason: 'manual' }], recovered: [], finished: [],
    failures: [{ planId: 'p1', variantId: 'v1', message: 'x' }, { planId: 'p2', variantId: 'v2', message: 'y' }] };
  const msgs = reportMessages(st, rep, { now: T, members });
  const by = (ev) => msgs.find((m) => m.ev === ev);
  assert.equal(btnUrl(by('price.live')), `${APP}/price/p1`);
  assert.deepEqual(by('price.live').data.products, ['镜头']);
  assert.equal(btnUrl(by('price.hold')), `${APP}/price/vault`);
  assert.deepEqual(msgs.filter((m) => m.ev === 'price.failure').map((m) => m.path), ['/price/p1', '/price/p2']);
});

test('Collection 排序的通知:这个 Collection 只有一份置顶排序 → 打开它', () => {
  const d = doc({ pins: [{ id: 'pn1', kind: 'pin', collection: { id: 'gid://shopify/Collection/42' }, by: 'des' }] });
  const [m] = pinEvents(d, { holds: [{ fresh: true, collection: '42', title: 'Lens' }], failures: [] }, T);
  assert.equal(m.path, '/pins/pn1');
  assert.equal(m.data.collection, 'Lens');
});

test('有人动手:新建 / 修改(写清改了什么)/ 删除 / 暂停;改价计划同样', () => {
  const before = doc({ banners: [banner()] });
  const after = doc({ banners: [banner({ title: '黑五 2', end: T + H })] });
  const [u] = changeEvents(before, after, { type: 'save', id: 'b1' }, 'des', { now: T });
  assert.equal(u.ev, 'banner.updated'); assert.equal(u.actor, 'des'); assert.equal(u.data.changes, '标题、结束时间'); assert.equal(u.data.actor, '设计');
  const [c] = changeEvents(doc(), after, { type: 'save', isNew: true }, 'des', { now: T, id: 'b1' });
  assert.equal(c.ev, 'banner.created');
  const [del] = changeEvents(before, doc(), { type: 'delete', id: 'b1' }, 'des', { now: T });
  assert.deepEqual([del.ev, del.path, del.data.name], ['banner.deleted', '/banners', '黑五']);
  const [o] = changeEvents(before, after, { type: 'order', kind: 'banner' }, 'des', { now: T });
  assert.equal(o.ev, 'banner.order');
  const p0 = { id: 'p1', name: '黑五', kind: 'window', slots: [{ id: 's', start: T, end: T + H, items: [] }], groups: [{ rule: { mode: 'percent_off', value: 15 } }] };
  const p1 = { ...p0, groups: [{ rule: { mode: 'percent_off', value: 20 } }] };
  const [pu] = planChangeEvents([p0], [p1], { type: 'save', id: 'p1' }, 'boss', { members });
  assert.deepEqual([pu.ev, pu.data.changes, pu.data.discount, pu.path], ['price.updated', '改价分组 / 折扣', '降 20%', '/price/p1']);
  assert.equal(planChangeEvents([], [p0], { type: 'save', isNew: true }, 'boss', { members, id: 'p1' })[0].ev, 'price.created');
});
