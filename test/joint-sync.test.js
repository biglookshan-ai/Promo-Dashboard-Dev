// 联合推广:按推广块的条件把兼容产品同步进手动合集(只动这一个合集的成员)
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPlan, syncJoint, syncAllJoint, wantsSync } from '../src/joint-sync.js';
import { validate } from '../src/schedule-actions.js';

test('要加 / 要移出;一次移出超过一半先停手', () => {
  assert.deepEqual(syncPlan(['1', '2'], ['2', '3']), { add: ['3'], remove: ['1'], held: false });
  const cur = Array.from({ length: 30 }, (_, i) => String(i));
  assert.equal(syncPlan(cur, ['0', '1']).held, true);
  assert.equal(syncPlan(cur, ['0', '1'], { force: true }).held, false);
  assert.equal(syncPlan(['1', '2', '3'], ['9']).held, false); // 合集还很小(< 20)时不拦
});

// 假 Shopify:合集成员 + 按条件搜到的产品
function fakeShop({ members = [], hits = [], promoMembers = [], automated = false } = {}) {
  const calls = [];
  const mem = new Set(members);
  const gql = async (ctx, q, v) => {
    if (q.includes('collectionAddProducts')) { calls.push(['add', v.p.map((x) => x.split('/').pop())]); v.p.forEach((x) => mem.add(x.split('/').pop())); return { collectionAddProducts: { userErrors: [] } }; }
    if (q.includes('collectionRemoveProducts')) { calls.push(['remove', v.p.map((x) => x.split('/').pop())]); v.p.forEach((x) => mem.delete(x.split('/').pop())); return { collectionRemoveProducts: { userErrors: [] } }; }
    if (q.includes('sortOrder')) return { collection: { id: v.id, title: 'Smart Fusion 兼容镜头', sortOrder: 'MANUAL', ruleSet: automated ? { appliedDisjunctively: false } : null, sources: [],
      products: { nodes: [...mem].map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } };
    if (q.includes('collection(id: $id) { products')) return { collection: { products: { nodes: promoMembers.map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } };
    if (q.includes('products(first: 250')) { calls.push(['search', v.q]); return { products: { nodes: hits.map((h) => ({ id: `gid://shopify/Product/${h.id}`, title: h.title })), pageInfo: { hasNextPage: false } } }; }
    throw new Error('没想到的查询 ' + q.slice(0, 80));
  };
  return { gql, calls, mem };
}
const CO = (o = {}) => ({ id: 'co-1', kind: 'callout', name: 'Smart Fusion', joint: true, state: 'approved',
  lensCollection: { id: '900', title: 'Smart Fusion 兼容镜头' }, promoCollection: { id: '800', title: 'Smart Fusion' }, promo: { id: '50' },
  rules: [{ f: 'vendor', n: false, v: ['DZOFILM'] }, { f: 'title', n: true, v: ['Pavo'] }], products: [], exProducts: [], ...o });

test('同步:按条件算出全部命中的产品,补差;推广产品自己那个系列不算;标题条件照算', async () => {
  const f = fakeShop({ members: ['1', '2'], promoMembers: ['50', '51'],
    hits: [{ id: 2, title: 'DZOFILM Vespid 35' }, { id: 3, title: 'DZOFILM Catta 70' }, { id: 4, title: 'DZOFILM Pavo 2x' }, { id: 51, title: 'DZOFILM x Smart Fusion kit' }] });
  const state = {};
  const r = await syncJoint({}, state, CO(), { gql: f.gql, now: 1000 });
  assert.equal(r.error, '');
  assert.deepEqual([r.count, r.added, r.removed], [2, 1, 1]);
  assert.deepEqual(f.calls.filter((c) => c[0] !== 'search'), [['add', ['3']], ['remove', ['1']]]);
  assert.match(f.calls.find((c) => c[0] === 'search')[1], /status:active AND \(vendor:'?DZOFILM'?\)/);
  assert.deepEqual([...f.mem].sort(), ['2', '3']);
  assert.equal(state.jointSync['co-1'].collection.title, 'Smart Fusion 兼容镜头');
});

test('同步的安全阀:带条件的合集不碰;一个都没命中不清空;移出太多先停手', async () => {
  let f = fakeShop({ automated: true, hits: [{ id: 3, title: 'x' }] });
  let r = await syncJoint({}, {}, CO(), { gql: f.gql });
  assert.match(r.error, /手动/); assert.equal(f.calls.filter((c) => c[0] !== 'search').length, 0);
  f = fakeShop({ members: ['1'], hits: [] });
  r = await syncJoint({}, {}, CO(), { gql: f.gql });
  assert.match(r.error, /一个产品都没命中/); assert.deepEqual([...f.mem], ['1']);
  const many = Array.from({ length: 40 }, (_, i) => String(i + 100));
  f = fakeShop({ members: many, hits: [{ id: 100, title: 'DZOFILM a' }] });
  r = await syncJoint({}, {}, CO(), { gql: f.gql });
  assert.equal(r.held, true); assert.equal(f.mem.size, 40);
  r = await syncJoint({}, {}, CO(), { gql: f.gql, force: true });
  assert.equal(r.held, false); assert.deepEqual([...f.mem], ['100']);
});

test('定时器:只同步上线中 / 已排期的联合推广,每小时一次', async () => {
  const f = fakeShop({ hits: [{ id: 3, title: 'DZOFILM' }] });
  const state = { campaigns: [], callouts: [CO(), CO({ id: 'co-2', paused: true }), CO({ id: 'co-3', joint: false }), CO({ id: 'co-4', state: 'draft' })] };
  assert.ok(wantsSync(state.callouts[0], new Map(), 1000));
  let out = await syncAllJoint({}, state, { gql: f.gql, now: 10_000_000 });
  assert.deepEqual(out.map((x) => x.id), ['co-1']);
  out = await syncAllJoint({}, state, { gql: f.gql, now: 10_000_000 + 60_000 });
  assert.equal(out.length, 0); // 一小时内不重复
});

test('联合推广的保存检查', () => {
  const v = (o) => validate({ kind: 'callout', name: 'x', title: 'Turn this manual lens…', rules: [{ f: 'vendor', v: ['DZOFILM'] }], ...o });
  assert.equal(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: '2' }, promoTitle: 'Pair with a lens' }), '');
  assert.match(v({ joint: true, promoCollection: { id: '2' }, promoTitle: 'x' }), /兼容产品的合集/);
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoTitle: 'x' }), /推广产品的合集/);
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: 'gid://shopify/Collection/1' }, promoTitle: 'x' }), /同一个/);
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: '2' } }), /推广产品页上那张卡片/);
  assert.match(v({}), /推广的产品,或者填一个链接/); // 普通推广块照旧要推广产品或链接
});
