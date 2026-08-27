import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
const file = process.env["CONTROL_POSTGRES_URL_FILE"];
if (!file) throw new Error("CONTROL_POSTGRES_CONFIGURATION_INVALID");
const pool = new Pool({
  connectionString: (await readFile(file, "utf8")).trim(),
});
const client: {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
  release(): void;
} = await pool.connect();
try {
  await client.query(
    "SELECT pg_advisory_lock(hashtext('sdar-telemetry-migrations'))",
  );
  const names: string[] = await readdir("migrations/control-postgres");
  for (const name of names
    .filter((name) => /^\d{3}_[a-z_]+\.sql$/u.test(name))
    .sort()) {
    await client.query(
      await readFile(`migrations/control-postgres/${name}`, "utf8"),
    );
  }
  process.stdout.write(JSON.stringify({ status: "migrated" }) + "\n");
} finally {
  client.release();
  await pool.end();
}
