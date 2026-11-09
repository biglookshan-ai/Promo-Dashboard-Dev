// 消息中心(2026-11-09 v2):每类通知的默认设置、老设置带过来、推给谁、个人关掉、兜底、四种推送时间、卡片样式、套用到别的通知、试发、去重、发送记录
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-notify-'));
const { centerOf, recipients, cleanRule, EV, dispatch, flushQueue, readNotifyLog, addGroup, removeGroup, ensureSaved, loadBox, copyRule, testSend, nextAt, inWindow } = await import('../src/notify-center.js');
const { renderCard, defaultStyle, EVENTS, CATS } = await import('../src/notify-catalog.js');

const HOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/abc';
const APP = 'https://admin.shopify.com/store/x/apps/y';
const mem = (id, roles, o = {}) => ({ id, name: id, status: 'active', roles, ...o });
const sched = (o = {}) => ({ members: [mem('boss', ['admin']), mem('p1', ['pricing']), mem('p2', ['pricing']), mem('o1', ['ops']), mem('gone', ['pricing'], { status: 'disabled' })],
  settings: { notify: {} }, notified: {}, appUrl: APP, ...o });
const ppl = (s, msg) => recipients(s, centerOf(s), msg)?.people.sort() || null;
const sinks = () => { const dms = [], groups = []; return { dms, groups, sendDm: async (ids, card) => { dms.push({ to: [...ids].sort().join(','), card }); return []; }, sendGroup: async (g, card) => { groups.push({ hook: g.webhook, card }); } }; };

test('目录:每种通知都有分类、默认标题、显示的信息都在能选的里面', () => {
  const cats = new Set(CATS.map((c) => c.key));
  for (const ev of EVENTS) {
    assert.ok(cats.has(ev.cat), ev.key);
    assert.ok(ev.title && ev.color && ev.buttons.length, ev.key);
    assert.ok(ev.fields.every((f) => ev.avail.includes(f)), ev.key);
  }
  for (const k of ['price.created', 'price.live', 'price.restored', 'price.hold', 'banner.updated', 'topbar.order', 'pin.live', 'pins.hold']) assert.ok(EV[k], k);
});

test('还没保存过:开关照老设置;原来的群照旧收网站内容的上下线;改价不进群;有人动手的默认不发给动手的人', () => {
  const s = sched({ settings: { larkWebhook: HOOK, larkSecret: 'k', notify: { upDown: false } } });
  const c = centerOf(s, { hold: false });
  assert.equal(c.saved, false);
  assert.deepEqual(c.groups.map((g) => [g.id, g.webhook, g.secret]), [['main', HOOK, 'k']]);
  assert.equal(c.rules['banner.live'].on, false);
  assert.equal(c.rules['topbar.off'].on, false);
  assert.deepEqual(c.rules['banner.failure'].via.groups, ['main']);
  assert.equal(c.rules['price.hold'].on, false);
  assert.deepEqual(c.rules['price.live'].via.groups, []);
  assert.deepEqual(c.rules['banner.updated'].via.groups, [], '新加的「已修改」默认不发群');
  assert.equal(c.rules['price.created'].to.notActor, true);
  assert.equal(c.rules['price.live'].to.notActor, false);
  assert.deepEqual(c.rules['price.live'].when, { mode: 'now', merge: 10, at: '10:00', from: '09:00', to: '18:00' });
  assert.equal(c.rules['price.failure'].to.dept, true);
});

test('上午那版存的设置带到新的通知上(老的「自动上下线」→ 每种内容的上线 / 下线)', () => {
  const s = sched({ notifyCenter: { groups: [{ id: 'g1', name: '群', webhook: HOOK }], rules: { 'content.updown': { on: false, to: { related: true, groups: ['g1'] }, when: 'digest' }, 'price.live': { on: true, to: { admins: true, groups: [] }, when: 'now' } } } });
  const c = centerOf(s);
  for (const k of ['banner.live', 'campaign.off', 'pin.live']) {
    assert.equal(c.rules[k].on, false, k); assert.deepEqual(c.rules[k].via.groups, ['g1']); assert.equal(c.rules[k].when.mode, 'digest');
  }
  assert.equal(c.rules['price.switch'].to.admins, true, '换下一段跟着老的「改价已生效」');
  const saved = ensureSaved(s, {});
  assert.equal(saved.v2, true);
  assert.deepEqual(saved.rules['banner.live'].via.groups, ['g1']);
});

test('推给谁:相关的人 + 管理员;出问题加同部门;不发给动手的人;私信关了只发群;出问题没人收兜底给管理员', () => {
  const s = sched();
  assert.deepEqual(ppl(s, { ev: 'price.live', related: ['p1', 'gone'] }), ['boss', 'p1']);
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['p1'] }), ['boss', 'p1', 'p2']);
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['o1'] }), ['boss', 'o1'], '运营看不到改价页 → 同部门没人');
  assert.deepEqual(ppl(s, { ev: 'price.updated', related: ['p1', 'p2'], actor: 'p1' }), ['boss', 'p2']);
  s.members[1].notifyMute = ['price.live', 'price.failure'];
  assert.deepEqual(ppl(s, { ev: 'price.live', related: ['p1'] }), ['boss'], '日常通知个人能关');
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['p1'] }), ['boss', 'p1', 'p2'], '出问题的关不掉');
  const c = ensureSaved(s, {});
  c.rules['price.failure'].via.dm = false;
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['p1'] }), ['boss'], '私信关了又没群 → 出问题兜底私信管理员');
  c.rules['price.live'].to = { ...c.rules['price.live'].to, related: false, admins: false };
  assert.deepEqual(ppl(s, { ev: 'price.live', related: ['p1'] }), [], '日常通知没人收就算了');
});

test('设置只认存在的群 / 人 / 角色;审批人只有审批类能选;每天汇总只有日常通知能选;时间格式;样式洗干净', () => {
  const groups = [{ id: 'g1' }]; const members = [{ id: 'p1' }]; const roles = [{ key: 'pricing' }];
  const r = cleanRule(EV['price.failure'], { on: 1, to: { related: 1, approver: 1, roles: ['pricing', 'nope'], people: ['p1', 'x'] }, via: { groups: ['g1', 'g9'], at: 1 }, when: { mode: 'digest', merge: 9999, at: '7:5' } }, { groups, members, roles });
  assert.deepEqual(r.to, { related: true, approver: false, dept: false, admins: false, page: false, roles: ['pricing'], people: ['p1'], notActor: false });
  assert.deepEqual(r.via, { dm: true, groups: ['g1'], at: true });
  assert.equal(r.when.mode, 'now'); assert.equal(r.when.merge, 240); assert.equal(r.when.at, '10:00');
  assert.equal(cleanRule(EV['price.live'], { when: { mode: 'digest', at: '08:30' } }).when.at, '08:30');
  assert.equal(cleanRule(EV['price.submit'], { to: { approver: true } }).to.approver, true);
  const st = cleanRule(EV['price.live'], { style: { title: ' 开始啦 ', color: 'pink', layout: 'brief', fields: ['plan', 'holds', 'ops', 'plan'], buttons: { open: { on: true, text: '' }, list: { on: true, text: '列表' } } } }).style;
  assert.deepEqual([st.title, st.color, st.layout, st.fields], ['开始啦', 'green', 'brief', ['plan', 'ops']]);
  assert.deepEqual(st.buttons.open, { on: true, text: '打开这一条' });
});

test('卡片:标题带名称、按选的顺序显示、清单最多 N 条、按钮网址;简洁版只有一行', () => {
  const ev = EV['price.live'];
  const s = { ...defaultStyle(ev), fields: ['time', 'plan', 'products'], max: 2, buttons: { open: { on: true, text: '看计划' }, list: { on: true, text: '列表' }, app: { on: false, text: 'x' } } };
  const c = renderCard(ev, s, { plan: '黑五', time: '11/20 → 11/30', products: ['A', 'B', 'C'] }, { url: (p) => `${APP}${p}`, path: '/price/p1' });
  assert.equal(c.title, '💷 改价开始了 · 黑五');
  assert.deepEqual(c.rows, [{ label: '时间', value: '11/20 → 11/30' }, { label: '产品', list: ['A', 'B', '……共 3 个'] }], '名称已在标题里,不再重复');
  assert.deepEqual(c.buttons, [{ text: '看计划', url: `${APP}/price/p1` }, { text: '列表', url: `${APP}/price` }]);
  const b = renderCard(ev, { ...s, layout: 'brief' }, { plan: '黑五', time: '11/20 → 11/30', products: ['A'] }, { path: '/price/p1' });
  assert.deepEqual(b.rows, []); assert.equal(b.line, '11/20 → 11/30 · A'); assert.equal(b.buttons.length, 1);
});

test('马上发:同一轮同一种的合成一张;各人收到自己那几条;群 @ 相关的人;同一个 key 只发一次;记发送记录', async () => {
  const shop = 'now.myshopify.com';
  const s = sched();
  const c = ensureSaved(s, {});
  addGroup(s, {}, { name: '改价群', webhook: HOOK }, 1);
  const gid = c.groups[0].id;
  c.rules['price.live'].via = { dm: true, groups: [gid], at: true };
  const k = sinks();
  const m = (id, who) => ({ ev: 'price.live', path: `/price/${id}`, related: [who], data: { plan: id, ops: '开始活动价 3 个变体' } });
  await dispatch(shop, [m('A', 'p1'), m('B', 'p2')], { sched: s, now: 1000, ...k });
  const byTo = Object.fromEntries(k.dms.map((d) => [d.to, d.card]));
  assert.match(byTo.boss.title, /改价开始了 · 2 条/, '管理员两条合成一张');
  assert.equal(byTo.p1.title, '💷 改价开始了 · A');
  assert.equal(byTo.p2.title, '💷 改价开始了 · B');
  assert.equal(k.groups.length, 1); assert.deepEqual(k.groups[0].card.at.sort(), ['p1', 'p2']);
  assert.match(k.groups[0].card.rows[0].list[0], /A · .*\[打开\]\(https:\/\/admin\.shopify\.com\/store\/x\/apps\/y\/price\/A\)/);
  await dispatch(shop, [{ ev: 'price.failure', key: 'k1', related: [], data: { plan: 'X' } }], { sched: s, now: 2000, ...k });
  await dispatch(shop, [{ ev: 'price.failure', key: 'k1', related: [], data: { plan: 'X' } }], { sched: s, now: 3000, ...k });
  assert.equal(k.dms.filter((d) => /改价失败/.test(d.card.title)).length, 1);
  const log = readNotifyLog(shop).rows;
  assert.match(log[0].title, /改价失败/);
  assert.ok(log.some((r) => r.count === 2 && r.people.includes('boss')));
  // 发失败也记下来
  await dispatch(shop, [{ ev: 'price.failure', related: ['p1'], data: { plan: 'Y' } }], { sched: s, now: 4000, sendDm: async (ids) => ids.map((id) => ({ to: id, message: '不在可用范围' })), sendGroup: k.sendGroup });
  const bad = readNotifyLog(shop).rows[0];
  assert.equal(bad.ok, false); assert.match(bad.errors.join(), /不在可用范围/);
});

test('几分钟内合成一条:先排队,到时间每人一张;只在工作时间:下班的攒到上班', async () => {
  const shop = 'merge.myshopify.com';
  const s = sched();
  const c = ensureSaved(s, {});
  c.rules['banner.updated'].when = { mode: 'merge', merge: 10, at: '10:00', from: '09:00', to: '18:00' };
  const k = sinks();
  const msg = (n) => ({ ev: 'banner.updated', path: `/banners/${n}`, related: ['o1'], actor: 'o1', data: { name: n, changes: '图片' } });
  await dispatch(shop, [msg('a')], { sched: s, now: 0, ...k });
  await dispatch(shop, [msg('b')], { sched: s, now: 5 * 60_000, ...k });
  assert.equal(k.dms.length, 0);
  await flushQueue(shop, { sched: s, now: 9 * 60_000, ...k });
  assert.equal(k.dms.length, 0, '还没到 10 分钟');
  await flushQueue(shop, { sched: s, now: 10 * 60_000, ...k });
  assert.deepEqual(k.dms.map((d) => d.to), ['boss'], '动手的 o1 自己不收');
  assert.match(k.dms[0].card.title, /Banner已修改 · 2 条/);
  assert.equal(loadBox(shop).queue.length, 0);
  // 工作时间 09:00–18:00(英国):晚上 20:00 的攒到第二天 09:00
  c.rules['banner.updated'].when.mode = 'work';
  const night = Date.UTC(2026, 10, 9, 20, 0); // 冬令时 = 英国时间 20:00
  await dispatch(shop, [msg('c')], { sched: s, now: night, ...k });
  assert.equal(k.dms.length, 1);
  assert.equal(loadBox(shop).queue[0].due, Date.UTC(2026, 10, 10, 9, 0));
  await flushQueue(shop, { sched: s, now: Date.UTC(2026, 10, 10, 9, 0), ...k });
  assert.equal(k.dms.length, 2); assert.equal(k.dms[1].card.title, '✏️ Banner已修改 · c', '只攒了一条 = 原来那张卡片');
  await dispatch(shop, [msg('d')], { sched: s, now: Date.UTC(2026, 10, 10, 11, 0), ...k });
  assert.equal(k.dms.length, 3, '上班时间马上发');
});

test('每天汇总:到设的时间每人一张(按分类列);时间可以按北京时间算', async () => {
  const shop = 'digest.myshopify.com';
  const s = sched();
  const c = ensureSaved(s, {});
  c.rules['price.live'].when = { mode: 'digest', merge: 10, at: '10:00', from: '09:00', to: '18:00' };
  const k = sinks();
  const T9 = Date.UTC(2026, 10, 9, 9, 0); // 冬令时:英国 09:00
  await dispatch(shop, [{ ev: 'price.live', path: '/price/a', related: ['p1'], data: { plan: '黑五', ops: '开始活动价 3 个变体' } }], { sched: s, now: T9, ...k });
  await dispatch(shop, [{ ev: 'price.live', path: '/price/b', related: ['p1'], data: { plan: '周末' } }], { sched: s, now: T9 + 1000, ...k });
  await flushQueue(shop, { sched: s, now: T9 + 30 * 60_000, ...k });
  assert.equal(k.dms.length, 0, '09:30 还不发');
  await flushQueue(shop, { sched: s, now: T9 + 3600_000, ...k });
  assert.deepEqual(k.dms.map((d) => d.to).sort(), ['boss', 'p1']);
  assert.match(k.dms[0].card.title, /通知汇总 · 2 条/);
  assert.match(k.dms[0].card.rows[0].label, /改价/);
  assert.match(k.dms[0].card.rows[0].list[0], /改价开始 · 黑五/);
  // 北京时间 10:00 = 英国冬令时 02:00
  assert.equal(nextAt(Date.UTC(2026, 10, 9, 1, 0), '10:00', 'Asia/Shanghai'), Date.UTC(2026, 10, 9, 2, 0));
  assert.equal(nextAt(Date.UTC(2026, 10, 9, 3, 0), '10:00', 'Asia/Shanghai'), Date.UTC(2026, 10, 10, 2, 0));
  assert.equal(nextAt(Date.UTC(2026, 6, 1, 8, 0), '10:00', 'Europe/London'), Date.UTC(2026, 6, 1, 9, 0), '夏令时');
  assert.equal(inWindow(Date.UTC(2026, 10, 9, 23, 30), '22:00', '07:00', 'Europe/London'), true, '跨午夜的时段');
});

test('套用到别的通知:只套选的几块;样式只套颜色 / 版式 / 按钮,显示的信息只留对方有的,标题不套', () => {
  const s = sched();
  const c = ensureSaved(s, {});
  c.rules['banner.updated'] = { ...c.rules['banner.updated'], to: { ...c.rules['banner.updated'].to, admins: false, people: ['p1'] }, when: { mode: 'digest', merge: 10, at: '09:00', from: '09:00', to: '18:00' },
    style: { ...defaultStyle(EV['banner.updated']), title: 'X', color: 'purple', layout: 'brief', fields: ['changes', 'name', 'actor'] } };
  const n = copyRule(c, 'banner.updated', ['topbar.updated', 'banner.failure'], ['to', 'when', 'style']);
  assert.equal(n, 2);
  assert.deepEqual(c.rules['topbar.updated'].to.people, ['p1']);
  assert.equal(c.rules['topbar.updated'].when.mode, 'digest');
  assert.equal(c.rules['banner.failure'].when.mode, 'now', '出问题的不能拖到汇总');
  const st = c.rules['topbar.updated'].style;
  assert.deepEqual([st.title, st.color, st.layout, st.fields], ['✏️ 顶栏已修改', 'purple', 'brief', ['changes', 'name', 'actor']]);
  assert.deepEqual(c.rules['banner.failure'].style.fields, ['name'], '失败那种没有「改了什么」「操作人」');
  assert.equal(c.rules['topbar.updated'].via.dm, true, 'via 没选就不动');
});

test('发给我试试:用示例数据和还没保存的样式,私信给自己或发到群;没登录飞书时要选群', async () => {
  const s = sched();
  addGroup(s, {}, { name: '改价群', webhook: HOOK }, 7);
  const k = sinks();
  await testSend(s, {}, 'price.hold', { on: true, style: { title: '⚠️ 接管了', color: 'red' } }, { me: 'boss', ...k });
  assert.equal(k.dms[0].to, 'boss'); assert.match(k.dms[0].card.title, /^【试发】⚠️ 接管了/);
  assert.ok(k.dms[0].card.rows.some((r) => r.label === '暂停接管的产品'));
  await testSend(s, {}, 'price.hold', {}, { groupId: s.notifyCenter.groups[0].id, ...k });
  assert.equal(k.groups.length, 1);
  await assert.rejects(testSend(s, {}, 'price.hold', {}, { ...k }), /选一个飞书群/);
});

test('群:加的时候查地址、不能重复;删掉后各通知里也去掉', () => {
  const s = sched();
  assert.throws(() => addGroup(s, {}, { name: '改价群', webhook: 'https://example.com/x' }), /格式不对/);
  const g = addGroup(s, {}, { name: '改价群', webhook: HOOK }, 1000);
  assert.throws(() => addGroup(s, {}, { name: '又一个', webhook: HOOK }), /已经加过/);
  s.notifyCenter.rules['price.failure'].via.groups = [g.id];
  assert.deepEqual(recipients(s, centerOf(s), { ev: 'price.failure', related: [] }).groups.map((x) => x.name), ['改价群']);
  removeGroup(s, {}, g.id);
  assert.deepEqual(s.notifyCenter.rules['price.failure'].via.groups, []);
});
