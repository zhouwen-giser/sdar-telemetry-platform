# SDAR 遥测源码联合包

本包原样保留上游 SDAR 联合包，再加入当前 sdar-telemetry-platform 源码。
它是源码交付物，不是现场全栈当前版本快照；打包、校验不连接服务器、不启动服务。
不附离线镜像，目标 linux/amd64，站点共享 ClickHouse 版本为 **25.3.14.14**。

## 一键生成

依赖 Python 3.10+、Git、Node.js 22+ 和 npm（命令入口）。在本仓库运行：

```sh
npm run package:joint -- --upstream /absolute/path/sdar-united-83214f815640f6688da1.tar.gz --output artifacts/united
```

上游旁需有同名 `.sha256`；固定上游 SHA256：
`9f08a3c7aa7244d0e15223cdddc10dfaa8d87913a869403cf9de70dacbc2d34f`。
脚本不扫描“最新”文件、不替换上游组件。未来变更固定输入须更新受控校验器和回归证据。

输出 `sdar-telemetry-united-<摘要>/`，包含 `.tar.gz`、`.tar.gz.sha256`、UNION.json、
SHA256SUMS 和 delivery.json。相同输入重复生成复用原目录；已有内容不一致则失败。
自定义输出目录也从源码中排除，不能选择仓库根目录或它的父目录。

有效未提交源码会收录，已删除文件不收录；revision 与逐文件 sourceHash 共同记录身份。
本机私密环境文件、凭据、原始报告和构建产物排除；integrations 中冻结的 fixture 保留。
旧的单项目入口 `python3 deploy/sz-gowm/package.py` 仍可使用。

## 校验与内容

先校验外部摘要再解包，包根目录中自带独立校验器及其两个辅助模块：

```sh
sha256sum -c sdar-telemetry-united-<摘要>.tar.gz.sha256
tar -xzf sdar-telemetry-united-<摘要>.tar.gz
python3 sdar-telemetry-united-<摘要>/verify.py /absolute/path/sdar-telemetry-united-<摘要>.tar.gz
```

校验器核对逐层清单和摘要、SDAR 源码、内层 SMPP/GOWM 等组件，以及 Authority 结构和 release 定义。
输入归档内的脚本不参与打包校验执行。外部 SHA256 用于完整性核对，包仍应从可信交付渠道获取。

- `upstream/sdar-united.tar.gz`：固定 SDAR 联合包原字节，含 SMPP Telemetry 及其上游。
- `telemetry/source.tar.gz`：本项目源码，单根目录，含 SITE-MANIFEST.json 和现有站点部署工具。
- `telemetry/source.manifest.json`：本项目逐文件身份副本。
- `DEPLOYMENT_HISTORY.md`：脱敏现场执行事项及验收边界。

UNION.json 中 `sdarTelemetry` 是本项目；内层 `telemetry` 指 SMPP Telemetry，两者不合并或替换。

## 部署顺序与恢复

1. 解包 `upstream/sdar-united.tar.gz`，按其 README 的正式入口处理 GOWM/GDPS/GSAP/SMPP、SMPP Telemetry 和共享 ClickHouse，再部署 SDAR。保留内层 Authority 定义。
2. 解包 `telemetry/source.tar.gz`，按其中 `deploy/sz-gowm/README.md` 构建、核验、接入本项目。
3. 现有 sz-gowm 不应重新初始化基础设施。核对现场版本、网络和存储归属后，使用本项目已有的 `deploy.py up`；不要因联合包包含上游而重放其部署步骤。
4. 凭据、模型密钥及私密配置由运维在包外提供；不复制历史状态或重置 WAL、租约和接入边界。

本项目使用独立 Control PostgreSQL 和持久 WAL，Gateway 28080、Query 28081、Admin 28082；
Domain 状态端口 28083 仅本机。Query/Admin 沿用可信内网开发模式，写入保留独立令牌。
ProviderOps 等待真实来源，Domain 投影保持 shadow 且未激活，不生成样例闭包或业务 Task。

本项目 `deploy.py rollback` 支持应用回退并保留数据。当前 SDAR 无正式暂停 Evidence API，
回退通过撤除本站发送凭据阻止成功投递；恢复后等待导出 healthy，不把 degraded 当作部署成功。
具体命令、outbox 保留限制和运行配置恢复要求见内嵌的站点部署说明。

联合包校验与干净源码构建不等于全栈新机部署或完整领域业务验收。
