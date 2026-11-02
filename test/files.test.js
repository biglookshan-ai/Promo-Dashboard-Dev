import test from 'node:test';
import assert from 'node:assert/strict';
import { imageById } from '../src/files.js';

test('Shopify 文件选择器给回的文件 id → 图片地址;不是图片 / 还没处理好的说清楚', async () => {
  let n = 0;
  const gql = async (ctx, q, v) => {
    n++;
    if (v.id.endsWith('/1')) return { node: { id: v.id, fileStatus: 'READY', image: { url: 'https://cdn.shopify.com/s/files/1/x/files/a.jpg' } } };
    if (v.id.endsWith('/2')) return { node: { id: v.id, fileStatus: n > 2 ? 'READY' : 'PROCESSING', image: n > 2 ? { url: 'https://cdn.shopify.com/b.jpg' } : null } };
    return { node: { id: v.id, fileStatus: 'FAILED' } };
  };
  assert.deepEqual(await imageById({}, 'gid://shopify/MediaImage/1', gql), { id: 'gid://shopify/MediaImage/1', url: 'https://cdn.shopify.com/s/files/1/x/files/a.jpg', status: 'READY' });
  n = 0; assert.equal((await imageById({}, 'gid://shopify/MediaImage/2', gql)).url, 'https://cdn.shopify.com/b.jpg'); // 刚上传的:等它处理好
  await assert.rejects(imageById({}, 'gid://shopify/Video/1', gql), /不是图片/);
  await assert.rejects(imageById({}, 'gid://shopify/MediaImage/3', gql), /处理图片失败/);
});
