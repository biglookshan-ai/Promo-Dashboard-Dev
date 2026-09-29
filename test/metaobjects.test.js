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

test('建全部 4 个类型:活动先建,其他类型的「所属活动」引用活动定义的真实 id', async () => {
  const s = fakeShop();
  const r = await ensureDefinitions({}, s.gql);
  assert.deepEqual(r.created, ['cgp_campaign', 'cgp_banner_slide', 'cgp_topbar_message', 'cgp_topbar_style']);
  const campId = s.defs.cgp_campaign;
  for (const def of s.created.slice(1)) {
    const ref = def.fieldDefinitions.find((f) => f.key === 'campaign');
    assert.equal(ref.validations[0].value, campId, def.type);
  }
  for (const def of s.created) {
    assert.deepEqual(def.capabilities, { publishable: { enabled: true } });
    assert.deepEqual(def.access, { storefront: 'PUBLIC_READ' });
  }
});

test('已存在的不重复建(可以重复点按钮)', async () => {
  const s = fakeShop({ cgp_campaign: 'gid://shopify/MetaobjectDefinition/1', cgp_banner_slide: 'gid://shopify/MetaobjectDefinition/2' });
  const r = await ensureDefinitions({}, s.gql);
  assert.deepEqual(r.existing, ['cgp_campaign', 'cgp_banner_slide']);
  assert.deepEqual(r.created, ['cgp_topbar_message', 'cgp_topbar_style']);
  assert.equal(s.created[0].fieldDefinitions.find((f) => f.key === 'campaign').validations[0].value, 'gid://shopify/MetaobjectDefinition/1');
});

test('字段类型都是合法的 Shopify 类型', () => {
  const ok = new Set(['single_line_text_field', 'multi_line_text_field', 'date_time', 'boolean', 'number_integer', 'color',
    'file_reference', 'metaobject_reference', 'list.collection_reference', 'list.product_reference', 'list.single_line_text_field']);
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
