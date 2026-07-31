# 16. 版本与兼容

## 版本轴

```text
Telemetry Platform Version
Ingestion API Version
Canonical Evidence Family
ProviderOps Envelope Version
Schema Version
Projection Version
Mapping Hash
ClickHouse Schema Version
Evaluation Framework/Profile/Rule Set/Evaluator Version
Query API Version
```

## 冻结版本

| 对象 | 版本 |
|---|---|
| Telemetry Platform | 1.0.0 |
| Ingestion/Admin/Query API | v1 |
| SDAR Evidence Family | sdar.evidence/v1 |
| SMPP ProviderOpsEnvelope | 1.1.0 |
| Embodied Schema | 1.0.0 |
| ClickHouse target | 1.3.0 |

## 兼容策略

- Schema 向前兼容需显式 `compatibility`；
- 不认识的 required record type 进入 DLQ；
- 不认识的 supporting/diagnostic 类型可按策略只保留 raw envelope；
- Projection Run 固定版本；
- 历史结果不原地重写，Replay 产生新 Projection Version。
