import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fulfillReport, fulfillReportError } from "./report-fulfill";

const discovery = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "discovery.json"), "utf8"));
const TOKEN = "#access_token=verificationtokenverificationtoken1234";

test("home → check → discover", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Run a check" }).first().click();
  await expect(page).toHaveURL(/\/check$/);
  await page.route("**/api/v1/discover", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(discovery) }),
  );
  await page.getByLabel(/Endpoint URL or OKX Agent ID/).fill("https://api.usepreflight.xyz/api/v1/verify-release");
  await page.getByRole("button", { name: "Discover" }).click();
  await expect(page.getByRole("heading", { name: "Proposed manifest" })).toBeVisible();
  await expect(page.getByText("Payment disclosure")).toBeVisible();
});

test("report opens with a valid token, block", async ({ page }) => {
  await fulfillReport(page, "block");
  await page.goto(`/report/pfr_x${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: /BLOCK/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buyer proof" })).toBeVisible();
  expect(page.url()).not.toContain("access_token");
});

test("report invalid token reveals nothing", async ({ page }) => {
  await fulfillReportError(page, { status: 404, code: "REPORT_NOT_FOUND", category: "REPORT_ACCESS" });
  await page.goto(`/report/pfr_x${TOKEN}`);
  await expect(page.getByText(/report is unavailable/i)).toBeVisible();
  await expect(page.getByText(/BLOCK|RELEASE|Buyer proof/)).toHaveCount(0);
});

test("demo shows BLOCK then RELEASE labels", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("Controlled example")).toBeVisible();
  await expect(page.getByRole("heading", { name: /blocked, then fixed, then released/i })).toBeVisible();
});

test.describe("mobile 375", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("check discover on mobile", async ({ page }) => {
    await page.route("**/api/v1/discover", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(discovery) }),
    );
    await page.goto("/check");
    await page.getByLabel(/Endpoint URL or OKX Agent ID/).fill("https://api.usepreflight.xyz/api/v1/verify-release");
    await page.getByRole("button", { name: "Discover" }).click();
    await expect(page.getByRole("heading", { name: "Proposed manifest" })).toBeVisible();
  });
});
