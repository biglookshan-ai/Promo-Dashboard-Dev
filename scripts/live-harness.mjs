// 本地「正式数据」测试环境:不进 Shopify 后台、不碰真店铺,也能把正式模式整条链路点一遍。
//
//   node scripts/live-harness.mjs        →  http://localhost:4793        (审核人 1001)
//                                          http://localhost:4793/?user=1002 (第二个人,默认编辑)
//
// 三个部分:
//   1. 假 Shopify(4794):内存里的 metaobject 定义 / 条目 / 文件库;主题文件读本地主题 worktree(真实内容);
//      产品数用 scripts/demo-catalog.json(前台公开数据)。GET /__state 可以看写进「店铺」的东西。
//   2. 真的 app 服务器(4795):node src/server.js,用 SHOPIFY_GRAPHQL_ORIGIN 指到假 Shopify,数据放临时目录。
//   3. 入口代理(4793):把页面里的 App Bridge 换成一个假的 window.shopify(签好的 session token + 简易选择器)。
// 启动参数:--no-scopes 模拟「还没加权限」;--fresh 每次清空数据。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME = path.join(os.homedir(), 'Vibe Coding Dev/Shopify Dev/_worktrees/cgp-theme-campaign');
const SHOP = 'harness-test.myshopify.com';
const KEY = 'harness-key', SECRET = 'harness-secret';
const P = { entry: 4793, fake: 4794, app: 4795 };
const args = new Set(process.argv.slice(2));
const DATA = path.join(os.tmpdir(), 'promo-live-harness');
if (args.has('--fresh')) fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

// ---------------- 1. 假 Shopify ----------------
const catPath = path.join(ROOT, 'scripts/demo-catalog.json');
const cat = fs.existsSync(catPath) ? JSON.parse(fs.readFileSync(catPath, 'utf8')) : { products: [], tagCounts: {}, collections: [] };
const store = { defs: {}, objects: {}, files: {}, n: 1000 };
const nid = (type) => `gid://shopify/${type}/${store.n++}`;
const SCOPES = args.has('--no-scopes') ? ['read_products', 'read_themes', 'read_metaobjects', 'read_metaobject_definitions']
  : ['read_products', 'read_themes', 'read_metaobjects', 'read_metaobject_definitions', 'write_metaobject_definitions', 'write_metaobjects', 'write_files'];

function gql(query, v) {
  const q = query.replace(/\s+/g, ' ');
  if (q.includes('accessScopes')) return { currentAppInstallation: { accessScopes: SCOPES.map((handle) => ({ handle })) } };
  if (q.includes('primaryDomain')) return { shop: { name: 'CineGearPro(测试)', myshopifyDomain: SHOP, primaryDomain: { url: 'https://www.cinegearpro.co.uk' } }, currentAppInstallation: { app: { handle: 'promo-dashboard-dev' } } };
  if (q.includes('metaobjectDefinitionByType')) {
    const d = store.defs[v.type];
    return { metaobjectDefinitionByType: d ? { id: d.id, name: d.name, metaobjectsCount: Object.values(store.objects).filter((o) => o.type === v.type).length, capabilities: { publishable: { enabled: true } } } : null };
  }
  if (q.includes('metaobjectDefinitionCreate')) {
    if (!SCOPES.includes('write_metaobject_definitions')) throw new Error('Access denied for metaobjectDefinitionCreate');
    const id = nid('MetaobjectDefinition'); store.defs[v.definition.type] = { id, ...v.definition };
    return { metaobjectDefinitionCreate: { metaobjectDefinition: { id, type: v.definition.type }, userErrors: [] } };
  }
  if (q.includes('metaobjectUpsert')) {
    const { type, handle } = v.handle;
    if (!store.defs[type]) return { metaobjectUpsert: { metaobject: null, userErrors: [{ field: ['handle'], message: `No metaobject definition exists for type "${type}"` }] } };
    const key = `${type}/${handle}`; const o = store.objects[key] || (store.objects[key] = { id: nid('Metaobject'), type, handle, fields: {}, status: 'DRAFT' });
    for (const f of v.metaobject.fields || []) o.fields[f.key] = f.value;
    if (v.metaobject.capabilities?.publishable?.status) o.status = v.metaobject.capabilities.publishable.status;
    return { metaobjectUpsert: { metaobject: { id: o.id, handle, capabilities: { publishable: { status: o.status } } }, userErrors: [] } };
  }
  if (q.includes('metaobjectUpdate')) {
    const o = Object.values(store.objects).find((x) => x.id === v.id);
    if (!o) return { metaobjectUpdate: { metaobject: null, userErrors: [{ message: 'Metaobject does not exist' }] } };
    for (const f of v.metaobject.fields || []) o.fields[f.key] = f.value;
    if (v.metaobject.capabilities?.publishable?.status) o.status = v.metaobject.capabilities.publishable.status;
    return { metaobjectUpdate: { metaobject: { id: o.id, capabilities: { publishable: { status: o.status } } }, userErrors: [] } };
  }
  if (q.includes('metaobjectDelete')) {
    const k = Object.keys(store.objects).find((x) => store.objects[x].id === v.id); if (k) delete store.objects[k];
    return { metaobjectDelete: { deletedId: v.id, userErrors: [] } };
  }
  if (q.includes('themes(first: 1, roles: [MAIN])')) return { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/1', name: 'cinegearpro-2-0-1(本地主题文件)' }] } };
  if (q.includes('theme(id: $id) { files')) {
    return { theme: { files: { nodes: v.f.filter((f) => fs.existsSync(path.join(THEME, f))).map((f) => ({ filename: f, body: { content: fs.readFileSync(path.join(THEME, f), 'utf8') } })) } } };
  }
  if (q.includes('files(first: 25, query')) {
    const m = v.q.match(/^filename:'?([^'*]+)\*'?$/); const base = m ? m[1] : '';
    return { files: { nodes: base ? [{ id: `gid://shopify/MediaImage/${crypto.createHash('md5').update(base).digest('hex').slice(0, 8)}`, fileStatus: 'READY', image: { url: `https://cdn.shopify.com/s/files/1/1258/4351/files/${base}.jpg` } }] : [] } };
  }
  if (q.includes('stagedUploadsCreate')) return { stagedUploadsCreate: { stagedTargets: [{ url: `http://localhost:${P.fake}/__upload`, resourceUrl: `http://localhost:${P.fake}/__uploaded/${store.n++}-${v.input[0].filename}`, parameters: [{ name: 'key', value: 'x' }] }], userErrors: [] } };
  if (q.includes('fileCreate')) {
    const id = nid('MediaImage'); const src = v.files[0].originalSource;
    store.files[id] = { id, url: src.includes('__uploaded') ? `https://cdn.shopify.com/s/files/1/1258/4351/files/${src.split('/').pop().replace(/^\d+-/, '')}` : src };
    return { fileCreate: { files: [{ id }], userErrors: [] } };
  }
  if (q.includes('node(id: $id)')) { const f = store.files[v.id]; return { node: f ? { id: f.id, fileStatus: 'READY', image: { url: f.url } } : null }; }
  if (q.includes('nodes(ids: $ids)')) {
    return { nodes: v.ids.map((id) => { const c = cat.collections.find((x) => `gid://shopify/Collection/${x.id}` === id); return c ? { id, handle: c.handle, title: c.title, productsCount: { count: c.count ?? 0 } } : null; }) };
  }
  if (q.includes('productsCount')) {
    const out = {};
    const count = (query) => {
      if (!query) return cat.products.length;
      const ids = new Set();
      for (const part of query.split(' OR ')) {
        const tm = part.match(/^tag:'(.*)'$/); const im = part.match(/^id:(\d+)$/);
        if (tm) cat.products.filter((p) => p.tags.includes(tm[1].replace(/\\'/g, "'"))).forEach((p) => ids.add(p.id));
        else if (im) ids.add(Number(im[1]));
        else if (part.startsWith('collection_id:')) { const c = cat.collections.find((x) => String(x.id) === part.split(':')[1]); for (let i = 0; i < (c?.count || 0); i++) ids.add(`c${c.id}-${i}`); }
      }
      return ids.size;
    };
    if (q.includes('total: productsCount')) return { total: { count: count(v.q) }, all: { count: count('') } };
    return { productsCount: { count: count(v.q) } };
  }
  if (q.includes('productByIdentifier') || q.includes('product(id: $id)')) {
    const p = cat.products.find((x) => x.handle === v.handle || `gid://shopify/Product/${x.id}` === v.id);
    return { product: p ? { id: `gid://shopify/Product/${p.id}`, title: p.title, handle: p.handle, tags: p.tags, featuredMedia: { preview: { image: { url: p.image } } }, collections: { nodes: [] } } : null };
  }
  throw new Error('假 Shopify 不认识这个查询:' + q.slice(0, 120));
}

http.createServer((req, res) => {
  let body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    if (req.url === '/__state') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ defs: Object.keys(store.defs), objects: Object.values(store.objects) }, null, 1)); }
    if (req.url === '/__upload') { res.writeHead(201); return res.end(); }
    try {
      const { query, variables } = JSON.parse(Buffer.concat(body).toString() || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: gql(query, variables || {}) }));
    } catch (e) {
      console.error('[假 Shopify]', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: e.message }] }));
    }
  });
}).listen(P.fake, () => console.log(`假 Shopify: http://localhost:${P.fake}/__state`));

// ---------------- 2. 真的 app 服务器 ----------------
const app = spawn(process.execPath, ['src/server.js'], {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, PORT: String(P.app), DATA_DIR: DATA, SHOPIFY_API_KEY: KEY, SHOPIFY_API_SECRET: SECRET, SHOPIFY_ADMIN_TOKEN: 'harness-token', SHOPIFY_GRAPHQL_ORIGIN: `http://localhost:${P.fake}` },
});
process.on('exit', () => app.kill());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

// ---------------- 3. 入口代理:假的 App Bridge ----------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionToken(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: KEY, sub, exp: now + 86400, nbf: now - 10, iat: now, jti: crypto.randomUUID() });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const pickC = cat.collections.filter((c) => ['dzofilm-vespid-prime-cine-lens', 'clearance'].includes(c.handle));
const pickP = cat.products.filter((p) => p.tags.includes('New Gear')).slice(0, 2);
const PICK = {
  collection: pickC.map((c) => ({ id: `gid://shopify/Collection/${c.id}`, handle: c.handle, title: c.title })),
  product: pickP.map((p) => ({ id: `gid://shopify/Product/${p.id}`, handle: p.handle, title: p.title, images: p.image ? [{ originalSrc: p.image }] : [] })),
};
const fakeBridge = (user) => `<script>
  // 本地测试用的假 App Bridge:session token 由测试环境签好;选择器用浏览器自带的简单列表
  window.shopify = { idToken: async () => ${JSON.stringify(sessionToken(user))},
    // 模拟 Shopify 选择器:固定返回两个真实的合集 / 产品(数据来自前台公开目录)
    resourcePicker: async ({ type }) => (${JSON.stringify(PICK)})[type] };
</script>`;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const opts = { hostname: 'localhost', port: P.app, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${P.app}` } };
  const up = http.request(opts, (r) => {
    if ((u.pathname === '/' || u.pathname === '/index.html') && req.method === 'GET') {
      let html = ''; r.on('data', (c) => { html += c; }); r.on('end', () => {
        html = html.replace(/<script src="https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js"[^>]*><\/script>/, fakeBridge(u.searchParams.get('user') || '1001'))
          .replace(/<ui-nav-menu>[\s\S]*?<\/ui-nav-menu>/, '');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html);
      });
    } else { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
  });
  up.on('error', () => { res.writeHead(502); res.end('app 服务器还没起来,几秒后刷新'); });
  req.pipe(up);
}).listen(P.entry, () => console.log(`本地正式数据测试环境: http://localhost:${P.entry}  (?user=1002 = 第二个人)`));
