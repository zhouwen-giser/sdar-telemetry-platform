# 18. 验收与发布门禁

## 源码/合同

- JSON Schema Draft 2020-12 通过；
- OpenAPI 解析；
- Projection Mapping Hash 可重算；
- 来源示例 8 正向 + 2 隔离继续通过；
- 来源 Build Package `--check` 继续通过。

## ClickHouse

- 24.8 与 25.3 fresh install 编译；
- 目标 6 DB / 200 tables / 76 views / 14 migrations；
- Manifest 无 stale；
- ID/Hash/Partition/TTL 静态检查；
- Migration 13 的 7 表、6 视图存在。

## 采集

- WAL fsync 后 ACK；
- 崩溃恢复无已 ACK 记录丢失；
- 重投不产生逻辑重复；
- 相同 ID 不同 Hash 阻断；
- required Evidence 不采样。

## 隔离

- ClickHouse/Query/Console 停机不影响 Runtime/SMPP；
- Telemetry 可用但 Registry 不可用时不能注册 Provider；
- Registry 可用但 Telemetry 不可用时 Provider 可继续调用；
- Telemetry 不可写 Runtime PostgreSQL。

## 关系与对账

- Task→Capability→Skill→Provider→Resource 可追溯；
- Provider/SDAR Terminal 不一致被发现但不自动修复；
- 两个 SMPP 使用相同 Provider/Resource ID 不错误合并；
- Agent Card/Exposure Revision 可追踪。

## 安全

- Secret 扫描；
- Route Scope；
- 跨租户拒绝；
- Replay/Waive 审计；
- Source Credential 最小权限。
