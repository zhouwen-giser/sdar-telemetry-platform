# SDAR v1.3 Skill-aware Evidence 冻结包

本目录是 SDAR v1.3 统一语义采集与评价证据基础的冻结交付包。

## 文件

- `SDAR_v1.3_Evidence_Foundation_Upgrade_Plan_FROZEN_CN.md`  
  v1.3 升级方案、关键决策、实施阶段和验收门禁。

- `SDAR_v1.3_Skill_Aware_Evidence_Schema_V1.2_FROZEN_CN.md`  
  Skill-aware 证据模型、字段语义、事件目录、质量规则和 ClickHouse 映射。

- `schema/`  
  Draft 2020-12 JSON Schema、Envelope、Record Catalog。

- `clickhouse/SDAR_v1.3_Skill_Aware_ClickHouse_DDL_FROZEN.sql`  
  Skill-aware 新表和既有核心表关联字段的冻结 DDL。

- `examples/`  
  机器可读示例。

- `SHA256SUMS.txt`  
  冻结文件校验值。

## 冻结原则

1. PostgreSQL 是运行权威；
2. ClickHouse 是正式分析权威；
3. MCP Provider 是外部执行权威；
4. Domain/Application 不直接调用 Telemetry API；
5. 基础设施在权威事务边界生成 Canonical Evidence；
6. OTel 仅用于 Context 与传输；
7. Skill Usage、Composition、Compliance、Execution 是一级证据域；
8. ToolCall 与 Remote Task 生命周期分离；
9. Observation 与 Control Event 分离；
10. required Evidence 不允许采样。

## 实现建议

代码生成顺序：

```text
JSON Schema
  → TypeScript/Zod 类型
  → Canonical Evidence Mapper
  → PostgreSQL Outbox Payload
  → ClickHouse Row Mapper
  → Contract Tests
```

SQL 文件是冻结逻辑模型和 Migration 模板。实际 Migration 编号必须在 v1.2 最终进入 `main` 后，根据仓库 PostgreSQL/ClickHouse high-water mark 分配。
