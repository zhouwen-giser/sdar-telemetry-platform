# 跨仓库执行与 Git 纪律

## SDAR Telemetry

继续：

```text
feature/domain-projection-worker-v0.1
PR #1 Draft
```

不要创建平行替代分支。

## SMPP Telemetry

若 Source Lock 审计确认当前 main 仍缺 target-specific mapper，则创建：

```text
feature/sdar-shared-warehouse-handoff-v0.1
Draft PR -> main
```

## 顺序

1. SMPP 合同/Adapter/测试可以先完成；
2. SDAR consumer 可基于 1.5.1-rc.2 fixture 和只读表开发；
3. 真 E2E 必须等待 companion branch 部署；
4. 两边都通过后，先评审/合并 SMPP companion，再完成 SDAR live qualification；
5. 不自动 merge/tag。

每个 Phase 必须记录两仓库 SHA、配置 Hash、目标 checkpoint 和 ClickHouse watermark。
