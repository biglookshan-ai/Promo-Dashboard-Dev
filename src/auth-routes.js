// 飞书登录、当前用户、成员与角色的接口。
//   公开(不用登录):/auth/lark/start(直接开网页时跳飞书)、/auth/lark/callback(飞书跳回来)、/api/auth/config
//   要登录:/api/auth/lark/start(后台里点登录 → 拿授权地址,弹窗打开)、/api/auth/lark/poll(轮询弹窗结果)、/api/me、/api/members、/api/roles
import express from 'express';
import { load, replace } from './schedule-store.js';
import { withLock } from './sync.js';
import { knownShops } from './token-store.js';
import { larkEnabled, authorizeUrl, loginWithCode, issueSession, newLoginState, takeLoginState, finishLoginState, pollLoginState } from './lark-login.js';
import { PAGES, rolesOf, pagesOf, isAdmin, upsertOnLogin, updateMember, saveRoles, MemberError } from './members.js';

const SESSION_KEY = 'cgp-app-session'; // 和 public/auth.js 一致

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
const redirectUri = (req) => `${baseUrl(req)}/auth/lark/callback`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body, script = '') => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f6f8;color:#18181b;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:28px 32px;max-width:420px;text-align:center}h2{margin:0 0 8px;font-size:18px}p{color:#52525b;font-size:14px;margin:6px 0}a{color:#2f5cff}</style></head>
<body><div class="c">${body}</div>${script ? `<script>${script}</script>` : ''}</body></html>`;

// 直接开网页时用哪家店:环境变量指定,否则用唯一授权过的那家
const defaultShop = () => process.env.SHOPIFY_SHOP || knownShops()[0] || null;

export function publicAuthRouter() {
  const r = express.Router();
  r.get('/lark/start', (req, res) => {
    if (!larkEnabled()) return res.status(400).send(page('未开启', '<h2>飞书登录还没开启</h2><p>管理员需要先在 Railway 填好飞书应用的 App ID 和 App Secret。</p>'));
    const shop = defaultShop();
    if (!shop) return res.status(400).send(page('请先从后台打开', '<h2>还不能直接打开</h2><p>请先从 Shopify 后台 → 应用里打开一次「网站更新中心」,之后就能直接开网页登录。</p>'));
    res.redirect(authorizeUrl(redirectUri(req), newLoginState({ shop, fromAdmin: false, mode: 'web' })));
  });

  r.get('/lark/callback', async (req, res) => {
    const id = String(req.query.state || '');
    const st = takeLoginState(id);
    if (!st) return res.send(page('登录已过期', '<h2>登录已过期</h2><p>请回到网站更新中心,重新点「用飞书登录」。</p>'));
    if (req.query.error || !req.query.code) return res.send(page('没有登录', '<h2>没有完成授权</h2><p>可以关掉这个窗口,回到网站更新中心重新登录。</p>'));
    try {
      const user = await loginWithCode(String(req.query.code), redirectUri(req));
      const member = await withLock(st.shop, async () => {
        const s = load(st.shop);
        // 只认第一位管理员所在的飞书企业(自建应用本来就只有本企业的人能授权,这里再加一道)
        if (s.larkTenant && user.tenantKey && s.larkTenant !== user.tenantKey) throw new Error('只有本公司飞书里的人能登录');
        const m = upsertOnLogin(s, user, { fromAdmin: st.fromAdmin });
        if (!s.larkTenant && user.tenantKey && isAdmin(m)) s.larkTenant = user.tenantKey;
        replace(st.shop, s);
        return { ...m };
      });
      const session = issueSession({ uid: member.id, shop: st.shop });
      const hello = member.status === 'active' ? '' : '<p>你是第一次登录,管理员给你分配角色后就能用了。</p>';
      if (st.mode === 'popup') {
        finishLoginState(id, { session });
        return res.send(page('登录成功', `<h2>✅ 已登录:${esc(member.name)}</h2>${hello}<p>这个窗口会自动关闭;没关的话手动关掉即可。</p>`,
          `try{window.opener&&window.opener.postMessage({type:'cgp-login'},location.origin)}catch(e){}setTimeout(function(){window.close()},1200);`));
      }
      return res.send(page('登录成功', `<h2>✅ 已登录:${esc(member.name)}</h2><p>正在打开网站更新中心…</p>`,
        `localStorage.setItem(${JSON.stringify(SESSION_KEY)},${JSON.stringify(session)});location.replace('/');`));
    } catch (e) {
      console.error('[lark-login]', e.message);
      return res.send(page('登录失败', `<h2>登录失败</h2><p>${esc(e.message)}</p><p>回到网站更新中心再试一次;一直不行请把这句话发给管理员。</p>`));
    }
  });
  return r;
}

export const authConfig = (req, res) => res.json({ larkEnabled: larkEnabled() });

export function apiAuthRouter() {
  const r = express.Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e instanceof MemberError ? 400 : 500).json({ error: String(e.message || e) }); }
  };

  // 后台里点「用飞书登录」:必须带 Shopify session token(证明在本店后台里)
  r.post('/auth/lark/start', wrap(async (req) => {
    if (!larkEnabled()) throw new MemberError('飞书登录还没开启');
    if (!req.ctx.fromAdmin) throw new MemberError('请从 Shopify 后台里打开再登录,或直接打开网页登录');
    const state = newLoginState({ shop: req.ctx.shop, fromAdmin: true, mode: 'popup' });
    return { url: authorizeUrl(redirectUri(req), state), state };
  }));
  r.get('/auth/lark/poll', wrap(async (req) => pollLoginState(String(req.query.state || ''), req.ctx.shop)));

  r.get('/me', wrap(async (req) => {
    const s = load(req.ctx.shop);
    const m = req.ctx.member;
    return { larkEnabled: larkEnabled(), fromAdmin: !!req.ctx.fromAdmin, member: m ? { id: m.id, name: m.name, avatar: m.avatar, roles: m.roles, status: m.status } : null,
      admin: isAdmin(m), pages: pagesOf(s, m), roles: rolesOf(s).map((x) => ({ key: x.key, name: x.name })),
      // 管理员才看:有几个新登录的人等着分配角色
      pendingCount: isAdmin(m) ? (s.members || []).filter((x) => x.status === 'pending').length : 0 };
  }));

  // ---- 成员与角色(管理员)----
  const needLogin = (req) => {
    const m = req.ctx.member;
    if (!m) throw new MemberError('请先用飞书登录');
    if (m.status !== 'active') throw new MemberError('等管理员分配角色后才能用');
    return m;
  };
  r.get('/members', wrap(async (req) => {
    const me = needLogin(req); const s = load(req.ctx.shop);
    const list = (s.members || []).map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, roles: m.roles, status: m.status, lastSeen: m.lastSeen, joinedAt: m.joinedAt }));
    return isAdmin(me) ? { members: list, roles: rolesOf(s), pages: PAGES } : { members: list.filter((m) => m.status === 'active').map(({ id, name, avatar }) => ({ id, name, avatar })) };
  }));
  r.put('/members/:id', wrap((req) => withLock(req.ctx.shop, async () => {
    const s = load(req.ctx.shop);
    const me = (s.members || []).find((x) => x.id === needLogin(req).id);
    const m = updateMember(s, me, req.params.id, req.body || {});
    replace(req.ctx.shop, s);
    return { ok: true, member: m };
  })));
  r.put('/roles', wrap((req) => withLock(req.ctx.shop, async () => {
    const s = load(req.ctx.shop);
    const me = (s.members || []).find((x) => x.id === needLogin(req).id);
    const roles = saveRoles(s, me, req.body?.roles || []);
    replace(req.ctx.shop, s);
    return { ok: true, roles };
  })));
  return r;
}
