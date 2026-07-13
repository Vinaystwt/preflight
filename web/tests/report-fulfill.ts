import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Fixture = "release" | "block" | "unknown";

export function loadFixture(name: Fixture) {
  return JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", `report-${name}.json`), "utf8"));
}

export async function fulfillReport(page: Page, name: Fixture) {
  const body = loadFixture(name);
  await page.route("**/api/v1/reports/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  return body;
}

export async function fulfillReportError(page: Page, opts: { status: number; code: string; category: string }) {
  await page.route("**/api/v1/reports/**", async (route) => {
    await route.fulfill({
      status: opts.status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ error: { code: opts.code, message: "unavailable", category: opts.category, request_id: "req-demo" } }),
    });
  });
}
