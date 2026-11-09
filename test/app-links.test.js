// 每个页面 / 每条内容有自己的网址(2026-11-09):飞书通知的按钮直接打开那一条
import test from 'node:test';
import assert from 'node:assert/strict';
import { appLink, itemPath, planPath, oneOr } from '../src/app-links.js';
import { actionEvents, schedulerEvents, digestEvents } from '../src/notifier.js';
import { eventMessages, reportMessages } from '../src/price/notifier.js';
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

test('网站内容的通知:批准 → 打开那一条;等审批 → 审核页;一次上下线好几条 → 概览', () => {
  const d = doc({ banners: [banner(), banner({ id: 'b2', title: '周末' })] });
  const [dec] = actionEvents(d, { event: 'decision', id: 'b1', approved: true, actor: 'boss', to: 'des' }, { appUrl: APP, now: T });
  assert.equal(dec.card.button.url, `${APP}/banners/b1`);
  const [sub] = actionEvents(d, { event: 'submit', id: 'b1' }, { appUrl: APP, now: T });
  assert.equal(sub.card.button.url, `${APP}/reviews`);
  const one = schedulerEvents(d, { changes: [{ id: 'b1', kind: 'banner', title: '黑五', to: 'ACTIVE' }] }, { appUrl: APP, now: T })[0];
  assert.equal(one.card.button.url, `${APP}/banners/b1`);
  assert.equal(one.cards.des.button.url, `${APP}/banners/b1`);
  const two = schedulerEvents(d, { changes: [{ id: 'b1', kind: 'banner', title: '黑五', to: 'ACTIVE' }, { id: 'b2', kind: 'banner', title: '周末', to: 'PAUSED' }] }, { appUrl: APP, now: T })[0];
  assert.equal(two.card.button.url, APP);
  // 每天 10:00:明天上线的只有一条 → 直接打开它
  const tom = doc({ banners: [banner({ start: T + 20 * H })] });
  const dg = digestEvents(tom, { appUrl: APP, now: Date.UTC(2026, 10, 9, 10, 30) });
  assert.equal(dg[0].card.button.url, `${APP}/banners/b1`);
});

test('改价的通知:打开那个计划;暂停接管 → 受管产品;好几个计划一起失败 → 改价页', () => {
  const plan = (id) => ({ id, name: id, kind: 'window', state: 'approved', owner: 'boss', slots: [{ id: 's1', start: T, end: T + H, items: [] }] });
  const st = { plans: [plan('p1'), plan('p2')], notified: {} };
  assert.equal(eventMessages(st, { event: 'pause', id: 'p1' }, { appUrl: APP, members })[0].card.button.url, `${APP}/price/p1`);
  const rep = { written: [{ planId: 'p1', plan: 'p1', op: 'start' }], collections: [], holds: [{ planId: 'p1', variantId: 'v1', reason: 'manual' }], recovered: [], finished: [],
    failures: [{ planId: 'p1', variantId: 'v1', message: 'x' }, { planId: 'p2', variantId: 'v2', message: 'y' }] };
  const msgs = reportMessages(st, rep, { appUrl: APP, now: T, members });
  const by = (ev) => msgs.find((m) => m.ev === ev).card.button;
  assert.equal(by('price.live').url, `${APP}/price/p1`);
  assert.equal(by('price.hold').url, `${APP}/price/vault`);
  assert.deepEqual(by('price.failure'), { text: '打开改价', url: `${APP}/price` });
});

test('Collection 排序的通知:这个 Collection 只有一份置顶排序 → 打开它', () => {
  const d = doc({ pins: [{ id: 'pn1', kind: 'pin', collection: { id: 'gid://shopify/Collection/42' }, by: 'des' }] });
  const [m] = pinEvents(d, { holds: [{ fresh: true, collection: '42', title: 'Lens' }], failures: [] }, T);
  assert.equal(m.path, '/pins/pn1');
});
