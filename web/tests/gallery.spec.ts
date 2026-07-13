import { test, expect } from "@playwright/test";

const EMPTY_GALLERY = { schema_version: "preflight.gallery.v1", entries: [] };
const ONE_ENTRY = {
  schema_version: "preflight.gallery.v1",
  entries: [
    {
      schema_version: "preflight.gallery-entry.v1",
      gallery_id: "gal_test1",
      report_id: "pfr_test1",
      decision: "BLOCK",
      policy_version: "preflight.release-policy.v1",
      criterion_codes: ["PAY-04"],
      why: ["Buyers would settle to an undeclared address."],
      fix: ["Point payTo to the declared address."],
      generated_at: "2026-07-01T00:00:00Z",
    },
  ],
};

test("gallery shows honest empty state for real corpus, plus labelled reference archetypes", async ({ page }) => {
  await page.route("**/api/v1/gallery", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(EMPTY_GALLERY) }),
  );
  await page.goto("/gallery");
  await expect(page.getByRole("heading", { name: "What a real customer runs into." })).toBeVisible();
  await expect(page.getByText(/No opt-in public cases in this category yet/)).toBeVisible();
  await expect(page.getByText("Reference archetypes · synthetic")).toBeVisible();
  await expect(page.getByText("Synthetic taxonomy examples, not real reports")).toBeVisible();
});

test("gallery renders a real opt-in entry and a working detail expansion", async ({ page }) => {
  await page.route("**/api/v1/gallery", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(ONE_ENTRY) }),
  );
  await page.goto("/gallery");
  const row = page.getByText("Buyers would settle to an undeclared address.");
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText(/Anonymized: no endpoint/)).toBeVisible();
});

test("gallery family filter narrows the reference list", async ({ page }) => {
  await page.route("**/api/v1/gallery", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(EMPTY_GALLERY) }),
  );
  await page.goto("/gallery");
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await expect(page.getByText("No tools exposed")).toBeVisible();
  await expect(page.getByText("Unexpected payee")).not.toBeVisible();
});
