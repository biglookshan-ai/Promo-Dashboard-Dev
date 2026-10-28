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
- **主题改动直接推正式主题**(2026-10-17 用户授权:「以后所有的修改直接推主题」):改完推正式 cinegearpro-2-0-1 #183074816378,测试主题 #186525057402 同步。安全流程不能省:推前拉线上文件和上次发布版比对(有人改过就三方合并)、主题分支 `docs/releases/<日期>-<名字>/` 存 before/after/README、`--allow-live --nodelete --only` 从干净临时目录推、推后拉回逐字节核对并在正式网站实测。整套发布 / 改用户在编辑器排的模板 JSON / 删文件仍要先问。
  ⚠️ **测试主题的编辑器配置(templates/*.json)停在 9/29**,不能整套发布;上线时只搬代码文件(清单见 PLAN.md「发布清单」)。
- **首页商品模块**:到时间整套替换(标题 + 页签),每个模块一个平时版本;页签条目不开 publishable、跟着版本走 —— 别给页签单独排期。主题里两个 section 默认只在首页(`template.name == 'index'`)读排期。

### 界面规范(2026-10-20 整体改版,新功能照这个做,别再各写一套)
- **外框**:左侧分组导航(`index.html` 的 `.sidenav` / `#modnav`,分组 = 工作台 / 网站内容 / 商品与链接 / 其他;按钮仍是 `.modnav__item[data-section]`,可收起,记在 localStorage `cgp-nav-mini`)。
- **视觉**:颜色、字号只用 `style.css` 顶部 `:root` 的变量;字号只有 5 种(12 / 13 / 14 / 18 / 22,前台预览除外);状态颜色全站一套(上线中绿、已排期蓝、草稿灰、待审核琥珀、暂停橙、已结束浅灰)。组件统一样子写在 style.css 末尾「设计规范 v2」。
- **列表页**:`pageHead(标题, 一句话说明, 新建按钮)` → (可选)预览 / 时间轴面板 → `ptoolHtml(页面key, 列表, 右边按钮)`(状态筛选 + 搜索)→ `ilistHtml(items.map((x) => itemRow(x, {...})))`。
  一页里有两类东西用 `subTabsHtml`(如顶栏的公告 / 节日样式、首页模块的促销 / 推荐)。别再新写 xxrow / xxcard 列表。
- **编辑器**:`formHtml` 里用 `edSec(序号, 标题, 提示, 内容)` 分段,顺序 = 内容 → 作用范围 → 产品上显示什么 → **「什么时候显示」永远最后一段**(`timeBlock` 自己不再带标题)。
  **例外:合集排序(置顶清单)编辑器**(2026-10-21 用户要求「设置都放上面,下面就是改顺序显示全部产品」):① 清单与合集(清单名称、合集、**合集的默认设置**)→ ② 清单设置(只有三项:产品排序 | 产品卡 两栏并排(`.pgrid2` + `.pblk`),显示时间一行排开(`.pblk--time`)—— 时间不单独成段)→ ③ 顺序(网格放最后)。
  合集排序列表:每个合集默认只显示**这一刻生效的那条**(没有就按 上线中 → 已排期 → … 排第一的那条),其余点「显示全部 N 条调整记录」才展开(`pnOpen`);行首不放缩略图、产品小图不带序号。
  合集排序网格的产品卡:一行最多 4 个、标题最多 4 行、草稿写「Draft」、库存「UK:1 EW:2」(`POST /api/schedule/products-stock`;2026-10-21 用户:**不读仓库**,读店里已同步好的款式字段 `custom.uk_inventory`(UK Inventory → UK)、`custom.es_inventory`(EW Inventory → EW,用户要和后台名字一样),和主题 `stock-logic-compute.liquid` 同一组;所有款式加起来、只列有货的、全 0 =「无库存」、没这两个字段 = 不显示;只要 read_products)。
  主按钮文案自动写成「保存 · 马上上线 / 保存 · 10/24 上线」(已上线的是「保存修改」);保存出错用 `showFormErr` 标到字段上(`ERR_FIELD` 按错误文字找字段,新加校验文字记得补映射)。
- **说明文字**:页面上只留一句话;长解释放字段提示(`fld` 第三个参数)或折叠起来。

### 关键

- **规则只有一份**:`src/schedule-core.js`(上下线判断)+ `src/schedule-actions.js`(存草稿 / 提交 / 发布 / 批准 / 退回 / 暂停 / 删除 / 排序,含权限检查)是纯函数,**服务器和浏览器共用**(服务器以 `/lib/*.js` 只放行这两个文件给页面 import)。演示模式在浏览器里跑它,正式模式由服务器跑。**别在 `public/schedule.js` 里再写一套规则。**
- 服务端文件:`schedule-store.js`(数据存 `DATA_DIR/schedule/<shop>.json`,暂不用 Postgres)、`schedule-api.js`(`/api/schedule/*` 接口)、`sync.js`(动作的副作用:写 Shopify 条目 / 位置 / 删除 / 发飞书;**每个店铺一把锁**,动作和定时器排队执行)、`metaobjects.js`(7 个定义 + 字段映射;核心 4 个 + 首页商品模块的版本 / 页签 + 合集置顶清单,后加的缺了只提示补建)、`files.js`(图片上传 / 按文件名找图)、`theme-content.js` + `theme-import.js`(读主题、导入)、`counts.js`(Admin API 计数,含「静默忽略」防护)、`lark.js` + `notifier.js`(飞书)、`scheduler.js`(每分钟对齐 + 每天 10:00 汇总,`SCHEDULER_DISABLED=1` 可关)。改完先跑 `npm test`(151 个)。
- **本地测正式数据**:`node scripts/live-harness.mjs --fresh` → http://localhost:4793(app 用 API 2026-07;`--old-api` 模拟 2026-04)(`?user=1002` 是第二个人;`--core-only` 模拟只建了核心 4 个类型的老店)。真的 app 服务器 + 假 Shopify(内存,主题文件读本地 worktree,产品数读 `scripts/demo-catalog.json`),`http://localhost:4794/__state` 看写进「店铺」的东西。只靠 `SHOPIFY_GRAPHQL_ORIGIN` 环境变量指过去,线上别设。
- **建内容类型、从主题导入**都只能由用户在「设置 → 店铺连接」点按钮触发,别在部署 / 启动时自动做。
- 认人:**v3 起改为飞书登录**(店里多人共用 Shopify 账号);Shopify session token 只证明「从本店后台打开」。第一次登录的人默认「待分配」,管理员分配角色后才能用;第一个管理员 = 第一个从 Shopify 后台里用飞书登录的人。(v2 旧做法:session token 的 `sub` = 员工 id、第一个打开的人是审核人。)
- **飞书登录(v3 3.1)**:`src/lark-login.js`(授权 / 换 token / 读用户信息 + app 会话签名,签名密钥由 `SHOPIFY_API_SECRET` 派生)、`src/members.js`(成员 / 角色 / 页面权限,纯函数)、`src/auth-routes.js`(登录回调、/api/me、/api/members、/api/roles)、`src/auth-embedded.js` 的 `requireAccess` / `needMember`、页面 `public/auth.js`(登录门)。
  **只在 Railway 填了 `LARK_APP_ID` + `LARK_APP_SECRET` 时开启**;没填就和以前一样只认 Shopify(别把这个回退去掉)。飞书凭证只放环境变量,不进代码、不写日志。
  **★ 2026-10-16 起「多人协作」整体先隐藏**(用户:权限以后再做,先把功能做好):总开关 `teamEnabled()`(`src/lark-login.js`)= 配了飞书 **且** Railway 设了 `TEAM_MODE=on`。
  关着(现在的状态)时:不显示飞书登录门、成员 / 角色、测试模式、默认审批人、编辑器里的「分工」(负责人 / 审批人 / 抄送 / 截止)、「我的工作」、改价的负责人 / 审批人 / 抄送;
  从 Shopify 后台打开的人都按管理员处理(改动直接生效,不走审核);飞书**私信**不发(改价通知本来只走私信 → 现在改价没有通知),群 webhook 通知照常。
  代码和数据(成员、分工字段)都保留,设 `TEAM_MODE=on` 就全部恢复;本地 `live-harness.mjs --lark` 会自动带上 `TEAM_MODE=on`。
  后台 iframe 里登录用弹窗(弹窗被拦就给「新窗口打开」链接);直接开网页用整页跳转。
  **防冒充(别去掉)**:弹窗模式的会话只能用飞书回调页显示的 6 位验证码换(弹窗自动传回,传不回就手输;错 5 次作废、只能用一次)——
  否则有人把自己发起的登录链接发给管理员点,就能拿到管理员身份。网页模式靠 `/auth/lark/start` 种的 cookie 核对是同一个浏览器。
  **谁能成为管理员**:设了 `LARK_ADMIN_IDS`(飞书 open_id,逗号分隔)→ 只有名单里的人,且每次登录都保证是启用的管理员;
  没设 → 只有「第一个从 Shopify 后台里登录的人」一次,之后 `bootstrapDone` 永久关门。停用成员立即生效(每个请求都查成员状态)。
  **测试模式**(`state.testMode`,`src/members.js` 的 `setTestMode` / `testModeOn`):临时免登录,方便自己试。四道闸别去掉 ——
  ① 只在带 Shopify 后台凭证时生效(直接开 app 网址的人照样要登录);② 只有 `LARK_ADMIN_IDS` 名单里的人、真的飞书登录后才能打开;
  ③ 到点自动失效(默认 2 小时,最长 8);④ 测试身份只能关、不能开 / 续,也不能改成员和角色。开着时顶部常驻红条 + 设置页提示,开关都记操作日志。本地测:`node scripts/live-harness.mjs --fresh --lark`(假飞书,可选测试管理员 / 员工 / 设计)。
- **改价模块(v3 3.2,从 `../price-scheduler-app` 搬入)**:`src/price/`(`price-core.js` 规则 + `price-actions.js` 动作和权限 —— 纯函数,页面经 `/lib/price-*.js` 共用;`executor.js` 每分钟对齐价格;`shop-io.js` 唯一写价格 / 合集的地方;`catalog.js` 选产品;`notifier.js` **只私信相关的人、不发群**;`api.js` 挂 `/api/price`,server.js 用 `needMember('price')` 限定定价角色 + 管理员)。数据在 `DATA_DIR/price/`,和排期分开。
  每个计划可指定审批人(`approver`)/ 负责人(`owner`)/ 抄送(`cc`),只能选能看改价页的成员;没指定审批人 = 管理员审批;审批人自己提交直接生效。
  **界面按原来那个 Simple Product Price Scheduler 的做法**(2026-10-10 用户给了截图):一个计划 = 一条规则 + 一个时间段(没有多时段 / 每日日程,Flash 每天用「复制成下一天」);
  表单从上往下填(名称 → 改什么价 → 改哪些产品 → 什么时候 → 产品标签 → 负责人审批 → 划线价 → 试算预览),右边常驻一段大白话摘要;逐个变体的价格收在「试算预览」里。
  `plan.scope`(all / collections / products / search)+ `plan.rule` 存下来,点「试算预览」或保存时重新算出 `slots[0].items`;手改过价的变体带 `manual`,重算时保留。
  **改价分组**(2026-10-13):`plan.groups = [{ id, scope, rule }]`,一个计划可以分几组(比如合集 A 85 折、品牌 B 7 折、几个产品逐个填价);试算时一组一组算,
  同一个变体在几组里**下面的组覆盖上面的**,每个变体记 `item.group`;规则多了 `manual`(逐个填价,表格里一个个填)。保存时 `scope` / `rule` 仍写第一组(老界面、历史兼容);
  老计划打开时自动变成一组。分组只是编辑器的配置,执行器照旧只看 `slots[].items`。~~层级~~ **2026-10-26 改成数字优先级**(`priority` 1–10,默认 10 最高;数字大的说了算,一样大开始晚的说了算,再看批准晚的;`prioOf` 把老计划的层级换成 限时抢购 10 / 品牌 9 / 全场 8,先后不变;开始后也能改)。
  两个限时计划改到同一产品、时间重叠 → 列表行标黄「和 X 改到同一批产品」(`overlapIndex`),编辑页检查区黄色提醒用谁的价。
  划线价从「高级」挪到改价分组下面,**2026-10-28 用户定四个选项**:`keep` 显示原来的划线价(**默认**,原来没有就不显示)/ `price` 显示原来的现价 / `clear` 不显示 / `set` 逐个指定;
  老计划的 `original`(原来的划线价,没有就用原来的现价)照旧执行,只在打开老计划时列出来。
  试算预览放进**每一组**里(只看这一组的产品;试算还是所有组一起算,`E.groupHits` 记每组选中多少、被下面的组覆盖多少);分组是带编号的卡片,「+ 再加一组」是整行虚线按钮。
  列表分类:未结束 / 进行中 / 已排期 / 草稿 / 已结束 / 全部;「待审核」只有多人协作开着或真有待审核的计划时才显示。
  **改价倒计时**(2026-10-27 用户要、同意新增写入):限时计划的 `countdown` = { on, label, days: 0/1/3/7/15, style: classic/pill/dark/minimal },默认关。
  执行器每轮 `planCountdowns` 算「此刻真的在这个计划价格上的产品」(保险库 written.planId、没暂停接管;一个产品几个计划取最早结束的),
  和 `state.cdState` 比,只写 / 删有变化的 → 产品字段 **`custom.cgp_price_cd`**(json `{e, s, l, st}`,`shop-io.js` setCountdowns / deleteCountdowns,每批 25 个)。
  ⛔ 这是改价模块唯一写的产品字段,只动这一个 key;结束 / 暂停 / 提前结束 / 被人手动改价都会删掉。
  主题 snippets/cgp-campaign-offer.liquid 读它:**改价倒计时 > Collection 置顶清单 > 活动**(活动徽章照常,倒计时 / 样式 / 文字换成改价的);「最后几天才显示」在浏览器按 s 判断。
  `plan.tagsAdd` / `tagsRemove`:生效期间加减产品标签(驱动按标签自动归类的合集),结束还原;只动计划里填的标签,产品本来就有的不碰(`price-core.planTags` + `state.tagState` 记账)。
  页面 `public/price.js`(点开「改价」才加载),样式在 style.css 末尾、**全部限定在 `#section-price` 里**,和排期页同名的样式加了 `pr-` 前缀 —— 别去掉,否则两边互相干扰。
  飞书私信:`src/lark-bot.js`(同一个飞书应用的机器人,需要 `im:message:send_as_bot`)。本地测:harness 的 `/__price`(改过价的变体)、`/__price/set`(模拟手动改价)、`/__dms`(发出的私信),产品数据 `node scripts/fetch-price-catalog.mjs`。
- **合集排序(置顶清单)**:自己一个导航页(`renderPins`,`#section-pins`),按合集分组 + 共用时间线 + 「复制成下一天」;写进 `cgp_collection_pin`。
  编辑器照 Shopify 新版合集的**网格**做法(2026-10-12 用户要求):`GET /api/schedule/collection-products` 把合集现在的全部产品按真实顺序取回来(app 正在接管时还会带上**接管前的快照** `baseline`),
  网格里任意拖动(指针事件自己实现,不用浏览器原生拖放 —— 原生拖放在 iframe / 自动化里不稳)、点序号直接输入要移到第几位、悬停「置顶 / 不显示」、「只显示前 N 个」。
  **对比标记**都相对「原来的顺序」(接管前快照或现在的顺序):红实框 = 新加(原来不在合集里)、红虚框 + 「原 #N」= 被拖动过、灰 = 这段时间不显示、普通 = 没动。
  「被拖动过」用最长递增子序列判断(`src/order-diff.js` 的 `diffOrder`)—— 把第 50 拖到第 20,只有它一个算换位置,中间被挤下去的不算。
  **只存最短前缀**(`minimalPrefix`):前缀按顺序排最前、其余照原顺序,展开(`expandOrder`)和网格一模一样;把第 50 拖到第 20 只存 20 个。数据模型还是 `products`(前缀)+ `hidden` + `onlyListed`,没变。
  `order-diff.js` 服务器和浏览器共用(`/lib/order-diff.js`,server.js 和 demo-preview.mjs 都要放行)。
  ⛔ Liquid 循环引用列表**一次只读前 50 个**(Shopify 列表字段最多 128 个),所以写进 metaobject 的 `products` / `hidden_products` 只写前 50 —— 前台排序模式下超过 50 编辑器会提醒;真的改合集模式用 app 自己存的完整前缀,不受影响。
  **历史版本 / 回滚**(`src/col-history.js`,存 `DATA_DIR/schedule/<店>.colhist.json`,和排期数据分开):接管前原样、每次改完、结束还原、发现有人手改、回滚前后各记一版;
  每版只存产品 id 顺序(11 个产品约 0.2KB、500 个约 7KB),和上一版一样不记,每个合集最多 100 版 / 90 天。
  回滚(`POST /api/schedule/col-rollback`,管理员,再点一次确认):那一版有、现在没有的加回来;后来才加进合集的**不删**,排到最后;正被清单接管的合集会设 `hold='rollback'`,免得下一分钟又排回去。
  `movesFor` 只给最长递增子序列以外的产品发 move(插到目标里前一个产品后面),再模拟验证一遍,不对就退回逐个排 —— 300 次随机打乱的测试在 `test/collection-order.test.js`。
  ⛔ **Shopify 2026 新版合集**(2026-10-12 用户纠正过):合集可以「条件 + 单独加的产品 + 排除」混在一起,**带条件的合集只要排序方式设成「手动」也能用 `collectionReorderProducts` 调顺序**
  (它只要求 `sortOrder = MANUAL`)。别再用「有 ruleSet = 不能手动排」判断。`readCollection` / `collectionProducts` 现在给两个开关:
  `manualOk = sortOrder === 'MANUAL'`(能真的调顺序)、`membershipOk = manualOk && 没有条件`(纯手动合集,用 collectionAdd/RemoveProducts 加减产品)、
  `selectionOk = manualOk && 有条件 && API≥2026-07 && 有合集自己的条件来源`(带条件的合集:改它的「单独加的产品 / 排除」名单
  `collectionUpdate(collection: { sourcesToUpdate: [{ condition: { id, inclusion|exclusion: { selectionsToAdd|selectionsToRemove: [{ productId }] } } }] })`,**不动条件**)。
  `colState[].via` 记住用的是哪套('manual' / 'sources' / null = 只排顺序),还原时用同一套。共享的条件来源(`shareable`)会连带改到别的合集,不碰。
  带条件的合集改名单后 Shopify 可能在后台慢慢算:`pending` 等新加的都出现、排除的都消失再排顺序(最多 15 分钟);还原同理(`restoring`)。
  「我们加了 / 排除了哪些」按状态算(`added` / `removed`),只补差,不会重复加。测试在 `test/collection-sources.test.js`(用 2026-07 跑)。
  API 2026-07 起 `ruleSet` 弃用、改 `Collection.sources`;**用了新功能(多个来源、排除条件)的合集在 2026-07 之前的接口里查不到**。代码按 `SHOPIFY_API_VERSION` 自动切换查询(`NEW_COLLECTIONS`),建议 Railway 改成 2026-07。
  **执行方式**(`src/collection-order.js`,每分钟由 `scheduler.js` 对齐):
    · 手动排序的合集(`!ruleSet && sortOrder === 'MANUAL'`)→ **真的改店里的合集**:`collectionReorderProducts` 把排好的移到最前,
      隐藏的用 `collectionRemoveProducts` 临时移出;接管前存**原始顺序快照**(`state.colState[合集id].snapshot`),结束 / 暂停 / 删除自动还原、移出的加回来。
    · 按条件自动归类的合集、或现在不是手动排序的 → Shopify 不让手动排,**跳过不写**,由主题在前台排(`CGP_COLLECTION_PIN`)。
      「只显示清单里的」要移出的产品超过 `MAX_REMOVE`(100)也退回前台方式。
  清单里可以排**合集以外的产品**:真的改合集模式下执行时 `collectionAddProducts` 加进去(记在 `colState[].added`),结束移出;前台模式做不到(主题只有合集自己的产品数据),编辑器里会标红。
  保存 / 批准 / 暂停 / 删除置顶清单时,`/api/schedule/act` 会马上跑一次 `alignCollections`(结果放在返回的 `colRep`,页面拼成一句话提示),不用等定时器。
  `readMainTheme` 顺带读 `snippets/cgp-search-head.liquid`,判断正在用的主题有没有前台排序代码(`themePin`),没有时编辑器提醒「顾客暂时看不到」。
  **清单开关「生效期间完全按我排的顺序显示」**(`pin.fullOrder`,2026-10-12 用户要求「只改 app、跟着清单生效失效」):搜索引擎在合集页默认「手动前 12 个 + 其余新到旧」
  (主题里写死,每个合集可以用合集字段 `custom.cgp_sort_off` / `cgp_pin_manual` / `cgp_pin_new` 改,线上主题已经认)。清单勾了它,生效期间 app 把这个合集的
  `custom.cgp_sort_off` 设成 true,结束 / 暂停 / 删除 / 取消勾选时恢复成改之前的值(原来没有就删掉)——`alignSortFlags`,记在 `state.sortFlags`。
  **不改主题、不改别的合集**。连着两份都勾了的清单(Flash 第 1 天 → 第 2 天)中间不恢复。编辑器没开时会在网格第(前缀 + 12)位画一条「前台从这里开始按新到旧」的线。
  **合集默认排序**(2026-10-21,合集排序页的子页「合集默认排序」):每个合集「平时」(没有清单生效、顾客没选别的 Sort by)怎么排,三种 ——
  前 N 个按手动顺序 + 其余新到旧(默认 12,可改,0 = 全部新到旧)/ 完全按手动顺序 / 完全按 Shopify 的自动排序(畅销 / 最新 / 价格 / 字母)。
  规则 `src/col-sort.js`(纯函数,浏览器经 `/lib/col-sort.js` 共用),写店铺 `src/col-sort-shop.js`(`GET /api/schedule/col-sorts` 全部合集、`POST /api/schedule/col-sort` 改一个,只有管理员)。
  写的只有:合集字段 `custom.cgp_sort_off`(boolean)、`custom.cgp_pin_manual`(number_integer;等于 12 就删掉回默认),以及**合集的排序方式 `sortOrder`**
  (用户 2026-10-21 同意:选「完全按手动」时后台改成手动、选自动排序时写回选的那种;「前 N 个」后台不是手动时可勾选一起改成手动)。`cgp_pin_new` 只显示不改。主题不用改(早就在读这几个字段)。
  ⛔ 和清单的「生效期间完全按我排的顺序」共用 `cgp_sort_off`:那个开关开着(`state.sortFlags[合集]`)时,改平时设置**不写字段**,只改 `flag.prev`(清单结束后恢复成新的);
  app 正在真的改这个合集的顺序(`state.colState[合集]`)时不许改成自动排序(否则排不了、结束也还原不了)。
  调试用:合集排序页有「立即执行一次」(`POST /api/schedule/col-run`,管理员),直接把 applied / skipped / holds / failures 翻成人话。
  ⛔ 有人在 Shopify 后台手动改过顺序(我们排最前的那几个不在最前了)→ **暂停接管**,绝不覆盖别人的改动;界面上给「按本次排序 / 保留后台排序」两个按钮(2026-10-26 用户定的名字)(`POST /api/schedule/col-hold`)。
    「保留后台排序」= 状态标 `released`(**别删 colState**:2026-10-26 前是直接删,清单还在生效时下一分钟会重新接管、又把顺序排回去):这份清单内容没改就不再排;
    清单结束只复原临时加 / 移出的产品,顺序保持人排的(`restored[].keptOrder`);改了清单内容再保存 → 以当时的顺序为底重新接管。
  ⛔ **合集 / 产品 id 有时是数字、有时是 gid**(Shopify 资源选择器给 gid,种子数据和主题导入给数字)—— 比较一律用 `numId()` 取末尾数字,直接 `===` 会静默漏掉(2026-10-12 踩过:置顶清单对不上首页页签)。
- **联合推广**(2026-10-22,产品页推广 `callout` 的升级,`joint = true`):比如「Smart Fusion × 兼容手动镜头」——兼容产品页(A 面)和推广产品页(B 面)各一张卡片,都链到**活动页 = 兼容产品合集的页面**(主题模板 `collection.joint-promo` + `sections/cgp-joint-promo.liquid`:优惠一句话、标题、介绍、大图、推广产品、玩法、条款)。
  用户 2026-10-22 定:**兼容产品名单以 app 条件为准,自动同步进合集**(`src/joint-sync.js`:保存 / 批准后马上一次 + 定时器每小时一次;`POST /api/schedule/joint-sync` 立即同步);折扣**直接做 KitBundle**「加购优惠」(1 支镜头配 1 套,只给推广产品打折;KitBundle 里触发选兼容产品合集、打折产品选推广产品合集 —— 两边认同一对合集);活动页内容在这里编辑。
  这个合集是唯一名单:A 面卡片、活动页、KitBundle 的触发条件都认它。⛔ 同步只动推广块里选的**那一个手动合集**的成员(collectionAdd/RemoveProducts);合集可以选已有的,也可以**在编辑器里直接新建**(2026-10-23 用户:不想去后台建;多个牌子的镜头可以共用一个兼容产品合集);
  新建 = `src/joint-coll.js` `createJointCollection`(`POST /api/schedule/collection-create`,只有审批人):`collectionCreate` 建**空的手动合集**,兼容产品那个自动套模板 `joint-promo`,
  然后试 `publishablePublish` 发布到「网店」—— 要 `read_publications` + `write_publications` 权限,没开就只建不发布,编辑器给后台直达链接让人勾一下「网店」(不报错);
  折扣仍在 KitBundle 设:编辑器「折扣」一行填 %,按钮打开 KitBundle `/app/gifts/new?deal=1&pct&title&trigger=<兼容合集 gid>&reward=<推广合集 gid>`(KitBundle 预填好,人检查后保存);
  是否生效 = `jointDealStatus` 只读兼容产品上 KitBundle 写的 `custom.gift_trigger`,找 `kind = deal` 且打折产品在推广合集里的那条(`GET /api/schedule/joint-deal?id=`),生效后按钮改成打开那条活动,不会重复建;
  带条件的合集不碰;条件一个都没命中不清空;一次要移出超过一半(且合集 ≥ 20 个)先停手,要在编辑器点「仍然同步」;推广产品合集里的产品不算进兼容产品。结果记在 `state.jointSync[推广块 id]`。
  **推广产品合集也自动管**(2026-10-23 用户:兼容的和推广的都应该自动加入):联合推广的「推广的产品」可以多选(`promos`,最多 50;第一个兼当 `promo` → metaobject `promo_product`,卡片默认图),
  每次同步先把推广产品合集对齐成**正好这几个**(多出来的移出,安全阀同上,结果在 `jointSync[id].promo`),再同步兼容产品(条件命中的去掉推广产品 + 推广合集成员)。
  ⛔ 老的推广块(只有 `promo`、没有 `promos`)**不动推广产品合集**,等人在新编辑器里看过、保存一次才开始管(免得上线后突然把人工放进去的产品移出)。保存时联合推广必须选至少一个推广产品。
  主题里 joint 推广块不看 rules,看 `product.collections`:在推广产品合集 → B 面(优先),在兼容产品合集 → A 面。
  **条件组**(2026-10-26 用户:每个牌子筛选方法不一样,不想每个牌子复制一条推广):联合推广可以有 `ruleGroups = [{ id, name, rules }]`,组和组之间「或」、组里每条都要满足;
  `calloutScope` / `calloutIds` 用 `ruleGroupsOf()` 逐组拉再合并(scope 额外回 `groups` = 每组命中数),同步进同一个兼容产品合集;`rules` 仍存第一组(店里 rules 字段 / 普通推广块用)。
  只有联合推广能分组(普通推广块的条件主题要在 Liquid 里判断,没做分组)。编辑器:条件区上面一排组页签(`coGroupsHtml`,`ed.rules` 就是当前组的数组),「从别的推广块复制条件」把那张的条件变成新的一组、排除 / 一定显示的产品并进来。
  **卡口过滤**(2026-10-27,`src/mounts.js`,纯函数):同步 / 算命中时看产品**选项和标题**,只有不兼容卡口的产品不算兼容(不进兼容产品 Collection → 卡片 / 弹窗 / 活动页 / KitBundle 折扣一起没了);
  有兼容卡口(E / FE / PL / LPL / EF / Leica M / PV)的照算,都没写卡口的照算并在编辑器列出来。联合推广默认开(`mountFilter !== false`),`badMounts` 空 = 默认名单(和 KitBundle 预填的一样)。
  开着时查询多拉 `options(first: 3) { name optionValues { name } }`、每页 50 个(查询费用);单个字母(E / L / X / Z / M)只在明显是卡口的上下文里算(写了 Mount、前面是相机牌子、旁边有别的卡口名、选项名叫 Mount、选项值只有这一个词),别让「1.33 x」变成富士 X。
  2026-10-23 主题改成「一段话卡片 + 点开弹窗」(主题仓库 snippets/cgp-joint-popup.liquid / cgp-joint-product.liquid / cgp-joint-pct.liquid,assets/cgp-joint.css / .js):
  卡片 = 优惠一句 + 标题 + 链接文字;A 面弹窗里推广产品一行一个(选套装、直接加购物车、显示搭配价),B 面弹窗里 8 张兼容产品卡片可直接加购;弹窗底部才链到活动页。
  **搭配价的百分比主题直接读 KitBundle 写在兼容产品上的 `custom.gift_trigger`(kind = deal)**,不读这里的 dealPct —— 两边不一致时以 KitBundle 为准(编辑器折扣行会提醒)。
  所以「说明」(text / promo_text)现在只在弹窗里显示;编辑器右边的卡片预览已改成一段话。
- **促销链接**(2026-10-15,`salelink` / `cgp_sale_link`):`/collections/<合集>?onsale[=<后缀>]`。规则在 `src/sale-link.js`(纯函数,浏览器经 `/lib/sale-link.js` 共用),
  **和主题 `assets/cgp-search-app.js` 的 `SALE` 必须一致**(只要打折的 → 有货 / 最低折扣 → 「和合集平时一样」或指定排序 → 置顶放最前 → 最多几个),改一边要同步另一边。
  ★ **2026-10-26 用户定的优先级**:链接**有自定义**(固定了产品,或选了排序方式)= **完全独立** —— 固定的(只认前 50 个)排最前,其余按链接自己的排序
  (固定了产品又没选 = 折扣从大到小),一样大再按最新、产品 id;**不看 Collection 的先后,置顶清单 / Collection 默认设置都影响不到**。
  链接**什么都没自定义**才跟着 Collection 平时的顺序(置顶清单 → 默认设置)。`isCustom` / `effSort` 在 sale-link.js,主题 `applySaleOrder` 同一套。
  编辑器:固定了产品就不能选「和 Collection 平时一样」(留空自动换成折扣从大到小);拖动在「自定义之后」的顺序上挪、只固定挪动的那几个。
  置顶只决定顺序,不绕过打折 / 有货条件。同一个合集后缀不能重复(不同合集可以同名)。没生效时主题拿不到这条设置,`?onsale=后缀` 自动等于不带后缀。
  **和合集排序的关系要摆在界面上**(2026-10-26 用户:看不出两边的置顶什么关系):顺序三层 = ① 链接自己固定的(红框)→ ② 排序选「和合集平时一样」时,生效中的合集排序清单里打折的(蓝框「来自合集排序」)→ ③ 其余按合集默认设置 / 选的排序。
  促销链接预览上面画这三层(`slSrcHtml`);置顶清单编辑器第 1 段列出这个合集的促销链接、各自跟不跟这份清单(`wxSlHtml`,`salesOf`;文案直接说优先级:「促销链接优先」= 链接自己排好的排最前、清单改不动,其余打折的才按清单 —— 用户看不懂「跟着这里的顺序」)。⛔ 促销链接固定位置上限 **100 个**(2026-10-26 从 50 提上来):产品列表字段 `products` 在 Liquid 里一次只读得到 50 个,所以另存 `pin_ids`(json 产品编号,最多 100 个),主题(cgp-json / cgp-search-head)优先读它;店里还没补建 pin_ids 时网站只认前 50 个(编辑器 `slMax()` 会按 50 算并提醒去补建)。界面上说「排好了几个」一律按 `slMax()` 封顶;合集排序列表每个合集标「促销链接 X 也跟着这个顺序」。两个编辑器能互相「打开」,有没保存的修改先提醒一次。
  编辑器预览 `GET /api/schedule/sale-preview` 读**前台**主题的 cgp-json(`STOREFRONT_ORIGIN` 或店铺主域名;harness 里是假前台),两分钟缓存。
- **历史记录**(2026-10-13):网站内容 `src/item-history.js`(`<店>.itemhist.json`,每条 60 版 / 180 天)、改价计划 `src/price/plan-history.js`(`price/<店>.planhist.json`,每个 40 版)、
  合集顺序 `src/col-history.js`(`<店>.colhist.json`)。`/api/schedule/act`、`/api/price/act` 动作前后对比,动过的那条记一版(状态、能编辑的全部字段、待审核的修改);一样的不重复记;删掉的保留。
  页面「历史记录」汇总(能看改价的人也看到改价计划),每条可看那一版 vs 现在逐项对比、复制成新的、回滚(回滚照常走审批:审批人马上生效,其他人提交审核,草稿存回草稿)。
  ⛔ 历史文件和店铺数据放在同一个目录,`listShops()` 必须排除 `.colhist / .itemhist / .planhist`,否则定时器会把历史文件当成店铺、往里写排期数据(2026-10-13 踩过);读历史时也会把混进来的无关内容清掉。
- 本地看演示界面:`node scripts/demo-preview.mjs`(端口 4790)。
- **界面文字里「合集」一律写成 `Collection`**(2026-10-26 用户要求;中英文之间留空格,如「这个 Collection 的排序」「Collection 排序」)。提示、报错、日志、飞书通知都算;代码注释不管。
  例外:`src/metaobjects.js` 里内容类型的名称 / 说明还是中文 —— 那是写进 Shopify 的定义,改了会让设置页把它们标成「要更新」,别顺手改。
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

- 写操作只限:建 `cgp_*` 内容类型、写 / 切换 `cgp_*` 条目、上传 Banner 图片;合集排序 / 改价模块各自写的那几样(见上面各节,合集默认排序会写合集字段 `custom.cgp_*` 和合集排序方式;联合推广会改它选定的那一个手动合集的成员,也能新建空的手动合集并发布到网店)。**别碰产品、主题、别的 app 的数据**;新增任何其他 mutation 前先和用户确认设计。
- 主题扫描**只读**,绝不改主题文件。
- Railway 的 App URL 必须是公网域名(`*.up.railway.app`),别填 `*.railway.internal`(内网,Shopify 解析不到)。
