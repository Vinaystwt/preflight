import { test, expect } from "@playwright/test";

test("cli page shows the command immediately and reveals output on run", async ({ page }) => {
  await page.goto("/cli");
  await expect(page.getByRole("heading", { name: "Run PreFlight anywhere releases happen." })).toBeVisible();
  await expect(page.getByText("preflight verify https://api.quote.example/mcp").first()).toBeVisible();
  await expect(page.getByText(/BLOCK\s+1 mandatory criterion/)).toHaveCount(0);
  await page.getByRole("button", { name: "Run example" }).first().click();
  await expect(page.getByText(/BLOCK\s+1 mandatory criterion/)).toBeVisible();
  await expect(page.getByText("exit code 1")).toBeVisible();
});

test("cli page exit codes and receipt verify sections render", async ({ page }) => {
  await page.goto("/cli");
  await expect(page.getByText("RELEASE", { exact: true })).toBeVisible();
  await expect(page.getByText("INFRASTRUCTURE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run example" }).nth(1).click();
  await expect(page.getByText("receipt is authentic")).toBeVisible();
});
