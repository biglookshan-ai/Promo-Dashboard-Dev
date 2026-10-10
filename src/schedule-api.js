// 排期系统的后台接口(挂在 /api/schedule 下,都要 App Bridge session token)。
import express from 'express';
import { load, update, replace, appendLog } from './schedule-store.js';
import { applyAction, ActionError, findItem, LIST } from './schedule-actions.js';
import { performAction, withLock, runEffects } from './sync.js';
import { grantedScopes, missingScopes, definitionStatus, ensureDefinitions, REQUIRED_SCOPES } from './metaobjects.js';
import { schedulerInfo } from './scheduler.js';
import { readMainTheme, buildImport } from './theme-import.js';
import { uploadImage } from './files.js';
import { scopeCounts, productCampaigns, tabProducts } from './counts.js';
import { sendLark, isLarkWebhook } from './lark.js';
import { graphql } from './shopify.js';
import { actorOf } from './members.js';
import { larkEnabled } from './lark-login.js';

// 当前运行的版本(Railway 会自动带上部署的提交号),方便确认新代码已经上线
const APP_VERSION = { commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || 'local', startedAt: Date.now() };
const cache = new Map(); // `${shop}:${name}` → { at, value }
async function cached(shop, name, ms, fn) {
  const k = `${shop}:${name}`; const c = cache.get(k);
  if (c && Date.now() - c.at < ms) return c.value;
  const value = await fn(); cache.set(k, { at: Date.now(), value }); return value;
}
const bust = (shop, name) => cache.delete(`${shop}:${name}`);

async function setupStatus(ctx) {
  const missing = missingScopes(await grantedScopes(ctx));
  const definitions = missing.includes('write_metaobject_definitions') && missing.includes('write_metaobjects')
    ? await definitionStatus(ctx).catch(() => []) : await definitionStatus(ctx);
  // ready = 第一期的 4 个都建好了(app 就能用正式数据);后加的类型缺了只提示「补建」,不影响已有功能
  const core = definitions.filter((d) => d.core);
  return { requiredScopes: REQUIRED_SCOPES, missingScopes: missing, definitions,
    ready: !missing.length && core.length > 0 && core.every((d) => d.exists),
    // 后加的类型各自判断:缺哪个只影响用到它的页面
    pmReady: definitions.filter((d) => ['cgp_product_tab', 'cgp_product_module'].includes(d.type)).every((d) => d.exists),
    pinReady: definitions.filter((d) => d.type === 'cgp_collection_pin').every((d) => d.exists),
    upgrade: definitions.filter((d) => !d.core && !d.exists).map((d) => d.type),
    // 已建好的类型后来加了字段:也算要补建(同一个按钮)
    fieldsMissing: definitions.flatMap((d) => (d.exists ? (d.missingFields || []).map((k) => `${d.type}.${k}`) : [])) };
}

async function shopInfo(ctx) {
  const d = await graphql(ctx, '{ shop { name myshopifyDomain primaryDomain { url } } currentAppInstallation { app { handle } } }');
  const handle = d.shop.myshopifyDomain.replace('.myshopify.com', '');
  return { name: d.shop.name, handle, domain: d.shop.primaryDomain.url.replace(/\/$/, ''),
    appUrl: `https://admin.shopify.com/store/${handle}/apps/${d.currentAppInstallation.app.handle}` };
}

// 认人:第一个打开的人自动成为审核人;之后新来的默认是编辑,审核人可以在「设置」里改
function actorFor(state, userId) {
  // v3 飞书登录:成员就是身份(管理员 = 审核人,其他 = 编辑;3.2 改成每项指定审批人)
  const member = (state.members || []).find((x) => x.id === userId);
  if (member) { member.lastSeen = Date.now(); return actorOf(member); }
  const id = userId || 'admin-token';
  let u = state.staff.find((x) => x.id === id);
  if (!u) {
    u = { id, name: state.staff.length ? `员工 ${id.slice(-4)}` : '管理员', role: state.staff.length ? 'editor' : 'approver' };
    state.staff.push(u);
  }
  u.lastSeen = Date.now();
  return u;
}

// 给页面用的形状(不回传 webhook 原文和签名密钥)
function clientView(state, { me, setup, store, site }) {
  const hook = state.settings.larkWebhook || '';
  return {
    mode: 'live', me, setup, store, site,
    // 飞书模式下「成员」代替旧的 Shopify 员工名单(名字 / 角色给页面显示用)
    staff: larkEnabled() ? (state.members || []).filter((m) => m.status === 'active').map(actorOf) : state.staff,
    lark: larkEnabled(),
    banners: state.banners, topbar: state.topbar, tbstyles: state.tbstyles, campaigns: state.campaigns, pmodules: state.pmodules || [],
    pins: state.pins || [], designs: state.designs || [], materials: state.materials || [],
    pendingOrder: state.pendingOrder, log: state.log.slice(0, 200), imported: state.imported, scheduler: state.scheduler,
    settings: { notify: state.settings.notify, larkWebhookSet: !!hook, larkWebhookTail: hook ? `…${hook.slice(-6)}` : '', larkSecretSet: !!state.settings.larkSecret },
    collections: [], products: [], tagCounts: {},
  };
}

export function scheduleRouter() {
  const r = express.Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e instanceof ActionError) return res.status(400).json({ error: e.message });
      console.error('[schedule]', e); res.status(500).json({ error: String(e.message || e) });
    }
  };
  const needApprover = (state, req) => { const a = actorFor(state, req.ctx.user); if (a.role !== 'approver') throw new ActionError('只有审核人能做这个操作'); return a; };

  async function view(req, state) {
    const shop = req.ctx.shop;
    const [setup, info, theme] = await Promise.all([
      cached(shop, 'setup', 60_000, () => setupStatus(req.ctx)),
      cached(shop, 'shop', 3600_000, () => shopInfo(req.ctx)),
      cached(shop, 'theme', 600_000, () => readMainTheme(req.ctx).catch(() => null)),
    ]);
    return clientView(state, { me: actorFor(state, req.ctx.user).id, setup, store: { handle: info.handle, domain: info.domain, name: info.name }, site: theme?.style || null });
  }

  // ---- 读 ----
  r.get('/state', wrap(async (req) => withLock(req.ctx.shop, async () => {
    const state = load(req.ctx.shop);
    const v = await view(req, state);
    const info = await cached(req.ctx.shop, 'shop', 3600_000, () => shopInfo(req.ctx));
    state.appUrl = info.appUrl;
    replace(req.ctx.shop, state); // 记下新来的员工、app 地址(飞书按钮用)
    return v;
  })));

  // ---- 所有内容动作:存草稿 / 提交 / 发布 / 批准 / 退回 / 暂停 / 删除 / 排序 ----
  r.post('/act', wrap(async (req) => {
    const shop = req.ctx.shop;
    const action = req.body?.action || {};
    const info = await cached(shop, 'shop', 3600_000, () => shopInfo(req.ctx));
    const out = await performAction(shop, req.ctx, (state) => applyAction(state, action, actorFor(state, req.ctx.user)), { appUrl: info.appUrl });
    // 活动存完顺手算一下产品数(失败不影响保存)
    if (action.type === 'save' && action.kind === 'campaign' && out.id) {
      await withLock(shop, async () => {
        const s = load(shop); const c = s.campaigns.find((x) => x.id === out.id); if (!c) return;
        c.counts = { ...(await scopeCounts(req.ctx, c).catch(() => null)), at: Date.now() };
        replace(shop, s); out.state = s;
      });
    }
    return { ...(await view(req, out.state)), message: out.message, id: out.id, syncErrors: out.syncErrors, larkErrors: out.larkErrors };
  }));

  // ---- 设置 / 成员 ----
  r.post('/settings', wrap(async (req) => withLock(req.ctx.shop, async () => {
    const s = load(req.ctx.shop); const a = needApprover(s, req);
    const { larkWebhook, larkSecret, notify } = req.body || {};
    if (larkWebhook !== undefined) {
      if (larkWebhook && !isLarkWebhook(larkWebhook)) throw new ActionError('飞书 webhook 地址格式不对,应该是 https://open.larksuite.com/open-apis/bot/v2/hook/… 或 open.feishu.cn 的');
      s.settings.larkWebhook = String(larkWebhook || '').trim();
    }
    if (larkSecret !== undefined) s.settings.larkSecret = String(larkSecret || '').trim();
    if (notify) s.settings.notify = { ...s.settings.notify, ...Object.fromEntries(Object.entries(notify).map(([k, v]) => [k, !!v])) };
    appendLog(s, { action: 'edit', kind: 'system', title: '设置', note: '修改了飞书通知设置', by: a.name });
    replace(req.ctx.shop, s); return view(req, s);
  })));
  r.post('/staff', wrap(async (req) => withLock(req.ctx.shop, async () => {
    const s = load(req.ctx.shop); const a = actorFor(s, req.ctx.user);
    const { id, name, role } = req.body || {};
    const u = s.staff.find((x) => x.id === id) || (() => { throw new ActionError('找不到这个成员'); })();
    if (name !== undefined) {
      if (u.id !== a.id && a.role !== 'approver') throw new ActionError('只能改自己的名字');
      u.name = String(name).trim().slice(0, 30) || u.name;
    }
    if (role !== undefined) {
      if (a.role !== 'approver') throw new ActionError('只有审核人能改角色');
      if (!['approver', 'editor'].includes(role)) throw new ActionError('角色不对');
      if (u.role === 'approver' && role !== 'approver' && s.staff.filter((x) => x.role === 'approver').length === 1) throw new ActionError('至少要留一个审核人');
      u.role = role;
    }
    replace(req.ctx.shop, s); return view(req, s);
  })));
  r.post('/lark-test', wrap(async (req) => {
    const s = load(req.ctx.shop); const a = needApprover(s, req);
    if (!s.settings.larkWebhook) throw new ActionError('还没填飞书 webhook 地址');
    const info = await cached(req.ctx.shop, 'shop', 3600_000, () => shopInfo(req.ctx));
    await sendLark({ webhook: s.settings.larkWebhook, secret: s.settings.larkSecret }, { title: '✅ 网站更新中心已连上飞书', color: 'green',
      lines: [`${a.name} 发了一条测试消息。以后提交审核、批准 / 退回、自动上下线、下架前 3 天、到点没批准、切换失败都会发到这个群。`],
      button: { text: '打开网站更新中心', url: info.appUrl } });
    return { ok: true };
  }));

  // ---- 建内容类型(第一次写店铺,用户点按钮触发)----
  r.get('/status', wrap(async (req) => {
    bust(req.ctx.shop, 'setup');
    const st = load(req.ctx.shop);
    return { shop: req.ctx.shop, ...(await cached(req.ctx.shop, 'setup', 60_000, () => setupStatus(req.ctx))), scheduler: schedulerInfo(req.ctx.shop), app: APP_VERSION,
      items: Object.fromEntries(Object.values(LIST).map((k) => [k, st[k].length])) };
  }));
  r.post('/setup', wrap(async (req) => {
    const missing = missingScopes(await grantedScopes(req.ctx));
    if (missing.length) throw new ActionError(`还缺权限:${missing.join(', ')}。请先在应用配置里加上并在店铺里同意。`);
    const out = await ensureDefinitions(req.ctx);
    bust(req.ctx.shop, 'setup');
    update(req.ctx.shop, (s) => appendLog(s, { action: 'setup', kind: 'system', title: '建内容类型',
      note: `新建 ${out.created.length} 个${out.existing.length ? `,已存在 ${out.existing.length} 个` : ''}${out.errors.length ? `,失败 ${out.errors.length} 个` : ''}`, by: actorFor(s, req.ctx.user).name }));
    return { ...out, definitions: await definitionStatus(req.ctx) };
  }));

  // ---- 从主题导入现有 Banner / 顶栏(审核人点按钮)----
  r.get('/import-preview', wrap(async (req) => {
    const t = await readMainTheme(req.ctx);
    return { theme: t.theme.name, slides: (t.slider?.slides || []).filter((s) => !s.disabled).length, disabledSlides: (t.slider?.slides || []).filter((s) => s.disabled).length,
      topbarMessages: t.topbar?.messages.length || 0, modules: t.modules.map((m) => ({ module: m.module, title: `${m.title} ${m.title2}`.trim(), tabs: m.tabs.length })) };
  }));
  r.post('/import', wrap(async (req) => {
    const shop = req.ctx.shop;
    const setup = await setupStatus(req.ctx);
    if (!setup.ready) throw new ActionError('先在「店铺连接」里建好内容类型,再导入');
    const theme = await readMainTheme(req.ctx);
    const info = await cached(shop, 'shop', 3600_000, () => shopInfo(req.ctx));
    return withLock(shop, async () => {
      const s = load(shop); const a = needApprover(s, req);
      const sources = new Set([...s.banners, ...s.topbar, ...s.tbstyles, ...(s.pmodules || [])].map((x) => x.source).filter(Boolean));
      const imp = await buildImport(req.ctx, theme, sources, { actor: a });
      const base = { banners: s.banners.length, topbar: s.topbar.length };
      imp.banners.forEach((b) => { b.order += base.banners; s.banners.push(b); });
      imp.topbar.forEach((t) => { t.order += base.topbar; s.topbar.push(t); });
      imp.tbstyles.forEach((t) => s.tbstyles.push(t));
      if (setup.pmReady) imp.pmodules.forEach((m) => s.pmodules.push(m));
      const pmCount = setup.pmReady ? imp.pmodules.length : 0;
      s.imported = { at: Date.now(), theme: theme.theme.name, banners: (s.imported?.banners || 0) + imp.banners.length, topbar: (s.imported?.topbar || 0) + imp.topbar.length, pmodules: (s.imported?.pmodules || 0) + pmCount, skipped: imp.skipped, disabledSlides: imp.disabledSlides };
      appendLog(s, { action: 'import', kind: 'system', title: '从主题导入', note: `${imp.banners.length} 张 Banner、${imp.topbar.length} 条顶栏、${pmCount} 个商品模块平时版本${imp.skipped.length ? `,跳过 ${imp.skipped.length} 个` : ''}`, by: a.name });
      replace(shop, s);
      const effects = [...imp.banners, ...imp.topbar, ...imp.tbstyles, ...(setup.pmReady ? imp.pmodules : [])].map((x) => ({ type: 'sync', id: x.id }));
      const r2 = await runEffects(req.ctx, s, effects, { appUrl: info.appUrl });
      replace(shop, s);
      const parts = [imp.banners.length && `${imp.banners.length} 张 Banner`, imp.topbar.length && `${imp.topbar.length} 条顶栏`, pmCount && `${pmCount} 个商品模块平时版本`].filter(Boolean);
      return { ...(await view(req, s)), message: parts.length ? `已导入 ${parts.join('、')}` : '没有新的可导入(导过的已跳过)', skipped: imp.skipped, syncErrors: r2.errors };
    });
  }));

  // ---- 图片上传(Banner)----
  r.post('/upload', express.raw({ type: 'image/*', limit: '20mb' }), wrap(async (req) => {
    if (!req.body?.length) throw new ActionError('没收到图片');
    const name = String(req.query.filename || 'banner.jpg').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    return uploadImage(req.ctx, req.body, name, req.headers['content-type']);
  }));

  // ---- 首页商品模块:页签预览(取前几个产品给编辑器看)----
  r.post('/tab-products', wrap(async (req) => tabProducts(req.ctx, req.body || {})));

  // ---- 产品数 / 查产品 ----
  r.post('/counts', wrap(async (req) => scopeCounts(req.ctx, req.body || {})));
  r.get('/product', wrap(async (req) => {
    const q = String(req.query.q || '').trim().replace(/^https?:\/\/[^/]+\/products\//, '').split(/[?#/]/)[0];
    if (!q) throw new ActionError('请输入产品 handle、链接或 id');
    const s = load(req.ctx.shop);
    const res = await productCampaigns(req.ctx, q, s.campaigns.filter((c) => c.state === 'approved'));
    if (!res) throw new ActionError('找不到这个产品');
    return res;
  }));

  return r;
}
