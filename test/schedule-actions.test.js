import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, ActionError, orderPipeline } from '../src/schedule-actions.js';

const T = Date.UTC(2026, 9, 1, 12), D = 86400000;
const approver = { id: 'u1', name: '审核人', role: 'approver' };
const editor = { id: 'u2', name: '编辑', role: 'editor' };
const doc = (o = {}) => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], pendingOrder: null, log: [], staff: [], ...o });
const banner = (o = {}) => ({ id: 'b1', kind: 'banner', state: 'approved', image: 'x.jpg', title: 'A', order: 0, start: null, end: null, campaign: null, ...o });

test('编辑新建 → 提交审核 → 待审核,并要通知审核人', () => {
  const r = applyAction(doc(), { type: 'save', mode: 'submit', kind: 'banner', isNew: true, values: { id: 'b-new', image: 'a.jpg', title: 'New' } }, editor, T);
  assert.equal(r.doc.banners[0].state, 'pending');
  assert.ok(r.effects.some((e) => e.type === 'notify' && e.event === 'submit'));
  assert.ok(!r.effects.some((e) => e.type === 'sync'), '没批准的不写 Shopify');
});

test('编辑不能直接发布,也不能批准', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'banner', isNew: true, values: { id: 'x', image: 'a' } }, editor, T), ActionError);
  const d = doc({ banners: [banner({ state: 'pending' })] });
  assert.throws(() => applyAction(d, { type: 'approve', id: 'b1' }, editor, T), /只有审核人/);
});

test('编辑改已上线的内容 → 只生成「修改待审核」,线上版本不变', () => {
  const d = doc({ banners: [banner()] });
  const r = applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', id: 'b1', values: { title: 'B', image: 'x.jpg' } }, editor, T);
  assert.equal(r.doc.banners[0].title, 'A');
  assert.deepEqual(Object.keys(r.doc.banners[0].pendingChange).sort(), ['at', 'by', 'title']);
  assert.ok(!r.effects.some((e) => e.type === 'sync'));
  const r2 = applyAction(r.doc, { type: 'approve', id: 'b1' }, approver, T);
  assert.equal(r2.doc.banners[0].title, 'B');
  assert.equal(r2.doc.banners[0].pendingChange, null);
  assert.ok(r2.effects.some((e) => e.type === 'sync' && e.id === 'b1'));
});

test('没改动不能提交;首尾空格不算改动', () => {
  const d = doc({ banners: [banner()] });
  assert.throws(() => applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', id: 'b1', values: { title: ' A ' } }, editor, T), /没有改动/);
});

test('审核人直接发布 = 自动批准 + 写 Shopify', () => {
  const r = applyAction(doc(), { type: 'save', mode: 'publish', kind: 'topbar', isNew: true, values: { id: 't-x', text: 'Hi' } }, approver, T);
  assert.equal(r.doc.topbar[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync' && e.id === 't-x'));
});

test('校验:结束要晚于开始、活动要开始时间', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'banner', isNew: true, values: { id: 'b2', image: 'a', start: T, end: T } }, approver, T), /结束时间/);
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'campaign', isNew: true, values: { id: 'c2', name: 'X' } }, approver, T), /开始时间/);
});

test('批准活动时,跟随它的内容一起写 Shopify', () => {
  const d = doc({ campaigns: [{ id: 'c1', kind: 'campaign', state: 'pending', name: 'Sale', start: T, end: T + D }], banners: [banner({ campaign: 'c1' })] });
  const r = applyAction(d, { type: 'approve', id: 'c1' }, approver, T);
  const synced = r.effects.filter((e) => e.type === 'sync').map((e) => e.id);
  assert.deepEqual(synced.sort(), ['b1', 'c1']);
});

test('退回要带原因,通知提交人', () => {
  const d = doc({ banners: [banner({ state: 'pending', by: 'u2' })] });
  const r = applyAction(d, { type: 'reject', id: 'b1', note: '图片换一张' }, approver, T);
  assert.equal(r.doc.banners[0].state, 'rejected');
  assert.equal(r.doc.banners[0].rejectNote, '图片换一张');
  assert.ok(r.effects.some((e) => e.event === 'decision' && e.to === 'u2' && !e.approved));
});

test('删除:只能删草稿 / 退回 / 已结束;删了的 Shopify 条目也要删', () => {
  assert.throws(() => applyAction(doc({ banners: [banner()] }), { type: 'delete', id: 'b1' }, approver, T), /只能删除/);
  const r = applyAction(doc({ banners: [banner({ end: T - 1, shopifyId: 'gid://9' })] }), { type: 'delete', id: 'b1' }, approver, T);
  assert.equal(r.doc.banners.length, 0);
  assert.deepEqual(r.effects, [{ type: 'remove', shopifyId: 'gid://9' }]);
});

test('排序:审核人直接生效;编辑提交待审核,批准后生效', () => {
  const d = doc({ banners: [banner({ id: 'a', order: 0 }), banner({ id: 'b', order: 1 }), banner({ id: 'z', order: 2, end: T - 1 })] });
  assert.deepEqual(orderPipeline(d, 'banner', T).map((x) => x.id), ['a', 'b'], '已结束的不参与排序');
  const r = applyAction(d, { type: 'order', kind: 'banner', ids: ['b', 'a'] }, approver, T);
  assert.deepEqual(r.doc.banners.sort((x, y) => x.order - y.order).map((x) => x.id), ['b', 'a', 'z']);
  const r2 = applyAction(d, { type: 'order', kind: 'banner', ids: ['b', 'a'] }, editor, T);
  assert.equal(r2.doc.banners.find((x) => x.id === 'a').order, 0, '编辑提交的顺序批准前不生效');
  assert.ok(r2.doc.pendingOrder);
  const r3 = applyAction(r2.doc, { type: 'approve', id: '__order' }, approver, T);
  assert.equal(r3.doc.banners.find((x) => x.id === 'b').order, 0);
  assert.ok(r3.effects.some((e) => e.type === 'syncOrder'));
});

test('排序:列表和现在对不上(有人刚改过)就拒绝', () => {
  const d = doc({ banners: [banner({ id: 'a', order: 0 }), banner({ id: 'b', order: 1 })] });
  assert.throws(() => applyAction(d, { type: 'order', kind: 'banner', ids: ['a'] }, approver, T), /对不上/);
});

test('暂停只能审核人做;默认样式不能暂停 / 删除', () => {
  const d = doc({ tbstyles: [{ id: 's0', kind: 'tbstyle', isDefault: true, state: 'approved', name: '默认' }] });
  assert.throws(() => applyAction(d, { type: 'pause', id: 's0' }, approver, T), /默认样式/);
  assert.throws(() => applyAction(d, { type: 'delete', id: 's0' }, approver, T), /默认样式/);
  assert.throws(() => applyAction(doc({ banners: [banner()] }), { type: 'pause', id: 'b1' }, editor, T), /只有审核人/);
});

test('不改动传入的数据(纯函数)', () => {
  const d = doc({ banners: [banner()] });
  const snap = JSON.stringify(d);
  applyAction(d, { type: 'pause', id: 'b1' }, approver, T);
  assert.equal(JSON.stringify(d), snap);
});

// ---- 首页商品模块 ----
const tab = (o = {}) => ({ id: 'tab1', title: 'Top Picks', source: 'collection', collection: { id: 1, title: 'Flash' }, products: [], limit: 20, ...o });
const pmod = (o = {}) => ({ id: 'pm1', kind: 'pmodule', module: 'sale', name: 'Autumn', title: '', title2: 'Autumn Sale', tabs: [tab()], state: 'approved', start: null, end: null, campaign: null, order: 0, ...o });

test('商品模块:至少一个页签,每个页签要选了合集或产品', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'pmodule', isNew: true, values: { id: 'pmx', module: 'sale', name: 'X', tabs: [] } }, approver, T), /至少要有一个页签/);
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'pmodule', isNew: true, values: { id: 'pmx', module: 'sale', name: 'X', tabs: [tab({ collection: null })] } }, approver, T), /第 1 个页签还没选合集/);
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'publish', kind: 'pmodule', isNew: true, values: { id: 'pmx', module: 'sale', name: 'X', tabs: [tab({ source: 'products', products: [] })] } }, approver, T), /还没选产品/);
  const r = applyAction(doc(), { type: 'save', mode: 'publish', kind: 'pmodule', isNew: true, values: { id: 'pmx', module: 'sale', name: 'X', tabs: [tab()] } }, approver, T);
  assert.equal(r.doc.pmodules[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync' && e.id === 'pmx'));
});

test('商品模块:每个模块只能有一个平时版本', () => {
  const d = doc({ pmodules: [pmod({ id: 'def', isDefault: true })] });
  assert.throws(() => applyAction(d, { type: 'save', mode: 'publish', kind: 'pmodule', isNew: true, values: { id: 'x', module: 'sale', name: 'X', isDefault: true, tabs: [tab()] } }, approver, T), /已经有平时版本/);
  // 另一个模块可以有自己的平时版本
  const r = applyAction(d, { type: 'save', mode: 'publish', kind: 'pmodule', isNew: true, values: { id: 'y', module: 'feature', name: 'Y', isDefault: true, tabs: [tab()] } }, approver, T);
  assert.equal(r.doc.pmodules.length, 2);
});

test('商品模块:编辑改页签 → 修改待审核,能看出页签变了;批准后写店铺', () => {
  const d = doc({ pmodules: [pmod()] });
  const r = applyAction(d, { type: 'save', mode: 'submit', kind: 'pmodule', id: 'pm1', values: { tabs: [tab(), tab({ id: 'tab2', title: 'Clearance', collection: { id: 2, title: 'Clearance' } })] } }, editor, T);
  assert.deepEqual(Object.keys(r.doc.pmodules[0].pendingChange).sort(), ['at', 'by', 'tabs']);
  assert.equal(r.doc.pmodules[0].tabs.length, 1, '批准前店里还是一个页签');
  const r2 = applyAction(r.doc, { type: 'approve', id: 'pm1' }, approver, T);
  assert.equal(r2.doc.pmodules[0].tabs.length, 2);
});

test('商品模块:删除时把页签条目也删掉;活动批准时挂在下面的模块版本一起写', () => {
  const ended = pmod({ end: T - 1, shopifyId: 'gid://m', tabs: [tab({ shopifyId: 'gid://t1' }), tab({ id: 't2', shopifyId: 'gid://t2' })] });
  const r = applyAction(doc({ pmodules: [ended] }), { type: 'delete', id: 'pm1' }, approver, T);
  assert.deepEqual(r.effects.map((e) => e.shopifyId).sort(), ['gid://m', 'gid://t1', 'gid://t2']);
  const d = doc({ campaigns: [{ id: 'c1', kind: 'campaign', state: 'pending', name: 'Sale', start: T, end: T + D }], pmodules: [pmod({ campaign: 'c1' })] });
  const r2 = applyAction(d, { type: 'approve', id: 'c1' }, approver, T);
  assert.ok(r2.effects.some((e) => e.type === 'sync' && e.id === 'pm1'));
});

// ---- v3 活动总控台的工作项 ----
test('合集置顶清单:要选合集和产品;批准后要写 Shopify;跟随活动时间', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'submit', kind: 'pin', isNew: true, values: { id: 'p1', name: 'x' } }, editor, T), /合集/);
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'submit', kind: 'pin', isNew: true, values: { id: 'p1', collection: { id: 'c1', title: 'Flash' } } }, editor, T), /产品/);
  const r = applyAction(doc({ campaigns: [{ id: 'c9', kind: 'campaign', state: 'approved', name: 'EBF', start: T, end: T + D }] }),
    { type: 'save', mode: 'publish', kind: 'pin', isNew: true, values: { id: 'p1', name: 'Flash 第 1 天', collection: { id: 'c1', title: 'Flash' }, products: [{ id: '1' }, { id: '2' }], onlyListed: true, campaign: 'c9' } }, approver, T);
  assert.equal(r.doc.pins[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync' && e.id === 'p1'));
  const r2 = applyAction(r.doc, { type: 'save', mode: 'publish', kind: 'campaign', id: 'c9', values: { name: 'EBF', start: T, end: T + 2 * D } }, approver, T);
  assert.ok(r2.effects.some((e) => e.type === 'sync' && e.id === 'p1'), '活动改时间,跟随的清单一起更新');
});

test('设计需求:提交 = 交稿待审批;批准后不写 Shopify;待审批时不能删', () => {
  let d = doc({ designs: [] });
  d = applyAction(d, { type: 'save', mode: 'draft', kind: 'design', isNew: true, values: { id: 'd1', name: 'EBF 主 Banner', brief: '黑底金字', target: 'b1', due: T + D } }, editor, T).doc;
  assert.equal(d.designs[0].state, 'draft');
  d = applyAction(d, { type: 'save', mode: 'submit', kind: 'design', id: 'd1', values: { deliverables: [{ url: 'https://cdn/x.jpg', name: 'v1' }] } }, editor, T).doc;
  assert.equal(d.designs[0].state, 'pending');
  assert.throws(() => applyAction(d, { type: 'delete', id: 'd1' }, editor, T), /等审批/);
  const r = applyAction(d, { type: 'approve', id: 'd1' }, approver, T);
  assert.equal(r.doc.designs[0].state, 'approved');
  assert.ok(r.effects.some((e) => e.type === 'sync'), '会发 sync,但 runEffects 会跳过不写 Shopify 的类型');
  assert.equal(applyAction(r.doc, { type: 'delete', id: 'd1' }, approver, T).doc.designs.length, 0);
});

test('设计需求:没交稿不能提交;审核人也不能直接「发布」成完成', () => {
  const d = applyAction(doc(), { type: 'save', mode: 'draft', kind: 'design', isNew: true, values: { id: 'd1', name: '主 Banner' } }, approver, T).doc;
  assert.throws(() => applyAction(d, { type: 'save', mode: 'submit', kind: 'design', id: 'd1', values: {} }, editor, T), /设计稿/);
  assert.throws(() => applyAction(d, { type: 'save', mode: 'publish', kind: 'design', id: 'd1', values: { deliverables: [{ url: 'x' }] } }, approver, T), /交稿/);
});

test('宣传物料:要选渠道;批准后负责人标记已发布(带链接),可撤销', () => {
  assert.throws(() => applyAction(doc(), { type: 'save', mode: 'submit', kind: 'material', isNew: true, values: { id: 'm1', name: 'EBF 邮件' } }, editor, T), /邮件还是社媒/);
  let d = applyAction(doc(), { type: 'save', mode: 'submit', kind: 'material', isNew: true, values: { id: 'm1', name: 'EBF 邮件', channel: 'email', subject: 'Early BF is here', publishAt: T + D, owner: 'u2' } }, editor, T).doc;
  assert.throws(() => applyAction(d, { type: 'markPublished', id: 'm1', url: 'x' }, editor, T), /批准后/);
  d = applyAction(d, { type: 'approve', id: 'm1' }, approver, T).doc;
  d = applyAction(d, { type: 'markPublished', id: 'm1', url: 'https://klaviyo/c/1' }, editor, T + D).doc;
  assert.equal(d.materials[0].publishedUrl, 'https://klaviyo/c/1');
  assert.equal(d.materials[0].publishedAt, T + D);
  const other = { id: 'u3', name: '别人', role: 'editor' };
  assert.throws(() => applyAction(d, { type: 'markPublished', id: 'm1', undo: true }, other, T), /负责人/);
  d = applyAction(d, { type: 'markPublished', id: 'm1', undo: true }, approver, T).doc;
  assert.equal(d.materials[0].publishedAt, null);
});
