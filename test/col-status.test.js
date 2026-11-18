// Shopify 后台 Collection 页面上的「CGP 排序」卡片:每种状态显示什么(src/col-status.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { colCard } from '../src/col-status.js';

const NOW = Date.UTC(2026, 10, 18, 12);
const H = 3600_000;
const COL = (o = {}) => ({ id: '111', title: 'Flash Deals', sortOrder: 'MANUAL', off: false, offSet: false, pinManual: null, pinNew: 0, count: 40, ...o });
const PIN = (o = {}) => ({ id: 'pin-a', kind: 'pin', state: 'approved', paused: false, name: 'Flash 第 2 天', collection: { id: 'gid://shopify/Collection/111', title: 'Flash Deals' },
  products: [{ id: 1 }, { id: 2 }, { id: 3 }], hidden: [], onlyListed: false, start: NOW - H, end: NOW + 10 * H, ...o });
const text = (card) => card.lines.map((l) => l.text).join('\n');
const paths = (card) => card.buttons.map((b) => b.path);

test('没有置顶排序:未接管,写清网站只照前 12 个', () => {
  const c = colCard({ pins: [] }, COL(), NOW);
  assert.equal(c.badge.text, '未接管');
  assert.match(text(c), /网站上:前 12 个按手动顺序,其余按新到旧/);
  assert.match(text(c), /在这里拖动顺序,网站只照前 12 个,第 13 个起按新到旧/);
  assert.deepEqual(paths(c), ['/pins/collection/111', '/pins/new/111']);
  // 改成前 20 个:提示跟着变
  assert.match(text(colCard({ pins: [] }, COL({ pinManual: 20 }), NOW)), /只照前 20 个,第 21 个起/);
  // 完全按手动:不用提醒
  assert.doesNotMatch(text(colCard({ pins: [] }, COL({ off: true }), NOW)), /只照前/);
});

test('没有置顶排序 + 后台不是手动:说清置顶只能在网站上排', () => {
  const c = colCard({ pins: [] }, COL({ sortOrder: 'BEST_SELLING' }), NOW);
  assert.equal(c.badge.text, '未接管');
  assert.match(text(c), /前 12 个按「最畅销」,其余按新到旧/);
  assert.match(text(c), /排序方式是「最畅销」:置顶排序只能在网站上排/);
});

test('下一份置顶排序什么时候开始(时间留给卡片按本地时区显示)', () => {
  const c = colCard({ pins: [PIN({ start: NOW + 5 * H, name: 'Black Friday' })] }, COL(), NOW);
  assert.equal(c.badge.text, '未接管');
  assert.match(text(c), new RegExp(`下一份置顶排序「Black Friday」\\{\\{t:${NOW + 5 * H}\\}\\} 开始`));
});

test('app 正在改后台顺序:接管中 + 结束时间 + 移出几个 + 拖动会暂停', () => {
  const s = { pins: [PIN()], colState: { 111: { pinId: 'pin-a', pinName: 'Flash 第 2 天', removed: ['9', '8'], added: [], released: false } } };
  const c = colCard(s, COL(), NOW);
  assert.equal(c.badge.text, 'app 接管中');
  assert.equal(c.badge.tone, 'success');
  assert.match(text(c), new RegExp(`「Flash 第 2 天」正在排这个 Collection,\\{\\{t:${NOW + 10 * H}\\}\\} 结束后自动还原`));
  assert.match(text(c), /最前面 3 个由置顶排序指定 · 临时移出 2 个\(这段时间不显示\)/);
  assert.doesNotMatch(text(c), /个这段时间不显示 ·/); // 移出的和不显示的是同一批,只说一次
  assert.match(text(c), /置顶的之后:再照这里的顺序显示 12 个,其余按新到旧/);
  assert.match(text(c), /拖动顺序,app 会暂停接管/);
  assert.deepEqual(paths(c), ['/pins/pin-a', '/pins/collection/111']);
});

test('完全按本次排序开着:置顶之后完全照这里的顺序(店里字段是临时改的)', () => {
  const s = { pins: [PIN({ fullOrder: true })], colState: { 111: { pinId: 'pin-a', pinName: 'x' } }, sortFlags: { 111: { prev: null, pinId: 'pin-a' } } };
  const c = colCard(s, COL({ off: true }), NOW);
  assert.match(text(c), /置顶的之后:完全照这里的顺序/);
});

test('有人在后台改过顺序:接管已暂停,去 app 处理', () => {
  const s = { pins: [PIN()], colState: { 111: { pinId: 'pin-a', pinName: 'Flash 第 2 天', hold: 'manual' } } };
  const c = colCard(s, COL(), NOW);
  assert.equal(c.badge.text, '接管已暂停');
  assert.equal(c.badge.tone, 'warning');
  assert.match(text(c), /app 已经停手,没有覆盖你的改动/);
  assert.deepEqual(paths(c), ['/pins', '/pins/pin-a']);
  // 回滚造成的暂停
  const r = colCard({ ...s, colState: { 111: { ...s.colState[111], hold: 'rollback' } } }, COL(), NOW);
  assert.match(text(r), /回滚过这个 Collection 的顺序/);
});

test('选过「保留后台排序」:顺序交给后台', () => {
  const s = { pins: [PIN()], colState: { 111: { pinId: 'pin-a', pinName: 'Flash 第 2 天', released: true } } };
  const c = colCard(s, COL(), NOW);
  assert.equal(c.badge.text, '顺序交给后台');
  assert.match(text(c), /app 不再排这里的顺序,结束时也不还原/);
});

test('生效中但后台不是手动:只在网站上排,说明原因', () => {
  const c = colCard({ pins: [PIN()] }, COL({ sortOrder: 'BEST_SELLING' }), NOW);
  assert.equal(c.badge.text, '只在网站上排');
  assert.match(text(c), /这里的顺序不变/);
  assert.match(text(c), /排序方式是「最畅销」,Shopify 不让 app 改这里的顺序/);
  // 超过 50 个:网站只认前 50
  const many = PIN({ products: Array.from({ length: 60 }, (_, i) => ({ id: i + 1 })) });
  assert.match(text(colCard({ pins: [many] }, COL({ sortOrder: 'BEST_SELLING' }), NOW)), /网站上只认前 50 个/);
});

test('生效中、手动排序、但要移出超过 100 个:只在网站上排', () => {
  const c = colCard({ pins: [PIN({ onlyListed: true })] }, COL({ count: 300 }), NOW);
  assert.equal(c.badge.text, '只在网站上排');
  assert.match(text(c), /只显示置顶排序指定的 3 个/);
  assert.match(text(c), /超过 100 个/);
  assert.doesNotMatch(text(c), /置顶的之后/); // 只显示这几个,没有「之后」
});

test('刚结束、正在还原', () => {
  const s = { pins: [PIN({ end: NOW - H })], colState: { 111: { pinId: null, pinName: 'Flash 第 2 天', restoring: NOW - 30_000 } } };
  const c = colCard(s, COL(), NOW);
  assert.equal(c.badge.text, '正在还原');
});

test('几份同时生效:开始晚的那份算数;暂停 / 草稿 / 别的 Collection 的不算', () => {
  const s = { pins: [
    PIN({ id: 'old', name: '旧', start: NOW - 5 * H }),
    PIN({ id: 'new', name: '新', start: NOW - H }),
    PIN({ id: 'p', name: '暂停的', start: NOW - 10 * 60_000, paused: true }),
    PIN({ id: 'd', name: '草稿', start: NOW - 10 * 60_000, state: 'draft' }),
    PIN({ id: 'o', name: '别的', start: NOW - 10 * 60_000, collection: { id: '222' } }),
  ] };
  const c = colCard(s, COL({ sortOrder: 'PRICE_ASC' }), NOW);
  assert.match(text(c), /「新」生效中/);
  // 没起名字的直接叫「置顶排序」(不说「Flash Deals 正在排 Flash Deals」)
  assert.match(text(colCard({ pins: [PIN({ name: '' })] }, COL({ sortOrder: 'PRICE_ASC' }), NOW)), /^置顶排序生效中/m);
});

// 接口:只认 Shopify 身份凭证、放行跨域、回卡片内容
test('卡片接口 /api/ext/collection-status', async () => {
  process.env.SHOPIFY_API_KEY ||= 'test-key';
  process.env.SHOPIFY_API_SECRET ||= 'test-secret';
  process.env.SHOPIFY_ADMIN_TOKEN ||= 'test-admin-token'; // 不去换店铺令牌
  const crypto = await import('node:crypto');
  const express = (await import('express')).default;
  const { extRouter } = await import('../src/ext-api.js');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = (payload, secret = process.env.SHOPIFY_API_SECRET) => {
    const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload);
    return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = sign({ aud: process.env.SHOPIFY_API_KEY, dest: 'https://demo.myshopify.com', sub: '42', exp: now + 60, nbf: now - 1 });
  const seen = [];
  const gql = async (ctx, q, v) => { seen.push([ctx.shop, v.id]); return { collection: v.id.endsWith('/111') ? { id: v.id, title: 'Flash Deals', handle: 'flash', sortOrder: 'MANUAL', productsCount: { count: 5 } } : null }; };
  const app = express(); app.use('/api/ext', extRouter({ gql, loadState: () => ({ pins: [] }) }));
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api/ext/collection-status`;
  try {
    const pre = await fetch(base, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
    assert.equal((await fetch(`${base}?id=111`)).status, 401);
    assert.equal((await fetch(`${base}?id=111`, { headers: { Authorization: `Bearer ${sign({ aud: process.env.SHOPIFY_API_KEY, dest: 'https://demo.myshopify.com', exp: now + 60 }, 'wrong')}` } })).status, 401);
    const ok = await fetch(`${base}?id=gid://shopify/Collection/111`, { headers: { Authorization: `Bearer ${good}` } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');
    const card = await ok.json();
    assert.equal(card.badge.text, '未接管');
    assert.deepEqual(seen[0], ['demo.myshopify.com', 'gid://shopify/Collection/111']);
    assert.equal((await fetch(`${base}?id=999`, { headers: { Authorization: `Bearer ${good}` } })).status, 404);
    assert.equal((await fetch(`${base}?id=abc`, { headers: { Authorization: `Bearer ${good}` } })).status, 400);
  } finally { srv.close(); }
});
