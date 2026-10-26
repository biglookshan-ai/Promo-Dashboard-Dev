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

test('勾了不显示的产品要移出 Collection,也不占位置', () => {
  const d = desiredOrder(CUR, CUR, pin({ products: [P(4)], hidden: [P(1)] }));
  assert.deepEqual(d.order, ['4', '2', '3', '5']);
  assert.deepEqual(d.remove, ['1']);
});

test('清单里排了 Collection 以外的产品:算进顺序,并标成「要加进 Collection」', () => {
  const d = desiredOrder(CUR, ['2', '3'], pin({ products: [P(9), P(3)] }));
  assert.deepEqual(d.order, ['9', '3', '2']);
  assert.deepEqual(d.add, ['9']);
});

test('期间新加进 Collection 的产品排到最后,不打乱原顺序', () => {
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
  assert.equal(mv.length, 2);
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

test('同一个 Collection 几份清单同时生效:开始最晚的赢', () => {
  const a = pin({ id: 'a', start: 1000, end: 9000 });
  const b = pin({ id: 'b', start: 5000, end: 9000 });
  const m = livePins([a, b], [], 6000);
  assert.equal(m.get('99').id, 'b');
  assert.equal(livePins([{ ...a, paused: true }], [], 6000).size, 0);
  // 开始时间一样(比如都是长期显示):先建的那份赢
  const x = pin({ id: 'x' }); const y = pin({ id: 'y' });
  assert.equal(livePins([x, y], [], 6000).get('99').id, 'x');
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

test('整轮:到点真的改 Collection → 结束自动还原', async () => {
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

test('整轮:有人在后台手动改过 → 暂停接管,不覆盖(刚写完的几分钟内不算,Shopify 调顺序是异步的)', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(4), P(2)], start: 1000, end: 10 * 60_000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  shop.ids = ['1', '4', '2', '3', '5']; // 同事在 Shopify 后台把 1 拖到了最前
  const early = await alignCollections({}, state, { now: 60_000, gql: shop.gql });
  assert.equal(early.holds.length, 0);              // 1 分钟内:可能只是任务还没跑完,先等
  const r = await alignCollections({}, state, { now: 5 * 60_000, gql: shop.gql });
  assert.equal(r.holds.length, 1);
  assert.deepEqual(shop.ids, ['1', '4', '2', '3', '5']); // 没被覆盖
  assert.equal(state.colState['99'].hold, 'manual');
  const r2 = await alignCollections({}, state, { now: 6 * 60_000, gql: shop.gql }); // 之后几轮也不再动
  assert.equal(r2.holds.length, 1); assert.equal(r2.applied.length, 0);
});

test('暂停后选「保留后台的改动」:清单剩下的时间不再排,结束只复原加 / 移出的产品,顺序保持人排的(2026-10-26 修:以前下一分钟又重新接管)', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(4), P(2)], hidden: [P(5)], start: 1000, end: 60 * 60_000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.deepEqual(shop.ids, ['4', '2', '1', '3']);           // 5 临时移出
  shop.ids = ['1', '4', '2', '3'];                            // 同事把 1 拖到最前
  await alignCollections({}, state, { now: 5 * 60_000, gql: shop.gql });
  assert.equal(state.colState['99'].hold, 'manual');
  // = POST /col-hold { release: true }
  delete state.colState['99'].hold; state.colState['99'].released = 6 * 60_000;
  const r = await alignCollections({}, state, { now: 7 * 60_000, gql: shop.gql });
  assert.equal(r.applied.length, 0); assert.equal(r.skipped[0].why, 'released');
  assert.deepEqual(shop.ids, ['1', '4', '2', '3']);           // 没被排回去
  // 清单结束:5 加回来,顺序不照接管前的快照还原
  const r2 = await alignCollections({}, state, { now: 61 * 60_000, gql: shop.gql });
  assert.equal(r2.restored.length, 1); assert.equal(r2.restored[0].keptOrder, true);
  assert.deepEqual(shop.ids, ['1', '4', '2', '3', '5']);
  assert.equal(state.colState['99'], undefined);
});

test('保留后台的改动之后又改了清单内容 → 重新按清单排(以现在的顺序为底)', async () => {
  const shop = fakeShop();
  const p = pin({ products: [P(4)], start: 1000, end: 60 * 60_000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  shop.ids = ['3', '4', '1', '2', '5'];
  await alignCollections({}, state, { now: 5 * 60_000, gql: shop.gql });
  delete state.colState['99'].hold; state.colState['99'].released = 6 * 60_000;
  p.products = [P(5)];                                        // 改了清单再保存
  const r = await alignCollections({}, state, { now: 7 * 60_000, gql: shop.gql });
  assert.equal(r.applied.length, 1);
  assert.deepEqual(shop.ids, ['5', '3', '4', '1', '2']);
  assert.equal(state.colState['99'].released, undefined);
  await alignCollections({}, state, { now: 61 * 60_000, gql: shop.gql });
  assert.deepEqual(shop.ids, ['3', '4', '1', '2', '5']);      // 结束还原成「交回后台时」的顺序
});

test('不是「手动」排序的 Collection:不动店里的,交给前台排', async () => {
  for (const o of [{ sortOrder: 'BEST_SELLING' }, { sortOrder: 'BEST_SELLING', automated: true }]) {
    const shop = fakeShop(o);
    const state = stateWith(pin({ products: [P(4)], start: 1000, end: 9000 }));
    const r = await alignCollections({}, state, { now: 1500, gql: shop.gql });
    assert.equal(r.skipped.length, 1);
    assert.equal(shop.calls.length, 0);
    assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);
  }
});

test('带条件的 Collection,但排序设成了「手动」(Shopify 2026 新版 Collection):顺序真的改,加 / 移出产品交给前台', async () => {
  const shop = fakeShop({ automated: true });
  const p = pin({ products: [P(99), P(4), P(2)], hidden: [P(5)], start: 1000, end: 9000 }); // 99 不在合集里,5 要隐藏
  const state = stateWith(p);
  const r = await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(r.applied.length, 1);
  assert.deepEqual(shop.ids, ['4', '2', '1', '3', '5']);                  // 顺序真的改了;5 还在合集里(前台隐藏)
  assert.ok(!shop.calls.some((c) => c[0] === 'add' || c[0] === 'remove')); // 没去动它的产品
  assert.deepEqual(r.applied[0].front, { hidden: 1, outside: 1, needsNewApi: true }); // 旧版 API:要升到 2026-07 才能加减
  await alignCollections({}, state, { now: 10_000, gql: shop.gql });       // 结束 → 还原
  assert.deepEqual(shop.ids, ['1', '2', '3', '4', '5']);
});

test('要移出去太多(只显示清单里的 + 大 Collection)→ 不动店里的 Collection', async () => {
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

test('清单里排了 Collection 以外的产品 → 真的加进 Collection,结束再移出去', async () => {
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

test('中途把 Collection 外的产品从清单里删掉 → 下一轮从 Collection 里移出去', async () => {
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

test('move 数量最少:把第 50 拖到第 20 只发 1 个;把挤到前面的 3 个挪回去只发 3 个', () => {
  const B = Array.from({ length: 150 }, (_, i) => String(i + 1));
  const apply = (cur, mv) => { const a = [...cur]; for (const m of mv) { const id = m.id.split('/').pop(); a.splice(a.indexOf(id), 1); a.splice(+m.newPosition, 0, id); } return a; };
  const D = [...B]; const [x] = D.splice(49, 1); D.splice(19, 0, x);
  const m1 = movesFor(B, D); assert.equal(m1.length, 1); assert.deepEqual(apply(B, m1), D);
  const C = ['26', '27', 'x1', ...B.filter((id) => !['26', '27'].includes(id))]; // 前面插了 3 个
  const m2 = movesFor(C, [...B, 'x1']); assert.equal(m2.length, 3); assert.deepEqual(apply(C, m2), [...B, 'x1']);
});

test('move 随机打乱也都能排对', () => {
  let seed = 3; const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const apply = (cur, mv) => { const a = [...cur]; for (const m of mv) { const id = m.id.split('/').pop(); a.splice(a.indexOf(id), 1); a.splice(+m.newPosition, 0, id); } return a; };
  for (let t = 0; t < 300; t++) {
    const cur = Array.from({ length: 25 }, (_, i) => String(i + 1)); const want = [...cur];
    for (let k = 0; k < 1 + rnd(6); k++) { const [y] = want.splice(rnd(want.length), 1); want.splice(rnd(want.length + 1), 0, y); }
    assert.deepEqual(apply(cur, movesFor(cur, want)), want);
  }
});

// ---- 合集页「完全按清单顺序显示」:清单生效时打开 custom.cgp_sort_off,结束恢复原样 ----
function sortShop({ sortOrder = 'BEST_SELLING', mf = null } = {}) {
  const shop = { mf, calls: [] };
  shop.gql = async (ctx, q, v) => {
    if (q.includes('cgp_sort_off') && q.includes('collection(id')) return { collection: { id: v.id, title: 'Easter Deals', metafield: shop.mf } };
    if (q.includes('metafieldsSet')) { const m = v.m[0]; shop.calls.push(['set', m.value, m.type]); shop.mf = { value: m.value, type: m.type }; return { metafieldsSet: { metafields: [{ id: 'm' }], userErrors: [] } }; }
    if (q.includes('metafieldsDelete')) { shop.calls.push(['delete']); shop.mf = null; return { metafieldsDelete: { deletedMetafields: [{ key: 'cgp_sort_off' }], userErrors: [] } }; }
    if (q.includes('collection(id: $id)')) return { collection: { id: v.id, title: 'Easter Deals', sortOrder, ruleSet: null, products: { nodes: ['1', '2', '3'].map((id) => ({ id: `gid://shopify/Product/${id}` })), pageInfo: { hasNextPage: false } } } };
    throw new Error('没想到的查询 ' + q.slice(0, 40));
  };
  return shop;
}

test('完全按清单顺序:生效时打开,结束删掉(原来没有这个字段)', async () => {
  const shop = sortShop();
  const state = stateWith(pin({ products: [P(3)], fullOrder: true, start: 1000, end: 9000 }));
  const r1 = await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(r1.sortOn.length, 1);
  assert.deepEqual(shop.mf, { value: 'true', type: 'boolean' });
  const r2 = await alignCollections({}, state, { now: 1600, gql: shop.gql }); // 已经是开着的:不再写
  assert.equal(r2.sortOn.length, 0); assert.equal(shop.calls.length, 1);
  const r3 = await alignCollections({}, state, { now: 9500, gql: shop.gql }); // 结束
  assert.equal(r3.sortOff.length, 1);
  assert.equal(shop.mf, null);                                              // 原来没有 → 删掉
  assert.equal(state.sortFlags['99'], undefined);
});

test('完全按清单顺序:原来有值的,结束恢复成原来的值;原来就开着的,不写也不乱删', async () => {
  const shop = sortShop({ mf: { value: 'false', type: 'boolean' } });
  const state = stateWith(pin({ products: [P(3)], fullOrder: true, start: 1000, end: 9000 }));
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  assert.equal(shop.mf.value, 'true');
  await alignCollections({}, state, { now: 9500, gql: shop.gql });
  assert.deepEqual(shop.mf, { value: 'false', type: 'boolean' });

  const shop2 = sortShop({ mf: { value: 'true', type: 'boolean' } });
  const state2 = stateWith(pin({ products: [P(3)], fullOrder: true, start: 1000, end: 9000 }));
  await alignCollections({}, state2, { now: 1500, gql: shop2.gql });
  assert.equal(shop2.calls.length, 0);
  await alignCollections({}, state2, { now: 9500, gql: shop2.gql });
  assert.deepEqual(shop2.mf, { value: 'true', type: 'boolean' });         // 还是开着
});

test('完全按清单顺序:暂停 / 取消勾选也会恢复;没勾的清单不碰这个字段', async () => {
  const shop = sortShop();
  const p = pin({ products: [P(3)], fullOrder: true, start: 1000, end: 9000 });
  const state = stateWith(p);
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  p.fullOrder = false;
  const r = await alignCollections({}, state, { now: 1600, gql: shop.gql });
  assert.equal(r.sortOff.length, 1); assert.equal(shop.mf, null);
  const shop2 = sortShop();
  await alignCollections({}, stateWith(pin({ products: [P(3)], start: 1000, end: 9000 })), { now: 1500, gql: shop2.gql });
  assert.equal(shop2.calls.length, 0);
});

test('完全按清单顺序:第 1 天接第 2 天(都勾了),中间不恢复、不重复记', async () => {
  const shop = sortShop({ mf: { value: 'false', type: 'boolean' } });
  const d1 = pin({ id: 'd1', products: [P(3)], fullOrder: true, start: 1000, end: 5000 });
  const d2 = pin({ id: 'd2', products: [P(2)], fullOrder: true, start: 5000, end: 9000 });
  const state = { pins: [d1, d2], campaigns: [], colState: {} };
  await alignCollections({}, state, { now: 1500, gql: shop.gql });
  await alignCollections({}, state, { now: 6000, gql: shop.gql });
  assert.equal(state.sortFlags['99'].pinId, 'd2');
  assert.deepEqual(state.sortFlags['99'].prev, { value: 'false', type: 'boolean' }); // 还是最早那个「改之前」
  await alignCollections({}, state, { now: 9500, gql: shop.gql });
  assert.deepEqual(shop.mf, { value: 'false', type: 'boolean' });
});
