import { test, expect } from "@playwright/test";
import { fulfillReport, fulfillReportError } from "./report-fulfill";

const TOKEN = "#access_token=verificationtokenverificationtoken1234";
const ID = "pfr_01KXBPHHDQZHK7X2HA4CV051PN";

for (const size of [
  { name: "1440", width: 1440, height: 1000 },
  { name: "375", width: 375, height: 812 },
]) {
  test.describe(`report @ ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const fx of ["release", "block", "unknown"] as const) {
      test(fx, async ({ page }) => {
        await fulfillReport(page, fx);
        await page.goto(`/report/${ID}${TOKEN}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        // token stripped from visible URL
        expect(page.url()).not.toContain("access_token");
        await page.screenshot({ path: `tests/shots/report-${fx}-${size.name}.png`, fullPage: true });
      });
    }

    test("invalid", async ({ page }) => {
      await fulfillReportError(page, { status: 404, code: "REPORT_NOT_FOUND", category: "REPORT_ACCESS" });
      await page.goto(`/report/${ID}${TOKEN}`);
      await expect(page.getByText(/report is unavailable/i)).toBeVisible();
      await page.screenshot({ path: `tests/shots/report-invalid-${size.name}.png`, fullPage: true });
    });
  });
}

test("needs link (no token)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/report/${ID}`);
  await expect(page.getByText(/this report is private/i)).toBeVisible();
  await page.screenshot({ path: "tests/shots/report-needslink-1440.png", fullPage: true });
});

test("expired", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/report/${ID}?state=expired`);
  await expect(page.getByText(/has expired/i)).toBeVisible();
  await page.screenshot({ path: "tests/shots/report-expired-1440.png", fullPage: true });
});
