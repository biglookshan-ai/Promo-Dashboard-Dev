// 飞书群机器人(自定义机器人 webhook)。地址和签名密钥由用户在「设置」里填,存在数据卷,不进代码仓库。
// 文档:开放平台「自定义机器人使用指南」—— 开了签名校验时,要带 timestamp + sign。
import crypto from 'node:crypto';

export function larkSign(secret, timestamp) {
  return crypto.createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

export const isLarkWebhook = (url) => /^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(String(url || '').trim());

// 卡片(消息中心 src/notify-catalog.js 拼好的):{ title, color, rows: [{ label, value } | { label, list }], line?, buttons: [{ text, url }], at?: [open_id] }
// 老写法 { title, color, lines: [markdown…], button?: { text, url } } 照样能用。短的信息两个一行(飞书卡片的 fields),长的 / 清单单独一段。
export const SHORT = 26; // 页面预览(public/notify.js)用同一个长度判断
export function buildCard({ title, color = 'blue', rows = [], line, lines = [], button, buttons, at = [] }) {
  const md = (content) => ({ tag: 'div', text: { tag: 'lark_md', content } });
  const elements = []; let shorts = [];
  const flush = () => { if (shorts.length) elements.push({ tag: 'div', fields: shorts.map((r) => ({ is_short: true, text: { tag: 'lark_md', content: `**${r.label}**\n${r.value}` } })) }); shorts = []; };
  for (const r of rows) {
    if (r.list) { flush(); elements.push(md(`${r.label ? `**${r.label}**\n` : ''}${r.list.map((x) => `· ${x}`).join('\n')}`)); }
    else if (String(r.value).length <= SHORT) shorts.push(r);
    else { flush(); elements.push(md(`**${r.label}**:${r.value}`)); }
  }
  flush();
  if (line) elements.push(md(line));
  if (lines.filter(Boolean).length) elements.push(md(lines.filter(Boolean).join('\n')));
  if (at.length) elements.push(md(at.map((id) => `<at id=${id}></at>`).join(' ')));
  const btns = (buttons || (button ? [button] : [])).filter((b) => b?.url);
  if (btns.length) elements.push({ tag: 'action', actions: btns.map((b, i) => ({ tag: 'button', text: { tag: 'plain_text', content: b.text }, type: i === 0 ? 'primary' : 'default', url: b.url })) });
  if (!elements.length) elements.push(md(' '));
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
