// 操作记录(2026-10-28 用户:每个同事用飞书登录,所有操作都要记下来,所有人都能看全部)
// 服务器统一记:每个改东西的请求(POST / PUT / DELETE)结束时写一条 —— 谁、什么时候、哪个模块、做了什么、成功没有。
// 处理请求的地方可以放 req.audit = { mod, text } 写成更具体的人话(比如带上 Banner 的名字);没放就按接口查下面的表。
// 每家店一个 JSON Lines 文件 DATA_DIR/audit/<店>.jsonl,只追加不改:{ at, who: { id, name }, mod, text, ok, err?, ms, path }
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'audit');
const fileOf = (shop) => path.join(DIR, `${String(shop).replace(/[^a-z0-9.-]/gi, '_')}.jsonl`);
const MAX_BYTES = 30 * 1024 * 1024; // 一条 300 字节左右,一年也就几 MB;真到 30MB 砍掉最旧的一半

export const MOD_CN = {
  overview: '总览', campaigns: '活动', banners: '首页 Banner', topbar: '顶栏', pmodules: '首页商品模块', callouts: '产品页推广',
  pins: 'Collection 排序', salelinks: '促销链接', price: '改价', history: '历史记录', settings: '设置', members: '成员与角色',
  login: '登录', tools: '工具', reviews: '审核', other: '其他',
};
export const KIND_MOD = { banner: 'banners', topbar: 'topbar', tbstyle: 'topbar', pmodule: 'pmodules', pin: 'pins', salelink: 'salelinks', callout: 'callouts', campaign: 'campaigns' };
const KIND_CN = { banner: 'Banner', topbar: '顶栏公告', tbstyle: '顶栏样式', campaign: '活动', pmodule: '首页商品模块', pin: 'Collection 置顶排序', salelink: '促销链接', callout: '产品页推广' };

// 只读的 POST(带 body 查东西)不算操作
const SKIP = new Set(['/schedule/tab-products', '/schedule/counts', '/schedule/callout-scope', '/schedule/products-stock', '/auth/lark/start', '/auth/lark/redeem']);
const PATHS = {
  '/schedule/collection-create': ['callouts', '新建 Collection'],
  '/schedule/joint-sync': ['callouts', '同步联合推广的产品'],
  '/schedule/settings': ['settings', '改设置(飞书通知等)'],
  '/schedule/staff': ['settings', '改成员名字 / 角色'],
  '/schedule/clear-history': ['settings', '清理历史记录'],
  '/schedule/lark-test': ['settings', '测试飞书通知'],
  '/schedule/setup': ['settings', '补建内容类型'],
  '/schedule/import': ['settings', '从主题导入'],
  '/schedule/theme-sync': ['settings', '主题同步'],
  '/schedule/upload': ['banners', '上传图片'],
  '/schedule/col-sort': ['pins', '改 Collection 默认排序'],
  '/schedule/col-copy-order': ['pins', '照另一个 Collection 复制顺序'],
  '/schedule/col-run': ['pins', '立即执行一次 Collection 排序'],
  '/schedule/col-rollback': ['pins', '回滚 Collection 顺序'],
  '/schedule/act': ['other', '保存网站内容'],
  '/price/act': ['price', '改价计划操作'],
  '/price/run-now': ['price', '立即执行一次改价'],
  '/price/settings': ['price', '改改价设置'],
  '/roles': ['members', '改角色能看的页面'],
  '/test-mode': ['settings', '打开 / 关闭测试模式'],
  '/annotations': ['tools', '改元数据备注'],
};
const SAVE_CN = { draft: '存草稿', submit: '提交审核', publish: '保存' };
const PRICE_CN = { approve: '批准', reject: '退回', pause: '暂停', resume: '继续', stop: '提前结束', delete: '删除', exclude: '移出产品', resolve: '处理暂停接管', dup: '复制' };

// 没有 req.audit 时,按接口 + 请求内容猜一句话
export function describe(p, body = {}) {
  if (p === '/schedule/col-hold') return ['pins', body.release ? '保留后台排序(不再按置顶排序来排)' : '按本次排序重新排'];
  if (p.startsWith('/invites')) return ['members', '预先添加 / 修改同事'];
  if (p.startsWith('/members/')) return ['members', `改成员${body.status ? `(状态 → ${body.status})` : ''}${body.roles ? '(角色)' : ''}${body.name ? `(名字 → ${body.name})` : ''}`];
  if (p === '/schedule/act') {
    const a = body.action || {}; const kind = a.kind;
    const what = KIND_CN[kind] || '内容'; const name = a.values?.name || a.values?.title || '';
    const verb = a.type === 'save' ? (a.isNew ? '新建' : SAVE_CN[a.mode] || '保存') : { approve: '批准', reject: '退回', pause: '暂停 / 恢复', delete: '删除', purge: '批量删除', order: '调整顺序' }[a.type] || a.type;
    return [KIND_MOD[kind] || 'other', `${verb}${what}${name ? `「${name}」` : ''}`];
  }
  if (p === '/price/act') {
    const a = body.action || {}; const name = a.values?.name || '';
    const verb = a.type === 'save' ? (a.isNew ? '新建' : SAVE_CN[a.mode] || '保存') : PRICE_CN[a.type] || a.type;
    return ['price', `${verb}改价计划${name ? `「${name}」` : ''}`];
  }
  return PATHS[p] || ['other', `${p}`];
}

// 中文和英文 / 数字之间补空格(「新建Collection」→「新建 Collection」)
export const tidy = (t) => String(t || '').replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2');

export function appendAudit(shop, e) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const f = fileOf(shop);
    fs.appendFileSync(f, JSON.stringify({ at: Date.now(), ...e }) + '\n');
    if (fs.statSync(f).size > MAX_BYTES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(f, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
    }
  } catch (err) { console.error('[audit] 写不进去:', err.message); }
}

// 新的在前。who / mod 筛选,since = 只要这个时间以后的,before = 翻页(比这条早的),q = 搜索文字或人名
export function readAudit(shop, { who = '', mod = '', since = 0, before = 0, q = '', limit = 200 } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(fileOf(shop), 'utf8').split('\n'); } catch { return { rows: [], people: [], more: false }; }
  const rows = []; const people = new Map(); let more = false;
  const qq = String(q || '').trim().toLowerCase();
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.who?.id && !people.has(e.who.id)) people.set(e.who.id, e.who.name);
    if (before && e.at >= before) continue;
    if (since && e.at < since) continue;
    if (who && e.who?.id !== who) continue;
    if (mod && e.mod !== mod) continue;
    if (qq && !`${e.text} ${e.who?.name || ''}`.toLowerCase().includes(qq)) continue;
    if (rows.length >= limit) { more = true; continue; }
    rows.push(e);
  }
  return { rows, people: [...people].map(([id, name]) => ({ id, name })), more };
}

// 登录一次能用 30 天,所以每人每天第一次打开也记一条(「登录」一类),看得出谁哪天用过。/api/me 调用
const opened = new Map(); // 店|成员 → 伦敦日期
const londonDay = (t) => new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
export function noteOpen(shop, m, now = Date.now()) {
  const k = `${shop}|${m.id}`; const today = londonDay(now);
  if (opened.get(k) === today) return false;
  opened.set(k, today);
  // 服务器刚重启时内存是空的:看一眼今天是不是已经记过(用飞书登录也算)
  const last = readAudit(shop, { who: m.id, mod: 'login', limit: 1 }).rows[0];
  if (last && londonDay(last.at) === today) return false;
  appendAudit(shop, { at: now, who: { id: m.id, name: m.name }, mod: 'login', text: '打开网站更新中心(今天第一次)', ok: true, path: '/me' });
  return true;
}

// express 中间件:放在认人(requireAccess)后面、所有接口前面。whoOf(req) 给出 { id, name }
export function auditTrail(whoOf) {
  return (req, res, next) => {
    const p = req.path; // 现在就记下:请求结束时 req.path 已经被里面的路由改成 /act 这样的短路径了
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || SKIP.has(p)) return next();
    const t0 = Date.now(); const body = req.body;
    const json = res.json.bind(res);
    res.json = (b) => { if (res.statusCode >= 400 && b && b.error) req._auditErr = String(b.error).slice(0, 300); return json(b); };
    res.on('finish', () => {
      const shop = req.ctx?.shop; if (!shop) return;
      const [mod0, text0] = describe(p, Buffer.isBuffer(body) ? {} : body || {});
      const a = req.audit || {};
      appendAudit(shop, { who: whoOf(req), mod: a.mod || mod0, text: tidy(a.text || text0), ok: res.statusCode < 400, ...(req._auditErr ? { err: req._auditErr } : {}), ms: Date.now() - t0, path: p });
    });
    next();
  };
}
