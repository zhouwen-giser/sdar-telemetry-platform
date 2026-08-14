# SDAR Evidence v1 compatibility assessment

## Verdict

**CONDITIONAL_PASS — contract、Telemetry implementation、真实 failed/canceled Runtime producer path、指定外部 ClickHouse 与授权故障恢复均已验证；completed-task 与 partial-ACK 场景尚未闭合。**

## Producer contract materialization

- Frozen root：`integrations/skill-driven-agent-runtime/v1.4.1`
- Contract：`sdar.evidence/v1`
- Runtime main / execution：`34ce7a7a43971de37566b24f969b4f0aeadec2b2` / `710cb25d9e365c6a1a30a532d22deac787a7c3b0`
- Canonical contract：`sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f`
- Canonical registry：`sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71`
- Imported sources：121 files
- Catalog：100 records = 95 Required + 5 Diagnostic
- Limits：1,000 records/batch；262,144 canonical bytes/object

Sync/check 比较 execution/main SHA、canonical hashes、source file byte hashes、100/95/5 与 copied assets；任一 drift 以 `SDAR_EVIDENCE_CONTRACT_DRIFT` fail-closed。

## Wire compatibility

| Concern | Runtime contract | Telemetry behavior | Evidence/status |
| --- | --- | --- | --- |
| Endpoint/probe | HEAD/POST `/v1/evidence/batches` | exact path；HEAD 204 only after auth/header validation | **PASS** receiver + real run probe |
| Contract/auth | exact header + Bearer | legacy header rejected；timing-safe auth；secret-free reports | **PASS**；integration uses `env:` |
| Request | strict 9-field batch + 1..1000 records | AJV 100 schemas + semantic validation | **PASS** |
| ACK | exact `{"lastAcknowledgedSequence":"N"}` | 202 after whole immutable WAL frame is durable | **PASS full ACK**；partial cursor scenario pending |
| Failure/retry | non-2xx retry; contiguous cursor | stable 4xx/409 and retryable 503; durable duplicate identity | **PASS** real DLQ/retry/restart |

Runtime sequence 是 global BIGSERIAL，而 export partitions 可稀疏。Receiver 对 batch 只要求 canonical decimal、唯一、严格递增与首尾匹配，不错误要求 global `N+1`。Runtime sparse-DLQ recovery 也已改为从该 partition 的实际已发送 predecessor 计算 ACK frontier。

## Canonical identity and hash compatibility

Telemetry 复刻当前 Node producer 规则：plain JSON object、array order、`-0 → 0`、object key `localeCompare`、UTF-8 SHA-256；`payloadHash` 绑定 payload，`recordId` 绑定 source identity tuple，`batchHash` 绑定 unsigned request。

真实对账把 PostgreSQL 与 external ClickHouse 中按 `(record_id,payload_hash,evidence_sequence)` 排序的 2,517 条 tuple 分别哈希，结果均为：

`sha256:3d8fd06dc9f4bb09b7aa4de518800eaa63c514417ad11e2006ac07e01af537f8`

2,517 record IDs 与 2,517 row IDs 均唯一。跨语言实现仍需 producer-pinned Unicode golden vector，因为 `localeCompare` locale 未被 contract version 固定。

## ACK, retry and durability compatibility

- WAL immutable frame 经过 checksum、file fsync、atomic rename 与 parent-directory fsync 后才允许 ACK。
- Restart 从 committed frames 重建 batch/record/sequence identity；exact duplicate 不增长 WAL，conflict 返回 409。
- Worker 每个成功 projection 写 durable journal；frame 全部完成才推进 checkpoint。
- 真实 Runtime run 最终生成 2,439 WAL frames / 6,224,020 bytes / 2,517 records；Worker checkpoint 2,438，journal 2,439。
- 57 条 open DLQ 全部 requeue；修复 sparse-partition frontier 后，最终 operation delivered 451，pending 0，DLQ 0，ACK frontier `2517`。
- 实际 full ACK、retry、restart 与 DLQ recovery 已闭合；真实 partial ACK exchange 未闭合，所以 Gate E 保持 PARTIAL。

## Projection and deployed ClickHouse compatibility

所有 100 Evidence v1 types losslessly 投影到 `sdar_core.sdar_evidence_v1_record`；仅以下完整 payload 允许附加 specialized row：

- `node_control.capability_revision` → `sdar_core.node_capability_version_fact`
- `node_control.a2a_exposure` → `sdar_core.a2a_exposure_revision_fact`
- `node_control.agent_card_revision` → `sdar_core.agent_card_revision_fact`

其余 97 types canonical-only，不填造 older specialized DDL 的 non-null 字段，也不 silent drop。

外部 ClickHouse 只读快照证明 pre-014 为 372 objects / 13,515 columns，post-014 为 373 objects / 13,573 columns；唯一新增对象是 58 列 `ReplacingMergeTree(projected_at)` 表。真实 Runtime Query 返回 2,517 rows；coverage expected/observed 都是 `sdar.evidence/v1`。INSERT-only `date_time_input_format=best_effort` 解决了真机 ISO timestamp → `DateTime64(3,'UTC')` 解析问题。

## Real task coverage

| Phase | Tasks | Task-linked records | Status |
| --- | ---: | ---: | --- |
| failed | 7 | 37 | **PASS — real Runtime evidence** |
| canceled | 5 | 26 | **PASS — real Runtime evidence** |
| completed | 0 | 0 | **PENDING — E2E-03** |

已知真实 task trace 包括两个 failed task 各 3 条、一个 canceled task 14 条、另一个 failed task 3 条。报告不把 failed/canceled task 误称为 completed。

## Failure compatibility

外部 v2 evidence `codex_it_20260814T080120Z_710cb25_e149888_v2-fixture-e2e.json` 证明：

- `192.168.1.7:1` unauthenticated TCP preflight 不可达；Worker 获得 transport failure；checkpoint 保持 `-1`，WAL 保持 1 frame / 3,271 bytes；恢复原 writer 后 checkpoint 变为 0 且只写 1 次。
- 独立 child 在 A durable、B 未 commit 时收到真实 `SIGKILL`；重启跳过已完成 A，只完成 B。

这是授权的 controlled transport outage 与 Worker crash 证据，不宣称杀死真实 ClickHouse server，也不宣称在 ClickHouse commit 后杀进程。

## Verification matrix

| Layer | Evidence observed | Status |
| --- | --- | --- |
| Source lock / 100 schemas | 121 files；100/95/5；canonical hashes | PASS |
| HTTP/auth/ACK/WAL/Worker/Query | focused + unified Telemetry suite | PASS |
| Telemetry unified gate | typecheck/build + 70/70 tests + static | PASS |
| External schema/write/read | reader snapshots + 2,517-row real run | PASS |
| PG/CH exact reconciliation | same tuple hash, count 2,517 | PASS |
| Real failed/canceled task path | 12 tasks / 63 task-linked records | PASS |
| Real completed task | zero observed | **PENDING** |
| Real partial ACK | no partial cursor exchanged | **PENDING** |

## Conditions before `INTEGRATION_PASS`

1. Capture E2E-03 with at least one genuine completed task.
2. Capture a genuine partial ACK response and producer resume semantics.
3. Close the documented input/source-mutation/credential/Unicode follow-ups and compact 1,000-record acceptance as required.

Until those conditions are met, the compatibility decision remains **CONDITIONAL_PASS**.
