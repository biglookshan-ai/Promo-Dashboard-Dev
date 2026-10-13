// 定时器只扫店铺数据文件,别把历史文件当成店铺;历史文件里被误写进的东西读的时候清掉
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-files-'));
process.env.DATA_DIR = tmp;
fs.mkdirSync(path.join(tmp, 'schedule'), { recursive: true });
const { listShops } = await import('../src/schedule-store.js');
const { cleanColHistory } = await import('../src/col-history.js');
const { cleanItemHistory } = await import('../src/item-history.js');

test('listShops 不把历史文件当店铺', () => {
  for (const f of ['a.myshopify.com.json', 'a.myshopify.com.colhist.json', 'a.myshopify.com.itemhist.json', 'a.myshopify.com.planhist.json']) fs.writeFileSync(path.join(tmp, 'schedule', f), '{}');
  assert.deepEqual(listShops(), ['a.myshopify.com']);
});

test('被误写进排期数据的历史文件,读的时候清干净', () => {
  const polluted = { version: 2, banners: [{ id: 'b-1', kind: 'banner' }], log: [], roles: null, '673810710906': [{ at: 1, ids: ['1', '2'] }] };
  assert.deepEqual(Object.keys(cleanColHistory(polluted)), ['673810710906']);
  const ih = { version: 2, banners: [], roles: null, 't-1': { kind: 'topbar', title: 'x', versions: [] } };
  assert.deepEqual(Object.keys(cleanItemHistory(ih)), ['t-1']);
});
