import { test } from "@playwright/test";

// Full-page home at three breakpoints. Reduced motion renders the hero poster
// frame (the BLOCK moment), which is stable for a full-page capture.
for (const size of [
  { name: "1440", width: 1440, height: 1000 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
]) {
  test(`home ${size.name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/shots/home-${size.name}.png`, fullPage: true });
  });
}

// Hero frame sequence at 1440 with motion ON — capture the instrument at several
// times to show LISTING -> payment -> BLOCK -> fix -> RELEASE.
test("hero frame sequence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=1");
  const hero = page.locator("section").first();
  await hero.waitFor();
  const marks = [1000, 5000, 9000, 13000, 17000, 20000];
  let i = 0;
  for (const m of marks) {
    await page.waitForTimeout(i === 0 ? m : m - marks[i - 1]);
    await hero.screenshot({ path: `tests/shots/hero-${String(i + 1).padStart(2, "0")}.png` });
    i++;
  }
});
