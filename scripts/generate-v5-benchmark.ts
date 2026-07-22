import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import type { JsonValue } from "../src/contracts/canonical.js";
import type { ReleaseManifestV1 } from "../src/contracts/release-gate.js";
import { evidenceArtifact, type EvidenceArtifact } from "../src/release/evidence.js";
import { aggregateDecision, evaluateCriteria, POLICY_VERSION } from "../src/release/criteria.js";
import { ReleaseRepository } from "../src/release/repository.js";

const target = "https://benchmark.example/verify";
const payTo = "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2";
const asset = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const amount = "100000";

function manifest(overrides: Partial<ReleaseManifestV1["payment"]> = {}): ReleaseManifestV1 {
  return {
    schema_version: "preflight.release-manifest.v1",
    release: { service_name: "Benchmark Fixture", release_version: "v5" },
    target: { endpoint: target, method: "POST", interface_mode: "X402_HTTP", redirect_policy: "NONE" },
    payment: { mode: "X402", network: "eip155:196", asset, amount_atomic: amount, pay_to: payTo, ...overrides } as ReleaseManifestV1["payment"]
  };
}

function transport(normalized: Record<string, JsonValue> = {}): EvidenceArtifact {
  return evidenceArtifact("TRANSPORT", target, { final_url: target, status: 402, redirects: [], ...normalized });
}
function x402(normalized: Record<string, JsonValue> = {}): EvidenceArtifact {
  return evidenceArtifact("X402", target, { status: 402, accepts: [{ network: "eip155:196", asset, amount, payTo }], ...normalized });
}

const cases = [
  { case_id: "golden_release", seeded_fault: "none", manifest: manifest(), artifacts: [transport(), x402()], expected_decision: "RELEASE", expected_codes: [] },
  { case_id: "wrong_amount", seeded_fault: "x402 amount differs from manifest", manifest: manifest(), artifacts: [transport(), x402({ accepts: [{ network: "eip155:196", asset, amount: "200000", payTo }] })], expected_decision: "BLOCK", expected_codes: ["PAYMENT_AMOUNT"] },
  { case_id: "bad_payto", seeded_fault: "x402 payTo differs from manifest", manifest: manifest(), artifacts: [transport(), x402({ accepts: [{ network: "eip155:196", asset, amount, payTo: "0x0000000000000000000000000000000000000001" }] })], expected_decision: "BLOCK", expected_codes: ["PAYMENT_PAY_TO"] },
  { case_id: "missing_402", seeded_fault: "target responds without x402 challenge", manifest: manifest(), artifacts: [transport({ status: 200 }), x402({ status: 200, accepts: [] })], expected_decision: "BLOCK", expected_codes: ["PAYMENT_MODE", "PAYMENT_NETWORK", "PAYMENT_ASSET", "PAYMENT_AMOUNT", "PAYMENT_PAY_TO"] },
  { case_id: "transport_unreachable", seeded_fault: "no transport evidence", manifest: manifest(), artifacts: [x402()], expected_decision: "UNKNOWN", expected_codes: ["TARGET_ENDPOINT", "TARGET_METHOD", "INTERFACE_MODE", "REDIRECT_POLICY"] }
] as const;

const results = cases.map((fixture) => {
  const criteria = evaluateCriteria(fixture.manifest, [...fixture.artifacts]);
  const actualDecision = aggregateDecision(criteria);
  const actualCodes = criteria.filter((criterion) => criterion.mandatory && criterion.state !== "MATCH" && criterion.state !== "NOT_APPLICABLE").map((criterion) => criterion.code);
  const passes = actualDecision === fixture.expected_decision && JSON.stringify(actualCodes.sort()) === JSON.stringify([...fixture.expected_codes].sort());
  return {
    case_id: fixture.case_id,
    seeded_fault: fixture.seeded_fault,
    expected_decision: fixture.expected_decision,
    actual_decision: actualDecision,
    expected_codes: fixture.expected_codes,
    actual_codes: actualCodes,
    passes
  };
});

const config = loadConfig();
const database = createDatabase(config);
if (!database || !config.REPORT_TOKEN_SECRET) throw new Error("DATABASE_URL and REPORT_TOKEN_SECRET are required to persist a benchmark run.");
const repository = new ReleaseRepository(database.sql, config.REPORT_TOKEN_SECRET);
try {
  await repository.recordBenchmark(results as unknown as JsonValue, results.length, results.filter((item) => item.passes).length, POLICY_VERSION);
  console.log(JSON.stringify({ total: results.length, passing: results.filter((item) => item.passes).length, cases: results }, null, 2));
} finally {
  await database.close();
}
