# 07. v1.4 Task—Capability—Skill—Provider 事实链

## 1. 需要保留的完整链

```text
A2A Exposure
→ Node Capability Version
→ Task Capability Binding
→ Capability Implementation Binding
→ Plan Template / Skill Version
→ Task Capability Attempt
→ Tool Call / Remote Task
→ MCP Provider Binding / Operation / Resource
→ Evidence / Verification / Outcome
```

## 2. 新增 typed facts

```text
node_capability_version_fact
capability_implementation_binding_fact
capability_readiness_fact
a2a_exposure_revision_fact
agent_card_revision_fact
task_capability_binding_fact
task_capability_attempt_fact
```

这些记录是控制面/Runtime 权威对象的不可变遥测投影，不允许通过 ClickHouse 修改来源。

## 3. 与现有 v1.3 Skill 事实的关系

- `task_capability_binding_fact` 记录对外承诺；
- `task_capability_attempt_fact` 记录本次实现选择；
- `skill_execution_record` 记录 Skill 实际执行；
- `skill_execution_relation` 记录执行树；
- `tool_call_record/remote_task_*` 记录 Provider 调用；
- `verification_record` 证明成功条件；
- `evaluation_readiness` 只判断证据完整。

## 4. 核心查询

```text
Task → Capability Contract
Task → Plan Template/Skill Attempt
Skill → Tool/Remote Task
Tool/Remote Task → Provider/Resource
Task → Evidence/Verification
Capability Version → Success Rate/Latency/Recovery Quality
```
