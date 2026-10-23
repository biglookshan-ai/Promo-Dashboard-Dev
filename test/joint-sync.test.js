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

// 假 Shopify:每个合集自己的成员(900 = 兼容产品合集,800 = 推广产品合集)+ 按条件搜到的产品
function fakeShop({ members = [], hits = [], promoMembers = [], automated = false, promoAutomated = false } = {}) {
  const calls = [];
  const cols = { 900: new Set(members), 800: new Set(promoMembers) };
  const cid = (id) => String(id).split('/').pop();
  const gql = async (ctx, q, v) => {
    if (q.includes('collectionAddProducts')) { calls.push(['add', cid(v.id), v.p.map((x) => x.split('/').pop())]); v.p.forEach((x) => cols[cid(v.id)].add(x.split('/').pop())); return { collectionAddProducts: { userErrors: [] } }; }
    if (q.includes('collectionRemoveProducts')) { calls.push(['remove', cid(v.id), v.p.map((x) => x.split('/').pop())]); v.p.forEach((x) => cols[cid(v.id)].delete(x.split('/').pop())); return { collectionRemoveProducts: { userErrors: [] } }; }
    if (q.includes('sortOrder')) { const c = cid(v.id); const auto = c === '900' ? automated : promoAutomated;
      return { collection: { id: v.id, title: c === '900' ? 'Smart Fusion 兼容镜头' : 'Smart Fusion', sortOrder: 'MANUAL', ruleSet: auto ? { appliedDisjunctively: false } : null, sources: [],
        products: { nodes: [...cols[c]].map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } }; }
    if (q.includes('collection(id: $id) { products')) return { collection: { products: { nodes: [...cols[cid(v.id)]].map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } };
    if (q.includes('products(first: 250')) { calls.push(['search', v.q]); return { products: { nodes: hits.map((h) => ({ id: `gid://shopify/Product/${h.id}`, title: h.title })), pageInfo: { hasNextPage: false } } }; }
    throw new Error('没想到的查询 ' + q.slice(0, 80));
  };
  return { gql, calls, mem: cols[900], promo: cols[800] };
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
  assert.deepEqual(f.calls.filter((c) => c[0] !== 'search'), [['add', '900', ['3']], ['remove', '900', ['1']]]);
  assert.match(f.calls.find((c) => c[0] === 'search')[1], /status:active AND \(vendor:'?DZOFILM'?\)/);
  assert.deepEqual([...f.mem].sort(), ['2', '3']);
  assert.equal(state.jointSync['co-1'].collection.title, 'Smart Fusion 兼容镜头');
  assert.equal(state.jointSync['co-1'].promo, undefined); // 老的推广块(没有 promos)不动推广产品合集
  assert.deepEqual([...f.promo].sort(), ['50', '51']);
});

test('推广的产品(多选)自动放进推广产品合集:正好这几个;兼容产品去掉它们', async () => {
  const f = fakeShop({ members: [], promoMembers: ['50', '77'],
    hits: [{ id: 3, title: 'DZOFILM Catta 70' }, { id: 60, title: 'DZOFILM Smart Fusion bundle' }] });
  const state = {};
  const r = await syncJoint({}, state, CO({ promos: [{ id: 'gid://shopify/Product/50' }, { id: '60' }] }), { gql: f.gql, now: 1000 });
  assert.deepEqual([...f.promo].sort(), ['50', '60']); // 加了 60,移出手动放进去的 77
  assert.deepEqual([...f.mem], ['3']); // 60 虽然命中条件,但它是推广产品,不算兼容产品
  assert.deepEqual([r.promo.count, r.promo.added, r.promo.removed, r.promo.error], [2, 1, 1, '']);
  assert.equal(r.promo.collection.title, 'Smart Fusion');
  assert.deepEqual(f.calls.filter((c) => c[0] !== 'search').map((c) => c.slice(0, 2)), [['add', '800'], ['remove', '800'], ['add', '900']]); // 先推广产品合集
});

test('推广产品合集的安全阀:带条件的不碰;移出太多先停手(兼容产品照常同步)', async () => {
  let f = fakeShop({ promoAutomated: true, hits: [{ id: 3, title: 'x' }] });
  let r = await syncJoint({}, {}, CO({ promos: [{ id: '50' }] }), { gql: f.gql });
  assert.match(r.promo.error, /手动/); assert.deepEqual([...f.mem], ['3']);
  const many = Array.from({ length: 30 }, (_, i) => String(i + 100));
  f = fakeShop({ promoMembers: many, hits: [{ id: 3, title: 'x' }] });
  r = await syncJoint({}, {}, CO({ promos: [{ id: '50' }] }), { gql: f.gql });
  assert.equal(r.held, true); assert.equal(r.promo.held, true); assert.equal(f.promo.size, 30); assert.deepEqual([...f.mem], ['3']);
  r = await syncJoint({}, {}, CO({ promos: [{ id: '50' }] }), { gql: f.gql, force: true });
  assert.equal(r.held, false); assert.deepEqual([...f.promo], ['50']);
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
  const P = { promos: [{ id: '50' }] };
  assert.equal(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: '2' }, promoTitle: 'Pair with a lens', ...P }), '');
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: '2' }, promoTitle: 'x' }), /推广的产品/);
  assert.match(v({ joint: true, promoCollection: { id: '2' }, promoTitle: 'x' }), /兼容产品的合集/);
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoTitle: 'x' }), /推广产品的合集/);
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: 'gid://shopify/Collection/1' }, promoTitle: 'x' }), /同一个/);
  assert.match(v({ joint: true, lensCollection: { id: '1' }, promoCollection: { id: '2' }, ...P }), /推广产品页上那张卡片/);
  assert.match(v({}), /推广的产品,或者填一个链接/); // 普通推广块照旧要推广产品或链接
});
