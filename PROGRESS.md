# 进度 · Promo Dashboard(全站内容排期系统)

- **状态**: 开发中 / 已部署可用(只读工具部分)
- **进度**: 20%(按新方向重新计;旧的元数据工具已完成)
- **一句话**: 方向升级为「全站内容排期与监控」—— Banner / 顶栏每条独立排期,活动可把多处串起来;经审核后到点自动上线、到期全站自动消失,全程飞书提醒。设计 v2 已定稿(见 `PLAN.md`),下一步是阶段 0 同步线上主题。
- **分类**: Shopify App

## 🔨 进行中
- **阶段 0 收尾:渲染对比待做**。主题分支已就绪(见最近完成),差最后一步「把分支放到一个未发布主题上,和线上逐页对比 HTML」。这一步需要 `shopify theme push --unpublished`,属于要先征得用户同意的操作,等用户点头。
  - 分支:`feat/campaign-scheduling`,位于独立工作目录 `~/Vibe Coding Dev/Shopify Dev/_worktrees/cgp-theme-campaign`(主题仓库的 git worktree)
  - ⚠️ 此分支是「线上镜像 + 排期改动」,**不能整体合回共享仓库**:它不含其他项目尚未上线的 `assets/cgp-bundle-popup.js`、`templates/product.cgp-json.liquid`,整体合并会删掉它们

## ⏭ 下一步
- 阶段 0:同步线上主题(独立 worktree)→ 把产品页 11 个 custom_liquid 块抽成正式文件(外观零变化)。
- 阶段 1a:加权限 + Railway Postgres + 3 个 metaobject 定义 + 定时器 + 操作日志。**首次写操作上线前需再征得用户同意。**
- 阶段 1b:后台(排期总览 / Banner / 顶栏 / 活动)+ 审核流程(草稿→待审核→批准/退回)。
- 阶段 1c:飞书群机器人通知 —— 必须在主题发布前就位。
- 阶段 1d:主题改造第一期(Banner、顶栏、产品页徽章与统一倒计时),复制主题上做,用户挑倒计时样式、预览后发布。
- 待确认:飞书通知发哪个群、审核人是谁(1c 前);主题仓库 CLAUDE.md 误写 Plus 是否更正。

## 🏁 最近完成
- **阶段 0 · 主题同步与代码归档**(2026-09-29):
  - 只读拉取线上主题 `cinegearpro-2-0-1`(#183074816378)到独立 worktree,277 个文件与 6 月本地副本不同(线上多了 Setup Kit / FAQ 文件与 17 个编辑器新建模板)
  - 产品页 9 个粘贴代码块里,把 3 个促销相关的(Limited Time Offer / Promotion Info / 活动事件)**逐字节**搬进 `snippets/cgp-pdp-*.liquid`;模板只改 3 行,其余与线上深度一致;其余 6 个属于别的功能,不动
  - 线上现状更新:Banner 36 张(停用 19),在线 17 张里 **12 张新品**、4 张促销;顶栏只剩包邮一条 + 一个空文字的 clearance 残留位
  - 验证路线踩坑:`theme dev` 本地代理在本店全部 404;隐藏的开发主题不能匿名预览;**未发布主题可以**(带 cookie 握手)
- **设计 v2**(2026-09-29):改为**以内容为主**(Banner / 顶栏每条独立排期,活动只是可选的串联);加**审核流程 + 飞书通知**;确立「Shopify 只放已批准版本,改动先存 app 数据库,批准时才写入」。用户确认:Banner 不要手机图、倒计时全站统一、**非 Shopify Plus**、要审核并飞书提醒。
- **方向升级 + 设计定稿**(2026-09-29):勘查主题后写成 `PLAN.md`。关键结论 —— ① 活动为一等公民,内容可继承活动时间;② 上下线只靠切 metaobject publishable 状态(已核实 Liquid 只返回 ACTIVE),定时器自建;③ 活动产品 = 合集 + 额外单品,**app 不写产品数据**。用户已定:以合集为主可加单品、只管展示不改价、全市场统一、第一期做 Banner / 顶栏 / 产品页徽章倒计时。
- **主题勘查结论**:Banner 35 张 slide 里 19 张停用;顶栏 3 套整套开关且残留过期链接;Sale / Feature 已按合集取数;产品页促销是 11 个粘贴在编辑器里的代码块,倒计时复制了 6 份且只在浏览器里隐藏;**确认主题读的是产品端 `promotion_tag`**(metaobject 的 Product 列表从未被读)。
- **界面重做**(2026-09):Metafield / Metaobject 拆成两个独立顶层模块 + 促销盘点;卡片式列表(类型图标/徽章/层级排版)取代裸表格;分页(默认 25,可 50/100);每模块独立搜索与筛选;统一设计系统。引用类字段的 gid 批量解析成可读名称。
- **修 bug**:metafield 存在性筛选被 Shopify 静默忽略,导致明细返回全店产品(见 AGENTS.md 的坑)。
- **钻取**(2026-09):`src/drilldown.js` —— metafield 用 `products(query:"metafields.{ns}.{key}:*")` 官方筛选器只返命中的资源;metaobject 用 `Metaobject.referencedBy` 直接拿反向引用。两条都不用扫全站。明细带后台/前台深链(变体链接指向父产品)。
- **修 bug**:metaobject 行缺 `source` 字段,一选「来源」筛选就整表滤空(126 个定义显示无匹配)。
- **元数据总账**(2026-09):`src/registry.js` 列出三类 owner 的全部 metafield 定义 + 全部 metaobject 定义,带数据量计数、命名空间来源推断、`createdByApp` 创建者、疑似废弃标记。
- **主题扫描** `src/theme-scan.js`:用 GraphQL `theme.files`(通配符批量,一次最多 2500 个)抓 liquid/json/js,逐行索引 `metafields.<ns>.<key>` 与 `metaobjects.<type>`,给出文件+行号+代码片段。缺 `read_themes` 时优雅降级不报错。
- **人工标注层** `src/annotations.js`:给每个定义写用途/归属项目/状态,存 DATA_DIR。修掉一个 bug:空字符串状态之前会被回退成旧值,导致标注删不掉。
- 前端拆成两个顶层板块(总账 / 促销盘点),促销扫描改为切标签才懒加载,打开 app 不再卡全站扫描。
- 缓存模块泛化成按 name 区分数据集(inventory / registry)。
- 阶段0 促销盘点(2026-07):只读引擎 + 3 标签页 + CLI + 双层缓存;5 类一致性检查;实测 3938 产品 / 79 带促销 metafield / 0 用 activity_event / 73 有 offer_end。
