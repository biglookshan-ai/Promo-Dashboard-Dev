// 网站内容的历史版本(Banner / 顶栏 / 顶栏样式 / 商品模块 / 合集置顶清单 / 活动)。
//
// 每次存草稿、提交、直接保存、批准、退回、暂停 / 恢复、删除、回滚,都把这条内容「那一刻的样子」记一版:
//   state(草稿 / 待审核 / 已批准…)、paused、values(能编辑的全部字段)、pending(还在等审批的修改)
// 和上一版一模一样的不重复记。每条内容最多 60 版 / 180 天;删掉的内容历史保留(可以复制回来)。
// 每个店一个文件 <店>.itemhist.json,不和排期数据放一起(免得每次请求都读一大坨)。
import fs from 'node:fs';
import path from 'node:path';
import { pickEditable, findItem, titleOf } from './schedule-actions.js';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'schedule');
const fileOf = (shop) => path.join(DIR, `${shop.replace(/[^a-z0-9.-]/gi, '_')}.itemhist.json`);
export const MAX_VERSIONS = 60;
export const KEEP_DAYS = 180;

export function loadItemHistory(shop) {
  try { return cleanItemHistory(JSON.parse(fs.readFileSync(fileOf(shop), 'utf8'))); } catch { return {}; }
}
// 只留「内容 id → { kind, title, versions: [...] }」;别的东西丢掉
export function cleanItemHistory(h) {
  return Object.fromEntries(Object.entries(h || {}).filter(([, v]) => v && typeof v === 'object' && typeof v.kind === 'string' && Array.isArray(v.versions)));
}
function saveItemHistory(shop, h) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = fileOf(shop); const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(h)); fs.renameSync(tmp, f);
}

// 一条内容这一刻的样子
export function snapshotOf(it) {
  const { by, at, ...pending } = it.pendingChange || {}; // eslint-disable-line no-unused-vars
  return { state: it.state, paused: !!it.paused, values: JSON.parse(JSON.stringify(pickEditable(it))), pending: it.pendingChange ? pending : null };
}
const key = (v) => JSON.stringify([v.state, v.paused, v.values, v.pending, !!v.deleted]);

// 纯函数版(好测):给一条内容加一版,返回是否真的加了
export function pushItemVersion(h, it, meta = {}, now = Date.now()) {
  const rec = (h[it.id] ||= { kind: it.kind, title: '', versions: [] });
  rec.kind = it.kind; rec.title = titleOf(it) || rec.title;
  const snap = { ...snapshotOf(it), ...(meta.deleted ? { deleted: true } : {}) };
  const last = rec.versions[rec.versions.length - 1];
  if (last && key(last) === key(snap)) return false;
  rec.versions.push({ at: now, action: meta.action || '', by: meta.by || '', note: meta.note || '', ...snap });
  const cutoff = now - KEEP_DAYS * 86400_000;
  while (rec.versions.length > MAX_VERSIONS || (rec.versions.length > 1 && rec.versions[0].at < cutoff)) rec.versions.shift();
  return true;
}

// 一个动作前后:把动过的内容各记一版(删掉的记成「已删除」那一版)
export function recordChanges(h, before, after, ids, meta = {}, now = Date.now()) {
  let dirty = false;
  for (const id of new Set(ids.filter(Boolean))) {
    const b = findItem(after, id);
    if (b) dirty = pushItemVersion(h, b, meta, now) || dirty;
    else { const a = findItem(before, id); if (a) dirty = pushItemVersion(h, a, { ...meta, action: 'delete', deleted: true }, now) || dirty; }
  }
  return dirty;
}
export function recordAction(shop, before, after, ids, meta, now = Date.now()) {
  const h = loadItemHistory(shop);
  if (recordChanges(h, before, after, ids, meta, now)) saveItemHistory(shop, h);
}

// 两版之间改了哪些字段(null / 缺省 / 空字符串算一样)
const norm = (v) => (v == null || v === '' ? null : JSON.stringify(v));
export function changedKeys(a = {}, b = {}) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => norm(a[k]) !== norm(b[k]));
}
