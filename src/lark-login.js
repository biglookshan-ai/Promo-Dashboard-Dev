// 飞书(Lark 国际版)网页登录 + app 自己的登录会话。
//   - 应用凭证只从环境变量 LARK_APP_ID / LARK_APP_SECRET 读(用户在 Railway 里填),不进代码、不写日志。
//   - 登录流程:授权页 → 回调拿 code → 换用户 token → 读用户信息(open_id、名字、头像)→ 发 app 会话。
//   - app 会话 = 签名的短字符串(30 天),浏览器存着、每次请求放在 X-App-Session 头里。
//     签名密钥由 SHOPIFY_API_SECRET 派生(不新增要保管的密钥;换了 Shopify 密钥所有人需要重新登录)。
import crypto from 'node:crypto';

const DOMAIN = process.env.LARK_DOMAIN === 'feishu'
  ? { open: 'https://open.feishu.cn', accounts: 'https://accounts.feishu.cn' }
  : { open: 'https://open.larksuite.com', accounts: 'https://accounts.larksuite.com' };
// 只给本地测试环境用(scripts/live-harness.mjs 的假飞书);线上不设
const OPEN = process.env.LARK_OPEN_ORIGIN || DOMAIN.open;
const ACCOUNTS = process.env.LARK_ACCOUNTS_ORIGIN || DOMAIN.accounts;

export const larkEnabled = () => !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);

export function authorizeUrl(redirectUri, state) {
  const q = new URLSearchParams({ client_id: process.env.LARK_APP_ID, redirect_uri: redirectUri, response_type: 'code', state });
  return `${ACCOUNTS}/open-apis/authen/v1/authorize?${q}`;
}

async function call(path, init) {
  const r = await fetch(OPEN + path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code != null && j.code !== 0)) throw new Error(`飞书返回错误:${j.msg || j.error_description || j.error || r.status}`);
  return j;
}

// code → 用户信息 { openId, unionId, name, avatar, tenantKey }
export async function loginWithCode(code, redirectUri) {
  const tok = await call('/open-apis/authen/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: process.env.LARK_APP_ID, client_secret: process.env.LARK_APP_SECRET, code, redirect_uri: redirectUri }),
  });
  if (!tok.access_token) throw new Error('飞书没有返回登录凭证');
  const info = await call('/open-apis/authen/v1/user_info', { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const d = info.data || {};
  if (!d.open_id) throw new Error('飞书没有返回用户信息');
  return { openId: d.open_id, unionId: d.union_id || '', name: d.name || d.en_name || '', avatar: d.avatar_url || d.avatar_thumb || '', tenantKey: d.tenant_key || '' };
}

// ---------- app 会话 ----------
const DAY = 86400_000;
const key = () => crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET || 'local-dev').update('cgp-app-session-v1').digest();
const b64 = (s) => Buffer.from(s).toString('base64url');

export function issueSession({ uid, shop }, now = Date.now()) {
  const p = b64(JSON.stringify({ uid, shop, iat: now, exp: now + 30 * DAY }));
  return `${p}.${crypto.createHmac('sha256', key()).update(p).digest('base64url')}`;
}
export function verifySession(token, now = Date.now()) {
  const [p, sig] = String(token || '').split('.');
  if (!p || !sig) return null;
  const want = crypto.createHmac('sha256', key()).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > now && d.uid && d.shop ? d : null;
  } catch { return null; }
}

// ---------- 登录中的 state(一次性,10 分钟内有效)----------
// mode:'popup'(从 Shopify 后台里点登录,弹窗完成飞书授权)/ 'web'(直接开网页,整页跳转)
//
// 弹窗模式的防冒充:登录结果不会交给「谁发起的就给谁」。飞书授权完成后,弹窗页显示一个 6 位验证码,
// 必须在发起登录的那个窗口里输入(正常情况由弹窗自动传回去,用户无感)。
// 这样即使有人把自己发起的登录链接发给别人点,也拿不到对方的身份 —— 他看不到对方屏幕上的验证码。
const pending = new Map();
const MAX_TRIES = 5;
export function newLoginState({ shop, fromAdmin, mode }) {
  const id = crypto.randomBytes(18).toString('base64url');
  pending.set(id, { shop, fromAdmin: !!fromAdmin, mode, at: Date.now(), result: null, code: null, tries: 0 });
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
  return id;
}
export const takeLoginState = (id) => pending.get(id) || null;
// 飞书授权完成:记下结果,返回给弹窗页显示的验证码
export function finishLoginState(id, result) {
  const s = pending.get(id); if (!s) return null;
  s.result = result; s.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return s.code;
}
// 发起窗口查进度(只告诉「完成没有」,不给会话)
export function loginStatus(id, shop) {
  const s = pending.get(id);
  if (!s || s.shop !== shop) return { done: false, gone: true };
  return { done: !!s.result };
}
// 发起窗口用验证码换会话;输错 5 次作废
export function redeemLoginState(id, shop, code) {
  const s = pending.get(id);
  if (!s || s.shop !== shop) return { error: '登录已过期,请重新点「用飞书登录」' };
  if (!s.result) return { error: '还没在飞书完成登录' };
  if (String(code || '').trim() !== s.code) {
    s.tries++;
    if (s.tries >= MAX_TRIES) { pending.delete(id); return { error: '验证码错太多次,请重新登录' }; }
    return { error: '验证码不对' };
  }
  pending.delete(id);
  return { session: s.result.session };
}
