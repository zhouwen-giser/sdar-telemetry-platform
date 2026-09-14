# sz-gowm SDAR 遥测平台部署完成

日期：2026-09-09。目标服务器：sz-gowm（17.26.1.20，amd64）。本次完成核心遥测接入，不新增游戏控制 Task。

## 地址和运行状态

- Gateway：http://17.26.1.20:28080（Evidence/Domain 写入各用独立 Bearer）。
- Query：http://17.26.1.20:28081（可信内网免登录；/v1/metrics、/v1/traces 已验证真实返回）。
- Admin：http://17.26.1.20:28082（可信内网免登录）。
- Domain 状态：服务器本机 http://127.0.0.1:28083/status。

三个公开服务 /health 均已从部署机外请求并返回 200。Gateway、Query、Admin、Domain Worker 和独立 Control PostgreSQL 的容器健康检查通过；Telemetry Worker 进程运行，并已验证真实持续落库。共六个常驻容器，Compose 项目 sdar-telemetry。

## 版本与持久化

- 发布包：sdar-telemetry-e3b4de6423e44232.tar.gz
- SHA-256：0805603670ed716f99f18faff8311231a648d0379c828d54cfa908c262683b8a
- 源码 revision：01719507aea97f2bcca904fc3838127ee2fd29b2；包含本次部署改动，精确源码以 sourceHash 为准。
- sourceHash：e3b4de6423e44232eb0d15a98d11d58e19086b80b9efe593b84878b68a726bc1，清单包含 419 个文件。
- 应用镜像：sdar-telemetry:e3b4de6423e44232。
- 实际镜像 ID：sha256:aa48d009d8b842889055a2f804e51667bf5b0da1addd559a714ee0ac020be971，已核对镜像标签与归档 sourceHash 一致。
- ClickHouse：沿用 smpp-telemetry-sdar-clickhouse-1，**25.3.14.14**；未重建共享仓库、未迁移历史业务数据。
- 独立 Control PostgreSQL 固定 postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685，不发布宿主端口。
- 发布目录：/mnt/data/sdar-telemetry-releases/sdar-telemetry-e3b4de6423e44232。
- 稳定入口：/mnt/data/sdar-telemetry-current。
- 状态目录：/mnt/data/sdar-telemetry-state（0700），凭据文件为 0600。
- 持久卷：sdar-telemetry_control-data、sdar-telemetry_evidence-wal。

打包排除真实凭据、本机 .env 和根目录历史报告。现场将七项实际凭据与归档源码逐文件比对，未发现凭据；冻结 integrations 的 fixture 保留在包中。

## 实际接入证据

Evidence exportId 为 sz-gowm-incremental-evidence，sourceId/nodeId 为 sdar-sz-gowm，revision 1，从激活时间开始增量导出。通过正式创建、校验、发布 API 完成配置，单批最大 256 KiB。导出使用 Docker 内网 sdar-telemetry-ingestion:8080，实际发送进程仅新增本站 SDAR_SITE_EVIDENCE_TOKEN。

最终验收导出状态 healthy，已确认序号 836，pendingRecords=0；共享仓库已收到 458 条自然产生的记录。未向现场写入测试 fixture。

ProviderOps scope 沿用现有 SMPP 映射：tenant-local / smpp-development / development。首次接入时间 2026-09-09T03:17:59.653Z；origin、租约、检查点保存于独立 Control PostgreSQL。当前无新 Provider Episode，状态 waiting_source，不生成空闭包。

十个领域投影未激活，MAX_MODE=shadow。真实 Commander/NPC producer 尚未注册，状态明确给出 DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED；不是结构漂移。此项不构成完整领域联调或 Benchmark 验收。

ClickHouse 使用独立 sdar_site_telemetry_writer / sdar_site_telemetry_reader。读权限按冻结清单和本站查询对象授予；写权限只授予 Evidence 与 ProviderOps 实际投影表；未给应用账户 DDL 权限。两个 ingest token 相互不可替代，Query 只挂载 reader 凭据。初始化时临时 localhost 管理身份已删除，持久用户保存在原 ClickHouse 数据卷中。原 sdar 用户权限与原密码不变。

## 验证结果

- npm run verify：类型检查、构建、冻结合同和 static_verify 通过；204 项测试通过，4 项需要真实 PG 的测试单独运行。
- 独立真实 PostgreSQL：4/4 通过。两个测试文件原先并发创建同一 schema 发生初始化竞争，按 --test-concurrency=1 重跑通过；没有修改断言。
- 新增部署回归：6/6 通过；覆盖端口、网络、凭据隔离、持久化、归档防篡改、配置冲突、256 KiB 限制及恢复等待。
- 25.3.14.14 隔离结构核对：13 个 Evidence/ProviderOps 对象、324 列及视图 SQL 一致；版本目录哈希和 81 个 Provider 输入列合同匹配；原有十项领域结构及 Evidence 58 列预检通过。
- 隔离真实 ClickHouse Evidence 验收通过：2 条 fixture 经真实 Gateway/WAL/Worker 落库；Gateway 重启 ACK 一致，断连不推进检查点，Worker 重启空闲、重新投影后 FINAL 行数稳定。临时容器及卷已清理。
- 现场读写鉴权、reader 无写权限、writer 无 DDL、Query/Admin 内网访问、指标/Trace 转发通过。
- 真实回滚演练：回退到此前已通过的应用包，再恢复最终版本。数据从 216 条增长到 458 条，首次接入边界不变。
- 最终重复部署：六个本项目容器 ID/启动时间不变，SDAR Runtime 未重建，验证窗口内另外 48 个服务保持不变。

一次重复部署检测到 WSGS grounding-api/worker 同时被更新，保护检查正确停止“上游未变”的判定。本部署脚本未操作 WSGS；差异保存在 concurrent-upstream-change.json。随后稳定窗口内再次验证通过，没有回退或覆盖这些并行更新。

Runtime 在首次发布/回滚期间记录过五项来源投影问题，最终均有 resolvedAt，且导出恢复 healthy；摘要保存在 upstream-projection-issues-summary.json。日志中恢复期可能留有租约或旧凭据错误，不据此删除 outbox 或重置接入边界。

## 运维与恢复

```sh
python3 /mnt/data/sdar-telemetry-current/deploy/sz-gowm/deploy.py status
python3 /mnt/data/sdar-telemetry-current/deploy/sz-gowm/deploy.py logs
python3 /mnt/data/sdar-telemetry-current/deploy/sz-gowm/deploy.py up
python3 /mnt/data/sdar-telemetry-current/deploy/sz-gowm/verify-site.py
```

回退命令为 deploy.py rollback --release /mnt/data/sdar-telemetry-releases/<已验证旧版本>。不传 --release 时只停止本项目应用并保留管理库。恢复规则详见仓库 deploy/sz-gowm/README.md。

当前 SDAR 正式 API 没有暂停 Evidence 操作。回滚入口先确认无在途任务，再撤除本站发送凭据并重载 Runtime，阻止成功投递；不是把导出配置标成 suspended。恢复后重新注入凭据，等待最多两分钟，只有 healthy 才报告部署成功。outbox、WAL、Control 数据和共享表全部保留，长期停机须留意 outbox 保留期限。

原 SDAR Compose 备份位于服务器 runtime-compose.before.json。未来重新生成 SDAR 自身 Compose 后，应再次运行本站 up，恢复本站独立发送配置。不要覆盖模型配置、设备绑定或原业务数据库配置。

本次未改变冻结的旧 24.10 发布合同，也未声称完整 Domain Projection 发布门禁完成；本站 25.3.14.14 兼容性以以上实测证据为准。
