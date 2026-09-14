# SDAR 遥测源码联合包交付（2026-09-09）

已实现一键生成脚本、整理部署执行事项并生成最终源码联合包。本轮没有连接、更新或重启 sz-gowm；没有附带离线镜像。

## 交付物

- 归档：`sdar-telemetry-united-a9452f8fd2e1b23164f4.tar.gz`（29.07 MiB）。
- 目录：`/home/zhouwen/web-download/sdar-telemetry-platform/artifacts/united/sdar-telemetry-united-a9452f8fd2e1b23164f4`。
- SHA256：`f2bfd0cff223e0876db56722f37e23fcffc2f825a54f2d8b8d0f8f86bf210c80`。
- 本项目 sourceHash：`ef7716315248e699bdb1d25ea71d655f3dbc0e8853ec2a8f6369575e2be2f4a8`。
- Git revision：`01719507aea97f2bcca904fc3838127ee2fd29b2`；包括本次有效未提交源码。
- 固定上游：`sdar-united-34cc46c4e334d8c35d99.tar.gz`。
- 上游 SHA256：`01483f39eac04a555d4868c44cc6b94b269a9266bb3db83206698f6534b5f408`。

上游原始字节逐字节比较一致，并逐层验证完整清单、SDAR 源码身份、SMPP/GOWM 等嵌套组件以及 Authority 定义。没有将现场当前 SMPP/WSGS 等版本替换进冻结上游。

```sh
npm run package:joint -- --upstream /absolute/path/sdar-united-34cc46c4e334d8c35d99.tar.gz --output artifacts/united
```

目录同时包含 `.sha256`、UNION.json、SHA256SUMS 和 delivery.json。具体部署顺序及校验命令见 `deploy/united/README.md`；历史事项见 `deploy/united/DEPLOYMENT_HISTORY.md`，两份文档均随包交付。

## 本次实现

新增受控上游校验器和联合包生成入口；原字节嵌入上游，加入本项目源码、独立校验器、部署历史和清单。上游校验逻辑由本机已审阅实现适配，来源 SHA256 记录于模块头部，不执行输入归档内程序。

单项目打包入口与联合打包共用源码收集、敏感文件排除及确定性归档。已验证两个入口生成的源码归档完全相同。自定义输出目录不会进入下一轮源码；同名内容一致复用，冲突拒绝覆盖；验证通过后才原子发布交付目录。

原有站点部署工具继续保留：独立管理库和 WAL、ClickHouse 25.3.14.14、精确 Docker DNS、Evidence 增量导出、权限分离、回滚与健康恢复等待。没有新增业务 API 或数据库迁移。

## 本次验证

- `npm run verify`：类型检查、构建、冻结合同、static_verify 通过；204 项测试通过，4 项真实 PG 测试独立运行。
- 专属本机 PostgreSQL：4/4 集成测试通过，串行初始化避免共用 schema 竞争；容器和临时卷已清理。
- `npm run test:deployment`：原有站点回归 6/6、新联合包回归 8/8 通过。
- 回归涵盖外部摘要、固定输入身份、嵌套缺失、Authority 必需文件、危险路径、链接、重复成员、源码缺失/篡改、私密文件排除、私钥拒绝、自定义输出、已删除工作区文件、重复生成和输出冲突。
- 真实联合包及其嵌套身份最终校验 PASS；连续两次生成 SHA256 完全一致。
- 在新临时目录解包，从独立工作目录运行随包 `verify.py` 及源码内 `deploy.py verify` 均 PASS，未依赖相邻仓库源码。
- 仅以干净解包目录为上下文构建原 Dockerfile，镜像构建 PASS。npm 下载曾等待；包仓库诊断成功后构建正常完成，未调整依赖或 Dockerfile。
- 干净源码生成六服务 Compose，Docker Compose 配置验证通过，Domain 保持 shadow。
- 无网络临时镜像烟测：Gateway /health 200、未鉴权探针 401、正确鉴权探针 204；未写业务记录，容器已清理。
- 本项目源码扫描 427 个文件，核对本机可用的 2 个私密值，无匹配；没有包含 `.env` 或凭据文件。上游原字节保留，其既有敏感值验收不被冒充成本次重新连接现场扫描。

证据：`local-verify.log`、`postgres-integration.log`、`deployment-tests.log`、`clean-build.log`、`clean-image-smoke.json`、`clean-config.json`、`secret-scan.json`、`repeat-package.log`、`verify-final.json`、`delivery.json`。

## 交付边界

新联合包的 sourceHash 与历史现场部署 sourceHash 不同，因为加入了新的打包代码。历史执行事项摘要中的 458 条落库、回滚、48 个上游服务保护等属于此前现场证据，本轮没有重新进行现场部署。

源码包目标 linux/amd64，部署依赖、镜像和真实凭据需另行提供。GOWM/SMPP/SMPP Telemetry/SDAR 依次按内层正式入口处理，再按本项目站点说明接入；已有 sz-gowm 不重放基础设施初始化。一键打包不是全栈一键部署，也不是全栈新机验收。

ProviderOps 保留等待新来源的边界，Commander/NPC 未注册时领域投影不激活；不声明完整 Domain Projection 或 Benchmark 业务验收。
