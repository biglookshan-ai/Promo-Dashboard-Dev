// 合集排序网格的库存:读款式字段 custom.uk_inventory(UK)/ custom.es_inventory(后台叫 EW Inventory,显示成 EU),所有款式加起来
import test from 'node:test';
import assert from 'node:assert/strict';
import { productsStock } from '../src/counts.js';

const V = (pid, uk, es) => ({ product: { id: `gid://shopify/Product/${pid}` },
  uk_inventory: uk == null ? null : { value: String(uk) }, es_inventory: es == null ? null : { value: String(es) } });

test('按产品把各款式的 UK / EW 库存加起来;负数当 0;两个字段都没有 = 不显示', async () => {
  let calls = 0;
  const gql = async (ctx, q, v) => {
    calls++;
    assert.match(q, /namespace: "custom", key: "uk_inventory"/);
    assert.match(q, /namespace: "custom", key: "es_inventory"/);
    assert.doesNotMatch(q, /location|inventoryLevels/); // 不读仓库(不需要 read_locations / read_inventory)
    assert.match(v.q, /product_id:11 OR product_id:22 OR product_id:33/);
    return { productVariants: { nodes: [
      V(11, 1, 2), V(11, 3, -1),
      V(22, null, null),
      V(33, 0, 0),
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

test('翻页:一个产品的款式分在两页也照样加起来', async () => {
  const gql = async (ctx, q, v) => (v.after
    ? { productVariants: { nodes: [V(5, 2, 0)], pageInfo: { hasNextPage: false } } }
    : { productVariants: { nodes: [V(5, 1, 3)], pageInfo: { hasNextPage: true, endCursor: 'c1' } } });
  const { stock } = await productsStock({ shop: 'test-stock-pages' }, ['5'], gql);
  assert.deepEqual(stock['5'], { tracked: true, by: { UK: 3, EU: 3 } });
});
