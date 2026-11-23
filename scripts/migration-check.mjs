// 仅导入纯函数，绝不启动执行器，也不保存任何业务文件。
import fs from 'node:fs';
import path from 'node:path';
import { decide, isLive, planStatus, planWork, samePair, syncCampaignTimes, sweep } from '../src/price/price-core.js';
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const dir = path.resolve(arg('--data', process.env.DATA_DIR || '.data'));
const shop = arg('--shop', 'cinegearpro.myshopify.com');
if (!/^[a-z0-9.-]+\.myshopify\.com$/.test(shop)) throw new Error('店铺域名无效');
const original = fs.readFileSync(path.join(dir, 'price', `${shop}.json`), 'utf8');
const state = JSON.parse(original);
const schedule = JSON.parse(fs.readFileSync(path.join(dir, 'schedule', `${shop}.json`), 'utf8'));
const now = Date.now();
const count = (xs, key) => Object.fromEntries([...new Set(xs.map(key))].map((k) => [k, xs.filter((x) => key(x) === k).length]));
const moved = syncCampaignTimes(state, schedule.campaigns || []);
const boundaries = state.plans.filter(isLive).flatMap((p) => (p.slots || []).flatMap((s) => ['start', 'end'].filter((k) => s[k] > now).map((k) => ({ at: new Date(s[k]).toISOString(), plan: p.name, event: k })))).sort((a, b) => a.at.localeCompare(b.at));
const report = { checkedAt: new Date(now).toISOString(), source: 'supplied-snapshot-not-live-database', shop, plans: state.plans.length, statuses: count(state.plans, (p) => planStatus(p, now)), vault: Object.keys(state.vault).length, pendingIntents: Object.values(state.vault).filter((v) => v.intent).length, existingHolds: Object.values(state.vault).filter((v) => v.hold).length, campaignTimeChanges: moved.length, nextBoundaries: boundaries.slice(0, 20), shopifyReadOnly: false, mutationsSent: 0, cutoverApproved: false };
if (args.includes('--shopify-read-only')) {
  const token = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'))[shop];
  if (!token) throw new Error('备份中缺少店铺授权');
  const ops = planWork(state, now);
  const ids = [...new Set([...ops.map((o) => o.variantId), ...Object.keys(state.vault)])];
  const current = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const r = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || '2026-07'}/graphql.json`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query: 'query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id price compareAtPrice product{id}}}}', variables: { ids: ids.slice(i, i + 100) } }) });
    const json = await r.json();
    if (!r.ok || json.errors) throw new Error(`只读价格查询失败：HTTP ${r.status}（详情未输出以保护凭证）`);
    for (const v of json.data.nodes || []) if (v?.id) current.set(v.id, { price: v.price, compareAt: v.compareAtPrice, productId: v.product?.id });
  }
  const d = decide(state, ops, current);
  Object.assign(report, { shopifyReadOnly: true, variantsRequested: ids.length, variantsFound: current.size, unreadableVariantIds: ids.filter((id) => !current.has(id)), vaultPriceMismatches: Object.entries(state.vault).filter(([id, v]) => v.written && current.has(id) && !samePair(current.get(id), v.written)).map(([id, v]) => ({ variantId: id, title: v.title || '', expected: { price: v.written.price, compareAt: v.written.compareAt }, current: current.get(id) })), wouldWrite: d.writes.length, wouldWriteByOperation: count(d.writes, (x) => x.op), wouldHoldOnSweep: sweep(state, current).length, wouldHoldOnPriceChange: d.holds.length, missingInPlannedOperations: d.missing.length, alreadyAtTarget: d.done.length });
}
// 内存内的活动时间联动与计算结果均丢弃；原始文件不变。
report.snapshotBytesUnchanged = fs.readFileSync(path.join(dir, 'price', `${shop}.json`), 'utf8') === original;
const output = JSON.stringify(report, null, 2) + '\n';
if (arg('--output')) fs.writeFileSync(arg('--output'), output, { mode: 0o600 });
console.log(output);
