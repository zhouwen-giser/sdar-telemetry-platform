# 已执行的 sz-gowm 遥测部署事项

历史日期：2026-09-09。依据本项目 reports/sz-gowm-deployment-20260909 的验收记录整理。
本摘要不包含私密 Compose、凭据、数据库备份或业务记录。

## 已完成

- 核对原 SDAR、SMPP Telemetry、共享 ClickHouse 及外部 Docker 网络；避开 GOWM 已占用的 8080。
- 部署五个遥测应用及独立 Control PostgreSQL，共六个容器；WAL 和控制库均使用持久卷。
- 沿用共享 ClickHouse **25.3.14.14**，以隔离同版本实例比对 13 个 Evidence/ProviderOps 对象、324 列和视图 SQL；核对版本目录、81 个 Provider 输入列及十项领域结构。
- 创建独立 writer/reader，按冻结对象授予读权限，仅向实际 Evidence/ProviderOps 投影表授予写权限。临时 localhost 管理身份完成后删除；原 sdar 账号不变。
- 通过正式 Evidence Export API 创建、校验并发布增量配置。endpoint 使用 Docker DNS，sourceId/nodeId 为 sdar-sz-gowm，从激活时间开始；单批上限 256 KiB。
- 为实际 SDAR 发送进程注入本站令牌，在无在途任务时重载 Runtime；Gateway Evidence/Domain 凭据彼此独立。
- 接通 SMPP 指标和 Trace 的只读查询转发；ProviderOps 的 origin、租约和检查点初始化在独立控制库中。

## 修正与验证

- 为客户端增加显式 sdar-clickhouse 精确主机名允许项，仍拒绝任意其他主机。
- 修正临时 ClickHouse 配置所有者和错误输出，确保服务能读取配置，凭据不出现在后续诊断中；首次失败诊断涉及的初始 writer 凭据在正式投递前已更换。
- 按正式 SDAR 接口将调试示例的 1 MiB 批限制调整至 256 KiB。
- 回滚恢复发现租约/重试等待，部署入口增加最多两分钟 healthy 等待，并补充回归。
- 当时本地 204 项测试通过，另四项真实 PostgreSQL 测试在隔离库中串行执行通过；六项部署回归通过。
- 隔离 ClickHouse 验证真实 Gateway/WAL/Worker 入库、断连不推进检查点、Gateway 重启 ACK、Worker 重启与幂等重放。未向现场写测试 fixture，临时容器及卷已清理。
- 现场导出 healthy，验收时已有 458 条自然 Evidence；指标/Trace 返回真实查询结果。
- 实际回退旧应用后恢复，记录从 216 条增长到 458 条，首次接入边界保持不变。
- 最终重复部署六个容器 ID/启动时间不变；该稳定窗口内另外 48 个服务保持不变。
- 一次重复检查捕获 WSGS 两个容器同时更新，保护检查停止成功判定；本脚本未操作 WSGS，保存差异后在稳定窗口重验通过。
- Runtime 初次发布及回滚期记录的五项来源投影问题均自动标记解决。

## 版本和验收边界

历史现场本项目 sourceHash：`e3b4de6423e44232eb0d15a98d11d58e19086b80b9efe593b84878b68a726bc1`。
此为部署证据，不代表本次新联合包源码身份；新增打包代码的身份见外层 UNION.json。
上游 SDAR 联合包的源码及更内层版本按其冻结清单原样保留，不能当作后来现场所有组件的当前版本。

ProviderOps 当时为 waiting_source，无新 Provider Episode；十个 Domain 投影因未注册真实 Commander/NPC producer 保持未激活，MAX_MODE=shadow。未新增游戏控制任务，未执行历史回补，也未声明完整 Domain Projection 或 Benchmark 业务验收完成。

## 恢复原则

仅操作本项目 Compose 和必要的 SDAR 发送配置，保留 Control 数据、WAL、共享表及首次接入边界。
当前无正式暂停 Evidence API；回滚撤除本站凭据后配置可能显示 active/degraded，outbox 保留并重试。
恢复凭据后等待 healthy；长期停机关注 outbox 保留期限和积压。不通过 DROP、删卷或数据库直改使状态变绿。
已有基础设施不重复初始化，模型、设备绑定和上游业务数据库配置不随本项目回滚覆盖。
