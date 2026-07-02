// Cache the last inventory result per shop so opening the app is instant.
// Two layers: in-memory (survives repeated opens within a running instance,
// works even if the disk isn't persistent) + DATA_DIR file (survives redeploys
// when a Railway volume is mounted there).
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const fileFor = (shop) => path.join(DIR, `inventory-${String(shop).replace(/[^a-z0-9.-]/gi, '_')}.json`);
const mem = new Map();

export function getCached(shop) {
  if (mem.has(shop)) return mem.get(shop);
  try {
    const data = JSON.parse(fs.readFileSync(fileFor(shop), 'utf8'));
    mem.set(shop, data);
    return data;
  } catch { return null; }
}

export function setCached(shop, data) {
  mem.set(shop, data);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(fileFor(shop), JSON.stringify(data));
    console.log('[cache] wrote', fileFor(shop));
  } catch (e) {
    console.error('[cache] disk write FAILED (mount a volume at DATA_DIR):', e.message);
  }
}
