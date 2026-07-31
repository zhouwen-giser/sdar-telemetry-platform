# NPC 智能体最小运行采集数据 Schema

**Schema 版本：** `1.1.0`  
**Schema 名称：** `NpcMinimalRuntimeRecord`  
**JSON Schema：** Draft 2020-12  
**适用对象：** NPC 智能体轻量采集、快速回归和应用层行为统计  
**存储合同：** SDAR ClickHouse Schema `1.2.0`（表合同沿用 1.1；Runtime v1.3 不改变本子包 Schema）
**更新日期：** 2026-07-16

文件名保留 `V1.0` 仅用于兼容已有工程引用，实际 Schema 版本以 JSON 中的 `schemaVersion=1.1.0` 为准。

## 1. 定位

本 Schema 记录 NPC 智能体一次“关键触发—决策—动作—结果”片段。它是 `collectionProfile=minimal` 的应用层采集格式，不是测试案例，也不是完整的 SDAR `Episode Evidence Bundle`。

它刻意不采集 Blackboard/StateSnapshot、StateDelta、完整 Event、EvidenceRef、原始 MCP 请求响应、VerificationRecord 和 StateTrajectory。因此它可以支撑快速行为回归，但不能证明车辆已经到达、停止、扫描完成或打击成功。

三个相关对象的边界如下：

| 对象 | 用途 | 是否是运行事实 | ClickHouse 去向 |
|---|---|---:|---|
| `NpcMinimalEvaluationCase` | 定义输入、预期和断言 | 否 | 测试案例目录；需要时作为 artifact 引用 |
| `NpcMinimalRuntimeRecord` | 记录一次轻量运行片段 | 是 | `sdar_npc.raw_record` + `sdar_npc.minimal_runtime_record` |
| `EpisodeEvidenceBundle` | 完整证据链和正式评价输入 | 是 | `sdar_npc` 完整事实表，并经 P1/P2 投影 |

## 2. 数据流和评价边界

```text
NpcMinimalEvaluationCase.caseId
                │
                ▼
NpcMinimalRuntimeRecord.caseId
                │ Collector：raw + typed 同 ID/Hash
                ▼
sdar_npc.minimal_runtime_record ──→ NPC 应用层受限评价
                │ P1 只能投影可证明的摘要事实
                ▼
sdar_embodied / sdar_core ────────→ insufficient_evidence / NE
```

`minimal` 记录只允许生成受限的 NPC 应用层离线评价：

- application scope 可对分支选择、抢占、动作触发、审批和时延进行有限判断；
- domain/general scope 必须为 `evaluation_status=insufficient_evidence`、`level=NE`、`passed=0`；
- 不得从 minimal 记录生成物理 Verification pass、状态新鲜度 pass 或完整轨迹；
- 不得为 M3、M13、M14 生成正分；
- HG2、HG5、HG6 不得判定为 pass；任何 Gate pass 都必须有 E2 结构化证据；
- `sdar_embodied.v_minimal_evidence_overclaim` 必须保持空结果。

完整规则见 [评价存储与版本合同](../sdar_clickhouse_schema_v1_0/docs/evaluation_contract.md)和[验证与上线门槛](../sdar_clickhouse_schema_v1_0/docs/validation.md)。

## 3. 记录粒度与不变性

- 一条记录对应一次关键决策片段，不对应每一个 Tick。
- 同一 Episode 的多条记录复用 `episodeId`，并按严格递增的 `sequence` 排序。
- 只在分支、意图、控制权、审批、动作或结果发生实质变化时追加记录。
- 记录写出后不可修改；修正时使用新的 `recordId` 和新的 Episode 末尾 sequence。
- `executionStatus=succeeded` 只说明工具调用或执行适配成功，不表示物理结果成功。
- 不采集完整 MCP 参数、图像、原始敏感载荷或模型思维过程；这类内容只允许以受控 artifact 引用保存。

## 4. JSON 顶层结构

```text
NpcMinimalRuntimeRecord
├─ 合同：schemaVersion / recordType / collectionProfile
├─ 标识：recordId / episodeId / sequence / caseId / correlationId
├─ 上下文：missionId / tickId / agentId / scenarioType / environment
├─ 时间：startedAt / endedAt
├─ trigger：触发来源、名称、优先级和摘要
├─ decision：决策类型、控制优先级、依据、分支和意图
├─ action：动作类型、工具、目标和执行状态
├─ control：控制权、抢占和人工审批摘要
├─ outcome：片段终止语义；不是物理 Verification
├─ error：失败摘要
└─ operational：决策、下发和总耗时
```

`schemaVersion` 固定为 `1.1.0`，`recordType` 固定为 `npc_minimal_runtime_record`，`collectionProfile` 固定为 `minimal`。

## 5. ClickHouse Collector 信封

JSON 是业务载荷；以下 ClickHouse 公共列由 Collector 根据部署配置和载荷确定，不要求生产者重复写入 JSON：

| ClickHouse 列 | 来源/规则 |
|---|---|
| `tenant_id`、`project_id` | Collector 部署配置，禁止从 payload 猜测 |
| `environment` | 部署环境，只允许 `dev/test/staging/prod` |
| `record_id`、`episode_id`、`correlation_id`、`sequence` | 对应 JSON camelCase 字段 |
| `agent_id`、`agent_version` | `agentId` 及 `metadata.agentVersion` |
| `schema_name` | 固定 `npc_minimal_runtime_record` |
| `schema_version`、`minimal_schema_version` | 均保存 JSON `schemaVersion`；不得把 SemVer 静默转为整数 |
| `collection_profile` | JSON `collectionProfile`，固定 `minimal` |
| `occurred_at` | 本合同取 `endedAt`，表示该决策片段结果形成时间 |
| `payload_json` | UTF-8 完整原始 JSON |
| `payload_hash` | 来源声明 Hash；来源未声明时可与 Collector SHA-256 相同 |
| `payload_sha256` | Collector 对规范化完整载荷计算的 64 位小写 SHA-256 |

JSON 的 `environment` 表示运行环境，列化到 `runtime_environment`，允许 `simulation/field_test/real_vehicle/replay/unspecified`；它不能覆盖 ClickHouse 公共列 `environment` 的部署环境。P1 投影时将 `unspecified` 显式映射为领域合同的 `unknown`，并在来源 JSON 中保留原值。

Collector 接受一条记录时必须：

1. 校验 JSON Schema；
2. 规范化载荷并计算 Hash；
3. 先写 `sdar_npc.raw_record`；
4. 再写 `sdar_npc.minimal_runtime_record`；
5. 两行复用相同 `tenant_id/project_id/record_id/payload_sha256`；
6. raw/typed 缺失或 Hash 不一致时阻断 P1 投影。

完整写入要求见 [部署说明](../sdar_clickhouse_schema_v1_0/docs/deployment.md)和[投影合同](../sdar_clickhouse_schema_v1_0/docs/projection_contract.md)。

## 6. 可支持的轻量检查

可直接检查：

- Safety/Tactical/Mission/Idle 的控制优先级是否正确；
- 是否选择预期 BehaviorTree 分支和意图；
- 是否下发应有动作、禁止动作或人工审批请求；
- 工具调用状态、错误类别、重试和时延；
- 片段级 Outcome 是否符合测试断言。

只能部分检查：

- 策略与行动一致性；
- 异常处置和恢复；
- 控制冲突和无效重试。

无法直接检查：

- Blackboard 一致性和状态新鲜度；
- 完整状态轨迹和决策证据关联；
- 实体目标有效性、实际位置、停止速度或任务物理完成；
- 完整领域评价和 SDAR 通用评价。

## 7. 版本升级

从 `1.0.0` 升级到 `1.1.0` 时：

- 新增必填 `collectionProfile`，固定为 `minimal`；
- Collector 必须将其写入公共列 `collection_profile`；
- 其余业务字段保持兼容；
- 历史 `1.0.0` 记录仍按原始 Schema 回放，不允许原地改写成 `1.1.0`。

示例见 [`npc_minimal_runtime_record.example.json`](npc_minimal_runtime_record.example.json)，Schema 见 [`npc_minimal_runtime_record.schema.json`](npc_minimal_runtime_record.schema.json)。在仓库根目录执行：

```bash
python3 validate_examples.py
```
