import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fulfillReport } from "./report-fulfill";

const ROUTES = ["/", "/check", "/how-it-works", "/pricing", "/demo", "/docs", "/gallery", "/cli", "/verify", "/cohort", "/benchmark", "/asp/2013", "/legal/privacy", "/legal/terms", "/nope-404"];

async function scan(page: import("@playwright/test").Page, exclude: string[] = []) {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  for (const sel of exclude) b = b.exclude(sel);
  const r = await b.analyze();
  return r.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

for (const route of ROUTES) {
  test(`axe ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(1200);
    const exclude = route === "/demo" || route === "/" ? [".readout-value"] : [];
    const c = await scan(page, exclude);
    expect(c, c.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`).join("\n")).toEqual([]);
  });
}

test("axe /report (BLOCK)", async ({ page }) => {
  await fulfillReport(page, "block");
  await page.goto("/report/x#access_token=verificationtokenverificationtoken1234");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const c = await scan(page);
  expect(c, c.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`).join("\n")).toEqual([]);
});
