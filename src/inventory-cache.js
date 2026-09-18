// Cache the last inventory result per shop so opening the app is instant.
// Two layers: in-memory (survives repeated opens within a running instance,
// works even if the disk isn't persistent) + DATA_DIR file (survives redeploys
// when a Railway volume is mounted there).
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const safe = (s) => String(s).replace(/[^a-z0-9.-]/gi, '_');
// name 区分不同数据集(inventory / registry …),默认沿用原来的 inventory。
const fileFor = (shop, name) => path.join(DIR, `${name}-${safe(shop)}.json`);
const memKey = (shop, name) => `${name}:${shop}`;
const mem = new Map();

export function getCached(shop, name = 'inventory') {
  const k = memKey(shop, name);
  if (mem.has(k)) return mem.get(k);
  try {
    const data = JSON.parse(fs.readFileSync(fileFor(shop, name), 'utf8'));
    mem.set(k, data);
    return data;
  } catch { return null; }
}

export function setCached(shop, data, name = 'inventory') {
  mem.set(memKey(shop, name), data);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(fileFor(shop, name), JSON.stringify(data));
    console.log('[cache] wrote', fileFor(shop, name));
  } catch (e) {
    console.error('[cache] disk write FAILED (mount a volume at DATA_DIR):', e.message);
  }
}
