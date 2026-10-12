// 合集顺序的历史版本(回滚用)。每个店铺单独一个文件,不和排期数据放一起(免得每次请求都读一大坨)。
//
// 什么时候记一版:app 第一次接管前(原样)、每次真的改完、结束还原后、发现有人在后台改过、回滚前 / 回滚后。
// 每一版只记「产品 id 的顺序」:11 个产品约 0.2KB,500 个约 7KB。
// 每个合集最多留 100 版、90 天;和上一版一模一样的不重复记。
import fs from 'node:fs';
import path from 'node:path';
import { nid } from './order-diff.js';

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), '.data'), 'schedule');
const fileOf = (shop) => path.join(DIR, `${shop.replace(/[^a-z0-9.-]/gi, '_')}.colhist.json`);
export const MAX_VERSIONS = 100;
export const KEEP_DAYS = 90;

export function loadHistory(shop) {
  try { return JSON.parse(fs.readFileSync(fileOf(shop), 'utf8')); } catch { return {}; }
}
export function saveHistory(shop, h) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = fileOf(shop); const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(h)); fs.renameSync(tmp, f);
}

// 纯函数版(好测):往某个合集的历史里加一版,返回是否真的加了
export function pushVersion(h, cid, ids, meta = {}, now = Date.now()) {
  const key = nid(cid);
  const list = (h[key] ||= []);
  const clean = ids.map(nid);
  const last = list[list.length - 1];
  if (last && last.ids.join(',') === clean.join(',')) return false;
  list.push({ at: now, ids: clean, why: meta.why || '', by: meta.by || '', pin: meta.pin || '', title: meta.title || '' });
  const cutoff = now - KEEP_DAYS * 86400_000;
  while (list.length > MAX_VERSIONS || (list.length > 1 && list[0].at < cutoff)) list.shift();
  return true;
}

export function recordVersion(shop, cid, ids, meta, now = Date.now()) {
  const h = loadHistory(shop);
  if (pushVersion(h, cid, ids, meta, now)) saveHistory(shop, h);
}

// 给 alignCollections 用的记录器:一轮里攒着,最后一次写盘
export function historyRecorder(shop) {
  let h = null; let dirty = false; // 用到才读文件(大多数时候一轮里什么都不记)
  const rec = (cid, ids, meta) => { h ||= loadHistory(shop); if (pushVersion(h, cid, ids, meta)) dirty = true; };
  rec.flush = () => { if (dirty) saveHistory(shop, h); dirty = false; };
  return rec;
}

// 历史功能上线之前 app 就已经接管了的合集:把接管前的快照补成最早的一版,回滚才回得去
export function backfillBase(h, cid, ids, at = Date.now()) {
  const key = nid(cid); const list = (h[key] ||= []);
  const clean = ids.map(nid);
  if (list.some((v) => v.ids.join(',') === clean.join(','))) return false;
  const first = list[0]?.at;
  list.unshift({ at: first ? Math.min(at, first - 1) : at, ids: clean, why: 'app 接管前的原样', by: '', pin: '', title: '' });
  return true;
}
