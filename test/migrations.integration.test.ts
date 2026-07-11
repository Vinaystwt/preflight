import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const migrationUrl = new URL("../src/db/migrations/001_release_gate_v2.sql", import.meta.url);

async function runInIsolatedSchema(withLegacyShape: boolean) {
  const sql = postgres(databaseUrl!, { max: 1 });
  const schema = `preflight_test_${randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  try {
    await sql.unsafe(`SET search_path TO ${schema}`);
    if (withLegacyShape) await sql.unsafe("CREATE TABLE checks (id text PRIMARY KEY, verdict text, score integer); INSERT INTO checks VALUES ('legacy', 'GO', 100)");
    await sql.unsafe(await readFile(migrationUrl, "utf8"));
    const tables = await sql<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema} ORDER BY table_name`;
    const names = tables.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining(["release_manifests", "verification_runs", "payment_attempts", "audit_events", "rate_limit_counters", "schema_migrations"]));
    if (withLegacyShape) {
      expect(names).toContain("checks");
      expect((await sql`SELECT * FROM checks`)).toHaveLength(1);
      const references = await sql<Array<{ foreign_table_name: string }>>`
        SELECT ccu.table_name AS foreign_table_name FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ${schema}`;
      expect(references.some((row) => row.foreign_table_name === "checks")).toBe(false);
    }
  } finally {
    await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await sql.end();
  }
}

describe.skipIf(!databaseUrl)("additive Release Gate migrations", () => {
  it("migrates an empty database shape", async () => runInIsolatedSchema(false));
  it("migrates beside the current legacy shape without repurposing it", async () => runInIsolatedSchema(true));
});
