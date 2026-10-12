// 合集排序:算出来的顺序 / 要发给 Shopify 的动作 / 还原 / 有人手改过就暂停接管
import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredOrder, restoreOrder, movesFor, driftedFrom, livePins, alignCollections, MAX_REMOVE } from '../src/collection-order.js';

const P = (n) => ({ id: `gid://shopify/Product/${n}` });
const pin = (o = {}) => ({ id: 'pin-1', name: 'Flash 第 1 天', kind: 'pin', state: 'approved', paused: false,
  collection: { id: 'gid://shopify/Collection/99', title: 'Flash Sale' }, products: [], hidden: [], start: null, end: null, ...o });
const CUR = ['1', '2', '3', '4', '5'];

test('排好的在最前面,其余照原顺序', () => {
  const d = desiredOrder(CUR, CUR, pin({ products: [P(4), P(2)] }));
  assert.deepEqual(d.order, ['4', '2', '1', '3', '5']);
  assert.deepEqual(d.remove, []);
});

test('勾了不显示的产品要移出合集,也不占位置', () => {
  const d = desiredOrder(CUR, CUR, pin({ products: [P(4)], hidden: [P(1)] }));
  assert.deepEqual(d.order, ['4', '2', '3', '5']);
  assert.deepEqual(d.remove, ['1']);
});

test('清单里排了合集以外的产品:算进顺序,并标成「要加进合集」', () => {
  const d = desiredOrder(CUR, ['2', '3'], pin({ products: [P(9), P(3)] }));
  assert.deepEqual(d.order, ['9', '3', '2']);
  assert.deepEqual(d.add, ['9']);
});

test('期间新加进合集的产品排到最后,不打乱原顺序', () => {
  const d = desiredOrder(CUR, ['1', '2', '3', '4', '5', '77'], pin({ products: [P(5)] }));
  assert.deepEqual(d.order, ['5', '1', '2', '3', '4', '77']);
});

test('只显示清单里的 = 其余全部临时移出', () => {
  const d = desiredOrder(CUR, CUR, pin({ products: [P(3), P(1)], onlyListed: true }));
  assert.deepEqual(d.order, ['3', '1']);
  assert.deepEqual(d.remove.sort(), ['2', '4', '5']);
});

test('还原:照快照的顺序,后来加的排最后', () => {
  assert.deepEqual(restoreOrder(CUR, ['3', '1', '2', '88']), ['1', '2', '3', '88']);
  assert.deepEqual(restoreOrder(CUR, ['5', '1']), ['1', '5']); // 中间被删掉的不管
});

test('只给位置不对的产品发 move', () => {
  const mv = movesFor(['1', '2', '3', '4', '5'], ['4', '2', '1', '3', '5']);
  assert.deepEqual(mv.map((m) => [m.id.split('/').pop(), m.newPosition]), [['4', '0'], ['2', '1']]);
  // 照着发一遍应该真的变成想要的顺序
  const arr = ['1', '2', '3', '4', '5'];
  for (const m of mv) { const id = m.id.split('/').pop(); arr.splice(arr.indexOf(id), 1); arr.splice(+m.newPosition, 0, id); }
  assert.deepEqual(arr, ['4', '2', '1', '3', '5']);
  assert.deepEqual(movesFor(CUR, CUR), []); // 已经对了就一个都不发
});

test('我们排在最前的那几个被人动了 → 算「有人手改过」', () => {
  assert.equal(driftedFrom(['4', '2'], ['4', '2', '1', '3', '5']), false);
  assert.equal(driftedFrom(['4', '2'], ['1', '4', '2', '3', '5']), true);
});

test('同一个合集几份清单同时生效:开始最晚的赢', () => {
  const a = pin({ id: 'a', start: 1000, end: 9000 });
  const b = pin({ id: 'b', start: 5000, end: 9000 });
  const m = livePins([a, b], [], 6000);
  assert.equal(m.get('99').id, 'b');
  assert.equal(livePins([{ ...a, paused: true }], [], 6000).size, 0);
  assert.equal(livePins([{ ...a, state: 'draft' }], [], 6000).size, 0);
});

// ---- 整轮(假 Shopify)----
function fakeShop({ ids = ['1', '2', '3', '4', '5'], sortOrder = 'MANUAL', automated = false } = {}) {
  const shop = { ids: [...ids], calls: [] };
  shop.gql = async (ctx, q, v) => {
    if (q.includes('collection(id: $id)')) {
      return { collection: { id: v.id, title: 'Flash Sale', sortOrder, ruleSet: automated ? { appliedDisjunctively: false } : null,
        products: { nodes: shop.ids.map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (q.includes('collectionRemoveProducts')) {
      const rm = v.p.map((x) => String(x).split('/').pop());
      shop.ids = shop.ids.filter((id) => !rm.includes(id)); shop.calls.push(['remove', rm]);
      return { collectionRemoveProducts: { userErrors: [] } };
    }
    if (q.includes('collectionAddProducts')) {
      const add = v.p.map((x) => String(x).split('/').pop()).filter((id) => !shop.ids.includes(id));
      shop.ids.push(...add); shop.calls.push(['add', add]);
      return { collectionAddProducts: { userErrors: [] } };
    }
    if (q.includes('collectionReorderProducts')) {
      for (const m of v.moves) { const id = String(m.id).split('/').pop(); shop.ids.splice(shop.ids.indexOf(id), 1); shop.ids.splice(+m.newPosition, 0, id); }
      shop.calls.push(['reorder', v.moves.length]);
      return { collectionReorderProducts: { job: { id: 'j1' }, userErrors: [] } };
    }
    throw new Error('没想到的查询 ' + q.slice(0, 40));
  };
  return shop;
}
const stateWith = (p) => ({ pins: [p], campaigns: [], colState: {} });

test('整轮:到点真的改合集 → 结束自动还原', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(4), P(2)], hidden: [P(5)], start: 1000, end: 2000 });
  const state = stateWith(p);
  const r1 = await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(r1.applied.length, 1);
  assert.deepEqual(shop.ids, ['4', '2', '1', '3']);         // 排好了,5 被移出去了
  assert.deepEqual(state.colState['99'].snapshot, ['1', '2', '3', '4', '5']);
  // 再跑一轮:已经是想要的样子,一个字都不写
  const before = shop.calls.length;
  await alignCollections({}, state, { now: 1600, gql: shop.gql });
  assert.equal(shop.calls.length, before);
  // 到点结束 → 还原
  const r2 = await alignCollections({}, state, { now: 3000, gql: shop.gql });
  assert.equal(r2.restored.length, 1);
  assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);
  assert.equal(state.colState['99'], undefined);
});

test('整轮:改了清单内容 → 重排,之前移出的加回来', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(4)], hidden: [P(5)], start: 1000, end: 9000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.deepEqual(shop.ids, ['4', '1', '2', '3']);
  p.products = [P(3), P(1)]; p.hidden = [];
  await alignCollections({}, state, { now: 1600, gql: shop.gql });
  assert.deepEqual(shop.ids, ['3', '1', '2', '4', '5']); // 5 加回来了,照快照的位置排在最后
});

test('整轮:有人在后台手动改过 → 暂停接管,不覆盖', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(4), P(2)], start: 1000, end: 9000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  shop.ids = ['1', '4', '2', '3', '5']; // 同事在 Shopify 后台把 1 拖到了最前
  const r = await alignCollections({}, state, { now: 1600, gql: shop.gql });
  assert.equal(r.holds.length, 1);
  assert.deepEqual(shop.ids, ['1', '4', '2', '3', '5']); // 没被覆盖
  assert.equal(state.colState['99'].hold, 'manual');
  const r2 = await alignCollections({}, state, { now: 1700, gql: shop.gql }); // 之后几轮也不再动
  assert.equal(r2.holds.length, 1); assert.equal(r2.applied.length, 0);
});

test('自动归类的合集 / 不是手动排序的合集:不动店里的,交给前台排', async () => {
  for (const o of [{ automated: true }, { sortOrder: 'BEST_SELLING' }]) {
    const shop = fakeShop(o);
    const state = stateWith(pin({ products: [P(4)], start: 1000, end: 9000 }));
    const r = await alignCollections({}, state, { now: 1500, gql: shop.gql });
    assert.equal(r.skipped.length, 1);
    assert.equal(shop.calls.length, 0);
    assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);
  }
});

test('要移出去太多(只显示清单里的 + 大合集)→ 不动店里的合集', async () => {
  const many = Array.from({ length: MAX_REMOVE + 20 }, (_, i) => String(i + 1));
  const shop = fakeShop({ ids: many });
  const state = stateWith(pin({ products: [P(7)], onlyListed: true, start: 1000, end: 9000 }));
  const r = await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(r.skipped[0].why, 'too-many');
  assert.equal(shop.calls.length, 0);
});

test('写失败不炸,记下来下一轮重试', async () => {
  const shop = fakeShop();
  shop.gql = async (ctx, q, v) => (q.includes('collectionReorderProducts')
    ? { collectionReorderProducts: { userErrors: [{ message: '临时错误' }] } }
    : { collection: { id: v.id, title: 'Flash Sale', sortOrder: 'MANUAL', ruleSet: null, products: { nodes: ['1', '2'].map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } });
  const state = stateWith(pin({ products: [P(2)], start: 1000, end: 9000 }));
  const r = await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(r.failures.length, 1);
  assert.equal(state.colState['99'], undefined); // 没写成功就不记接管
});

test('清单里排了合集以外的产品 → 真的加进合集,结束再移出去', async () => {
  const shop = fakeShop();                       // 合集里是 1..5
  const p = pin({ products: [P(99), P(2)], start: 1000, end: 2000 }); // 99 不在合集里
  const state = stateWith(p);
  const r1 = await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(r1.applied[0].added, 1);
  assert.deepEqual(shop.ids, ['99', '2', '1', '3', '4', '5']);  // 加进来了,还排在第一个
  assert.deepEqual(state.colState['99'].added, ['99']);
  await alignCollections({}, state, { now: 3000, gql: shop.gql }); // 结束
  assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);          // 原样,加进来的那个移出去了
});

test('中途把合集外的产品从清单里删掉 → 下一轮从合集里移出去', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(99)], start: 1000, end: 9000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.ok(shop.ids.includes('99'));
  p.products = [P(3)];
  await alignCollections({}, state, { now: 1600, gql: shop.gql });
  assert.equal(shop.ids.includes('99'), false);
  assert.deepEqual(shop.ids, ['3', '1', '2', '4', '5']);
  assert.deepEqual(state.colState['99'].added, []);
});
