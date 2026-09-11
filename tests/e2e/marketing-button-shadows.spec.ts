import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`marketing buttons stay shadow-free in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme
      );

      for (const path of ["/", "/pricing", "/how-it-works"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        const rejectCookies = page.getByRole("button", {
          name: "Reject All",
          exact: true,
        });
        if (await rejectCookies.isVisible()) await rejectCookies.click();
        const buttons = page.locator(".mpx-button:visible");
        await expect(buttons.first()).toBeVisible();
        expect(await buttons.count()).toBeGreaterThan(1);
        await page.screenshot({
          path: testInfo.outputPath(
            `${path.replaceAll("/", "") || "home"}.png`
          ),
        });
        for (const button of await buttons.all()) {
          await expect(button).toHaveCSS("box-shadow", "none");
        }

        // Exercise each shared button variant, including the enterprise override.
        if (path === "/") {
          for (const selector of [
            ".mpx-nav > .mpx-button.is-primary",
            ".mpx-nav > .mpx-button.is-secondary",
            "[data-testid='landing-primary-cta']",
            ".mpx-enterprise-actions .mpx-button.is-primary",
          ]) {
            const button = page.locator(selector);
            if (!(await button.isVisible())) continue;
            await page.keyboard.press("Tab");
            await button.focus();
            await expect(button).toBeFocused();
            await expect(button).toHaveCSS("box-shadow", "none");
            await expect(button).toHaveCSS("outline-style", "solid");
            await expect(button).toHaveCSS("outline-width", "2px");

            await button.hover();
            await expect(button).toHaveCSS("box-shadow", "none");
            await page.mouse.down();
            try {
              expect(
                await button.evaluate((element) => element.matches(":active"))
              ).toBe(true);
              await expect(button).toHaveCSS("box-shadow", "none");
            } finally {
              // Release outside the link so the pressed-state check does not navigate.
              await page.mouse.move(0, 0);
              await page.mouse.up();
            }
          }
        }
      }
    });
  }
}
