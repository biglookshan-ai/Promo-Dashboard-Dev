# 进度 · Promo Dashboard(全站内容排期系统)

- **状态**: 开发中 / 已部署可用(只读工具部分)
- **进度**: 15%(按新方向重新计;旧的元数据工具已完成)
- **一句话**: 方向升级为「全站内容排期与监控」—— 活动带时间,自动投放到顶栏 / Banner / 产品页,到期全站自动消失。设计与分期已定稿(见 `PLAN.md`),下一步是阶段 0 同步线上主题。
- **分类**: Shopify App

## 🔨 进行中
- 阶段 0 准备:在主题仓库的**独立 worktree/分支**拉取线上最新主题(本地副本停在 2026-06-12;主工作区有 FAQ 未提交改动,不能在那拉)。

## ⏭ 下一步
- 阶段 0:同步线上主题 → 把产品页 11 个 custom_liquid 块抽成正式文件(外观零变化)。
- 阶段 1a:加权限(`write_metaobject_definitions` / `write_metaobjects` / `read_files` / `write_files`)→ 建 3 个 metaobject 定义(活动 / 顶栏 / Banner)→ 定时器 + 操作日志。**首次写操作上线前需再征得用户同意。**
- 阶段 1b:后台排期总览(时间轴)+ 活动 / Banner / 顶栏编辑器。
- 阶段 1c:主题改造第一期(Banner、顶栏、产品页徽章与倒计时),在复制主题上做,用户预览后发布。
- 待确认(不阻塞):Banner 是否要单独手机图、倒计时样式、是否 Shopify Plus、是否需要审核流程。

## 🏁 最近完成
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
