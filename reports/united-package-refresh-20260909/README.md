# 最新上游重新打包验证

本次仅在本地更新上游固定输入并生成源码联合包，没有连接或修改 sz-gowm，不含离线镜像。

- 上游：`sdar-united-83214f815640f6688da1.tar.gz`
- 上游 SHA256：`9f08a3c7aa7244d0e15223cdddc10dfaa8d87913a869403cf9de70dacbc2d34f`
- 上游 SDAR sourceHash：`29fdcfe193d6da6f93c2ce191f904caf64e485ae26022f9e35cc5c0154e5ee99`
- 本次联合包：`sdar-telemetry-united-b1ecf1d217cfb3d312bb.tar.gz`
- 联合包 SHA256：`99906c0a36df87c9afc9ac1eba1008650dd26639f4f1c1e94bb3817c647a07da`
- 本项目 sourceHash：`c8e9a24d3d889eb3976088d356b741624ee7cbcd8b6f13d17a41270e91d021b0`
- 大小：30659123 bytes

14 项部署/打包回归通过；外部摘要、完整逐层清单、源码身份、嵌套组件和 Authority 校验通过。上游嵌入字节与原包完全一致。连续两次生成结果一致；干净临时目录中的包内独立校验入口通过，无需相邻仓库。

本次仅修改打包校验器固定摘要和使用说明，未修改业务源码；未重跑业务测试或镜像构建。既有部署历史和验收边界仍见 deploy/united/DEPLOYMENT_HISTORY.md，不能将历史报告当成本轮现场验收。ClickHouse 基线仍为 25.3.14.14，ProviderOps 等待来源、领域投影未激活边界保留。
