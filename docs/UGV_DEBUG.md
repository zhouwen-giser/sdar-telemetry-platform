# 四项目联调配置（无 Grafana）

统一入口在相邻 SDAR：`pnpm ugv:debug start|restart [YES|NO]`（默认 YES）、`status`、`stop`。
本仓库只提供 `deploy/ugv-debug/compose.yaml`；生产 Compose、默认 shadow 上限和鉴权不改。
完整启动及验证记录见相邻 SDAR 的 `docs/UGV_DEBUG_TELEMETRY.md`、
`execplans/EP-SDAR-TELEMETRY-DEBUG.md`、`reports/sdar-telemetry-debug/verification.md`。

## 配置与 authority

- Gateway 8080、Query 8081、Admin 8082、Domain Worker 8083 监听 0.0.0.0；Control PG 不发宿主端口。
- 专用 Control PostgreSQL owns lifecycle、lease、首次接入边界和 completed identity；
  ClickHouse `192.168.1.7:8123` owns 派生目标与 lineage，不改变任何 SDAR/Provider 业务状态。
- Gateway 内部 Evidence/Domain Source 独立凭据保留。Query/Admin 仅显式
  `TELEMETRY_TRUSTED_DEVELOPMENT=true` 时免登录，固定审计主体 `ugv-debug-development`。
- `DOMAIN_PROJECTION_ENABLED=true` / `MAX_MODE=active` 是联调默认上限；实际 ACTIVE 必须经过
  `bootstrap-ugv-debug.ts` 的正式四步管理动作，校验真实 producer 和 frozen schema/definition/hash。
- 仅接受配置 tenant/project 中真实 Commander/NPC 各一个 active producer。已注册但无记录可
  ACTIVE/waiting_source；未注册阻断。**SDAR → Commander/NPC 层按用户要求留空**，不制造来源。
- 域读范围以 Control PG 首次初始化接入时间为下界，重启不改；扫描游标可以在该界内重访以
  捕捉迟到落地，但 completed identity 防止重复写，绝不向 1970 或别的项目回溯。
- 指标/Trace 不重复入本仓库：新 `/v1/metrics`、`/v1/traces`、`/v1/traces/{traceId}` 只读转发
  固定 `http://smpp-telemetry-query:8088`，允许列表过滤、有界分页、来源标注，保留七天存储策略。

## 迁移及恢复

生成配置/凭据在 SDAR 私有 `debug/sdar-telemetry`，不覆盖此仓库 `.env` 或生产部署。
`control-migrate` 串行执行幂等 Control 001–005。外部执行已审查的 Evidence 014 与
ProviderOps v2 015；015 DDL SHA-256 固定为
`dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a`，并要求
`sdar.provider-closure/v2` approval marker。014 DDL SHA-256 固定为
`fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9`，需精确 approval marker；
仅执行增量 CREATE。之后 `warehouse-preflight` 只读核对十项领域合同及
Evidence 58 列/引擎/排序键。不得运行全仓 reset、历史回补或样例写入以使联调变绿。

Control 004/005 没有自动破坏式 down：需要停用 worker，保留表、WAL、检查点和外部数据后回退应用；
删除接入边界会引起历史扫描，因此不是支持的恢复方式。CH 014/015 不自动 DROP。
目标写失败不推进 checkpoint；租约失效不提交；重启从持久边界继续。`/status` 是本进程 Control
authority 的实际 lifecycle/checkpoint/backlog；缺失观测为 null，不能冒充 seal 完整或任务成功。

## 当前验证边界

2026-08-27：ProviderOps v2 的五个 detail/manifest 表和五个 consumer View 已在外部
ClickHouse 应用并验证；Control PG 005 持久保存 origin、Episode、租约、pending snapshot 和
checkpoint。Manifest 始终最后发布，失败重启不公开半份闭包。Benchmark 的 Domain v1 与
ProviderOps v2 handoff readiness 均为 true。

2026-08-26：183 项 unit/integration（包含真实隔离 PG、测试 CH adapter）通过；typecheck/build、
static_verify、冻结 ClickHouse/domain-source checks 通过。真实外部增量 DDL、十项 schema 与
本机现存指标/Trace 只读联合查询通过；当前 debug 来源仍无后续 Provider Episode，因此
ProviderOps v2 数据状态是等待来源，不以空闭包冒充 ready。
未提供真实 Commander/NPC 注册，未运行完整新栈/实际 ACTIVE/新增业务 Evidence 或领域落库。
不提升既有 Domain Projection v0.1 发布/Benchmark 资格，不以此文档声称全发布门禁完成。
