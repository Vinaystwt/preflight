import { describe, expect, it } from "vitest";
import { resolveSelftestTarget } from "../src/selftest-target.js";

describe("self-test target resolution", () => {
  it("defaults to and repairs the paid run_preflight route", () => {
    expect(resolveSelftestTarget(undefined, "api.usepreflight.xyz").toString()).toBe("https://api.usepreflight.xyz/api/v1/run_preflight");
    expect(resolveSelftestTarget("https://api.usepreflight.xyz", "ignored.example").toString()).toBe("https://api.usepreflight.xyz/api/v1/run_preflight");
  });

  it("preserves an explicit paid route", () => {
    expect(resolveSelftestTarget("https://api.usepreflight.xyz/api/v1/run_preflight", "ignored.example").pathname).toBe("/api/v1/run_preflight");
  });
});
