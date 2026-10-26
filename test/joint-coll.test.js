// 联合推广:app 里直接建合集(能发布就发布)+ 读 KitBundle 的加购优惠有没有生效
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJointCollection, jointDealStatus } from '../src/joint-coll.js';

test('建 Collection:兼容产品那个套活动页模板;有发布权限就发布到网店', async () => {
  const calls = [];
  const gql = async (ctx, q, v) => {
    if (q.includes('collectionCreate')) { calls.push(['create', v.c]); return { collectionCreate: { collection: { id: 'gid://shopify/Collection/77', title: v.c.title, handle: 'sf-lenses' }, userErrors: [] } }; }
    if (q.includes('publications(')) return { publications: { nodes: [{ id: 'gid://shopify/Publication/1', name: 'Point of Sale' }, { id: 'gid://shopify/Publication/2', name: 'Online Store' }] } };
    if (q.includes('publishablePublish')) { calls.push(['publish', v.id, v.p[0].publicationId]); return { publishablePublish: { userErrors: [] } }; }
    throw new Error('?');
  };
  const r = await createJointCollection({}, { title: ' Smart Fusion Compatible Lenses ', landing: true }, gql);
  assert.equal(r.published, true);
  assert.deepEqual(calls[0], ['create', { title: 'Smart Fusion Compatible Lenses', sortOrder: 'MANUAL', templateSuffix: 'joint-promo' }]);
  assert.deepEqual(calls[1], ['publish', 'gid://shopify/Collection/77', 'gid://shopify/Publication/2']);
});

test('建 Collection:没有发布权限也照样建好,告诉人去后台勾「网店」', async () => {
  const gql = async (ctx, q, v) => {
    if (q.includes('collectionCreate')) return { collectionCreate: { collection: { id: 'gid://shopify/Collection/78', title: v.c.title, handle: 'sf' }, userErrors: [] } };
    throw new Error('Access denied for publications field. Required access: `read_publications` access scope.');
  };
  const r = await createJointCollection({}, { title: 'Smart Fusion' }, gql);
  assert.equal(r.published, false);
  assert.match(r.why, /发布」权限/);
  await assert.rejects(createJointCollection({}, { title: '  ' }, gql), /名称/);
});

test('KitBundle 加购优惠:兼容产品上有打折产品是推广 Collection 的 deal 标记 = 已生效', async () => {
  const stamp = (entries) => ({ value: JSON.stringify(entries) });
  const gql = async (ctx, q, v) => {
    if (v.id.endsWith('/1')) return { collection: { products: { nodes: [
      { id: 'gid://shopify/Product/11', gt: stamp([{ id: 'camp_g', rewardMode: 'all', giftIds: ['99'] }, { id: 'camp_d', kind: 'deal', pct: 10, giftIds: ['500'] }]) },
      { id: 'gid://shopify/Product/12', gt: null }] } } };
    return { collection: { products: { nodes: [{ id: 'gid://shopify/Product/500' }] } } };
  };
  assert.deepEqual(await jointDealStatus({}, { lensCollectionId: '1', promoCollectionId: '2' }, gql),
    { status: 'active', campaignId: 'camp_d', pct: 10, stamped: 1, checked: 2 });
  const none = async (ctx, q, v) => (v.id.endsWith('/1') ? { collection: { products: { nodes: [{ id: 'gid://shopify/Product/11', gt: stamp([{ id: 'camp_g', giftIds: ['500'] }]) }] } } }
    : { collection: { products: { nodes: [{ id: 'gid://shopify/Product/500' }] } } });
  assert.equal((await jointDealStatus({}, { lensCollectionId: '1', promoCollectionId: '2' }, none)).status, 'none'); // 免费赠品不算
});
