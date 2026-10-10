import { expect, test } from "@playwright/test";

test("visible headline rises without jumping down after its entrance delay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const position = await page
    .locator(".mpx-hero h1")
    .evaluate(async (heading) => {
      await document.fonts.ready;
      const animation = heading.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const before = heading.getBoundingClientRect().y;
      animation.currentTime = (animation.effect!.getTiming().delay ?? 0) + 1;
      return {
        before,
        after: heading.getBoundingClientRect().y,
        opacity: getComputedStyle(heading).opacity,
      };
    });
  expect(position.opacity).toBe("1");
  expect(position.after).toBeLessThanOrEqual(position.before + 0.1);
});

test("hero reserves its responsive geometry before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/");
  const frame = await page.locator(".mpx-run-scale-wrap").boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.height).toBeCloseTo((frame!.width * 660) / 920, 0);
  await expect(page.getByTestId("landing-primary-cta")).toBeVisible();
  await context.close();
});

test("hero pauses offscreen and resumes its animation on return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const hero = page.locator(".mpx-run-ui");
  await expect(hero).toHaveAttribute("data-phase", "1");
  await page.locator(".mpx-footer").scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-paused", "true");
  const paused = await hero.getAttribute("data-phase");
  // Advance the browser animation clock through the next phase boundary.
  await page.evaluate(async () => {
    await document.body.animate([], { duration: 5500 }).finished;
  });
  await expect(hero).toHaveAttribute("data-phase", paused!);
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-paused", "false");
  await expect(hero).toHaveAttribute("data-phase", /^[2-8]$/);
  await page.getByRole("button", { name: "LOGS", exact: true }).click();
  await expect(page.locator(".mpx-terminal-body")).toContainText("[INFO]");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(hero).toHaveAttribute("data-phase", "8");
  await expect(page.locator(".mpx-agent-node.is-deploy time")).toHaveText(
    "22s"
  );
});

test("progress fills using a compositor transform", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const fill = page.locator(".mpx-progress.is-running i");
  await expect(fill).toBeVisible();
  const frames = await fill.evaluate((element) =>
    (element.getAnimations()[0].effect as KeyframeEffect).getKeyframes()
  );
  expect(frames.some((frame) => "width" in frame)).toBe(false);
  expect(frames.some((frame) => "transform" in frame)).toBe(true);
});
