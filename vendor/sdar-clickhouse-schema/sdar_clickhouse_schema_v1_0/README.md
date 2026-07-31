# SDAR ClickHouse Schema 1.2

这是面向全新安装的 ClickHouse 建库基线，统一承接 SDAR Runtime、车长智能体和 NPC 智能体三套埋点。目录名保留 `sdar_clickhouse_schema_v1_0` 只是为了兼容现有工程路径；本包的发布版本以 `manifest.json` 中的 `1.2.0` 为准，目标 Runtime 为 SDAR `v1.3.0`。

本版本不是可直接覆盖 1.0 生产库的在线 `ALTER` 脚本。已有数据请按 [migration_from_v1_0.md](docs/migration_from_v1_0.md) 进行双写、回放和切换。

## 分层边界

| 层级 | 数据库 | 权威事实 | 评价出口 |
|---|---|---|---|
| 应用层 | `sdar_commander`、`sdar_npc` | 车长/NPC 原始语义及应用专用明细 | `commander_*`、`npc_*` |
| 领域层 | `sdar_embodied` | 两类智能体归一后的完整具身控制事实 | `embodied_*` |
| 通用层 | `sdar_core` | SDAR v1.3 通用证据、Skill-aware 一级事实与评价就绪度 | `general_*` |
| 控制面 | `sdar_meta` | ID 交叉表、投影定义/版本/水位、评价定义 | 不直接计分 |
| 结果层 | `sdar_mart` | 三层评价的版本化结果与证据快照 | 兼容查询视图 |

```text
SDAR Runtime ───────────────────────────────→ sdar_core
                                                     │
车长采集 → sdar_commander ── P1 ─┐                  │
                                  ├→ sdar_embodied ─ P2 ─→ sdar_core
NPC 采集 → sdar_npc ───────── P1 ─┘

sdar_commander / sdar_npc ── 应用评价 ──→ commander_* / npc_*
sdar_embodied              ── 领域评价 ──→ embodied_*
sdar_core                  ── 通用评价 ──→ general_*

Collector / P1 / P2 / Evaluator ── 定义、版本、crosswalk、lineage、水位 ──→ sdar_meta
```

Runtime Collector 也在 `sdar_meta` 登记 Schema/Collector 版本并遵循 Event Policy；业务遥测事实仍只写 `sdar_core`。P1、P2 是有检查点的外部 Projector/流处理任务，不是跨库同步物化视图。领域事实会继续投影到通用事实，但三个评价器只读取各自层的事实和同层证据快照；分数、门槛和致命错误不得从上一层复制或汇总。

## v1.3 证据基础

- Canonical Envelope 固定 `evidenceFamily=sdar.evidence/v1`，以 `recordType + schemaName/schemaVersion` 选择载荷合同。
- 交付保证 `transactional/buffered` 与评价角色 `required/supporting/diagnostic` 是正交字段；不能再用一个 durable 标志同时表达两者。
- 17 类 Skill 事实写入 `sdar_core.skill_*`，原计划、决策、行动、回执、远程任务和验证事实通过 `skill_execution_id` 等列关联执行树。
- `sdar_meta.evidence_policy` 保存冻结的 18 类记录策略；除 `skill_patch_candidate` 为 supporting 外，其余为 required，均 transactional、禁止采样。
- required transactional 证据必须在 PostgreSQL 权威事务边界进入 Journal/Outbox，以至少一次方式投递，并按 `record_id + payload_hash` 幂等；普通 OTel span 不是正式证据。
- `evaluation_readiness` 只表达证据是否完整，不计算 Metric/Gate/Fatal，也不替代三层独立评价。

## 版本合同

- 通用证据 Schema：`SDAR v1.3.0 / Schema 文档 V1.2 / Evidence Family sdar.evidence/v1`。
- 具身数据 Schema：`Embodied-Control Data Schema 1.0.0`。
- 评价框架：`SDAR 2.0`；Profile：`embodied-control 1.0`。
- 待评审指标稿 `SDAR-Embodied V2.1` 生成独立的 metric/gate/fatal set 版本；领域三者当前文本均为 `2.1-review1`，但不冒充框架/Profile 版本，也不能互相替代。
- 四套预置定义分别为 `commander-application/application-v1-draft`、`npc-application/application-v1-draft`、`embodied-control/2.1-review1`、`core-general/general-v2-draft`；每套都有独立 15 Metric、7 Gate、7 Fatal，且均保持 `draft` 等待评审/激活。
- 每次评价都固定 `framework/profile/metric_set/gate_set/fatal_set/evaluator/projection/evidence_snapshot/watermark`，可以重放但不能就地覆盖历史结果。

冲突取舍和未自动推断项见 [alignment_check.md](docs/alignment_check.md)。

## 兼容基线

- 可执行基线：ClickHouse 24.8+；推荐 ClickHouse 25.3 LTS+。
- 所有业务时间使用 `DateTime64(3, 'UTC')`。
- 动态对象保留为 `String CODEC(ZSTD(3))`，参与过滤、关联和约束的字段单独列化。
- 默认 DDL 面向单节点 `Atomic` 数据库。生产集群的 Replicated/Distributed 改造见 [deployment.md](docs/deployment.md)。

## 安装

按迁移顺序执行：

```bash
for file in migrations/[0-9][0-9]_*.sql; do
  clickhouse-client --multiquery < "$file"
done
```

也可以执行生成的单文件：

```bash
clickhouse-client --multiquery < all.sql
```

`09_smoke_test.sql` 保留 v1.1 基线断言，`10_sdar_v1_3_skill_aware.sql` 在追加升级后执行最终 v1.3 断言；因此 `all.sql` 成功退出才表示建库完成。

### Docker Compose

Compose 默认固定 ClickHouse `25.3.10.19`，首次创建空数据卷时自动执行 `all.sql`。镜像启动前必须先检查宿主 CPU 指令集兼容性：

```bash
cp .env.example .env
# 修改 .env 中的 CLICKHOUSE_PASSWORD
./tools/check_clickhouse_image_compatibility.sh
docker compose up -d
docker compose ps
```


### `Illegal instruction` 启动失败

若日志在 `/entrypoint.sh` 的 `clickhouse extract-from-config` 阶段出现 `Illegal instruction`，说明 ClickHouse 二进制在执行初始化 SQL 之前就因 CPU 指令集不兼容退出。先运行：

```bash
./tools/check_clickhouse_image_compatibility.sh
```

ARM 主机仅用于开发/Schema 验证时，可在预检确认 amd64 仿真可用后执行：

```bash
docker compose -f compose.yaml -f compose.amd64-emulation.yaml up -d
```

仿真性能明显低于原生运行，不作为生产部署方案。

连接验证：

```bash
docker compose exec clickhouse sh -lc \
  'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SHOW DATABASES"'
```

基础 Compose 不指定 `platform`，由 Docker 按宿主机架构选择镜像。官方 amd64 镜像要求 SSE3；官方 arm64 镜像要求 ARMv8.2-A 和 RCpc。若 ARM 宿主不满足要求，可仅在开发/验证环境使用 `compose.amd64-emulation.yaml`。初始化目录只在空数据卷上执行；已有 `clickhouse_data` 卷不会因更新 `all.sql` 自动重放。Compose 的端口默认仅绑定 `127.0.0.1`，对外开放前应配置防火墙、TLS 和访问控制。

## 生成与验证

修改迁移或文档后重新生成产物：

```bash
python3 tools/build_package.py
python3 tools/build_package.py --check
```

使用本地 ClickHouse 二进制实际编译整包：

```bash
CLICKHOUSE_BIN=/path/to/clickhouse tools/validate_clickhouse.sh
```

验证策略、数据质量查询及上线门槛见 [validation.md](docs/validation.md)。

## 文件索引

- `migrations/00..10`：唯一可编辑的 DDL/种子来源；`10` 是 v1.3 append-only 迁移。
- `all.sql`：由迁移生成的全量安装文件，请勿手改。
- `compose.yaml`、`.env.example`：单节点 Docker Compose 启动和初始化配置。
- [schema_mapping.md](docs/schema_mapping.md)：P1/P2 字段、ID、序号及枚举映射。
- [projection_contract.md](docs/projection_contract.md)：投影幂等、血缘、水位和失败恢复合同。
- [embodied_layer.md](docs/embodied_layer.md)：领域完整事实层的读取边界。
- [evaluation_contract.md](docs/evaluation_contract.md)：三层独立评价与结果版本合同。
- [table_catalog.md](docs/table_catalog.md)：自动生成的全部表和视图目录。
- `manifest.json`：版本、对象数量、文件大小及 SHA-256。


## 1.3.0-rc.1 增量

- Migration 11：v1.3 Event Handling Trace；
- Migration 12：SMPP ProviderOps 外部事实、N×N 关系与对账；
- Migration 13：v1.4 Task—Capability—Skill—Provider 关系；
- 目标对象：6 库、200 张物理表、76 个视图、迁移 00～13；
- 遥测平台完整冻结设计见仓库根目录 `SDAR_Telemetry_Platform_Frozen_Bundle/v1_0`。

> 当前为静态验证通过的发布候选；必须在 ClickHouse 24.8 与 25.3 LTS 完成实机编译、fresh install 和 E2E 后才能标记最终 1.3.0。
