import test from 'node:test';
import assert from 'node:assert/strict';
import { pickUkLocation, variantStock } from '../src/price/catalog.js';

test('UK 仓:设置里选的 > 名字有 Cinegearpro > 像伦敦 / 英国 > 第一个在用的;停用的不自动选', () => {
  const L = [{ id: 'a', name: 'External Warehouse', active: true }, { id: 'b', name: 'CineGearPro', active: true }, { id: 'c', name: 'London Old', active: false }];
  assert.equal(pickUkLocation(L).id, 'b');
  assert.equal(pickUkLocation(L, 'a').id, 'a');
  assert.equal(pickUkLocation(L, 'gone').id, 'b');
  assert.equal(pickUkLocation([{ id: 'x', name: 'EW', active: true }, { id: 'y', name: 'UK Warehouse', active: true }]).id, 'y');
  assert.equal(pickUkLocation([{ id: 'x', name: 'EW', active: true }]).id, 'x');
  assert.equal(pickUkLocation([]), null);
});

test('款式在 UK 仓的可售数:不追踪库存 = null;这个仓没有记录 = 0;每批 50 个', async () => {
  const calls = [];
  const gql = async (ctx, q, v) => {
    calls.push(v.ids.length);
    assert.match(q, /inventoryLevel\(locationId: \$loc\)/); assert.equal(v.loc, 'L1');
    return { nodes: v.ids.map((id) => {
      const n = Number(id.split('/').pop());
      if (n === 3) return null; // 被删了
      return { id, inventoryItem: n === 1 ? { tracked: false, inventoryLevel: null } : n === 2 ? { tracked: true, inventoryLevel: null } : { tracked: true, inventoryLevel: { quantities: [{ quantity: n - 10 }] } } };
    }) };
  };
  const ids = Array.from({ length: 120 }, (_, i) => `gid://shopify/ProductVariant/${i + 1}`);
  const out = await variantStock({}, ids, 'L1', gql);
  assert.deepEqual(calls, [50, 50, 20]);
  assert.equal(out['gid://shopify/ProductVariant/1'], null);
  assert.equal(out['gid://shopify/ProductVariant/2'], 0);
  assert.equal('gid://shopify/ProductVariant/3' in out, false);
  assert.equal(out['gid://shopify/ProductVariant/12'], 2);
  assert.equal(out['gid://shopify/ProductVariant/4'], -6);
});
