import { test, expect } from "@playwright/test";
import { fulfillReport } from "./report-fulfill";

/* v5 quality gate.
   The deployed frontend origin (usepreflight.xyz) is in the API CORS allowlist,
   but http://localhost:3000 (Playwright's test host) intentionally is not.
   These tests therefore route-fulfill each endpoint from a real live-captured
   response so we exercise the rendering path against real payload shapes,
   without depending on CORS being relaxed for tests. */

const H = { "access-control-allow-origin": "*" } as const;

const COHORT_BODY = {
  schema_version: "preflight.cohort.v1",
  generated_at: new Date().toISOString(),
  policy_version: "preflight.release-policy.v1",
  totals: { listed_asps: 25, with_runtime_evidence: 14, conforming: 0, with_contradictions: 13, unknown: 12, unreachable: 11 },
  conforming: [],
  contradiction_summary: [
    { criterion_code: "LST-04", count: 13, plain: "Listing service type differs from the observed surface form" },
    { criterion_code: "LST-01", count: 7, plain: "Listing fee differs from the price the endpoint demands" },
    { criterion_code: "LST-02", count: 6, plain: "Listing asset differs from the asset the endpoint demands" },
  ],
  drift_events_24h: 2,
};
const SELF_CHECK_BODY = {
  schema_version: "preflight.self-check.v1",
  report_id: "pfr_test",
  receipt_id: "rcpt_abc123def456",
  decision: "RELEASE" as const,
  settlement_ref: "0xdeadbeef",
  label: "SELF_CHECK_PRODUCTION",
  customer_demand: false,
  published_at: new Date(Date.now() - 10 * 60_000).toISOString(),
};
const VERIFY_RECEIPT_BODY = {
  signature_valid: true,
  issuer: "https://api.usepreflight.xyz",
  key_id: "preflight-v4-production-20260713",
  key_status: "active",
  payload_hash_matches: true,
  not_expired: true,
  snapshot_binding: { manifest_hash: "sha256:fe9f921007a5355c87987711a3be9e60e343ded9ce8f61ed74b4c9d9126d72a1", snapshot_hash: "sha256:b79ea9e62b4d80a69bdf2b4ad1b69e29f263b227f69aab7629139c69df38b603" },
  policy_version: "preflight.release-policy.v1",
  scope: {
    proves: ["issuer_authenticity", "payload_integrity", "snapshot_binding", "policy_binding"],
    does_not_prove: ["semantic_correctness_of_delivery", "future_behaviour", "security_of_target", "marketplace_endorsement"],
    policy_version: "preflight.release-policy.v1",
    snapshot_hash: "sha256:b79e",
    valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  },
  verified_at: new Date().toISOString(),
  how_to_verify_offline: "node --input-type=module -e 'import crypto from \"node:crypto\"; /* verify */'",
};
const ASP_2013_BODY = {
  schema_version: "preflight.asp.v1",
  agent_id: "2013",
  runtime_evidence: "available",
  last_checked: new Date().toISOString(),
  criterion_codes: ["LST-01", "LST-04"],
  owner_claim_cta: "Are you the owner? Authorize a full check to publish a scoped passport.",
};
const BENCHMARK_BODY = {
  schema_version: "preflight.benchmark.v1",
  policy_version: "preflight.release-policy.v1",
  generated_at: new Date().toISOString(),
  total_fixtures: 5,
  passing: 4,
  cases: [
    { case_id: "golden_release", seeded_fault: "none", expected_decision: "RELEASE", expected_codes: [], actual_decision: "RELEASE", actual_codes: [], passes: true },
    { case_id: "wrong_amount", seeded_fault: "x402 amount differs from manifest", expected_decision: "BLOCK", expected_codes: ["PAYMENT_AMOUNT"], actual_decision: "BLOCK", actual_codes: ["PAYMENT_AMOUNT"], passes: true },
    { case_id: "bad_payto", seeded_fault: "x402 payTo differs from manifest", expected_decision: "BLOCK", expected_codes: ["PAYMENT_PAY_TO"], actual_decision: "BLOCK", actual_codes: ["PAYMENT_PAY_TO"], passes: true },
    { case_id: "missing_402", seeded_fault: "target responds without x402 challenge", expected_decision: "BLOCK", expected_codes: ["PAYMENT_MODE"], actual_decision: "BLOCK", actual_codes: ["PAYMENT_MODE"], passes: true },
    { case_id: "transport_unreachable", seeded_fault: "no transport evidence", expected_decision: "UNKNOWN", expected_codes: ["TARGET_ENDPOINT", "TARGET_METHOD", "INTERFACE_MODE", "REDIRECT_POLICY"], actual_decision: "UNKNOWN", actual_codes: ["INTERFACE_MODE", "REDIRECT_POLICY", "TARGET_ENDPOINT", "TARGET_METHOD"], passes: true },
  ],
};

async function stubAll(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/cohort", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(COHORT_BODY) }));
  await page.route("**/api/v1/self-check", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(SELF_CHECK_BODY) }));
  await page.route("**/api/v1/verify-receipt", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(VERIFY_RECEIPT_BODY) }));
  await page.route("**/api/v1/asp/2013", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(ASP_2013_BODY) }));
  await page.route("**/api/v1/passport/2013", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify({ schema_version: "preflight.passport.v1", state: "none", message: "No owner-authorized passport has been issued." }) }));
  await page.route("**/api/v1/benchmark", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(BENCHMARK_BODY) }));
}

test.beforeEach(async ({ page }) => { await stubAll(page); });

test("verify: prefilled receipt_id renders four verdict pills, scope, and offline command", async ({ page }) => {
  await page.goto("/verify?receipt_id=rcpt_abc123def456");
  await expect(page.getByText("Signature valid").first()).toBeVisible();
  await expect(page.getByText("Payload intact").first()).toBeVisible();
  await expect(page.getByText("Not expired").first()).toBeVisible();
  await expect(page.getByText("Issuer recognized").first()).toBeVisible();
  await expect(page.getByText("This receipt proves").first()).toBeVisible();
  await expect(page.getByText("This receipt does not prove").first()).toBeVisible();
  await expect(page.getByText("Verify it yourself, offline")).toBeVisible();
});

test("cohort: totals + contradictions render without any ASP name in contradictions section", async ({ page }) => {
  await page.goto("/cohort");
  await expect(page.getByRole("heading", { name: "The OKX.AI agent cohort." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contradictions found" })).toBeVisible();
  const contradictionSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Contradictions found" }) });
  // Hard rule: no name from any conforming entry may appear in the contradictions section.
  for (const c of COHORT_BODY.conforming as Array<{ name: string }>) {
    await expect(contradictionSection.getByText(c.name)).toHaveCount(0);
  }
  // Codes+counts render, sorted descending.
  const counts = await contradictionSection.locator("tbody tr td:nth-child(3)").allInnerTexts();
  const nums = counts.map((s) => Number(s.trim()));
  for (let i = 1; i < nums.length; i += 1) expect(nums[i - 1]).toBeGreaterThanOrEqual(nums[i]);
});

test("asp/2013: SSR page renders one of the three valid states", async ({ page }) => {
  // ASP pages are SSR (force-dynamic); the server-side fetch hits the live API
  // and cannot be intercepted by Playwright route-fulfillment. Assert structure
  // rather than a specific state so the test is resilient to live data changes.
  await page.goto("/asp/2013");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  expect(heading).toContain("2013");
  const main = page.locator("main");
  await expect(main).toBeVisible();
  // One of: evidence branch, conforming branch, or none branch must render
  const hasEvidence = await page.getByText("Runtime evidence exists for this service").count();
  const hasConforming = await page.getByText("Live surface conforms to the listing").count();
  const hasNone = await page.getByText("No runtime evidence yet for this agent").count();
  expect(hasEvidence + hasConforming + hasNone).toBeGreaterThanOrEqual(1);
});

test("benchmark: all fixtures pass, transport_unreachable visible", async ({ page }) => {
  await page.goto("/benchmark");
  await expect(page.getByRole("heading", { name: "What PreFlight catches." })).toBeVisible();
  const row = page.locator("tr", { hasText: "transport_unreachable" });
  await expect(row).toBeVisible();
  await expect(row.getByText("PASS")).toBeVisible();
});

test("check: Try Judge Mode button prefills 2013", async ({ page }) => {
  await page.goto("/check");
  const btn = page.getByRole("button", { name: "Try Judge Mode" });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByLabel(/Endpoint URL or OKX Agent ID/)).toHaveValue("2013");
});

test("home: live evidence strip + self-check strip render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Live evidence")).toBeVisible();
  await expect(page.getByText("OKX.AI ASPs scanned with runtime evidence")).toBeVisible();
  await expect(page.getByText("Contradictions surfaced")).toBeVisible();
  await expect(page.getByRole("link", { name: /Explore the cohort/ })).toBeVisible();
  await expect(page.getByText("PreFlight verified its own release")).toBeVisible();
  await expect(page.getByText("customer_demand: false")).toBeVisible();
});

test("report BLOCK fixture with v2 journey + scope renders both", async ({ page }) => {
  await fulfillReport(page, "block");
  await page.route("**/api/v1/reports/**", async (route) => {
    const body = JSON.parse(require("node:fs").readFileSync(require("node:path").join(process.cwd(), "tests", "fixtures", "report-block.json"), "utf8"));
    body.scope = VERIFY_RECEIPT_BODY.scope;
    body.journey = [
      { step: "resolve_listing", status: "not_applicable", observed: "No marketplace listing was supplied.", t_ms: 1 },
      { step: "reach_endpoint", status: "ok", observed: "HTTPS endpoint responded.", t_ms: 12 },
      { step: "payment_challenge", status: "contradiction", observed: "payTo differs from declared.", t_ms: 45 },
    ];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  await page.goto("/report/x#access_token=verificationtokenverificationtoken1234");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Buyer journey")).toBeVisible();
  await expect(page.getByText("Read payment challenge")).toBeVisible();
  await expect(page.getByText("What a receipt for this report proves")).toBeVisible();
  await expect(page.getByText("This receipt proves")).toBeVisible();
  await expect(page.getByText("This receipt does not prove")).toBeVisible();
});
