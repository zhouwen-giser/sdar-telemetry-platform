# SDAR v1.4.1 × Telemetry Platform baseline

记录日期：2026-08-14（Asia/Shanghai）

## 结论

本次联调以 Runtime producer contract 为唯一协议权威。Telemetry 已完成 Evidence v1 contract 锁定、严格 Gateway、持久 WAL、Worker 可恢复投影、外部 ClickHouse additive migration、Query API 与安全部署布线。

真实 Runtime PostgreSQL evidence 已通过正式导出/传输边界进入 Gateway → WAL → Worker → 指定外部 ClickHouse → Query：最终对账 2,517 条，PostgreSQL 与 ClickHouse 的 `(record_id,payload_hash,evidence_sequence)` 排序集合哈希完全相同。真实 failed/canceled task evidence 已闭环，真实 completed task 尚未出现；总体结论因此仍是 **CONDITIONAL_PASS**，而不是 `INTEGRATION_PASS`。

## Git 与执行基线

| Repository | Role | SHA | Evidence |
| --- | --- | --- | --- |
| `sdar-telemetry-platform` | Review baseline / execution commit | `e149888ae0e548baf2b973e237b4c3e64849db2d` | 任务书指定 baseline；实现位于该提交之上的共享未提交工作树 |
| `skill-driven-agent-runtime` | Review/main baseline | `34ce7a7a43971de37566b24f969b4f0aeadec2b2` | `origin/main` baseline |
| `skill-driven-agent-runtime` | Local development execution | `710cb25d9e365c6a1a30a532d22deac787a7c3b0` | 本地开发分支 HEAD；包含 main baseline |

报告与 machine evidence 不记录数据库密码、Bearer token、PAT、payload 或连接串。

## Frozen source lock

权威快照目录：`integrations/skill-driven-agent-runtime/v1.4.1`

| Item | Locked value |
| --- | --- |
| Contract | `sdar.evidence/v1` |
| Canonical contract hash | `sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f` |
| Canonical registry hash | `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71` |
| Imported source files | 121；逐文件 `byteSha256` 写入 `source-lock.json` |
| Record catalog | 100 unique record types；95 Required、5 Diagnostic |
| Delivery / ACK | `at_least_once` / `contiguous_with_partial_ack` |

Canonical hash 与文件 byte hash 是不同用途的值，不得互换。

## Authority 与兼容边界

- Runtime PostgreSQL 是运行事实、export configuration、outbox、checkpoint、retry、DLQ 与 ACK ledger 的权威。
- Telemetry WAL 是 receiver durable ACK、重启去重与 Worker 重放的本地权威；ClickHouse 是派生分析存储，不反写 Runtime 控制状态。
- Runtime 使用 `HEAD`/`POST /v1/evidence/batches`、`x-sdar-evidence-contract: sdar.evidence/v1` 与 Bearer credential；内部 `sourcePartition` 不上 wire。
- `apps/sdar-outbox-relay`、`SDAR_DATABASE_URL` 与旧 contract map 仅为 **v1.3 compatibility-only**，不得读取或更新 v1.4 `evidence_outbox`。
- 真实联调使用 `env:` credential reference 规避已识别的 Runtime `secret:` schema/resolver 不一致；凭据仅存在于未跟踪、最小权限的运行时文件/环境中。

## ClickHouse 环境基线

| Stage | Evidence | Result |
| --- | --- | --- |
| Pre-014 reader snapshot | `reports/clickhouse/192.168.1.7-schema-snapshot/reader-pre-014/` | `readonly=2`；372 objects、13,515 columns；目标表不存在 |
| Migration review | `03_CLICKHOUSE_SCHEMA_DIFF.md` | `APPROVED_ADDITIVE`；014 仅含幂等 CREATE |
| Post-014 reader snapshot | `reports/clickhouse/192.168.1.7-schema-snapshot/reader-post-014/` | 373 objects、13,573 columns；仅新增 1 张 58 列 `ReplacingMergeTree` 表 |
| Runtime E2E | `evidence/codex_it_20260814T065032Z_710cb25_e149888-runtime-e2e.json` | 2,517 PostgreSQL records 与 2,517 external Query rows 精确对账 |
| Failure E2E | `evidence/codex_it_20260814T080120Z_710cb25_e149888_v2-fixture-e2e.json` | transport outage 恢复与独立 Worker `SIGKILL` 恢复全部检查通过 |

没有启动本地 ClickHouse，也没有执行 DROP、TRUNCATE、DELETE、destructive ALTER 或历史改写。

## 真实 Runtime 联调快照

| Layer | Observed result |
| --- | --- |
| Run identity | export/source `codex_it_20260814T065032Z_710cb25_e149888`；node `node-codex-it-20260814`；revision 1 |
| Probe | Runtime-compatible authenticated HEAD → 204 |
| PostgreSQL before recovery | 2,435 total；2,066 ACKed；369 pending；57 open DLQ |
| Recovery | first operation requeued 22 then exposed sparse-partition ACK defect；fix 后 operation `codex_it_20260814T082118Z_evidence_recovery2` requeued 35 and delivered 451 |
| PostgreSQL final | 2,517 records；sequence `1..2517`；pending 0；DLQ 0；frontier `2517` |
| WAL | 2,439 frames；6,224,020 bytes；2,517 records；offset `0..2438` |
| Worker | checkpoint 2,438；2,439 journal files |
| ClickHouse / Query | HTTP 200；2,517 rows；2,517 unique record IDs；2,517 unique row IDs |
| Exact reconciliation | PG/CH hash both `sha256:3d8fd06dc9f4bb09b7aa4de518800eaa63c514417ad11e2006ac07e01af537f8` |
| Task evidence | failed: 7 tasks / 37 records；canceled: 5 tasks / 26 records；completed: 0 |

为避免联调期间执行任何物理 UGV/tool side effect，完整 Runtime task process 被明确停止；DLQ recovery/export 仅通过正式 Evidence product service/repository/transport 边界的一次性 evidence-only runner 完成。这不降低已有 failed/canceled task 为真实 PostgreSQL producer evidence 的分类，也不把它们误称为 completed task。

## 已观察到通过的验证

| Gate | Observed result |
| --- | --- |
| Contract sync/check | 121 files、100/95/5、canonical hashes 一致；drift fail-closed |
| Telemetry `npm run verify` | PASS；typecheck、build、70/70 tests、static gate |
| External fixture | PASS；HEAD/ACK/WAL/restart/replay/Query 8 项检查为 true |
| External failure v2 | PASS；unreachable transport 保持 WAL/checkpoint，恢复后 checkpoint 0/write 1；独立 child 实际 `SIGKILL` 后只补未完成 projection |
| Runtime producer chain | PASS for real failed/canceled tasks；2,517 records exact source-to-query reconciliation |
| Runtime required regression | PASS；typecheck/build、2,002 tests、216 integration tests、305 contract tests、100/100 Evidence coverage、791-file architecture gate |

## 尚未闭合的验收项

1. E2E-03：至少一个真实 `completed` task；本次观测 completed task 为 0。
2. 真实 partial ACK exchange；本次 receiver 正常路径为整批 durable 后 full ACK，DLQ retry/restart 已通过。
3. 通用 non-enum 多字段 skill input merge、部分 future source mutation 检测、`secret:` resolver 一致性、Unicode locale canonicalization。
4. Compact schema-valid 1,000-record acceptance fixture；当前只闭合 1,001 reject 与 byte boundary。

当前状态：**真实 failed/canceled Runtime path PASS；Gate I PASS；总体 CONDITIONAL_PASS。**
