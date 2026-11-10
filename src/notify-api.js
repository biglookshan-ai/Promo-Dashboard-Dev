// 消息中心的接口(挂在 /api/notify)。每种通知的设置、飞书群、发送记录只给管理员;「我的通知」每个人都能改自己的。
import express from 'express';
import { load, replace, appendLog } from './schedule-store.js';
import { load as loadPrice } from './price/store.js';
import { withLock } from './sync.js';
import { isAdmin, rolesOf } from './members.js';
import { teamEnabled } from './lark-login.js';
import { sendLark } from './lark.js';
import { EV, TZS, eventsOn, centerOf, centerView, ensureSaved, cleanRule, defaultRule, copyRule, addGroup, removeGroup, readNotifyLog, recipients, testSend } from './notify-center.js';

class NotifyError extends Error {}
export function notifyRouter() {
  const r = express.Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e instanceof NotifyError || e.expose ? 400 : 500).json({ error: String(e.message || e) }); if (!(e instanceof NotifyError)) console.error('[notify-api]', e); }
  };
  const fail = (m) => { throw new NotifyError(m); };
  // 多人协作关着时打开 app 的人都是管理员(和别的设置一样)
  const needAdmin = (req) => { if (teamEnabled() && !isAdmin(req.ctx.member || {})) fail('只有管理员能改通知设置'); };
  const priceNotify = (shop) => { try { return loadPrice(shop).settings?.notify || {}; } catch { return {}; } };
  const view = (shop) => ({ ...centerView(load(shop), priceNotify(shop)), team: teamEnabled() });
  const evOf = (key) => EV[key] || fail('没有这种通知');
  const ctxOf = (s, c) => ({ groups: c.groups, members: s.members || [], roles: rolesOf(s) });
  const note = (req, s, text) => appendLog(s, { at: Date.now(), action: 'edit', kind: 'system', title: '消息中心', note: text, by: req.ctx.member?.name || '管理员' });

  r.get('/', wrap(async (req) => { needAdmin(req); return view(req.ctx.shop); }));

  // 改一种通知的设置(开关 / 推给谁 / 怎么推 / 什么时候推 / 样式)
  r.put('/rules/:key', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const ev = evOf(req.params.key);
    const s = load(req.ctx.shop);
    const c = ensureSaved(s, priceNotify(req.ctx.shop));
    const before = JSON.stringify(c.rules[ev.key]);
    c.rules[ev.key] = cleanRule(ev, req.body || {}, ctxOf(s, c));
    if (JSON.stringify(c.rules[ev.key]) !== before) note(req, s, `改了「${ev.name}」的通知设置`);
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `消息中心:改了「${ev.name}」的设置` };
    return view(req.ctx.shop);
  })));
  // 恢复默认
  r.post('/rules/:key/reset', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const ev = evOf(req.params.key);
    const s = load(req.ctx.shop);
    const c = ensureSaved(s, priceNotify(req.ctx.shop));
    c.rules[ev.key] = defaultRule(ev, { sched: s.settings?.notify || {}, price: priceNotify(req.ctx.shop) });
    note(req, s, `「${ev.name}」的通知设置恢复默认`);
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `消息中心:「${ev.name}」恢复默认设置` };
    return view(req.ctx.shop);
  })));
  // 套用到别的通知(选套哪几块)
  r.post('/rules/:key/copy', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const ev = evOf(req.params.key);
    const parts = (req.body?.parts || []).filter((x) => ['on', 'to', 'via', 'when', 'style'].includes(x));
    const targets = (req.body?.targets || []).filter((k) => EV[k] && k !== ev.key);
    if (!parts.length) fail('选一下要套用哪几块');
    if (!targets.length) fail('选一下套用到哪些通知');
    const s = load(req.ctx.shop);
    const c = ensureSaved(s, priceNotify(req.ctx.shop));
    const n = copyRule(c, ev.key, targets, parts);
    for (const k of targets) c.rules[k] = cleanRule(EV[k], c.rules[k], ctxOf(s, c)); // 套过来的再按对方的规矩洗一遍
    note(req, s, `把「${ev.name}」的设置套用到 ${n} 种通知`);
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `消息中心:把「${ev.name}」的设置套用到 ${n} 种通知` };
    return { ...view(req.ctx.shop), copied: n };
  })));
  // 发给我试试(用示例数据和还没保存的设置)
  r.post('/rules/:key/test', wrap(async (req) => {
    needAdmin(req);
    evOf(req.params.key);
    const s = load(req.ctx.shop);
    const me = teamEnabled() && req.ctx.member?.id && !req.ctx.member.testMode ? req.ctx.member.id : null;
    try { return { ok: true, ...(await testSend(s, priceNotify(req.ctx.shop), req.params.key, req.body?.rule || {}, { me, groupId: String(req.body?.group || '') })) }; }
    catch (e) { fail(`没发出去:${e.message}`); }
  }));
  // 通用设置:时区(每天汇总几点、工作时间按哪里的时间算)
  r.put('/settings', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const tz = String(req.body?.tz || ''); if (!TZS[tz]) fail('时区不对');
    const s = load(req.ctx.shop);
    const c = ensureSaved(s, priceNotify(req.ctx.shop));
    if (c.tz !== tz) { c.tz = tz; note(req, s, `时间改成按${TZS[tz]}算`); }
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `消息中心:时间按${TZS[tz]}算` };
    return view(req.ctx.shop);
  })));

  // 飞书群:加 / 删 / 发测试消息
  r.post('/groups', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const s = load(req.ctx.shop);
    let g; try { g = addGroup(s, priceNotify(req.ctx.shop), req.body || {}); } catch (e) { fail(e.message); }
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `消息中心:加了飞书群「${g.name}」` };
    return view(req.ctx.shop);
  })));
  r.delete('/groups/:id', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const s = load(req.ctx.shop);
    let g; try { g = removeGroup(s, priceNotify(req.ctx.shop), req.params.id); } catch (e) { fail(e.message); }
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `消息中心:删了飞书群「${g.name}」(用到它的通知不再发这个群)` };
    return view(req.ctx.shop);
  })));
  r.post('/groups/:id/test', wrap(async (req) => {
    needAdmin(req);
    const g = centerOf(load(req.ctx.shop), priceNotify(req.ctx.shop)).groups.find((x) => x.id === req.params.id) || fail('找不到这个群');
    try { await sendLark({ webhook: g.webhook, secret: g.secret }, { title: '✅ 网站更新中心的通知会发到这个群', color: 'green', lines: [`群名(在消息中心里):**${g.name}**`, '在「消息中心」里给哪些通知勾上这个群,就会发到这里'] }); }
    catch (e) { fail(`没发出去:${e.message}`); }
    req.audit = { mod: 'settings', text: `消息中心:给飞书群「${g.name}」发了测试消息` };
    return { ok: true };
  }));

  // 发送记录
  r.get('/log', wrap(async (req) => {
    needAdmin(req);
    return readNotifyLog(req.ctx.shop, { limit: Math.min(200, Number(req.query.limit) || 100), before: Number(req.query.before) || Infinity, cat: String(req.query.cat || '') });
  }));

  // 「我的通知」:我可能收到哪些(按现在的规则)、哪些关掉了。出问题的关不掉
  const mine = (shop, me) => {
    const s = load(shop); const cfg = centerOf(s, priceNotify(shop));
    const m = (s.members || []).find((x) => x.id === me.id) || me;
    const s0 = { ...s, members: (s.members || []).map((x) => (x.id === m.id ? { ...x, notifyMute: [] } : x)) };
    return {
      events: eventsOn(s).filter((ev) => cfg.rules[ev.key]?.on && cfg.rules[ev.key].via.dm).map((ev) => {
        // 我在不在收件人里:当成「和我有关」那样算一遍(相关的人 / 同部门要看具体哪条通知);做这件事的不是我
        const asRelated = recipients(s0, cfg, { ev: ev.key, related: [m.id], approvers: [m.id], actor: '__other' });
        const fixed = recipients(s0, cfg, { ev: ev.key, related: [], approvers: [], actor: '__other' });
        const reach = fixed?.people.includes(m.id) && !(ev.level !== 'info' && !cfg.rules[ev.key].to.admins && !cfg.rules[ev.key].to.page && !cfg.rules[ev.key].to.roles.length && !cfg.rules[ev.key].to.people.length) ? 'always'
          : asRelated?.people.includes(m.id) ? 'related' : null;
        return reach && { key: ev.key, cat: ev.cat, name: ev.name, desc: ev.desc, level: ev.level, reach, muted: (m.notifyMute || []).includes(ev.key) };
      }).filter(Boolean),
    };
  };
  r.get('/me', wrap(async (req) => {
    if (!req.ctx.member?.id) return { events: [], team: false };
    return { ...mine(req.ctx.shop, req.ctx.member), team: teamEnabled() };
  }));
  r.put('/me', wrap((req) => withLock(req.ctx.shop, async () => {
    const me = req.ctx.member; if (!me?.id || me.testMode) fail('要用飞书登录后才能改自己的通知');
    const ev = EV[req.body?.key] || fail('没有这种通知');
    if (ev.level !== 'info') fail('出问题和审批的通知不能关(要让相关的人知道)');
    const s = load(req.ctx.shop);
    const m = (s.members || []).find((x) => x.id === me.id) || fail('找不到你的账号');
    const set = new Set(m.notifyMute || []);
    if (req.body.mute) set.add(ev.key); else set.delete(ev.key);
    m.notifyMute = [...set];
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `我的通知:${req.body.mute ? '关掉' : '打开'}「${ev.name}」` };
    return { ...mine(req.ctx.shop, me), team: teamEnabled() };
  })));
  return r;
}
