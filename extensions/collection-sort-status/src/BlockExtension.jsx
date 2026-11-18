// Shopify 后台 Collection 页面上的「产品排序」卡片。
// 只负责画:角标 / 状态字段 / 按钮都由 app 服务器的 /api/ext/collection-status 给(src/col-status.js),改说法不用重新部署扩展。
// 一行 = { label, value, tone?, parts?(一行里分段上色,比如排序计划的「(生效中)」), segs?(网站显示按位置分段) }
// fetch 用相对地址 = app 的网址,Shopify 自动带上身份凭证;按钮用 app:<网址> 打开 app 里对应的页面(一键同步也是打开 app 再确认,权限按 app 的部门档位)。
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

// 一行的值:分段(网站显示)/ 分段上色(排序计划)/ 一段字
function Value({ r }) {
  if (r.segs?.length) {
    return (
      <s-grid gridTemplateColumns="auto 1fr" columnGap="small-300" rowGap="small-500">
        {r.segs.flatMap((s, i) => [
          <s-text key={`k${i}`} color="subdued">{s.k}</s-text>,
          <s-text key={`v${i}`} tone={s.tone || undefined}>{fill(s.v)}</s-text>,
        ])}
      </s-grid>
    );
  }
  if (r.parts?.length) {
    return (
      <s-paragraph>
        {r.parts.map((p, i) => <s-text key={i} tone={p.tone || undefined} color={p.color || undefined}>{fill(p.t)}</s-text>)}
      </s-paragraph>
    );
  }
  return <s-text tone={r.tone || undefined}>{fill(r.value)}</s-text>;
}

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

  // 服务器给 rows;万一是老服务器只给 lines,就一行一句
  const rows = card?.rows || (card?.lines || []).map((l) => ({ label: '', value: l.text, tone: l.tone }));
  return (
    <s-admin-block heading={card?.heading || '产品排序'} collapsedSummary={card ? card.badge.text : ''}>
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
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small-100" alignItems="center">
              <s-badge tone={card.badge.tone}>{card.badge.text}</s-badge>
            </s-stack>
            <s-grid gridTemplateColumns="auto 1fr" columnGap="base" rowGap="small-200" alignItems="start">
              {rows.flatMap((r, i) => [
                <s-text key={`l${i}`} color="subdued">{r.label}</s-text>,
                <Value key={`v${i}`} r={r} />,
              ])}
            </s-grid>
          </s-stack>
        )}
        {card && !err && card.buttons.length > 0 && (
          <s-stack direction="inline" gap="small-100">
            {card.buttons.map((b, i) => (
              <s-button key={i} href={appHref(b.path)} variant={b.primary ? 'primary' : undefined}>{b.label}</s-button>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-admin-block>
  );
}
