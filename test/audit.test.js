// 操作记录(src/audit.js):每人每天第一次打开记一条、筛选、人话描述
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
const { appendAudit, readAudit, noteOpen, describe, tidy } = await import('../src/audit.js');

const DAY = 86400e3;
const at = (s) => Date.parse(s);

test('每人每天第一次打开记一条;同一天再开不记,第二天再记', () => {
  const shop = 'open.myshopify.com'; const m = { id: 'ou_a', name: '小明' };
  assert.equal(noteOpen(shop, m, at('2026-10-28T09:00:00Z')), true);
  assert.equal(noteOpen(shop, m, at('2026-10-28T15:00:00Z')), false);
  assert.equal(noteOpen(shop, m, at('2026-10-29T08:00:00Z')), true);
  const rows = readAudit(shop, { who: 'ou_a' }).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.mod === 'login' && r.who.name === '小明'));
});

test('今天已经用飞书登录过(或服务器重启前记过)就不再记「打开」', () => {
  const shop = 'login.myshopify.com'; const m = { id: 'ou_b', name: '小红' };
  appendAudit(shop, { at: at('2026-10-28T08:00:00Z'), who: { id: m.id, name: m.name }, mod: 'login', text: '用飞书登录', ok: true });
  assert.equal(noteOpen(shop, m, at('2026-10-28T10:00:00Z')), false);
  assert.equal(readAudit(shop).rows.length, 1);
  // 昨天登录的,今天第一次打开照记
  const m2 = { id: 'ou_c', name: '小刚' };
  appendAudit(shop, { at: at('2026-10-27T20:00:00Z'), who: { id: m2.id, name: m2.name }, mod: 'login', text: '用飞书登录', ok: true });
  assert.equal(noteOpen(shop, m2, at('2026-10-28T10:00:00Z')), true);
});

test('按人 / 模块 / 时间 / 文字筛选,新的在前,翻页', () => {
  const shop = 'filter.myshopify.com'; const t0 = at('2026-10-20T10:00:00Z');
  for (let i = 0; i < 5; i++) appendAudit(shop, { at: t0 + i * DAY, who: { id: i % 2 ? 'u1' : 'u2', name: i % 2 ? '甲' : '乙' }, mod: i < 3 ? 'banners' : 'price', text: `第 ${i} 条`, ok: true });
  assert.deepEqual(readAudit(shop).rows.map((r) => r.text), ['第 4 条', '第 3 条', '第 2 条', '第 1 条', '第 0 条']);
  assert.equal(readAudit(shop, { who: 'u1' }).rows.length, 2);
  assert.equal(readAudit(shop, { mod: 'price' }).rows.length, 2);
  assert.equal(readAudit(shop, { since: t0 + 3 * DAY }).rows.length, 2);
  assert.equal(readAudit(shop, { q: '甲' }).rows.length, 2);
  const p1 = readAudit(shop, { limit: 2 });
  assert.equal(p1.more, true);
  assert.deepEqual(readAudit(shop, { limit: 2, before: p1.rows[1].at }).rows.map((r) => r.text), ['第 2 条', '第 1 条']);
  assert.deepEqual(p1.people.map((p) => p.name).sort(), ['乙', '甲']);
});

test('接口翻成人话', () => {
  assert.deepEqual(describe('/schedule/act', { action: { type: 'save', isNew: true, kind: 'pin', values: { name: '黑五' } } }), ['pins', '新建Collection 置顶清单「黑五」']);
  assert.equal(tidy('新建Collection 置顶清单'), '新建 Collection 置顶清单');
  assert.deepEqual(describe('/schedule/col-hold', { release: true }), ['pins', '保留后台排序(不再按清单排)']);
});
