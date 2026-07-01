# promo-manager — CineGearPro 促销活动管理（嵌入式）

嵌入式 Shopify admin app，用于可视化管理促销/活动数据模型：
1. **数据盘点**（已实现）— 扫描 `product_activity_event` / `promotion_info` metaobject 与产品 metafield，核对迁移前的一致性问题。
2. 数据模型重整 + 迁移（下一步）
3. 同步引擎：活动 metaobject → 反向写回产品 metafield（规划中）
4. Dashboard 时间轴总览 + 批量挂载产品（规划中）

认证 = **App Bridge session token + OAuth token exchange**（无重定向 OAuth），复用 `search-panel-dev` 的成熟骨架。

## Partner app 配置（Promo Dashboard Dev）
- **embedded: true**，Use legacy install flow: **false**（managed install）
- **App URL**: `https://<railway-url>`（先部署再回填，别留 example.com）
- **Scopes**: `read_products, read_metaobjects, read_metaobject_definitions`
  （之后做迁移/同步再加 `write_metaobjects, write_products`）
- **Distribution → Custom distribution** → cinegearpro 店铺 → install。

## 部署（Railway）
1. push 到 GitHub → Railway → Deploy from GitHub → 本仓库。
2. 加一个 **Volume** 挂到 `/data`（换 token 后跨部署留存）。
3. **Variables**：
   - `SHOPIFY_API_KEY` = Client ID
   - `SHOPIFY_API_SECRET` = Client secret
   - `SHOPIFY_API_VERSION` = `2026-04`
   - `DATA_DIR` = `/data`
4. 把 Partner app 的 **App URL** 设成 Railway 地址。
5. 从 **Shopify 后台 → Apps → Promo Dashboard Dev** 打开（在后台内加载，App Bridge
   发 session token，服务端自动换 Admin API token）。直接开 Railway URL 会提示
   “请从 Shopify 后台打开”，属正常。

## CLI 盘点（可选，用固定 token，不经过 app）
```bash
npm install
SHOPIFY_SHOP=cinegearpro.myshopify.com \
SHOPIFY_ADMIN_TOKEN=shpat_xxx \
npm run inventory
# → out/inventory-report.md + out/inventory-raw.json
```
token 需要 `read_products, read_metaobjects, read_metaobject_definitions`。
注意 `shpat_`（Admin API access token）不是 `shpss_`（API secret key）。

## 本地跑服务端
```bash
npm install
cp .env.example .env    # 填 API key/secret
npm start               # 仍需从 Shopify 后台打开才能拿到 session token
```
