// Embedded-app auth: verify the App Bridge session token (a JWT signed with the
// app secret), then OAuth 2.0 Token Exchange to get an Admin API access token.
// Docs: shopify.dev → "Token exchange".
import crypto from 'node:crypto';
import { getToken, setToken } from './token-store.js';

const KEY = process.env.SHOPIFY_API_KEY;
const SECRET = process.env.SHOPIFY_API_SECRET;

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Returns { shop, payload } or throws.
export function verifySessionToken(token) {
  if (!SECRET || !KEY) throw new Error('SHOPIFY_API_KEY / SHOPIFY_API_SECRET not set');
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed session token');
  const [h, p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad signature');
  const payload = JSON.parse(b64urlToBuf(p).toString());
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error('session token expired');
  if (payload.nbf && now < payload.nbf - 5) throw new Error('session token not yet valid');
  if (payload.aud !== KEY) throw new Error('aud mismatch');
  const shop = String(payload.dest || '').replace(/^https?:\/\//, '');
  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) throw new Error('bad dest/shop');
  return { shop, payload };
}

// Get an offline access token for the shop (cached), via token exchange.
export async function getAccessToken(shop, sessionToken) {
  const cached = getToken(shop);
  if (cached) return cached;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: KEY,
      client_secret: SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(j)}`);
  setToken(shop, j.access_token);
  return j.access_token;
}

// Express middleware: Authorization: Bearer <session token> → req.ctx = { shop, token }
export function requireSession() {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const sessionToken = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!sessionToken) return res.status(401).json({ error: 'Missing session token', needsAuth: true });
      const { shop, payload } = verifySessionToken(sessionToken);
      const token = process.env.SHOPIFY_ADMIN_TOKEN || await getAccessToken(shop, sessionToken);
      // user = 正在操作的 Shopify 员工 id(session token 的 sub),排期系统用它认人、分审核人 / 编辑
      req.ctx = { shop, token, user: payload.sub ? String(payload.sub) : null };
      next();
    } catch (e) {
      res.status(401).json({ error: String(e.message || e), needsAuth: true });
    }
  };
}

// ---------------- v3:飞书登录后的访问控制 ----------------
// 两种进入方式:
//   ① 在 Shopify 后台里打开:有 Shopify session token(证明是本店后台)+ app 会话(证明是谁)
//   ② 直接开网页:只有 app 会话;店铺授权用之前在后台里换到并存下的那份
// 没配飞书(LARK_APP_ID / LARK_APP_SECRET 没填)时完全按旧方式:只认 Shopify session token。
import { larkEnabled, verifySession } from './lark-login.js';
import { load as loadSchedule } from './schedule-store.js';
import { canSee, testModeOn, TEST_MEMBER } from './members.js';

export function requireAccess() {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const st = h.startsWith('Bearer ') ? h.slice(7) : '';
      let shop = null, token = null, sub = null;
      if (st) {
        const v = verifySessionToken(st);
        shop = v.shop; sub = v.payload.sub ? String(v.payload.sub) : null;
        token = process.env.SHOPIFY_ADMIN_TOKEN || await getAccessToken(shop, st);
      }
      if (!larkEnabled()) {
        if (!shop) return res.status(401).json({ error: 'Missing session token', needsAuth: true });
        req.ctx = { shop, token, user: sub, fromAdmin: true };
        return next();
      }
      const sess = verifySession(req.headers['x-app-session']);
      if (!shop && sess) {
        shop = sess.shop;
        token = process.env.SHOPIFY_ADMIN_TOKEN || getToken(shop);
        if (!token) return res.status(401).json({ error: '店铺授权失效,请从 Shopify 后台打开一次 app', needsAuth: true });
      }
      if (!shop) return res.status(401).json({ error: '请先用飞书登录', needLogin: true });
      req.ctx = { shop, token, user: null, member: null, fromAdmin: !!st };
      const sdata = loadSchedule(shop);
      if (sess && sess.shop === shop) {
        const m = (sdata.members || []).find((x) => x.id === sess.uid);
        if (m) { req.ctx.user = m.id; req.ctx.member = m; }
      }
      // 测试模式:只有**从 Shopify 后台里**打开(有店铺后台凭证)才算,直接开网址的照样要登录
      if (!req.ctx.member && st && testModeOn(sdata)) { req.ctx.member = { ...TEST_MEMBER }; req.ctx.user = TEST_MEMBER.id; req.ctx.testMode = true; }
      next();
    } catch (e) {
      res.status(401).json({ error: String(e.message || e), needsAuth: true });
    }
  };
}

// 飞书模式下:必须是已登录、已启用的成员;可指定页面权限
export function needMember(page) {
  return (req, res, next) => {
    if (!larkEnabled()) return next();
    const m = req.ctx.member;
    if (!m) return res.status(401).json({ error: '请先用飞书登录', needLogin: true });
    if (m.status !== 'active') return res.status(403).json({ error: m.status === 'disabled' ? '你的账号已被管理员停用' : '已登录,等管理员分配角色', pending: true });
    if (page && !canSee(loadSchedule(req.ctx.shop), m, page)) return res.status(403).json({ error: '你没有这个页面的权限' });
    next();
  };
}
