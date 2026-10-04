import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`homepage AI Gateway branding in ${theme} mode at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme
      );
      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));

      const vault = page.locator(".mpx-vault");
      await vault.scrollIntoViewIfNeeded();
      await expect(vault.locator(".mpx-vault-provider")).toHaveText([
        "Anthropic",
        "OpenAI",
        "AI Gateway",
      ]);
      const gateway = vault.locator("p").filter({ hasText: "AI Gateway" });
      await expect(gateway).toBeVisible();
      await expect(gateway.locator("b")).toHaveText("AVAILABLE");
      const logo = gateway.locator("svg");
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute("aria-hidden", "true");
      await expect(logo).toHaveAttribute("fill", "currentColor");
      await expect(page.locator("main")).not.toContainText(/openrouter/i);
      await expect(page.locator('a[href*="openrouter"]')).toHaveCount(0);

      const rowBox = await gateway.boundingBox();
      const labelBox = await gateway.locator("span").boundingBox();
      const statusBox = await gateway.locator("b").boundingBox();
      expect(rowBox).not.toBeNull();
      expect(labelBox).not.toBeNull();
      expect(statusBox).not.toBeNull();
      expect(rowBox!.x).toBeGreaterThanOrEqual(0);
      expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(width);
      expect(labelBox!.x + labelBox!.width).toBeLessThan(statusBox!.x);
    });
  }
}
