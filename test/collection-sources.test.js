// 带条件的合集(Shopify 2026 新版合集,API 2026-07):app 改它的「单独加的产品 / 排除」名单来加减产品,不动条件。
// Shopify 可能在后台慢慢算 —— 这里的假店铺可以模拟「改了名单,下一轮才生效」。
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_VERSION = '2026-07';
const { alignCollections } = await import('../src/collection-order.js');

const P = (n) => ({ id: `gid://shopify/Product/${n}` });
const pin = (o = {}) => ({ id: 'pin-1', name: 'Easter', kind: 'pin', state: 'approved', paused: false,
  collection: { id: 'gid://shopify/Collection/77', title: 'Easter Deals' }, products: [], hidden: [], start: 1000, end: 50 * 60_000, ...o });

function sourcesShop({ ids = ['1', '2', '3', '4', '5'], async = false, shareable = false } = {}) {
  const shop = { ids: [...ids], incl: new Set(), excl: new Set(), queue: [], calls: [] };
  const apply = (fn) => (async ? shop.queue.push(fn) : fn());
  shop.flush = () => { shop.queue.splice(0).forEach((fn) => fn()); }; // 模拟 Shopify 在后台算完
  shop.gql = async (ctx, q, v) => {
    if (q.includes('collection(id: $id)')) {
      return { collection: { id: v.id, title: 'Easter Deals', sortOrder: 'MANUAL', ruleSet: { appliedDisjunctively: false },
        sources: [{ __typename: 'CollectionConditionsSource', id: 'gid://shopify/CollectionConditionsSource/9', shareable, inclusion: { conditions: [{ __typename: 'C' }] } }],
        products: { nodes: shop.ids.map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } };
    }
    if (q.includes('collectionUpdate')) {
      const cond = v.c.sourcesToUpdate[0].condition;
      assert.equal(cond.id, 'gid://shopify/CollectionConditionsSource/9');
      const [part] = Object.keys(cond).filter((k) => k !== 'id');
      const [op] = Object.keys(cond[part]);
      const list = cond[part][op].map((x) => x.productId.split('/').pop());
      shop.calls.push([part, op, list]);
      apply(() => {
        for (const id of list) {
          if (part === 'inclusion' && op === 'selectionsToAdd') { shop.incl.add(id); if (!shop.ids.includes(id)) shop.ids.push(id); }
          if (part === 'inclusion' && op === 'selectionsToRemove') { shop.incl.delete(id); shop.ids = shop.ids.filter((x) => x !== id); }
          if (part === 'exclusion' && op === 'selectionsToAdd') { shop.excl.add(id); shop.ids = shop.ids.filter((x) => x !== id); }
          if (part === 'exclusion' && op === 'selectionsToRemove') { shop.excl.delete(id); if (!shop.ids.includes(id)) shop.ids.push(id); }
        }
      });
      return { collectionUpdate: { collection: { id: v.c.id }, job: { id: 'j', done: !async }, userErrors: [] } };
    }
    if (q.includes('collectionReorderProducts')) {
      for (const m of v.moves) { const id = String(m.id).split('/').pop(); const at = shop.ids.indexOf(id); if (at === -1) continue; shop.ids.splice(at, 1); shop.ids.splice(+m.newPosition, 0, id); }
      shop.calls.push(['reorder', v.moves.length]);
      return { collectionReorderProducts: { job: { id: 'j' }, userErrors: [] } };
    }
    if (q.includes('collectionAddProducts') || q.includes('collectionRemoveProducts')) throw new Error('带条件的 Collection 不该用老的加减接口');
    throw new Error('没想到的查询 ' + q.slice(0, 50));
  };
  return shop;
}
const stateWith = (p) => ({ pins: [p], campaigns: [], colState: {} });

test('带条件的 Collection:Collection 外的产品加进「单独加的产品」,不显示的加进「排除」,顺序真的改,条件不动', async () => {
  const shop = sourcesShop();
  const state = stateWith(pin({ products: [P(99), P(4)], hidden: [P(2)] }));
  const r = await alignCollections({}, state, { now: 2000, gql: shop.gql });
  assert.equal(r.applied[0].via, 'sources');
  assert.deepEqual(shop.ids, ['99', '4', '1', '3', '5']);
  assert.deepEqual([...shop.incl], ['99']); assert.deepEqual([...shop.excl], ['2']);
  // 结束 → 撤掉我们加的单独产品和排除,顺序照原样
  await alignCollections({}, state, { now: 60 * 60_000, gql: shop.gql });
  assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);
  assert.equal(shop.incl.size, 0); assert.equal(shop.excl.size, 0);
  assert.equal(state.colState['77'], undefined);
});

test('Shopify 在后台慢慢算:先不排新加的,等它出现了下一轮再排;不会重复加', async () => {
  const shop = sourcesShop({ async: true });
  const state = stateWith(pin({ products: [P(99), P(4)], hidden: [P(2)] }));
  const r1 = await alignCollections({}, state, { now: 2000, gql: shop.gql });
  assert.equal(r1.applied[0].pending, true);
  assert.ok(state.colState['77'].pending);
  const r2 = await alignCollections({}, state, { now: 62_000, gql: shop.gql }); // 还没算完:等着,什么都不写
  assert.equal(r2.applied.length, 0);
  shop.flush();                                                                  // 算完了
  const r3 = await alignCollections({}, state, { now: 122_000, gql: shop.gql });
  assert.equal(r3.applied.length, 1); assert.equal(r3.applied[0].pending, false);
  assert.deepEqual(shop.ids, ['99', '4', '1', '3', '5']);
  assert.equal(shop.calls.filter((c) => c[0] === 'inclusion').length, 1);        // 只加了一次
  assert.equal(state.colState['77'].pending, undefined);
  // 结束:撤销也是慢慢算 → 先记下「还原中」,算完再排回原顺序
  await alignCollections({}, state, { now: 60 * 60_000, gql: shop.gql });
  assert.ok(state.colState['77'].restoring);
  shop.flush();
  const r5 = await alignCollections({}, state, { now: 60 * 60_000 + 60_000, gql: shop.gql });
  assert.equal(r5.restored.length, 1);
  assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);
});

test('中途改清单:只补差的那部分(多排除一个、少加一个)', async () => {
  const shop = sourcesShop();
  const p = pin({ products: [P(99), P(98)], hidden: [P(2)] });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 2000, gql: shop.gql });
  p.products = [P(99)]; p.hidden = [P(2), P(3)];
  shop.calls = [];
  await alignCollections({}, state, { now: 3000, gql: shop.gql });
  assert.deepEqual(shop.calls.filter((c) => c[0] !== 'reorder'), [['inclusion', 'selectionsToRemove', ['98']], ['exclusion', 'selectionsToAdd', ['3']]]);
  assert.deepEqual(shop.ids, ['99', '1', '4', '5']);
});

test('共享的条件来源(会连带改到别的 Collection):不碰,加减交给前台', async () => {
  const shop = sourcesShop({ shareable: true });
  const state = stateWith(pin({ products: [P(99), P(4)], hidden: [P(2)] }));
  const r = await alignCollections({}, state, { now: 2000, gql: shop.gql });
  assert.equal(r.applied[0].via, null);
  assert.deepEqual(r.applied[0].front, { hidden: 1, outside: 1, needsNewApi: false });
  assert.equal(shop.incl.size + shop.excl.size, 0);
  assert.deepEqual(shop.ids, ['4', '1', '2', '3', '5']); // 顺序照样真的改
});
