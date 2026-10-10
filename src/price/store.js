// 改价的数据:每个店铺一个 JSON 文件,放在 Railway 数据卷(DATA_DIR/price/,和排期的 schedule/ 分开)。先写临时文件再改名,不会写坏。
// 计划、原价保险库、合集记账、价格账本、操作日志、成员、设置、执行器状态都在这里。
import fs from 'node:fs';
import path from 'node:path';

const dir = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'price');
const fileOf = (shop) => path.join(dir(), `${shop.replace(/[^a-z0-9.-]/gi, '_')}.json`);

export const DEFAULT_NOTIFY = { submit: true, decision: true, start: true, end: true, hold: true, failure: true, unapproved: true };
export const LEDGER_MAX = 50_000;

export function emptyState() {
  return {
    version: 1,
    plans: [],
    vault: {},        // 变体 → { productId, title, sku, base, written, intent, hold, since }
    collState: {},    // 合集 → { title, managed, preexisting }
    tagState: {},     // 产品 → { added: [app 加的标签], removed: [app 去掉的标签] }
    ledger: [],       // 价格账本(最新在前)
    log: [],          // 操作日志
    // 成员和飞书设置用网站更新中心的(schedule-store 的 members);这里只放改价自己的设置
    settings: { maxDiscountPct: 60, sweepMinutes: 5, notify: { ...DEFAULT_NOTIFY } },
    notified: {},
    appUrl: '',
    engine: { lastRun: null, lastSweep: null, lastError: null, lastWrites: 0 },
  };
}

export function load(shop) {
  const base = emptyState();
  try {
    const s = JSON.parse(fs.readFileSync(fileOf(shop), 'utf8'));
    return { ...base, ...s, settings: { ...base.settings, ...s.settings, notify: { ...DEFAULT_NOTIFY, ...s.settings?.notify } }, engine: { ...base.engine, ...s.engine } };
  } catch {
    return base;
  }
}

export function save(shop, state) {
  fs.mkdirSync(dir(), { recursive: true });
  const f = fileOf(shop); const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, f);
}

export function listShops() {
  try { return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; }
}

export function appendLedger(state, entries) {
  if (!entries.length) return;
  state.ledger = [...entries.slice().reverse(), ...(state.ledger || [])].slice(0, LEDGER_MAX);
}
export function appendLog(state, entry) {
  state.log ||= [];
  state.log.unshift({ at: Date.now(), ...entry });
  state.log = state.log.slice(0, 2000);
}

// 同一个店铺的动作和执行器排队执行,不会同时读写
const locks = new Map();
export function withLock(shop, fn) {
  const prev = locks.get(shop) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(shop, run.catch(() => {}));
  return run;
}
