import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDeploymentData, stagingGate } from '../src/deployment-safety.js';

test('验收模式阻止所有 API 与登录回调，包括有隐式写入的 GET', () => {
  process.env.MIGRATION_MODE = 'staging';
  for (const route of ['/api/price/state', '/api/price/act', '/auth/lark/callback', '/API/schedule/state']) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      let status; let body;
      const res = { status(n) { status = n; return this; }, set() { return this; }, json(x) { body = x; } };
      stagingGate({ path: route, method }, res, () => assert.fail('验收模式放过了业务请求'));
      assert.equal(status, 503); assert.equal(body.code, 'MIGRATION_STAGING');
    }
  }
  let passed = false;
  stagingGate({ path: '/healthz' }, {}, () => { passed = true; }); assert.ok(passed);
  delete process.env.MIGRATION_MODE;
});

test('漏挂、缺失、损坏数据盘时拒绝启动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-data-'));
  process.env.DATA_DIR = dir; process.env.REQUIRE_RESTORED_DATA = '1';
  try {
    assert.throws(assertDeploymentData);
    fs.mkdirSync(path.join(dir, 'price'));
    fs.writeFileSync(path.join(dir, '.promotion-restored.json'), JSON.stringify({ application: 'promo-manager', requiredFiles: ['price/a.json'] }));
    fs.writeFileSync(path.join(dir, 'price/a.json'), '{}'); assert.throws(assertDeploymentData);
    fs.writeFileSync(path.join(dir, 'price/a.json'), JSON.stringify({ plans: [], vault: {} })); assert.doesNotThrow(assertDeploymentData);
    fs.writeFileSync(path.join(dir, '.promotion-restored.json'), JSON.stringify({ application: 'promo-manager', requiredFiles: ['../outside.json'] })); assert.throws(assertDeploymentData);
  } finally {
    fs.rmSync(dir, { recursive: true }); delete process.env.REQUIRE_RESTORED_DATA; delete process.env.DATA_DIR;
  }
});
