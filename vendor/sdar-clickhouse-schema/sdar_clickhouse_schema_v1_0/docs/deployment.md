# 部署与运行说明

## 1. 运行组件

DDL 只负责持久化合同，不承担采集校验、跨层事务和评分计算。生产链路至少包含以下逻辑组件：

| 组件 | 输入 | 输出 | 必须保证 |
|---|---|---|---|
| Runtime Journal/Outbox | PostgreSQL 权威事务 | 待投递 Canonical Evidence | 与状态变更原子提交；required transactional 不采样 |
| Runtime Exporter/Collector | Journal/Outbox | `sdar_core.raw_envelope` 与通用/Skill 事实 | Schema/Policy 校验、`record_id + payload_hash` 幂等、evidence sequence 顺序 |
| Commander Collector | 车长埋点 | `sdar_commander` | 原始 JSON 不丢失、Episode 内顺序、Hash 冲突隔离 |
| NPC Collector | NPC 埋点 | `sdar_npc` | 完整/最小采集模式标识，不能补造未知状态或物理验证 |
| Control-plane Registrar | Schema、Collector、投影和评价发布物 | `sdar_meta` 定义表 | 版本不可变、审批状态明确、规则集 Hash 可重算 |
| P1 Projector | 应用事实 | `sdar_embodied` | 完整领域语义、确定性 ID、直接与根血缘、断点续跑 |
| P2 Projector | 领域事实 | `sdar_core` | 通用词汇、Run 序号透传、durable Evidence 序号、无损 sidecar、断点续跑 |
| 三类 Evaluator | 各自层事实 | `sdar_mart` 权威表 | 独立取证、独立门槛、不可变结果版本 |

推荐使用 PostgreSQL 权威事务 → Journal/Outbox → Exporter → Kafka/Pulsar → Collector/批量 Writer。业务 Domain/Application 层不得直接调用遥测 API；证据由基础设施在权威事务边界生成。OpenTelemetry 只传递 trace/span context 和运维信号，普通 span 不得作为正式评价证据。ClickHouse 多表写入不提供跨表事务，不能把“目标事实已写入”和“检查点已推进”假定为一个原子动作。

## 2. 写入协议

### Runtime v1.3

1. 权威状态事务和 Canonical Evidence Journal/Outbox 行原子提交。
2. Exporter 至少一次投递；Collector 先按 `recordType` 查询 `sdar_meta.evidence_policy`，校验 Schema、交付保证、评价角色、载荷上限和采样规则。
3. `transactional` 记录必须携带 `evidenceSequence`；required transactional 不允许采样或因背压丢弃。
4. 先以 `record_id + payload_hash` 写 `raw_envelope`，再写对应 typed table 和 `evidence_index`。同 ID 同 Hash 为幂等重试，同 ID 异 Hash 进入阻断死信。
5. Skill 事件必须同时携带可用的 `skill_execution_id`、使用规范 Hash 和执行树关系；不能只写 action/tool span 再离线猜测 Skill。

`delivery_guarantee` 只说明投递语义，`evaluation_role` 只说明评价用途。旧 `delivery_class/required_for_evaluation` 不能由字符串默认值静默映射；迁移期必须按记录类型和已发布 policy 转换。

### Commander/NPC 与投影

每条输入先保留来源声明的 Hash，并另外计算规范化载荷的 SHA-256，再按以下顺序处理。应用表中的 `payload_hash` 是来源值，`payload_sha256` 是统一的投影/幂等 Hash：

Commander/NPC Collector 接受一条记录时，必须同时写各自的 `raw_record` 与对应 typed 表，两者共用 `record_id/payload_sha256`。P1 只消费不存在 raw Hash 冲突、且 raw 与 typed SHA-256 一致的记录；缺任一侧或 Hash 不同都先进入阻断质量处理。

1. 校验 JSON Schema、必填字段、枚举和值域；不合格输入写死信，不进入正式事实表。
2. 用 `tenant_id + project_id + source_agent_type + source_entity_type + source_id` 计算并校验 `id_crosswalk`；一对多派生还必须把 `business_discriminator + target_entity_type` 纳入逻辑键。
3. 对同一 source record 比较 `payload_sha256`：相同值是幂等重试；不同值一律进入 `SOURCE_MUTATION` 阻断死信。合法更正必须使用新 source record ID 并声明 supersedes，不能在原 ID 下“修订”。
4. P2 对每个输出先写与目标同 `record_id/payload_hash/payload_json` 的 `sdar_core.raw_envelope`，再列化到目标专表；durable 输出同时写同 ID/Hash 的 `evidence_index`。
5. 以确定性 ID 批量写入全部必需目标事实和 sidecar。
6. 写入完整 lineage，确认目标 Hash、`mapping_rule_id/version` 和 P1/P2 版本一致；`projection_run` 必须快照 contract、mapping hash、ID namespace 与 environment map 版本。
7. 幂等更新 projection run 的非终态计数和目标水位。
8. 最后才推进 `projection_checkpoint`/消息消费位点；中途崩溃时以相同 ID 从旧位点重放并补齐 raw/typed/index/sidecar/lineage。
9. 整次 run 的最终状态可在最终 checkpoint 后更新，但不参与已提交事实的可见性判定。

`ReplacingMergeTree` 是后台最终合并，不是同步唯一约束。实时查询必须使用包内 latest/兼容视图，或使用 `argMax(..., record_version)`；不要在高频线上查询中滥用 `FINAL`。

## 3. P1 与 P2 投影

### P1：应用层到领域层

- 车长和 NPC 使用相同的领域表：来源 Agent 写入 `agent_type`，来源 Episode 写入 `episode_key`；直接来源由 `source_database/source_table/source_record_id` 保存，根来源由 `root_source_*` 保存。
- `episode_sequence` 继承应用 Episode 顺序；缺号、重号和乱序分别记录，不能重新排序后假装原链完整。
- Collector/Projector 从受控部署配置写入非空 `source_deployment_id`；所有领域事实保存 `source_environment_raw/environment_mapping_id/environment_map_version`。已经规范的环境仍保存原值，legacy 值必须命中唯一显式映射。
- 同一环境 mapping version/key 的状态更新必须复用原 `deployment_environment_mapping.record_id`；内容语义变化发布新 mapping version 和新 record ID，避免历史 `environment_mapping_id` 悬空。
- `freshness_ms=NULL` 表示未知；只有来源给出可验证时间戳时才计算。
- NPC 最小采集只能投影已观测事实，不能据默认值生成 Gate 通过、Verification 通过、控制权唯一或状态新鲜。

### P2：领域层到通用层

- 通用 `agent_type` 固定为 `sdar`；原 `commander/npc` 保存在 `sdar_core.domain_projection_context`。
- 通用 `environment` 是部署环境 `dev/test/staging/prod`，由部署元数据提供；领域 `simulation/field_test/real_vehicle/replay/unknown` 保存在 sidecar，不得通过字符串硬映射。
- 当前合同由 P1 为每个 Episode 生成一个 canonical `run_id` 和默认 `segment_id`，并令 `run_sequence=episode_sequence`；P2 按该 Run 有序消费并原样写入通用 `sequence`。
- `evidence_sequence` 仅为 durable Evidence 分配，且必须形成从 1 到 seal 水位的前缀。
- P2 已收到 P1 生成的 canonical UUID 时原样透传，不再执行 UUIDv5。
- 普通一对一事实使用 `identity_mapping_mode=passthrough` 且四个 `target_identity_*` 字段为空；Run/Segment 和一对多派生身份必须由 P1 先按目标 `source_entity_type + derived-v1 discriminator` 生成 crosswalk，P2 使用 `p1_crosswalk` 并完整填写 source entity type/id/business discriminator/target entity type。发布前质量检查联查 crosswalk，不能把“字段非空”当成真实性证明。
- sidecar 的 Hash 固定映射为：P1 输入 SHA=`sdar_embodied.source_payload_hash`、根 SHA=`root_source_payload_hash`、P2 直接输入 SHA=`payload_sha256`、目标 SHA=`sdar_core.payload_hash`。meta P2 lineage 的 source Hash 也取领域 `payload_sha256`。
- sidecar 同时保存 P1 `source_projection_contract_version/source_projection_mapping_hash` 和 P2 `target_projection_contract_version/target_projection_mapping_hash/target_projection_revision`；新表示以 `supersedes_lineage_id` 串联旧上下文。
- 每个 core 专表输出都必须先存在同 ID/Hash 的 `raw_envelope`；durable 输出还必须存在同 ID/Hash 的 `evidence_index`。发布质量检查必须验证三者一致。
- Basis 与 Receipt 是语义转换，不是同名枚举复制；完整映射见 `schema_mapping.md`。

语义映射变化必须发布新的 `projection_version`。领域表按 projection id/version 保留历史边界，同版本 revision 仅用于确定性修复。core 专用事实是当前表示；完整旧表示依靠 `raw_envelope/evidence_index`、版本化 sidecar 的目标 Hash 和 meta lineage 重放，不假定每张 core 专表都有 projection revision。

完整的 UUIDv5、检查点和失败恢复约束见 `projection_contract.md`。

## 4. 评价调度

评价器先冻结 evidence snapshot 和输入水位，再计算结果：

```text
application evaluator → 只读 sdar_commander 或 sdar_npc
domain evaluator      → 只读 sdar_embodied
general evaluator     → 只读 sdar_core
```

应用、领域、通用三份结果可以共享 `evaluation_group_id` 便于对比，但不得读取另一层得分作为本层输入。任何事实、投影、metric/gate/fatal set 或 evaluator 版本变化都会生成新的 `result_version`；旧版本保留。

## 5. 单机和集群

本包直接创建 `Atomic` 数据库及本地 MergeTree 表。集群部署时建议由模板渲染：

仓库根目录的 `compose.yaml` 提供单节点开发/验证环境。先复制 `.env.example` 为 `.env` 并修改密码，执行 `tools/check_clickhouse_image_compatibility.sh` 完成 CPU/镜像预检，再执行 `docker compose up -d`。Compose 把 `all.sql` 只读挂载到 `/docker-entrypoint-initdb.d`，因此仅在空数据卷首次启动时建库；它不是生产库升级机制。基础配置不包含 `platform`，Docker 会根据宿主机架构选择镜像。官方 amd64 镜像要求 SSE3；官方 arm64 镜像要求 ARMv8.2-A 和 RCpc。ARM 宿主不满足要求时，开发/验证可使用 `docker compose -f compose.yaml -f compose.amd64-emulation.yaml up -d` 运行 amd64 仿真；生产环境必须使用原生受支持 CPU。

- `MergeTree` → `ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')`；
- `ReplacingMergeTree(v)` → `ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}', v)`；
- 在本地表外增加 `Distributed` 查询表，不要让 Collector 同时写本地表和 Distributed 表；
- 应用/领域/通用事实以 `cityHash64(tenant_id, canonical_episode_id)` 分片，保证同一 Episode 尽量落到同一分片；
- `sdar_meta` 的定义表采用单分片多副本，checkpoint/run 表可按 projector 分片；
- 评价权威表按 `evaluation_id` 分片，四个兼容视图只负责过滤，不存副本。

生产环境先在模板生成后的临时数据库实际编译，再执行 `ON CLUSTER`。不要直接对 `all.sql` 做不受审查的全文替换。

## 6. 批次与背压

- Writer 按 10–100 MB 或 1–5 秒组成批次，避免逐行 `INSERT` 产生大量 part。
- `transactional|required` Evidence 优先级最高且不得采样；`buffered/diagnostic` Tick、Heartbeat 和调试日志可按策略降级。
- Projector 落后时暂停对应 evaluator，不允许用不完整水位提前给出“通过”。
- DLQ、projection lag、未关闭 run、未解决 Hash 冲突和 evidence gap 都应接入告警。

## 7. 保留与归档

DDL 只对原始信封和死信提供 365 天默认 TTL，且对 `DateTime64` 显式转换后计算。建议按审计要求配置：

| 数据 | 热数据建议 | 归档/总保留建议 |
|---|---:|---:|
| 应用原始记录 | 90 天 | 365 天或对象存储 |
| durable Evidence 与血缘 | 1 年 | 3–5 年 |
| Tick、Heartbeat、节点明细 | 30–90 天 | 180–365 天 |
| Gate、审批、控制权、致命错误 | 1 年 | 长期 |
| 评价结果及其证据快照 | 长期 | 长期 |

删除事实前必须保证对应 `payload_hash`、Artifact/EvidenceRef 和评价证据快照仍可审计。大型 Prompt、模型全文、二进制传感器数据放对象存储，ClickHouse 仅存 URI、Hash、媒体类型和摘要。

## 8. 权限与安全

- Collector 仅能写自己的应用库；P1 读应用库、写领域库；P2 读领域库、写通用库；Evaluator 只读事实库、写结果库。
- `sdar_meta` 的评价定义和投影定义采用单独发布角色，运行服务不可修改历史定义版本。
- 在 Collector 入口完成敏感字段脱敏；原始载荷仍可能含敏感信息，应启用磁盘加密、传输 TLS 和行级租户隔离。
- `payload_json` 禁止写入明文密钥、访问令牌或可复用凭据。

## 9. 上线顺序

1. 在隔离环境运行 `tools/build_package.py --check`。
2. 分别使用最低支持版本 24.8 和推荐版本 25.3 编译 `all.sql`。
3. 创建生产表和最小权限账号。
4. 启动 Collector 并验证应用/Runtime 原始输入。
5. 启动 P1，检查领域 readiness 和 lineage。
6. 启动 P2，检查 run seal、evidence sequence 与 sidecar。
7. 在每层准备就绪后分别启用 Evaluator。
8. 达到 `validation.md` 的切换门槛后开放查询。
