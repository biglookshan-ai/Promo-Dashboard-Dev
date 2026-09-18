// 人工标注层:给每个 metafield / metaobject 定义写「用途 / 归属项目 / 状态」。
//
// 为什么必须有这层:Shopify 的 MetafieldDefinition 没有「哪个 app 创建」字段,
// 更不可能知道「这个字段是给 Setup Kit section 用的」。命名空间能猜、主题扫描
// 能证明被谁读取,但「为什么存在、归哪个项目」只有人知道 —— 所以存在本地。
//
// 存 DATA_DIR(Railway 卷),纯本地数据,不写回 Shopify。
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'annotations.json');

export const STATUSES = ['在用', '待确认', '待废弃', '已废弃'];

let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { cache = {}; }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[annotations] 写入失败(DATA_DIR 要挂卷):', e.message);
  }
}

// 全部标注,按 shop 隔离(同一份部署理论上可服务多店)。
export function getAll(shop) {
  return load()[shop] || {};
}

// key 形如 `PRODUCT:custom.offer_end` 或 `metaobject:promotion_info`
export function setOne(shop, key, patch) {
  load();
  if (!cache[shop]) cache[shop] = {};
  const prev = cache[shop][key] || {};
  // 传空字符串 = 明确清空该项;传 undefined = 保留原值。
  // (不区分这两者的话,状态永远清不掉,标注也就删不掉。)
  const pickStatus = () => {
    if (patch.status === '') return '';
    if (STATUSES.includes(patch.status)) return patch.status;
    return prev.status || '';
  };
  const next = {
    purpose: patch.purpose ?? prev.purpose ?? '',
    project: patch.project ?? prev.project ?? '',
    status: pickStatus(),
    updatedAt: new Date().toISOString(),
  };
  // 三项都空 = 删除这条标注,别留空壳
  if (!next.purpose && !next.project && !next.status) delete cache[shop][key];
  else cache[shop][key] = next;
  persist();
  return next;
}
