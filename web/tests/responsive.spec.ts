import { test, expect } from "@playwright/test";
import { fulfillReport } from "./report-fulfill";

const WIDTHS = [375, 768, 1024, 1440];
const ROUTES = ["/", "/check", "/how-it-works", "/pricing", "/demo", "/docs", "/legal/privacy", "/legal/terms"];

const overflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of WIDTHS) {
  test.describe(`no overflow @ ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const route of ROUTES) {
      test(route, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(250);
        expect(await overflow(page)).toBeLessThanOrEqual(1);
      });
    }
    test("/report", async ({ page }) => {
      await fulfillReport(page, "block");
      await page.goto("/report/x#access_token=verificationtokenverificationtoken1234");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  });
}
