// 排期数据的存放:每个店铺一个 JSON 文件,放在 Railway 的数据卷(DATA_DIR,已挂 /data)。
// 草稿 / 待审核 / 操作日志都在这里;Shopify 里只放「已批准」的版本(见 AGENTS.md 铁律)。
// 数据量很小(几十到几百条),单进程同步读写 + 先写临时文件再改名,不会写坏。
// 以后量大或要多实例再换 Postgres —— 只需要换掉这个文件的实现。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'schedule');
const fileOf = (shop) => path.join(DIR, `${shop.replace(/[^a-z0-9.-]/gi, '_')}.json`);

export function emptyState() {
  return {
    version: 1,
    items: { banner: [], topbar: [], tbstyle: [], campaign: [] },
    pendingOrder: null,
    log: [],
    settings: {
      larkWebhook: '',
      notify: { submit: true, decision: true, dayBefore: true, endingSoon: true, upDown: true, unapproved: true, failure: true },
      approvers: [],
    },
    scheduler: { lastRun: null, lastError: null, lastChanges: 0 },
  };
}

export function load(shop) {
  try {
    const s = JSON.parse(fs.readFileSync(fileOf(shop), 'utf8'));
    const base = emptyState();
    return { ...base, ...s, items: { ...base.items, ...s.items }, settings: { ...base.settings, ...s.settings }, scheduler: { ...base.scheduler, ...s.scheduler } };
  } catch {
    return emptyState();
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

export const allItems = (state) => Object.values(state.items).flat();
