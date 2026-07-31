# 21. 实施期参数，不重新开放架构

以下参数在实施期选择，不改变设计：

1. WAL 具体文件格式和 Segment 大小；
2. Control DB 与 ClickHouse 是否同机；
3. Object Storage 使用 MinIO、S3 或本地兼容实现；
4. Query Cache 是否使用 Redis；
5. Ingestion Gateway 使用 HTTP/gRPC 的具体 SDK；
6. V1.0 是否部署主动/被动备机；
7. Measurement 默认采样与 TTL；
8. 生产 ClickHouse Replicated/Distributed 拓扑；
9. 指标集 `2.1-review1` 何时审批 active。

需要通过 ADR 才能改变的冻结项：

- 权威边界；
- 六库分层；
- WAL ACK；
- P1/P2 与三层评价；
- ProviderOps external_*；
- Task—Capability—Skill 关系；
- Telemetry 不写 Runtime；
- 独立平台产品边界。
