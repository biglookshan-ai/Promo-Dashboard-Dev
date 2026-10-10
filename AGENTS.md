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
**已部署在 Railway 并在 Shopify 后台可用**。排期界面两种模式:店里没建好内容类型 / 本地预览 = 演示模式;在后台打开且建好了 = 正式数据(写店铺)。

现有板块(保留为「工具」):
1. **元数据总账**:所有自定义 metafield / metaobject 定义 —— 数据量、来源归属、主题哪个文件在读、人工用途备注。
2. **促销盘点**:促销/活动/倒计时的一致性检查。

### 排期系统的铁律(动手前必读 PLAN.md)

- **v3(2026-10-10)起活动是总控台**:活动下挂工作项(改价、Banner、顶栏、设计需求、宣传物料…),每项有负责人 / 审批人 / 抄送;但常驻内容仍可不挂活动、独立排期。设计真源 PLAN.md「v3」一节。
- **Shopify 里只放「已批准」的版本**:编辑中 / 待审核的改动存在 app 数据库,**批准时才写入 metaobject**。绝不能把未批准的改动直接写进 Shopify —— 改一条正在上线的内容会立刻出现在前台,绕过审核。
- **只有已批准的内容能被定时器上线**;审核人自己的改动自动批准。
- **上下线只靠切 metaobject 的 publishable 状态**(DRAFT ↔ ACTIVE)。Liquid 遍历 `.values` 只返回 ACTIVE,主题里**不要写日期判断来决定显示与否**。开了 publishable 后新建条目默认是 DRAFT。
- 飞书通知用**群机器人 webhook**(lark-ops 是本地个人 token 工具,Railway 用不了)。webhook 地址不进代码仓库。
- 店铺**不是 Shopify Plus**(主题仓库 CLAUDE.md 误写 Plus)。
- **只有改价模块能写产品数据,且只写两样**:变体的 `price` / `compareAtPrice`,以及改价时段指定的**手动合集**成员(v3 起,用户 10/10 决定并入改价)。活动圈定产品仍 = 活动自身存的合集 + 标签 + 指定产品;别给产品写 metafield / 打标签。改价的安全规则(原价保险库、写前意图、读回核对、手动改价暂停接管)照搬 `../price-scheduler-app/AGENTS.md` 铁律。
- **Banner 是竖图卡片 430×600**(手机 320×450),后台预览一律按主题真实尺寸 / 字号 / 角标颜色画(`scripts/build-demo-seed.mjs` 从主题设置读出,别写死横图比例)。
- **主题改造外观不变、只换数据源,且必须保留回退**:没有活动数据时显示原编辑器设置。
- **主题仓库是共享的**(`~/Vibe Coding Dev/Shopify Dev/cinegearpro-search-Development-test-1.0`,还装着搜索 / Setup Kit / FAQ):
  本地副本停在 2026-06-12,且有 FAQ 的未提交改动 → **拉线上主题必须在独立 worktree/分支做**,不能在主工作区拉。
- 主题改动只做在**复制出的未发布主题**上,由用户预览后自己发布。
  ⚠️ **测试主题的编辑器配置(templates/*.json)停在 9/29**,不能整套发布;上线时只搬代码文件(清单见 PLAN.md「发布清单」)。
- **首页商品模块**:到时间整套替换(标题 + 页签),每个模块一个平时版本;页签条目不开 publishable、跟着版本走 —— 别给页签单独排期。主题里两个 section 默认只在首页(`template.name == 'index'`)读排期。

### 关键

- **规则只有一份**:`src/schedule-core.js`(上下线判断)+ `src/schedule-actions.js`(存草稿 / 提交 / 发布 / 批准 / 退回 / 暂停 / 删除 / 排序,含权限检查)是纯函数,**服务器和浏览器共用**(服务器以 `/lib/*.js` 只放行这两个文件给页面 import)。演示模式在浏览器里跑它,正式模式由服务器跑。**别在 `public/schedule.js` 里再写一套规则。**
- 服务端文件:`schedule-store.js`(数据存 `DATA_DIR/schedule/<shop>.json`,暂不用 Postgres)、`schedule-api.js`(`/api/schedule/*` 接口)、`sync.js`(动作的副作用:写 Shopify 条目 / 位置 / 删除 / 发飞书;**每个店铺一把锁**,动作和定时器排队执行)、`metaobjects.js`(6 个定义 + 字段映射;核心 4 个 + 首页商品模块的版本 / 页签,后加的缺了只提示补建)、`files.js`(图片上传 / 按文件名找图)、`theme-content.js` + `theme-import.js`(读主题、导入)、`counts.js`(Admin API 计数,含「静默忽略」防护)、`lark.js` + `notifier.js`(飞书)、`scheduler.js`(每分钟对齐 + 每天 10:00 汇总,`SCHEDULER_DISABLED=1` 可关)。改完先跑 `npm test`(100 个,含改价的 39 个)。
- **本地测正式数据**:`node scripts/live-harness.mjs --fresh` → http://localhost:4793(`?user=1002` 是第二个人;`--core-only` 模拟只建了核心 4 个类型的老店)。真的 app 服务器 + 假 Shopify(内存,主题文件读本地 worktree,产品数读 `scripts/demo-catalog.json`),`http://localhost:4794/__state` 看写进「店铺」的东西。只靠 `SHOPIFY_GRAPHQL_ORIGIN` 环境变量指过去,线上别设。
- **建内容类型、从主题导入**都只能由用户在「设置 → 店铺连接」点按钮触发,别在部署 / 启动时自动做。
- 认人:**v3 起改为飞书登录**(店里多人共用 Shopify 账号);Shopify session token 只证明「从本店后台打开」。第一次登录的人默认「待分配」,管理员分配角色后才能用;第一个管理员 = 第一个从 Shopify 后台里用飞书登录的人。(v2 旧做法:session token 的 `sub` = 员工 id、第一个打开的人是审核人。)
- **飞书登录(v3 3.1)**:`src/lark-login.js`(授权 / 换 token / 读用户信息 + app 会话签名,签名密钥由 `SHOPIFY_API_SECRET` 派生)、`src/members.js`(成员 / 角色 / 页面权限,纯函数)、`src/auth-routes.js`(登录回调、/api/me、/api/members、/api/roles)、`src/auth-embedded.js` 的 `requireAccess` / `needMember`、页面 `public/auth.js`(登录门)。
  **只在 Railway 填了 `LARK_APP_ID` + `LARK_APP_SECRET` 时开启**;没填就和以前一样只认 Shopify(别把这个回退去掉)。飞书凭证只放环境变量,不进代码、不写日志。
  后台 iframe 里登录用弹窗(弹窗被拦就给「新窗口打开」链接);直接开网页用整页跳转。
  **防冒充(别去掉)**:弹窗模式的会话只能用飞书回调页显示的 6 位验证码换(弹窗自动传回,传不回就手输;错 5 次作废、只能用一次)——
  否则有人把自己发起的登录链接发给管理员点,就能拿到管理员身份。网页模式靠 `/auth/lark/start` 种的 cookie 核对是同一个浏览器。
  **谁能成为管理员**:设了 `LARK_ADMIN_IDS`(飞书 open_id,逗号分隔)→ 只有名单里的人,且每次登录都保证是启用的管理员;
  没设 → 只有「第一个从 Shopify 后台里登录的人」一次,之后 `bootstrapDone` 永久关门。停用成员立即生效(每个请求都查成员状态)。本地测:`node scripts/live-harness.mjs --fresh --lark`(假飞书,可选测试管理员 / 员工 / 设计)。
- **改价模块(v3 3.2,从 `../price-scheduler-app` 搬入)**:`src/price/`(`price-core.js` 规则 + `price-actions.js` 动作和权限 —— 纯函数,页面经 `/lib/price-*.js` 共用;`executor.js` 每分钟对齐价格;`shop-io.js` 唯一写价格 / 合集的地方;`catalog.js` 选产品;`notifier.js` **只私信相关的人、不发群**;`api.js` 挂 `/api/price`,server.js 用 `needMember('price')` 限定定价角色 + 管理员)。数据在 `DATA_DIR/price/`,和排期分开。
  每个计划可指定审批人(`approver`)/ 负责人(`owner`)/ 抄送(`cc`),只能选能看改价页的成员;没指定审批人 = 管理员审批;审批人自己提交直接生效。
  **界面按原来那个 Simple Product Price Scheduler 的做法**(2026-10-10 用户给了截图):一个计划 = 一条规则 + 一个时间段(没有多时段 / 每日日程,Flash 每天用「复制成下一天」);
  表单从上往下填(名称 → 改什么价 → 改哪些产品 → 什么时候 → 产品标签 → 负责人审批 → 划线价 → 试算预览),右边常驻一段大白话摘要;逐个变体的价格收在「试算预览」里。
  `plan.scope`(all / collections / products / search)+ `plan.rule` 存下来,点「试算预览」或保存时重新算出 `slots[0].items`;手改过价的变体带 `manual`,重算时保留。
  `plan.tagsAdd` / `tagsRemove`:生效期间加减产品标签(驱动按标签自动归类的合集),结束还原;只动计划里填的标签,产品本来就有的不碰(`price-core.planTags` + `state.tagState` 记账)。
  页面 `public/price.js`(点开「改价」才加载),样式在 style.css 末尾、**全部限定在 `#section-price` 里**,和排期页同名的样式加了 `pr-` 前缀 —— 别去掉,否则两边互相干扰。
  飞书私信:`src/lark-bot.js`(同一个飞书应用的机器人,需要 `im:message:send_as_bot`)。本地测:harness 的 `/__price`(改过价的变体)、`/__price/set`(模拟手动改价)、`/__dms`(发出的私信),产品数据 `node scripts/fetch-price-catalog.mjs`。
- 本地看演示界面:`node scripts/demo-preview.mjs`(端口 4790)。
- 后台跑在 Shopify 后台的 iframe 里:**别用 `prompt()` / `confirm()` / `alert()`**(跨域 iframe 可能被浏览器拦截),用页面内输入框和「再点一次确认」。
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

- 写操作只限:建 `cgp_*` 内容类型、写 / 切换 `cgp_*` 条目、上传 Banner 图片。**别碰产品、主题、别的 app 的数据**;新增任何其他 mutation 前先和用户确认设计。
- 主题扫描**只读**,绝不改主题文件。
- Railway 的 App URL 必须是公网域名(`*.up.railway.app`),别填 `*.railway.internal`(内网,Shopify 解析不到)。
