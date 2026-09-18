# 进度 · Promo Dashboard(元数据管理)

- **状态**: 开发中 / 已部署可用(只读)
- **进度**: 55%
- **一句话**: 已从「只管促销」扩成「全店元数据总账」——metafield/metaobject 定义总账 + 主题引用扫描 + 人工用途标注 + 钻取到具体资源并可点进后台,全部只读零 mutation;促销盘点降级为其中一个专题模块。
- **分类**: Shopify App

## 🔨 进行中
- 线上实测钻取:150 个 metafield 定义 / 126 个 metaobject 定义 / 主题已扫 690 个文件,待逐项验证明细正确性。
- 用主题扫描结果回答悬了很久的问题:**主题到底读产品端 metafield 还是遍历 metaobject** —— 这决定促销同步引擎方向。搜 `promotion_tag` / `product_activity_event` 两行的「主题引用」即可。

## ⏭ 下一步
- 开始给关键字段做人工标注(用途/归属项目/状态),把 23 个「疑似废弃」逐一定性。
- 覆盖范围可按需扩 owner type(现 PRODUCT/PRODUCTVARIANT/COLLECTION,见 `src/registry.js` 的 `OWNER_TYPES`)。
- 促销侧仍缺:写权限 + 同步引擎 + 给 `product_activity_event` 补 `Product(list)` 字段(现无此字段导致活动内容全成孤儿)。
- 清理动作(删废弃定义/批量清过期)仍需 write scope,未开。

## 🏁 最近完成
- **钻取**(2026-09):`src/drilldown.js` —— metafield 用 `products(query:"metafields.{ns}.{key}:*")` 官方筛选器只返命中的资源;metaobject 用 `Metaobject.referencedBy` 直接拿反向引用。两条都不用扫全站。明细带后台/前台深链(变体链接指向父产品)。
- **修 bug**:metaobject 行缺 `source` 字段,一选「来源」筛选就整表滤空(126 个定义显示无匹配)。
- **元数据总账**(2026-09):`src/registry.js` 列出三类 owner 的全部 metafield 定义 + 全部 metaobject 定义,带数据量计数、命名空间来源推断、`createdByApp` 创建者、疑似废弃标记。
- **主题扫描** `src/theme-scan.js`:用 GraphQL `theme.files`(通配符批量,一次最多 2500 个)抓 liquid/json/js,逐行索引 `metafields.<ns>.<key>` 与 `metaobjects.<type>`,给出文件+行号+代码片段。缺 `read_themes` 时优雅降级不报错。
- **人工标注层** `src/annotations.js`:给每个定义写用途/归属项目/状态,存 DATA_DIR。修掉一个 bug:空字符串状态之前会被回退成旧值,导致标注删不掉。
- 前端拆成两个顶层板块(总账 / 促销盘点),促销扫描改为切标签才懒加载,打开 app 不再卡全站扫描。
- 缓存模块泛化成按 name 区分数据集(inventory / registry)。
- 阶段0 促销盘点(2026-07):只读引擎 + 3 标签页 + CLI + 双层缓存;5 类一致性检查;实测 3938 产品 / 79 带促销 metafield / 0 用 activity_event / 73 有 offer_end。
