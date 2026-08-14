import {access, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";

import {
  EVIDENCE_V1_EXPLICIT_CANONICAL_ONLY_RECORD_TYPES,
  EVIDENCE_V1_SPECIALIZED_TABLES,
  canonicalProjection,
} from "../packages/telemetry-projection-registry/src/index.js";
import {loadEvidenceV1Validator} from "../packages/telemetry-contracts/src/index.js";
import type {
  CanonicalFact,
  EvidenceV1Record,
  EvidenceV1RecordFamily,
  EvidenceV1SourceSystem,
} from "../packages/telemetry-types/src/index.js";

const root = process.cwd();
const schemaRoot = path.join(
  root,
  "integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1",
);
const registryPath = path.join(schemaRoot, "registry.json");
const projectionPath = path.join(root, "packages/telemetry-projection-registry/src/index.ts");
const migrationPath = path.join(root, "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql");
const queryPath = path.join(root, "apps/query-api/src/server.ts");
const outputDirectory = path.join(root, "reports/sdar-integration/evidence");
const reportPath = path.join(root, "reports/sdar-integration/04_PROJECTION_COVERAGE.md");
const canonicalTable = "sdar_core.sdar_evidence_v1_record";

interface RegistryRecord {
  sourceSystem: string;
  sourceTable: string;
  recordFamily: string;
  recordType: string;
  schemaName: string;
  schemaVersion: number;
  schemaPath: string;
  schemaHash: string;
  deliveryGuarantee: string;
  evaluationRole: string;
  requirementLevel: string;
}

interface Registry {
  contractVersion: string;
  registryHash: string;
  records: RegistryRecord[];
}

interface CoverageRow {
  index: number;
  recordType: string;
  recordFamily: string;
  evaluationRole: string;
  requirementLevel: string;
  deliveryGuarantee: string;
  schemaName: string;
  recognized: true;
  canonical: true;
  canonicalTable: string;
  queryable: true;
  specializedMode: "conditional" | "canonical-only";
  specializedTable: string | null;
  silentDrop: false;
}

const [registryRaw, projectionSource, migrationSource, querySource] = await Promise.all([
  readFile(registryPath, "utf8"),
  readFile(projectionPath, "utf8"),
  readFile(migrationPath, "utf8"),
  readFile(queryPath, "utf8"),
]);
const registry = JSON.parse(registryRaw) as Registry;
const validator = await loadEvidenceV1Validator(schemaRoot);
assert(registry.contractVersion === "sdar.evidence/v1", "contract version");
assert(registry.records.length === 100, "record count");
assert(new Set(registry.records.map((record) => record.recordType)).size === 100, "unique types");
assert(validator.recordSchemaCount === 100, "validator schema count");
assert(projectionSource.includes(canonicalTable), "projection canonical target");
assert(querySource.includes(canonicalTable), "query canonical target");
assert(querySource.includes('addTraceFilter(filters, parameters, "recordId", "record_id")'), "query record route");
assert(
  /^CREATE TABLE IF NOT EXISTS sdar_core\.sdar_evidence_v1_record\s*\(/imu.test(
    migrationSource,
  ),
  "canonical migration target",
);
assert(
  !/\b(?:DROP|ALTER|DELETE|TRUNCATE|INSERT|UPDATE|RENAME|REPLACE|OPTIMIZE)\b/iu.test(
    migrationSource,
  ),
  "additive migration",
);

await Promise.all(
  registry.records.map(async (record) => {
    await access(path.join(schemaRoot, record.schemaPath));
  }),
);

const specializedTables = EVIDENCE_V1_SPECIALIZED_TABLES as Readonly<Record<string, string>>;
const explicitCanonicalOnly = new Set<string>(EVIDENCE_V1_EXPLICIT_CANONICAL_ONLY_RECORD_TYPES);
const rows: CoverageRow[] = registry.records.map((record, index) => {
  assert(validator.recognizesRecordType(record.recordType), `recognized ${record.recordType}`);
  const fact = routeProbeFact(record, index, registry.registryHash);
  const projected = canonicalProjection.project(fact);
  assert(
    projected.length === 1 && projected[0]?.table === canonicalTable,
    `canonical route ${record.recordType}`,
  );
  const specializedTable = specializedTables[record.recordType] ?? null;
  if (specializedTable !== null) {
    assert(record.requirementLevel === "conditional", `specialized applicability ${record.recordType}`);
    assert(
      projectionSource.includes(`"${record.recordType}": "${specializedTable}"`),
      `specialized route ${record.recordType}`,
    );
  }
  if (explicitCanonicalOnly.has(record.recordType)) {
    assert(specializedTable === null, `explicit canonical-only ${record.recordType}`);
  }
  return {
    index: index + 1,
    recordType: record.recordType,
    recordFamily: record.recordFamily,
    evaluationRole: record.evaluationRole,
    requirementLevel: record.requirementLevel,
    deliveryGuarantee: record.deliveryGuarantee,
    schemaName: record.schemaName,
    recognized: true,
    canonical: true,
    canonicalTable,
    queryable: true,
    specializedMode: specializedTable === null ? "canonical-only" : "conditional",
    specializedTable,
    silentDrop: false,
  };
});

const required = rows.filter((row) => row.evaluationRole === "required").length;
const diagnostic = rows.filter((row) => row.evaluationRole === "diagnostic").length;
const specialized = rows.filter((row) => row.specializedMode === "conditional").length;
const canonicalOnly = rows.filter((row) => row.specializedMode === "canonical-only").length;
assert(required === 95, "required coverage");
assert(diagnostic === 5, "diagnostic coverage");
assert(specialized === 3, "specialized coverage");
assert(canonicalOnly === 97, "canonical-only coverage");
assert(rows.every((row) => row.recognized && row.canonical && row.queryable), "100/100 coverage");
assert(rows.every((row) => !row.silentDrop), "silent drop");

const evidence = {
  generatedAt: new Date().toISOString(),
  contractVersion: registry.contractVersion,
  registryHash: registry.registryHash,
  inputs: {
    registry: relative(registryPath),
    projection: relative(projectionPath),
    migration: relative(migrationPath),
    queryApi: relative(queryPath),
  },
  deploymentBoundary:
    "Static target coverage only. The pre-014 snapshot does not contain the canonical target table.",
  assertions: {
    recognized: "100/100",
    canonical: "100/100",
    queryable: "100/100",
    required: "95/95",
    diagnostic: "5/5",
    conditionalSpecialized: "3/3",
    canonicalOnly: "97/97",
    silentDropCount: 0,
  },
  rows,
};

await mkdir(outputDirectory, {recursive: true});
await Promise.all([
  writeFile(
    path.join(outputDirectory, "projection-coverage-100.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDirectory, "projection-coverage-100.csv"),
    coverageCsv(rows),
    "utf8",
  ),
  writeFile(reportPath, coverageReport(evidence.generatedAt, rows), "utf8"),
]);

process.stdout.write(
  `${JSON.stringify({
    report: relative(reportPath),
    rows: rows.length,
    required,
    diagnostic,
    specialized,
    canonicalOnly,
    silentDrop: 0,
  })}\n`,
);

function routeProbeFact(
  entry: RegistryRecord,
  index: number,
  registryHash: string,
): CanonicalFact {
  const hash = entry.schemaHash.replace(/^sha256:/u, "");
  assert(/^[0-9a-f]{64}$/u.test(hash), `schema hash ${entry.recordType}`);
  const recordId = `evidence_${hash}` as `evidence_${string}`;
  const sequence = String(index + 1);
  const occurredAt = "2026-08-14T00:00:00.000Z";
  const record: EvidenceV1Record = {
    contractVersion: "sdar.evidence/v1",
    schemaName: entry.schemaName,
    schemaVersion: 1,
    recordFamily: entry.recordFamily as EvidenceV1RecordFamily,
    recordType: entry.recordType,
    recordId,
    sourceSystem: entry.sourceSystem as EvidenceV1SourceSystem,
    sourceTable: entry.sourceTable,
    sourceRecordId: `coverage:${entry.recordType}`,
    sourceRevision: "coverage-probe-1",
    environment: "coverage-probe",
    correlationId: `coverage:${entry.recordType}`,
    occurredAt,
    recordedAt: occurredAt,
    deliveryGuarantee: "durable_projection",
    evaluationRole: entry.evaluationRole as "required" | "diagnostic",
    evidenceSequence: sequence,
    evidenceRefs: [],
    artifactRefs: [],
    payloadHash: entry.schemaHash as `sha256:${string}`,
    payload: null,
  };
  return {
    factId: recordId,
    sourceId: "coverage-probe",
    sourceType: "sdar-evidence-v1",
    sourceRecordId: record.sourceRecordId,
    recordFamily: record.recordFamily,
    occurredAt,
    ingestedAt: occurredAt,
    payload: record.payload,
    payloadHash: record.payloadHash,
    correlationId: record.correlationId,
    projectionVersion: "1.0.0",
    contractVersion: "sdar.evidence/v1",
    exportId: "coverage-probe",
    nodeId: "coverage-probe",
    exportRevision: 1,
    batchHash: registryHash as `sha256:${string}`,
    batchNodeId: "coverage-probe",
    firstSequence: sequence,
    lastSequence: sequence,
    evidenceSequence: sequence,
    recordId,
    recordType: record.recordType,
    schemaName: record.schemaName,
    schemaVersion: record.schemaVersion,
    sourceSystem: record.sourceSystem,
    sourceTable: record.sourceTable,
    sourceRevision: record.sourceRevision,
    environment: record.environment,
    recordedAt: record.recordedAt,
    deliveryGuarantee: record.deliveryGuarantee,
    evaluationRole: record.evaluationRole,
    evidenceRefs: record.evidenceRefs,
    artifactRefs: record.artifactRefs,
    evidenceRecord: record,
    receivedAt: occurredAt,
  };
}

function coverageCsv(coverage: readonly CoverageRow[]): string {
  const header = [
    "index",
    "record_type",
    "record_family",
    "evaluation_role",
    "requirement_level",
    "delivery_guarantee",
    "recognized",
    "canonical_table",
    "queryable",
    "specialized_mode",
    "specialized_table",
    "silent_drop",
  ];
  const lines = coverage.map((row) =>
    [
      row.index,
      row.recordType,
      row.recordFamily,
      row.evaluationRole,
      row.requirementLevel,
      row.deliveryGuarantee,
      row.recognized,
      row.canonicalTable,
      row.queryable,
      row.specializedMode,
      row.specializedTable ?? "",
      row.silentDrop,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${header.join(",")}\n${lines.join("\n")}\n`;
}

function coverageReport(generatedAt: string, coverage: readonly CoverageRow[]): string {
  const matrix = coverage
    .map(
      (row) =>
        `| ${String(row.index)} | \`${row.recordType}\` | ${row.recordFamily} | ${row.evaluationRole} | ${row.requirementLevel} | yes | yes | ${row.specializedMode}${row.specializedTable === null ? "" : ` → \`${row.specializedTable}\``} | no |`,
    )
    .join("\n");
  return `# 04 — SDAR Evidence v1 Projection Coverage

Generated: ${generatedAt}

## Result

| Assertion | Result | Meaning |
| --- | ---: | --- |
| Frozen registry recognized | **100/100** | All unique registry entries and their schema assets were found. |
| Canonical projection | **100/100** | Every Evidence v1 recordType was exercised through \`canonicalProjection\` and landed on \`${canonicalTable}\`. |
| Queryable by target code path | **100/100** | The Query API reads the same canonical table and can address every row by mandatory \`record_id\`. |
| Evaluation role \`required\` | **95/95** | No required recordType is dropped. |
| Evaluation role \`diagnostic\` | **5/5** | No diagnostic recordType is dropped. |
| Conditional specialized projection | **3/3** | Only the three lossless Node Control mappings listed below are eligible. |
| Canonical-only | **97/97** | Every other type remains queryable from canonical storage without a guessed specialized row. |
| Silent drop | **0** | Specialized ineligibility never removes the canonical row. |

This is a static target-code assertion, not evidence that migration 014 has been applied or that live Evidence v1 rows have been written. The reader pre-014 snapshot does not contain \`${canonicalTable}\`; live queryability begins only after the separately approved migration and ingestion verification.

## Routing policy

- \`node_control.capability_revision\` conditionally projects to \`sdar_core.node_capability_version_fact\`.
- \`node_control.a2a_exposure\` conditionally projects to \`sdar_core.a2a_exposure_revision_fact\`.
- \`node_control.agent_card_revision\` conditionally projects to \`sdar_core.agent_card_revision_fact\`.
- Conditional means the complete frozen payload and required tenant/project/node scope are present. If not, the canonical row remains and specialized output is empty.
- The 97 other types are canonical-only. In particular, \`capability.*\`, readiness, task binding, and task attempt payloads are not padded with invented values to satisfy older specialized DDL.
- Query coverage is generic rather than a 100-item SQL allowlist: \`/v1/evidence/trace?recordId=...\` filters the mandatory canonical \`record_id\`; task routes and the \`episodeId\` trace filter use lineage columns on the same table.

## Complete 100-type matrix

| # | recordType | family | evaluation | applicability | canonical | queryable | specialized | silent drop |
| ---: | --- | --- | --- | --- | :---: | :---: | --- | :---: |
${matrix}

## Machine-readable evidence

- \`reports/sdar-integration/evidence/projection-coverage-100.json\`
- \`reports/sdar-integration/evidence/projection-coverage-100.csv\`

Regenerate with:

\`\`\`bash
npm run build
node dist/scripts/generate-projection-coverage-report.js
\`\`\`
`;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function relative(file: string): string {
  return path.relative(root, file);
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Projection coverage assertion failed: ${label}`);
}
