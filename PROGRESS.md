# 进度 · Promo Dashboard(元数据管理)

- **状态**: 开发中 / 已部署可用(只读)
- **进度**: 45%
- **一句话**: 已从「只管促销」扩成「全店元数据总账」——新增 metafield/metaobject 定义总账 + 主题引用扫描 + 人工用途标注,全部只读零 mutation;促销盘点降级为其中一个专题模块。
- **分类**: Shopify App

## 🔨 进行中
- 元数据总账第一期已写完待联调:需要在 Partner 后台加 `read_themes` 权限并 Release + 重装,主题引用那列才有数据。
- 覆盖范围第一期定为 PRODUCT / PRODUCTVARIANT / COLLECTION(见 `src/registry.js` 的 `OWNER_TYPES`)。

## ⏭ 下一步
- 加 `read_themes` 权限后验证主题扫描:确认能搜到 `metafields.custom.xxx` 命中的文件与行号。
- 用主题扫描结果一次性回答悬了很久的问题:**主题到底读产品端 metafield 还是遍历 metaobject** —— 这决定促销同步引擎的方向。
- 按 definition 钻取「具体哪些产品有值」(量大时走 Bulk Operation,别逐页扫)。
- 促销侧仍缺:写权限 + 同步引擎 + 给 `product_activity_event` 补 `Product(list)` 字段(现无此字段导致活动内容全成孤儿)。

## 🏁 最近完成
- **元数据总账**(2026-09):`src/registry.js` 列出三类 owner 的全部 metafield 定义 + 全部 metaobject 定义,带数据量计数、命名空间来源推断、`createdByApp` 创建者、疑似废弃标记。
- **主题扫描** `src/theme-scan.js`:用 GraphQL `theme.files`(通配符批量,一次最多 2500 个)抓 liquid/json/js,逐行索引 `metafields.<ns>.<key>` 与 `metaobjects.<type>`,给出文件+行号+代码片段。缺 `read_themes` 时优雅降级不报错。
- **人工标注层** `src/annotations.js`:给每个定义写用途/归属项目/状态,存 DATA_DIR。修掉一个 bug:空字符串状态之前会被回退成旧值,导致标注删不掉。
- 前端拆成两个顶层板块(总账 / 促销盘点),促销扫描改为切标签才懒加载,打开 app 不再卡全站扫描。
- 缓存模块泛化成按 name 区分数据集(inventory / registry)。
- 阶段0 促销盘点(2026-07):只读引擎 + 3 标签页 + CLI + 双层缓存;5 类一致性检查;实测 3938 产品 / 79 带促销 metafield / 0 用 activity_event / 73 有 offer_end。
