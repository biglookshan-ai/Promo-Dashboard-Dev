// 飞书群机器人(自定义机器人 webhook)。地址和签名密钥由用户在「设置」里填,存在数据卷,不进代码仓库。
// 文档:开放平台「自定义机器人使用指南」—— 开了签名校验时,要带 timestamp + sign。
import crypto from 'node:crypto';

export function larkSign(secret, timestamp) {
  return crypto.createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

export const isLarkWebhook = (url) => /^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(String(url || '').trim());

// card:{ title, color, lines: [markdown…], button?: { text, url } }
export function buildCard({ title, color = 'blue', lines = [], button }) {
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: lines.filter(Boolean).join('\n') } }];
  if (button?.url) elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: button.text }, type: 'primary', url: button.url }] });
  return { config: { wide_screen_mode: true }, header: { template: color, title: { tag: 'plain_text', content: title } }, elements };
}

export async function sendLark({ webhook, secret }, card, fetchImpl = fetch) {
  if (!isLarkWebhook(webhook)) throw new Error('飞书 webhook 地址格式不对');
  const body = { msg_type: 'interactive', card: buildCard(card) };
  if (secret) { const ts = Math.floor(Date.now() / 1000); body.timestamp = String(ts); body.sign = larkSign(secret, ts); }
  const r = await fetchImpl(webhook.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code ?? j.StatusCode ?? 0) !== 0) throw new Error(`飞书返回错误:${j.msg || j.StatusMessage || r.status}`);
  return true;
}
