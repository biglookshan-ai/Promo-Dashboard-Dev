// 通知中心的接口(挂在 /api/notify)。规则、飞书群、发送记录只给管理员;「我的通知」每个人都能改自己的。
import express from 'express';
import { load, replace, appendLog } from './schedule-store.js';
import { load as loadPrice } from './price/store.js';
import { withLock } from './sync.js';
import { isAdmin, rolesOf } from './members.js';
import { teamEnabled } from './lark-login.js';
import { sendLark } from './lark.js';
import { EV, eventsOn, centerOf, centerView, ensureSaved, cleanRule, addGroup, removeGroup, readNotifyLog, recipients } from './notify-center.js';

class NotifyError extends Error {}
export function notifyRouter() {
  const r = express.Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e instanceof NotifyError || e.expose ? 400 : 500).json({ error: String(e.message || e) }); if (!(e instanceof NotifyError)) console.error('[notify-api]', e); }
  };
  const fail = (m) => { throw new NotifyError(m); };
  // 多人协作关着时打开 app 的人都是管理员(和别的设置一样)
  const needAdmin = (req) => { if (teamEnabled() && !isAdmin(req.ctx.member || {})) fail('只有管理员能改通知规则'); };
  const priceNotify = (shop) => { try { return loadPrice(shop).settings?.notify || {}; } catch { return {}; } };
  const view = (shop) => ({ ...centerView(load(shop), priceNotify(shop)), team: teamEnabled() });

  r.get('/', wrap(async (req) => { needAdmin(req); return view(req.ctx.shop); }));

  // 改一条规则
  r.put('/rules/:key', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const ev = EV[req.params.key] || fail('没有这种通知');
    const s = load(req.ctx.shop);
    const c = ensureSaved(s, priceNotify(req.ctx.shop));
    const before = JSON.stringify(c.rules[ev.key]);
    c.rules[ev.key] = cleanRule(ev, req.body || {}, { groups: c.groups, members: s.members || [], roles: rolesOf(s) });
    if (JSON.stringify(c.rules[ev.key]) !== before) appendLog(s, { at: Date.now(), action: 'edit', kind: 'system', title: '通知中心', note: `改了「${ev.name}」的通知规则`, by: req.ctx.member?.name || '管理员' });
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `通知中心:改了「${ev.name}」的规则` };
    return view(req.ctx.shop);
  })));

  // 飞书群:加 / 删 / 发测试消息
  r.post('/groups', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const s = load(req.ctx.shop);
    let g; try { g = addGroup(s, priceNotify(req.ctx.shop), req.body || {}); } catch (e) { fail(e.message); }
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `通知中心:加了飞书群「${g.name}」` };
    return view(req.ctx.shop);
  })));
  r.delete('/groups/:id', wrap((req) => withLock(req.ctx.shop, async () => {
    needAdmin(req);
    const s = load(req.ctx.shop);
    let g; try { g = removeGroup(s, priceNotify(req.ctx.shop), req.params.id); } catch (e) { fail(e.message); }
    replace(req.ctx.shop, s);
    req.audit = { mod: 'settings', text: `通知中心:删了飞书群「${g.name}」(用到它的通知不再发这个群)` };
    return view(req.ctx.shop);
  })));
  r.post('/groups/:id/test', wrap(async (req) => {
    needAdmin(req);
    const g = centerOf(load(req.ctx.shop), priceNotify(req.ctx.shop)).groups.find((x) => x.id === req.params.id) || fail('找不到这个群');
    try { await sendLark({ webhook: g.webhook, secret: g.secret }, { title: '✅ 网站更新中心的通知会发到这个群', color: 'green', lines: [`群名(在通知中心里):**${g.name}**`, '在「通知中心 → 通知规则」里给哪些通知勾上这个群,就会发到这里'] }); }
    catch (e) { fail(`没发出去:${e.message}`); }
    req.audit = { mod: 'settings', text: `通知中心:给飞书群「${g.name}」发了测试消息` };
    return { ok: true };
  }));

  // 发送记录
  r.get('/log', wrap(async (req) => {
    needAdmin(req);
    return readNotifyLog(req.ctx.shop, { limit: Math.min(200, Number(req.query.limit) || 100), before: Number(req.query.before) || Infinity, mod: String(req.query.mod || '') });
  }));

  // 「我的通知」:我可能收到哪些(按现在的规则)、哪些关掉了。出问题的关不掉
  const mine = (shop, me) => {
    const s = load(shop); const cfg = centerOf(s, priceNotify(shop));
    const m = (s.members || []).find((x) => x.id === me.id) || me;
    return {
      events: eventsOn().filter((ev) => cfg.rules[ev.key]?.on).map((ev) => {
        // 我在不在收件人里:当成「和我有关」那样算一遍(相关的人 / 同部门要看具体哪条通知)
        const asRelated = recipients({ ...s, members: (s.members || []).map((x) => (x.id === m.id ? { ...x, notifyMute: [] } : x)) }, cfg, { ev: ev.key, related: [m.id], approvers: [m.id] });
        const fixed = recipients({ ...s, members: (s.members || []).map((x) => (x.id === m.id ? { ...x, notifyMute: [] } : x)) }, cfg, { ev: ev.key, related: [], approvers: [] });
        const reach = fixed?.people.includes(m.id) ? 'always' : asRelated?.people.includes(m.id) ? 'related' : null;
        return reach && { key: ev.key, mod: ev.mod, name: ev.name, desc: ev.desc, level: ev.level, reach, muted: (m.notifyMute || []).includes(ev.key) };
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
