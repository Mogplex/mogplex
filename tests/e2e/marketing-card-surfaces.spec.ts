import { expect, test } from "@playwright/test";
import { textContrast } from "./helpers/text-contrast";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`marketing feature cards use readable ${theme} surfaces at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme
      );
      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      const isolationCard = page.locator("#capabilities .mpx-cap.is-zdr");
      await isolationCard.scrollIntoViewIfNeeded();
      await isolationCard.screenshot({
        path: testInfo.outputPath("isolation-card.png"),
      });

      const cards = page.locator(".mpx-cap.is-zdr");
      expect(await cards.count()).toBeGreaterThan(0);
      for (const card of await cards.all()) {
        const background = await card.evaluate((element) => {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
        });
        if (theme === "light")
          expect(Math.min(...background)).toBeGreaterThan(200);
        else expect(Math.max(...background)).toBeLessThan(80);

        for (const text of await card
          .locator(
            "h3, .mpx-cap-kicker, .mpx-cap-description, .mpx-default-pill, .mpx-zdr-flow small, .mpx-zdr-flow b, .mpx-zdr-flow span"
          )
          .all()) {
          expect(
            await textContrast(text),
            (await text.textContent()) ?? undefined
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
}
