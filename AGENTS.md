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
- **消息中心**(v1 2026-11-09 上午「通知中心」;**v2 同一天下午** —— 用户:只是开关不够,每一类通知都要能自定义样式、内容、推给谁、怎么推、什么时候推;**不按活动 / 品牌细分**(用户:太细太复杂)。导航「消息中心」只给管理员):
  · `src/notify-catalog.js`(纯函数,**页面预览和服务器发飞书共用**,页面经 `/lib/notify-catalog.js` 读):分类 `CATS`(改价 / Banner / 顶栏 / 首页商品模块 / Collection 排序 / 促销链接 / 产品页推广 / 活动 / 每日提醒 / 审批 / 系统)、
    通知目录 `EVENTS`(key = `<分类>.<事件>`:网站内容每种类型各一组 created / updated / order(Banner、顶栏)/ paused / deleted / live / off / notlive / failure;改价 created / updated / deleted / live / switch / restored / finished / control / hold / failure / collection / gone / moved / recovered + 审批;`pins.hold` / `pins.failure` / `joint.failure` / `daily.*` / `content.submit|decision|due` / `system.failure`)、
    每种通知**能选哪些字段**(`avail`,只放它真有的数据)、默认标题 / 颜色 / 字段 / 按钮、示例数据(预览 + 试发),和拼卡片 `renderCard` / `renderList`(同一种几条合成一张)/ `renderDigest`(汇总按分类列)。
  · **模块只给数据**:`{ ev, data: { 字段: 值 }, path: 这一条的网址, related, approvers, actor, page?, key? }` —— `src/notifier.js`(`changeEvents` 有人动手、`actionEvents` 审批、`schedulerEvents`、`digestEvents`)、`src/price/notifier.js`(`planChangeEvents`、`eventMessages`、`reportMessages`)、`scheduler.js` 的 `pinEvents` + 联合推广失败。⛔ 别在模块里拼卡片、写死收件人。
    「已创建 / 已修改 / 删除 / 暂停 / 调顺序」在 `/api/schedule/act`、`/api/price/act` 之后按动作前后对比产生(改了什么 = `diffText` / `planDiffText` 按字段说人话)。
  · **规则**(`state.notifyCenter = { v2, tz, groups, rules: { key: { on, to, via, when, style } } }`,`src/notify-center.js`):
    to = 推给谁(related / dept / admins / page / approver / roles / people / **notActor 不发给动手的人**);via = 怎么推(`dm` 飞书私信、`groups` 哪几个群、`at` 群里 @ 相关的人);
    when = 什么时候(`now` 马上 / `merge` N 分钟内同一种合成一条 / `digest` 每天 HH:MM 汇总,只有日常通知能选 / `work` 只在工作时间,下班的攒到上班);style = null 用默认,或 { title, color, layout full|brief, titleName, fields 顺序, buttons, max }。
    时区(汇总时间 / 工作时间按哪里算)= `tz`,英国 / 北京两种。v1 存的规则按 `OLD_KEY` 带到新通知上(老的「自动上下线」→ 每种内容的上线 / 下线);没保存过按老开关推默认。
  · 发送:`dispatch` 马上发的同一轮同一种按收件人合成一张(收到一样一组的人合起来发一次);其余进队列(`DATA_DIR/notify/<店>.box.json` 的 `queue[]`),定时器每分钟 `flushQueue` 发到点的。队列读写有每店一把锁(`withBox`)。发送记录 `.log.jsonl`(排队的标 queued)。
  · 默认:日常 = 相关的人 + 管理员(管理员看全部)、出问题 = + 同部门、有人动手的不发给动手的人;新加的「已创建 / 已修改…」默认不进群;出问题谁都收不到 → 兜底私信管理员;个人在「我的账号 → 我的通知」只能关日常通知(`members[].notifyMute`)。
  · 页面 `public/notify.js`:左边分类、右边通知列表(开关 + 一句话说清怎么发)→ 编辑(① 样式 ② 内容:勾字段、拖 ⋮⋮ 或 ↑↓ 排序、按钮文字 ③ 推给谁 ④ 怎么推 ⑤ 什么时候推;右边实时预览 =「飞书里就是这样」、「发给我试试」(私信自己或发到群,用示例数据和没保存的设置)、「恢复默认」、「套用到其他通知」(选套哪几块:推给谁 / 怎么推 / 什么时候 / 样式 / 开关;样式不套标题、字段只留对方有的;快速选「每种内容的『已修改』」)。
    网址 `/notify/rule/<分类>-<事件>`(网址里不能有点)。飞书卡片 `src/lark.js` `buildCard`:短信息两个一行、清单一段、多个按钮、`at`。
  · 新加通知:在 `notify-catalog.js` 的 `EVENTS` 登记(cat / level / name / desc / title / color / fields / avail / buttons / sample),模块里产生 `{ ev, data, path, related … }` 交给 `dispatch`。
  · **下一步(用户定的第二步)**:app 里的消息收件箱(未读、紧急的置顶直到处理、问题解决了自动算已处理、汇总列未处理的)。
- **部门负责人**(2026-11-10 用户,方案 `docs/departments/PLAN.md`,用户 4 点都选了推荐):原来的「角色」升级成**部门**(数据还叫 `state.roles`,key 不变)。
  · 每个部门:`ceiling`(每页上限 0 不能看 / 1 只看 / 2 能编辑 / 3 能上线,管理员定)、`leads`(负责人,管理员指定,自动算进这个部门)、`capsOff`(整个部门关掉的敏感功能)、
    `grants[成员] = { levels, capsOff }`(负责人在上限内给员工的,没写 = 和上限一样)、`notify`(部门通知,见下)。老数据 `pages` 自动换算成 上限 = 能上线(谁都不少权限)。
  · 一个人某页的档位 `levelOf` = 他所在各部门 min(上限, 负责人给的) 取最高;负责人 = 上限;管理员 = 3。`pagesOf` = 档位 ≥ 1 的页面(设置 / 工具只给管理员)。
    敏感功能 `CAPS`(改价:暂停继续提前结束 / 处理被接管 / 导出;Collection 排序:默认设置 / 回滚)跟着那一页「能上线」,部门 / 个人可单独关(`capOf`)。新加敏感功能在 `CAPS` 登记 + 接口里 `needCap` / `needPriceCap`。
  · **服务器按档位拦**(别只藏按钮):`/api/schedule/act` 至少 2、`actorFor(state, user, 页面)` 按这一页给身份(能上线 = approver 直接生效;能编辑 = editor,保存走提交);Collection 排序 / 联合推广那几个接口按页面 + 敏感功能;
    改价 `actorOfReq` 按 `price` 页,`/api/price/act` 至少 2,暂停继续提前结束 / 处理被接管 / 导出要敏感功能。页面:`schedule.js` 的 `meFor(kind)` / `canPage` / `hasCap`(staff 里带 levels / caps),`price.js` 照服务器给的 `me.admin`。
  · 审批:有人是「能编辑」档 → `reviewsOn` → 「审核」页对大家出现、审批类通知在消息中心出现;提交发给**提交人所在部门里这一页能上线的负责人**(`leadApprovers`,`approversOf` 先看指定的审批人,都没有才管理员)。
    `APPROVALS=on`(老开关,全员审批)照旧有效。
  · 负责人能做的(`members.js`):`setGrant`(不超过上限,不能动别的负责人)/ `joinDept`(待分配的拉进来就启用,别的部门的人也能加)/ `leaveDept`(没部门了回待分配;负责人只有管理员能移出;不能移出自己)/ `setDeptNotify`;
    接口 `GET /api/depts`、`PUT /api/depts/:key/grants/:id`、`POST|DELETE /api/depts/:key/members`、`PUT /api/depts/:key/notify`、`POST /api/depts/:key/notify/test`(管理员或那个部门的负责人;测试模式不能改)。改部门设置走老的 `PUT /api/roles`(管理员)。都记操作记录。
  · **部门通知**(`role.notify = { group, rules }`):负责人给某种通知选「本部门自己定」= 本部门的人(管理员除外)按部门的设置收(相关的人 / 部门全部 / 只有负责人 / 不收 + 发部门群 + 不发给动手的人 + 什么时候),
    不再按消息中心的规则(规则里点名的人照旧);管理员和公司群照旧按消息中心。部门群在 `centerOf` 里变成群 `d:<部门>`;`recipients` 多回一个 `extra`(每个部门一份,各有推送时间),`dispatch` 同一个人 / 群只发一次。样式内容仍由消息中心统一。
  · 页面 `public/dept.js`(导航「部门」,管理员和负责人才有):管理员最上面一张「每个部门能看哪些页面」总表(一行一个部门、一列一个页面、每格选档位,改了马上存,2026-11-10 用户问「如何设置每个部门能看什么页面」后加的);每个部门一块 —— 管理员多一个「部门设置」(名字 / 负责人 / 敏感功能 / 删部门)+ 底下「加部门」;
    员工表(每页一个档位下拉,改了马上存)+ 敏感功能勾选 + 移出;「拉进来」(待分配的新同事 / 别的部门的同事);「部门通知」折叠段。设置页「成员」表的「角色」改叫「部门」,原来的「角色能看的页面」换成指向「部门」页。
    负责人登录时顶部「有 N 个同事等分配」指向「部门」页。
- 店铺**不是 Shopify Plus**(主题仓库 CLAUDE.md 误写 Plus)。
- **只有改价模块能写产品数据,且只写两样**:变体的 `price` / `compareAtPrice`,以及改价时段指定的**手动合集**成员(v3 起,用户 10/10 决定并入改价)。活动圈定产品仍 = 活动自身存的合集 + 标签 + 指定产品;别给产品写 metafield / 打标签。改价的安全规则(原价保险库、写前意图、读回核对、手动改价暂停接管)照搬 `../price-scheduler-app/AGENTS.md` 铁律。
- **Banner 是竖图卡片 430×600**(手机 320×450),后台预览一律按主题真实尺寸 / 字号 / 角标颜色画(`scripts/build-demo-seed.mjs` 从主题设置读出,别写死横图比例)。
  Banner 页「首页轮播顺序」(2026-11-02 用户):**网格平铺、一行 6 个**(窄屏 4 / 2 个),每张卡片写名字、副标题、什么时候上 / 下线、状态、角标;位置数字在**右上角**(左上角是卡片自己的 New / Sale 角标,别盖住),
  调整顺序也是同一个网格:拖动或改右上角的数字换位置。编辑器右边预览放大(抽屉加宽到 1240、中间那张 380 宽);「图片」一段去掉了「已有的图」那排(只在演示模式留着),只有「上传图片 / 换一张图」+ 粘贴地址,图片也能直接拖进那一段上传。
  **两个按钮**(2026-11-02 用户最后定的:文件库窗口要先加载图库、有点慢):「上传图片」= 直接选电脑里的图上传(`#ed-upload`,也进 Shopify 文件库);**「选择图片」= 打开 Shopify 文件库**:App Bridge intents `shopify.intents.invoke('pick:shopify/File', { data: { mediaTypes: ['MediaImage'], multiSelect: false, selectedFiles: [当前图] } })`(2026-06 起有),
  只给回文件 id → `GET /api/schedule/file?id=`(`files.imageById`,刚上传还在处理的等一会儿)拿图片地址。不在 Shopify 后台里(没有 intents)就提示用「上传图片」;拖图片进「图片」那一段照样直接上传。(2026-11-02 用户在正式后台确认:这个窗口自带 Add files / 拖拽上传 / Generate image,当前图预先勾上。)本地 harness 的假 App Bridge 每次轮流给回 990001 / 990002 两张图(`window.__pickCancel = true` 模拟关掉)。
  悬停 Banner(网格、时间轴等所有地方)显示大图(`pop--banner`,图宽 340,窗口矮时按高度缩)。
  **「结束」**(`schedule-actions` 的 `end`,2026-11-02 用户:暂停的一直占着轮播顺序):暂停中的内容编辑器底部有「结束」(再点一次确认)→ 取消暂停、结束时间设成现在(还没开始的开始也设成现在;跟随活动的变成自己的时间),
  变成已结束,不再参与排序(`orderPipeline` 只认 上线中 / 已排期 / 待审核 / 等活动 / 暂停)。活动不能用(改活动的结束时间)。
  已结束 / 暂停的条目在店里是草稿:Liquid 遍历 `.values` 只返回 ACTIVE(草稿不算进一次最多 50 个,也不拖慢前台);每个类型最多存 1,000,000 条。太多了用「设置 → 清理内容」批量删。
  **主题编辑器里的备用 Slide 自动同步**(`src/theme-banner-sync.js`,2026-11-02 用户:编辑器里那一串 Slide 全部清掉,以后跟着 app 上线中的 Banner 走,编辑器尽量简单):
  ★ **同一天用户决定先暂停**(要写主题,之后再评估;旧 Slide 用户自己手动删、留几张长期能用的当备用)→ 代码保留,**默认关**:Railway 设 `THEME_BANNER_SYNC=on`(还要给 app 加 write_themes)才跑;
  关着时定时器不跑、Banner 页不显示那一行、`POST /api/schedule/theme-banners/sync` 直接拒绝。本地测要 `live-harness.mjs --theme-sync`。以下是打开后的行为:
  定时器每分钟算「上线中的 Banner」(顺序 / 图 / 文字 / 按钮 / 角标)的指纹,变了就写一次,没变也每天读一次核对(有人在编辑器改过 / 编辑器开久了保存把旧的盖回去 → 改回来);Banner 页「立即同步」= 强制核对。
  ⛔ 只改正在用的主题(MAIN)`templates/index.json` 里**没隐藏的** gpt-slider-banner-3 section 的 `blocks` + `block_order`(读 → 只换这两个键 → `themeFilesUpsert` 写回),
  别的 section、这个 section 的设置、隐藏的 section、文件开头的 /* */ 说明都原样;block 名字一律「App 同步」、id `cgp_<Banner id>`;图片写 `shopify://shop_images/<文件名>`(不是文件库的图留空),`/collections/x` 写成 `shopify://collections/x`,视频只认 YouTube / Vimeo。
  一张上线的都没有时不写(留着上一次的,免得首页空);写之前原文件存 `DATA_DIR/theme-backup/<店>/`(最近 20 份,和排期数据分开放 —— 别放进 schedule 目录,listShops 会当成店铺)。
  要 **write_themes** 权限;没有时状态记在 `state.themeBanners.error`,Banner 页显示原因,30 分钟后(或 Banner 变了 / 手动点)再试,操作记录只记第一次。本地 harness(要加 `--theme-sync`)默认有这个权限(`--no-theme-write` 模拟没有),写的文件只在内存,`GET :4894/__theme/templates/index.json` 看。
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
  **例外:Collection 置顶排序编辑器**(2026-10-21 用户「设置都放上面,下面就是改顺序显示全部产品」;**2026-10-29 重排**):
  ① Collection 与名称(Collection 是主角 `.pcol`:名字 + 后台 / 前台 + 换一个 + 状态标签;下面「排序名称」—— 留空就用 Collection 的名字;Collection 默认设置、促销链接两行)
  → ② 显示时间(新建默认**长期显示**)→ ③ 排序设置(「完全按本次排序」在前、「只显示前 N 个」在后;「产品卡上的促销标签」(倒计时 / 徽章)收在折叠里,写明一般不用)→ ④ 顺序(网格放最后)。
  「Collection 顺序历史 / 回滚」放在窗口顶上(`#wx-hist`,和这份置顶排序自己的「历史版本」并排),不在 Collection 那一行。
  网格:**点卡片 = 多选**(Shift 连选),选中条贴顶(`#wx-selbar`:移到第几位 / 置顶 / 不显示),拖选中的其中一张 = 一起移;输入序号移动后**页面不跟着跳**(用户在第 40 个检查,调到第 12 位后要接着往下看);产品图框白底(白底产品图配灰框像排版错)。
  **叫法**(2026-10-29 用户):界面上一律叫「置顶排序」(不说「清单」)、子页叫「Collection 默认设置」、开关叫「完全按本次排序」。内容类型定义名(metaobjects.js)不改。
  合集排序列表:每个合集默认只显示**这一刻生效的那条**(没有就按 上线中 → 已排期 → … 排第一的那条),其余点「显示全部 N 条调整记录」才展开(`pnOpen`);行首不放缩略图、产品小图不带序号。
  合集排序网格的产品卡:一行最多 4 个、标题最多 4 行、草稿写「Draft」、库存「UK:1 EW:2」(`POST /api/schedule/products-stock`;2026-10-21 用户:**不读仓库**,读店里已同步好的款式字段 `custom.uk_inventory`(UK Inventory → UK)、`custom.es_inventory`(EW Inventory → EW,用户要和后台名字一样),和主题 `stock-logic-compute.liquid` 同一组;所有款式加起来、只列有货的、全 0 =「无库存」、没这两个字段 = 不显示;只要 read_products)。
  主按钮文案自动写成「保存 · 马上上线 / 保存 · 10/24 上线」(已上线的是「保存修改」);保存出错用 `showFormErr` 标到字段上(`ERR_FIELD` 按错误文字找字段,新加校验文字记得补映射)。
- **说明文字**:页面上只留一句话;长解释放字段提示(`fld` 第三个参数)或折叠起来。
  **2026-11-03 起说明一律收成 ⓘ 图标**(用户:说明文字太多、界面难用;鼠标停上去 / 点一下才显示):`public/tips.js` 全 app 通用,页面画完自动把固定写法的说明换成图标 ——
  `.fld > em`(字段提示,放在字段名后面;没字段名的并进这一段标题的图标)、`.edsec__h > em`、页头 `.phead p.muted`、面板标题右边的纯文字说明、改价页 `.pr-fld > em` / `.pr-sec__h .muted` / `.pr-group__lab .muted` / `.pr-card__t .muted`、`.tipify`。
  只换**不带 class 的 em** 和这些位置;报错(`.fld__err`)、提醒条(`.note` / `.banner`)、带按钮 / 粗体的状态不动。新写说明照旧写在这些位置就会自动变图标;要手动用就写 `<span class="tipify">…</span>`。
  同一个标题已经有图标时,新的说明并进同一个气泡。图标在可点的标题里:点击在捕获阶段拦下,不会顺便打开分组 / 勾选框。
  **左边导航默认收起成图标**(`cgp-nav-mini2`,换了 key,以前存的「展开」不算),鼠标停在图标上马上弹出名字(CSS `data-label`);内容区最宽放到 1480。
  改价编辑页窗口 ≤ 1420 宽时,右边摘要 / 检查挪到上面并排,编辑区用满整行(表格不被挤掉);表格「检查」列只放红 / 黄「!」图标,停上去看原因。

- **每个页面 / 每条内容都有自己的网址**(2026-11-09 用户:整个 app 只有一个链接,每次都要打开后逐个点):`public/nav.js` 管网址 ↔ 页面。
  网址:`/`(概览)、`/<页面>`(和导航的 `data-section` 一样)、`/<内容页>/<内容 id>`(打开编辑)、`/campaigns/<活动 id>[/web|/price|/lark|/edit]`、`/pins/collections`、`/pins/collection/<Collection id>`、`/price[/<计划 id>|/vault|/ledger|/settings]`、`/notify[/groups|/log]`、`/settings[/members|/roles|/conn|/my-notify]`。
  后台网址 = `admin.shopify.com/store/<店>/apps/<app>` + 上面的网址;Shopify 会把后面那段带进 iframe,app 里 `history.pushState` 换网址 Shopify 也会同步到后台地址栏。
  **iframe 网址上 Shopify 带来的参数(shop / host / id_token…)要原样留着**(app 有好几处整页刷新)。现在界面对应哪个网址由 `schedule.js` 的 `cgpNav.pathOf` 算(改价 / 通知中心各自给 `cgpPricePath` / `cgpNotifyPath`),打开网址由 `cgpNav.open` 做(点对应的导航 → 再打开那一条;找不到 / 没权限 → 提示并停在列表)。
  **界面变了要调 `window.cgpNav?.sync()`**(showSection、打开 / 关掉抽屉、活动页、改价 `render()`、通知中心 `draw()` 已经调了;新加的分页 / 抽屉记得加)。改价编辑有没保存的改动时后退键不离开。
  页面资源一律用「/」开头的地址(server.js 改写 index.html;别再写相对地址,`/price/xxx` 下会变成 `/price/style.css`)。服务器:不带扩展名的地址都回首页,带扩展名找不到的照常 404。
  飞书通知的按钮直接打开那一条(`src/app-links.js`:`appLink` / `itemPath` / `planPath`;一张卡片好几条就打开列表 / 概览)。编辑器、活动页、改价计划、Collection 默认设置都有「复制链接」(复制后台网址)。
  直接开网页(不在后台)用飞书登录:登录前在哪一页记在 sessionStorage `cgp-back`,登录完回到那一页。

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
  **预先添加同事**(2026-10-29 用户:只有名字、没有飞书 id;**2026-11-02 加邮箱**):设置 → 成员里填**飞书邮箱**和 / 或名字 + 勾角色,存 `state.invites`(`{ name, email, roles }`);同事**第一次**用飞书登录时对上就套用角色并启用,成员标 `fromInvite`(`via: email|name`),预设删掉,操作记录写清楚是邮箱还是名字对上的。
  · 邮箱:`lark-login` 读 user_info 的 `email`(要飞书开发者后台开「获取用户邮箱信息」contact:user.email:readonly)和 `enterprise_email`(「获取用户受雇信息」),不分大小写;没开权限就是空的。
    预设填了邮箱、飞书也给了邮箱 → **只按邮箱对**(同名的别人对不上);飞书没给邮箱 → 退回按名字对(`normName`:中文名或英文名,不分大小写、空格)。同名的两条预设都填了邮箱才允许。
  · 每次登录记 `state.emailCheck`(这次给没给 + 最近一次给了邮箱的 `okAt`),成员面板显示「✅ 飞书登录会给邮箱」或「⚠️ 没给 + 怎么开权限」;个别同事飞书没填邮箱不会把 ✅ 打掉。登录过的成员记 `emails`,成员表里名字下面显示。
  · ⛔ `LARK_LOGIN_SCOPE`(可选,Railway 变量):登录授权页额外要的权限。**只能填开发者后台已开通的**,填了没开通的飞书授权页报 20027、谁都登录不了 —— 所以不写死在代码里;开通发布后 user_info 还不给邮箱才加。
  ⛔ 邮箱 / 名字都是飞书管理员录入的,不是本人验证过的:预设**不能给管理员**;对上两条以上不猜;成员表标「按预设自动开通」,7 天内的在成员面板顶上提醒管理员核对。已登录过、还在待分配的,预设时直接开通(有邮箱按邮箱找)。接口 `POST/PUT/DELETE /api/invites`(管理员;PUT 可改角色或补邮箱)。
  **谁能成为管理员**:设了 `LARK_ADMIN_IDS`(飞书 open_id,逗号分隔)→ 只有名单里的人,且每次登录都保证是启用的管理员;
  没设 → 只有「第一个从 Shopify 后台里登录的人」一次,之后 `bootstrapDone` 永久关门。停用成员立即生效(每个请求都查成员状态)。
  **测试模式**(`state.testMode`,`src/members.js` 的 `setTestMode` / `testModeOn`):临时免登录,方便自己试。四道闸别去掉 ——
  ① 只在带 Shopify 后台凭证时生效(直接开 app 网址的人照样要登录);② 只有 `LARK_ADMIN_IDS` 名单里的人、真的飞书登录后才能打开;
  ③ 到点自动失效(默认 2 小时,最长 8);④ 测试身份只能关、不能开 / 续,也不能改成员和角色。开着时顶部常驻红条 + 设置页提示,开关都记操作日志。本地测:`node scripts/live-harness.mjs --fresh --lark`(假飞书,可选测试管理员 / 员工 / 设计)。
- **改价模块(v3 3.2,从 `../price-scheduler-app` 搬入)**:`src/price/`(`price-core.js` 规则 + `price-actions.js` 动作和权限 —— 纯函数,页面经 `/lib/price-*.js` 共用;`executor.js` 每分钟对齐价格;`shop-io.js` 唯一写价格 / 合集的地方;`catalog.js` 选产品;`notifier.js` 产生改价通知(发给谁 2026-11-09 起由通知中心定,以前写死「只私信、不发群」);`api.js` 挂 `/api/price`,server.js 用 `needMember('price')` 限定定价角色 + 管理员)。数据在 `DATA_DIR/price/`,和排期分开。
  每个计划可指定审批人(`approver`)/ 负责人(`owner`)/ 抄送(`cc`),只能选能看改价页的成员;没指定审批人 = 管理员审批;审批人自己提交直接生效。
  **界面按原来那个 Simple Product Price Scheduler 的做法**(2026-10-10 用户给了截图):一个计划 = 一条规则 + 一个时间段(没有多时段 / 每日日程,Flash 每天用「复制成下一天」);
  表单从上往下填(名称 → 改什么价 → 改哪些产品 → 什么时候 → 产品标签 → 负责人审批 → 划线价 → 试算预览),右边常驻一段大白话摘要;逐个变体的价格收在「试算预览」里。
  `plan.scope`(all / collections / products / search)+ `plan.rule` 存下来,`slots[0].items` = 每个变体的新价;手改过价的变体带 `manual`,重算时保留。
  ★ **没有「试算」按钮了**(2026-10-29 用户:选了就要看到、改了自动刷新):「哪些产品」和「新价怎么算」分开 ——
  选 Collection / 品牌标签类型(停 0.6 秒)/ 单品 → `loadGroup` 马上读这一组的产品(`E.lists[组]`,按来源缓存在 `cache.cat`,加一个单品只读新加的);
  改折扣(停 0.35 秒)/ 方式 / 尾数 / 分组顺序 → `recompute()` 在本地马上重算(不去店里读)。全店所有产品要点「读出全店产品」才读(几千个)。
  手改新价、划线价例外按变体保留。
  **指定产品按选项选**(2026-10-29 用户):`scope.products[].variants` = 在 Shopify 选择器里勾的选项(没有 = 整个产品);再开选择器带上 `selectionIds[].variants`;读到产品后全勾了就记成整个产品(`normalizePick`)。
  表格只列选了的选项,产品名下标「另有 N 个选项没选,不改价」。**两种「去掉」分开**(用户:单品不是合集,去掉就该删):指定产品模式叫「删除」(`pickDelete` 直接改选的清单,没有「已排除」);
  Collection / 品牌标签 / 全店叫「排除」,记在 `groups[].removed`(加产品、改规则、重新读都不会加回来,「已排除」里能恢复;范围清空 / 不在这批产品里的排除记录自动清掉)。
  上一版对指定产品记的 `removed` 打开时自动换成「没选的选项」。界面上「变体」一律叫「选项」(用户的说法)。
  老计划打开时后台读产品但**不重算、不算有改动**,只把当时去掉的补记进 `removed`(`seedRemoved`:清单里有、计划里没有的);保存前 `ensureCalc` 读齐、算好。
  顺序:**新加的在最上面**(单品、Collection 都是,用户定的);**一组只用一种来源**,要混合就分组(用户定的)。现价 £0 的只提醒 + 「把这 N 个去掉」按钮,不自动排除(用户定的)。
  表格上有「全部 / 有问题 / 手改过」筛选和搜索;`render()` 重画后把光标放回原来的输入框(边打字边刷新)。
  **虚拟折扣**(2026-10-29 用户:有时要把原价调高、现价不变):限时计划的规则是「新价**不能比现价高**;和现价一样(或「售价不变」那一组没填价)时**划线价必须有变化**」——
  `price-core.itemWarnings`(not-lower 只拦比现价高的,一样高且划线价没变 = no-change)、`price-actions.validate`(「售价不变」那组 `ruleModeOf = keep` 不要求填价)、
  执行器 `decide` 的「不能打着促销涨价」只拦 `>` 原价,三处一套。选「售价不变」的限时计划自动把划线价切到「逐个指定」,表格上面有「一键填划线价 = 现价的 X%」。结束时售价和划线价一起回到改价前(和别的计划一样)。
  界面:「改什么价」一排按钮;「划线价」默认收起只显示现在选的(点「修改」展开,选完收起);「恢复原价」一律说成「回到改价前」(用户:容易以为是回到没有划线价的原价);
  款式图单独小批量读(`GET /api/price/catalog/vimages`,用款式的 media,每次 5 个产品)—— ⛔ 别加进读产品的大查询(50 个产品 × 100 个款式,怕超出单次查询上限)。
  `render()` 重画时按 `data-v` 找回正在输入的那个框,并把还没按回车的内容放回去(后台读完产品 / 款式图会重画)。
  **改价分组**(2026-10-13):`plan.groups = [{ id, scope, rule }]`,一个计划可以分几组(比如合集 A 85 折、品牌 B 7 折、几个产品逐个填价);试算时一组一组算,
  同一个变体在几组里**下面的组覆盖上面的**,每个变体记 `item.group`;规则多了 `manual`(逐个填价,表格里一个个填)。保存时 `scope` / `rule` 仍写第一组(老界面、历史兼容);
  老计划打开时自动变成一组。分组只是编辑器的配置,执行器照旧只看 `slots[].items`。~~层级~~ **2026-10-26 改成数字优先级**(`priority` 1–10,默认 10 最高;数字大的说了算,一样大开始晚的说了算,再看批准晚的;`prioOf` 把老计划的层级换成 限时抢购 10 / 品牌 9 / 全场 8,先后不变;开始后也能改)。
  两个限时计划改到同一产品、时间重叠 → 列表行标黄「和 X 改到同一批产品」(`overlapIndex`),编辑页检查区黄色提醒用谁的价。
  划线价从「高级」挪到改价分组下面,**2026-10-28 用户定五个选项**(顺序如下):`original` 显示原来的划线价,没有就显示原来的现价(**限时默认**,不然原来没打折的产品改了价看不出打折)
  / `keep` 只显示原来的划线价(没有就不显示,**永久默认**)/ `price` 只显示原来的现价 / `clear` 不显示 / `set` 逐个指定。
  改价方式顺序:百分比降价 → (永久才有的涨价)→ 减固定金额 → 逐个填价 → 售价不变 → 统一改成一个价。
  **划线价按分组设**(2026-10-28 用户):每组卡片里自己选(`groups[].compare`),执行时 `cmpModeOf(plan, item)` = 条目那一组的 > 计划的 `compare`(老计划只有这个,保存时 = 第一组的)> 限时 original / 永久 keep;
  开始后按 `groupCmpModes` 比较,哪一组改了都拦(老计划打开后各组补上计划的方式不算改)。
  **划线价单独例外**(2026-10-28 用户):不管选哪种方式,试算表格里都能给个别变体改划线价 → 条目 `cmpManual: true` + `compareAt`(空 = 这个变体不显示),
  `targetFor` 先看它(服务器执行也认);重新试算保留;标「例外」,清空 / 点「用规则」回到计划的方式。划线价不比新价高会提醒。
  「产品和新价」放在**每一组**里(只看这一组的产品;所有组一起算,`E.groupHits` 记每组选中多少、被下面的组覆盖多少);分组是带编号的卡片,「+ 再加一组」是整行虚线按钮。
  列表分类:未结束 / 进行中 / 已排期 / 草稿 / 已结束 / 全部;「待审核」只有多人协作开着或真有待审核的计划时才显示。
  **改价倒计时**(2026-10-27 用户要、同意新增写入):限时计划的 `countdown` = { on, label, days: 0/1/3/7/15, style: classic/pill/dark/minimal },默认关。
  执行器每轮 `planCountdowns` 算「此刻真的在这个计划价格上的产品」(保险库 written.planId、没暂停接管;一个产品几个计划取最早结束的),
  和 `state.cdState` 比,只写 / 删有变化的 → 产品字段 **`custom.cgp_price_cd`**(json `{e, s, l, st}`,`shop-io.js` setCountdowns / deleteCountdowns,每批 25 个)。
  ⛔ 这是改价模块唯一写的产品字段,只动这一个 key;结束 / 暂停 / 提前结束 / 被人手动改价都会删掉。
  主题 snippets/cgp-campaign-offer.liquid 读它:**改价倒计时 > 活动**(活动徽章照常,倒计时 / 样式 / 文字换成改价的);「最后几天才显示」在浏览器按 s 判断。
  ⛔ **置顶排序不再管促销标签**(2026-10-29 用户:整个去掉):编辑器里没有倒计时 / 徽章了,写店铺一律写空(`show_countdown` false、`badge_text` 空);
  以前设过的由定时器 `dropPinPromo` 清掉一次(店里条目重写、每份记操作日志)。主题里读置顶排序徽章的那段代码还在,但字段全是空的 = 不起作用;字段定义也留着(改定义会让设置页标「要更新」)。
  ⛔ **时段的「加进 Collection」按 2026 新版 Collection 做**(用户 2026-10-30 提醒:带条件的也能有「单独加入的产品」和「排除」,条件能叠几组;别再当成「自动 Collection 不能加」):
  `shop-io.collectionModel`(**2026-07 接口**,旧接口看不到新版合集会以为被删了 —— 10/29 误判过)看它是 纯手动(`via: manual`,collectionAdd/RemoveProducts)/
  带条件(`via: sources`,改它自己的「单独加入的产品」名单 `includeProducts` / `unincludeProducts` → collectionUpdate sourcesToUpdate,**不动条件**)/ 条件和别的 Collection 共用(`via: shared`,不碰,只记一笔)。
  不管产品本来在不在(比如已经因为打折被条件收进去),都加进「单独加入」一次确保在里面(用户要的);事先就在名单里的记 `preexisting`,结束不拿掉,只拿掉 app 加的 `managed`。
  10/30 之前的老记录:带条件的 Collection 加不进去,app 却把「按条件收进去的」当成自己加的,到点「移出」→ Shopify 回「Collection does not exist」→ 每分钟失败、每小时通知(删了计划也停不了)。
  第一次碰到时 `managed` 只留真的在名单里的;`goneCollections` 里误判的(没核对过、不是手动停的)用新版接口核对一次,还在就恢复。**只有新版接口确认 Collection 真的不在了才停手、通知一次**;
  新版接口出错时退回老接口只信「查到了」,查不到当「不确定」下一分钟再查(别判成删除)。「受管产品」里能手动「不再管这个 Collection」(`POST /api/price/coll-release`)。
  选时段 Collection 的搜索也用 2026-07(`catalog.findCollections`),带条件的能选、条件共用的不能选。
  `plan.tagsAdd` / `tagsRemove`:生效期间加减产品标签(驱动按标签自动归类的合集),结束还原;只动计划里填的标签,产品本来就有的不碰(`price-core.planTags` + `state.tagState` 记账)。
  **第二轮第 1 期**(2026-11-03,方案 `docs/price-v2/PLAN.md`):
  · **计划分组**:`plan.folder` = 自己起的分组名(「我的分组」,最多 40 字);按活动 / 品牌(计划里选项最多的那个品牌)/ 开始月份自动分的叫「智能分组」,在页面上算、不存。
    改分组 / 关联活动走 `organize` 动作(`ids` + `folder` / `campaign`):**任何状态都能改、不走「已开始锁定」和审批、不碰价格**;跟随活动时间的计划不能这样换活动(会改时间)。
    列表(同一天按用户选的改成**一排分组标签**,原来「分组方式 + 三个筛选下拉」叠在一起太绕):状态页签 + 搜索框(计划名 / 产品 / SKU / 品牌 / 活动)一行;下面一条 =
    「我的分组 | 按活动 | 按品牌」小开关(记在 `cgp-pr-by2`)+ 带数量的标签(数量按当前状态页签 + 搜索算,和列表对得上;点一个只看它)+「＋ 新分组」(先勾计划再起名,回车放进去)+「全选这 N 个」;
    列表本身**平铺,不再分段**。一个计划有几个品牌,几个品牌标签里都算它。勾选后的整理条(移到分组 / 关联活动)不变。编辑页「分组」框:已有计划改了马上存(不用点保存)。
  · **组名**:`groups[].name`(最多 30 字),不填叫「分组 N」(2026-11-09 用户:一组 = 一批产品;以前只有一组时叫「改价规则」容易误会)。
  · **UK 库存**:读 Shopify 各仓库存(唯一真源),读 **Available**;只要 read_inventory。⛔ **仓库名字要 read_locations,app 没有**(11/3 正式店报 Access denied for name field)→ UK 仓**按编号认**:`gid://shopify/Location/43451853` = 伦敦仓(Shopify 里叫 Cinegearpro,stock-dispatch-app 首次同步核对过);`catalog.locations` 读不到名字就只读编号(连编号都读不到就只给伦敦仓),「改价设置 → 库存」可换(存 `settings.ukLocation`)。
    `POST /api/price/catalog/stock { ids }`(最多 500 个,服务器每批 50)→ `{ 款式: 数字 | null(不追踪库存) }`,这个仓没记录 = 0;操作记录不记(audit SKIP)。产品表多一列「UK 可售」(0 灰、负数红)。
    组的 `scope.stock = 'uk'`「只要 UK 仓有货的」:**按选项**筛掉 Available ≤ 0 的(不追踪库存的照算有货);库存没读到的先不放进清单,`stale()` 等它读齐,保存前 `ensureCalc` 等库存读完。只对 Collection / 品牌标签 / 全店有效;指定产品是自己点选的,只给「删除没货的 N 个选项」按钮。
    是**编辑时的库存**,保存后清单固定;进行中卖完照样打折,到期回原价(用户 11/3 定:不要「卖完自动回原价」)。本地 harness 的假店和正式店一样读不到仓库名字;伦敦仓的可售数按款式 id 编(有正有零有负,每 23 个一个不追踪)。
  **第 2 期 · 产品改价记录**(2026-11-03):产品表每个产品下面「改价记录」、受管产品 / 价格账本里点产品名 → 弹窗:app 改过几次价、在几个计划里、现在谁接管;
  逐条改价(时间、开始 / 换价 / 回到改价前、改前 → 改后、哪个计划,计划名能点开)+ 包含这个产品的所有计划(状态、时间、计划的价);多选项产品能按选项看。`GET /api/price/product-history?product=`。
  ⛔ **价格账本挪到单独的只追加文件** `DATA_DIR/price/<店>.ledger.jsonl`(以前存在主文件里最多 5 万条,执行器每分钟读写整个文件):`appendLedger` 照旧先放进 `state.ledger`,**`save()` 时写进文件再清空**(老数据第一次保存时整批搬过去);
  读一律用 `readLedger(shop)`(最新在前,文件没变就用缓存,重复的只算一条)。别再直接读 `state.ledger`。文件名 .jsonl,`listShops` 只认 .json,不会当成店铺。
  只记得到 app 改的价;不在任何计划里时有人直接在 Shopify 后台改的价记不到(Shopify 没有价格历史)。
  **第 3 期 · 一个计划多段时间 + 多个价格**(2026-11-03,用户:灵活的日期,不只是工作日 / 周末):
  · `plan.versions = [{ id: 'A'…, name }]`(最多 6 个);每组 A 用 `g.rule`,其余用 `g.vrules[版本]`(产品清单各价格一样,排除 / 删除对所有价格都算;手改的价、划线价例外按价格分开)。
  · 时间安排 `plan.schedule.mode`:`one` 一段时间(和以前一样)/ `multi` 几段时间(每段自己的开始、结束、价格)/ `weekly` 每周重复(`schedule.weekly = { from, to, rules: [{ days 1–7, from, to('24:00' = 整天), version }] }`,按英国时间每天切段,连着的同价格合成一段,段编号按开始时间 + 价格定)。
  · **保存时由编辑器展开成执行器的时段**:每段 `slot.version` + 那个价格的全部条目(同价格的段条目一样)→ **执行器不用改**:两段连着直接换价(switch),中间空着回到改价前(restore)—— `test/executor.test.js` 有整段模拟。
  · 最多 60 段;跟随活动时间的计划只能「一段时间」;`validate` 查段数 / 价格版本 / 每段的价格存在。
  · 开始后:产品和价格锁住;**已开始的段锁开始时间和价格,结束时间能改(不能改到现在之前)**;以后的段能改 / 删 / 加;每周重复开始后规则锁住,只能改「到哪天」。
    ⛔ 2026-11-03 顺手修:以前「已经开始的计划也能改结束时间」**其实存不了**(锁的时候连结束时间一起比,而且开始后根本没有保存按钮)—— 现在 `slotKey` 不含结束时间、开始后有「保存时间修改」。
  · 列表行写「每周重复 · N 段 · M 种价格」,时间轴按价格上色;改价记录弹窗里计划的价按价格分开写。
  · **价格起名 + 显示**(2026-11-09 用户:到处只写 A / B 看不懂,任务 / 分组 / 价格都要能起名、清楚显示):字母只在内部用,界面一律 `vName` = 名字,没起才写「价格 A」。
    「改价分组」最上面是**价格总览表**(`priceMatrixHtml`,用户选的):一行一组、一列一个价格,列头就是价格名字(直接改,没起名的虚线框提醒)+「用在 N 段 / 还没有哪段用它」,
    格子 = 这一组在这个价格下的短说法(`ruleShort`:降 15% / 逐个填价…)+ 没填价数,**点格子 = 打开那一组、切到那个价格**;打开的组「改什么价」旁边也有价格切换。
    产品表**每个价格一列、并排能改**(用户选的;超过 3 个只并排 3 个,正在看的那个一定在):输入框带 `data-ver`,下面写降幅;「变化」列只在一种价格时有。
    ⛔ **划线价对所有价格都一样**(都按原来的价算):产品表只一列,改一次所有价格一起改(`sameVariant`),重算时别的价格照 A 抄(`syncCmp`)。
    时间轴的条写价格名字,停上去看计划 · 价格 · 时间 · 每组怎么改;计划列表每种价格一行(名字 + 每组折扣 + 用在几段)。
    ⛔ 「售价不变 / 要不要填价」按**那一段用的价格**判断:`core.ruleModeOf(plan, item, ver)`、`itemWarnings(…, { version })`,服务器 validate 传 `slot.version`;页面用 `IVER`(WeakMap 记每个条目属于哪个价格)。11/09 之前只看 A 的规则(价格 B 设「售价不变」会被误报「还没设活动价」)。
  **系列(已撤回)**:2026-11-09 试过「一段 = 一个计划,用系列串起来」,用户当天就说更乱(计划名 / 分组 / 系列 / 段名分不清)→ 全部撤回,回到「一个计划里分几段时间」再优化。
    `plan.series` 字段可能留在当天建的测试计划里,没有任何地方再读它;服务器 `/api/price/state` 的 `series` 列表也没人用。⛔ 别再做「一段一个计划」。
  **结构只有三层**(2026-11-09 用户定):**计划名** → **改价组**(哪批产品、怎么打折,组可起名)→ **价格**(多价格调整,可起名,如 正式价 / Flash 价);时间段只选「用哪个价格」,本身不起名。
  · 计划上的「分组」(`plan.folder`,列表整理用):同一天一度去掉(误会了用户),**用户要回来了** —— 列表「我的分组 | 按活动 | 按品牌」、勾选「移到分组」、「＋ 新分组」照旧;
    编辑页里叫「**列表分组**」(和改价分组「分组 1 / 分组 2」= 一批产品 区分开)。数据一直没删过,恢复后原来的分组都在。
  · 一段时间时「改价分组」上面有一条「价格:整段时间一个价 · ＋ 不同时间段用不同价格」(`gomulti`,切到几段时间),免得找不到。
  · **每个价格自己的设置**(用户选的):几段时间 / 每周重复时,**加进 Collection、加标签、去掉标签、关联活动、倒计时**都在价格总览表下面几行、按价格设(`versions[]` 上的 `coll / tagsAdd / tagsRemove / campaign / countdown`,`ensureVersions` 老计划从计划上那一份补);
    这时计划上的「加进 Collection / 倒计时 / 产品标签 / 关联活动」那几段不显示。保存时 `slotsOut` 把价格的设置展开到用它的每一段(`slot.collection / tagsAdd / tagsRemove / campaign / countdown`),
    计划上的 tagsAdd / tagsRemove 存空、countdown 存关、`campaigns` = 各价格的活动(`campaign` = 第一个,跟随活动时间只在一段时间时能用)。切回一段时间:价格 A 的设置回到计划上。
    执行器按段读:`planTags` / `planCountdowns`(`slotCountdown`)段上有就用段的,没有(老计划)用计划的;`planCollections` 本来就按段。两段连着、设置不同 → 换价那一分钟一起换 Collection / 标签 / 倒计时。
    活动页(schedule.js 活动详情 `segsFor`):段上带 campaign 的计划**只算关联了这个活动的那几段**(那个价格的名字、时间、产品数);老计划按计划上的 campaign。列表「按活动」一个计划可以在几个活动下面。测试 `test/price-per-version.test.js`。
  · **价格总览是单独一段,放在「什么时候生效」上面**(2026-11-09 用户;一开始放在「改价分组」最上面);点格子仍是打开上面那一组、切到那个价格。
  · ★★ **「改价时间段」表:一列 = 一个时间段**(2026-11-09 同一天用户最后定的;之前一列 = 一个价格,用户看着像「一列一个改价组」):
    不是每周重复的限时改价(`segCols`),**一段一个价格(1:1)**:列头 = 段名(就是价格的 name)+ 开始 / 结束(一段时间改计划那一段 `start/end`,几段改 `segstart/segend`);
    「＋ 加一段」(`coladd`)= 新价格 + 接在最后一段后面一段(长度照上一段,最多 7 天),折扣照着正在看的那段、设置从空的开始;「✕」(`coldel`)删段连价格一起删。
    「什么时候生效」只剩 限时 / 永久、「按时间段 | 每周重复」、时间条、优先级;不再有「几段时间」的段列表和「用哪个价格」下拉。
    老计划几段共用一个价格的,打开时 `splitSharedVersions` 拆成每段一个(最早那段留原编号 —— 已开始的段 slotKey 含版本号,别改它)。最多 20 段(`MAX_VERSIONS`)。
    每周重复照旧:一列 = 一个价格,规则里选用哪个。计划列表按时间段每段一行(段名 · 时间 · 每组折扣 · 这段的设置),标签写「N 个时间段」。
    顶上时间轴的条写「计划名-段名」(如 test2-黑五);时间轴能翻页、缩放(`GV`:一周 / 两周(默认)/ 一个月 / 三个月,记在 `cgp-pr-gspan`;‹ 往前 / 今天 / 往后 ›,
    往前翻到今天之前会自动把已结束的计划读进来;一个月 = 日期 + 星期两行,三个月 = 周一写日期、1 号写月份)。计划列表排序(`SORTS`,记在 `cgp-pr-sort` / `cgp-pr-sortdir`):按创建时间(默认,新的在上)/ 编辑时间(`updatedAt`)/ 改价开始 / 改价结束(这两个默认早的在上),旁边按钮反过来;不再按状态分先后。
  · ★ **限时改价不管分不分段,界面都一样**(同一天用户:没分段和分段两套界面不统一):一段时间也显示价格总览(只有价格 A 一列 + 它的 Collection / 标签 / 活动 / 倒计时),
    计划上那几段(加进 Collection / 倒计时 / 产品标签 / 关联活动)限时改价一律不显示(`perPrice` = 限时);永久调价还是计划上那一份。
    「＋ 加一个价格」= 多一列(设置从空的开始,折扣照着正在看的价格),一段时间时**自动换成几段时间**:原来那段用价格 A,后面接一段一天的用新价格。
    一段时间保存时段上也带价格 A 的设置(版本号不动,免得已开始的老计划被当成改了时段);「跟随活动时间」看价格 A 的活动(`vcamp` 改 A 时同步 `plan.campaign`)。
  · 计划内「几段时间」照常显示(撤回系列时恢复)。
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
  **照另一个 Collection 的顺序排**(2026-10-28 用户:Black Friday 的产品顺序要完全照 Autumn Sale):合集默认排序的设置抽屉第 2 段。规则 / 执行在 `src/col-copy.js`(`planCopy` 纯函数),`POST /api/schedule/col-copy-order { id, from, preview }`(管理员)。
  一次性:目标店里的手动顺序排成和来源一样(两边都有的照来源;只在目标里有的排最后、保持原先后;只在来源里有的**不加进目标**),「平时怎么排」也照来源设(需要时后台排序方式改成手动,走 `applyColSort`)。
  来源是自动排序 → 不复制(提示把目标也设成同一种自动排序);目标正被置顶清单接管(`colState` 没 released)→ 拦住。排之前 / 之后各记一版历史,可回滚。以后来源再调,目标不会自动跟着变。
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
- **飞书登录 / 权限 / 操作记录**(2026-10-28 用户:每个同事登录、所有操作都记录、按人限制页面,审批全部不要):
  · 开关:`TEAM_MODE=on`(飞书登录 + 成员 / 角色)和 `APPROVALS=on`(审批,**默认关**)分开。审批关着时 `actorOf` 一律给审核人身份(保存直接生效),页面上审批人 / 分工 / 我的工作 / 审核页 / 审批通知都按 `S.approvals` 藏。
    **2026-10-29 用户:暂时全部去掉审核** —— 审批关着时界面上不能再出现「审核 / 批准」:身份带 `direct: true`(服务器 actorOf / actorFor / 改价 actorOfReq,页面 me() / meActor),
    动作里发布的日志记 `publish`(「发布」)、不写「审批人自己排期(自动批准)」,改价提示「已保存,到时间自动执行」;列表「待审核」页签只在真有遗留时显示,「等活动批准」改叫「活动是草稿」并归到草稿;
    历史状态「已批准」显示成「已发布」;群提醒「到点了,但还没批准」对跟随草稿活动的内容改成「跟随的活动还是草稿」。新加界面文字照这个规矩:提到批准就按 `approvalsOn()` / `S.approvals` 分两种说法。
  · 页面权限 `members.js` 的 `PAGES` 和左边导航一一对应;老角色 `migrateRole` 迁移(商品模块 → 加 Collection 排序 / 促销链接 / 产品页推广,总览 → 加历史记录,迁移过标 v: 2 不再动)。
    ⛔ 设置 / 工具只给管理员:同事点左下角自己的名字(`.mechip` → showSection('settings'))只画「我的账号」(名字、角色、能看的页面、退出登录),别把设置页露给他(2026-10-29 修过)。
    ⛔ 服务器也拦:`schedule-api` 的 `needPage`(/act 按内容类型,其余接口按功能;设置类只给管理员),改价整个路由 needMember('price')。能看到就能改(用户选的)。
  · 操作记录 `src/audit.js`:server.js 里 `auditTrail` 中间件记每个 POST / PUT / DELETE(只读的 POST 在 SKIP 里),处理函数可放 `req.audit = { mod, text }` 写具体的人话;
    登录在飞书回调里记,另外每人每天第一次打开(`/api/me` → `noteOpen`)也记一条;存 `DATA_DIR/audit/<店>.jsonl`(只追加);`GET /api/audit` 所有登录的人都能看(用户选的),头像按成员表一起给。⛔ 中间件要在请求进来时就记下 req.path(结束时已被里面的路由改短)。
  · ⛔ **开关切换时页面要刷新**:每个 `/api` 回应带 `X-Team-Mode: on|off`,`app.js` 的 `api()` 和页面打开时的模式(`window.CGP_TEAM`,auth.js 记的)对不上就刷新一次(20 秒内只刷一次)。
    2026-10-28 踩过:开 TEAM_MODE 时页面没刷新,后台自动刷新拿到飞书模式的数据、设置页还是旧的「我 / 成员与角色」面板(没头像),改名字走旧的 `/schedule/staff` 报「找不到这个成员」。飞书模式下 `/schedule/staff` 现在直接提示刷新。
- **加载速度**(2026-10-28 用户:系统慢、不会动态刷新):
  · 服务器开了 gzip(`compression`),带 `?v=提交号` 的页面脚本 / 样式缓存一年(`/lib/*` 互相 import,不带版本,照常 304);
  · 慢数据(店铺设置 / 店铺信息 / 正在用的主题 —— 首页模板好几 MB)用 `swr()`:有旧的先返回、过期后台更新,完全没有时主题最多等 2.5 秒;服务器启动 3 秒后 `warmCaches` 预热;
  · 改价数据前端共用 `window.cgpPriceState(maxAge)`(同时只读一次);进入「改价」先用手上的数据画,再后台刷新;
  · 排期数据页面开着时每分钟后台读一次(`bgRefresh`),有变化才重画;开着编辑窗 / 弹出框 / 正在输入 / 页面在后台时不读。
  · ⛔ 本地测试环境的入口要改写首页 HTML,转发时去掉 `accept-encoding`(不然拿到 gzip 改坏了)。
  · **打开时**(2026-10-29 用户:每次先看到「旧版」再变新的 —— 其实是 index.html 写死的演示横条 + 全部导航在等数据):`<body class="is-booting">` 只显示「正在加载」,
    schedule.js 画完 / auth.js 显示登录门时调 `window.cgpBooted()` 去掉(20 秒保险)。`/api/auth/config` 和 `/api/me` 同时发,`/api/schedule/state` 也和登录检查同时预读
    (⛔ 预读用裸 fetch,别用 `api()`:没登录时 api() 会清登录并刷新,会无限刷新);Google 字体不挡首屏(media=print 再切 all)。没开审批就不读「我的工作」的改价数据。
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

- 写操作只限:建 `cgp_*` 内容类型、写 / 切换 `cgp_*` 条目、上传 Banner 图片;首页 Banner 备用 Slide 同步进主题首页模板(只动那一个 section 的 slide);合集排序 / 改价模块各自写的那几样(见上面各节,合集默认排序会写合集字段 `custom.cgp_*` 和合集排序方式;联合推广会改它选定的那一个手动合集的成员,也能新建空的手动合集并发布到网店)。**别碰产品、主题、别的 app 的数据**;新增任何其他 mutation 前先和用户确认设计。
- 主题扫描**只读**,绝不改主题文件。唯一的例外:首页 Banner 的备用 Slide 同步(见 Banner 一节,只动那一个 section 的 slide)。
- Railway 的 App URL 必须是公网域名(`*.up.railway.app`),别填 `*.railway.internal`(内网,Shopify 解析不到)。
