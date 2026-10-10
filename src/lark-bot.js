// 飞书机器人私信(v3):用同一个飞书自建应用的身份,把通知直接发给某个人(按飞书 open_id)。
// 需要应用开了「机器人」能力和 im:message:send_as_bot 权限,且收信人在应用的可用范围里。
// 凭证只从环境变量读(LARK_APP_ID / LARK_APP_SECRET),不写日志。群里的汇总仍走群机器人 webhook(src/lark.js)。
import { buildCard } from './lark.js';
import { larkEnabled } from './lark-login.js';

const OPEN = process.env.LARK_OPEN_ORIGIN || (process.env.LARK_DOMAIN === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com');
let cached = null;

async function tenantToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const r = await fetch(`${OPEN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`飞书应用凭证不可用:${j.msg || r.status}`);
  cached = { token: j.tenant_access_token, exp: Date.now() + (j.expire || 3600) * 1000 };
  return cached.token;
}

export const botEnabled = larkEnabled;

export async function sendDM(openId, card) {
  const token = await tenantToken();
  const r = await fetch(`${OPEN}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receive_id: openId, msg_type: 'interactive', content: JSON.stringify(buildCard(card)) }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.code !== 0) throw new Error(`飞书私信没发出去:${j.msg || r.status}`);
}

// 发给一群人(去重);返回失败的 [{ to, message }],不抛错
export async function sendDMs(openIds, card) {
  if (!larkEnabled()) return [];
  const ids = [...new Set((openIds || []).filter(Boolean))];
  const res = await Promise.allSettled(ids.map((id) => sendDM(id, card)));
  return res.map((r, i) => (r.status === 'rejected' ? { to: ids[i], message: r.reason?.message || String(r.reason) } : null)).filter(Boolean);
}
