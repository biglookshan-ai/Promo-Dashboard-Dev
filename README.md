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
- **Scopes**: `read_products, read_metaobjects, read_metaobject_definitions, read_themes`
  + 排期系统(阶段 1a 起):`write_metaobject_definitions, write_metaobjects, write_files`
  + 首页 Banner 备用 Slide 同步进主题编辑器(2026-11-02):`write_themes`(只改首页模板里 Banner 轮播那一个 section 的 slide)
- **Distribution → Custom distribution** → cinegearpro 店铺 → install。

## 部署（Railway）

2026-11-23 晚间：已正式迁移到 Sealos，入口为 `https://promotion-cgp-hyizeqfa.cloud.sealos.io`。Railway 旧部署已移除，卷暂留作备份。以下 Railway 步骤仅供历史参考；当前恢复和部署以 `docs/sealos-migration/RUNBOOK.txt` 为准，禁止同时启用两套执行器。
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

## Sealos 数据与备份

保留现有 JSON 数据格式，持久盘挂在 `/data`，**当前正式 `DATA_DIR=/data/live-20261123`**，单实例运行，更新策略为 Recreate。未来迁移验收设置 `MIGRATION_MODE=staging`、`SCHEDULER_DISABLED=1`、`EXECUTOR_DISABLED=1`，业务接口与登录回调统一返回 503，且不启动缓存预热或任何执行器。正式运行才设 `MIGRATION_MODE=live`、两个禁用标记为 `0`。`REQUIRE_RESTORED_DATA=1` 要求恢复标记和业务文件存在、能正常解析，避免漏挂盘后以空数据启动。`GET /healthz` 用于探针。每次构建的 `APP_BUILD` 前12字符必须唯一，建议使用提交SHA，保证浏览器加载新资源。

`scripts/data-snapshot.mjs` 生成私有 tar.gz 和 SHA-256，恢复前检查压缩包、路径与全部文件哈希，并拒绝覆盖非空目录。`scripts/backup-loop.mjs` 每10分钟备份到独立备份盘，再由 restic 加密上传至私有 S3 兼容对象存储；保留本地最近18份和远端小时/日/周/月副本。在线副本包含跨文件状态，不等于停写后的最终交接快照。密钥、restic 密码、环境配置和备份包全部留在代码仓库外。

`scripts/migration-check.mjs --data <私有数据目录> --shopify-read-only` 只导入改价纯函数、只查询 Shopify 价格，输出计划状态、原价记录、差异和下一时段边界，不启动执行器、不保存业务数据、不发 mutation。它只核对指定快照，不能证明线上之后没有新增计划；切换前必须重新采集。
