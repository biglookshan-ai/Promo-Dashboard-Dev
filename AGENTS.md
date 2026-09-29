# AGENTS.md — Promo Dashboard

> 本文件是给 **任何 AI 开发工具**(Claude Code / Cursor / 外部 agent)进入本项目时**先读**的规范。遵守它,开发成果才能被开发中枢正确收录、进度才看得到。

## 项目身份
- 显示名:**Promo Dashboard**
- slug:`promo-manager`
- 分类:Shopify App
- 本地路径:`~/Vibe Coding Dev/Shopify App/promo-manager`
- GitHub:https://github.com/biglookshan-ai/Promo-Dashboard-Dev.git
- 开发中枢(Apps Hub):`~/Vibe Coding Dev/Lark App/cinegearpro-apps-hub`;全项目总清单:`~/Vibe Coding Dev/PROJECTS.md`

## 开发规范(必须遵守)
1. **提交信息用 Conventional Commits**:`feat: …` / `fix: …` / `docs: …` / `refactor:` / `perf:` / `chore:` / `test:`;破坏性改动加 `!`(如 `feat!: …`)。**中枢靠提交前缀自动定版本号 + 生成 changelog —— 不守规版本和日志就乱。**
2. **绝不提交密钥**:`.env`、token、`*.key` 一律 gitignore,不入库、不外发。
3. 改了架构/技术栈 → 顺手更新本项目 `DOC.md`(若有)或 README。

## 开发完怎么反馈进度(重要)
做完一段,**更新本 repo 根目录的 `PROGRESS.md`**(它就是进度真源):
- `- **状态**:` / `- **进度**:<百分比>` / `- **一句话**:`
- `## 🔨 进行中` / `## ⏭ 下一步` / `## 🏁 最近完成`
然后按规范 commit + push。**中枢会自动从本 repo 读 `PROGRESS.md` 聚合,你无需碰中枢目录。**

## 怎么查看整体进度
- 中枢本地面板:hub 里 `node scripts/serve.js` → http://localhost:4787
- 飞书:知识库「App Doc」+ 多维表 Tasks / Versions
- 全项目一览:`~/Vibe Coding Dev/PROJECTS.md`

## 多 AI 协作
- 多个 AI 工具可能同时在不同项目/文件工作,**看到多出来的文件是正常的**。
- 「谁在做什么」登记在飞书任务板,避免撞车;跨项目大改动先在中枢开个任务。

## 本项目专属:关键与禁忌(所有 AI 工具都要读)

**定位**:**全站内容排期与监控系统**(2026-09-29 起的新方向,设计真源见 **`PLAN.md`**)。
顶栏 / 首页 Banner / 产品页徽章与倒计时等要定期更新的内容,在这里统一编排、排期、查看,到点自动上线、到期全站自动消失。
**已部署在 Railway 并在 Shopify 后台可用**;目前已上线的部分**全部只读、零 mutation**(排期功能尚未开发)。

现有板块(保留为「工具」):
1. **元数据总账**:所有自定义 metafield / metaobject 定义 —— 数据量、来源归属、主题哪个文件在读、人工用途备注。
2. **促销盘点**:促销/活动/倒计时的一致性检查。

### 排期系统的铁律(动手前必读 PLAN.md)

- **上下线只靠切 metaobject 的 publishable 状态**(DRAFT ↔ ACTIVE)。Liquid 遍历 `.values` 只返回 ACTIVE,主题里**不要写日期判断来决定显示与否**。
- **app 不写产品数据**:活动的产品 = 合集 + 活动自身的 `extra_products` 列表,由主题判断归属。别为了活动去给产品写 metafield,也别申请 `write_products`。
- **主题改造外观不变、只换数据源,且必须保留回退**:没有活动数据时显示原编辑器设置。
- **主题仓库是共享的**(`~/Vibe Coding Dev/Shopify Dev/cinegearpro-search-Development-test-1.0`,还装着搜索 / Setup Kit / FAQ):
  本地副本停在 2026-06-12,且有 FAQ 的未提交改动 → **拉线上主题必须在独立 worktree/分支做**,不能在主工作区拉。
- 主题改动只做在**复制出的未发布主题**上,由用户预览后自己发布。

### 关键

- **计数不用扫全站**:`metafieldsCount` / `metaobjectsCount` 由 API 直接给,总账秒出。只有促销盘点那套才需要扫 3938 个产品(所以它改成切到标签页才懒加载)。
- **Metafield 查不到「哪个 app 创建」** —— Shopify 没这个字段。归属只能靠三条线索:命名空间推断 + 主题扫描(`read_themes`,最硬证据)+ 人工标注(`src/annotations.js`,存 DATA_DIR)。
- **Metaobject 可以** —— `MetaobjectDefinition.createdByApp` / `createdByStaff` 直接给。
- 「疑似废弃」判据 = 零数据 **且** 主题扫描确认没引用;没扫主题时不下这个结论。
- 骨架照搬 search-panel-dev(App Bridge session token + OAuth token exchange)。
- 缓存两层(内存 + DATA_DIR 卷),`getCached(shop, name)` 按 name 区分 inventory / registry。

### ⛔ 坑:别用 metafield「存在性」筛选产品

`products(query: "metafields.{ns}.{key}:*")` **不要用**。官方只支持按**值**筛
(`metafields.{ns}.{key}:{value}`);这种存在性写法 Shopify **不报错、直接忽略
整个筛选条件**,把全店产品都返回来。症状:不同字段点进明细,列表一模一样,
数量还正好等于分页上限(2026-09 踩过)。

正确做法(`src/drilldown.js`):分页取回后**逐条核对 `metafield.value` 非空**,
只信实际取到的数据;并用总账的 `metafieldsCount` 当 `expected`,找齐就提前停。
明细页会显示「命中 N（扫描 M 个）」,对不上还会标黄警告 —— 别把这个提示去掉。

### ⛔ 注意

- 还没有任何写操作(标注只写本地 JSON,不回写 Shopify)。加 mutation 前先确认设计。
- 主题扫描**只读**,绝不改主题文件。
- Railway 的 App URL 必须是公网域名(`*.up.railway.app`),别填 `*.railway.internal`(内网,Shopify 解析不到)。
