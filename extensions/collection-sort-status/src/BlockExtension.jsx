// Shopify 后台 Collection 页面上的「CGP 排序」卡片。
// 只负责画:徽章 / 几行字 / 按钮都由 app 服务器的 /api/ext/collection-status 给(src/col-status.js)。
// fetch 用相对地址 = app 的网址,Shopify 自动带上身份凭证;按钮用 app:<网址> 打开 app 里对应的页面。
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

// 时间按看的人电脑的时区显示(和 app 页面一样):{{t:毫秒}} → 11/20 00:00
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const d = new Date(Number(ms)); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fill = (s) => String(s || '').replace(/\{\{t:(\d+)\}\}/g, (_, ms) => fmt(ms));
const appHref = (path) => `app:${String(path || '').replace(/^\//, '')}`;

function Extension() {
  const cid = String(shopify.data.selected?.[0]?.id || '').split('/').pop();
  const [card, setCard] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/ext/collection-status?id=${encodeURIComponent(cid)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setCard(j);
    } catch (e) {
      setErr(String(e?.message || e));
    }
    setBusy(false);
  }
  useEffect(() => { if (cid) load(); }, [cid]);

  return (
    <s-admin-block heading="CGP 排序" collapsedSummary={card ? card.badge.text : ''}>
      <s-stack direction="block" gap="base">
        {busy && !card && <s-paragraph color="subdued">正在读排序状态…</s-paragraph>}
        {err && (
          <s-stack direction="block" gap="small-100">
            <s-paragraph tone="critical">暂时读不到排序状态:{err}</s-paragraph>
            <s-stack direction="inline" gap="small-100">
              <s-button onClick={load} loading={busy}>再试一次</s-button>
              <s-button href={appHref(`/pins/collection/${cid}`)}>在 app 里打开</s-button>
            </s-stack>
          </s-stack>
        )}
        {card && !err && (
          <s-stack direction="block" gap="small-100">
            <s-stack direction="inline" gap="small-100" alignItems="center">
              <s-badge tone={card.badge.tone}>{card.badge.text}</s-badge>
            </s-stack>
            {card.lines.map((l, i) => (
              <s-paragraph key={i} tone={l.tone || undefined} color={l.color || undefined}>{fill(l.text)}</s-paragraph>
            ))}
          </s-stack>
        )}
        {card && !err && card.buttons.length > 0 && (
          <s-stack direction="inline" gap="small-100">
            {card.buttons.map((b, i) => (
              <s-button key={i} href={appHref(b.path)}>{b.label}</s-button>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-admin-block>
  );
}
