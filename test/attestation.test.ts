import { describe, expect, it, vi } from "vitest";
import { canonicalReportHash, stableStringify, startAttestationQueue } from "../src/chain/attest.js";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import type { ReportEnvelope } from "../src/types.js";

const report: ReportEnvelope = { report_id: "pf_test", tool: "run_preflight", target: "https://example.com/run", verdict: "GO", score: 100, findings: [], attestation_tx: null,
  report_url: "https://usepreflight.xyz/r/pf_test", generated_at: "2026-07-10T00:00:00.000Z" };

describe("attestation", () => {
  it("stable-stringifies and hashes deterministically", () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: undefined } })).toBe('{"a":{"x":null,"y":2},"z":1}');
    expect(canonicalReportHash(report)).toMatch(/^0x[a-f0-9]{64}$/);
    expect(canonicalReportHash({ ...report })).toBe(canonicalReportHash(report));
  });

  it("claims a persisted job, submits it, and backfills the check", async () => {
    const job = { id: "att_1", check_id: report.report_id, report_hash: canonicalReportHash(report), attempts: 1 };
    const claimAttestations = vi.fn().mockResolvedValueOnce([job]).mockResolvedValue([]);
    const completeAttestation = vi.fn(async () => undefined);
    const database = { claimAttestations, completeAttestation, retryAttestation: vi.fn() } as unknown as Database;
    const config = loadConfig({ DEPLOYER_PRIVATE_KEY: `0x${"11".repeat(32)}`, ATTESTATION_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111", ATTESTATION_POLL_INTERVAL_MS: "10" });
    const queue = startAttestationQueue(config, database, { info: vi.fn(), error: vi.fn() }, async () => `0x${"22".repeat(32)}`);
    await vi.waitFor(() => expect(completeAttestation).toHaveBeenCalledWith("att_1", report.report_id, `0x${"22".repeat(32)}`));
    queue.stop();
    expect(queue.state.lastError).toBeNull();
  });
});
