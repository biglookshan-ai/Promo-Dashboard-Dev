import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFINITIONS, ensureDefinitions, missingScopes, setPublishStatus } from '../src/metaobjects.js';

// 假的 Shopify:记住建过哪些定义
function fakeShop(existing = {}) {
  const defs = { ...existing }; const created = []; let n = 100;
  const gql = async (ctx, query, vars) => {
    if (query.includes('metaobjectDefinitionByType')) {
      const d = defs[vars.type];
      return { metaobjectDefinitionByType: d ? { id: d, name: vars.type, metaobjectsCount: 0, capabilities: { publishable: { enabled: true } } } : null };
    }
    if (query.includes('metaobjectDefinitionCreate')) {
      const id = `gid://shopify/MetaobjectDefinition/${n++}`;
      defs[vars.definition.type] = id; created.push(vars.definition);
      return { metaobjectDefinitionCreate: { metaobjectDefinition: { id, type: vars.definition.type }, userErrors: [] } };
    }
    if (query.includes('metaobjectUpdate')) {
      return { metaobjectUpdate: { metaobject: { id: vars.id, capabilities: { publishable: { status: vars.metaobject.capabilities.publishable.status } } }, userErrors: [] } };
    }
    throw new Error('unexpected query');
  };
  return { gql, defs, created };
}

test('建全部 7 个类型:被引用的先建,引用字段填的是真实 id', async () => {
  const s = fakeShop();
  const r = await ensureDefinitions({}, s.gql);
  assert.deepEqual(r.created, ['cgp_campaign', 'cgp_banner_slide', 'cgp_topbar_message', 'cgp_topbar_style', 'cgp_product_tab', 'cgp_product_module', 'cgp_collection_pin']);
  const campId = s.defs.cgp_campaign;
  for (const def of s.created.filter((d) => d.fieldDefinitions.some((f) => f.key === 'campaign'))) {
    assert.equal(def.fieldDefinitions.find((f) => f.key === 'campaign').validations[0].value, campId, def.type);
  }
  const mod = s.created.find((d) => d.type === 'cgp_product_module');
  assert.equal(mod.fieldDefinitions.find((f) => f.key === 'tabs').validations[0].value, s.defs.cgp_product_tab);
  for (const def of s.created) {
    assert.deepEqual(def.capabilities, { publishable: { enabled: def.type !== 'cgp_product_tab' } }, def.type);
    assert.deepEqual(def.access, { storefront: 'PUBLIC_READ' });
  }
});

test('已存在的不重复建(可以重复点按钮)', async () => {
  const s = fakeShop({ cgp_campaign: 'gid://shopify/MetaobjectDefinition/1', cgp_banner_slide: 'gid://shopify/MetaobjectDefinition/2' });
  const r = await ensureDefinitions({}, s.gql);
  assert.deepEqual(r.existing, ['cgp_campaign', 'cgp_banner_slide']);
  assert.deepEqual(r.created, ['cgp_topbar_message', 'cgp_topbar_style', 'cgp_product_tab', 'cgp_product_module', 'cgp_collection_pin']);
  assert.equal(s.created[0].fieldDefinitions.find((f) => f.key === 'campaign').validations[0].value, 'gid://shopify/MetaobjectDefinition/1');
});

test('字段类型都是合法的 Shopify 类型', () => {
  const ok = new Set(['single_line_text_field', 'multi_line_text_field', 'date_time', 'boolean', 'number_integer', 'color',
    'file_reference', 'metaobject_reference', 'collection_reference', 'list.collection_reference', 'list.product_reference',
    'list.single_line_text_field', 'list.metaobject_reference']);
  for (const def of DEFINITIONS) for (const f of def.fields) assert.ok(ok.has(f.type), `${def.type}.${f.key}: ${f.type}`);
});

test('权限检查:write 自带 read,缺哪个报哪个', () => {
  assert.deepEqual(missingScopes(['read_products', 'write_metaobjects']), ['write_metaobject_definitions', 'write_files']);
  assert.deepEqual(missingScopes(['write_metaobject_definitions', 'write_metaobjects', 'write_files']), []);
});

test('上下线开关', async () => {
  const s = fakeShop();
  assert.equal(await setPublishStatus({}, 'gid://shopify/Metaobject/9', 'ACTIVE', s.gql), 'ACTIVE');
});

test('后加的类型缺了不影响「核心 4 个」;引用的类型没建好就先跳过', async () => {
  const s = fakeShop({ cgp_campaign: 'gid://1', cgp_banner_slide: 'gid://2', cgp_topbar_message: 'gid://3', cgp_topbar_style: 'gid://4' });
  const { definitionStatus } = await import('../src/metaobjects.js');
  const st = await definitionStatus({}, s.gql);
  assert.ok(st.filter((d) => d.core).every((d) => d.exists));
  assert.deepEqual(st.filter((d) => !d.exists).map((d) => d.type), ['cgp_product_tab', 'cgp_product_module', 'cgp_collection_pin']);
});

test('已建好的类型后来加了字段:补建时只补缺的字段,不重建', async () => {
  const pin = DEFINITIONS.find((d) => d.type === 'cgp_collection_pin');
  const oldKeys = pin.fields.map((f) => f.key).filter((k) => !['show_countdown', 'badge_text'].includes(k));
  const updates = [];
  const all = Object.fromEntries(DEFINITIONS.map((d, i) => [d.type, `gid://shopify/MetaobjectDefinition/${i + 1}`]));
  const gql = async (ctx, query, vars) => {
    if (query.includes('metaobjectDefinitionByType')) {
      const keys = vars.type === 'cgp_collection_pin' ? oldKeys : DEFINITIONS.find((d) => d.type === vars.type).fields.map((f) => f.key);
      return { metaobjectDefinitionByType: { id: all[vars.type], name: vars.type, metaobjectsCount: 0, capabilities: { publishable: { enabled: true } }, fieldDefinitions: keys.map((key) => ({ key })) } };
    }
    if (query.includes('metaobjectDefinitionUpdate')) { updates.push(vars); return { metaobjectDefinitionUpdate: { metaobjectDefinition: { id: vars.id }, userErrors: [] } }; }
    throw new Error('不该建新类型:' + query.slice(0, 60));
  };
  const r = await ensureDefinitions({}, gql);
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.updated, [{ type: 'cgp_collection_pin', fields: ['show_countdown', 'badge_text'] }]);
  assert.equal(updates[0].id, all.cgp_collection_pin);
  assert.deepEqual(updates[0].definition.fieldDefinitions.map((f) => f.create.key), ['show_countdown', 'badge_text']);
});
