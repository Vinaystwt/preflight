import { readFile } from "node:fs/promises";
import { scanMarket } from "../src/scanner.js";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";

const input = process.argv[2];
if (!input) throw new Error("usage: npm run scan-market -- <urls.json|urls.txt>");
const raw = await readFile(input, "utf8");
let targets: string[];
try {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) throw new Error("JSON input must be an array of URLs");
  targets = parsed;
} catch (error) {
  if (raw.trimStart().startsWith("[") || raw.trimStart().startsWith("{")) throw error;
  targets = raw.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}
const delayMs = Number(process.env.SCAN_DELAY_MS ?? "250");
const result = await scanMarket(targets, undefined, delayMs);
const database = createDatabase(loadConfig());
if (database) {
  try { await database.saveHealthIndex(result); }
  finally { await database.close(); }
}
console.log(JSON.stringify(result, null, 2));
