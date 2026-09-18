// 扫描主题源码,找出每个 metafield / metaobject 被哪些文件第几行读取。
// 这是判断「这个字段是主题在用,还是某个 app 的」最硬的证据 —— 命名空间只能猜,
// 主题里搜到 `product.metafields.custom.xxx` 就是铁证。
//
// 需要 read_themes 权限;没授权时返回 null(带原因),总账照常显示只是少一列。
import { graphql } from './shopify.js';

// files 连接的 filenames 最多 50 个模式,* 匹配任意字符。按目录枚举更稳。
const PATTERNS = [
  'layout/*.liquid',
  'sections/*.liquid',
  'sections/*.json',
  'snippets/*.liquid',
  'blocks/*.liquid',
  'templates/*.liquid',
  'templates/*.json',
  'templates/customers/*.liquid',
  'assets/*.js',
  'assets/*.liquid',
  'config/*.json',
];

// product.metafields.custom.offer_end  /  metafields["custom"]["offer_end"]
const RE_DOT = /metafields\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g;
const RE_BRACKET = /metafields\[\s*["']([^"']+)["']\s*\]\s*\[\s*["']([^"']+)["']\s*\]/g;
// shop.metaobjects.product_activity_event
const RE_METAOBJECT = /metaobjects\.([A-Za-z0-9_-]+)/g;

async function listThemes(ctx) {
  const d = await graphql(ctx, `query{ themes(first:20){ nodes{ id name role } } }`);
  return d.themes.nodes;
}

async function fetchFiles(ctx, themeId) {
  const files = [];
  let cursor = null;
  do {
    const d = await graphql(
      ctx,
      `query($id:ID!,$patterns:[String!],$cursor:String){
        theme(id:$id){
          files(first:250, filenames:$patterns, after:$cursor){
            pageInfo{ hasNextPage endCursor }
            nodes{
              filename
              body{ ... on OnlineStoreThemeFileBodyText { content } }
            }
          }
        }
      }`,
      { id: themeId, patterns: PATTERNS, cursor }
    );
    const c = d.theme?.files;
    if (!c) break;
    files.push(...c.nodes.filter((n) => n.body && typeof n.body.content === 'string'));
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (cursor);
  return files;
}

// 逐行扫,记下每个 ns.key / metaobject type 出现在哪个文件哪一行。
function indexFiles(files) {
  const metafields = new Map();
  const metaobjects = new Map();
  const add = (map, key, hit) => {
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (list.length < 40) list.push(hit); // 同一个字段最多记 40 处,够定位了
  };

  for (const f of files) {
    const lines = f.body.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('metafield') && !line.includes('metaobject')) continue;
      const hit = { file: f.filename, line: i + 1, snippet: line.trim().slice(0, 160) };

      for (const re of [RE_DOT, RE_BRACKET]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) add(metafields, `${m[1]}.${m[2]}`, hit);
      }
      RE_METAOBJECT.lastIndex = 0;
      let m;
      while ((m = RE_METAOBJECT.exec(line)) !== null) add(metaobjects, m[1], hit);
    }
  }
  return { metafields, metaobjects };
}

// themeId 省略时扫已发布(MAIN)主题。
export async function scanTheme(ctx, { themeId = null } = {}) {
  let themes;
  try {
    themes = await listThemes(ctx);
  } catch (e) {
    // 最常见:没加 read_themes 权限
    return { ok: false, reason: `读不到主题(多半缺 read_themes 权限): ${e.message}` };
  }
  const target = themeId
    ? themes.find((t) => t.id === themeId)
    : themes.find((t) => t.role === 'MAIN') || themes[0];
  if (!target) return { ok: false, reason: '店铺里没找到主题' };

  const files = await fetchFiles(ctx, target.id);
  const index = indexFiles(files);
  return {
    ok: true,
    theme: { id: target.id, name: target.name, role: target.role, fileCount: files.length },
    themes: themes.map((t) => ({ id: t.id, name: t.name, role: t.role })),
    metafields: index.metafields,
    metaobjects: index.metaobjects,
  };
}
