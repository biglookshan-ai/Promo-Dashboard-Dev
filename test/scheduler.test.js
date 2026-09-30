import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 用临时目录当数据卷,测试不碰真实数据
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-sched-'));
process.env.SCHEDULER_DISABLED = '1';
const store = await import('../src/schedule-store.js');
const { runOnce } = await import('../src/scheduler.js');

const SHOP = 'test-shop.myshopify.com';
const H = 3600_000, T = Date.UTC(2026, 9, 1, 12);
function seed(items) {
  store.update(SHOP, (s) => { Object.assign(s, { banners: [], topbar: [], tbstyles: [], campaigns: [], log: [], notified: {} }, items); });
}
const fakeShopify = () => {
  const calls = [];
  return { calls, setStatus: async (ctx, id, status) => { calls.push({ id, status }); return status; } };
};

test('到点上线:已批准且到开始时间的切成 ACTIVE,并记日志', async () => {
  seed({ banners: [{ id: 'b1', kind: 'banner', state: 'approved', title: 'New Lens', start: T, end: null, shopifyId: 'gid://shopify/Metaobject/1', syncedStatus: 'DRAFT' }] });
  const f = fakeShopify();
  const r = await runOnce(SHOP, { now: T + 1, token: 'x', setStatus: f.setStatus });
  assert.deepEqual(f.calls, [{ id: 'gid://shopify/Metaobject/1', status: 'ACTIVE' }]);
  assert.equal(r.changes.length, 1);
  const s = store.load(SHOP);
  assert.equal(s.banners[0].syncedStatus, 'ACTIVE');
  assert.equal(s.log[0].action, 'up');
  assert.equal(s.scheduler.lastChanges, 1);
});

test('状态已经对了就不重复调用 Shopify', async () => {
  const f = fakeShopify();
  await runOnce(SHOP, { now: T + 2, token: 'x', setStatus: f.setStatus });
  assert.equal(f.calls.length, 0);
});

test('到期下线', async () => {
  seed({ topbar: [{ id: 't1', kind: 'topbar', state: 'approved', text: 'Sale', start: T - H, end: T, shopifyId: 'gid://shopify/Metaobject/2', syncedStatus: 'ACTIVE' }] });
  const f = fakeShopify();
  await runOnce(SHOP, { now: T, token: 'x', setStatus: f.setStatus });
  assert.deepEqual(f.calls, [{ id: 'gid://shopify/Metaobject/2', status: 'DRAFT' }]);
});

test('没批准 / 还没写进 Shopify 的不碰', async () => {
  seed({ banners: [
    { id: 'b1', kind: 'banner', state: 'pending', start: null, end: null, shopifyId: 'gid://shopify/Metaobject/3', syncedStatus: 'DRAFT' },
    { id: 'b2', kind: 'banner', state: 'approved', start: null, end: null },
  ] });
  const f = fakeShopify();
  await runOnce(SHOP, { now: T, token: 'x', setStatus: f.setStatus });
  assert.equal(f.calls.length, 0);
});

test('宕机后补跑:错过了上线和下线,恢复后一次对齐', async () => {
  seed({ banners: [
    { id: 'b1', kind: 'banner', state: 'approved', start: T - 5 * H, end: null, shopifyId: 'gid://1', syncedStatus: 'DRAFT' },
    { id: 'b2', kind: 'banner', state: 'approved', start: T - 9 * H, end: T - 2 * H, shopifyId: 'gid://2', syncedStatus: 'ACTIVE' },
  ] });
  const f = fakeShopify();
  await runOnce(SHOP, { now: T, token: 'x', setStatus: f.setStatus });
  assert.deepEqual(f.calls.sort((a, b) => a.id.localeCompare(b.id)), [{ id: 'gid://1', status: 'ACTIVE' }, { id: 'gid://2', status: 'DRAFT' }]);
});

test('跟随活动:活动到点,挂在下面的内容一起上线', async () => {
  seed({
    campaigns: [{ id: 'c1', kind: 'campaign', state: 'approved', name: 'Autumn', start: T, end: T + 5 * H, shopifyId: 'gid://c', syncedStatus: 'DRAFT' }],
    banners: [{ id: 'b1', kind: 'banner', state: 'approved', campaign: 'c1', start: null, end: null, shopifyId: 'gid://b', syncedStatus: 'DRAFT' }],
  });
  const f = fakeShopify();
  await runOnce(SHOP, { now: T, token: 'x', setStatus: f.setStatus });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((c) => c.status === 'ACTIVE'));
});

test('Shopify 报错:记失败、不改本地状态,下一轮会重试', async () => {
  seed({ banners: [{ id: 'b1', kind: 'banner', state: 'approved', title: 'X', start: null, end: null, shopifyId: 'gid://1', syncedStatus: 'DRAFT' }] });
  const r = await runOnce(SHOP, { now: T, token: 'x', setStatus: async () => { throw new Error('Throttled'); } });
  assert.equal(r.failures.length, 1);
  const s = store.load(SHOP);
  assert.equal(s.banners[0].syncedStatus, 'DRAFT');
  assert.equal(s.log[0].action, 'failure');
  assert.match(s.scheduler.lastError, /Throttled/);
  const f = fakeShopify();
  await runOnce(SHOP, { now: T + 60_000, token: 'x', setStatus: f.setStatus });
  assert.equal(f.calls.length, 1);
});

test('没有店铺授权:不调用、记原因', async () => {
  seed({ banners: [{ id: 'b1', kind: 'banner', state: 'approved', start: null, end: null, shopifyId: 'gid://1', syncedStatus: 'DRAFT' }] });
  const f = fakeShopify();
  const r = await runOnce(SHOP, { now: T, token: null, setStatus: f.setStatus });
  assert.equal(f.calls.length, 0);
  assert.equal(r.failures.length, 1);
});

test('飞书:自动上下线发一条汇总消息;没填 webhook 不发', async () => {
  seed({ banners: [{ id: 'b1', kind: 'banner', state: 'approved', title: 'New Lens', start: T, end: null, shopifyId: 'gid://1', syncedStatus: 'DRAFT' }] });
  store.update(SHOP, (s) => { s.settings.larkWebhook = 'https://open.larksuite.com/open-apis/bot/v2/hook/abc'; });
  const cards = [];
  await runOnce(SHOP, { now: T + 1, token: 'x', setStatus: async () => {}, send: async (cfg, card) => { cards.push(card); } });
  assert.equal(cards.length, 1);
  assert.match(cards[0].title, /自动上下线 1 条/);
  store.update(SHOP, (s) => { s.settings.larkWebhook = ''; s.banners[0].syncedStatus = 'DRAFT'; });
  const cards2 = [];
  await runOnce(SHOP, { now: T + 2, token: 'x', setStatus: async () => {}, send: async (c, card) => cards2.push(card) });
  assert.equal(cards2.length, 0);
});

test('飞书:到点还没批准的提醒只发一次', async () => {
  seed({ banners: [{ id: 'b9', kind: 'banner', state: 'pending', title: 'Late', start: T - H, end: null }] });
  store.update(SHOP, (s) => { s.settings.larkWebhook = 'https://open.larksuite.com/open-apis/bot/v2/hook/abc'; });
  const cards = [];
  const send = async (c, card) => cards.push(card);
  await runOnce(SHOP, { now: T, token: 'x', setStatus: async () => {}, send });
  await runOnce(SHOP, { now: T + 60_000, token: 'x', setStatus: async () => {}, send });
  assert.equal(cards.filter((c) => /还没批准/.test(c.title)).length, 1);
});
