// 本地「正式数据」测试环境:不进 Shopify 后台、不碰真店铺,也能把正式模式整条链路点一遍。
//
//   node scripts/live-harness.mjs        →  http://localhost:4793        (审核人 1001)
//                                          http://localhost:4793/?user=1002 (第二个人,默认编辑)
//
// 三个部分:
//   1. 假 Shopify(4794):内存里的 metaobject 定义 / 条目 / 文件库;主题文件读本地主题 worktree(真实内容);
//      产品数用 scripts/demo-catalog.json(前台公开数据)。GET /__state 可以看写进「店铺」的东西。
//      改价:产品 / 变体价格用 scripts/price-catalog.json(先跑 fetch-price-catalog.mjs);GET /__price 看改过价的,/__price/set?variant=&price= 模拟手动改价;
//      飞书机器人私信记在 GET /__dms。
//   2. 真的 app 服务器(4795):node src/server.js,用 SHOPIFY_GRAPHQL_ORIGIN 指到假 Shopify,数据放临时目录。
//   3. 入口代理(4793):把页面里的 App Bridge 换成一个假的 window.shopify(签好的 session token + 简易选择器)。
// 启动参数:--no-scopes 模拟「还没加权限」;--fresh 每次清空数据;--core-only 模拟只建过第一期 4 个类型的老店铺;
//          --lark 打开飞书登录(假飞书,登录页可选「测试管理员 / 测试员工 / 测试设计」三个身份)。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { priceGql, priceState, priceSet } from './fake-price-shop.mjs';

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
// --core-only:模拟「老店铺已经建过第一期的 4 个类型,还没建首页商品模块的 2 个」(升级场景)
if (args.has('--core-only')) {
  for (const type of ['cgp_campaign', 'cgp_banner_slide', 'cgp_topbar_message', 'cgp_topbar_style']) store.defs[type] = { id: `gid://shopify/MetaobjectDefinition/${store.n++}`, type, name: type };
}
const nid = (type) => `gid://shopify/${type}/${store.n++}`;

// 假飞书(--lark):授权页列出几个测试身份,点哪个就以谁登录;换 token / 读用户信息都在本地
const FAKE_USERS = { ou_admin: '测试管理员', ou_staff: '测试员工', ou_design: '测试设计' };
const DMS = []; // 机器人发出的私信(GET /__dms 查看)
function fakeLark(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/lark-accounts/open-apis/authen/v1/authorize') {
    const back = (id) => `${u.searchParams.get('redirect_uri')}?code=${id}&state=${encodeURIComponent(u.searchParams.get('state'))}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>假飞书登录</title><body style="font-family:sans-serif;padding:30px"><h3>假飞书登录(本地测试)</h3>
      ${Object.entries(FAKE_USERS).map(([id, n]) => `<p><a id="${id}" href="${back(id)}">以「${n}」登录</a></p>`).join('')}
      <p><a href="${u.searchParams.get('redirect_uri')}?error=access_denied&state=${encodeURIComponent(u.searchParams.get('state'))}">取消</a></p></body>`);
  }
  if (u.pathname === '/lark-open/open-apis/authen/v2/oauth/token') {
    const b = JSON.parse(body || '{}');
    return FAKE_USERS[b.code] ? json({ code: 0, access_token: `tok:${b.code}`, expires_in: 7200 }) : json({ code: 20003, msg: 'invalid code' });
  }
  if (u.pathname === '/lark-open/open-apis/auth/v3/tenant_access_token/internal') return json({ code: 0, tenant_access_token: 'tenant-fake', expire: 7200 });
  if (u.pathname === '/lark-open/open-apis/im/v1/messages') {
    const b = JSON.parse(body || '{}'); const card = JSON.parse(b.content || '{}');
    DMS.push({ to: FAKE_USERS[b.receive_id] || b.receive_id, title: card.header?.title?.content, text: card.elements?.[0]?.text?.content });
    return json({ code: 0, data: { message_id: `om_${DMS.length}` } });
  }
  if (u.pathname === '/lark-open/open-apis/authen/v1/user_info') {
    const id = String(req.headers.authorization || '').replace('Bearer tok:', '');
    return json({ code: 0, data: { open_id: id, union_id: `on_${id}`, name: FAKE_USERS[id], avatar_url: '', tenant_key: 'tenant-test' } });
  }
  res.writeHead(404); res.end();
}
// 前台目录里没有价格,按 id 编一个稳定的价格 / 折扣,只给预览用
const fakeProduct = (p) => {
  const price = 100 + (p.id % 900), off = p.id % 3 === 0 ? 0 : 10 + (p.id % 30);
  return { id: `gid://shopify/Product/${p.id}`, title: p.title, handle: p.handle, publishedAt: null, status: 'ACTIVE', featuredMedia: { preview: { image: { url: p.image } } },
    variants: { nodes: [{ price: String(price), compareAtPrice: off ? String(Math.round(price / (1 - off / 100))) : null }] } };
};
const SCOPES = args.has('--no-scopes') ? ['read_products', 'read_themes', 'read_metaobjects', 'read_metaobject_definitions']
  : ['read_products', 'read_themes', 'read_metaobjects', 'read_metaobject_definitions', 'write_metaobject_definitions', 'write_metaobjects', 'write_files', 'write_products', 'read_inventory'];

// 合集成员(有状态):排期系统真的改合集顺序时,改的就是这里 —— 第一次用到时按合集 handle 的关键词凑一组
const colMembers = new Map();
const colMeta = new Map(); // 合集字段(custom.cgp_sort_off 等):`${合集id}:${key}` → { value, type }
const colSortOrder = new Map(); // 合集的排序方式被 app 改过:合集id → sortOrder(没改过 = 按 handle 猜,见下面)
const colOf = (id) => cat.collections.find((x) => `gid://shopify/Collection/${x.id}` === String(id));
// 排序方式:app 改过的用改过的;否则 clearance 按最畅销(只能前台排),其余手动
const sortOrderOf = (c) => colSortOrder.get(String(c.id)) || (/clearance/.test(c.handle || '') ? 'BEST_SELLING' : 'MANUAL');
function membersOf(c) {
  const key = `${c.id}`;
  if (!colMembers.has(key)) {
    const k = (c.handle || '').split('-')[0];
    colMembers.set(key, cat.products.filter((p) => p.handle.includes(k)).map((p) => String(p.id)));
  }
  return colMembers.get(key);
}

function gql(query, v) {
  const q = query.replace(/\s+/g, ' ');
  // 合集排序:先认自己的合集(别被改价那套假数据截走)
  if (/collection(Reorder|Add|Remove)Products/.test(q) && colOf(v.id)) {
    const c = colOf(v.id); const ids = membersOf(c);
    const nums = (v.p || []).map((x) => String(x).split('/').pop());
    if (q.includes('collectionReorderProducts')) {
      for (const m of v.moves) { const id = String(m.id).split('/').pop(); const at = ids.indexOf(id); if (at === -1) continue; ids.splice(at, 1); ids.splice(+m.newPosition, 0, id); }
      return { collectionReorderProducts: { job: { id: 'job-1' }, userErrors: [] } };
    }
    if (q.includes('collectionRemoveProducts')) { colMembers.set(`${c.id}`, ids.filter((id) => !nums.includes(id))); return { collectionRemoveProducts: { userErrors: [] } }; }
    for (const id of nums) if (!ids.includes(id)) ids.push(id);
    return { collectionAddProducts: { userErrors: [] } };
  }
  // 合集字段:搜索引擎的「完全按合集顺序」开关 custom.cgp_sort_off
  if (q.includes('metafieldsSet') && v.m?.[0]?.ownerId?.includes('/Collection/')) {
    for (const m of v.m) colMeta.set(`${m.ownerId.split('/').pop()}:${m.key}`, { value: m.value, type: m.type });
    return { metafieldsSet: { metafields: v.m.map((m, i) => ({ id: `gid://shopify/Metafield/${i}` })), userErrors: [] } };
  }
  if (q.includes('metafieldsDelete') && v.m?.[0]?.ownerId?.includes('/Collection/')) {
    for (const m of v.m) colMeta.delete(`${m.ownerId.split('/').pop()}:${m.key}`);
    return { metafieldsDelete: { deletedMetafields: v.m.map((m) => ({ key: m.key })), userErrors: [] } };
  }
  // 联合推广:在 app 里建合集(假店没有「发布」权限 → 走「去后台勾网店」那条路)
  if (q.includes('collectionCreate')) {
    const c = v.c || {}; const id = 990000 + cat.collections.length;
    const handle = String(c.title || 'c').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    cat.collections.push({ id, handle, title: c.title, count: 0 });
    colMembers.set(String(id), []);
    return { collectionCreate: { collection: { id: `gid://shopify/Collection/${id}`, title: c.title, handle }, userErrors: [] } };
  }
  if (q.includes('publications(') && !SCOPES.includes('read_publications')) throw new Error('Access denied for publications field. Required access: `read_publications` access scope.');
  // 合集页平时的默认排序:改合集的排序方式(collectionUpdate → sortOrder)
  if (q.includes('collectionUpdate') && (v.c?.sortOrder) && colOf(v.c.id)) {
    colSortOrder.set(String(colOf(v.c.id).id), v.c.sortOrder);
    return { collectionUpdate: { collection: { id: v.c.id, sortOrder: v.c.sortOrder }, userErrors: [] } };
  }
  // 全部合集的排序设置(合集排序 → 合集默认排序)
  if (q.includes('collections(first: 100') && q.includes('cgp_pin_manual')) {
    const start = v.after ? Number(v.after) : 0;
    const all = [...cat.collections].sort((a, b) => a.title.localeCompare(b.title));
    const nodes = all.slice(start, start + 100).map((c) => { const meta = (k) => colMeta.get(`${c.id}:${k}`) || null;
      return { id: `gid://shopify/Collection/${c.id}`, title: c.title, handle: c.handle, sortOrder: sortOrderOf(c), productsCount: { count: membersOf(c).length }, image: null, // 和 collection(id) 那个假接口同一套成员
        sortOff: meta('cgp_sort_off'), pinManual: meta('cgp_pin_manual'), pinNew: meta('cgp_pin_new') }; });
    return { collections: { nodes, pageInfo: { hasNextPage: start + 100 < all.length, endCursor: String(start + 100) } } };
  }
  // 带条件的合集:改它的「单独加的产品 / 排除」名单(API 2026-07 的 collectionUpdate → sourcesToUpdate)
  if (q.includes('collectionUpdate') && v.c?.sourcesToUpdate && colOf(v.c.id)) {
    const c = colOf(v.c.id); let ids = membersOf(c);
    const cond = v.c.sourcesToUpdate[0].condition;
    for (const part of ['inclusion', 'exclusion']) for (const op of ['selectionsToAdd', 'selectionsToRemove']) {
      for (const x of cond[part]?.[op] || []) {
        const id = String(x.productId).split('/').pop();
        const into = (part === 'inclusion') === (op === 'selectionsToAdd'); // 加进单独产品 / 拿掉排除 → 进合集
        if (into && !ids.includes(id)) ids.push(id);
        if (!into) ids = ids.filter((y) => y !== id);
      }
    }
    colMembers.set(`${c.id}`, ids);
    return { collectionUpdate: { collection: { id: v.c.id }, job: { id: 'job-src', done: true }, userErrors: [] } };
  }
  // 合集排序网格的库存:款式字段 custom.uk_inventory / es_inventory,按产品 id 编个数(有的为 0、有的没有这两个字段)
  if (q.includes('productVariants(first: 100') && q.includes('uk_inventory')) {
    const ids = [...String(v.q || '').matchAll(/product_id:(\d+)/g)].map((m) => m[1]);
    const nodes = ids.map((id) => { const h = [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7); const has = h % 7 !== 0;
      return { product: { id: `gid://shopify/Product/${id}` }, uk_inventory: has ? { value: String(h % 4 === 0 ? 0 : h % 6) } : null, es_inventory: has ? { value: String((h >> 3) % 3) } : null }; });
    return { productVariants: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
  }
  const pr = priceGql(q, v); if (pr !== undefined) return pr; // 改价模块的查询(scripts/fake-price-shop.mjs)
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
  // 促销链接的「页面模板」:正式主题 = 本地主题文件夹;再假装有一个测试主题,多一个 sale-bf 模板
  if (q.includes('themes(first: 20, roles: [MAIN, UNPUBLISHED])')) return { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/1', name: 'cinegearpro-2-0-1(本地主题文件)', role: 'MAIN' }, { id: 'gid://shopify/OnlineStoreTheme/2', name: 'Promo Panel Test(假)', role: 'UNPUBLISHED' }] } };
  if (q.includes('filenames: ["templates/collection.*"]')) {
    const names = fs.readdirSync(path.join(THEME, 'templates')).filter((f) => f.startsWith('collection.')).map((f) => `templates/${f}`);
    if (v.id.endsWith('/2')) names.push('templates/collection.sale-bf.json');
    return { theme: { files: { nodes: names.map((filename) => ({ filename })) } } };
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
    return { nodes: v.ids.map((id) => {
      const c = cat.collections.find((x) => `gid://shopify/Collection/${x.id}` === id);
      if (c) return { id, handle: c.handle, title: c.title, productsCount: { count: c.count ?? 0 } };
      const p = cat.products.find((x) => `gid://shopify/Product/${x.id}` === id);
      return p ? fakeProduct(p) : null;
    }) };
  }
  if (q.includes('collectionByIdentifier')) {
    const c = cat.collections.find((x) => x.handle === v.h);
    return { collectionByIdentifier: c ? { id: `gid://shopify/Collection/${c.id}`, handle: c.handle, title: c.title, productsCount: { count: c.count ?? 0 } } : null };
  }
  if (q.includes('collection(id: $id)')) {
    // 页签预览 / 合集排序:用前台目录里带这个合集名关键词的产品凑一组(假 Shopify 不知道真实成员)
    const c = cat.collections.find((x) => `gid://shopify/Collection/${x.id}` === v.id);
    if (!c) return { collection: null };
    const byId = new Map(cat.products.map((p) => [String(p.id), p]));
    const all = membersOf(c).map((id) => byId.get(id)).filter(Boolean).map(fakeProduct);
    // 本地试三种情况:clearance = 带条件 + 按最畅销排(只能前台排);cinediskpro-sale = 带条件 + 手动排序(Shopify 2026 新版合集,顺序能真的改);
    // 其余 = 纯手动合集(顺序和加减产品都能真的改)
    const automated = /clearance|cinediskpro-sale/.test(c.handle || '');
    const manualSort = sortOrderOf(c) === 'MANUAL';
    const first = Number((q.match(/products\(first: (\d+)/) || [])[1] || 60);
    const start = v.after ? Number(v.after) : 0;
    const nodes = all.slice(start, start + first);
    const sources = automated ? [{ __typename: 'CollectionConditionsSource', id: `gid://shopify/CollectionConditionsSource/${c.id}`, shareable: false, inclusion: { conditions: [{ __typename: 'CollectionSourceInclusionCondition' }] } }] : [];
    const meta = (k) => colMeta.get(`${c.id}:${k}`) || null;
    return { collection: { id: `gid://shopify/Collection/${c.id}`, title: c.title, handle: c.handle, image: null, sortOrder: sortOrderOf(c), ruleSet: automated ? { appliedDisjunctively: false } : null, sources,
      metafield: meta('cgp_sort_off'), sortOff: meta('cgp_sort_off'), pinManual: meta('cgp_pin_manual'), pinNew: meta('cgp_pin_new'),
      productsCount: { count: all.length }, products: { nodes, pageInfo: { hasNextPage: start + first < all.length, endCursor: String(start + first) } } } };
  }
  // 产品页推广块:命中多少 + 前几个(假店没有品牌 / 类型 / 合集成员:品牌 = 标题第一个词,类型按标题猜,合集 = 标题里带合集名的产品)
  const vendorOf = (p) => p.title.split(' ')[0];
  const typeOf = (p) => (/\blens\b|prime|zoom/i.test(p.title) && !/case|filter|adapter/i.test(p.title) ? 'Cine Lens' : /case/i.test(p.title) ? 'Case' : 'Accessory');
  if (/status:active/.test(v.q || '')) {
    const unq = (x) => x.replace(/^'|'$/g, '').replace(/\\'/g, "'").toLowerCase();
    const term = (p, t) => {
      if (t === 'status:active') return true;
      if (t.startsWith('vendor:')) return vendorOf(p).toLowerCase() === unq(t.slice(7));
      if (t.startsWith('product_type:')) return typeOf(p).toLowerCase() === unq(t.slice(13));
      if (t.startsWith('tag:')) return p.tags.some((x) => x.toLowerCase() === unq(t.slice(4)));
      if (t.startsWith('id:')) return String(p.id) === t.slice(3);
      if (t.startsWith('collection_id:')) { const c = cat.collections.find((x) => String(x.id) === t.slice(14)); return !!c && p.title.toLowerCase().includes(c.title.toLowerCase()); }
      return false;
    };
    const match = (query) => cat.products.filter((p) => query.split(' AND ').every((c) => (c.startsWith('NOT ') ? !term(p, c.slice(4)) : c.startsWith('(') ? c.slice(1, -1).split(' OR ').some((t) => term(p, t)) : term(p, c))))
      .sort((x, y) => x.title.localeCompare(y.title));
    const node = (p) => ({ id: `gid://shopify/Product/${p.id}`, title: p.title, handle: p.handle, status: 'ACTIVE' });
    const hits = match(v.q);
    if (q.includes('after: $after')) { const start = Number(v.after || 0); const page = hits.slice(start, start + 250);
      return { products: { nodes: page.map(node), pageInfo: { hasNextPage: start + 250 < hits.length, endCursor: String(start + 250) } } }; }
    if (q.includes('total: productsCount')) return { total: { count: hits.length }, ...(v.hasEx ? { ex: { count: match(v.ex).length } } : {}), products: { nodes: hits.slice(0, v.n).map(node) } };
    return { productsCount: { count: hits.length } };
  }
  for (const [field, list] of [['productVendors', () => cat.products.map(vendorOf)], ['productTypes', () => cat.products.map(typeOf)], ['productTags', () => cat.products.flatMap((p) => p.tags)]]) {
    if (q.includes(`${field}(first`)) return { [field]: { nodes: [...new Set(list())].sort(), pageInfo: { hasNextPage: false, endCursor: null } } };
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
    const p = cat.products.find((x) => x.handle === (v.handle || v.h) || `gid://shopify/Product/${x.id}` === v.id);
    const node = p ? { id: `gid://shopify/Product/${p.id}`, title: p.title, handle: p.handle, tags: p.tags, featuredMedia: { preview: { image: { url: p.image } } }, collections: { nodes: [] } } : null;
    return { product: node, productByIdentifier: node };
  }
  throw new Error('假 Shopify 不认识这个查询:' + q.slice(0, 120));
}

http.createServer((req, res) => {
  let body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    if (req.url.startsWith('/lark-')) return fakeLark(req, res, Buffer.concat(body).toString());
    // 假前台:主题的 cgp-json(促销链接预览读它)。折扣 / 价格和 fakeProduct 一样按 id 编;库存:id 尾数 0-1 缺货、2 预订,其余有货
    const sf = req.url.match(/^\/collections\/([^/?]+)\?view=cgp-json(?:&page=(\d+))?/);
    if (sf) {
      const c = cat.collections.find((x) => x.handle === sf[1]);
      const byId = new Map(cat.products.map((p) => [String(p.id), p]));
      const all = c ? membersOf(c).map((id) => byId.get(id)).filter(Boolean) : [];
      const pg = +(sf[2] || 1), per = 50;
      const products = all.slice((pg - 1) * per, pg * per).map((p) => {
        const price = 100 + (p.id % 900), off = p.id % 3 === 0 ? 0 : 10 + (p.id % 30), cmp = off ? Math.round(price / (1 - off / 100)) : 0;
        return { id: p.id, title: p.title, url: `/products/${p.handle}`, image: p.image, created: 1700000000 + (p.id % 100000), discount: off,
          status: ['oos', 'oos', 'preorder'][p.id % 10] || 'instock', price: price * 100, compare: cmp * 100, price_str: `£${price}.00`, compare_str: cmp ? `£${cmp}.00` : null };
      });
      res.writeHead(c ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ page: pg, pages: Math.max(1, Math.ceil(all.length / per)), total: all.length, products }));
    }
    if (req.url === '/__state') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ defs: Object.keys(store.defs), objects: Object.values(store.objects), colMeta: Object.fromEntries(colMeta), colSortOrder: Object.fromEntries(colSortOrder) }, null, 1)); }
    if (req.url === '/__upload') { res.writeHead(201); return res.end(); }
    // GET /__cols 看现在「店里」各合集的顺序(只列被动过的)
    if (req.url.startsWith('/__cols')) {
      const want = new URL(req.url, 'http://x').searchParams.get('id');
      const byId = new Map(cat.products.map((p) => [String(p.id), p.title]));
      const out = {};
      for (const [cid, ids] of colMembers) if (!want || cid === String(want).split('/').pop()) {
        const c = cat.collections.find((x) => String(x.id) === cid);
        out[c?.handle || cid] = { n: ids.length, sortOff: colMeta.get(`${cid}:cgp_sort_off`)?.value ?? null, first: ids.slice(0, 8).map((id) => byId.get(id) || id) };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(out, null, 1));
    }
    if (req.url === '/__price') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(priceState(), null, 1)); }
    if (req.url.startsWith('/__price/set')) { const r = priceSet(new URL(req.url, 'http://x').searchParams); res.writeHead(r ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(r)); }
    if (req.url === '/__dms') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(DMS, null, 1)); }
    if (req.method !== 'POST' || !req.url.includes('/graphql.json')) { res.writeHead(404); return res.end(); } // 比如浏览器顺带要的 favicon
    try {
      const { query, variables } = JSON.parse(Buffer.concat(body).toString() || '{}');
      const data = gql(query, variables || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
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
  env: { ...process.env, SHOPIFY_API_VERSION: args.has('--old-api') ? '2026-04' : '2026-07', PORT: String(P.app), DATA_DIR: DATA, SHOPIFY_API_KEY: KEY, SHOPIFY_API_SECRET: SECRET, SHOPIFY_ADMIN_TOKEN: 'harness-token', SHOPIFY_SHOP: SHOP, SHOPIFY_GRAPHQL_ORIGIN: `http://localhost:${P.fake}`, STOREFRONT_ORIGIN: `http://localhost:${P.fake}`,
    // 假飞书只在 --lark 时打开(本地测试用的假凭证,和真飞书无关)
    ...(args.has('--lark') ? { LARK_APP_ID: 'harness-lark-app', LARK_APP_SECRET: 'harness-lark-only', TEAM_MODE: 'on', LARK_OPEN_ORIGIN: `http://localhost:${P.fake}/lark-open`, LARK_ACCOUNTS_ORIGIN: `http://localhost:${P.fake}/lark-accounts`, APP_URL: `http://localhost:${P.entry}` } : {}) },
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
const pickC = cat.collections.filter((c) => ['dzofilm-vespid-prime-cine-lens', 'cinediskpro-sale', 'clearance'].includes(c.handle));
// 选产品:两个合集里已有的 + 一个肯定不在 DZOFILM 合集里的(试「合集外的产品」)
const pickP = [...cat.products.filter((p) => p.tags.includes('New Gear')).slice(0, 2), cat.products.find((p) => /blackmagic/i.test(p.handle))].filter(Boolean);
const PICK = {
  collection: pickC.map((c) => ({ id: `gid://shopify/Collection/${c.id}`, handle: c.handle, title: c.title })),
  product: pickP.map((p) => ({ id: `gid://shopify/Product/${p.id}`, handle: p.handle, title: p.title, images: p.image ? [{ originalSrc: p.image }] : [] })),
};
const fakeBridge = (user) => `<script>
  // 本地测试用的假 App Bridge:session token 由测试环境签好;选择器用浏览器自带的简单列表
  window.shopify = { idToken: async () => ${JSON.stringify(sessionToken(user))},
    // 模拟 Shopify 选择器:返回真实的合集 / 产品(数据来自前台公开目录);合集每点一次换下一个,方便试不同情况
    resourcePicker: async ({ type }) => { const L = (${JSON.stringify(PICK)})[type];
      if (type !== 'collection') return L;
      window.__pick = ((window.__pick || 0) + 1) % L.length; return [L[window.__pick]]; } };
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
