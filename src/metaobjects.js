// 店铺里的 4 个内容类型(metaobject 定义)+ 上下线开关。
// 由本 app 创建,前台只读(PUBLIC_READ),全部开 publishable:ACTIVE = 前台看得到,DRAFT = 看不到。
// 主题只遍历 .values(只返回 ACTIVE),不写日期判断 —— 什么时候上线全由定时器切这个状态决定。
import { graphql } from './shopify.js';

export const REQUIRED_SCOPES = ['write_metaobject_definitions', 'write_metaobjects', 'write_files'];

const t = (key, name, type, extra = {}) => ({ key, name, type, ...extra });
const choices = (arr) => [{ name: 'choices', value: JSON.stringify(arr) }];
const CAMPAIGN_REF = '__CAMPAIGN_DEF_ID__'; // 创建时替换成活动定义的真实 id

// 顺序有讲究:活动先建,其他类型的「所属活动」字段要引用它
export const DEFINITIONS = [
  {
    type: 'cgp_campaign', name: 'CGP 活动(促销)', displayNameKey: 'name',
    description: '网站更新中心:有时间段的促销。参加的产品 = 合集 + 标签 + 指定产品(满足任一)。由 app 管理,请勿在这里手改。',
    fields: [
      t('name', '名称', 'single_line_text_field', { required: true }),
      t('starts_at', '开始', 'date_time'),
      t('ends_at', '结束', 'date_time', { description: '产品页倒计时倒数到这个时间' }),
      t('collections', '参加的合集', 'list.collection_reference'),
      t('tags', '参加的产品标签', 'list.single_line_text_field'),
      t('products', '指定产品', 'list.product_reference'),
      t('badge_text', '产品页徽章文字', 'single_line_text_field'),
      t('show_countdown', '显示倒计时', 'boolean'),
      t('priority', '优先级', 'number_integer', { description: '一个产品同时在多个活动里时,数字大的优先' }),
    ],
  },
  {
    type: 'cgp_banner_slide', name: 'CGP 首页 Banner', displayNameKey: 'title',
    description: '网站更新中心:首页轮播卡片(竖图 430×600)。由 app 管理,请勿在这里手改。',
    fields: [
      t('title', '标题', 'single_line_text_field'),
      t('subtitle', '副标题', 'single_line_text_field'),
      t('description', '描述', 'multi_line_text_field'),
      t('image', '图片', 'file_reference', { validations: [{ name: 'file_type_options', value: '["Image"]' }] }),
      t('button1_text', '按钮 1 文字', 'single_line_text_field'),
      t('button1_url', '按钮 1 链接', 'single_line_text_field', { description: '站内路径,如 /collections/xxx' }),
      t('button2_text', '按钮 2 文字', 'single_line_text_field'),
      t('button2_url', '按钮 2 链接', 'single_line_text_field'),
      t('tag', '角标', 'single_line_text_field', { validations: choices(['none', 'new', 'sale', 'event']) }),
      t('position', '轮播位置', 'number_integer', { description: '数字小的排前面' }),
      t('campaign', '所属活动', 'metaobject_reference', { validations: [{ name: 'metaobject_definition_id', value: CAMPAIGN_REF }] }),
      t('starts_at', '开始(仅记录)', 'date_time'),
      t('ends_at', '结束(仅记录)', 'date_time'),
    ],
  },
  {
    type: 'cgp_topbar_message', name: 'CGP 顶栏公告', displayNameKey: 'text',
    description: '网站更新中心:顶栏轮播的一条公告。由 app 管理,请勿在这里手改。',
    fields: [
      t('emoji', 'Emoji', 'single_line_text_field'),
      t('text', '文字', 'single_line_text_field', { required: true }),
      t('link', '链接', 'single_line_text_field'),
      t('position', '轮播位置', 'number_integer'),
      t('campaign', '所属活动', 'metaobject_reference', { validations: [{ name: 'metaobject_definition_id', value: CAMPAIGN_REF }] }),
      t('starts_at', '开始(仅记录)', 'date_time'),
      t('ends_at', '结束(仅记录)', 'date_time'),
    ],
  },
  {
    type: 'cgp_topbar_style', name: 'CGP 顶栏样式', displayNameKey: 'name',
    description: '网站更新中心:顶栏外观(节日主题)。同时有多个生效时优先级高的赢;都没有时用默认样式。由 app 管理,请勿在这里手改。',
    fields: [
      t('name', '名称', 'single_line_text_field', { required: true }),
      t('background', '底色', 'color'),
      t('text_color', '文字颜色', 'color'),
      t('accent_color', '点缀色', 'color'),
      t('effect', '特效', 'single_line_text_field', { validations: choices(['none', 'snow', 'sparkle', 'confetti']) }),
      t('deco_left', '公告前装饰', 'single_line_text_field'),
      t('deco_right', '公告后装饰', 'single_line_text_field'),
      t('priority', '优先级', 'number_integer'),
      t('is_default', '默认样式', 'boolean'),
      t('campaign', '所属活动', 'metaobject_reference', { validations: [{ name: 'metaobject_definition_id', value: CAMPAIGN_REF }] }),
      t('starts_at', '开始(仅记录)', 'date_time'),
      t('ends_at', '结束(仅记录)', 'date_time'),
    ],
  },
];

// ---- 权限 ----
export async function grantedScopes(ctx, gql = graphql) {
  const d = await gql(ctx, '{ currentAppInstallation { accessScopes { handle } } }');
  return d.currentAppInstallation.accessScopes.map((s) => s.handle);
}
// write_x 自带 read_x
export function missingScopes(granted) {
  const has = new Set(granted);
  return REQUIRED_SCOPES.filter((s) => !has.has(s));
}

// ---- 定义是否已建 ----
export async function definitionStatus(ctx, gql = graphql) {
  const out = [];
  for (const def of DEFINITIONS) {
    const d = await gql(ctx, `query($type: String!) { metaobjectDefinitionByType(type: $type) { id name metaobjectsCount capabilities { publishable { enabled } } } }`, { type: def.type });
    const x = d.metaobjectDefinitionByType;
    out.push({ type: def.type, name: def.name, exists: !!x, id: x?.id || null, entries: x?.metaobjectsCount ?? 0, publishable: !!x?.capabilities?.publishable?.enabled });
  }
  return out;
}

function toInput(def, campaignDefId) {
  return {
    type: def.type, name: def.name, description: def.description, displayNameKey: def.displayNameKey,
    access: { storefront: 'PUBLIC_READ' },
    capabilities: { publishable: { enabled: true } },
    fieldDefinitions: def.fields.map((f) => ({
      key: f.key, name: f.name, type: f.type,
      ...(f.description ? { description: f.description } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.validations ? { validations: f.validations.map((v) => ({ ...v, value: v.value === CAMPAIGN_REF ? campaignDefId : v.value })) } : {}),
    })),
  };
}

// 只建缺的,已存在的不动(可以重复点,不会重复建)
export async function ensureDefinitions(ctx, gql = graphql) {
  const status = await definitionStatus(ctx, gql);
  const created = [], existing = [], errors = [];
  let campaignDefId = status.find((s) => s.type === 'cgp_campaign')?.id || null;
  for (const def of DEFINITIONS) {
    const st = status.find((s) => s.type === def.type);
    if (st?.exists) { existing.push(def.type); continue; }
    if (def.type !== 'cgp_campaign' && !campaignDefId) { errors.push({ type: def.type, message: '活动类型没建成,先跳过' }); continue; }
    const d = await gql(ctx, `mutation($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message code } } }`,
    { definition: toInput(def, campaignDefId) });
    const r = d.metaobjectDefinitionCreate;
    if (r.userErrors?.length) { errors.push({ type: def.type, message: r.userErrors.map((e) => e.message).join('; ') }); continue; }
    created.push(def.type);
    if (def.type === 'cgp_campaign') campaignDefId = r.metaobjectDefinition.id;
  }
  return { created, existing, errors };
}

// ---- 上下线开关 ----
export async function setPublishStatus(ctx, id, status, gql = graphql) {
  const d = await gql(ctx, `mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id capabilities { publishable { status } } } userErrors { field message code } } }`,
  { id, metaobject: { capabilities: { publishable: { status } } } });
  const r = d.metaobjectUpdate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join('; '));
  return r.metaobject.capabilities.publishable.status;
}
