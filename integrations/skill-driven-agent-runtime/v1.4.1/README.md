# SDAR Evidence v1.4.1 contract snapshot

This directory is the byte-locked Telemetry import of the Runtime-owned Evidence contract. Runtime PostgreSQL remains the authority; this snapshot defines the receiver boundary only.

## Locked source

- Execution SHA: `7246c263bbb5554d01a7aa343ef6f857378e7bf4`
- Main SHA: `34ce7a7a43971de37566b24f969b4f0aeadec2b2`
- Contract version: `sdar.evidence/v1`
- Canonical contract SHA-256: `sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f`
- Canonical registry SHA-256: `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71`
- Imported source files: 121

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
