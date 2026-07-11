import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key] as JsonValue)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalize(value));
}

export function canonicalHash(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
