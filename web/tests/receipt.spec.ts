import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fulfillReport } from "./report-fulfill";

const pubkeys = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "pubkeys.json"), "utf8"));
const TOKEN = "#access_token=verificationtokenverificationtoken1234";

test("receipt verifies with real Ed25519", async ({ page }) => {
  await fulfillReport(page, "release");
  await page.route("**/api/v1/pubkeys", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(pubkeys) }),
  );
  await page.goto(`/report/pfr_x${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Signed receipt" })).toBeVisible();
  await page.getByRole("button", { name: "Verify receipt" }).click();
  // real client-side Ed25519 + hash checks resolve
  await expect(page.getByText("Signature valid")).toBeVisible();
  await expect(page.getByText("Payload hash matches")).toBeVisible();
  await expect(page.getByText(/Verified in your browser against PreFlight/)).toBeVisible();
});

test("badge embed copies a snippet", async ({ page }) => {
  await fulfillReport(page, "release");
  await page.goto(`/report/pfr_x${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Live badge" })).toBeVisible();
  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.getByText(/<img src=/)).toBeVisible();
});
