# 00. 冻结声明

## 1. 冻结对象

本次冻结以下内容：

- 产品职责和非目标；
- 与 SDAR Runtime、Node Control Plane、SMPP、Provider Platform 的接口边界；
- 来源、路由、身份和 ACK 语义；
- Canonical Envelope、Schema Registry、Evidence Policy 和 Projection Contract；
- 六库数仓分层；
- SMPP ProviderOps 外部事实模型；
- v1.4 Task—Capability—Skill—Provider 事实关系；
- 数据质量、DLQ、重放、保留和安全策略；
- Query/Admin/Ingestion API；
- 部署、故障隔离、实施批次和发布门禁。

## 2. 设计冻结与实现冻结的区别

本包是完整设计冻结，不声明以下事项已经实现：

- Migration 11～13 已在 ClickHouse 24.8/25.3 实编；
- Ingestion Gateway、WAL、Projection Worker 和 Query API 已编码；
- 生产容量、HA 和真实 SMPP/SDAR 联调已经通过。

这些属于实施与发布门禁，不能反向修改已冻结的权威边界和事实语义。

## 3. 禁止重新引入

- Runtime 直接写 ClickHouse；
- SMPP 遥测直接决定 Provider 注册或 Resource Availability；
- ProviderOps 事实覆盖 `remote_task_*`；
- OTel span 冒充正式证据；
- 跨层复制分数、Gate 或 Fatal；
- ClickHouse Checkpoint 反向控制源端 WAL；
- Telemetry Query 结果被解释为当前在线运行权威；
- 每个 SDAR/SMPP 各自维护一套不同的 SDAR Projection 代码。
