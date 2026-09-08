# SDAR Evidence v1.4.1 contract snapshot

This directory is the byte-locked Telemetry import of the Runtime-owned Evidence contract. Runtime PostgreSQL remains the authority; this snapshot defines the receiver boundary only.

## Locked source

- Execution SHA: `2c3b0c4628ee09afe5e61559e8a7b9d14481b633`
- Main SHA: `b0caf69e9f83bc6702e1c0a85e7ca158c3781d4b`
- Contract version: `sdar.evidence/v1`
- Canonical contract SHA-256: `sha256:795352dc13cc98f153fb9c413e6830870570af75c92831e28102cabc76a6eefd`
- Canonical registry SHA-256: `sha256:7d00320ed21eb89e98abce8ebbdaa7e4aa887e97ee97888ae8e4b62c69adf197`
- Imported source files: 126

Canonical hashes are computed from Runtime's canonical Evidence JSON. Every imported file has a separately named `byteSha256` in `source-lock.json`; a file-byte hash must not be substituted for a canonical contract hash.

## Refresh and verify

From the Telemetry repository root, with the Runtime repository at the default adjacent path `../skill-driven-agent-runtime`:

```sh
npm run sync:sdar-evidence-contract
npm run check:sdar-evidence-contract
```

Pass `--source /path/to/skill-driven-agent-runtime` directly to the TypeScript script when the checkout is elsewhere. Check mode recalculates Git revisions, canonical hashes, record counts, imported file bytes, and generated metadata; it emits `SDAR_EVIDENCE_CONTRACT_DRIFT` and writes nothing when the snapshot differs.

## Compatibility boundary

The files in the parent integration directory describe older SDAR mappings and are **compatibility-only**. They are not authoritative for `sdar.evidence/v1`. New ingestion must use this snapshot's protocol, schemas, and ClickHouse handoff.
