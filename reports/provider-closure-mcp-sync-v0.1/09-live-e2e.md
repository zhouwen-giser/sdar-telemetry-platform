# T10 Live / Normal-path E2E

Status: PASS for the Provider normal path, Canonical Runtime Evidence path and formal closure path.

Truth labels:

- `live-provider-e2e`: PASS. Producer commit
  `0c1b525d99718d058b1011cf96306d960fd2d326` emitted nine records after the closure origin cutoff.
  Initial and duplicate requests returned 200; the deliberate same-identity hash conflict returned 500.
  Collector `127.0.0.1:14318`, Processor `127.0.0.1:8443`, both Processor routes and shared ClickHouse
  participated. Both WAL checkpoints reached `11207261`, pending=0, lastError=null.
- `contract-e2e`: PASS. The combined normal-path qualification used the formal SMPP facts and posted
  the 105-contract Runtime batch through Telemetry Gateway → durable WAL → Worker → `sdar_core`, then
  ran `ProviderClosureRuntime` detail-first/manifest-last. The final post-sync run
  `closure-normal-20260831release` produced snapshot
  `sha256:19ed3d76d93fddc0d49a550cf43038e64cd69c3404509f5580d92dd5a2f79ce1`
  is `ready`: execution exact, dispatch recovered, reconciliation found_exact, control/execution/business
  terminal axes completed/succeeded, optional Mission unresolved, and both success-proof flags false.
- `live-ugv-e2e`: NOT_RUN by design. No vehicle/navigation/control action is authorized or required.

Latest Producer batch:

- facts projected at `2026-08-31T08:38:56.144Z`: 9/9 `observed_at` non-null;
- authoritative relations projected at `2026-08-31T08:38:56.218Z`: committed Task→Execution,
  reconciliation-found Task→Execution, and Execution→DeviceMission;
- committed task/execution: `77fa3010-0637-44c2-ade6-38cef50b44cf` /
  `execution-76e6cfed-368a-4233-994b-1066a05ae8d6`;
- uncertainty task recovers the same execution; the deliberate `conflicting-execution` observation is
  retained as conflict evidence and never treated as the authoritative result.

No direct INSERT was made into `sdar_core`; no Benchmark result was fabricated; no device control was
issued.

The combined qualification selected exactly one authoritative-instance Provider fact and verified
`observed_at` on 1/1 selected facts. Runtime Gateway initial and duplicate submissions returned 202;
its Worker completed one durable frame. The existing SMPP Producer qualification independently proved
200/200 idempotence and the expected 500 same-identity hash conflict through Collector/Processor.
