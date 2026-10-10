import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundCents, priceByRule, targetFor, pair, samePair, planStatus, assignmentAt, indexItems,
  planWork, decide, commit, holdVariant, sweep, finishPlans, itemWarnings, overlaps, discountPct,
} from '../src/price/price-core.js';
import * as core0 from '../src/price/price-core.js';

const H = 3600_000;
const item = (variantId, price, extra = {}) => ({ variantId, productId: `P-${variantId}`, title: variantId, price, refPrice: '100.00', refCompareAt: null, ...extra });
const plan = (id, layer, slots, extra = {}) => ({ id, name: id, kind: 'window', layer, state: 'approved', approvedAt: 1, paused: false, stopped: false, excluded: [], applied: {}, slots, ...extra });
const slot = (id, start, end, items) => ({ id, start, end, items });

// 模拟一个店铺:变体 → 现价。tick 跑一轮执行器(规则部分),把要写的直接写进「店铺」
function makeShop(prices) {
  const m = new Map(Object.entries(prices).map(([v, p]) => [v, { productId: `P-${v}`, ...(typeof p === 'string' ? { price: p, compareAt: null } : p) }]));
  return m;
}
function tick(state, shop, now) {
  const ops = planWork(state, now);
  const res = decide(state, ops, shop);
  for (const w of res.writes) { shop.set(w.variantId, { ...shop.get(w.variantId), ...w.to }); commit(state, w, now); }
  for (const d of res.done) commit(state, d, now);
  for (const h of res.holds) holdVariant(state, h, now);
  finishPlans(state, now);
  return res;
}
const priceOf = (shop, v) => pair(shop.get(v).price, shop.get(v).compareAt);

test('尾数:.99 向下、整数向下,取完不能 ≤ 0', () => {
  assert.equal(roundCents(8540, '99'), 8499);
  assert.equal(roundCents(8599, '99'), 8599);
  assert.equal(roundCents(8600, '99'), 8599);
  assert.equal(roundCents(8540, '00'), 8500);
  assert.equal(roundCents(50, '99'), 50);
  assert.equal(roundCents(8540, ''), 8540);
});

test('按规则算价:打折 / 减金额 / 指定价 / 涨价 / 按划线价算', () => {
  const b = { price: '100.00', compareAt: '120.00' };
  assert.equal(priceByRule(b, { mode: 'percent_off', value: 15 }), '85.00');
  assert.equal(priceByRule(b, { mode: 'percent_off', value: 15, rounding: '99' }), '84.99');
  assert.equal(priceByRule(b, { mode: 'percent_off', value: 20, from: 'compare' }), '96.00');
  assert.equal(priceByRule(b, { mode: 'amount_off', value: 30 }), '70.00');
  assert.equal(priceByRule(b, { mode: 'fixed', value: 59.5, rounding: '99' }), '59.50'); // 指定价不取整
  assert.equal(priceByRule(b, { mode: 'percent_up', value: 5 }), '105.00');
  assert.equal(priceByRule(b, { mode: 'keep' }), '100.00');
  assert.equal(priceByRule(b, { mode: 'amount_off', value: 500 }), '0.00');
  assert.throws(() => priceByRule(b, { mode: 'percent_off', value: 100 }));
  assert.throws(() => priceByRule(b, { mode: 'percent_off', value: 'abc' }));
});

test('划线价:显示原价取原价和原划线价里高的;不动 / 清空 / 指定', () => {
  const base = { price: '100.00', compareAt: '120.00' };
  const p = (compare) => ({ kind: 'window', compare });
  assert.deepEqual(targetFor(base, p('original'), { price: '85.00' }), { price: '85.00', compareAt: '120.00' });
  assert.deepEqual(targetFor({ price: '100.00', compareAt: null }, p('original'), { price: '85.00' }), { price: '85.00', compareAt: '100.00' });
  assert.deepEqual(targetFor(base, p('keep'), { price: '85.00' }), { price: '85.00', compareAt: '120.00' });
  assert.deepEqual(targetFor(base, p('clear'), { price: '85.00' }), { price: '85.00', compareAt: null });
  assert.deepEqual(targetFor(base, p('set'), { price: null, compareAt: '150' }), { price: '100.00', compareAt: '150.00' });
  // 永久计划默认不动划线价
  assert.deepEqual(targetFor(base, { kind: 'permanent' }, { price: '110.00' }), { price: '110.00', compareAt: '120.00' });
  // 「显示原价」但新价反而更高 → 不显示划线价
  assert.deepEqual(targetFor({ price: '100.00', compareAt: null }, p('original'), { price: '120.00' }), { price: '120.00', compareAt: null });
});

test('价格比较:划线价 0 / 空 / null 视为一样', () => {
  assert.ok(samePair({ price: '10', compareAt: '0.00' }, { price: '10.00', compareAt: null }));
  assert.ok(!samePair({ price: '10', compareAt: '12' }, { price: '10.00', compareAt: null }));
  assert.equal(discountPct('100.00', '85.00'), 15);
});

test('计划状态', () => {
  const p = plan('a', 'sitewide', [slot('s1', 10 * H, 20 * H, [item('v1', '85.00')])]);
  assert.equal(planStatus({ ...p, state: 'draft' }, 0), 'draft');
  assert.equal(planStatus({ ...p, state: 'pending' }, 0), 'pending');
  assert.equal(planStatus(p, 5 * H), 'scheduled');
  assert.equal(planStatus(p, 15 * H), 'running');
  assert.equal(planStatus({ ...p, paused: true }, 15 * H), 'paused');
  assert.equal(planStatus(p, 20 * H), 'ended');
  assert.equal(planStatus({ ...p, stopped: true }, 15 * H), 'ended');
  const perm = { ...p, kind: 'permanent', slots: [slot('s', 10 * H, null, [item('v1', '110.00')])] };
  assert.equal(planStatus(perm, 15 * H), 'running');
  assert.equal(planStatus({ ...perm, done: true }, 15 * H), 'done');
});

test('层级:Flash 盖过全场;同层开始晚的优先;暂停的不算', () => {
  const site = plan('site', 'sitewide', [slot('s', 0, 100 * H, [item('v1', '85.00')])]);
  const flash = plan('flash', 'flash', [slot('d1', 24 * H, 48 * H, [item('v1', '70.00')])]);
  const idx = indexItems([site, flash]);
  assert.equal(assignmentAt(idx.get('v1'), 10 * H).plan.id, 'site');
  assert.equal(assignmentAt(idx.get('v1'), 30 * H).plan.id, 'flash');
  assert.equal(assignmentAt(idx.get('v1'), 50 * H).plan.id, 'site');
  flash.paused = true;
  assert.equal(assignmentAt(indexItems([site, flash]).get('v1'), 30 * H).plan.id, 'site');
  const later = plan('later', 'sitewide', [slot('s2', 5 * H, 100 * H, [item('v1', '80.00')])]);
  assert.equal(assignmentAt(indexItems([site, later]).get('v1'), 10 * H).plan.id, 'later');
});

test('完整促销:全场 85 折 + 两天 Flash + 结束恢复原价(含原有划线价)', () => {
  const shop = makeShop({ v1: '100.00', v2: { price: '200.00', compareAt: '250.00' }, v3: '50.00' });
  const site = plan('site', 'sitewide', [slot('s', 10 * H, 100 * H, [item('v1', '85.00'), item('v2', '170.00', { refPrice: '200.00', refCompareAt: '250.00' })])]);
  const flash = plan('flash', 'flash', [
    slot('d1', 24 * H, 48 * H, [item('v1', '70.00'), item('v3', '35.00', { refPrice: '50.00' })]),
    slot('d2', 48 * H, 72 * H, [item('v2', '140.00', { refPrice: '200.00' })]),
  ]);
  const state = { plans: [site, flash], vault: {} };

  tick(state, shop, 5 * H); // 还没开始
  assert.deepEqual(priceOf(shop, 'v1'), { price: '100.00', compareAt: null });

  tick(state, shop, 10 * H); // 全场开始
  assert.deepEqual(priceOf(shop, 'v1'), { price: '85.00', compareAt: '100.00' });
  assert.deepEqual(priceOf(shop, 'v2'), { price: '170.00', compareAt: '250.00' });
  assert.deepEqual(state.vault.v2.base, { price: '200.00', compareAt: '250.00' });
  assert.equal(tick(state, shop, 11 * H).writes.length, 0); // 没变化就不写

  tick(state, shop, 24 * H); // Flash 第 1 天
  assert.deepEqual(priceOf(shop, 'v1'), { price: '70.00', compareAt: '100.00' });
  assert.deepEqual(priceOf(shop, 'v3'), { price: '35.00', compareAt: '50.00' });
  assert.deepEqual(priceOf(shop, 'v2'), { price: '170.00', compareAt: '250.00' });

  tick(state, shop, 48 * H); // Flash 第 2 天:v1 回全场价、v3 恢复原价、v2 换 Flash 价
  assert.deepEqual(priceOf(shop, 'v1'), { price: '85.00', compareAt: '100.00' });
  assert.deepEqual(priceOf(shop, 'v3'), { price: '50.00', compareAt: null });
  assert.equal(state.vault.v3, undefined);
  assert.deepEqual(priceOf(shop, 'v2'), { price: '140.00', compareAt: '250.00' });

  tick(state, shop, 72 * H);
  assert.deepEqual(priceOf(shop, 'v2'), { price: '170.00', compareAt: '250.00' });

  tick(state, shop, 100 * H); // 全部结束
  assert.deepEqual(priceOf(shop, 'v1'), { price: '100.00', compareAt: null });
  assert.deepEqual(priceOf(shop, 'v2'), { price: '200.00', compareAt: '250.00' });
  assert.deepEqual(state.vault, {}); // 残留为 0
});

test('服务器停了一整天:恢复后第一轮直接对齐到当下应有的价', () => {
  const shop = makeShop({ v1: '100.00' });
  const site = plan('site', 'sitewide', [slot('s', 0, 100 * H, [item('v1', '85.00')])]);
  const flash = plan('flash', 'flash', [slot('d1', 24 * H, 48 * H, [item('v1', '70.00')])]);
  const state = { plans: [site, flash], vault: {} };
  tick(state, shop, 1 * H);
  tick(state, shop, 60 * H); // 错过了整个 Flash
  assert.deepEqual(priceOf(shop, 'v1'), { price: '85.00', compareAt: '100.00' });
  assert.deepEqual(state.vault.v1.base, { price: '100.00', compareAt: null }); // 原价没被污染
});

test('活动期间有人手动改价:暂停接管,结束时也不覆盖', () => {
  const shop = makeShop({ v1: '100.00' });
  const site = plan('site', 'sitewide', [slot('s', 0, 10 * H, [item('v1', '85.00')])]);
  const state = { plans: [site], vault: {} };
  tick(state, shop, 1 * H);
  shop.set('v1', { ...shop.get('v1'), price: '79.00' }); // 同事手动改了
  const r = tick(state, shop, 10 * H); // 该恢复了
  assert.equal(r.holds.length, 1);
  assert.equal(r.holds[0].reason, 'manual');
  assert.deepEqual(priceOf(shop, 'v1'), { price: '79.00', compareAt: '100.00' });
  assert.ok(state.vault.v1.hold);
  assert.equal(tick(state, shop, 11 * H).writes.length, 0); // 暂停接管后不再动它
});

test('原价后来降到活动价以下:不改,标异常', () => {
  const shop = makeShop({ v1: '80.00' }); // 批准时是 100,开始前被降到 80
  const site = plan('site', 'sitewide', [slot('s', 0, 10 * H, [item('v1', '85.00')])]);
  const state = { plans: [site], vault: {} };
  const r = tick(state, shop, 1 * H);
  assert.equal(r.writes.length, 0);
  assert.equal(r.holds[0].reason, 'not-lower');
  assert.equal(shop.get('v1').price, '80.00');
});

test('永久调价:没在促销 → 直接改;正在促销 → 只改保险库原价,结束后恢复成新价', () => {
  const shop = makeShop({ v1: '100.00', v2: '100.00' });
  const site = plan('site', 'sitewide', [slot('s', 0, 10 * H, [item('v1', '85.00')])]);
  const perm = { ...plan('perm', null, [slot('p', 5 * H, null, [item('v1', '110.00'), item('v2', '120.00')])]), kind: 'permanent' };
  const state = { plans: [site, perm], vault: {} };
  tick(state, shop, 1 * H);
  tick(state, shop, 5 * H);
  assert.equal(shop.get('v2').price, '120.00'); // 不在促销,直接改
  assert.equal(shop.get('v1').price, '85.00'); // 促销价不变
  assert.deepEqual(state.vault.v1.base, { price: '110.00', compareAt: null }); // 原价换成新价
  assert.ok(perm.done);
  tick(state, shop, 10 * H);
  assert.deepEqual(priceOf(shop, 'v1'), { price: '110.00', compareAt: null });
  assert.equal(tick(state, shop, 11 * H).writes.length, 0); // 永久的不会再执行一次
});

test('永久调价和促销同一分钟开始:先落新原价,再套活动价', () => {
  const shop = makeShop({ v1: '100.00' });
  const perm = { ...plan('perm', null, [slot('p', 5 * H, null, [item('v1', '110.00')])]), kind: 'permanent' };
  const site = plan('site', 'sitewide', [slot('s', 5 * H, 10 * H, [item('v1', '90.00')])]);
  const state = { plans: [site, perm], vault: {} };
  tick(state, shop, 5 * H);
  assert.deepEqual(priceOf(shop, 'v1'), { price: '90.00', compareAt: '110.00' });
  tick(state, shop, 10 * H);
  assert.deepEqual(priceOf(shop, 'v1'), { price: '110.00', compareAt: null });
});

test('暂停 / 停止 / 移出产品 → 下一轮恢复原价', () => {
  const shop = makeShop({ v1: '100.00', v2: '100.00' });
  const site = plan('site', 'sitewide', [slot('s', 0, 10 * H, [item('v1', '85.00'), item('v2', '85.00')])]);
  const state = { plans: [site], vault: {} };
  tick(state, shop, 1 * H);
  site.excluded = ['v2'];
  tick(state, shop, 2 * H);
  assert.equal(shop.get('v2').price, '100.00');
  assert.equal(shop.get('v1').price, '85.00');
  site.paused = true;
  tick(state, shop, 3 * H);
  assert.equal(shop.get('v1').price, '100.00');
  site.paused = false;
  tick(state, shop, 4 * H);
  assert.equal(shop.get('v1').price, '85.00');
  site.stopped = true;
  tick(state, shop, 5 * H);
  assert.equal(shop.get('v1').price, '100.00');
  assert.deepEqual(state.vault, {});
});

test('巡检:活动进行中有人改价,马上暂停接管(不等到恢复时)', () => {
  const shop = makeShop({ v1: '100.00', v2: '100.00' });
  const site = plan('site', 'sitewide', [slot('s', 0, 10 * H, [item('v1', '85.00'), item('v2', '85.00')])]);
  const state = { plans: [site], vault: {} };
  tick(state, shop, 1 * H);
  shop.set('v1', { ...shop.get('v1'), compareAt: null }); // 只动了划线价也算
  const holds = sweep(state, shop);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].variantId, 'v1');
  holdVariant(state, holds[0], 2 * H);
  assert.equal(state.vault.v1.hold.planId, 'site');
  assert.equal(sweep(state, shop).length, 0); // 已暂停的不重复报
});

test('变体被删了:列为缺失,不报错', () => {
  const shop = makeShop({});
  const site = plan('site', 'sitewide', [slot('s', 0, 10 * H, [item('v1', '85.00')])]);
  const state = { plans: [site], vault: {} };
  const ops = planWork(state, 1 * H);
  const r = decide(state, ops, shop);
  assert.equal(r.missing.length, 1);
});

test('预览检查:涨价、降幅过大、低于成本、没有划线价', () => {
  const win = { kind: 'window', compare: 'original' };
  assert.equal(itemWarnings(win, item('v', '100.00'))[0].code, 'not-lower');
  assert.equal(itemWarnings(win, item('v', '0'))[0].code, 'zero');
  assert.ok(itemWarnings(win, item('v', '30.00')).some((w) => w.code === 'deep'));
  assert.ok(itemWarnings(win, item('v', '30.00'), { maxDiscountPct: 80 }).every((w) => w.code !== 'deep'));
  assert.ok(itemWarnings(win, item('v', '60.00', { cost: '70.00' })).some((w) => w.code === 'below-cost'));
  assert.ok(itemWarnings({ kind: 'window', compare: 'clear' }, item('v', '80.00')).some((w) => w.code === 'no-strike'));
  assert.deepEqual(itemWarnings(win, item('v', '85.00')), []);
  assert.ok(itemWarnings({ kind: 'permanent' }, item('v', '110.00')).some((w) => w.code === 'up'));
});

test('重叠提示:谁生效', () => {
  const site = plan('site', 'sitewide', [slot('s', 0, 100 * H, [item('v1', '85.00')])]);
  const flash = plan('flash', 'flash', [slot('d1', 24 * H, 48 * H, [item('v1', '70.00')])]);
  const o = overlaps(flash, [site, flash]);
  assert.equal(o.length, 1);
  assert.equal(o[0].wins, true);
  assert.equal(overlaps(site, [site, flash])[0].wins, false);
});

test('跟随活动时间:活动改了时间,计划跟着改;没勾的不动;永久调价不设结束时间', () => {
  const { syncCampaignTimes } = core0;
  const mk = (id, follow, camp) => ({ id, name: id, kind: 'window', followCampaign: follow, campaign: camp, slots: [{ id: 's', start: 100, end: 200, items: [] }] });
  const st = { plans: [mk('a', true, { id: 'c1', name: '旧名' }), mk('b', false, { id: 'c1', name: 'EBF' }), mk('c', true, { id: 'c9', name: '没了' })] };
  st.plans.push({ ...mk('d', true, { id: 'c1', name: 'EBF' }), kind: 'permanent' });
  const changed = syncCampaignTimes(st, [{ id: 'c1', name: 'EBF', start: 1000, end: 2000 }]);
  assert.deepEqual(changed.map((x) => x.plan.id), ['a', 'd']);
  assert.deepEqual(st.plans[0].slots[0], { id: 's', start: 1000, end: 2000, items: [] });
  assert.equal(st.plans[0].campaign.name, 'EBF'); // 名字也跟着更新
  assert.deepEqual(st.plans[1].slots[0], { id: 's', start: 100, end: 200, items: [] }); // 没勾的不动
  assert.deepEqual(st.plans[2].slots[0], { id: 's', start: 100, end: 200, items: [] }); // 活动找不到就不动
  assert.equal(st.plans[3].slots[0].end, null); // 永久调价没有结束时间
  assert.deepEqual(syncCampaignTimes(st, [{ id: 'c1', name: 'EBF', start: 1000, end: 2000 }]), []); // 已经一致就不重复改
});
