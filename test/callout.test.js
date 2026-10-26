// 产品页推广块的条件(和主题 snippets/cgp-pdp-callout.liquid 同一套判断)
import test from 'node:test';
import assert from 'node:assert/strict';
import { calloutQuery, calloutTitleOk, calloutScope } from '../src/counts.js';
import { validate } from '../src/schedule-actions.js';
import { fieldsFor } from '../src/metaobjects.js';

const R = [
  { f: 'vendor', n: false, v: ['DZOFILM', 'Thypoch'] }, { f: 'type', n: false, v: ['Cine Lens'] },
  { f: 'title', n: true, v: ['pavo'] }, { f: 'tag', n: true, v: ["it's af"] }, { f: 'collection', n: true, v: [{ id: 'gid://shopify/Collection/77' }] },
  { f: 'vendor', n: false, v: [] }, // 空的不算
];

test('条件 → Shopify 搜索:每条 AND,一条里 OR,取反逐个 NOT;标题不进搜索', () => {
  assert.equal(calloutQuery(R), "status:active AND (vendor:'DZOFILM' OR vendor:'Thypoch') AND (product_type:'Cine Lens') AND NOT tag:'it\\'s af' AND NOT collection_id:77");
});

test('标题:包含 / 不包含,不分大小写', () => {
  assert.equal(calloutTitleOk(R, 'DZOFILM Vespid 50mm'), true);
  assert.equal(calloutTitleOk(R, 'DZOFILM PAVO 2x 32mm'), false);
  assert.equal(calloutTitleOk([{ f: 'title', n: false, v: ['vespid', 'arles'] }], 'DZOFILM ARLES 25mm'), true);
});

test('有标题条件:逐页拉候选再比标题,去掉排除的和推广产品自己,加上一定显示的', async () => {
  const pages = [[{ id: 'gid://shopify/Product/1', title: 'A Vespid' }, { id: 'gid://shopify/Product/2', title: 'B Pavo' }, { id: 'gid://shopify/Product/3', title: 'C Vespid' }],
    [{ id: 'gid://shopify/Product/4', title: 'D Vespid' }]];
  const gql = async (ctx, q, v) => {
    if (q.includes('after: $after')) { const i = Number(v.after || 0); return { products: { nodes: pages[i], pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) } } }; }
    if (q.includes('nodes(ids')) return { nodes: v.ids.map((id) => ({ id, title: id, handle: 'h', status: 'ACTIVE' })) };
    throw new Error('unexpected ' + q);
  };
  const r = await calloutScope({}, { rules: [{ f: 'title', n: true, v: ['pavo'] }], products: [{ id: 'gid://shopify/Product/9' }], exProducts: [{ id: 3 }], promo: { id: 'gid://shopify/Product/4' } }, gql);
  assert.equal(r.total, 2); // 1 + 9(一定显示);2 带 pavo、3 排除、4 是推广产品
  assert.deepEqual(r.sample.map((p) => p.id), ['gid://shopify/Product/1', 'gid://shopify/Product/9']);
});

test('保存检查 + 写进店里的 rules', () => {
  const base = { kind: 'callout', name: 'x', title: 't', promo: { id: 1 } };
  assert.match(validate({ ...base, rules: [] }), /放在哪些产品/);
  assert.equal(validate({ ...base, rules: [{ f: 'vendor', v: ['DZOFILM'] }] }), '');
  assert.match(validate({ ...base, rules: [{ f: 'price', v: ['1'] }] }), /类型不对/);
  assert.equal(validate({ ...base, rules: [], products: [{ id: 5 }] }), '');
  const f = Object.fromEntries(fieldsFor({ ...base, rules: [{ f: 'collection', n: true, v: [{ id: 'gid://shopify/Collection/77', handle: 'pavo', title: 'Pavo', count: 3 }] }, { f: 'tag', v: [] }] }).map((x) => [x.key, x.value]));
  assert.deepEqual(JSON.parse(f.rules), [{ f: 'collection', n: true, v: [{ id: 77, handle: 'pavo', title: 'Pavo' }] }]);
});

test('联合推广版本 4:视频 / 套装说明的检查,写进店里的新字段', () => {
  const j = { kind: 'callout', name: 'x', title: 't', joint: true, lensCollection: { id: 1 }, promoCollection: { id: 2 }, promos: [{ id: 9 }], promoTitle: 'p', rules: [{ f: 'vendor', v: ['DZOFILM'] }] };
  assert.equal(validate(j), '');
  assert.equal(validate({ ...j, video: 'https://www.youtube.com/watch?v=RR-Y4iSNlvY' }), '');
  assert.equal(validate({ ...j, video: 'youtu.be/RR-Y4iSNlvY' }), '');
  assert.equal(validate({ ...j, video: 'RR-Y4iSNlvY' }), '');
  assert.match(validate({ ...j, video: 'https://vimeo.com/123' }), /YouTube/);
  assert.match(validate({ ...j, kits: 'x' }), /套装说明/);
  const f = Object.fromEntries(fieldsFor({ ...j, badge: 'New', video: ' https://youtu.be/RR-Y4iSNlvY ', popTitle: 'Make it AF', points: 'a\nb', cameras: 'FX3\nFX6', camerasNote: 'n',
    kits: [{ v: 'gid://shopify/ProductVariant/11', note: ' Module only ' }, { v: 12, note: '', rec: true }, { v: 13, note: '' }, { v: 14, note: 'x', rec: true }] }).map((x) => [x.key, x.value]));
  assert.equal(f.badge, 'New'); assert.equal(f.video, 'https://youtu.be/RR-Y4iSNlvY'); assert.equal(f.pop_title, 'Make it AF');
  assert.equal(f.points, 'a\nb'); assert.equal(f.cameras, 'FX3\nFX6'); assert.equal(f.cameras_note, 'n');
  // 只留有说明或推荐的;id 只要数字;推荐只能一个(第一个)
  assert.deepEqual(JSON.parse(f.kits), [{ v: '11', note: 'Module only' }, { v: '12', note: '', rec: true }, { v: '14', note: 'x' }]);
  // 不是联合推广的推广块不写这些
  const g = Object.fromEntries(fieldsFor({ kind: 'callout', name: 'x', title: 't', promo: { id: 1 }, badge: 'New' }).map((x) => [x.key, x.value]));
  assert.equal(g.badge, undefined);
});
