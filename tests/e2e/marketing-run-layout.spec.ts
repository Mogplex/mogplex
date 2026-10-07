import { expect, test } from "@playwright/test";
import { textContrast } from "./helpers/text-contrast";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 768, 390, 320]) {
    test(`run explanation stays readable and navigable in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme
      );
      await page.goto("/how-it-works");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));

      // Compare painted frame pixels with the uncovered header segment. DOM
      // visibility alone misses an opaque content surface covering the frame.
      const guide = await page.locator(".run-guide").boundingBox();
      for (const side of ["left", "right"]) {
        const frame = await page.locator(`.mpx-frame.is-${side}`).boundingBox();
        const pixel = (x: number, y: number) =>
          page.screenshot({ clip: { x, y, width: 1, height: 1 } });
        const reference = await pixel(frame!.x, 32);
        const besideFrame = await pixel(frame!.x - 2, 32);
        expect(reference.equals(besideFrame)).toBe(false);
        expect(
          (await pixel(frame!.x, guide!.y + 32)).equals(reference),
          `${side} frame stays painted beside the reading surface`
        ).toBe(true);
      }

      const stages = page.locator(".stage");
      await expect(stages).toHaveCount(6);
      for (const stage of await stages.all()) {
        const heading = await stage.locator("h2").boundingBox();
        const description = await stage.locator(".stage-desc").boundingBox();
        expect(heading).not.toBeNull();
        expect(description).not.toBeNull();
        expect(Math.abs(heading!.x - description!.x)).toBeLessThanOrEqual(1);
        expect(description!.y).toBeGreaterThanOrEqual(
          heading!.y + heading!.height
        );
        for (const copy of await stage
          .locator(".stage-desc, .stage-fact")
          .all()) {
          expect(await textContrast(copy)).toBeGreaterThanOrEqual(4.5);
        }
      }

      const overview = page.getByRole("navigation", { name: "Run overview" });
      const links = overview.getByRole("link");
      await expect(links).toHaveCount(6);
      await links.first().hover();
      await links.first().evaluate(async (link) => {
        await Promise.all(
          link.getAnimations().map((animation) => animation.finished)
        );
      });
      const surfaces = await links.first().evaluate((link) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        return [link.closest(".run-guide")!, link].map((element) => {
          context.clearRect(0, 0, 1, 1);
          const ancestors: Element[] = [];
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          )
            ancestors.unshift(node);
          for (const node of ancestors) {
            context.fillStyle = getComputedStyle(node).backgroundColor;
            context.fillRect(0, 0, 1, 1);
          }
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        });
      });
      expect(surfaces[1]).not.toEqual(surfaces[0]);
      // Keyboard users can jump from the overview to every stage. The target
      // scroll margin should leave clear space above its visible heading.
      for (const link of await links.all()) {
        const href = await link.getAttribute("href");
        expect(href).toMatch(/^#run-/);
        await link.focus();
        await link.press("Enter");
        const heading = page.locator(`${href} h2`);
        await expect(heading).toBeInViewport();
        expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(72);
      }

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width);
      await page.goto("/how-it-works");
      await page.screenshot({ path: testInfo.outputPath("run-overview.png") });
    });
  }
}

test("solid homepage dark sections remain distinct from the page", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const colors = await page.locator(".mpx-harnesses").evaluate((section) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    return [section.closest(".mpx-landing")!, section].map((element) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
  });
  expect(colors[1][3]).toBe(255);
  expect(colors[1][0] - colors[0][0]).toBeGreaterThanOrEqual(8);
  for (const copy of await page
    .locator(
      ".mpx-harnesses .mpx-eyebrow, .mpx-harness-lede, .mpx-harness-tabs button[aria-selected='false'], .mpx-code-panel header > span, .mpx-code-panel .t-root, .mpx-harness-id p, .mpx-harness-desc"
    )
    .all()) {
    expect(
      await textContrast(copy),
      (await copy.textContent()) ?? undefined
    ).toBeGreaterThanOrEqual(4.5);
  }
  const tab = page.getByRole("tab", { name: "Claude Code", exact: true });
  const restingColor = await tab.evaluate(
    (element) => getComputedStyle(element).color
  );
  await tab.hover();
  await tab.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished)
    );
  });
  expect(
    await tab.evaluate((element) => getComputedStyle(element).color)
  ).not.toBe(restingColor);
});
