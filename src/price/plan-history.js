// 改价计划的历史版本:每次存草稿、提交、批准、退回、暂停 / 继续、停止、删除、排除产品、回滚都记一版。
// 和网站内容的历史(src/item-history.js)一样的做法,只是存在改价自己的目录:DATA_DIR/price/<店>.planhist.json
// 每个计划最多 40 版 / 180 天(计划里带每个变体的价格,一版可能几十 KB,所以比内容少留一些)。
import fs from 'node:fs';
import path from 'node:path';
import { EDIT_KEYS } from './price-actions.js';

const dir = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'price');
const fileOf = (shop) => path.join(dir(), `${shop.replace(/[^a-z0-9.-]/gi, '_')}.planhist.json`);
export const MAX_VERSIONS = 40;
export const KEEP_DAYS = 180;

export const cleanPlanHistory = (h) => Object.fromEntries(Object.entries(h || {}).filter(([, v]) => v && typeof v === 'object' && Array.isArray(v.versions)));
export function loadPlanHistory(shop) {
  try { return cleanPlanHistory(JSON.parse(fs.readFileSync(fileOf(shop), 'utf8'))); } catch { return {}; }
}
function savePlanHistory(shop, h) {
  fs.mkdirSync(dir(), { recursive: true });
  const f = fileOf(shop); const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(h)); fs.renameSync(tmp, f);
}

export function planSnapshot(p) {
  const { by, at, ...pending } = p.pendingChange || {}; // eslint-disable-line no-unused-vars
  const values = Object.fromEntries(EDIT_KEYS.filter((k) => k in p).map((k) => [k, JSON.parse(JSON.stringify(p[k]))]));
  return { state: p.state, paused: !!p.paused, stopped: !!p.stopped, excluded: (p.excluded || []).length, values, pending: p.pendingChange ? pending : null };
}
const key = (v) => JSON.stringify([v.state, v.paused, v.stopped, v.excluded, v.values, v.pending, !!v.deleted]);

export function pushPlanVersion(h, plan, meta = {}, now = Date.now()) {
  const rec = (h[plan.id] ||= { title: '', versions: [] });
  rec.title = plan.name || rec.title;
  const snap = { ...planSnapshot(plan), ...(meta.deleted ? { deleted: true } : {}) };
  const last = rec.versions[rec.versions.length - 1];
  if (last && key(last) === key(snap)) return false;
  rec.versions.push({ at: now, action: meta.action || '', by: meta.by || '', note: meta.note || '', ...snap });
  const cutoff = now - KEEP_DAYS * 86400_000;
  while (rec.versions.length > MAX_VERSIONS || (rec.versions.length > 1 && rec.versions[0].at < cutoff)) rec.versions.shift();
  return true;
}

export function recordPlanChanges(h, beforePlans, afterPlans, ids, meta = {}, now = Date.now()) {
  let dirty = false;
  for (const id of new Set(ids.filter(Boolean))) {
    const b = afterPlans.find((p) => p.id === id);
    if (b) dirty = pushPlanVersion(h, b, meta, now) || dirty;
    else { const a = beforePlans.find((p) => p.id === id); if (a) dirty = pushPlanVersion(h, a, { ...meta, action: '删除', deleted: true }, now) || dirty; }
  }
  return dirty;
}
export function recordPlanAction(shop, beforePlans, afterPlans, ids, meta, now = Date.now()) {
  const h = loadPlanHistory(shop);
  if (recordPlanChanges(h, beforePlans, afterPlans, ids, meta, now)) savePlanHistory(shop, h);
}
