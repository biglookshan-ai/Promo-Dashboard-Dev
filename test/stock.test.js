// 合集排序网格的库存:各仓库可售数量,所有款式加起来
import test from 'node:test';
import assert from 'node:assert/strict';
import { locLabel, productsStock } from '../src/counts.js';

test('仓库名字缩成短标签', () => {
  assert.equal(locLabel('CineGearPro UK Warehouse'), 'UK');
  assert.equal(locLabel('EU Warehouse (Netherlands)'), 'EU');
  assert.equal(locLabel('London Showroom'), 'UK');
  assert.equal(locLabel('Rotterdam - Netherlands'), 'EU');
  assert.equal(locLabel('GB Main'), 'UK');
  assert.equal(locLabel('Shenzhen Office'), 'Shenzhen');
});

test('按产品把各款式的可售数量加起来;不跟踪库存的标出来;负数当 0', async () => {
  const L = (name, n) => ({ location: { id: name, name }, quantities: [{ quantity: n }] });
  const V = (pid, tracked, levels) => ({ product: { id: `gid://shopify/Product/${pid}` }, inventoryItem: { tracked, inventoryLevels: { nodes: levels } } });
  let calls = 0;
  const gql = async (ctx, q, v) => {
    calls++;
    assert.match(v.q, /product_id:11 OR product_id:22 OR product_id:33/);
    return { productVariants: { nodes: [
      V(11, true, [L('UK Warehouse', 1), L('EU Warehouse', 2)]),
      V(11, true, [L('UK Warehouse', 3), L('EU Warehouse', -1)]),
      V(22, false, [L('UK Warehouse', 5)]),
      V(33, true, [L('UK Warehouse', 0), L('EU Warehouse', 0)]),
    ], pageInfo: { hasNextPage: false } } };
  };
  const { stock } = await productsStock({ shop: 'test-stock' }, ['11', 'gid://shopify/Product/22', '33', 'x'], gql);
  assert.deepEqual(stock['11'], { tracked: true, by: { UK: 4, EU: 2 } });
  assert.deepEqual(stock['22'], { tracked: false, by: {} });
  assert.deepEqual(stock['33'], { tracked: true, by: { UK: 0, EU: 0 } });
  // 两分钟内不重复读
  await productsStock({ shop: 'test-stock' }, ['11', '22', '33'], gql);
  assert.equal(calls, 1);
});
