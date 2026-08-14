# Telemetry main → SDAR Evidence v1 contract gap matrix

`CURRENT` 是 Telemetry baseline `e149888…` 首次审计状态，`EXPECTED` 来自 Runtime execution `710cb25…`。`RESOLUTION` 只把有代码与执行证据的项目标为 closed。

| Area | Baseline gap | Expected | Resolution / evidence | Status |
| --- | --- | --- | --- | --- |
| Producer lock | v1.3 assumptions，无法证明当前 producer contract | Runtime main `34ce7a7…` + execution `710cb25…` | 锁定 121 files、100/95/5、canonical/registry/per-file hashes | **CLOSED** |
| Wire protocol | legacy body/ACK，无 compatible probe/auth | Exact HEAD/POST、contract header、Bearer、strict batch、one-field ACK | receiver tests、fixture、真实 Runtime-compatible HEAD 204 与 2,517-record delivery | **CLOSED** |
| Hash/identity/sequence | 无 producer-equivalent canonical hash 与 decimal/gap semantics | payloadHash、recordId、batchHash 精确复刻；batch-relative numeric gaps 合法 | contract/full-registry tests；PG/CH tuple hash exact match | **CLOSED for current Node producer** |
| Durable ACK/dedup | process-local duplicate state，ACK/WAL durability不足 | ACK only after committed checksummed WAL；restart reconstructs identity | file + parent-directory fsync、atomic rename、restart duplicate/conflict tests | **CLOSED** |
| Projection | family fallback、错误表名、fabricated non-null specialized rows | 100/100 lossless canonical；仅完整 payload 才 specialized | canonical 58-column table；100/95/5 coverage，zero silent drop | **CLOSED** |
| External ClickHouse | 无 v1 canonical landing 与安全部署证据 | read-only diff → additive migration → real write/read | 372/13,515 → 373/13,573；+1 table/+58 cols；2,517 real Runtime rows | **CLOSED** |
| Query | v1.3 mart/coverage，无法追溯 canonical source | canonical `FINAL` trace/timeline/capability routes，readonly=2 | Query 200；2,517 unique record/row IDs；contract coverage exact | **CLOSED** |
| Retry/recovery | 无真实 backlog/DLQ/outage/process-death closure | no loss、stable identity、checkpoint only after all writes | 57 DLQ requeued；frontier 2,517；external outage recovery；actual Worker `SIGKILL` recovery | **CLOSED except partial ACK** |
| Runtime terminal phase | terminal projection 依赖 outcome，failed/canceled task 可缺失 | terminal agent-task phase itself must produce evidence | failed/canceled task evidence 出现；7 failed + 5 canceled tasks traced | **CLOSED** |
| Runtime experience polling | time precision/cursor omissions 导致 change-free repeat projection | change-driven pending sources and stable checkpoints | millisecond normalization + process-mining cursor；read-only pending reached zero | **CLOSED for observed sources** |
| Sparse DLQ ACK | partition sequences 在 global BIGSERIAL 中稀疏，`first_unacked - 1` 可能生成不存在 frontier | ACK frontier 必须取该 partition 实际已 sent/ACKed predecessor | focused repository test + live recovery operation delivered 451，pending/DLQ 0 | **CLOSED** |
| Safe recovery runner | full Runtime process可能触发非联调副作用 | evidence-only official service/repository/transport boundary | one-shot runner fail-fast config/lease/lock/probe；不加载 task/workflow/MCP/model/A2A | **CLOSED for this run** |
| Credential reference | schema accepts `secret:`，HTTP resolver only supports `env:` | schema/resolver consistent | integration safely used `env:`；product mismatch remains | **OPEN P1** |
| Canonical Unicode | JavaScript `localeCompare` locale not contract-versioned | cross-language deterministic golden vectors | Node sender/receiver aligned；Unicode golden vector absent | **OPEN P2** |
| Skill input merge | enum/const supplementary scalar/object case fixed | general non-enum multi-field merge | exact enum/const cases pass；general merge remains | **OPEN P1** |
| Future source mutation | some sources lack a reliable late-mutation cursor | every mutation must become pending exactly once | orphan correction/interaction, replay dataset membership without timestamp, generalized/fused late writes remain | **OPEN P1** |
| Completed-task acceptance | failed/canceled tasks observed, completed count is zero | at least one real completed task across the chain | E2E-03 has no supporting run | **PENDING acceptance** |
| Partial ACK acceptance | full durable ACK and non-2xx retry observed | actual producer handling a partial cursor | no real partial ACK exchange captured | **PENDING acceptance** |

## Remaining blockers to `INTEGRATION_PASS`

1. Capture one real completed Runtime task end to end without broadening authority to unsafe physical/tool actions.
2. Capture a genuine partial-ACK exchange; do not substitute full ACK, retry or DLQ recovery for this scenario.
3. Resolve the product follow-ups listed above and add the compact 1,000-record acceptance case where required.

Gate H is **PASS** for real failed/canceled Runtime task evidence and Gate I is **PASS** for the authorized outage/process-crash scope. The remaining acceptance gaps keep the overall decision **CONDITIONAL_PASS**.
