# 从 1.0/1.1 迁移到 1.2

## 1.1 → 1.2（SDAR Runtime v1.3）

`migrations/10_sdar_v1_3_skill_aware.sql` 是在已发布 1.1 基线上执行的 append-only 迁移：新增 17 张 `sdar_core.skill_*` 表和 `sdar_meta.evidence_policy`，并向既有事实表追加 Skill/Canonical Envelope/Readiness 字段。不要修改或重放 00–09 来伪造升级历史。

上线顺序：先发布 Meta Evidence Policy 和新表，再部署 Journal/Outbox/Exporter/Collector 双写 Canonical Envelope，核对同 ID/Hash 幂等与 evidence sequence，最后切换 Runtime 生产者。旧 `delivery_class/required_for_evaluation` 在回放期保留，但必须按 record policy 显式生成 `delivery_guarantee/evaluation_role`；不能仅凭布尔值推断 diagnostic/supporting。v1.2 遥测信封停止新写，只保留历史读取。

以下原 1.0 → 1.1 蓝绿说明继续适用于尚未升级到 1.1 的环境。

## 结论

1.1 是新的全量安装基线，不是对 1.0 原表执行一组安全在线 `ALTER` 即可完成的补丁。以下变化会重写数据布局或对象语义：

- DateTime64 TTL 表达式修正；
- 可变表从按月分区改为按逻辑实体 Hash 稳定分区；
- Basis 引用增加版本；未知 freshness 改为 Nullable；
- `sdar_embodied` 扩为完整领域事实层；
- 元数据增加 UUID crosswalk、投影定义/运行/检查点/DLQ/血缘；
- 评价结果改为三层独立、版本化、证据快照固定的权威表和兼容视图；
- 质量视图的状态值、latest 逻辑、序号范围与 anti-join 语义修正。

不要在已有生产库上直接执行 `all.sql` 并假设 `IF NOT EXISTS` 会升级旧表；它只会跳过同名旧对象，最终形成“脚本成功但结构仍旧”的混合状态。

## 推荐：蓝绿迁移

### 1. 建立绿色环境

在新的 ClickHouse 集群或隔离命名空间安装 1.1，并运行整包 smoke test。保持蓝色 1.0 只读结构不变。

### 2. 部署新版 Collector/Projector

先启用双写但暂不切换查询：

```text
source outbox ─┬→ v1 writer → blue
               └→ v1.1 collector → green application/core raw
                                      └→ P1 → embodied → P2 → core
```

两路都必须从同一 Outbox/消息位点消费，不能从应用内存分别发两次事件。

### 3. 回填事实，不搬运旧分数

- 原始记录和应用事实保留原 `record_id`、Episode ID、occurred time、sequence 与 payload Hash。
- 新增 `basis_version` 只能从 ExecutionBasis/Plan/Mission 证据恢复；找不到时置 0 并产生质量问题，不能默认指向“当前版本”。
- 原 `freshness_ms=0` 无法证明真的为 0；没有来源时间证据时回填为 NULL。
- P1/P2 必须通过正式 Projector 回放，以生成 deterministic UUID、lineage、sidecar、run sequence 和 evidence sequence；不要用不完整的 `INSERT SELECT` 绕过映射合同。
- 旧评价结果仅供对账，不写入 1.1 权威结果表。对回填后的三层事实分别重算新 `result_version`。

### 4. 对账门槛

至少满足以下条件后才能切换：

- 每个租户/项目/日期的源记录数、唯一记录数和 payload Hash 聚合一致；
- ID crosswalk 对同一来源 ID 只有一个 canonical UUID，反向无碰撞；
- P1/P2 checkpoint 追平双写水位且 DLQ 已分类；
- sealed Episode 的 run sequence 与 durable evidence sequence 均无 prefix/trailing gap；
- 关键 Action 均有关联 Basis 版本、Receipt 和需要的 Verification；
- 三层 readiness 达到各自评价要求；
- 随机抽样 Episode 可从应用事实追到领域、通用事实及三份独立评价快照。

具体 SQL 和通过条件见 `validation.md`。

### 5. 切换与回滚

1. 冻结评价调度，等待所有 Projector 追平水位。
2. 将读流量切到 1.1 兼容视图。
3. 重新启用三个 Evaluator。
4. 保留蓝色集群和旧消息位点至少一个完整回滚窗口。
5. 如出现缺证或映射错误，只回切读取；不要反向把 1.1 结果覆盖进 1.0。

## 非生产空库

若 1.0 没有需保留的数据，可以停写后删除六个旧数据库，再执行 1.1。删除数据库是破坏性操作，本包不提供自动 `DROP` 脚本：必须由环境负责人确认备份与库名后人工执行。

## 同机迁移注意事项

同一 ClickHouse 实例上若必须并行蓝绿，应由部署模板给六个数据库加统一后缀，并同步改写视图引用。不要手工全文替换生成的 `all.sql`；应从 migrations 渲染后重新编译和生成 manifest。完成切换前，不要尝试跨 Atomic 数据库逐表 rename 来模拟原子切换。
