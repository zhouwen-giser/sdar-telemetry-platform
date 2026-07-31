# Architecture

SDAR Outbox Relay / SMPP Adapter / v1.4 Producers → Ingestion Gateway → Durable filesystem WAL → Telemetry Worker → Central Projection Registry → External ClickHouse → Query API. Control PostgreSQL stores sources, routes, revisions, jobs, leases, checkpoints and audit. Query API is read-only. Console calls Query/Admin APIs only.
