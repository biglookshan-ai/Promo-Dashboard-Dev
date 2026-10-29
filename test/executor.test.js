// 执行器端到端:真的存盘(临时目录)+ 假的 Shopify(内存),模拟写失败、网络异常、改到一半中断、手动改价、合集交接
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'price-exec-'));
const { runOnce } = await import('../src/price/executor.js');
const { reportMessages } = await import('../src/price/notifier.js');
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
    tags: {}, // 产品 → 标签数组
    async readProductTags(ctx, pids) { const m = new Map(); pids.forEach((p) => m.set(p, [...(io.tags[p] || [])])); return m; },
    async addTags(ctx, pid, t) { io.tags[pid] = [...new Set([...(io.tags[pid] || []), ...t])]; },
    async removeTags(ctx, pid, t) { io.tags[pid] = (io.tags[pid] || []).filter((x) => !t.includes(x)); },
    deleted: new Set(), // 在店里被删掉的合集
    calls: 0,
    // 带条件的合集(2026 新版):{ shared, selected: 「单独加入」名单, matches: 按条件收进去的 }。collectionAddProducts 对它回「does not exist」
    kinds: new Map(),
    gone(cid) { io.calls++; if (io.deleted.has(cid)) throw new Error('移出 Collection 失败:Collection does not exist'); },
    async productsInCollection(ctx, cid, pids) { io.gone(cid); const k = io.kinds.get(cid); const s = k ? new Set([...k.selected, ...k.matches]) : coll.get(cid) || new Set(); return new Set(pids.filter((p) => s.has(p))); },
    async addToCollection(ctx, cid, pids) { io.gone(cid); if (io.kinds.has(cid)) throw new Error('加入 Collection 失败:Collection does not exist'); if (!coll.has(cid)) coll.set(cid, new Set()); pids.forEach((p) => coll.get(cid).add(p)); },
    async removeFromCollection(ctx, cid, pids) { io.gone(cid); if (io.kinds.has(cid)) throw new Error('移出 Collection 失败:Collection does not exist'); pids.forEach((p) => coll.get(cid)?.delete(p)); },
    async collectionModel(ctx, cid) { if (io.deleted.has(cid)) return { exists: false }; const k = io.kinds.get(cid); return k ? { exists: true, automated: true, srcId: k.shared ? null : `src-${cid}`, selected: new Set(k.selected) } : { exists: true, automated: false, srcId: null, selected: null }; },
    async includeProducts(ctx, cid, src, pids) { io.calls++; assert.equal(src, `src-${cid}`); pids.forEach((p) => io.kinds.get(cid).selected.add(p)); },
    async unincludeProducts(ctx, cid, src, pids) { io.calls++; pids.forEach((p) => io.kinds.get(cid).selected.delete(p)); },
    async collectionExists(ctx, cid) { return !io.deleted.has(cid); },
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

test('Collection:Flash 两天交接共用产品,结束后只移出 app 加的,本来就在的保留', async () => {
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

test('Collection 加入报错:下一轮按店里实际重新核对,不会误记成已加入', async () => {
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

test('Collection 在店里被删了:记一笔、通知一次,之后不再碰它,也不再报失败;价格照常', async () => {
  const io = fakeIO({ a: '100.00', b: '100.00' }, { bf: [] });
  const col = { id: 'bf', title: 'Black Friday' };
  const shop = setup([plan('bf', 'flash', [{ id: 'd1', start: 0, end: 10 * H, collection: col, items: [item('a', '70.00'), item('b', '70.00')] }])]);
  await run(shop, io, 1 * H);
  assert.deepEqual(load(shop).collState.bf.managed.sort(), ['P-a', 'P-b']);
  io.deleted.add('bf'); io.coll.delete('bf');
  // 计划结束要移出 → Collection 没了:不算失败,改记「已删除」,价格照常恢复
  const r = await run(shop, io, 10 * H);
  assert.equal(r.failures.length, 0);
  assert.deepEqual(r.goneCollections.map((c) => [c.title, c.plans.map((p) => p.name)]), [['Black Friday', ['bf']]]);
  const st = load(shop);
  assert.equal(st.collState.bf, undefined);
  assert.equal(st.goneCollections.bf.title, 'Black Friday');
  assert.equal(io.v.get('a').price, '100.00');
  assert.ok(st.log.some((l) => /Black Friday」在店里已经被删除/.test(l.note)));
  const msgs = reportMessages(st, r, { members: [{ id: 'ou_admin', status: 'active', roles: ['admin'] }] });
  assert.deepEqual(msgs.map((m) => m.card.title), ['🔙 改价已恢复', '🗂 Collection 已被删除']);
  // 之后再跑:不再碰这个 Collection
  const calls = io.calls;
  const r2 = await run(shop, io, 10 * H + 60_000);
  assert.equal(r2.failures.length + r2.goneCollections.length, 0);
  assert.equal(io.calls, calls);
});

test('Collection 在计划进行中被删了:不再往里加,价格照常;只是暂时出错(Collection 还在)照旧报失败重试', async () => {
  const io = fakeIO({ a: '100.00' }, {});
  io.deleted.add('old');
  const shop = setup([plan('p', 'flash', [{ id: 'd1', start: 0, end: 10 * H, collection: { id: 'old', title: 'Old' }, items: [item('a', '70.00')] }])]);
  const r = await run(shop, io, 1 * H);
  assert.equal(r.failures.length, 0);
  assert.equal(r.goneCollections.length, 1);
  assert.equal(io.v.get('a').price, '70.00');
  const r2 = await run(shop, io, 2 * H);
  assert.equal(r2.failures.length + r2.goneCollections.length, 0);
  // Collection 还在、只是这次请求出错 → 照旧当失败
  const io2 = fakeIO({ a: '100.00' }, { flash: [] });
  io2.addToCollection = async () => { throw new Error('模拟:网络超时'); };
  const shop2 = setup([plan('p', 'flash', [{ id: 'd1', start: 0, end: 10 * H, collection: { id: 'flash', title: 'Flash' }, items: [item('a', '70.00')] }])]);
  const r3 = await run(shop2, io2, 1 * H);
  assert.ok(r3.failures.some((f) => /网络超时/.test(f.message)));
  assert.equal(load(shop2).goneCollections?.flash, undefined);
});

test('带条件的 Collection(2026 新版,用户 2026-10-30 提醒):加进它的「单独加入」名单,不管本来在不在;结束只拿掉 app 加的,你们手动加的不动', async () => {
  const io = fakeIO({ a: '100.00', b: '100.00', x: '100.00' });
  // P-a 已经因为打折被条件收进去了;P-x 是你们事先手动单独加的
  io.kinds.set('bf', { shared: false, selected: new Set(['P-x']), matches: new Set(['P-a']) });
  const shop = setup([plan('bf', 'flash', [{ id: 'd1', start: 0, end: 10 * H, collection: { id: 'bf', title: 'Black Friday' }, items: [item('a', '70.00'), item('b', '70.00'), item('x', '70.00')] }])]);
  const r1 = await run(shop, io, 1 * H);
  assert.equal(r1.failures.length, 0);
  assert.deepEqual([...io.kinds.get('bf').selected].sort(), ['P-a', 'P-b', 'P-x']); // P-a 本来就在(按条件),也加进「单独加入」一次,确保在
  const cs = load(shop).collState.bf;
  assert.equal(cs.via, 'sources'); assert.deepEqual(cs.managed.sort(), ['P-a', 'P-b']); assert.deepEqual(cs.preexisting, ['P-x']);
  await run(shop, io, 10 * H); // 结束
  assert.deepEqual([...io.kinds.get('bf').selected], ['P-x']); // 只拿掉 app 加的
  assert.equal(load(shop).collState.bf, undefined);
});

test('带条件 Collection 的老记录 / 误判(2026-10-30):旧版把「因为打折被条件收进去」的当成自己加的 → 只留真的在名单里的;误标成被删除 / 不能管的恢复;条件共用的不碰', async () => {
  // ① 老记录:managed 里 P-a 其实是按条件进去的(app 当时加不进去),P-c 真的在「单独加入」名单里
  const io = fakeIO({ a: '100.00' });
  io.kinds.set('bf', { shared: false, selected: new Set(['P-c']), matches: new Set(['P-a']) });
  const shop = setup([]);
  const st = load(shop); st.collState = { bf: { title: 'Black Friday', managed: ['P-a', 'P-c'], preexisting: [] } };
  st.goneCollections = { bf2: { title: 'Black Friday', at: 1, plans: [], reason: 'refused', left: [] }, gone9: { title: 'Old', at: 1, plans: [] } }; save(shop, st);
  io.kinds.set('bf2', { shared: false, selected: new Set(), matches: new Set() }); io.deleted.add('gone9');
  const r = await run(shop, io, 1 * H); // 计划都删了:只拿掉真的是 app 加的 P-c,不再去「移出」P-a(以前每分钟失败的原因)
  assert.equal(r.failures.length, 0);
  assert.deepEqual([...io.kinds.get('bf').selected], []);
  const st2 = load(shop);
  assert.equal(st2.collState.bf, undefined);
  assert.equal(st2.goneCollections.bf2, undefined); // 误判的恢复了
  assert.equal(st2.goneCollections.gone9.v, 2);    // 真的被删了:核对过,不再查
  // ② 条件和别的 Collection 共用:不碰,也不报错
  const io3 = fakeIO({ a: '100.00' }); io3.kinds.set('sh', { shared: true, selected: new Set(), matches: new Set() });
  const shop3 = setup([plan('p3', 'flash', [{ id: 'd1', start: 0, end: 10 * H, collection: { id: 'sh', title: 'Shared' }, items: [item('a', '70.00')] }])]);
  const r3 = await run(shop3, io3, 1 * H);
  assert.equal(r3.failures.length, 0); assert.equal(load(shop3).collState.sh.via, 'shared'); assert.equal(io3.v.get('a').price, '70.00');
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

test('改价时加减产品标签:结束还原;本来就有的标签不动;原来有、被去掉的会加回来', async () => {
  const io = fakeIO({ a: '100.00', b: '100.00' });
  io.tags['P-a'] = ['Clearance'];           // 原来就有 Clearance,计划要去掉
  io.tags['P-b'] = ['FlashDeal', 'Keep'];   // 原来就有 FlashDeal(不是 app 加的)
  const p = plan('flash', 'flash', [{ id: 's', start: 0, end: 10 * H, items: [item('a', '70.00'), item('b', '70.00')] }]);
  p.tagsAdd = ['FlashDeal']; p.tagsRemove = ['Clearance'];
  const shop = setup([p]);
  await run(shop, io, 1 * H);
  assert.deepEqual(io.tags['P-a'].sort(), ['FlashDeal']);        // 加了 FlashDeal、去掉 Clearance
  assert.deepEqual(io.tags['P-b'].sort(), ['FlashDeal', 'Keep']); // 本来就有,没重复加
  const st = load(shop);
  assert.deepEqual(st.tagState['P-a'], { added: ['FlashDeal'], removed: ['Clearance'] });
  assert.equal(st.tagState['P-b'], undefined); // 什么都没动,不记账
  await run(shop, io, 10 * H); // 结束
  assert.deepEqual(io.tags['P-a'].sort(), ['Clearance']);         // 还原
  assert.deepEqual(io.tags['P-b'].sort(), ['FlashDeal', 'Keep']); // 本来就有的不去掉
  assert.deepEqual(load(shop).tagState, {});
});

test('标签:计划暂停 → 标签还原;继续 → 再加回来', async () => {
  const io = fakeIO({ a: '100.00' });
  const p = plan('flash', 'flash', [{ id: 's', start: 0, end: 10 * H, items: [item('a', '70.00')] }]);
  p.tagsAdd = ['TOP DEALS'];
  const shop = setup([p]);
  await run(shop, io, 1 * H);
  assert.deepEqual(io.tags['P-a'], ['TOP DEALS']);
  let st = load(shop); st.plans[0].paused = true; save(shop, st);
  await run(shop, io, 2 * H);
  assert.deepEqual(io.tags['P-a'], []);
  st = load(shop); st.plans[0].paused = false; save(shop, st);
  await run(shop, io, 3 * H);
  assert.deepEqual(io.tags['P-a'], ['TOP DEALS']);
});

test('改价倒计时(2026-10-27):开了倒计时的计划改价时给产品写 custom.cgp_price_cd,结束 / 暂停时删掉;没开的不写', async () => {
  const io = fakeIO({ v1: '100.00', v2: '100.00', v3: '100.00' });
  io.cd = {}; io.cdCalls = 0;
  io.setCountdowns = async (ctx, list) => { io.cdCalls++; list.forEach((x) => { io.cd[x.productId] = JSON.parse(x.value); }); return list.map((x) => x.productId); };
  io.deleteCountdowns = async (ctx, ids) => { io.cdCalls++; ids.forEach((id) => delete io.cd[id]); return ids; };
  const bf = { ...plan('bf', null, [{ id: 's', start: 0, end: 10 * H, items: [item('v1', '85.00'), item('v2', '85.00')] }]), countdown: { on: true, label: 'Black Friday ends in', days: 3, style: 'dark' } };
  const quiet = plan('quiet', null, [{ id: 'q', start: 0, end: 10 * H, items: [item('v3', '90.00')] }]);
  const shop = setup([bf, quiet]);
  await run(shop, io, 1 * H);
  assert.deepEqual(Object.keys(io.cd).sort(), ['P-v1', 'P-v2']);          // 没开倒计时的 v3 不写
  assert.deepEqual(io.cd['P-v1'], { e: 36000, s: 36000 - 3 * 86400, l: 'Black Friday ends in', st: 'dark' });
  const calls = io.cdCalls;
  await run(shop, io, 2 * H);
  assert.equal(io.cdCalls, calls);                                         // 没变化就不再写
  // 改了文字 → 重写
  const st = load(shop); st.plans[0].countdown.label = 'Pre-Order Offer ends in'; save(shop, st);
  await run(shop, io, 3 * H);
  assert.equal(io.cd['P-v1'].l, 'Pre-Order Offer ends in');
  // 暂停 = 恢复原价 → 倒计时也去掉
  const st2 = load(shop); st2.plans[0].paused = true; save(shop, st2);
  await run(shop, io, 4 * H);
  assert.deepEqual(io.cd, {});
  assert.deepEqual(load(shop).cdState, {});
});

test('改价倒计时:有人手动改了价(暂停接管)的产品不显示;计划结束自动去掉', async () => {
  const io = fakeIO({ v1: '100.00', v2: '100.00' });
  io.cd = {};
  io.setCountdowns = async (ctx, list) => { list.forEach((x) => { io.cd[x.productId] = JSON.parse(x.value); }); return list.map((x) => x.productId); };
  io.deleteCountdowns = async (ctx, ids) => { ids.forEach((id) => delete io.cd[id]); return ids; };
  const shop = setup([{ ...plan('fl', null, [{ id: 's', start: 0, end: 5 * H, items: [item('v1', '80.00'), item('v2', '80.00')] }]), countdown: { on: true, label: '', days: 0 } }]);
  await run(shop, io, 1 * H);
  assert.equal(io.cd['P-v1'].s, 0); assert.equal(io.cd['P-v1'].st, 'classic');
  io.v.set('v2', { ...io.v.get('v2'), price: '77.00' });                  // 同事在后台手动改了 v2
  const st = load(shop); st.engine.lastSweep = 0; save(shop, st);
  await run(shop, io, 2 * H);
  assert.deepEqual(Object.keys(io.cd), ['P-v1']);
  await run(shop, io, 6 * H);                                              // 结束
  assert.deepEqual(Object.keys(io.cd), []);
});
