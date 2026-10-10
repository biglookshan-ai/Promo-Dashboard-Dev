// 排期数据的存放:每个店铺一个 JSON 文件,放在 Railway 的数据卷(DATA_DIR,已挂 /data)。
// 草稿 / 待审核 / 操作日志 / 成员 / 飞书设置都在这里;Shopify 里只放「已批准」的版本(见 AGENTS.md 铁律)。
// 数据量很小(几十到几百条),单进程同步读写 + 先写临时文件再改名,不会写坏。
// 以后量大或要多实例再换 Postgres —— 只需要换掉这个文件的实现。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'schedule');
const fileOf = (shop) => path.join(DIR, `${shop.replace(/[^a-z0-9.-]/gi, '_')}.json`);

export const DEFAULT_NOTIFY = { submit: true, decision: true, dayBefore: true, endingSoon: true, upDown: true, unapproved: true, failure: true };

export function emptyState() {
  return {
    version: 2,
    banners: [], topbar: [], tbstyles: [], campaigns: [], pmodules: [],
    pins: [], // v3:合集置顶清单
    pendingOrder: null,
    log: [],
    staff: [], // v2 旧名单:[{ id: Shopify 员工 id, name, role: 'approver' | 'editor', lastSeen }]
    members: [], // v3 飞书登录的成员(见 src/members.js)
    roles: null, // v3 角色(null = 默认角色)
    larkTenant: null, // 第一位管理员所在的飞书企业
    testMode: null, // v3:临时关掉飞书登录(只在从 Shopify 后台打开时生效,到点自动失效)
    settings: { larkWebhook: '', larkSecret: '', notify: { ...DEFAULT_NOTIFY } },
    notified: {}, // 已发过的提醒(去重用):{ 'endingSoon:<id>:<日期>': 时间 }
    imported: null, // 从主题导入的时间和数量
    scheduler: { lastRun: null, lastError: null, lastChanges: 0 },
  };
}

export function load(shop) {
  const base = emptyState();
  try {
    const s = JSON.parse(fs.readFileSync(fileOf(shop), 'utf8'));
    return {
      ...base, ...s, pmodules: s.pmodules || [], members: s.members || [], pins: s.pins || [],
      settings: { ...base.settings, ...s.settings, notify: { ...DEFAULT_NOTIFY, ...s.settings?.notify } },
      scheduler: { ...base.scheduler, ...s.scheduler },
    };
  } catch {
    return base;
  }
}

function write(shop, state) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = fileOf(shop); const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, f);
}

// 读 → 改 → 写回。fn 可以直接改传入的 state,也可以返回新的 state。
export function update(shop, fn) {
  const s = load(shop);
  const next = fn(s) || s;
  write(shop, next);
  return next;
}
export const replace = (shop, state) => write(shop, state);

export function appendLog(state, entry) {
  state.log.unshift({ at: Date.now(), ...entry });
  state.log = state.log.slice(0, 1000);
}

export function listShops() {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

export const allItems = (state) => [...state.campaigns, ...state.banners, ...state.topbar, ...state.tbstyles, ...(state.pmodules || []), ...(state.pins || [])];
