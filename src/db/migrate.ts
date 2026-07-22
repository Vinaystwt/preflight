import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./client.js";
import { loadConfig } from "../config.js";

const db = createDatabase(loadConfig());
if (!db) throw new Error("DATABASE_URL is required for migrations");
await db.sql`SET search_path TO public`;
const file = fileURLToPath(new URL("./schema.sql", import.meta.url));
await db.sql.unsafe(await readFile(file, "utf8"));
const migrationDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));
await db.sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
// Down scripts are retained beside their migration for operational recovery;
// they are never part of the forward migration ledger.
for (const name of (await readdir(migrationDirectory)).filter((entry) => entry.endsWith(".sql") && !entry.endsWith(".down.sql")).sort()) {
  const sqlText = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
  const checksum = createHash("sha256").update(sqlText).digest("hex");
  const applied = await db.sql<Array<{ checksum: string }>>`SELECT checksum FROM schema_migrations WHERE version = ${name}`;
  if (applied[0]) {
    if (applied[0].checksum !== checksum) throw new Error(`Applied migration checksum mismatch: ${name}`);
    continue;
  }
  await db.sql.begin(async (transaction) => {
    await transaction`SET search_path TO public`;
    await transaction.unsafe(sqlText);
    await transaction`INSERT INTO schema_migrations (version, checksum) VALUES (${name}, ${checksum})`;
  });
}
await db.close();
