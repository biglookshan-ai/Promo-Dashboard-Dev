// 本地预览排期界面(演示模式):不用 Shopify 后台、不用登录,直接在浏览器里看。
// 去掉 App Bridge(它只在 Shopify 后台 iframe 里能用),其余文件原样从 public/ 提供。
//
//   node scripts/demo-preview.mjs   →  http://localhost:4790
// 注意:「工具」里的元数据总账 / 促销盘点要调后台接口,本地预览里用不了。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = +process.env.PORT || 4790;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // 浏览器和服务器共用的排期规则(和 src/server.js 一样只放行这两个文件)
  const LIB = { '/lib/schedule-core.js': 'schedule-core.js', '/lib/schedule-actions.js': 'schedule-actions.js' };
  if (LIB[p]) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(PUB, '..', 'src', LIB[p]))); }
  const file = path.join(PUB, p === '/' ? 'index.html' : p);
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    body = body.toString().replace(/<script src="https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js"[^>]*><\/script>/, '')
      .replace(/<ui-nav-menu>[\s\S]*?<\/ui-nav-menu>/, '')
      .replace(/%%API_KEY%%/g, 'local-preview');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log(`演示界面: http://localhost:${PORT}`));
