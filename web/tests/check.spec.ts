import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const discovery = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "discovery.json"), "utf8"));

for (const size of [
  { name: "1440", width: 1440, height: 1000 },
  { name: "375", width: 375, height: 812 },
]) {
  test.describe(`check @ ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("idle", async ({ page }) => {
      await page.goto("/check");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `tests/shots/check-idle-${size.name}.png`, fullPage: true });
    });

    test("discovered", async ({ page }) => {
      await page.route("**/api/v1/discover", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(discovery) }),
      );
      await page.goto("/check");
      const endpoint = page.getByLabel("Endpoint or Agent ID");
      await endpoint.fill("https://api.usepreflight.xyz/api/v1/verify-release");
      await expect(endpoint).toHaveValue("https://api.usepreflight.xyz/api/v1/verify-release");
      await page.getByRole("button", { name: "Discover" }).click();
      await expect(page.getByRole("heading", { name: "Proposed manifest" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `tests/shots/check-discovered-${size.name}.png`, fullPage: true });
    });
  });
}
