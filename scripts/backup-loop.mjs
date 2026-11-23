import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshot } from './data-snapshot.mjs';
const destination = process.env.BACKUP_DIR || '/backups';
const interval = Number(process.env.BACKUP_INTERVAL_SECONDS || 600) * 1000;
if (!(interval >= 60000)) throw new Error('备份间隔必须至少 60 秒');
for (;;) {
  try {
    const result = snapshot(process.env.DATA_DIR || '/data', destination);
    // restic 对离盘副本再次加密；凭证只由 Secret 注入，不写入日志或命令参数。
    if (process.env.RESTIC_REPOSITORY) {
      execFileSync('restic', ['backup', result.archive, `${result.archive}.sha256`, '--tag', 'promotion', '--quiet'], { stdio: 'pipe', timeout: 180000 });
      execFileSync('restic', ['forget', '--tag', 'promotion', '--group-by', 'tags', '--keep-hourly', '24', '--keep-daily', '30', '--keep-weekly', '8', '--keep-monthly', '12', '--quiet'], { stdio: 'pipe', timeout: 120000 });
    }
    const archives = fs.readdirSync(destination).filter((x) => /^promotion-.*\.tar\.gz$/.test(x)).sort().reverse();
    for (const f of archives.slice(18)) { fs.rmSync(path.join(destination, f)); fs.rmSync(path.join(destination, `${f}.sha256`), { force: true }); }
    fs.writeFileSync(path.join(destination, 'status.json.tmp'), JSON.stringify({ at: new Date().toISOString(), ok: true, offVolume: !!process.env.RESTIC_REPOSITORY, ...result }), { mode: 0o600 });
    fs.renameSync(path.join(destination, 'status.json.tmp'), path.join(destination, 'status.json'));
    console.log('[backup] 完成', result.files, '个文件；离盘备份', !!process.env.RESTIC_REPOSITORY);
  } catch {
    console.error('[backup] 备份失败，保留已有副本，下轮重试');
    fs.writeFileSync(path.join(destination, 'last-error.json'), JSON.stringify({ at: new Date().toISOString(), error: 'backup-failed' }), { mode: 0o600 });
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
