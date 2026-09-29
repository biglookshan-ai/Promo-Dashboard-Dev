# PLAN · 全站内容排期系统

> 从「元数据管理」升级为「**全站更新排期与监控**」:所有要定期更新的网站内容在一个后台里
> 编排、排期、查看,到点自动上线、到期全站自动消失,不再去主题编辑器或逐个产品页改。
>
> 本文是设计与分期的真源。进度看 `PROGRESS.md`。
> 最后修订:2026-09-29

---

## 🎯 要解决的问题

现在每次更新网站都要进主题编辑器或逐个产品页改,所以经常滞后、难管理。实测证据(主题 `cinegearpro-2-0-1`):

| 模块 | 主题里的实现 | 现状问题 |
|---|---|---|
| 顶栏 | `header-group` 一个 section 装 3 套完整顶栏(`blocks/ai_gen_block_a08faac`),2 套停用 | 换季靠整套开关;5 个公告位残留过期链接(`spring-bank-holiday`)但文字为空 |
| Banner | `sections/gpt-slider-banner-3`,35 张 slide | **19 张停用的旧图**堆着,全靠手动开关,没有时间字段 |
| Top Categories | `sections/gpt-collection-list-2`(+2 个停用副本) | 手动换合集 |
| Sale 模块 | `sections/GPT-Custom-Product-List`(标题 Deals) | 已按合集取数 ✅;第一个 tab 仍是 `easter-deals` |
| Feature 模块 | `sections/gpt-555` | 已按合集 `staff-picks` 取数 ✅ |
| 产品页促销 | `templates/product.json` 里 **11 个 custom_liquid 块**(粘在编辑器里,不进版本库) | 倒计时逻辑复制了 **6 份**(4 个 section + 2 个 block);只在浏览器里隐藏,服务端从不过期 |

已定论:主题读的是**产品端** `custom.promotion_tag` / `offer_start` / `offer_end` / `product_activity_event`,metaobject 的 Product 列表从未被读。

---

## ✅ 已定的决策(2026-09-29 与用户确认)

| 问题 | 决定 |
|---|---|
| 活动里的产品怎么圈定 | **以合集为主,可额外加单品** |
| 价格要不要也由系统切换 | **只管展示**。实际打折仍用 Shopify 折扣(自带起止时间)或手改 compare-at。自动改价延后单独评估 |
| 不同市场(B2B/法国)是否区分内容 | **全部市场一样**。以后需要再加市场维度 |
| 第一期改造哪些模块 | **首页 Banner、顶栏公告、产品页徽章/倒计时** |
| 主题上线方式 | 做在**复制出的未发布主题**上,用户预览后自己发布(维持现有人工上线) |

---

## 💡 核心设计

### ① 活动(Campaign)是一等公民
一个活动(如 Summer Sale)带着起止时间、关联合集、各位置的文案。顶栏、Banner、产品页/卡片都从它取。
独立内容(如 8 号上线的新品 Banner)可以不挂活动,自己带时间。

**时间继承**:内容自己设了时间就用自己的;没设且挂了活动,就继承活动的时间;都没设 = 长期显示(如「满 £100 包邮」)。

### ② 到期靠「切状态」,不靠「算时间」
所有可排期的 metaobject 开启 **publishable(上线/草稿)** 能力。Shopify 官方行为:Liquid 遍历
`shop.metaobjects.<type>.values` **只返回 ACTIVE 条目,DRAFT 自动跳过**;按 handle 取单条时草稿返回 nil。

所以:
- **定时器**到点把状态在 DRAFT ↔ ACTIVE 之间切换 —— 这是唯一的「开关」
- 主题里**不写日期判断**来决定显示与否,只管渲染 ACTIVE 的
- 数据变更会触发 Shopify 刷新页面缓存,不会出现「时间到了旧 Banner 还挂着」
- 倒计时照样在浏览器里按秒走;归零时前端立即隐藏,不等定时器(双保险)

> Shopify 没有原生的 metaobject 定时发布,所以定时器由本 app 自建。

### ③ 活动产品 = 合集 + 额外单品,**app 不写产品数据**
产品是否属于某活动,由主题判断:产品在活动的合集里,或在活动的「额外单品」列表里。
额外单品存在**活动 metaobject 自己身上**(`list.product_reference`),所以 app 全程**不需要写产品**,
不需要 `write_products` —— 风险最高的写权限直接省掉。

---

## 🗃 数据模型(metaobject 定义由 app 创建)

全部:`access.storefront = PUBLIC_READ`,`capabilities.publishable = enabled`。
内部备注不放 metaobject(storefront 可读),放 app 自己的存储。

### `cgp_campaign` 活动
| 字段 | 类型 | 说明 |
|---|---|---|
| name | single_line_text | 活动名 |
| starts_at | date_time | 开始 |
| ends_at | date_time | 结束(空 = 长期) |
| collection | collection_reference | 主合集:在这个合集里的产品属于本活动 |
| extra_products | list.product_reference | 额外单品 |
| badge_text | single_line_text | 产品页/卡片徽章文字,如 `Summer Sale -20%` |
| show_countdown | boolean | 是否显示倒计时 |
| priority | number_integer | 一个产品同时在多个活动时谁优先 |

### `cgp_topbar_message` 顶栏公告
| 字段 | 类型 |
|---|---|
| emoji | single_line_text |
| text | single_line_text |
| link | url |
| campaign | metaobject_reference → cgp_campaign(可选) |
| starts_at / ends_at | date_time(可选,优先于活动) |
| priority | number_integer |

### `cgp_banner_slide` Banner
字段对齐现有 slide,方便迁移:
| 字段 | 类型 |
|---|---|
| image | file_reference(图片) |
| mobile_image | file_reference(可选,待确认是否需要) |
| title / subtitle / description | text |
| button1_text / button1_url / button2_text / button2_url | text / url |
| tag | single_line_text(现有 slide 的 `sale` 等标签) |
| campaign | metaobject_reference → cgp_campaign(可选) |
| starts_at / ends_at | date_time(可选) |
| priority | number_integer |

---

## ⏱ 定时器

- Railway 上每分钟跑一次,**幂等**,可随时重跑
- 对每条可排期内容算「有效时间窗」(自己的 → 活动的 → 长期)
- 应处状态 = 在窗口内 ? ACTIVE : DRAFT;另有 app 侧「暂停」开关强制 DRAFT
- 与当前状态不同才调 `metaobjectUpdate(capabilities.publishable.status)`
- 每次切换写**操作日志**(何时、哪条、上线/下线),后台可查
- Railway 宕机错过整点 → 下次运行自动补齐;前端倒计时本身按秒精确
- 时间统一存 UTC,后台按英国时间(Europe/London,含夏令时)显示和输入

⚠️ 上线/下线由系统管理。**不要在 Shopify 后台手动切这些条目的状态**,会被定时器改回去 —— 要临时下线用 app 里的「暂停」。

---

## 🎨 主题改造(第一期)

原则:**外观不变,只换数据源;没有活动数据时回退到原编辑器设置**(迁移期不开天窗)。

| 模块 | 文件 | 改法 |
|---|---|---|
| 顶栏 | `blocks/ai_gen_block_a08faac.liquid` | 有 `cgp_topbar_message` 条目 → 按 priority 渲染;否则用原 5 个公告位。样式仍读 block 设置 |
| Banner | `sections/gpt-slider-banner-3.liquid` | 有 `cgp_banner_slide` 条目 → 渲染它们;否则用原 slide blocks。布局仍读 section 设置 |
| 活动判定 | 新 `snippets/cgp-campaign-for-product.liquid` | 遍历 ACTIVE 活动,匹配合集或额外单品,取 priority 最高者 |
| 徽章 | 新 `snippets/cgp-campaign-badge.liquid` | 产品页 + 卡片共用 |
| 倒计时 | 新 `snippets/cgp-countdown.liquid` | **唯一实现**,替换 6 份拷贝。先用活动的 ends_at,没有活动再回退旧的 `offer_end`(兼容) |
| 产品页 | `templates/product.json` 的「Limited Time Offer」custom_liquid 块 | 抽成正式文件,改用上面的 snippet |
| 卡片 | `GPT-Custom-Product-List` / `gpt-555` / `gpt-collection-product-v5` / `gpt-multi-products` / `ai_gen_block_90eb43e(_V2)` | 各自的倒计时换成 `render 'cgp-countdown'` |

「Promotion Info」块(读 `promotion_tag`)第一期**保持不动**,继续工作;第三期再并入活动。

性能:集合页每张卡都要判断活动。活动数量少(预计 <10),可在页面开头先把 ACTIVE 活动的合集 id 算好一次,卡片里只做查表。第一期实测。

---

## 🖥 后台(app)

- **排期总览**:时间轴(甘特图)展示活动 / Banner / 顶栏在前后 30 天的排布;分「上线中 / 即将开始 / 已结束」
- **活动编辑**:名称、起止时间、选合集、加额外单品、徽章文字、倒计时开关;在活动里直接挂顶栏公告和 Banner
- **Banner 管理**:缩略图列表、拖拽排序(priority)、起止时间、上传图片(Shopify Files)
- **顶栏管理**:公告列表、起止时间、拖拽排序
- **操作日志**:定时器的每次上线/下线
- 现有「元数据总账」「促销盘点」保留在「工具」下

技术栈沿用:Express + 原生 JS + App Bridge,Railway 托管。

### 需要新增的权限
| 权限 | 用途 |
|---|---|
| `write_metaobject_definitions` | 创建上面三个定义 |
| `write_metaobjects` | 建/改条目、切上线状态 |
| `read_files` / `write_files` | 上传 Banner 图片 |

**不需要** `write_products`(见设计 ③)、**不需要** `write_themes`(主题只改一次,人工上传)。

---

## 🗺 分期

### 阶段 0 · 整理(主题仓库)
- 在**独立 worktree / 新分支**拉取线上最新主题(本地副本停在 2026-06-12)。
  ⚠️ 不要在主工作区拉:FAQ 项目有未提交改动(含 `main-product.liquid`),会被覆盖。
- 把产品页 11 个 custom_liquid 块抽成正式文件,外观零变化,在复制主题上对比确认。

### 阶段 1a · 数据层 + 定时器(app)
- 加权限 → 创建三个 metaobject 定义 → 定时器 + 操作日志
- 可以直接在正式店做:新类型的数据在主题改造上线前**不会被任何页面读取**,零影响

### 阶段 1b · 后台界面
- 排期总览、活动 / Banner / 顶栏编辑器、图片上传

### 阶段 1c · 主题改造(第一期三个模块)
- 在复制主题上完成 → 用户预览 → 用户发布
- 实测:到点上线/下线、页面缓存刷新、倒计时归零隐藏、集合页性能

### 阶段 2 · 其余模块
- Sale / Feature 的 tab、Top Categories 加上下线时间

### 阶段 3 · 迁移与收尾
- 35 张 slide、顶栏公告导入成条目
- 26 个 `promotion_info`(返现等)与 73 个产品的 `offer_*` 并入活动
- 清理停用的旧 slide / 顶栏 / 重复 section

### 以后再说
- 促销价格自动切换(compare-at / 折扣)
- 按市场区分内容
- 「预览某个时间点全站会显示什么」

---

## ⚠️ 风险

1. **共享主题仓库**:同一仓库还有搜索引擎 / Setup Kit / FAQ 等功能,且 FAQ 有未提交改动 → 独立 worktree 开发,合并时协调。
2. **本地主题过期 3.5 个月** → 阶段 0 必须先同步线上。
3. **产品页 30K+ 字符的粘贴代码** → 抽取必须像素级一致,在复制主题上逐项对比。
4. **改造后 Banner / 顶栏不再在主题编辑器里改**,改到 app 里 → 团队需要知道(回退逻辑保证没数据时不空白)。
5. **有人在 Shopify 后台手动切条目状态** → 会被定时器覆盖,文档写明。
6. **缓存刷新时机**依赖 Shopify 行为 → 阶段 1c 实测;前端倒计时是兜底。

## ❓ 待确认(不阻塞开工)
- Banner 是否需要单独的手机版图片(现有 slide 只有一张图)
- 倒计时的文案和样式是否统一成一种
- 店铺是否为 Shopify Plus(主题仓库说明写 Plus,其他项目按非 Plus 做过;影响日后「自动改价」的实现方式)
- 团队里还有谁会改这些内容(是否需要审核流程;默认不需要)
