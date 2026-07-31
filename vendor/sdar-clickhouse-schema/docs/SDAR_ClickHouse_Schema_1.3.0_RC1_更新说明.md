# SDAR ClickHouse Schema 1.3.0-rc.1 更新说明

## 版本状态

- 当前：1.3.0-rc.1
- 最终目标：1.3.0
- 已完成：设计冻结、迁移 DDL、对象目录、Manifest 和静态校验
- 待完成：ClickHouse 24.8/25.3 实机编译、fresh install、升级路径和跨系统 E2E

## 对象增量

- Migration 11：1 个事件处置视图；
- Migration 12：2 张 SMPP 外部事实表、6 个视图；
- Migration 13：7 张 Capability 链表、6 个视图；
- 最终目标：6 库、200 表、76 视图。

## 权威边界

- ProviderOps 不写 remote_task_*；
- 遥测不决定 Provider 注册和 Availability；
- Capability/Task 表是权威对象的只读投影；
- ClickHouse 不参与在线任务状态转换。
