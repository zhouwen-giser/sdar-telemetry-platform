# NPC 最小评价案例 Schema 1.1

`npc_minimal_case.schema.json` 定义测试案例的输入、预期行为、断言和离线评价选择。它不是运行埋点，不保存实际状态、行动、回执、Verification 或评价结果。

## 定位与关系

```text
NpcMinimalEvaluationCase
  caseId / input / expectations / evaluation
                     │ 执行测试
                     ▼
NpcMinimalRuntimeRecord 或完整 EpisodeEvidenceBundle
                     │ caseId 关联
                     ▼
断言判定 / application scope 离线试算
```

| 对象 | 内容 | ClickHouse 边界 |
|---|---|---|
| 最小案例 | 测试输入与预期 | 不直接写入遥测事实表；需要留档时作为 artifact 引用 |
| 最小运行记录 | 一次关键决策—动作—结果摘要 | 写入 `sdar_npc.raw_record` 和 `sdar_npc.minimal_runtime_record` |
| 完整 Episode | State、Event、Decision、Action、Receipt、Verification、Trajectory | 写入完整 `sdar_npc` 事实并经 P1/P2 投影 |

`fixtureRef` 只引用外部仿真或回放夹具；案例中的 assertion 是测试预期，不是运行证据。实际结果必须由运行记录产生，不能把 expected 值回填成事实。

## 文件

- [`npc_minimal_case.schema.json`](npc_minimal_case.schema.json)：JSON Schema Draft 2020-12，版本 `1.1.0`。
- [`npc_minimal_case.example.json`](npc_minimal_case.example.json)：路障抢占案例示例。
- [NPC 最小运行 Schema](../npc_minimal_runtime_schema_v1/NPC_最小运行采集数据_Schema_说明文档_V1.0.md)：与案例通过 `caseId` 关联。

## 评价选择合同

最小案例 1.1 的 `evaluation` 固定为 NPC 应用层草案 Profile：

```text
framework          = SDAR
frameworkVersion   = 2.0
evaluationScope    = application
profile            = npc-application
profileVersion     = 1.0
adapter            = npc
collectionProfile  = minimal

metricSetId        = application.npc-application.metrics
metricSetVersion   = application-v1-draft
gateSetId          = application.npc-application.gates
gateSetVersion     = application-v1-draft
fatalSetId         = application.npc-application.fatals
fatalSetVersion    = application-v1-draft
ruleSetStatus      = draft
```

这些规则当前在 `sdar_meta` 中是 `draft`，只允许离线试算，不能进入正式发布 cohort。规则激活后应发布新的规则集版本并升级案例 Schema，不得只修改评价器代码。

minimal 采集的限制：

- 可以进行断言判定和受限 application scope 统计；
- domain/general scope 必须为 `insufficient_evidence / NE / passed=0`；
- M3、M13、M14 不得从 minimal 证据得到正分；
- minimal 记录不能产生 E2，因此不能声明任何 Hard Gate pass；
- Fatal 正式检出必须带结构化 EvidenceRef；本 minimal 合同将 `requiredHardGates` 和 `fatalErrorChecks` 都限制为空数组。

关键安全行为由 critical assertions 判定。若要执行完整 Gate/Fatal 评价，应采集完整 `EpisodeEvidenceBundle`，并使用与目标 scope 对应的独立 Profile 和规则集。

## 最小结构

```json
{
  "schemaVersion": "1.1.0",
  "caseId": "npc-case-001",
  "agentType": "npc",
  "title": "案例标题",
  "scenarioType": "safety_preemption",
  "input": {
    "triggerType": "safety_event",
    "source": "test_harness",
    "fixtureRef": "fixtures/example.json"
  },
  "expectations": {
    "expectedOutcome": "safe_hold",
    "assertions": [
      {
        "assertionId": "a-1",
        "subject": "action",
        "operator": "contains",
        "expected": "stop",
        "critical": true
      }
    ]
  },
  "evaluation": {
    "framework": "SDAR",
    "frameworkVersion": "2.0",
    "evaluationScope": "application",
    "profile": "npc-application",
    "profileVersion": "1.0",
    "adapter": "npc",
    "collectionProfile": "minimal",
    "metricSetId": "application.npc-application.metrics",
    "metricSetVersion": "application-v1-draft",
    "gateSetId": "application.npc-application.gates",
    "gateSetVersion": "application-v1-draft",
    "fatalSetId": "application.npc-application.fatals",
    "fatalSetVersion": "application-v1-draft",
    "ruleSetStatus": "draft"
  }
}
```

## 版本升级与校验

从 `1.0.0` 到 `1.1.0` 的变化：

- 把含混的领域 Profile `embodied-control` 修正为应用层 `npc-application`；
- 显式增加 `evaluationScope`、`collectionProfile`；
- 固定 Metric/Gate/Fatal 三套规则集的 ID、版本和草案状态；
- 修复 `AssertionValue`/`JsonValue` 中 integer 同时匹配 number 导致 `oneOf` 失败的问题。

在仓库根目录运行：

```bash
python3 validate_examples.py
```

ClickHouse 评价合同见[三层独立评价合同](../sdar_clickhouse_schema_v1_0/docs/evaluation_contract.md)，字段和版本映射见[映射说明](../sdar_clickhouse_schema_v1_0/docs/schema_mapping.md)。
