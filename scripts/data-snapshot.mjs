// 标准 tar.gz + SHA-256 清单；包含 tokens.json，必须作为私有备份保存。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function files(root, rel = '') {
  return fs.readdirSync(path.join(root, rel)).sort().flatMap((name) => {
    if (name === 'lost+found' || name.endsWith('.tmp')) return [];
    const p = path.posix.join(rel, name);
    if (!/^[a-z0-9_.\/-]+$/i.test(p)) throw new Error('数据文件名含不支持的字符');
    const s = fs.lstatSync(path.join(root, p));
    if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) throw new Error('数据目录不能包含链接或特殊文件');
    return s.isDirectory() ? files(root, p) : [p];
  });
}
function manifest(root) {
  return files(root).map((name) => { const bytes = fs.readFileSync(path.join(root, name)); return { name, bytes: bytes.length, sha256: sha(bytes) }; });
}
function validate(root) {
  for (const name of files(root)) {
    if (name.startsWith('theme-backup/')) continue; // 主题 JSON 可以有 Shopify 生成的注释
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    if (name.endsWith('.json')) JSON.parse(text);
    if (name.endsWith('.jsonl')) for (const line of text.split('\n')) if (line.trim()) JSON.parse(line);
  }
}
export function snapshot(source, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const stage = fs.mkdtempSync(path.join(destination, '.snapshot-'));
    let partial;
    try {
      const before = manifest(source);
      if (!before.some((x) => x.name.startsWith('price/') && x.name.endsWith('.json') && !x.name.endsWith('.planhist.json'))) throw new Error('没有改价主数据，拒绝备份空盘');
      const copy = path.join(stage, 'data'); fs.mkdirSync(copy);
      for (const { name } of before) { const p = path.join(copy, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(source, name), p); fs.chmodSync(p, 0o600); }
      if (JSON.stringify(before) !== JSON.stringify(manifest(copy)) || JSON.stringify(before) !== JSON.stringify(manifest(source))) throw new Error('备份期间源文件变化，请重试');
      validate(copy);
      const meta = { format: 1, application: 'promo-manager', at: new Date().toISOString(), build: process.env.APP_BUILD || 'local', consistency: 'online-files-not-a-database-transaction', files: before };
      fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(meta, null, 2), { mode: 0o600 });
      const name = `promotion-${meta.at.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.tar.gz`;
      const archive = path.join(destination, name); partial = `${archive}.partial`;
      execFileSync('tar', ['-czf', partial, '-C', stage, 'manifest.json', 'data'], { stdio: 'pipe' }); fs.chmodSync(partial, 0o600);
      const digest = sha(fs.readFileSync(partial));
      fs.renameSync(partial, archive);
      fs.writeFileSync(`${archive}.sha256`, `${digest}  ${name}\n`, { mode: 0o600 });
      return { archive, sha256: digest, files: before.length, bytes: before.reduce((n, x) => n + x.bytes, 0), consistency: meta.consistency };
    } catch (e) {
      if (attempt === 2) throw e;
    } finally { fs.rmSync(stage, { recursive: true, force: true }); if (partial) fs.rmSync(partial, { force: true }); }
  }
}
export function restore(archive, target, expectedDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest || '') || sha(fs.readFileSync(archive)) !== expectedDigest) throw new Error('压缩包 SHA-256 不匹配');
  if (fs.existsSync(target) && fs.readdirSync(target).some((x) => x !== 'lost+found')) throw new Error('恢复目录必须为空；禁止覆盖运行数据');
  const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (members.some((s) => !/^(manifest\.json|data\/?|data\/[a-z0-9_.\/-]+)$/i.test(s) || s.split('/').includes('..'))) throw new Error('压缩包包含不安全的路径');
  const types = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (types.some((s) => !['-', 'd'].includes(s[0]))) throw new Error('压缩包不能包含链接或特殊文件');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-restore-'));
  try {
    execFileSync('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', stage], { stdio: 'pipe' });
    const meta = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
    const root = path.join(stage, 'data');
    if (meta.application !== 'promo-manager' || meta.format !== 1 || JSON.stringify(meta.files) !== JSON.stringify(manifest(root))) throw new Error('解压后的文件清单或哈希不匹配');
    validate(root); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.cpSync(root, target, { recursive: true });
    return { files: meta.files.length, sourceAt: meta.at, consistency: meta.consistency };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [op, a, b, c] = process.argv.slice(2);
  if (op === 'create' && a && b) console.log(JSON.stringify(snapshot(path.resolve(a), path.resolve(b))));
  else if (op === 'restore' && a && b && c) console.log(JSON.stringify(restore(path.resolve(a), path.resolve(b), c)));
  else throw new Error('用法: data-snapshot.mjs create <数据目录> <备份目录> | restore <压缩包> <空目录> <SHA256>');
}
