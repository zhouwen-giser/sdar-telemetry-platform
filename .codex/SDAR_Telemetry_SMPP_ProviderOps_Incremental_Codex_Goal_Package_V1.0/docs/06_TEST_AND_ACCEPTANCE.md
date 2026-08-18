# 测试与验收

## Contract

- ProviderOpsEnvelope 16 record types；
- Payload Catalog valid/invalid fixtures；
- Source Mapping v4；
- exact SDAR target row schemas；
- URN parser；
- relation cardinality and provenance。

## E2E

```text
Provider sample
→ OTLP Collector
→ SMPP WAL fsync ACK
→ standalone ClickHouse
→ SDAR shadow target
→ external facts/relations
→ SDAR Telemetry API
→ Benchmark handoff verifier
```

## 必测场景

1. 16 record types 至少各一个合法样本；
2. same record ID/same hash duplicate；
3. same identity/different hash conflict；
4. N:N relation；
5. out-of-order provider sequence；
6. SDAR target offline, standalone remains healthy；
7. target recovery and checkpoint replay；
8. count/fact_hash/watermark parity；
9. terminal mismatch；
10. missing relation -> not_ready；
11. provider terminal does not create physical verification；
12. Benchmark consumer verifier uses actual SDAR target rows。
