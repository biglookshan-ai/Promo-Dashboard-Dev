// 店铺里的内容类型(metaobject 定义)+ 上下线开关。
// 由本 app 创建,前台只读(PUBLIC_READ)。要按时间上下线的开 publishable:ACTIVE = 前台看得到,DRAFT = 看不到。
// 首页商品模块的「页签」不开 publishable(永远可读),它跟着所属的模块版本一起上下线。
// 主题只遍历 .values(只返回 ACTIVE),不写日期判断 —— 什么时候上线全由定时器切这个状态决定。
import { graphql } from './shopify.js';

export const REQUIRED_SCOPES = ['write_metaobject_definitions', 'write_metaobjects', 'write_files'];

const t = (key, name, type, extra = {}) => ({ key, name, type, ...extra });
const choices = (arr) => [{ name: 'choices', value: JSON.stringify(arr) }];
// 引用别的内容类型时先写占位,创建时替换成那个定义的真实 id
const REF = (type) => `__DEF:${type}__`;
const CAMPAIGN_REF = REF('cgp_campaign');

// 顺序有讲究:被引用的先建(活动 → … → 页签 → 模块版本)。
// core = 第一期的 4 个,全部建好才算「店铺连接好了」;后加的(首页商品模块)缺了只提示补建,不影响已有功能。
export const DEFINITIONS = [
  {
    type: 'cgp_campaign', core: true, name: 'CGP 活动(促销)', displayNameKey: 'name',
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
    type: 'cgp_banner_slide', core: true, name: 'CGP 首页 Banner', displayNameKey: 'title',
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
    type: 'cgp_topbar_message', core: true, name: 'CGP 顶栏公告', displayNameKey: 'text',
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
    type: 'cgp_topbar_style', core: true, name: 'CGP 顶栏样式', displayNameKey: 'name',
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
  {
    type: 'cgp_product_tab', publishable: false, name: 'CGP 首页商品页签', displayNameKey: 'title',
    description: '网站更新中心:首页商品模块里的一个页签(属于某个模块版本,跟着版本一起上下线)。由 app 管理,请勿在这里手改。',
    fields: [
      t('title', '页签名', 'single_line_text_field'),
      t('source', '产品来源', 'single_line_text_field', { validations: choices(['collection', 'products']) }),
      t('collection', '合集', 'collection_reference'),
      t('products', '手选产品', 'list.product_reference'),
      t('only_discounted', '只显示打折的', 'boolean'),
      t('sort_by_discount', '按折扣排序', 'boolean'),
      t('newest_first', '最新上架在前', 'boolean'),
      t('show_countdown', '显示倒计时', 'boolean'),
      t('limit', '最多显示几个', 'number_integer', { description: '0 = 不限' }),
      t('shop_all_url', 'Shop All 链接', 'single_line_text_field'),
      t('shop_all_text', 'Shop All 文字', 'single_line_text_field'),
    ],
  },
  {
    type: 'cgp_product_module', name: 'CGP 首页商品模块版本', displayNameKey: 'name',
    description: '网站更新中心:首页促销 / 推荐模块的一个版本(标题 + 一组页签),到时间整套替换;都不生效时用平时版本。由 app 管理,请勿在这里手改。',
    fields: [
      t('module', '模块', 'single_line_text_field', { required: true, validations: choices(['sale', 'feature']) }),
      t('name', '版本名', 'single_line_text_field', { required: true }),
      t('title', '标题(第一段)', 'single_line_text_field'),
      t('title2', '标题(第二段)', 'single_line_text_field'),
      t('title_color', '第一段颜色', 'color'),
      t('title2_color', '第二段颜色', 'color'),
      t('tab_active_bg', '页签高亮底色', 'color'),
      t('tab_active_text', '页签高亮文字色', 'color'),
      t('tabs', '页签', 'list.metaobject_reference', { validations: [{ name: 'metaobject_definition_id', value: REF('cgp_product_tab') }] }),
      t('priority', '优先级', 'number_integer'),
      t('is_default', '平时版本', 'boolean'),
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
    out.push({ type: def.type, name: def.name, core: !!def.core, exists: !!x, id: x?.id || null, entries: x?.metaobjectsCount ?? 0, publishable: !!x?.capabilities?.publishable?.enabled });
  }
  return out;
}

function toInput(def, ids) {
  return {
    type: def.type, name: def.name, description: def.description, displayNameKey: def.displayNameKey,
    access: { storefront: 'PUBLIC_READ' },
    capabilities: { publishable: { enabled: def.publishable !== false } },
    fieldDefinitions: def.fields.map((f) => ({
      key: f.key, name: f.name, type: f.type,
      ...(f.description ? { description: f.description } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.validations ? { validations: f.validations.map((v) => { const m = String(v.value).match(/^__DEF:(\w+)__$/); return { ...v, value: m ? ids[m[1]] : v.value }; }) } : {}),
    })),
  };
}

// 只建缺的,已存在的不动(可以重复点,不会重复建)
export async function ensureDefinitions(ctx, gql = graphql) {
  const status = await definitionStatus(ctx, gql);
  const created = [], existing = [], errors = [];
  const ids = Object.fromEntries(status.filter((x) => x.exists).map((x) => [x.type, x.id]));
  for (const def of DEFINITIONS) {
    if (ids[def.type]) { existing.push(def.type); continue; }
    const needs = [...new Set(def.fields.flatMap((f) => (f.validations || []).map((v) => String(v.value).match(/^__DEF:(\w+)__$/)?.[1]).filter(Boolean)))];
    const missing = needs.filter((x) => !ids[x]);
    if (missing.length) { errors.push({ type: def.type, message: `要先建好 ${missing.join('、')},先跳过` }); continue; }
    const d = await gql(ctx, `mutation($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message code } } }`,
    { definition: toInput(def, ids) });
    const r = d.metaobjectDefinitionCreate;
    if (r.userErrors?.length) { errors.push({ type: def.type, message: r.userErrors.map((e) => e.message).join('; ') }); continue; }
    created.push(def.type);
    ids[def.type] = r.metaobjectDefinition.id;
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

// ---- 把 app 里的一条内容写成 Shopify 条目(只写已批准的版本)----
export const TYPE_OF = { campaign: 'cgp_campaign', banner: 'cgp_banner_slide', topbar: 'cgp_topbar_message', tbstyle: 'cgp_topbar_style', pmodule: 'cgp_product_module' };
export const handleFor = (it) => `cgp-${String(it.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
export const toGid = (type, id) => (id == null ? null : String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${id}`);
const iso = (ms) => (ms == null ? '' : new Date(ms).toISOString());
const str = (v) => (v == null ? '' : String(v));
const list = (arr) => (arr && arr.length ? JSON.stringify(arr) : '');
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '');

// win = 有效时间窗(跟随活动的已换算成活动的时间),campaignGid = 所属活动的 Shopify id(没有就空)
export function fieldsFor(it, { win = { start: it.start, end: it.end }, campaignGid = '', tabGids = [] } = {}) {
  const f = {};
  if (it.kind === 'campaign') {
    Object.assign(f, {
      name: str(it.name), starts_at: iso(it.start), ends_at: iso(it.end),
      collections: list((it.collections || []).map((c) => toGid('Collection', c.id)).filter(Boolean)),
      tags: list(it.tags || []),
      products: list((it.products || []).map((p) => toGid('Product', p.id)).filter(Boolean)),
      badge_text: str(it.badge), show_countdown: it.countdown ? 'true' : 'false', priority: str(it.priority ?? 0),
    });
  } else if (it.kind === 'banner') {
    Object.assign(f, {
      title: str(it.title), subtitle: str(it.subtitle), description: str(it.description), image: str(it.imageId),
      button1_text: str(it.button1_text), button1_url: str(it.button1_url), button2_text: str(it.button2_text), button2_url: str(it.button2_url),
      tag: ['none', 'new', 'sale', 'event'].includes(it.tag) ? it.tag : 'none', position: str(it.order ?? 0),
    });
  } else if (it.kind === 'topbar') {
    Object.assign(f, { emoji: str(it.emoji), text: str(it.text), link: str(it.link), position: str(it.order ?? 0) });
  } else if (it.kind === 'tbstyle') {
    Object.assign(f, {
      name: str(it.name), background: hex(it.bg), text_color: hex(it.color), accent_color: hex(it.accent),
      effect: ['none', 'snow', 'sparkle', 'confetti'].includes(it.effect) ? it.effect : 'none',
      deco_left: str(it.decoLeft), deco_right: str(it.decoRight), priority: str(it.priority ?? 0), is_default: it.isDefault ? 'true' : 'false',
    });
  } else if (it.kind === 'pmodule') {
    Object.assign(f, {
      module: it.module === 'feature' ? 'feature' : 'sale', name: str(it.name), title: str(it.title), title2: str(it.title2),
      title_color: hex(it.titleColor), title2_color: hex(it.title2Color), tab_active_bg: hex(it.tabActiveBg), tab_active_text: hex(it.tabActiveText),
      tabs: list(tabGids), priority: str(it.priority ?? 0), is_default: it.isDefault ? 'true' : 'false',
    });
  }
  if (it.kind !== 'campaign') Object.assign(f, { campaign: campaignGid || '', starts_at: iso(win.start), ends_at: iso(win.end) });
  return Object.entries(f).map(([key, value]) => ({ key, value }));
}

const UPSERT = `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id handle capabilities { publishable { status } } } userErrors { field message code } } }`;
const errText = (errs) => errs.map((e) => `${(e.field || []).join('.')} ${e.message}`.trim()).join('; ');

export async function upsertItem(ctx, it, { status, win, campaignGid, tabGids } = {}, gql = graphql) {
  const handle = { type: TYPE_OF[it.kind], handle: handleFor(it) };
  const fields = fieldsFor(it, { win, campaignGid, tabGids });
  const send = (fs) => gql(ctx, UPSERT, { handle, metaobject: { fields: fs, capabilities: { publishable: { status } } } }).then((d) => d.metaobjectUpsert);
  let r = await send(fields);
  // 空值(没有副标题、没挂活动、没结束时间…)我们传的是空字符串,用来清空。
  // 万一 Shopify 对某类字段不收空字符串,就去掉空字段再写一次 —— 新建时效果一样,只是改的时候清不掉旧值。
  if (r.userErrors?.length && fields.some((f) => f.value === '')) {
    const retry = await send(fields.filter((f) => f.value !== ''));
    if (!retry.userErrors?.length) { console.warn(`[upsert] ${handle.handle} 带空值被拒(${errText(r.userErrors)}),去掉空字段后成功`); r = retry; }
  }
  if (r.userErrors?.length) throw new Error(errText(r.userErrors));
  return { id: r.metaobject.id, status: r.metaobject.capabilities.publishable.status };
}

// 首页商品模块的一个页签(不开 publishable,跟着模块版本上下线)。tab 存在模块版本的 tabs 数组里。
export const tabHandle = (tab) => `cgp-tab-${String(tab.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
export function tabFields(tab) {
  const f = {
    title: str(tab.title), source: tab.source === 'products' ? 'products' : 'collection',
    collection: tab.source === 'products' ? '' : str(toGid('Collection', tab.collection?.id)),
    products: tab.source === 'products' ? list((tab.products || []).map((p) => toGid('Product', p.id)).filter(Boolean)) : '',
    only_discounted: tab.onlyDiscounted ? 'true' : 'false', sort_by_discount: tab.sortByDiscount ? 'true' : 'false',
    newest_first: tab.newestFirst ? 'true' : 'false', show_countdown: tab.countdown ? 'true' : 'false',
    limit: String(Math.max(0, Math.round(Number(tab.limit ?? 20)) || 0)), shop_all_url: str(tab.shopAllUrl), shop_all_text: str(tab.shopAllText),
  };
  return Object.entries(f).map(([key, value]) => ({ key, value }));
}
export async function upsertTab(ctx, tab, gql = graphql) {
  const handle = { type: 'cgp_product_tab', handle: tabHandle(tab) };
  const fields = tabFields(tab);
  const send = (fs) => gql(ctx, UPSERT, { handle, metaobject: { fields: fs } }).then((d) => d.metaobjectUpsert);
  let r = await send(fields);
  if (r.userErrors?.length && fields.some((x) => x.value === '')) {
    const retry = await send(fields.filter((x) => x.value !== ''));
    if (!retry.userErrors?.length) r = retry;
  }
  if (r.userErrors?.length) throw new Error(`页签「${tab.title || ''}」:${errText(r.userErrors)}`);
  return r.metaobject.id;
}

export async function setPosition(ctx, id, position, gql = graphql) {
  const d = await gql(ctx, `mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message code } } }`,
  { id, metaobject: { fields: [{ key: 'position', value: String(position) }] } });
  if (d.metaobjectUpdate.userErrors?.length) throw new Error(d.metaobjectUpdate.userErrors.map((e) => e.message).join('; '));
}

export async function removeEntry(ctx, id, gql = graphql) {
  const d = await gql(ctx, `mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message code } } }`, { id });
  const errs = d.metaobjectDelete.userErrors || [];
  // 已经被删掉了也算成功
  if (errs.length && !errs.every((e) => /not exist|not found/i.test(e.message))) throw new Error(errs.map((e) => e.message).join('; '));
}
