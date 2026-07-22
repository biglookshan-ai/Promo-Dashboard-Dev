# 进度 · Promo Dashboard

- **状态**: 开发中 / 未部署
- **进度**: 30%
- **一句话**: 只做完阶段0的只读数据盘点(3标签页前端+CLI+缓存,零 mutation);核心的「活动=单一数据源→同步引擎反写产品」还没建,也未稳定部署到 Railway。
- **分类**: Shopify App

## 🔨 进行中
- 根据盘点结果定迁移/清理方案(60+ DZOFILM/Blazar 共享 offer_end=2026-07-31 的裸倒计时如何归并进活动)。
- 确认是否加 write scope(`write_metaobjects` / `write_products`)。

## ⏭ 下一步
- 阶段2 同步引擎(反写产品)—— 活动 metaobject 单一数据源反向写回产品 `custom.*` metafield,当前零 mutation,是最大缺口。
- 加 write scope 并给 `product_activity_event` 定义补 `Product(list)` 字段(现无此字段导致活动内容全成孤儿)。
- 稳定部署 Railway 并重新验证线上可用性(README/memory 记录曾跑通,当前按未部署对待)。
- 阶段1 数据模型重整+迁移(废弃产品级 Offer Start/End Time metafield,并入活动 metaobject)。

## 🏁 最近完成
- 阶段0 数据盘点 app scaffold 跑通(2026-07):只读引擎 `src/inventory.js` + App Bridge 嵌入式 3 标签页前端 + CLI + 双层缓存。
- 5 类一致性检查(孤儿倒计时 / 双向漂移 / 反向漂移 / 无起止日期 / 已过期仍 active)。
- 真实盘点结果产出:扫 3938 产品、79 带促销 metafield、0 用 activity_event、13 用 promotion_tag、73 有 offer_end;发现按标题归一化的僵尸重复条目簇。
