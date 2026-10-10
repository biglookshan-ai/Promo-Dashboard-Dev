// 执行器端到端:真的存盘(临时目录)+ 假的 Shopify(内存),模拟写失败、网络异常、改到一半中断、手动改价、合集交接
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'price-exec-'));
const { runOnce } = await import('../src/price/executor.js');
const { load, save, emptyState } = await import('../src/price/store.js');

const H = 3600_000;
let n = 0;
const newShop = () => `t${++n}.myshopify.com`;

function fakeIO(variants, collections = {}) {
  const v = new Map(Object.entries(variants).map(([id, x]) => [id, { productId: `P-${id}`, compareAt: null, title: id, sku: id.toUpperCase(), ...(typeof x === 'string' ? { price: x } : x) }]));
  const coll = new Map(Object.entries(collections).map(([k, arr]) => [k, new Set(arr)]));
  const io = {
    v, coll, writes: 0,
    reject: new Set(),      // 这些产品 Shopify 明确拒绝
    netErrorAfter: false,   // 改成功了但返回时网络断了
    readbackFails: false,   // 改完读回时出错(模拟改到一半进程中断)
    async readVariants(ctx, ids) {
      if (io.readbackFails && io.writes) { io.readbackFails = false; throw new Error('模拟:读回时连接中断'); }
      const m = new Map();
      for (const id of ids) if (v.has(id)) m.set(id, { ...v.get(id) });
      return m;
    },
    async writeProductVariants(ctx, pid, list) {
      io.writes++;
      const errs = new Map();
      for (const x of list) {
        if (io.reject.has(pid)) { errs.set(x.id, '价格不合法(模拟)'); continue; }
        v.set(x.id, { ...v.get(x.id), price: x.price, compareAt: x.compareAt });
      }
      if (io.netErrorAfter) throw new Error('模拟:网络超时');
      return errs;
    },
    async productsInCollection(ctx, cid, pids) { const s = coll.get(cid) || new Set(); return new Set(pids.filter((p) => s.has(p))); },
    async addToCollection(ctx, cid, pids) { if (!coll.has(cid)) coll.set(cid, new Set()); pids.forEach((p) => coll.get(cid).add(p)); },
    async removeFromCollection(ctx, cid, pids) { pids.forEach((p) => coll.get(cid)?.delete(p)); },
  };
  return io;
}
const item = (variantId, price) => ({ variantId, productId: `P-${variantId}`, title: variantId, price, refPrice: '100.00', refCompareAt: null });
const plan = (id, layer, slots) => ({ id, name: id, kind: 'window', layer, state: 'approved', approvedAt: 1, paused: false, stopped: false, excluded: [], applied: {}, slots });
function setup(plans) { const shop = newShop(); save(shop, { ...emptyState(), plans }); return shop; }
const run = (shop, io, now) => runOnce(shop, { now, token: 'x', io });
const price = (io, id) => ({ price: io.v.get(id).price, compareAt: io.v.get(id).compareAt });

test('开始 → 写入、读回、记账;结束 → 恢复,保险库清空', async () => {
  const io = fakeIO({ v1: '100.00', v2: { price: '200.00', compareAt: '250.00' } });
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00'), { ...item('v2', '170.00'), refPrice: '200.00' }] }])]);
  const r = await run(shop, io, 1 * H);
  assert.equal(r.written.length, 2);
  assert.deepEqual(price(io, 'v1'), { price: '85.00', compareAt: '100.00' });
  let st = load(shop);
  assert.equal(st.ledger.length, 2);
  assert.equal(st.ledger[0].plan, 'site');
  assert.deepEqual(st.vault.v2.base, { price: '200.00', compareAt: '250.00' });
  assert.ok(st.log.some((l) => /开始活动价:2 个变体/.test(l.note)));
  await run(shop, io, 10 * H);
  assert.deepEqual(price(io, 'v1'), { price: '100.00', compareAt: null });
  assert.deepEqual(price(io, 'v2'), { price: '200.00', compareAt: '250.00' });
  st = load(shop);
  assert.deepEqual(st.vault, {});
  assert.equal(st.ledger.length, 4);
  assert.equal(st.ledger[0].op, 'restore');
  assert.equal(st.ledger[0].plan, 'site'); // 恢复原价的账也记得是哪个计划
});

test('Shopify 明确拒绝:记失败,不接管,下一轮自动重试', async () => {
  const io = fakeIO({ v1: '100.00' });
  io.reject.add('P-v1');
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00')] }])]);
  const r = await run(shop, io, 1 * H);
  assert.equal(r.failures.length, 1);
  assert.equal(load(shop).vault.v1, undefined);
  io.reject.clear();
  await run(shop, io, 1 * H + 60_000);
  assert.equal(io.v.get('v1').price, '85.00');
  assert.deepEqual(load(shop).vault.v1.base, { price: '100.00', compareAt: null });
});

test('改成功但返回时网络断了:靠读回确认,不会把活动价当原价', async () => {
  const io = fakeIO({ v1: '100.00' });
  io.netErrorAfter = true;
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00')] }])]);
  const r = await run(shop, io, 1 * H);
  assert.equal(r.written.length, 1);
  assert.deepEqual(load(shop).vault.v1.base, { price: '100.00', compareAt: null });
  io.netErrorAfter = false;
  await run(shop, io, 10 * H);
  assert.deepEqual(price(io, 'v1'), { price: '100.00', compareAt: null });
});

test('改完还没核对就中断:下一轮开头核对意图,补记,原价正确', async () => {
  const io = fakeIO({ v1: '100.00' });
  io.readbackFails = true;
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00')] }])]);
  const r1 = await run(shop, io, 1 * H);
  assert.ok(r1.failures.some((f) => /中断/.test(f.message)));
  assert.ok(load(shop).vault.v1.intent); // 意图留在盘上
  const r2 = await run(shop, io, 1 * H + 60_000);
  assert.equal(r2.recovered.length, 1);
  const st = load(shop);
  assert.equal(st.vault.v1.intent, undefined);
  assert.deepEqual(st.vault.v1.base, { price: '100.00', compareAt: null }); // ★ 不是 85
  assert.ok(st.ledger.some((l) => /中断后核对/.test(l.note)));
  await run(shop, io, 10 * H);
  assert.deepEqual(price(io, 'v1'), { price: '100.00', compareAt: null });
});

test('巡检:活动中有人改价 → 暂停接管,结束不覆盖', async () => {
  const io = fakeIO({ v1: '100.00' });
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00')] }])]);
  await run(shop, io, 1 * H);
  io.v.set('v1', { ...io.v.get('v1'), price: '88.00' });
  const r = await run(shop, io, 2 * H);
  assert.equal(r.holds.length, 1);
  assert.equal(r.holds[0].plan, 'site');
  await run(shop, io, 10 * H);
  assert.equal(io.v.get('v1').price, '88.00');
  assert.ok(load(shop).log.some((l) => /手动改过价/.test(l.note)));
});

test('合集:Flash 两天交接共用产品,结束后只移出 app 加的,本来就在的保留', async () => {
  // P-a 本来就在 flash 合集里;P-b 两天都参加;P-c 只第 2 天
  const io = fakeIO({ a: '100.00', b: '100.00', c: '100.00' }, { flash: ['P-a'] });
  const col = { id: 'flash', title: 'Flash Sale' };
  const shop = setup([plan('flash', 'flash', [
    { id: 'd1', start: 0, end: 24 * H, collection: col, items: [item('a', '70.00'), item('b', '70.00')] },
    { id: 'd2', start: 24 * H, end: 48 * H, collection: col, items: [item('b', '75.00'), item('c', '70.00')] },
  ])]);
  await run(shop, io, 1 * H);
  assert.deepEqual([...io.coll.get('flash')].sort(), ['P-a', 'P-b']);
  await run(shop, io, 24 * H);
  assert.deepEqual([...io.coll.get('flash')].sort(), ['P-a', 'P-b', 'P-c']); // P-a 本来就在,不移出
  assert.equal(io.v.get('a').price, '100.00'); // 但价格已恢复
  await run(shop, io, 48 * H);
  assert.deepEqual([...io.coll.get('flash')], ['P-a']); // 回到原样,P-b 没漏
  assert.deepEqual(load(shop).collState, {});
});

test('合集加入报错:下一轮按店里实际重新核对,不会误记成已加入', async () => {
  const io = fakeIO({ a: '100.00', b: '100.00' }, { flash: [] });
  let fail = true;
  const realAdd = io.addToCollection;
  io.addToCollection = async (ctx, cid, pids) => { if (fail) { await realAdd(ctx, cid, pids.slice(0, 1)); throw new Error('模拟:加到一半报错'); } return realAdd(ctx, cid, pids); };
  const shop = setup([plan('flash', 'flash', [{ id: 'd1', start: 0, end: 10 * H, collection: { id: 'flash', title: 'Flash' }, items: [item('a', '70.00'), item('b', '70.00')] }])]);
  const r1 = await run(shop, io, 1 * H);
  assert.ok(r1.failures.some((f) => /加到一半/.test(f.message)));
  fail = false;
  await run(shop, io, 1 * H + 60_000);
  assert.deepEqual([...io.coll.get('flash')].sort(), ['P-a', 'P-b']);
  assert.deepEqual(load(shop).collState.flash.managed.sort(), ['P-a', 'P-b']);
  await run(shop, io, 10 * H);
  assert.deepEqual([...io.coll.get('flash')], []); // 两个都是 app 加的,结束全移出
});

test('变体被删了:移出计划,不会每分钟报', async () => {
  const io = fakeIO({});
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('gone', '85.00')] }])]);
  const r1 = await run(shop, io, 1 * H);
  assert.equal(r1.failures.length, 1);
  assert.deepEqual(load(shop).plans[0].excluded, ['gone']);
  const r2 = await run(shop, io, 1 * H + 60_000);
  assert.equal(r2.failures.length, 0);
});

test('没有授权:记错误,不动价格', async () => {
  const io = fakeIO({ v1: '100.00' });
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00')] }])]);
  const r = await runOnce(shop, { now: 1 * H, token: null, io });
  assert.match(r.failures[0].message, /授权/);
  assert.equal(io.v.get('v1').price, '100.00');
});

test('300 个产品一轮写完,全部核对通过', async () => {
  const vs = {}; const items = [];
  for (let i = 0; i < 300; i++) { vs[`v${i}`] = '100.00'; items.push(item(`v${i}`, '80.00')); }
  const io = fakeIO(vs);
  const shop = setup([plan('site', 'sitewide', [{ id: 's', start: 0, end: 10 * H, items }])]);
  const r = await run(shop, io, 1 * H);
  assert.equal(r.written.length, 300);
  assert.equal(io.writes, 300);
  await run(shop, io, 10 * H);
  assert.ok([...io.v.values()].every((x) => x.price === '100.00' && x.compareAt === null));
  assert.deepEqual(load(shop).vault, {});
});
