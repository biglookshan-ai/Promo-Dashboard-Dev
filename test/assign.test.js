// v3 分工:每条内容指定审批人 / 负责人 / 抄送 / 截止;私信给具体的人
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, canApprove, effApprover } from '../src/schedule-actions.js';
import { dmMessages, schedulerDMs, peopleOf } from '../src/notifier.js';
import { DEFAULT_NOTIFY } from '../src/schedule-store.js';

const T = Date.UTC(2026, 9, 1, 12), H = 3600000, D = 86400000;
const admin = { id: 'm-admin', name: '老板', role: 'approver' };
const ops = { id: 'm-ops', name: '运营小王', role: 'editor' };
const lead = { id: 'm-lead', name: '运营主管', role: 'editor' };
const design = { id: 'm-des', name: '设计', role: 'editor' };
const members = [admin, ops, lead, design].map((a) => ({ id: a.id, name: a.name, status: 'active', roles: a.role === 'approver' ? ['admin'] : ['ops'] }));
const doc = (o = {}) => ({ banners: [], topbar: [], tbstyles: [], campaigns: [], pmodules: [], pins: [], pendingOrder: null, log: [], staff: [], members,
  settings: { notify: { ...DEFAULT_NOTIFY }, approvers: {} }, notified: {}, ...o });
const banner = (o = {}) => ({ id: 'b1', kind: 'banner', state: 'approved', image: 'x.jpg', title: 'A', order: 0, start: null, end: null, campaign: null, ...o });
const save = (d, actor, values, o = {}) => applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', isNew: !o.id, id: o.id, values: { image: 'a.jpg', title: 'N', ...values, ...(o.id ? {} : { id: 'b-new' }) } }, actor, T);

test('审批人:指定的 → 这类默认的 → 管理员', () => {
  const d = doc({ settings: { notify: DEFAULT_NOTIFY, approvers: { banner: 'm-lead' } } });
  assert.equal(effApprover(d, { kind: 'banner', approver: 'm-des' }), 'm-des');
  assert.equal(effApprover(d, { kind: 'banner' }), 'm-lead');
  assert.equal(effApprover(d, { kind: 'topbar' }), null);
  assert.ok(canApprove(admin, d, { kind: 'topbar' }), '管理员什么都能批');
  assert.ok(canApprove(lead, d, { kind: 'banner' }));
  assert.ok(!canApprove(ops, d, { kind: 'banner' }));
});

test('指定了审批人:编辑提交 → 只有那个人(或管理员)能批,别人不能', () => {
  const r = save(doc(), ops, { approver: 'm-lead', owner: 'm-ops', cc: ['m-des'] });
  const it = r.doc.banners[0];
  assert.equal(it.state, 'pending'); assert.equal(it.approver, 'm-lead'); assert.deepEqual(it.cc, ['m-des']);
  assert.throws(() => applyAction(r.doc, { type: 'approve', id: 'b-new' }, design, T), /审批人\(或管理员\)/);
  const r2 = applyAction(r.doc, { type: 'approve', id: 'b-new' }, lead, T);
  assert.equal(r2.doc.banners[0].state, 'approved'); assert.equal(r2.doc.banners[0].approvedBy, 'm-lead');
  assert.ok(applyAction(r.doc, { type: 'approve', id: 'b-new' }, admin, T).doc.banners[0].state === 'approved');
});

test('不是管理员不能把自己设成审批人;默认审批人可以', () => {
  assert.throws(() => save(doc(), ops, { approver: 'm-ops' }), /审批人不能选你自己/);
  const d = doc({ settings: { notify: DEFAULT_NOTIFY, approvers: { banner: 'm-lead' } } });
  const r = save(d, lead, { approver: 'm-lead' });
  assert.equal(r.doc.banners[0].state, 'approved', '默认审批人自己提交 = 直接生效');
});

test('审批人自己提交 = 直接生效;改已批准内容的审批人要现在的审批人批', () => {
  const d = doc({ banners: [banner({ approver: 'm-lead' })] });
  const r = applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', id: 'b1', values: { title: 'B' } }, lead, T);
  assert.equal(r.doc.banners[0].title, 'B'); assert.ok(!r.doc.banners[0].pendingChange);
  // 编辑想把审批人换成设计 → 生成修改待审核,由现在的审批人(主管)批
  const r2 = applyAction(d, { type: 'save', mode: 'submit', kind: 'banner', id: 'b1', values: { approver: 'm-des' } }, ops, T);
  assert.equal(r2.doc.banners[0].approver, 'm-lead'); assert.equal(r2.doc.banners[0].pendingChange.approver, 'm-des');
  assert.throws(() => applyAction(r2.doc, { type: 'approve', id: 'b1' }, design, T), /审批人/);
  assert.equal(applyAction(r2.doc, { type: 'approve', id: 'b1' }, lead, T).doc.banners[0].approver, 'm-des');
});

test('审批人改了别人提交的再直接保存 = 批准,并通知提交人', () => {
  const r = save(doc(), ops, { approver: 'm-lead' });
  const r2 = applyAction(r.doc, { type: 'save', mode: 'publish', kind: 'banner', id: 'b-new', values: { title: '改过' } }, lead, T);
  assert.equal(r2.doc.banners[0].state, 'approved');
  const n = r2.effects.find((e) => e.type === 'notify');
  assert.equal(n.event, 'decision'); assert.equal(n.to, 'm-ops'); assert.equal(n.actor, 'm-lead');
});

test('轮播顺序:这类的默认审批人可以直接改 / 批', () => {
  const d = doc({ banners: [banner({ id: 'a', order: 0 }), banner({ id: 'b', order: 1 })], settings: { notify: DEFAULT_NOTIFY, approvers: { banner: 'm-lead' } } });
  const r = applyAction(d, { type: 'order', kind: 'banner', ids: ['b', 'a'] }, lead, T);
  assert.equal(r.doc.banners.find((x) => x.id === 'b').order, 0);
  const r2 = applyAction(d, { type: 'order', kind: 'banner', ids: ['b', 'a'] }, ops, T);
  assert.ok(r2.doc.pendingOrder);
  assert.throws(() => applyAction(r2.doc, { type: 'approve', id: '__order' }, design, T), /默认审批人/);
  assert.equal(applyAction(r2.doc, { type: 'approve', id: '__order' }, lead, T).doc.pendingOrder, null);
});

test('负责人可以删自己负责的草稿', () => {
  const d = doc({ banners: [banner({ state: 'draft', by: 'm-lead', owner: 'm-ops' })] });
  assert.equal(applyAction(d, { type: 'delete', id: 'b1' }, ops, T).doc.banners.length, 0);
  assert.throws(() => applyAction(d, { type: 'delete', id: 'b1' }, design, T), /只能删除/);
});

test('私信:提交 → 审批人;批准 → 提交人 + 负责人 + 抄送(不发给批的人自己)', () => {
  const r = save(doc(), ops, { approver: 'm-lead', owner: 'm-ops', cc: ['m-des'] });
  const sub = r.effects.find((e) => e.event === 'submit');
  const m1 = dmMessages(r.doc, sub, { appUrl: 'u', now: T });
  assert.deepEqual(m1[0].to, ['m-lead']);
  const r2 = applyAction(r.doc, { type: 'approve', id: 'b-new' }, lead, T);
  const m2 = dmMessages(r2.doc, r2.effects.find((e) => e.event === 'decision'), { appUrl: 'u', now: T });
  assert.deepEqual(m2[0].to.sort(), ['m-des', 'm-ops']);
  // 没指定审批人 → 发给管理员
  const r3 = save(doc(), ops, {});
  assert.deepEqual(dmMessages(r3.doc, r3.effects.find((e) => e.event === 'submit'), { now: T })[0].to, ['m-admin']);
  // 关掉「提交审核」通知就不发
  const off = { ...r.doc, settings: { ...r.doc.settings, notify: { ...DEFAULT_NOTIFY, submit: false } } };
  assert.equal(dmMessages(off, sub, { now: T }).length, 0);
});

test('私信:上下线发给负责人和抄送;截止提醒发给负责人', () => {
  const d = doc({ banners: [banner({ owner: 'm-ops', cc: ['m-des'] }), banner({ id: 'b2', state: 'draft', owner: 'm-ops', due: T + 5 * H, title: '黑五' }), banner({ id: 'b3', state: 'rejected', by: 'm-des', due: T - H, title: '过期' })] });
  const out = schedulerDMs(d, { changes: [{ id: 'b1', kind: 'banner', title: 'A', to: 'ACTIVE' }] }, { now: T });
  const up = out.filter((m) => !m.key);
  assert.deepEqual(up.map((m) => m.to[0]).sort(), ['m-des', 'm-ops']);
  const soon = out.find((m) => m.key?.startsWith('due-soon:b2'));
  assert.deepEqual(soon.to, ['m-ops']);
  const over = out.find((m) => m.key?.startsWith('due-over:b3'));
  assert.deepEqual(over.to.sort(), ['m-admin', 'm-des'], '没负责人就提醒建的人,过了截止也告诉审批人');
  assert.deepEqual(peopleOf(d, { owner: 'gone', cc: ['m-ops'] }), ['m-ops'], '停用 / 不存在的成员不发');
});

test('动作的副作用:群消息照发,另外私信给审批人(接到 runEffects)', async () => {
  const { runEffects } = await import('../src/sync.js');
  const r = save(doc({ settings: { notify: { ...DEFAULT_NOTIFY }, approvers: {}, larkWebhook: 'https://open.larksuite.com/open-apis/bot/v2/hook/x' } }), ops, { approver: 'm-lead' });
  const group = [], dms = [];
  const out = await runEffects({}, r.doc, r.effects, { appUrl: 'u', now: T, send: async (_, card) => { group.push(card.title); }, sendDm: async (to, card) => { dms.push({ to, title: card.title }); return []; } });
  assert.deepEqual(out.errors, []);
  assert.equal(group.length, 1);
  assert.deepEqual(dms, [{ to: ['m-lead'], title: '📝 有内容等你审批' }]);
});
