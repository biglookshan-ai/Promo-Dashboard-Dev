// Persist the last inventory result per shop to DATA_DIR (Railway volume),
// so opening the app shows data instantly instead of re-scanning every time.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const fileFor = (shop) => path.join(DIR, `inventory-${String(shop).replace(/[^a-z0-9.-]/gi, '_')}.json`);

export function getCached(shop) {
  try { return JSON.parse(fs.readFileSync(fileFor(shop), 'utf8')); }
  catch { return null; }
}

export function setCached(shop, data) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(fileFor(shop), JSON.stringify(data));
  } catch (e) {
    console.error('inventory cache write failed (set DATA_DIR to a volume):', e.message);
  }
}
