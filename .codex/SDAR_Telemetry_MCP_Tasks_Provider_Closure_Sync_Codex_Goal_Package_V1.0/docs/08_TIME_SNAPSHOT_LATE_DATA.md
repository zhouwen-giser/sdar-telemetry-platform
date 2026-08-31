# 08 — Time, Snapshot, Late Data and Replay

## Time fields

Do not collapse:

- occurredAt
- observedAt
- receivedAt
- ingestedAt
- projectedAt
- evaluatedAt

State freshness uses observedAt.

## Snapshot algorithm

1. capture source identity at `asOfProjectedAt`;
2. load all required pages under that bound;
3. capture again;
4. if source identity changed, retry bounded times;
5. if stable, build deterministic closure;
6. write detail rows;
7. under lease/fence, publish manifest last;
8. expose snapshot only when manifest exists.

## Late data

If a new fact projects after the published `asOfProjectedAt`:

- do not rewrite old snapshot;
- schedule/build a new snapshot;
- preserve both;
- downstream EvaluationInputSnapshot remains pinned to the old closure until explicitly rebuilt.

## Determinism gate

For identical:

- scope
- authoritative inputs
- provider/runtime contract hashes
- mapping version
- `asOfProjectedAt`

the closure hash must be identical.

Different output hash is a defect.
