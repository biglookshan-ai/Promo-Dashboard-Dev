// 钻取:从一个定义进到「具体哪些资源有数据 / 哪些产品引用了这个条目」。
//
// 两条都不用扫全站:
//  · metafield → products(query:"metafields.{ns}.{key}:*") 官方支持的筛选器,只返命中的
//  · metaobject → Metaobject.referencedBy 直接给反向引用(就是后台 References 面板)
import { graphql } from './shopify.js';
import { richToText } from './inventory.js';

const PAGE = 50;
const MAX_ROWS = 500; // 单次钻取上限,够看够管;超了前端提示用筛选缩小

// 按 owner 类型选查询根。collections/productVariants 不一定支持 metafields 筛选,
// 不支持就如实报错,不偷偷退化成全站扫描(那会很慢且没提示)。
const ROOTS = {
  PRODUCT: {
    root: 'products',
    fields: 'id title handle status featuredImage{ url altText }',
  },
  PRODUCTVARIANT: {
    root: 'productVariants',
    fields: 'id title sku product{ id title handle }',
  },
  COLLECTION: {
    root: 'collections',
    fields: 'id title handle',
  },
};

function displayValue(mf) {
  if (!mf) return '';
  const type = mf.type || '';
  if (type.includes('rich_text')) return richToText(mf.value);
  return String(mf.value ?? '');
}

// 列出某个 metafield 定义下「有值」的资源。
export async function resourcesWithMetafield(ctx, { ownerType, namespace, key }) {
  const spec = ROOTS[ownerType];
  if (!spec) return { ok: false, reason: `暂不支持钻取该资源类型: ${ownerType}` };

  const q = `metafields.${namespace}.${key}:*`; // exists 查询
  const rows = [];
  let cursor = null;
  let truncated = false;

  try {
    do {
      const d = await graphql(
        ctx,
        `query($q:String!,$cursor:String,$ns:String!,$key:String!){
          ${spec.root}(first:${PAGE}, after:$cursor, query:$q){
            pageInfo{ hasNextPage endCursor }
            nodes{
              ${spec.fields}
              metafield(namespace:$ns, key:$key){ value type }
            }
          }
        }`,
        { q, cursor, ns: namespace, key }
      );
      const c = d[spec.root];
      for (const n of c.nodes) {
        // 变体在后台没有独立页面,后台/前台链接都要指向它所属的产品。
        const isVariant = ownerType === 'PRODUCTVARIANT';
        const linkKind = ownerType === 'COLLECTION' ? 'Collection' : 'Product';
        const linkId = (isVariant ? n.product?.id : n.id)?.split('/').pop() || '';
        const linkHandle = isVariant ? (n.product?.handle || '') : (n.handle || '');
        rows.push({
          id: n.id.split('/').pop(),
          title: n.title || n.handle || n.sku || n.id,
          status: n.status || '',
          sku: n.sku || '',
          parentTitle: n.product?.title || '',
          image: n.featuredImage?.url || '',
          linkKind,
          linkId,
          linkHandle,
          value: displayValue(n.metafield),
        });
      }
      cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
    } while (cursor);
  } catch (e) {
    return { ok: false, reason: `按字段筛选失败(该资源类型可能不支持): ${e.message}` };
  }

  return { ok: true, ownerType, namespace, key, count: rows.length, truncated, rows };
}

// 列出某个 metaobject 定义的条目,每条带字段内容 + 谁引用了它。
export async function metaobjectEntriesWithRefs(ctx, { type }) {
  const rows = [];
  let cursor = null;
  let truncated = false;

  do {
    const d = await graphql(
      ctx,
      `query($type:String!,$cursor:String){
        metaobjects(type:$type, first:25, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{
            id handle displayName updatedAt
            fields{ key type value }
            referencedBy(first:25){
              nodes{
                namespace key
                referencer{
                  __typename
                  ... on Product { id title handle status }
                  ... on ProductVariant { id title sku product{ id title handle } }
                  ... on Collection { id title handle }
                  ... on Metaobject { id handle type }
                }
              }
            }
          }
        }
      }`,
      { type, cursor }
    );
    const c = d.metaobjects;
    for (const n of c.nodes) {
      const refs = (n.referencedBy?.nodes || []).map((r) => {
        const x = r.referencer || {};
        const isVariant = x.__typename === 'ProductVariant';
        return {
          kind: x.__typename || '未知',
          id: x.id ? x.id.split('/').pop() : '',
          // 变体在后台没有独立页面,链接要指向它所属的产品
          linkId: isVariant && x.product?.id ? x.product.id.split('/').pop() : (x.id ? x.id.split('/').pop() : ''),
          title: x.title || x.handle || x.id || '',
          handle: x.handle || x.product?.handle || '',
          parentTitle: isVariant ? (x.product?.title || '') : '',
          viaField: `${r.namespace}.${r.key}`,
        };
      });
      rows.push({
        id: n.id.split('/').pop(),
        handle: n.handle,
        title: n.displayName || n.handle,
        updatedAt: n.updatedAt,
        fields: n.fields
          .map((f) => ({
            key: f.key,
            value: f.type?.includes('rich_text') ? richToText(f.value) : String(f.value ?? ''),
          }))
          .filter((f) => f.value.trim() !== ''),
        refs,
        refCount: refs.length,
      });
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
    }
    if (truncated) break;
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (cursor);

  return { ok: true, type, count: rows.length, truncated, rows };
}
