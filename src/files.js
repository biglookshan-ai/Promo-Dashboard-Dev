// Banner 图片:上传到 Shopify Files(文件库),拿到 MediaImage 的 id 给 Banner 的「图片」字段用。
// 需要 write_files。三种来源:
//   1. 后台编辑器里上传的新图 → uploadImage(先要一个临时上传地址,传上去,再登记成文件)
//   2. 主题里本来就有的图(shopify://shop_images/xxx.jpg)→ findImageByFilename 在文件库里按文件名找
//   3. 粘贴的图片网址 → createImageFromUrl,让 Shopify 自己去抓
import { graphql } from './shopify.js';

const FILE_FIELDS = 'id fileStatus ... on MediaImage { image { url width height } }';
const pickImage = (n) => (n ? { id: n.id, url: n.image?.url || '', status: n.fileStatus } : null);

export async function findImageByFilename(ctx, filename, gql = graphql) {
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  // 搜索写法依次试(真实店里哪种生效以结果为准);只认文件名完全一致的 ——
  // 搜索条件万一被 Shopify 忽略,也不会拿错图(都找不到就由调用方改用网址新建)
  const queries = [`filename:${base}*`, `filename:'${base.replace(/'/g, "\\'")}*'`, base];
  for (const q of queries) {
    try {
      const d = await gql(ctx, `query($q: String!) { files(first: 25, query: $q) { nodes { ${FILE_FIELDS} } } }`, { q });
      const exact = d.files.nodes.find((n) => n.image?.url && decodeURIComponent(n.image.url.split('?')[0].split('/').pop()) === filename);
      if (exact) return pickImage(exact);
    } catch (e) { /* 这种写法不支持,试下一种 */ }
  }
  return null;
}

async function waitReady(ctx, id, gql, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const d = await gql(ctx, `query($id: ID!) { node(id: $id) { ${FILE_FIELDS} } }`, { id });
    const n = d.node;
    if (n?.fileStatus === 'FAILED') throw new Error('Shopify 处理图片失败(格式不支持或文件损坏)');
    if (n?.image?.url) return pickImage(n);
    await new Promise((r) => setTimeout(r, 800));
  }
  return { id, url: '', status: 'PROCESSING' };
}

export async function createImageFromUrl(ctx, url, gql = graphql, alt = '') {
  const d = await gql(ctx, `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { field message } } }`,
    { files: [{ originalSource: url, contentType: 'IMAGE', alt }] });
  const r = d.fileCreate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join('; '));
  return waitReady(ctx, r.files[0].id, gql);
}

export async function uploadImage(ctx, buffer, filename, mimeType, gql = graphql) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) throw new Error('只支持 JPG / PNG / WebP / GIF 图片');
  const d = await gql(ctx, `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
  { input: [{ resource: 'IMAGE', filename, mimeType, httpMethod: 'POST', fileSize: String(buffer.length) }] });
  const r = d.stagedUploadsCreate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join('; '));
  const t = r.stagedTargets[0];
  const form = new FormData();
  for (const p of t.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const up = await fetch(t.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`图片上传失败(${up.status})`);
  return createImageFromUrl(ctx, t.resourceUrl, gql, filename.replace(/\.[a-z0-9]+$/i, ''));
}
