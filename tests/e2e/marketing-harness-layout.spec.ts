import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1920, 1440, 768, 390, 320]) {
    test(`harness surface follows the card container in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme
      );
      await page.goto("/#harnesses");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));

      const surface = page.locator(".mpx-harness-inner");
      const neighbor = page.locator(".mpx-enterprise-card");
      const bounds = (await surface.boundingBox())!;
      const reference = (await neighbor.boundingBox())!;
      expect(Math.abs(bounds.x - reference.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.width - reference.width)).toBeLessThanOrEqual(1);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.x + bounds.width).toBeLessThan(width);

      for (const corner of [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]) {
        const property = `border-${corner}-radius`;
        const radius = await surface.evaluate(
          (element, key) => getComputedStyle(element).getPropertyValue(key),
          property
        );
        expect(parseFloat(radius)).toBeGreaterThan(0);
        expect(radius).toBe(
          await neighbor.evaluate(
            (element, key) => getComputedStyle(element).getPropertyValue(key),
            property
          )
        );
      }
      await expect(page.locator(".mpx-harnesses")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)"
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath("harness-container.png"),
      });
      for (const tab of await page.getByRole("tab").all()) {
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        const panel = page.getByRole("tabpanel");
        await expect(panel).toBeVisible();
        expect(
          await panel.evaluate(
            (element) => element.scrollWidth - element.clientWidth
          ),
          "panel content fits without being clipped at the card edge"
        ).toBeLessThanOrEqual(1);
      }
    });
  }
}
