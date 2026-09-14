# sz-gowm 集成部署

站点固定使用共享 ClickHouse **25.3.14.14**，独立 Control PostgreSQL，以及私有持久 WAL。
Query/Admin 显式使用可信内网开发模式；Evidence 和 Domain Source 使用不同写入令牌。

## 发布

本地运行 `python3 deploy/sz-gowm/package.py`。上传生成的归档及 `.sha256`，在服务器校验后解压至
`/mnt/data/sdar-telemetry-releases/`。在包内依次运行：

```sh
python3 deploy/sz-gowm/deploy.py verify
python3 deploy/sz-gowm/deploy.py build
python3 deploy/sz-gowm/deploy.py up
python3 deploy/sz-gowm/qualify.py
python3 deploy/sz-gowm/verify-site.py
python3 deploy/sz-gowm/deploy.py status
```

稳定入口 `/mnt/data/sdar-telemetry-current` 只在部署成功后更新；状态和凭据放在
`/mnt/data/sdar-telemetry-state`（0700，文件 0600）。归档含源码、逐文件哈希和 sourceHash，
不包含站点凭据、根目录历史报告或本地 `.env`。冻结 integrations 中的测试 fixture 保留。

- Gateway：`http://17.26.1.20:28080`，写入必须带独立令牌。
- Query：`http://17.26.1.20:28081`；指标 `/v1/metrics`，Trace `/v1/traces`。
- Admin：`http://17.26.1.20:28082`。
- Domain 状态：服务器本机 `http://127.0.0.1:28083/status`。

启动前核对现有 Compose 所有权、端口及网络，并在隔离的同版本 ClickHouse 中执行冻结
014–016 迁移，对照现场 Evidence/ProviderOps 列、默认值、引擎、键和视图 SQL。
现有对象漂移或缺失时停止，不静默修改共享库。当前现场已具备这些迁移。
另外运行原有十项领域投影结构预检；不修改仍锁定 24.10 的通用历史发布合同，也不声称其全量门禁通过。

账号初始化短暂使用仅 localhost 可访问的临时 ClickHouse XML 管理身份，完成后立即删除。
独立 writer/reader 通过 SQL 持久化在现有 ClickHouse 数据卷中；不改变原 sdar 账号。
读权限由冻结对象清单和本次 Evidence/ProviderOps 查询对象生成；写权限仅授予本站实际投影表。
Domain 来源尚未接入，因此不授予其落地写权限、不激活投影。后续扩展须同时审查 producer、迁移和权限。

SDAR Evidence 从激活时间开始，固定 exportId `sz-gowm-incremental-evidence`，sourceId/nodeId
`sdar-sz-gowm`。ProviderOps 租户、项目和环境来自现有 SMPP 映射，首次接入时间保存于 Control 库，
重复部署不会重置。无真实记录时保持等待；不回补历史或生成仿真任务。

## 恢复

`deploy.py logs` 查看本项目日志。`deploy.py check` 重新验证结构。
`deploy.py rollback --release /mnt/data/sdar-telemetry-releases/<previous-release>` 回退应用镜像；
不传 release 则停止本项目应用，Control PostgreSQL、数据卷和全部检查点保留。

当前 SDAR 正式 API 没有暂停 Evidence 导出的操作。因此 rollback 先撤除本站发送凭据并重载
Runtime，以阻止成功投递，再操作遥测应用；配置仍会显示 active/degraded，outbox 会保留并重试，
不将其标记为 suspended。恢复旧应用成功后再注入凭据。长期停机应关注 outbox 保留期限和积压。
不直接修改 SDAR 业务数据库。Runtime 重载前检查无在途 Task，并备份配置；其他上游服务不得重建。

回滚不执行 DROP、卷删除或历史边界重置。首次部署没有可回退应用版本。

## 验证

`python3 -m unittest discover -s deploy/sz-gowm -p 'test_*.py'` 覆盖端口/网络、凭据隔离、
确定性生成、持久卷、配置冲突与归档防篡改。`npm run verify` 执行现有门禁；四项真实 PostgreSQL
测试另在隔离库中用 `--test-concurrency=1` 运行，避免两个测试文件并行初始化同一 schema。
`qualify.py` 使用无外部网络、无宿主端口的临时 25.3.14.14 容器，验证真实 Evidence 入库、
Gateway 重启 ACK、后端故障不推进检查点、Worker 重启和幂等重放，并自动清理临时容器与卷。
