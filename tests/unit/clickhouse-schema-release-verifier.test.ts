import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveDeclaredColumns,
  deriveExpectedObjects,
  LEDGER_TABLE,
  loadReleasePackage,
  REQUIRED_DATABASES,
  type LoadedReleasePackage,
} from "../../scripts/sync-clickhouse-schema-release.js";
import {
  CANONICAL_EVIDENCE_COLUMNS,
  CRITICAL_SEMANTIC_COLUMNS,
  publicVerificationDiagnostic,
  REQUIRED_PROJECTION_VIEWS,
  ReleaseVerificationError,
  standaloneVerificationFailureDocument,
  verifyInstalledRelease,
  WRITABLE_PROJECTION_TABLES,
  type ReadonlyClickHouse,
  type VerificationAssertionId,
} from "../../scripts/verify-clickhouse-schema-release.js";
import type {ClickHouseQueryOptions} from "../../packages/telemetry-clickhouse/src/index.js";

type ResponseKind =
  | "version"
  | "databases"
  | "objects"
  | "columns"
  | "seeds"
  | "ledger-descriptor"
  | "ledger-tuples"
  | "view-limit-zero"
  | "table-limit-zero";

test("complete fake transcript verifies exact inventory, seeds, ledger identity, and readonly query order", async () => {
  const release = await loadReleasePackage();
  const client = new TranscriptClient(release);
  const result = await verifyInstalledRelease(client, release);
  const objects = deriveExpectedObjects(release);

  assert.equal(result.verified, true);
  assert.deepEqual(
    countBy(objects.map(({engine}) => engine)),
    {MergeTree: 141,ReplacingMergeTree: 170,View: 120},
  );
  assert.equal(client.calls.filter(({kind}) => kind === "view-limit-zero").length, 120);
  assert.equal(client.calls.filter(({kind}) => kind === "table-limit-zero").length, 311);
  assert.equal(client.calls.length, 438);
  assert.ok(client.calls.every(({options}) => options.readonly === 2));
  assert.deepEqual(
    client.calls.slice(-431).map(({kind}) => kind),
    [...Array<string>(120).fill("view-limit-zero"),...Array<string>(311).fill("table-limit-zero")],
  );
  assert.equal(
    client.ledgerRows.every((row) => row["applied_at"] === undefined),
    true,
    "applied_at remains outside existing ledger tuple identity",
  );
});

test("each verifier assertion family emits its stable typed identity", async () => {
  const release = await loadReleasePackage();
  const objects = deriveExpectedObjects(release);
  const writable = WRITABLE_PROJECTION_TABLES[0]!;
  const requiredView = REQUIRED_PROJECTION_VIEWS[0]!;
  const ordinaryTable = objects.find(
    ({kind,database,name}) =>
      kind === "table" && !WRITABLE_PROJECTION_TABLES.includes(`${database}.${name}` as never),
  )!;
  const ordinaryRelation = `${ordinaryTable.database}.${ordinaryTable.name}`;
  const ordinaryObject = objects.find(
    ({database,name}) =>
      !WRITABLE_PROJECTION_TABLES.includes(`${database}.${name}` as never) &&
      !REQUIRED_PROJECTION_VIEWS.includes(`${database}.${name}` as never),
  )!;
  const ordinaryObjectRelation = `${ordinaryObject.database}.${ordinaryObject.name}`;
  const semanticIdentity = CRITICAL_SEMANTIC_COLUMNS[0]!;
  const [semanticDatabase,semanticTable,semanticColumn] = semanticIdentity.split(".") as [string,string,string];
  const scenarios: readonly Scenario[] = [
    {
      name: "version",
      assertionId: "clickhouse-version",
      mutate: (kind, rows) => (kind === "version" ? [{version: "24.9.9.9"}] : rows),
    },
    {
      name: "database set",
      assertionId: "release-database-set",
      mutate: (kind, rows) => (kind === "databases" ? rows.slice(1) : rows),
    },
    {
      name: "writable projection",
      assertionId: "writable-projection-table",
      relation: writable,
      mutate: removeObject("objects", writable),
    },
    {
      name: "required projection view",
      assertionId: "required-projection-view",
      relation: requiredView,
      mutate: removeObject("objects", requiredView),
    },
    {
      name: "object inventory",
      assertionId: "release-object-inventory",
      mutate: removeObject("objects", ordinaryObjectRelation),
    },
    {
      name: "object engine",
      assertionId: "object-engine",
      relation: ordinaryRelation,
      mutate: (kind, rows) =>
        kind === "objects"
          ? rows.map((row) =>
              `${String(row["database"])}.${String(row["name"])}` === ordinaryRelation
                ? {...row,engine: "View"}
                : row,
            )
          : rows,
    },
    {
      name: "canonical column",
      assertionId: "canonical-evidence-column",
      relation: "sdar_core.sdar_evidence_v1_record",
      column: CANONICAL_EVIDENCE_COLUMNS[0]!,
      mutate: removeColumn("sdar_core.sdar_evidence_v1_record", CANONICAL_EVIDENCE_COLUMNS[0]!),
    },
    {
      name: "semantic column",
      assertionId: "critical-semantic-column",
      relation: `${semanticDatabase}.${semanticTable}`,
      column: semanticColumn,
      mutate: removeColumn(`${semanticDatabase}.${semanticTable}`, semanticColumn),
    },
    {
      name: "ledger columns",
      assertionId: "ledger-columns",
      relation: LEDGER_TABLE,
      mutate: removeColumn(LEDGER_TABLE, "applied_at"),
    },
    {
      name: "seed catalog",
      assertionId: "frozen-seed-catalog",
      mutate: (kind, rows) => (kind === "seeds" ? [{...rows[0],operators: 15}] : rows),
    },
    {
      name: "ledger descriptor",
      assertionId: "ledger-table-descriptor",
      relation: LEDGER_TABLE,
      mutate: (kind, rows) =>
        kind === "ledger-descriptor" ? [{...rows[0],sorting_key: "ordinal"}] : rows,
    },
    {
      name: "ledger tuple",
      assertionId: "ledger-tuples",
      relation: LEDGER_TABLE,
      mutate: (kind, rows) =>
        kind === "ledger-tuples"
          ? rows.map((row, index) => (index === 9 ? {...row,file_sha256: "0".repeat(64)} : row))
          : rows,
    },
  ];

  for (const scenario of scenarios) {
    const error = await captureVerificationError(
      new TranscriptClient(release, {mutate: scenario.mutate}),
      release,
    );
    assert.equal(error.assertionId, scenario.assertionId, scenario.name);
    assert.equal(error.relation, scenario.relation, scenario.name);
    assert.equal(error.column, scenario.column, scenario.name);
    assert.equal(error.stage, "release-verifier", scenario.name);
  }

  const driftedRelease: LoadedReleasePackage = {
    ...release,
    migrations: release.migrations.map((migration, index) =>
      index === 1 ? {...migration,statements: []} : migration,
    ),
  };
  const derivationError = await captureVerificationError(
    new TranscriptClient(release),
    driftedRelease,
  );
  assert.equal(derivationError.assertionId, "migration-object-inventory");
  assert.equal(derivationError.queryId, "in-process-migration-object-derivation");
  assert.equal(derivationError.sqlClass, "in-process-no-sql");
});

test("query cause remains typed in process and serializers exclude SQL, response, URL, secret, and stack", async () => {
  const release = await loadReleasePackage();
  const firstView = deriveExpectedObjects(release).find(({kind}) => kind === "view")!;
  const relation = `${firstView.database}.${firstView.name}`;
  const cause = Object.assign(
    new Error(
      "ClickHouse request failed with HTTP 500: Code: 60. DB::Exception: SELECT 'supersecret' FROM hidden password=hunter2 https://user:pw@clickhouse:8123/ (UNKNOWN_TABLE)",
    ),
    {code: "CLICKHOUSE_RESPONSE_ERROR"},
  );
  const client = new TranscriptClient(release, {
    fail: {kind: "view-limit-zero",relation,cause},
  });
  const error = await captureVerificationError(client, release);

  assert.equal(error.assertionId, "view-compilation");
  assert.equal(error.queryId, "release-view-limit-zero");
  assert.equal(error.sqlClass, "readonly-view-limit-zero");
  assert.equal(error.relation, relation);
  assert.equal(error.errorClass, "ClickHouseClientError");
  assert.equal(error.causeCode, "CLICKHOUSE_RESPONSE_ERROR");
  assert.equal(error.clickHouseCode, 60);
  assert.match(error.canonicalSql ?? "", /^SELECT \* FROM /u);
  assert.equal(client.failureCount, 1);

  for (const document of [
    publicVerificationDiagnostic(error, "standalone-verifier"),
    standaloneVerificationFailureDocument(error),
  ]) {
    const serialized = JSON.stringify(document);
    assert.match(serialized, /"stage":"standalone-verifier"/u);
    assert.match(serialized, /"assertionId":"view-compilation"/u);
    assert.match(serialized, /"clickHouseCode":60/u);
    assert.match(serialized, /response details were redacted/u);
    for (const forbidden of [
      "SELECT * FROM",
      "SELECT 'supersecret'",
      "supersecret",
      "hunter2",
      "clickhouse:8123",
      "user:pw",
      "password=",
      "UNKNOWN_TABLE",
      "canonicalSql",
      "stack",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  }
});

test("view and table query failures retain exact allowlisted relation and are attempted once", async () => {
  const release = await loadReleasePackage();
  const objects = deriveExpectedObjects(release);
  for (const [kind,assertionId,queryId,sqlClass] of [
    ["view","view-compilation","release-view-limit-zero","readonly-view-limit-zero"],
    ["table","table-queryability","release-table-limit-zero","readonly-table-limit-zero"],
  ] as const) {
    const object = objects.find((candidate) => candidate.kind === kind)!;
    const relation = `${object.database}.${object.name}`;
    const client = new TranscriptClient(release, {
      fail: {kind: kind === "view" ? "view-limit-zero" : "table-limit-zero",relation,cause: queryFailure()},
    });
    const error = await captureVerificationError(client, release);
    assert.equal(error.assertionId, assertionId);
    assert.equal(error.queryId, queryId);
    assert.equal(error.sqlClass, sqlClass);
    assert.equal(error.relation, relation);
    assert.equal(client.failureCount, 1);
  }
});

test("every bounded inventory query failure retains its exact query identity with one attempt", async () => {
  const release = await loadReleasePackage();
  for (const [kind,assertionId,queryId,sqlClass] of [
    ["version", "clickhouse-version", "clickhouse-version", "readonly-version"],
    ["databases", "release-database-set", "system-databases-release-set", "readonly-system-databases-inventory"],
    ["objects", "release-object-inventory", "system-tables-release-inventory", "readonly-system-tables-inventory"],
    ["columns", "release-column-inventory", "system-columns-release-and-ledger", "readonly-system-columns-inventory"],
    ["seeds", "frozen-seed-catalog", "release-seed-aggregates", "readonly-release-seed-aggregates"],
    ["ledger-descriptor", "ledger-table-descriptor", "system-tables-ledger-descriptor", "readonly-ledger-descriptor"],
    ["ledger-tuples", "ledger-tuples", "release-ledger-tuples", "readonly-ledger-tuples"],
  ] as const) {
    const client = new TranscriptClient(release, {fail: {kind,cause: queryFailure()}});
    const error = await captureVerificationError(client, release);
    assert.equal(error.assertionId, assertionId);
    assert.equal(error.queryId, queryId);
    assert.equal(error.sqlClass, sqlClass);
    assert.equal(error.errorClass, "ClickHouseClientError");
    assert.equal(error.causeCode, "CLICKHOUSE_RESPONSE_ERROR");
    assert.equal(error.clickHouseCode, 60);
    assert.equal(client.failureCount, 1);
  }
});

interface Scenario {
  readonly name: string;
  readonly assertionId: VerificationAssertionId;
  readonly relation?: string;
  readonly column?: string;
  readonly mutate: Mutator;
}

type Rows = readonly Record<string, unknown>[];
type Mutator = (kind: ResponseKind, rows: Rows) => Rows;

class TranscriptClient implements ReadonlyClickHouse {
  readonly calls: Array<{kind: ResponseKind;sql: string;options: ClickHouseQueryOptions}> = [];
  readonly ledgerRows: Rows;
  failureCount = 0;
  private readonly objects;
  private readonly columns;
  private readonly viewRelations: ReadonlySet<string>;

  constructor(
    private readonly release: LoadedReleasePackage,
    private readonly behavior: {
      readonly mutate?: Mutator;
      readonly fail?: {readonly kind: ResponseKind; readonly relation?: string; readonly cause: Error};
    } = {},
  ) {
    this.objects = deriveExpectedObjects(release);
    this.viewRelations = new Set(
      this.objects
        .filter(({kind}) => kind === "view")
        .map(({database,name}) => `${database}.${name}`),
    );
    this.columns = buildColumnRows(release);
    this.ledgerRows = release.migrations.map((migration) => ({
      release_id: release.manifest.releaseId,
      release_manifest_content_address: release.manifest.contentAddress.digest,
      migration_set_content_address: release.manifest.migrationSetContentAddress,
      ordinal: migration.ordinal,
      file_name: migration.file,
      byte_size: migration.bytes,
      file_sha256: migration.sha256,
    }));
  }

  async query(sql: string, options: ClickHouseQueryOptions = {}): Promise<string> {
    const kind = classifyQuery(sql, this.viewRelations);
    this.calls.push({kind,sql,options});
    if (
      this.behavior.fail?.kind === kind &&
      (this.behavior.fail.relation === undefined || sql.includes(this.behavior.fail.relation))
    ) {
      this.failureCount += 1;
      throw this.behavior.fail.cause;
    }
    if (kind === "view-limit-zero" || kind === "table-limit-zero") return "";
    const rows = this.behavior.mutate?.(kind, this.rows(kind)) ?? this.rows(kind);
    return JSON.stringify({data: rows});
  }

  private rows(kind: ResponseKind): Rows {
    switch (kind) {
      case "version":
        return [{version: "24.10.2.1"}];
      case "databases":
        return [...REQUIRED_DATABASES].sort().map((name) => ({name}));
      case "objects":
        return this.objects.map(({database,name,engine}) => ({database,name,engine}));
      case "columns":
        return this.columns;
      case "seeds":
        return [{releases: 1,record_types: 100,source_mappings: 100,operators: 16,relations: 8,invariants: 12}];
      case "ledger-descriptor":
        return [{database: "default",name: "sdar_clickhouse_schema_release_ledger",engine: "MergeTree",sorting_key: "release_id, ordinal"}];
      case "ledger-tuples":
        return this.ledgerRows;
      case "view-limit-zero":
      case "table-limit-zero":
        return [];
    }
  }
}

function classifyQuery(sql: string, viewRelations: ReadonlySet<string>): ResponseKind {
  if (sql.startsWith("SELECT version()")) return "version";
  if (sql.includes("FROM system.databases WHERE name LIKE")) return "databases";
  if (sql.includes("database,name,engine FROM system.tables WHERE database IN")) return "objects";
  if (sql.includes("FROM system.columns")) return "columns";
  if (sql.includes("AS releases")) return "seeds";
  if (sql.includes("FROM system.tables WHERE name='sdar_clickhouse_schema_release_ledger'")) {
    return "ledger-descriptor";
  }
  if (sql.includes(`FROM ${LEDGER_TABLE} ORDER BY ordinal`)) return "ledger-tuples";
  if (sql.includes(" LIMIT 0 FORMAT Null")) {
    const relation = /FROM\s+([A-Za-z0-9_.]+)\s+LIMIT/u.exec(sql)?.[1] ?? "";
    return viewRelations.has(relation)
      ? "view-limit-zero"
      : "table-limit-zero";
  }
  throw new Error("Unexpected fake query class.");
}

function buildColumnRows(release: LoadedReleasePackage): Rows {
  const targetRelations = new Set([
    "sdar_core.sdar_evidence_v1_record",
    ...CRITICAL_SEMANTIC_COLUMNS.map((identity) => identity.split(".").slice(0, 2).join(".")),
  ]);
  const rows: Record<string, unknown>[] = deriveDeclaredColumns(release, targetRelations).map(
    ({database,table,name,type,position}) => ({database,table,name,type,position}),
  );
  let position = 1;
  for (const [name,type] of [
    ["release_id", "String"],
    ["release_manifest_content_address", "String"],
    ["migration_set_content_address", "String"],
    ["ordinal", "UInt8"],
    ["file_name", "String"],
    ["byte_size", "UInt64"],
    ["file_sha256", "FixedString(64)"],
    ["applied_at", "DateTime64(3, 'UTC')"],
  ] as const) {
    rows.push({database: "default",table: "sdar_clickhouse_schema_release_ledger",name,type,position: position++});
  }
  return rows;
}

function removeObject(expectedKind: ResponseKind, relation: string): Mutator {
  return (kind, rows) =>
    kind === expectedKind
      ? rows.filter((row) => `${String(row["database"])}.${String(row["name"])}` !== relation)
      : rows;
}

function removeColumn(relation: string, column: string): Mutator {
  return (kind, rows) =>
    kind === "columns"
      ? rows.filter(
          (row) =>
            `${String(row["database"])}.${String(row["table"])}` !== relation ||
            row["name"] !== column,
        )
      : rows;
}

async function captureVerificationError(
  client: ReadonlyClickHouse,
  release: LoadedReleasePackage,
): Promise<ReleaseVerificationError> {
  try {
    await verifyInstalledRelease(client, release);
  } catch (error: unknown) {
    assert.ok(error instanceof ReleaseVerificationError);
    return error;
  }
  assert.fail("expected verifier failure");
}

function queryFailure(): Error {
  return Object.assign(
    new Error("ClickHouse request failed with HTTP 500: Code: 60. hidden body (UNKNOWN_TABLE)"),
    {code: "CLICKHOUSE_RESPONSE_ERROR"},
  );
}

function countBy(values: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)].sort().map((value) => [value,values.filter((candidate) => candidate === value).length]),
  );
}
