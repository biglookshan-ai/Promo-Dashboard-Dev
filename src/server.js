import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireSession } from './auth-embedded.js';
import { clearToken } from './token-store.js';
import { runInventory } from './inventory.js';
import { getCached, setCached } from './inventory-cache.js';
import { buildRegistry } from './registry.js';
import { scanTheme } from './theme-scan.js';
import { getAll as getAnnotations, setOne as setAnnotation } from './annotations.js';
import { resourcesWithMetafield, metaobjectEntriesWithRefs } from './drilldown.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- tiny .env loader (Railway injects vars directly; this is for local dev) ---
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const API_KEY = process.env.SHOPIFY_API_KEY || '';
const app = express();
app.use(express.json({ limit: '2mb' }));

// Allow the app to be framed by Shopify admin (required for embedded apps).
app.use((req, res, next) => {
  const shop = (req.query.shop || '').toString();
  const frame = shop ? `https://${shop} https://admin.shopify.com` : 'https://*.myshopify.com https://admin.shopify.com';
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frame};`);
  next();
});

// Serve the embedded UI with the API key injected (App Bridge needs it).
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
function sendIndex(req, res) {
  res.set('Content-Type', 'text/html').send(indexHtml.replaceAll('%%API_KEY%%', API_KEY));
}
app.get('/', sendIndex);
app.get('/index.html', sendIndex);
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (req, res) =>
  res.json({ apiKey: API_KEY, version: process.env.SHOPIFY_API_VERSION || '2026-04' })
);

// Everything below requires a valid App Bridge session token.
const api = express.Router();
api.use(requireSession());
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { console.error(e); res.status(500).json({ error: String(e.message || e) }); }
};

// Returns the cached result instantly; ?refresh=1 forces a fresh scan and re-caches.
api.get('/inventory', wrap(async (req) => {
  if (req.query.refresh !== '1') {
    const cached = getCached(req.ctx.shop);
    if (cached) { console.log('[inventory] cache HIT', req.ctx.shop); return { ...cached, cached: true }; }
    console.log('[inventory] cache MISS → scanning', req.ctx.shop);
  } else {
    console.log('[inventory] refresh requested → scanning', req.ctx.shop);
  }
  const data = await runInventory(req.ctx);
  setCached(req.ctx.shop, data);
  return { ...data, cached: false };
}));
// ---- 元数据总账 ----
// 定义 + 计数走 API(秒出);主题扫描需要 read_themes,没权限时降级(少一列,不报错)。
api.get('/registry', wrap(async (req) => {
  if (req.query.refresh !== '1') {
    const cached = getCached(req.ctx.shop, 'registry');
    // 旧版本写的缓存没有 store 字段(前端拼深链要用),结构不对就当没命中重建。
    if (cached && cached.store) {
      console.log('[registry] cache HIT', req.ctx.shop);
      return { ...cached, annotations: getAnnotations(req.ctx.shop), cached: true };
    }
    console.log('[registry] cache MISS/过期结构 → building', req.ctx.shop);
  } else {
    console.log('[registry] refresh requested', req.ctx.shop);
  }

  const scan = await scanTheme(req.ctx, { themeId: req.query.themeId || null });
  // buildRegistry 已把命中的文件/行号直接写进每一行的 themeUsage,
  // 所以原始索引(Map)不用进缓存,省体积。
  const data = await buildRegistry(req.ctx, { themeIndex: scan.ok ? scan : null });
  data.themeScanError = scan.ok ? null : scan.reason;
  data.themes = scan.ok ? scan.themes : [];
  setCached(req.ctx.shop, data, 'registry');
  return { ...data, annotations: getAnnotations(req.ctx.shop), cached: false };
}));

// 钻取:按需查,不缓存(数据要实时,量也不大)
api.get('/drill/metafield', wrap(async (req) => {
  const { ownerType, namespace, key } = req.query;
  if (!ownerType || !namespace || !key) throw new Error('缺少 ownerType / namespace / key');
  return resourcesWithMetafield(req.ctx, { ownerType, namespace, key });
}));
api.get('/drill/metaobject', wrap(async (req) => {
  if (!req.query.type) throw new Error('缺少 type');
  return metaobjectEntriesWithRefs(req.ctx, { type: req.query.type });
}));

api.get('/annotations', wrap(async (req) => ({ annotations: getAnnotations(req.ctx.shop) })));
api.put('/annotations', wrap(async (req) => {
  const { key, purpose, project, status } = req.body || {};
  if (!key) throw new Error('缺少 key');
  return { key, value: setAnnotation(req.ctx.shop, key, { purpose, project, status }) };
}));

api.post('/reconnect', wrap(async (req) => { clearToken(req.ctx.shop); return { ok: true }; }));

app.use('/api', api);

// SPA fallback for App Bridge nav links.
app.get(/^\/(?!api(?:\/|$)).*/, sendIndex);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`promo-manager (embedded) on :${PORT}`));
