import test from 'node:test';
import assert from 'node:assert/strict';
import { pickUkLocation, variantStock, locations, UK_LOCATION_DEFAULT } from '../src/price/catalog.js';

test('UK 仓:设置里选的 > 名字有 Cinegearpro > 像伦敦 / 英国 > 第一个在用的;停用的不自动选', () => {
  const L = [{ id: 'a', name: 'External Warehouse', active: true }, { id: 'b', name: 'CineGearPro', active: true }, { id: 'c', name: 'London Old', active: false }];
  assert.equal(pickUkLocation(L).id, 'b');
  assert.equal(pickUkLocation(L, 'a').id, 'a');
  assert.equal(pickUkLocation(L, 'gone').id, 'b');
  assert.equal(pickUkLocation([{ id: 'x', name: 'EW', active: true }, { id: 'y', name: 'UK Warehouse', active: true }]).id, 'y');
  assert.equal(pickUkLocation([{ id: 'x', name: 'EW', active: true }]).id, 'x');
  assert.equal(pickUkLocation([]), null);
  // 伦敦仓编号在,就优先用它(不管名字)
  assert.equal(pickUkLocation([{ id: 'x', name: 'Cinegearpro Old', active: true }, { id: UK_LOCATION_DEFAULT, name: '仓库 #43451853', active: true }]).id, UK_LOCATION_DEFAULT);
});

test('读仓库:没有 read_locations 读不到名字 → 只读编号,伦敦仓标上名字;连编号都读不到 → 只给伦敦仓', async () => {
  const deny = new Error('Access denied for name field. Required access: `read_locations` access scope');
  let r = await locations({}, async (ctx, q) => { if (q.includes('name')) throw deny; return { locations: { nodes: [{ id: UK_LOCATION_DEFAULT }, { id: 'gid://shopify/Location/9' }] } }; });
  assert.deepEqual(r.map((l) => l.name), ['Cinegearpro(伦敦)', '仓库 #9']);
  assert.equal(pickUkLocation(r).id, UK_LOCATION_DEFAULT);
  r = await locations({}, async () => { throw deny; });
  assert.deepEqual(r.map((l) => l.id), [UK_LOCATION_DEFAULT]);
  r = await locations({}, async () => ({ locations: { nodes: [{ id: 'a', name: 'Cinegearpro', isActive: true }] } })); // 有权限:照常读名字
  assert.equal(r[0].name, 'Cinegearpro');
  await assert.rejects(locations({}, async () => { throw new Error('网络断了'); }), /网络断了/);
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
