import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./client.js";
import { loadConfig } from "../config.js";

const db = createDatabase(loadConfig());
if (!db) throw new Error("DATABASE_URL is required for migrations");
const file = fileURLToPath(new URL("./schema.sql", import.meta.url));
await db.sql.unsafe(await readFile(file, "utf8"));
await db.close();
