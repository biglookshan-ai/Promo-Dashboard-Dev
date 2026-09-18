// 元数据总账:把店铺里所有自定义 metafield / metaobject 定义列出来,
// 带「多少条数据在用」「来源推断」「谁创建的」。
//
// 关键:metafieldsCount / metaobjectsCount 由 API 直接给,所以不用扫全站产品。
// MetafieldDefinition 没有「哪个 app 创建」字段(Shopify 不提供),只能靠命名空间
// 推断 + 主题扫描 + 人工标注三条线索拼;MetaobjectDefinition 则有 createdByApp。
import { graphql } from './shopify.js';

// 第一期覆盖范围(见 PROGRESS.md);要扩就往这里加 owner type。
export const OWNER_TYPES = ['PRODUCT', 'PRODUCTVARIANT', 'COLLECTION'];

const OWNER_LABEL = {
  PRODUCT: '产品',
  PRODUCTVARIANT: '变体',
  COLLECTION: '合集',
};

// 已知三方 app / 平台的命名空间 → 来源。命名空间是判断归属最强的机器线索。
const KNOWN_NAMESPACES = {
  shopify: { source: 'Shopify 标准', owner: 'Shopify 分类标准字段(只读)' },
  'shopify--discovery--product_search_boost': { source: 'Shopify App', owner: 'Search & Discovery' },
  google: { source: '三方 App', owner: 'Google 销售渠道' },
  'mm-google-shopping': { source: '三方 App', owner: 'Google Shopping' },
  booqable: { source: '三方 App', owner: 'Booqable 租赁' },
  judgeme: { source: '三方 App', owner: 'Judge.me 评价' },
  loox: { source: '三方 App', owner: 'Loox 评价' },
  yotpo: { source: '三方 App', owner: 'Yotpo' },
  klaviyo: { source: '三方 App', owner: 'Klaviyo' },
  searchanise: { source: '三方 App', owner: 'Searchanise' },
  descriptors: { source: 'Shopify 标准', owner: '主题内置描述字段' },
  reviews: { source: '三方 App', owner: 'Product Reviews' },
};

// 从命名空间推断来源。custom.* 是商家自建(自研主题功能/自研 app 多半在这)。
export function inferSource(namespace) {
  if (KNOWN_NAMESPACES[namespace]) return KNOWN_NAMESPACES[namespace];
  if (namespace === 'custom' || namespace === 'my_fields')
    return { source: '商家自定义', owner: '自研主题功能 / 自研 app(需标注确认)' };
  if (namespace.startsWith('app--')) return { source: 'App 私有', owner: '某个 app 的保留命名空间' };
  if (namespace.startsWith('shopify--')) return { source: 'Shopify 标准', owner: 'Shopify 官方 app' };
  return { source: '具名命名空间', owner: '未识别,建议人工标注' };
}

// 取某个 owner type 下的全部 metafield 定义(不限命名空间)。
// metafieldsCount 直接给出有多少条资源填了值 —— 免全站扫描。
async function definitionsFor(ctx, ownerType) {
  const out = [];
  let cursor = null;
  do {
    const d = await graphql(
      ctx,
      `query($ownerType:MetafieldOwnerType!,$cursor:String){
        metafieldDefinitions(ownerType:$ownerType, first:250, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{
            id name namespace key description ownerType pinnedPosition
            type{ name }
            metafieldsCount
            access{ admin storefront }
          }
        }
      }`,
      { ownerType, cursor }
    );
    const c = d.metafieldDefinitions;
    out.push(...c.nodes);
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

// Metaobject 定义:这边能直接拿到 createdByApp / createdByStaff。
// 老 API 版本可能没有这两个字段,失败就退回精简查询。
async function metaobjectDefinitions(ctx) {
  const rich = `query($cursor:String){
    metaobjectDefinitions(first:100, after:$cursor){
      pageInfo{ hasNextPage endCursor }
      nodes{
        id name type description metaobjectsCount
        createdByApp{ title }
        createdByStaff{ name }
        fieldDefinitions{ key name required type{ name } }
      }
    }
  }`;
  const lean = `query($cursor:String){
    metaobjectDefinitions(first:100, after:$cursor){
      pageInfo{ hasNextPage endCursor }
      nodes{
        id name type description metaobjectsCount
        fieldDefinitions{ key name required type{ name } }
      }
    }
  }`;
  const run = async (q) => {
    const out = [];
    let cursor = null;
    do {
      const d = await graphql(ctx, q, { cursor });
      const c = d.metaobjectDefinitions;
      out.push(...c.nodes);
      cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
    } while (cursor);
    return out;
  };
  try { return await run(rich); }
  catch (e) {
    console.warn('[registry] createdByApp 不可用,退回精简查询:', e.message);
    return run(lean);
  }
}

// 组装总账。themeIndex 来自 theme-scan.js(可为 null —— 没有 read_themes 权限时)。
export async function buildRegistry(ctx, { themeIndex = null } = {}) {
  const [defsByOwner, moDefs, shopInfo] = await Promise.all([
    Promise.all(OWNER_TYPES.map((t) => definitionsFor(ctx, t).then((nodes) => [t, nodes]))),
    metaobjectDefinitions(ctx),
    // 前端拼后台/前台深链要用
    graphql(ctx, `query{ shop{ primaryDomain{ url } } }`).catch(() => null),
  ]);

  const metafields = [];
  for (const [ownerType, nodes] of defsByOwner) {
    for (const n of nodes) {
      const full = `${n.namespace}.${n.key}`;
      const inferred = inferSource(n.namespace);
      const usage = themeIndex ? themeIndex.metafields.get(full) || [] : null;
      metafields.push({
        id: n.id,
        ownerType,
        ownerLabel: OWNER_LABEL[ownerType] || ownerType,
        name: n.name,
        namespace: n.namespace,
        key: n.key,
        full,
        description: n.description || '',
        type: n.type?.name || '',
        dataCount: n.metafieldsCount ?? null,
        pinned: n.pinnedPosition != null,
        storefrontVisible: n.access?.storefront && n.access.storefront !== 'NONE',
        source: inferred.source,
        ownerGuess: inferred.owner,
        themeUsage: usage,                       // null = 未扫描; [] = 扫了但没用到
        annotationKey: `${ownerType}:${full}`,   // 人工标注的主键
      });
    }
  }

  const metaobjects = moDefs.map((m) => {
    const usage = themeIndex ? themeIndex.metaobjects.get(m.type) || [] : null;
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      // metaobject 也要有 source,否则「来源」筛选一开就把它们全滤掉。
      source: m.createdByApp ? 'App 创建' : (m.createdByStaff ? '人工创建' : '未知来源'),
      description: m.description || '',
      entryCount: m.metaobjectsCount ?? null,
      createdByApp: m.createdByApp?.title || null,
      createdByStaff: m.createdByStaff?.name || null,
      fieldCount: (m.fieldDefinitions || []).length,
      fields: (m.fieldDefinitions || []).map((f) => ({
        key: f.key, name: f.name, type: f.type?.name || '', required: !!f.required,
      })),
      themeUsage: usage,
      annotationKey: `metaobject:${m.type}`,
    };
  });

  // 疑似废弃:没数据、主题也没引用(只有扫过主题才敢下这个判断)。
  const flagStale = (row, count) =>
    count === 0 && Array.isArray(row.themeUsage) && row.themeUsage.length === 0;
  for (const r of metafields) r.stale = flagStale(r, r.dataCount);
  for (const r of metaobjects) r.stale = flagStale(r, r.entryCount);

  return {
    generatedAt: new Date().toISOString(),
    shop: ctx.shop,
    store: {
      handle: ctx.shop.replace('.myshopify.com', ''),
      storefrontUrl: shopInfo?.shop?.primaryDomain?.url || `https://${ctx.shop}`,
    },
    ownerTypes: OWNER_TYPES.map((t) => ({ type: t, label: OWNER_LABEL[t] || t })),
    metafields,
    metaobjects,
    theme: themeIndex ? themeIndex.theme : null,
    themeScanned: !!themeIndex,
  };
}
