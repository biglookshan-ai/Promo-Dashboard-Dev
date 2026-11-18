// Shopify 后台 Collection 页面上的「产品排序」卡片:每种状态显示什么(src/col-status.js)
// 2026-11-18 第四版:角标 = 网站前台按哪个显示;同步状态 = 后台顺序和排序计划一致吗;排序计划带彩色状态;网站显示按位置分段
import test from 'node:test';
import assert from 'node:assert/strict';
import { colCard, siteSegs } from '../src/col-status.js';
import { desiredPublishStatus, pinFrontPaused } from '../src/schedule-core.js';

const NOW = Date.UTC(2026, 10, 18, 12);
const H = 3600_000;
const END = NOW + 10 * H;
const COL = (o = {}) => ({ id: '111', title: 'Flash Deals', sortOrder: 'MANUAL', off: false, offSet: false, pinManual: null, pinNew: 0, count: 40, ...o });
const PIN = (o = {}) => ({ id: 'pin-a', kind: 'pin', state: 'approved', paused: false, name: 'Flash 第 2 天', collection: { id: 'gid://shopify/Collection/111', title: 'Flash Deals' },
  products: [{ id: 1 }, { id: 2 }, { id: 3 }], hidden: [], onlyListed: false, start: NOW - H, end: END, ...o });
const TAKEN = (o = {}) => ({ 111: { pinId: 'pin-a', pinName: 'Flash 第 2 天', removed: [], added: [], signature: 'sig', ...o } });
const F = (card) => Object.fromEntries(card.rows.map((r) => [r.label, r.value]));
const R = (card, label) => card.rows.find((r) => r.label === label);
const site = (card) => R(card, '网站显示').segs.map((s) => `${s.k}|${s.v}`);
const paths = (card) => card.buttons.map((b) => b.path);

test('网站显示按位置分段', () => {
  const k = (o) => siteSegs(o).map((s) => `${s.k}|${s.v}`);
  assert.deepEqual(k({ plan: 3 }), ['第 1–3 位|排序计划指定的 3 个', '第 4–15 位|后台顺序', '第 16 位起|上架时间新到旧']);
  assert.deepEqual(k({}), ['第 1–12 位|后台顺序', '第 13 位起|上架时间新到旧']);
  assert.deepEqual(k({ plan: 3, off: true }), ['第 1–3 位|排序计划指定的 3 个', '第 4 位起|后台顺序']);
  assert.deepEqual(k({ off: true }), ['全部|后台顺序']);
  assert.deepEqual(k({ manual: false, sortName: '最畅销' }), ['第 1–12 位|后台「最畅销」顺序', '第 13 位起|上架时间新到旧']);
  assert.deepEqual(k({ plan: 3, onlyListed: true }), ['第 1–3 位|排序计划指定的 3 个', '其余|这段时间不显示']);
  assert.deepEqual(k({ n: 0 }), ['全部|上架时间新到旧']);
  assert.deepEqual(k({ plan: 1 }), ['第 1 位|排序计划指定的 1 个', '第 2–13 位|后台顺序', '第 14 位起|上架时间新到旧']);
  // 产品少:截掉用不上的段
  assert.deepEqual(k({ plan: 3, total: 8 }), ['第 1–3 位|排序计划指定的 3 个', '第 4–8 位|后台顺序']);
  assert.deepEqual(k({ total: 5 }), ['第 1–5 位|后台顺序']);
  assert.deepEqual(k({ n: 20 }), ['第 1–20 位|后台顺序', '第 21 位起|上架时间新到旧']);
  assert.equal(siteSegs({ plan: 3 })[0].tone, 'success');
});

test('没有排序计划 · 后台手动:后台排序生效中 + 已设置同步', () => {
  const c = colCard({ pins: [] }, COL(), NOW);
  assert.equal(c.heading, '产品排序');
  assert.deepEqual(c.badge, { text: '后台排序生效中', tone: 'neutral' });
  const f = F(c);
  assert.equal(f['同步状态'], '已设置同步(当前没有排序计划)');
  assert.equal(R(c, '同步状态').tone, 'success');
  assert.equal(f['排序计划'], '无');
  assert.equal(f['后台排序方式'], '手动');
  assert.deepEqual(site(c), ['第 1–12 位|后台顺序', '第 13 位起|上架时间新到旧']);
  assert.equal(f['注意'], '后台拖动只影响前 12 个');
  assert.deepEqual(c.rows.map((r) => r.label), ['同步状态', '排序计划', '后台排序方式', '网站显示', '注意']);
  assert.deepEqual(paths(c), ['/pins/collection/111', '/pins/new/111']);
  assert.deepEqual(site(colCard({ pins: [] }, COL({ count: 0 }), NOW)), ['—|这个 Collection 现在没有产品']);
  // 第一版卡片(只认 lines)也能看
  assert.equal(c.lines[3].text, '网站显示:第 1–12 位 后台顺序;第 13 位起 上架时间新到旧');
  assert.equal(F(colCard({ pins: [] }, COL({ pinManual: 20 }), NOW))['注意'], '后台拖动只影响前 20 个');
  assert.equal(F(colCard({ pins: [] }, COL({ off: true }), NOW))['注意'], undefined);
});

test('没有排序计划 · 后台不是手动:未设置同步 + 一键同步', () => {
  const c = colCard({ pins: [] }, COL({ sortOrder: 'BEST_SELLING' }), NOW);
  assert.equal(c.badge.text, '后台排序生效中');
  assert.equal(F(c)['同步状态'], '未设置同步(保留后台排序)');
  assert.equal(R(c, '同步状态').tone, undefined);
  assert.deepEqual(site(c), ['第 1–12 位|后台「最畅销」顺序', '第 13 位起|上架时间新到旧']);
  assert.equal(F(c)['注意'], undefined);
  assert.deepEqual(c.buttons, [{ label: '一键同步', path: '/pins/collection/111/sync', primary: true }, { label: '排序设置', path: '/pins/collection/111' }]);
});

test('下一份排序计划:已排期(蓝)', () => {
  const c = colCard({ pins: [PIN({ start: NOW + 5 * H, name: 'Black Friday' })] }, COL(), NOW);
  const r = R(c, '排序计划');
  assert.equal(r.value, `无 · 下一份 Black Friday {{t:${NOW + 5 * H}}} 开始(已排期)`);
  assert.deepEqual(r.parts[1], { t: '(已排期)', tone: 'info' });
});

test('app 已把后台排成计划的顺序:APP 排序生效中 + 已同步 + 计划(生效中,绿)', () => {
  const s = { pins: [PIN()], colState: TAKEN({ removed: ['9', '8'] }) };
  const c = colCard(s, COL(), NOW);
  assert.deepEqual(c.badge, { text: 'APP 排序生效中', tone: 'success' });
  const f = F(c);
  assert.equal(f['同步状态'], '已同步');
  assert.equal(R(c, '同步状态').tone, 'success');
  assert.equal(f['排序计划'], `Flash 第 2 天 · 到 {{t:${END}}}(生效中)`);
  assert.deepEqual(R(c, '排序计划').parts, [{ t: `Flash 第 2 天 · 到 {{t:${END}}}` }, { t: '(生效中)', tone: 'success' }]);
  assert.deepEqual(site(c), ['第 1–3 位|排序计划指定的 3 个', '第 4–15 位|后台顺序', '第 16 位起|上架时间新到旧']);
  assert.equal(f['计划产品'], '3 个 · 临时移出 2 个');
  assert.equal(f['注意'], '计划生效期间在后台拖动,app 会暂停同步');
  assert.deepEqual(paths(c), ['/pins/pin-a', '/pins/collection/111']);
  // 长期 / 没起名字
  assert.equal(F(colCard({ ...s, pins: [PIN({ end: null, name: '' })] }, COL(), NOW))['排序计划'], '未命名 · 长期(生效中)');
  // 点了「按本次排序」、还没重新排 / 等 Shopify 算完
  assert.equal(F(colCard({ ...s, colState: TAKEN({ signature: undefined }) }, COL(), NOW))['同步状态'], '同步中(1 分钟内)');
  assert.equal(F(colCard({ ...s, colState: TAKEN({ pending: NOW }) }, COL(), NOW))['同步状态'], '同步中(等 Shopify 算完加减的产品)');
});

test('完全按本次排序开着:计划之后完全照后台', () => {
  const s = { pins: [PIN({ fullOrder: true })], colState: TAKEN(), sortFlags: { 111: { prev: null, pinId: 'pin-a' } } };
  assert.deepEqual(site(colCard(s, COL({ off: true }), NOW)), ['第 1–3 位|排序计划指定的 3 个', '第 4 位起|后台顺序']);
});

test('计划生效中 · 后台不是手动:APP 排序生效中 + 未设置同步 + 一键同步', () => {
  const c = colCard({ pins: [PIN({ hidden: [{ id: 7 }] })] }, COL({ sortOrder: 'CREATED_DESC' }), NOW);
  assert.equal(c.badge.text, 'APP 排序生效中');
  const f = F(c);
  assert.equal(f['同步状态'], '未设置同步(保留后台排序)');
  assert.equal(f['后台排序方式'], '最新上架');
  assert.deepEqual(site(c), ['第 1–3 位|排序计划指定的 3 个', '第 4–15 位|后台「最新上架」顺序', '第 16 位起|上架时间新到旧']);
  assert.equal(f['计划产品'], '3 个 · 不显示 1 个');
  assert.equal(f['注意'], undefined);
  assert.deepEqual(paths(c), ['/pins/collection/111/sync', '/pins/pin-a']);
  // 超过 50 个:网站只认前 50
  const many = PIN({ products: Array.from({ length: 60 }, (_, i) => ({ id: i + 1 })) });
  const c2 = colCard({ pins: [many] }, COL({ sortOrder: 'BEST_SELLING', count: 200 }), NOW);
  assert.equal(site(c2)[0], '第 1–50 位|排序计划指定的 50 个');
  assert.equal(F(c2)['注意'], '网站只认计划的前 50 个');
});

test('计划生效中 · 手动但要移出超过 100 个 / 刚保存', () => {
  const c = colCard({ pins: [PIN({ onlyListed: true })] }, COL({ count: 300 }), NOW);
  assert.equal(F(c)['同步状态'], '未同步(要临时移出超过 100 个产品,只在网站上排)');
  assert.deepEqual(site(c), ['第 1–3 位|排序计划指定的 3 个', '其余|这段时间不显示']);
  const just = colCard({ pins: [PIN()] }, COL(), NOW);
  assert.equal(just.badge.text, 'APP 排序生效中');
  assert.equal(F(just)['同步状态'], '同步中(1 分钟内)');
  assert.equal(R(just, '同步状态').tone, 'info');
});

test('本来同步了,被后台接管:后台排序生效中 + 同步中断(黄)+ 计划(网站上暂停,黄)', () => {
  const s = { pins: [PIN()], colState: TAKEN({ hold: 'manual' }) };
  const c = colCard(s, COL(), NOW);
  assert.deepEqual(c.badge, { text: '后台排序生效中', tone: 'neutral' });
  const f = F(c);
  assert.equal(f['同步状态'], '同步中断(被后台接管,待处理)');
  assert.equal(R(c, '同步状态').tone, 'warning');
  assert.equal(f['排序计划'], `Flash 第 2 天 · 到 {{t:${END}}}(网站上暂停)`);
  assert.deepEqual(R(c, '排序计划').parts[1], { t: '(网站上暂停)', tone: 'warning' });
  assert.deepEqual(site(c), ['第 1–12 位|后台顺序', '第 13 位起|上架时间新到旧']);
  assert.equal(f['注意'], '需在 app 里选「按本次排序」或「保留后台排序」');
  assert.deepEqual(paths(c), ['/pins', '/pins/pin-a']);
  assert.equal(F(colCard({ ...s, colState: TAKEN({ hold: 'rollback' }) }, COL(), NOW))['同步状态'], '同步中断(回滚过,待处理)');
  // 计划结束了还没处理:计划(已结束,灰)
  const ended = colCard({ pins: [PIN({ end: NOW - H })], colState: s.colState }, COL(), NOW);
  assert.equal(ended.badge.text, '后台排序生效中');
  assert.equal(F(ended)['同步状态'], '同步中断(被后台接管,待处理)');
  assert.deepEqual(R(ended, '排序计划').parts, [{ t: 'Flash 第 2 天' }, { t: '(已结束)', color: 'subdued' }]);
});

test('选过「保留后台排序」:后台排序生效中 + 同步已关闭', () => {
  const c = colCard({ pins: [PIN()], colState: TAKEN({ released: NOW - H }) }, COL(), NOW);
  assert.deepEqual(c.badge, { text: '后台排序生效中', tone: 'neutral' });
  const f = F(c);
  assert.equal(f['同步状态'], '同步已关闭(保留后台排序)');
  assert.equal(f['排序计划'], `Flash 第 2 天 · 到 {{t:${END}}}(网站上暂停)`);
  assert.deepEqual(site(c), ['第 1–12 位|后台顺序', '第 13 位起|上架时间新到旧']);
  assert.equal(f['计划产品'], undefined);
});

test('网站上暂停 = 店里这份排序计划设成草稿(保留后台排序 / 被后台接管);恢复 / 别的计划不受影响', () => {
  const camps = new Map();
  const p = PIN();
  assert.equal(desiredPublishStatus(p, camps, NOW), 'ACTIVE');
  const released = { 111: { pinId: 'pin-a', released: NOW } };
  assert.equal(pinFrontPaused(p, released), true);
  assert.equal(desiredPublishStatus(p, camps, NOW, { colState: released }), 'DRAFT');
  assert.equal(desiredPublishStatus(p, camps, NOW, { colState: { 111: { pinId: 'pin-a', hold: 'manual' } } }), 'DRAFT');
  assert.equal(desiredPublishStatus(p, camps, NOW, { colState: { 111: { pinId: 'pin-a', hold: 'rollback' } } }), 'DRAFT');
  assert.equal(desiredPublishStatus(p, camps, NOW, { colState: { 111: { pinId: 'pin-a' } } }), 'ACTIVE');
  assert.equal(desiredPublishStatus(PIN({ id: 'pin-b' }), camps, NOW, { colState: released }), 'ACTIVE');
  assert.equal(desiredPublishStatus(PIN({ end: NOW - H }), camps, NOW, { colState: released }), 'DRAFT');
  assert.equal(desiredPublishStatus({ kind: 'banner', id: 'pin-a', state: 'approved', start: NOW - H }, camps, NOW, { colState: released }), 'ACTIVE');
});

test('刚结束、正在还原:还原中 + 计划(已结束)', () => {
  const c = colCard({ pins: [PIN({ end: NOW - H })], colState: { 111: { pinId: null, pinName: 'Flash 第 2 天', restoring: NOW - 30_000 } } }, COL(), NOW);
  assert.equal(c.badge.text, '后台排序生效中');
  assert.equal(F(c)['同步状态'], '还原中');
  assert.equal(F(c)['排序计划'], 'Flash 第 2 天(已结束)');
});

test('几份同时生效:开始晚的那份算数;暂停 / 草稿 / 别的 Collection 的不算', () => {
  const s = { pins: [
    PIN({ id: 'old', name: '旧', start: NOW - 5 * H }),
    PIN({ id: 'new', name: '新', start: NOW - H }),
    PIN({ id: 'p', name: '暂停的', start: NOW - 10 * 60_000, paused: true }),
    PIN({ id: 'd', name: '草稿', start: NOW - 10 * 60_000, state: 'draft' }),
    PIN({ id: 'o', name: '别的', start: NOW - 10 * 60_000, collection: { id: '222' } }),
  ] };
  assert.match(F(colCard(s, COL({ sortOrder: 'PRICE_ASC' }), NOW))['排序计划'], /^新 · /);
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
    assert.equal(card.heading, '产品排序');
    assert.deepEqual(card.rows.find((r) => r.label === '网站显示').segs.map((x) => x.k), ['第 1–5 位']); // 只有 5 个产品
    assert.deepEqual(seen[0], ['demo.myshopify.com', 'gid://shopify/Collection/111']);
    assert.equal((await fetch(`${base}?id=999`, { headers: { Authorization: `Bearer ${good}` } })).status, 404);
    assert.equal((await fetch(`${base}?id=abc`, { headers: { Authorization: `Bearer ${good}` } })).status, 400);
  } finally { srv.close(); }
});
