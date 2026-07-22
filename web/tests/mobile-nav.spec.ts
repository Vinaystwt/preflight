import { test, expect, type Page } from "@playwright/test";

async function openDrawer(page: Page) {
  const trigger = page.getByRole("button", { name: "Open menu" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  if (!(await dialog.isVisible().catch(() => false))) await trigger.click();
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

test.describe("mobile nav drawer", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger visible on mobile, hidden on desktop", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });

  test("drawer opens with all sections and links", async ({ page }) => {
    await page.goto("/");
    const { dialog } = await openDrawer(page);
    await expect(dialog.getByRole("button", { name: "Close menu" })).toBeVisible();

    for (const label of ["Run a check", "How it works", "Pricing", "Demo"]) {
      await expect(dialog.getByRole("link", { name: label })).toBeVisible();
    }
    for (const label of ["Cohort", "Verify a receipt", "Benchmark", "Gallery"]) {
      await expect(dialog.getByRole("link", { name: label })).toBeVisible();
    }
    for (const label of ["Docs", "CLI", "verify_release API", "MCP server"]) {
      await expect(dialog.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("Escape key closes drawer and returns focus to trigger", async ({ page }) => {
    await page.goto("/");
    const { trigger, dialog } = await openDrawer(page);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("close button closes drawer and returns focus to trigger", async ({ page }) => {
    await page.goto("/");
    const { trigger, dialog } = await openDrawer(page);

    await dialog.getByRole("button", { name: "Close menu" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("backdrop click closes drawer", async ({ page }) => {
    await page.goto("/");
    const { dialog } = await openDrawer(page);

    await page.locator("#mobile-nav-panel").evaluate((el) => {
      const backdrop = el.previousElementSibling as HTMLElement;
      backdrop?.click();
    });
    await expect(dialog).not.toBeVisible();
  });

  test("navigation link closes drawer and navigates", async ({ page }) => {
    await page.goto("/");
    const { dialog } = await openDrawer(page);
    await dialog.getByRole("link", { name: "Pricing" }).click();
    await page.waitForURL("**/pricing");
    await expect(dialog).not.toBeVisible();
  });

  test("current page indicated with aria-current", async ({ page }) => {
    await page.goto("/pricing");
    const { dialog } = await openDrawer(page);
    await expect(dialog.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
  });

  test("body scroll locked when drawer open", async ({ page }) => {
    await page.goto("/");
    await openDrawer(page);
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("hidden");

    await page.keyboard.press("Escape");
    const overflowAfter = await page.evaluate(() => document.body.style.overflow);
    expect(overflowAfter).toBe("");
  });

  test("drawer has aria-modal and role=dialog", async ({ page }) => {
    await page.goto("/");
    await openDrawer(page);
    const panel = page.locator("#mobile-nav-panel");
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(panel).toHaveAttribute("aria-label", "Navigation");
  });
});

test.describe("mobile nav hidden on desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("hamburger not visible on desktop", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open menu" })).not.toBeVisible();
  });
});
