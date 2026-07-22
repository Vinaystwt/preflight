import { test, expect } from "@playwright/test";
for (const size of [{n:"1440",w:1440,h:1000},{n:"375",w:375,h:812}]) {
  test.describe(`pages ${size.n}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });
    for (const [route,name] of [["/","home"],["/check","check-idle"],["/how-it-works","how"],["/pricing","pricing"],["/docs","docs"],["/demo","demo"],["/gallery","gallery"],["/cli","cli"],["/verify","verify"],["/cohort","cohort"],["/benchmark","benchmark"],["/asp/2013","asp-2013"],["/legal/privacy","privacy"]] as const) {
      test(name, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(route);
        await expect(page.getByRole("heading").first()).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `tests/shots/${name}-${size.n}.png`, fullPage: true });
      });
    }
  });
}
