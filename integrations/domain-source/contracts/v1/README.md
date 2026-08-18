# SDAR Domain Source v1

This directory freezes the producer-facing `sdar.domain-source/v1` wire contract used by the
Domain Projection Worker. It is additive to `sdar.evidence/v1` and does not activate any Domain
Projection.

## HTTP contract

- records: `POST /v1/domain-source/batches`
- episode seals: `POST /v1/domain-source/episode-seals`
- required header: `x-sdar-domain-source-contract: sdar.domain-source/v1`
- acknowledgement is valid only after the exact request is durably appended to the Gateway WAL

The batch schema accepts only the ten source contract IDs frozen by ClickHouse 1.5.1-rc.2. A
batch is application-homogeneous (`commander` or `npc`). Database names, table names, SQL, and
near-name legacy aliases are not request fields.

## Identity and hashes

- source identity: canonical tuple `(tenantId, projectId, sourceContractId, recordId,
  sourceRevision)`
- `sourceRevision` and other UInt64 wire values are canonical decimal strings
- `payloadHash`: SHA-256 of canonical `payload`
- `batchHash`: SHA-256 of the canonical request without `batchHash`
- same identity + same payload hash is a duplicate; same identity + different payload hash is a
  conflict (enforced by the durable ingestion phase)

Run `npm run check:domain-source-contracts` to prove that generated schemas and Golden fixtures
have not drifted. These fixtures are contract evidence, not real ClickHouse E2E evidence.
