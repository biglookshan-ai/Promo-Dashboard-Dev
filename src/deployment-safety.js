import fs from 'node:fs';
import path from 'node:path';

export const stagingMode = () => process.env.MIGRATION_MODE === 'staging';

// 验收实例完全禁止 API 和登录回调，连 GET 的隐式写入也不放行。
export function stagingGate(req, res, next) {
  if (stagingMode() && /^\/(api|auth)(\/|$)/i.test(req.path)) {
    return res.status(503).set('Cache-Control', 'no-store').json({ error: '迁移验收环境，操作尚未开放', code: 'MIGRATION_STAGING' });
  }
  next();
}

// Sealos 必须显式指定数据路径和非空标记，防止漏挂数据盘后悄悄以空数据启动。
export function assertDeploymentData() {
  if (process.env.REQUIRE_RESTORED_DATA !== '1') return;
  const dir = process.env.DATA_DIR;
  if (!dir || !path.isAbsolute(dir)) throw new Error('DATA_DIR 必须是持久化数据盘的绝对路径');
  const marker = JSON.parse(fs.readFileSync(path.join(dir, '.promotion-restored.json'), 'utf8'));
  if (marker.application !== 'promo-manager' || !Array.isArray(marker.requiredFiles) || !marker.requiredFiles.length) throw new Error('缺少有效的数据恢复标记');
  for (const f of marker.requiredFiles) {
    if (!/^[a-z0-9_.\/-]+$/i.test(f) || f.split('/').includes('..')) throw new Error('恢复标记路径无效');
    const value = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (f.startsWith('price/') && (!Array.isArray(value.plans) || !value.vault || typeof value.vault !== 'object')) throw new Error('改价数据不完整');
  }
}
