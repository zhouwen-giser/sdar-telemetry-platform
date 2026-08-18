# SDAR Domain Projection Contracts v1

This directory freezes the runtime-validation assets for
`sdar.domain-projection/v1`. The five schemas are closed and bounded: unknown
properties, unbounded metadata, executable-code-like fields, non-finite JSON,
and invalid source/target authority boundaries are rejected.

The `fixture_*` names in the golden fixtures are deliberately non-production
placeholders. They do not select, alias, or imply any Commander/NPC source
table mapping.

Each definition names one or more `uniqueTieBreakerFields` that are also part
of its ordered cursor. The contract records the uniqueness claim; mapping and
schema preflight must prove it against the authoritative source schema.

`projectionSetHash` is the SHA-256 hash of canonical JSON containing
`contractVersion`, `projectionSetId`, `projectionSetVersion`, and the
projection entries sorted by projection ID, projection version, mapper ID,
and mapper version. The hash field itself is excluded. Definition hashes use
the complete canonical `DomainProjectionDefinition` value.

Schemas are loaded through `packages/telemetry-contracts`; this directory is
not a second validation framework.

`contract-manifest.json` pins the canonicalization version and canonical
SHA-256 of every schema. The loader verifies those hashes before compiling any
validator, so a v1 schema cannot drift silently.
