// 改价的数据:每个店铺一个 JSON 文件,放在 Railway 数据卷(DATA_DIR/price/,和排期的 schedule/ 分开)。先写临时文件再改名,不会写坏。
// 计划、原价保险库、合集记账、价格账本、操作日志、成员、设置、执行器状态都在这里。
import fs from 'node:fs';
import path from 'node:path';

const dir = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'price');
const fileOf = (shop) => path.join(dir(), `${shop.replace(/[^a-z0-9.-]/gi, '_')}.json`);
// 价格账本单独一个只追加的文件(2026-11-03):以前存在上面的主文件里(最多 5 万条),执行器每分钟读写整个文件,越积越慢;挪出来后也不再限条数
// ⛔ 文件名以 .jsonl 结尾,listShops 只认 .json,不会把它当成店铺
const ledgerFileOf = (shop) => path.join(dir(), `${shop.replace(/[^a-z0-9.-]/gi, '_')}.ledger.jsonl`);

export const DEFAULT_NOTIFY = { submit: true, decision: true, start: true, end: true, hold: true, failure: true, unapproved: true };

export function emptyState() {
  return {
    version: 1,
    plans: [],
    vault: {},        // 变体 → { productId, title, sku, base, written, intent, hold, since }
    collState: {},    // 合集 → { title, managed, preexisting }
    goneCollections: {}, // 店里已经删掉的合集 → { title, at, plans }:不再往里加 / 移出(2026-10-29)
    tagState: {},     // 产品 → { added: [app 加的标签], removed: [app 去掉的标签] }
    ledger: [],       // 这一轮新记的价格账本(最新在前),save 时写进 .ledger.jsonl 再清空;读账本用 readLedger
    log: [],          // 操作日志
    // 成员和飞书设置用网站更新中心的(schedule-store 的 members);这里只放改价自己的设置
    settings: { maxDiscountPct: 60, sweepMinutes: 5, notify: { ...DEFAULT_NOTIFY }, ukLocation: null }, // ukLocation:当 UK 仓的 Shopify 仓库 id(空 = 自动认 Cinegearpro)
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
  // 先把账本写进只追加的文件(老数据第一次保存时也整批搬过去),再写主文件。中途断电最多重复几条(读的时候去重),不会丢
  if (state.ledger?.length) {
    fs.appendFileSync(ledgerFileOf(shop), `${state.ledger.slice().reverse().map((e) => JSON.stringify(e)).join('\n')}\n`);
    state.ledger = [];
    ledgerCache.delete(shop);
  }
  const f = fileOf(shop); const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, f);
}

export function listShops() {
  try { return fs.readdirSync(dir()).filter((f) => f.endsWith('.json') && !/\.(colhist|itemhist|planhist)\.json$/.test(f)).map((f) => f.slice(0, -5)); } catch { return []; }
}

export function appendLedger(state, entries) {
  if (!entries.length) return;
  state.ledger = [...entries.slice().reverse(), ...(state.ledger || [])]; // 先放在这里,save 时写进账本文件
}
// 读账本:最新在前。文件没变(大小、修改时间一样)就用上次读的
const ledgerCache = new Map();
export function readLedger(shop) {
  const f = ledgerFileOf(shop);
  let st; try { st = fs.statSync(f); } catch { return []; }
  const c = ledgerCache.get(shop);
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.rows;
  const seen = new Set(); const rows = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; } // 写到一半的坏行跳过
    const k = `${e.at}|${e.variantId}|${e.op}|${e.to?.price ?? ''}|${e.to?.compareAt ?? ''}`; if (seen.has(k)) continue; seen.add(k);
    rows.push(e);
  }
  rows.reverse();
  ledgerCache.set(shop, { size: st.size, mtime: st.mtimeMs, rows });
  return rows;
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
