import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("emergency assurance source invariants", () => {
  it("uses separated free discovery, cohort, paid, and emergency capacity settings", async () => {
    const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1" });
    expect(config.FREE_DISCOVERY_CLIENT_DAILY).toBeGreaterThan(0);
    expect(config.FREE_DISCOVERY_TARGET_HOURLY).toBeGreaterThan(0);
    expect(config.FREE_DISCOVERY_GLOBAL_EMERGENCY_DAILY).toBeGreaterThan(60);
    expect(config.COHORT_GLOBAL_DAILY).toBeGreaterThan(0);
    expect(config.PAID_VERIFICATION_PAYER_PER_MINUTE).toBeGreaterThan(0);

    const routeSource = await readFile(new URL("../src/routes/release-gate.ts", import.meta.url), "utf8");
    expect(routeSource).toContain("DISCOVERY_CLIENT_RATE_LIMITED");
    expect(routeSource).toContain("DISCOVERY_TARGET_RATE_LIMITED");
    expect(routeSource).toContain("DISCOVERY_GLOBAL_CAPACITY_LIMITED");
    expect(routeSource).not.toContain("FREE_DRAFT_GLOBAL_DAILY");

    const cohortSource = await readFile(new URL("../src/cohort.ts", import.meta.url), "utf8");
    expect(cohortSource).toContain("cohort_global_day");
    expect(cohortSource).toContain("cohort_target_hour");
  });

  it("does not serialize private report capability tokens into badge URLs", async () => {
    const source = await readFile(new URL("../src/routes/release-gate.ts", import.meta.url), "utf8");
    expect(source).not.toContain("token=${encodeURIComponent(token)}");
    expect(source).not.toContain("/api/v1/badge/${reportId}.svg?token=");
    expect(source).toContain("Private report badges are not embeddable with capability tokens");
  });
});
