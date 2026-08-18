# Fail-closed 与外部阻塞

立即阻塞以下情况：

- ClickHouse 不是锁定的 1.5.1-rc.2；
- external target 缺列或列类型漂移；
- SMPP Source Mapping 没有显式 smppSourceId；
- Payload Catalog 未冻结却尝试提取 lifecycle/terminal 字段；
- relation URN 无法严格解析；
- 同 identity 出现不同 Hash；
- SDAR target 写成功但 checkpoint/lineage 无法确认；
- reconciliation 出现同 revision 终态冲突；
- companion SMPP PR 未部署却宣称 live E2E；
- 使用 Query API polling 冒充 durable projection。

外部系统不可用时，提交 blocker report，保留准确 resume point；不得用 fixture 冒充完成。
