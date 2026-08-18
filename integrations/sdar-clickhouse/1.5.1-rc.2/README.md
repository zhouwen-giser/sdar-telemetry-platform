# SDAR ClickHouse 1.5.1-rc.2 integration contract

This directory is the Telemetry-owned, fail-closed consumer lock for the immutable
`SDAR_ClickHouse_Schema_1.5.1_RC2_Clean_Rebuild.zip` authority. It does not contain or execute
the destructive rebuild aggregate.

- `contract.json` freezes the release, exact Domain Source/Seal tables, independent projection
  identities, projection sets, targets, governance v2 columns and public views.
- `required-object-descriptors.json` is generated from the accepted live `readonly=2` snapshot
  after that snapshot was compared with an isolated RC2 `fresh_all.sql` reconstruction.
- `source-lock.json` locks the package and full live/reference descriptor hashes.
- `contract-manifest.json` byte-locks the integration assets.
- `verify.sql` is the supplied read-only post-install view analysis.

Run `npm run check:sdar-clickhouse-contract` for the offline lock and
`npm run clickhouse:domain-preflight` for a live read-only compatibility check. Any mismatch is
`CLICKHOUSE_SCHEMA_CONTRACT_DRIFT`. Passing the check never activates a projection.
