// 通知中心(2026-11-09):规则怎么定默认、发给谁、个人关掉、兜底、群、汇总、去重、发送记录
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-notify-'));
const { centerOf, recipients, cleanRule, EV, dispatch, flushDigest, readNotifyLog, addGroup, removeGroup, ensureSaved, loadBox } = await import('../src/notify-center.js');

const HOOK = 'https://open.larksuite.com/open-apis/bot/v2/hook/abc';
const mem = (id, roles, o = {}) => ({ id, name: id, status: 'active', roles, ...o });
const sched = (o = {}) => ({ members: [mem('boss', ['admin']), mem('p1', ['pricing']), mem('p2', ['pricing']), mem('o1', ['ops']), mem('gone', ['pricing'], { status: 'disabled' })],
  settings: { notify: {} }, notified: {}, ...o });
const ppl = (s, msg) => recipients(s, centerOf(s), msg)?.people.sort() || null;

test('还没保存过规则:开关照老设置,原来的群照旧收网站内容的通知;改价不进群', () => {
  const s = sched({ settings: { larkWebhook: HOOK, larkSecret: 'k', notify: { upDown: false } } });
  const c = centerOf(s, { hold: false });
  assert.equal(c.saved, false);
  assert.deepEqual(c.groups.map((g) => [g.id, g.webhook, g.secret]), [['main', HOOK, 'k']]);
  assert.equal(c.rules['content.updown'].on, false);
  assert.deepEqual(c.rules['content.failure'].to.groups, ['main']);
  assert.equal(c.rules['price.hold'].on, false);
  assert.deepEqual(c.rules['price.live'].to.groups, []);
  // 用户定的默认:日常 = 相关的人 + 管理员;出问题 = 相关的人 + 同部门 + 管理员
  assert.deepEqual(c.rules['price.live'].to, { related: true, approver: false, dept: false, admins: true, page: false, roles: [], people: [], groups: [] });
  assert.equal(c.rules['price.failure'].to.dept, true);
});

test('发给谁:相关的人 + 管理员;出问题加上同部门(同角色、能看这个页面的);停用的不发', () => {
  const s = sched();
  assert.deepEqual(ppl(s, { ev: 'price.live', related: ['p1', 'gone'] }), ['boss', 'p1']);
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['p1'] }), ['boss', 'p1', 'p2']);
  // 运营的人出了改价问题:运营看不到改价页 → 同部门里没人
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['o1'] }), ['boss', 'o1']);
  // 点按钮的人自己不收「暂停 / 提前结束」
  assert.deepEqual(ppl(s, { ev: 'price.control', related: ['p1', 'p2'], actor: 'p1' }), ['boss', 'p2']);
});

test('个人关掉:日常通知能关,出问题的关不掉;出问题谁都收不到时兜底给管理员', () => {
  const s = sched();
  s.members[1].notifyMute = ['price.live', 'price.failure'];
  assert.deepEqual(ppl(s, { ev: 'price.live', related: ['p1'] }), ['boss']);
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: ['p1'] }), ['boss', 'p1', 'p2']);
  const c = ensureSaved(s, {});
  c.rules['price.failure'] = { on: true, to: { related: true, approver: false, dept: false, admins: false, page: false, roles: [], people: [], groups: [] }, when: 'now' };
  c.rules['price.live'] = { ...c.rules['price.failure'], to: { ...c.rules['price.failure'].to } };
  assert.deepEqual(ppl(s, { ev: 'price.failure', related: [] }), ['boss'], '出问题没人收 → 管理员');
  assert.deepEqual(ppl(s, { ev: 'price.live', related: [] }), [], '日常通知没人收就算了');
});

test('规则只认存在的群 / 人 / 角色;审批人只有审批类能选;汇总只有日常通知能选', () => {
  const groups = [{ id: 'g1' }]; const members = [{ id: 'p1' }]; const roles = [{ key: 'pricing' }];
  const r = cleanRule(EV['price.failure'], { on: 1, to: { related: 1, approver: 1, roles: ['pricing', 'nope'], people: ['p1', 'x'], groups: ['g1', 'g9'] }, when: 'digest' }, { groups, members, roles });
  assert.deepEqual(r, { on: true, to: { related: true, approver: false, dept: false, admins: false, page: false, roles: ['pricing'], people: ['p1'], groups: ['g1'] }, when: 'now' });
  assert.equal(cleanRule(EV['price.live'], { when: 'digest' }).when, 'digest');
  assert.equal(cleanRule(EV['content.tomorrow'], { when: 'digest' }).when, 'now', '每天 10:00 的本来就是汇总');
  assert.equal(cleanRule(EV['price.submit'], { to: { approver: true } }).to.approver, true);
});

test('群:加的时候查地址、不能重复;删掉后规则里也去掉', () => {
  const s = sched();
  assert.throws(() => addGroup(s, {}, { name: '改价群', webhook: 'https://example.com/x' }), /格式不对/);
  const g = addGroup(s, {}, { name: '改价群', webhook: HOOK }, 1000);
  assert.throws(() => addGroup(s, {}, { name: '又一个', webhook: HOOK }), /已经加过/);
  s.notifyCenter.rules['price.failure'].to.groups = [g.id];
  assert.deepEqual(recipients(s, centerOf(s), { ev: 'price.failure', related: [] }).groups.map((x) => x.name), ['改价群']);
  removeGroup(s, {}, g.id);
  assert.deepEqual(s.notifyCenter.rules['price.failure'].to.groups, []);
});

test('发出去:每人一张(有专属卡片的用专属的)、群发一次;同一个 key 只发一次;记发送记录', async () => {
  const shop = 'send.myshopify.com';
  const s = sched({ settings: { larkWebhook: HOOK, notify: {} } });
  const dms = [], groups = [];
  const sendDm = async (ids, card) => { dms.push([ids.sort().join(','), card.title]); return []; };
  const sendGroup = async (g, card) => { groups.push([g.webhook, card.title]); };
  const msg = { ev: 'content.updown', related: ['o1'], card: { title: '全部', lines: ['a'] }, cards: { o1: { title: '你的', lines: ['b'] } } };
  await dispatch(shop, [msg], { sched: s, now: 1000, sendDm, sendGroup });
  assert.deepEqual(dms.sort(), [['boss', '全部'], ['o1', '你的']]);
  assert.deepEqual(groups, [[HOOK, '全部']]);
  await dispatch(shop, [{ ev: 'content.failure', key: 'k1', related: [], card: { title: '失败' } }], { sched: s, now: 2000, sendDm, sendGroup });
  await dispatch(shop, [{ ev: 'content.failure', key: 'k1', related: [], card: { title: '失败' } }], { sched: s, now: 3000, sendDm, sendGroup });
  assert.equal(groups.filter((g) => g[1] === '失败').length, 1);
  const log = readNotifyLog(shop).rows;
  assert.equal(log[0].title, '失败');
  assert.deepEqual(log[1].people.sort(), ['boss', 'o1']);
  assert.deepEqual(log[1].groups, ['飞书群(原来设置的)']);
  // 发失败也记下来
  await dispatch(shop, [{ ev: 'price.failure', related: ['p1'], card: { title: '改价失败' } }], { sched: s, now: 4000, sendDm: async (ids) => ids.map((id) => ({ to: id, message: '不在可用范围' })), sendGroup });
  const bad = readNotifyLog(shop).rows[0];
  assert.equal(bad.ok, false); assert.match(bad.errors.join(), /p1:不在可用范围/);
});

test('合进汇总:先攒着,英国时间 10:00 后每人 / 每个群发一张,当天只发一次', async () => {
  const shop = 'digest.myshopify.com';
  const s = sched();
  const c = ensureSaved(s, {});
  c.rules['price.live'].when = 'digest';
  const dms = [];
  const sendDm = async (ids, card) => { dms.push([ids.join(','), card.title, card.lines]); return []; };
  const T9 = Date.UTC(2026, 10, 9, 9, 0); // 冬令时:英国 09:00
  await dispatch(shop, [{ ev: 'price.live', related: ['p1'], card: { title: '💷 改价已生效', lines: ['**黑五**', '开始活动价 3 个变体'] } }], { sched: s, now: T9, sendDm });
  await dispatch(shop, [{ ev: 'price.live', related: ['p1'], card: { title: '💷 改价已生效', lines: ['**周末**'] } }], { sched: s, now: T9 + 1000, sendDm });
  assert.equal(dms.length, 0);
  assert.equal(loadBox(shop).queue['p:p1'].length, 2);
  await flushDigest(shop, { sched: s, now: T9 + 30 * 60_000, sendDm }); // 09:30 还不发
  assert.equal(dms.length, 0);
  await flushDigest(shop, { sched: s, now: T9 + 3600_000, sendDm }); // 10:00
  assert.deepEqual(dms.map((d) => d[0]).sort(), ['boss', 'p1']);
  assert.match(dms[0][1], /通知汇总 · 2 条/);
  assert.match(dms[0][2][0], /改价已生效 · 黑五/);
  await flushDigest(shop, { sched: s, now: T9 + 2 * 3600_000, sendDm });
  assert.equal(dms.length, 2, '当天只发一次');
  assert.deepEqual(loadBox(shop).queue, {});
});
