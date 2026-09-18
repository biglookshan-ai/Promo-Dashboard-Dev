// 钻取:从一个定义进到「具体哪些资源有数据 / 哪些产品引用了这个条目」。
//
//  · metaobject → Metaobject.referencedBy 直接给反向引用(就是后台 References 面板),很快
//  · metafield → 只能分页扫 + 逐条核对
//
// ⚠️ 别再用 products(query:"metafields.{ns}.{key}:*") 来筛!
// 官方只支持按**值**筛(metafields.{ns}.{key}:{value}),这种「存在性」写法
// Shopify **不报错、直接忽略整个筛选条件**,结果是把全店产品都返回来 ——
// 症状就是不同字段点进去列表一模一样(见 2026-09 的 bug)。
// 所以这里改成:分页取回后逐条核对 metafield 确实有值,只信实际取到的数据。
import { graphql } from './shopify.js';
import { richToText } from './inventory.js';

const MAX_ROWS = 500; // 单次钻取上限,够看够管;超了前端提示用筛选缩小

// 按 owner 类型选查询根。page 取大一点减少往返,但要控制查询成本
// (每个节点多一个 metafield 对象,250 个变体那种容易顶到成本上限)。
const ROOTS = {
  PRODUCT: {
    root: 'products',
    fields: 'id title handle status',
    page: 250,
  },
  PRODUCTVARIANT: {
    root: 'productVariants',
    fields: 'id title sku product{ id title handle }',
    page: 100,
  },
  COLLECTION: {
    root: 'collections',
    fields: 'id title handle',
    page: 250,
  },
};

function displayValue(mf) {
  if (!mf) return '';
  const type = mf.type || '';
  if (type.includes('rich_text')) return richToText(mf.value);
  return String(mf.value ?? '');
}

const GID_RE = /gid:\/\/shopify\/[A-Za-z]+\/\d+/g;

// 引用类字段的值是一串 gid,直接显示没人看得懂。
// 收集所有 gid 批量换成名字 —— 一次额外查询,比在扫描时逐节点取 references 便宜得多。
async function resolveRefNames(ctx, rows) {
  const ids = new Set();
  for (const r of rows) for (const g of String(r.value).match(GID_RE) || []) ids.add(g);
  if (!ids.size) return;

  const nameById = new Map();
  const all = [...ids];
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    try {
      const d = await graphql(
        ctx,
        `query($ids:[ID!]!){ nodes(ids:$ids){
          __typename
          ... on Metaobject { id displayName type }
          ... on Product { id title }
          ... on Collection { id title }
          ... on ProductVariant { id title }
        }}`,
        { ids: chunk }
      );
      for (const n of d.nodes || []) {
        if (!n || !n.id) continue;
        nameById.set(n.id, n.displayName || n.title || n.id.split('/').pop());
      }
    } catch (e) {
      console.warn('[drill] 解析引用名失败,退回显示 ID:', e.message);
    }
  }

  for (const r of rows) {
    const gids = String(r.value).match(GID_RE);
    if (!gids) continue;
    r.refNames = gids.map((g) => nameById.get(g) || g.split('/').pop());
    r.value = r.refNames.join(', ');
  }
}

// 列出某个 metafield 定义下「确实有值」的资源。
// expected = 总账里的 metafieldsCount,找齐就提前收工,不用扫完全店。
export async function resourcesWithMetafield(ctx, { ownerType, namespace, key, expected = 0 }) {
  const spec = ROOTS[ownerType];
  if (!spec) return { ok: false, reason: `暂不支持钻取该资源类型: ${ownerType}` };

  const rows = [];
  let cursor = null;
  let truncated = false;
  let scanned = 0;

  try {
    do {
      const d = await graphql(
        ctx,
        `query($cursor:String,$ns:String!,$key:String!){
          ${spec.root}(first:${spec.page}, after:$cursor){
            pageInfo{ hasNextPage endCursor }
            nodes{
              ${spec.fields}
              metafield(namespace:$ns, key:$key){ value type }
            }
          }
        }`,
        { cursor, ns: namespace, key }
      );
      const c = d[spec.root];
      scanned += c.nodes.length;
      for (const n of c.nodes) {
        // 核心:只收真的有值的。不能信任查询筛选(见文件顶部说明)。
        const v = n.metafield?.value;
        if (v == null || v === '') continue;

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
          linkKind,
          linkId,
          linkHandle,
          value: displayValue(n.metafield),
        });
      }
      cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
      if (expected > 0 && rows.length >= expected) break;      // 已找齐,收工
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
    } while (cursor);
  } catch (e) {
    return { ok: false, reason: `扫描失败: ${e.message}` };
  }

  await resolveRefNames(ctx, rows); // gid → 可读名字
  return { ok: true, ownerType, namespace, key, count: rows.length, scanned, expected, truncated, rows };
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

  // 条目字段里也常是 gid(引用其它 metaobject/产品),一并换成名字。
  // fields 是对象引用,resolveRefNames 会就地改写它们的 value。
  await resolveRefNames(ctx, rows.flatMap((r) => r.fields));
  return { ok: true, type, count: rows.length, truncated, rows };
}
