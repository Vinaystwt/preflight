import { test, expect } from "@playwright/test";
import { fulfillReport } from "./report-fulfill";
function noise(e: string) {
  return /Access-Control-Allow-Origin|access control checks|Fetch API cannot load|CORS|Failed to fetch|NetworkError|Failed to load resource|_vercel\/insights|favicon/i.test(e);
}
const ROUTES = ["/", "/check", "/how-it-works", "/pricing", "/demo", "/docs", "/legal/privacy"];
for (const route of ROUTES) {
  test(`console ${route}`, async ({ page }) => {
    const errs: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e)));
    await page.goto(route);
    await page.waitForTimeout(600);
    const real = errs.filter((e) => !noise(e));
    expect(real, real.join("\n")).toEqual([]);
  });
}
test("console /report", async ({ page }) => {
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e)));
  await fulfillReport(page, "release");
  await page.goto("/report/x#access_token=verificationtokenverificationtoken1234");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForTimeout(400);
  const real = errs.filter((e) => !noise(e));
  expect(real, real.join("\n")).toEqual([]);
});
