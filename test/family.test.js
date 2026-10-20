// 主活动 / 子活动(2026-10-20):子活动自动比主活动优先、页签跟随活动、保存规则、同一家一起重写
import test from 'node:test';
import assert from 'node:assert/strict';
import { effPriority, tabVisible, campaignIndex, CHILD_BOOST } from '../src/schedule-core.js';
import { applyAction } from '../src/schedule-actions.js';
import { tabFields } from '../src/metaobjects.js';

const D = 86400000; const T0 = Date.UTC(2026, 10, 1);
const C = (id, o = {}) => ({ id, kind: 'campaign', name: id, state: 'approved', start: T0, end: T0 + 30 * D, priority: 10, collections: [], tags: [], products: [], ...o });

test('实际优先级:独立 / 主活动 = 自己的数字;子活动 = 主活动 + 1000 + 兄弟名次(数字小到大、一样按开始早到晚)', () => {
  const bf = C('bf', { priority: 10 });
  const dzo = C('dzo', { parent: 'bf', start: T0 + 2 * D });
  const thy = C('thy', { parent: 'bf', start: T0 + 5 * D });
  const cm = C('cm', { parent: 'bf', start: T0 + 1 * D, priority: 50 }); // 手动数字大 → 兄弟里最优先
  const autumn = C('autumn', { priority: 20 });
  const all = [bf, dzo, thy, cm, autumn];
  assert.equal(effPriority(bf, all), 10);
  assert.equal(effPriority(autumn, all), 20);
  assert.equal(effPriority(dzo, all), 10 + CHILD_BOOST + 1);
  assert.equal(effPriority(thy, all), 10 + CHILD_BOOST + 2);
  assert.equal(effPriority(cm, all), 10 + CHILD_BOOST + 3);
  assert.ok(effPriority(dzo, all) > effPriority(autumn, all)); // 子活动也比别的独立活动优先
  assert.equal(effPriority(C('x', { parent: 'gone' }), all), 10); // 主活动不在了 = 当独立活动
});

test('页签跟随活动:活动上线中才显示;没跟随的一直显示', () => {
  const camps = campaignIndex([C('dzo', { start: T0, end: T0 + 5 * D }), C('draft', { state: 'draft' })]);
  assert.equal(tabVisible({ title: 'All' }, camps, T0 + D), true);
  assert.equal(tabVisible({ campaign: 'dzo' }, camps, T0 + D), true);
  assert.equal(tabVisible({ campaign: 'dzo' }, camps, T0 + 6 * D), false);
  assert.equal(tabVisible({ campaign: 'draft' }, camps, T0 + D), false);
  assert.equal(tabVisible({ campaign: 'gone' }, camps, T0 + D), false);
  const f = Object.fromEntries(tabFields({ id: 't1', title: 'DZO', campaign: 'dzo' }, { campaignGid: 'gid://shopify/Metaobject/9' }).map((x) => [x.key, x.value]));
  assert.equal(f.campaign, 'gid://shopify/Metaobject/9'); assert.equal(f.campaign_only, 'true');
  const g = Object.fromEntries(tabFields({ id: 't2', title: 'All' }).map((x) => [x.key, x.value]));
  assert.equal(g.campaign, ''); assert.equal(g.campaign_only, 'false');
});

const doc = () => ({ banners: [], topbar: [], tbstyles: [], pmodules: [], pins: [], salelinks: [], callouts: [], log: [], staff: [],
  campaigns: [C('bf'), C('dzo', { parent: 'bf' }), C('thy', { parent: 'bf' }), C('autumn')] });
const admin = { id: 'a', name: 'A', role: 'approver' };

test('保存:主活动只有一层;改一个子活动,同一家都重写', () => {
  const d = doc();
  assert.throws(() => applyAction(d, { type: 'save', mode: 'publish', kind: 'campaign', id: 'autumn', values: { parent: 'dzo' } }, admin), /本身是子活动/);
  assert.throws(() => applyAction(d, { type: 'save', mode: 'publish', kind: 'campaign', id: 'bf', values: { parent: 'autumn' } }, admin), /已经有子活动/);
  assert.throws(() => applyAction(d, { type: 'save', mode: 'publish', kind: 'campaign', id: 'autumn', values: { parent: 'autumn' } }, admin), /自己/);
  const r = applyAction(d, { type: 'save', mode: 'publish', kind: 'campaign', id: 'dzo', values: { priority: 30 } }, admin);
  const synced = r.effects.filter((e) => e.type === 'sync').map((e) => e.id).sort();
  assert.deepEqual(synced, ['bf', 'dzo', 'thy']);
  // 从主活动挪出来:原来那一家也重写(兄弟名次变了)
  const r2 = applyAction(d, { type: 'save', mode: 'publish', kind: 'campaign', id: 'thy', values: { parent: null } }, admin);
  assert.deepEqual(r2.effects.filter((e) => e.type === 'sync').map((e) => e.id).sort(), ['bf', 'dzo', 'thy']);
});

test('删除主活动:子活动变回独立;有页签跟随的活动不能删', () => {
  const d = doc(); d.campaigns[0].state = 'draft';
  const r = applyAction(d, { type: 'delete', id: 'bf' }, admin);
  assert.ok(r.doc.campaigns.every((c) => !c.parent));
  const d2 = doc(); d2.campaigns[1].state = 'draft';
  d2.pmodules.push({ id: 'pm1', kind: 'pmodule', module: 'sale', name: 'BF', state: 'approved', tabs: [{ id: 't', title: 'DZO', campaign: 'dzo' }] });
  assert.throws(() => applyAction(d2, { type: 'delete', id: 'dzo' }, admin), /只在这个活动期间显示/);
  // 改了活动 → 跟随它的首页模块也重写
  const d3 = doc(); d3.pmodules.push({ id: 'pm1', kind: 'pmodule', module: 'sale', name: 'BF', state: 'approved', tabs: [{ id: 't', title: 'DZO', campaign: 'dzo' }] });
  const r3 = applyAction(d3, { type: 'save', mode: 'publish', kind: 'campaign', id: 'dzo', values: { badge: 'EBF' } }, admin);
  assert.ok(r3.effects.some((e) => e.type === 'sync' && e.id === 'pm1'));
});
