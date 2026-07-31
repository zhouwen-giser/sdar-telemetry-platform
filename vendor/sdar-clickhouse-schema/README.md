# SDAR 遥测、具身控制证据与 ClickHouse 存储规范

本仓库同时保存 SDAR Runtime、车长智能体和 NPC 智能体的规范源、JSON Schema、示例及 ClickHouse 全新安装基线。三个采集入口共享可追溯的数据链路，但应用层、领域层和通用层的评价相互独立，不能沿投影链复制分数、门槛结论或致命错误。

## 总体架构

| 层级 | ClickHouse 数据库 | 主要写入方 | 权威内容 | 评价出口 |
|---|---|---|---|---|
| 应用层 | `sdar_commander`、`sdar_npc` | 车长/NPC Collector | 应用原始语义和专用明细 | `commander_*`、`npc_*` |
| 领域层 | `sdar_embodied` | P1 Projector | 两类智能体归一后的完整具身控制事实 | `embodied_*` |
| 通用层 | `sdar_core` | Runtime Collector、P2 Projector | SDAR 通用遥测与评价证据 | `general_*` |
| 控制面 | `sdar_meta` | Collector、Projector、Evaluator | 定义、版本、crosswalk、lineage 和水位 | 不直接计分 |
| 结果层 | `sdar_mart` | 三类 Evaluator | 版本化评价结果及证据快照 | 兼容查询视图 |

```text
SDAR Runtime ───────────────────────────────→ sdar_core
                                                     │
车长采集 → sdar_commander ── P1 ─┐                  │
                                  ├→ sdar_embodied ─ P2 ─→ sdar_core
NPC 采集 → sdar_npc ───────── P1 ─┘

sdar_commander / sdar_npc ── 应用评价 ──→ commander_* / npc_*
sdar_embodied              ── 领域评价 ──→ embodied_*
sdar_core                  ── 通用评价 ──→ general_*
```

P1、P2 是带检查点和水位的外部投影任务，不是跨库同步物化视图。领域事实必须继续投影到通用层；三个评价器则只读取本层事实及本层证据快照，并独立固定规则集和 evaluator 版本。

## 版本口径

| 对象 | 当前版本/状态 | 说明 |
|---|---|---|
| SDAR Runtime 通用证据 | SDAR `v1.3.0` / Schema 文档 `V1.2` / `sdar.evidence/v1` | v1.3 冻结采集合同；取代 v1.2 遥测入口 |
| Embodied-Control 数据 Schema | `1.0.0` | 本仓库 `schemas/` 的 JSON Schema 版本 |
| 评价框架与 Profile | SDAR `2.0` / `embodied-control 1.0` | 评价结果的框架标识 |
| 评价指标稿 | `2.1-review1`，待评审 | Metric、Gate、Fatal 定义草案，不代表已激活 |
| ClickHouse 建库包 | `1.3.0-rc.1`，目标 `1.3.0` | 目录名为兼容路径，发布版本以子包 manifest 为准 |

不同版本轴服务于不同合同，不能用 ClickHouse 包版本替换数据 Schema 或评价规则集版本。每次正式评价还应固定 `framework/profile/metric_set/gate_set/fatal_set/evaluator/projection/evidence_snapshot/watermark`。

## 规范与实现入口

- [SDAR v1.3 Skill-aware Evidence Schema V1.2 冻结版](SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/SDAR_v1.3_Skill_Aware_Evidence_Schema_V1.2_FROZEN_CN.md)
- [SDAR v1.3 Evidence Foundation 升级计划冻结版](SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/SDAR_v1.3_Evidence_Foundation_Upgrade_Plan_FROZEN_CN.md)
- [SDAR v1.3 本项目集成说明](docs/SDAR_v1.3_项目集成说明.md)
- [车长与 NPC 具身控制数据 Schema 1.0](docs/SDAR_Embodied_Control_Data_Schema_V1.0.md)
- [车长与 NPC 评价指标待评审稿](docs/车长智能体与NPC智能体评价指标_待评审.md)
- [ClickHouse Schema 1.3 RC 安装包](sdar_clickhouse_schema_v1_0/README.md)
- [根 JSON Schema 包清单](manifest.json)

ClickHouse 的关键合同文档：

- [规范对齐与冲突取舍](sdar_clickhouse_schema_v1_0/docs/alignment_check.md)
- [P1/P2 字段映射](sdar_clickhouse_schema_v1_0/docs/schema_mapping.md)
- [投影、幂等、血缘与水位](sdar_clickhouse_schema_v1_0/docs/projection_contract.md)
- [三层独立评价合同](sdar_clickhouse_schema_v1_0/docs/evaluation_contract.md)
- [表与视图目录](sdar_clickhouse_schema_v1_0/docs/table_catalog.md)
- [部署说明](sdar_clickhouse_schema_v1_0/docs/deployment.md)
- [验证与上线门槛](sdar_clickhouse_schema_v1_0/docs/validation.md)

## 仓库内容

| 路径 | 内容 |
|---|---|
| [`schemas/`](schemas/) | 按三个系统组织的 Draft 2020-12 JSON Schema；Runtime 下含 v1.3 Skill-aware 冻结 Schema 和记录目录 |
| [`examples/`](examples/) | v1.3 Runtime、车长 Episode、NPC Episode 和评价结果示例 |
| [`types/`](types/) | 对应的 TypeScript 类型声明 |
| [`npc_minimal_case_schema_v1/`](npc_minimal_case_schema_v1/) | NPC 测试案例 Schema `1.1.0`；固定应用层草案评价合同，不是运行证据 |
| [`npc_minimal_runtime_schema_v1/`](npc_minimal_runtime_schema_v1/) | NPC `collectionProfile=minimal` 运行片段 Schema `1.1.0`；不能单独支撑领域/通用正式评分 |
| [`sdar_clickhouse_schema_v1_0/`](sdar_clickhouse_schema_v1_0/) | 六库建库、种子、质量视图、文档和 Docker Compose |

完整 Episode 证据主链为：

```text
Trigger/Goal → State → Event → ExecutionBasis → Decision → Action
             → Receipt → Verification → StateDelta/Trajectory → Outcome
```

“请求已发送”或“工具已受理”不等于业务完成。关键结果必须由状态、回执和 Verification 形成可回放的闭环证据。

Runtime v1.3 在此主链上新增 Skill 使用快照、候选/适用性/选择、模式与组合、过程编译、计划合规、执行树、失败传播和证据要求等一级事实。`transactional|required` 记录禁止采样，并通过权威事务 Journal/Outbox → Exporter/Collector 写入 `sdar_core`；业务层不直接调用遥测 API，OpenTelemetry span 也不能替代正式证据。

## 校验 JSON 示例

推荐使用支持 Draft 2020-12 的 `jsonschema`：

```bash
python3 -m pip install "jsonschema>=4.18"
python3 validate_examples.py
```

校验器覆盖三个 v1.3 Runtime 示例、三个既有完整示例，以及两个 NPC 最小子包示例。旧版 `jsonschema` 会进入 Draft 7 兼容模式并给出提示，仅适合基础回归，不能替代 Draft 2020-12 的正式校验。

## 安装 ClickHouse

Docker Compose 默认固定 ClickHouse `25.3.10.19`。该版本已作为 Schema 验证目标，但镜像能否启动还取决于宿主 CPU 指令集；启动前先运行兼容性预检：

```bash
cd sdar_clickhouse_schema_v1_0
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

也可以向 ClickHouse 24.8+ 执行全量基线：

```bash
clickhouse-client --multiquery < sdar_clickhouse_schema_v1_0/all.sql
```

这是全新安装基线，不是生产库在线 `ALTER` 脚本。已有 1.0 数据应按[迁移说明](sdar_clickhouse_schema_v1_0/docs/migration_from_v1_0.md)进行双写、回放和切换。

修改 ClickHouse 迁移或子包文档后，应重新生成并校验派生产物：

```bash
cd sdar_clickhouse_schema_v1_0
python3 tools/build_package.py
python3 tools/build_package.py --check
docker compose config --quiet
```

`migrations/00..10` 是 ClickHouse DDL 和种子的可编辑来源；`10_sdar_v1_3_skill_aware.sql` 是不改写历史迁移的追加升级。`all.sql`、表目录、静态验证报告及子包 `manifest.json` 均由构建工具生成，不应手工修改。


## 独立遥测平台冻结设计

- 平台：`SDAR Telemetry Platform 1.0.0`；
- ClickHouse 目标：`sdar-clickhouse-schema 1.3.0`；
- 设计包：`SDAR_Telemetry_Platform_Frozen_Bundle/v1_0`；
- 在线 Provider 发现与遥测入仓保持分离；
- ProviderOps 进入 `external_*`，不覆盖 Runtime 权威；
- v1.4 增加 Task—Capability—Skill—Provider 完整事实链。
