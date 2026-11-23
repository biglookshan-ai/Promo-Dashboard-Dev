import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshot, restore } from '../scripts/data-snapshot.mjs';
test('备份恢复保留计划、原价、授权；拒绝覆盖及损坏压缩包', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  try {
    const source = path.join(base, 'source'); fs.mkdirSync(path.join(source, 'price'), { recursive: true });
    fs.writeFileSync(path.join(source, 'tokens.json'), '{"test":"private-test-value"}');
    fs.writeFileSync(path.join(source, 'price/a.json'), '{"plans":[{"id":"a"}],"vault":{"v1":{"base":{"price":"100.00"}}}}');
    const result = snapshot(source, path.join(base, 'backups'));
    const target = path.join(base, 'restored'); restore(result.archive, target, result.sha256);
    assert.equal(fs.readFileSync(path.join(target, 'price/a.json'), 'utf8'), fs.readFileSync(path.join(source, 'price/a.json'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(target, 'tokens.json'), 'utf8'), fs.readFileSync(path.join(source, 'tokens.json'), 'utf8'));
    assert.throws(() => restore(result.archive, target, result.sha256), /为空/);
    assert.throws(() => restore(result.archive, path.join(base, 'bad'), '0'.repeat(64)), /SHA-256/);
    fs.writeFileSync(path.join(source, 'price/a.json'), '{broken'); assert.throws(() => snapshot(source, path.join(base, 'backups')));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
