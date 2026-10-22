import {
  expect,
  fulfillJson,
  mockTeamSettings,
  TEAM,
  TEAM_SETTINGS_PATH,
  test,
} from "./helpers/run-checks-fixtures";
import type { Locator } from "@playwright/test";

async function switchAppearance(control: Locator) {
  return control.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
      );
    };
    const contrast = (first: string, second: string) => {
      const a = luminance(first);
      const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const style = getComputedStyle(element);
    const thumb = element.querySelector('[data-slot="switch-thumb"]')!;
    return {
      border: style.borderColor,
      outlineContrast: contrast(
        style.borderColor,
        getComputedStyle(document.body).backgroundColor
      ),
      textContrast: contrast(style.color, style.backgroundColor),
      thumbX: thumb.getBoundingClientRect().x,
      right: element.getBoundingClientRect().right,
    };
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} switches have a visible track, state text, and keyboard feedback`, async ({
    page,
  }) => {
    await mockTeamSettings(page);
    await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
      fulfillJson(route, { default_model: null, theme })
    );
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme
    );
    let enabled = false;
    await page.route(`**/api/teams/${TEAM.id}/signup-domain`, (route) => {
      if (route.request().method() === "PATCH") {
        enabled = route.request().postDataJSON().enabled;
      }
      return fulfillJson(route, {
        enabled,
        domain: "example.com",
        eligibleDomain: "example.com",
        viewer: { canManage: true },
      });
    });
    await page.goto(`${TEAM_SETTINGS_PATH}/members`);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const control = page.getByRole("switch", {
      name: "Allow people from @example.com to join",
    });
    await expect(control).toBeEnabled();
    const off = await switchAppearance(control);
    expect(off.border).not.toBe("rgba(0, 0, 0, 0)");
    expect(off.outlineContrast).toBeGreaterThanOrEqual(3);
    expect(off.textContrast).toBeGreaterThanOrEqual(4.5);
    await expect(control.getByText("Off", { exact: true })).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    await page.keyboard.press("Space");
    await expect(control).toBeChecked();
    await expect(control.getByText("On", { exact: true })).toBeVisible();
    await expect(control.getByText("Off", { exact: true })).toBeHidden();
    const on = await switchAppearance(control);
    expect(on.thumbX).toBeGreaterThan(off.thumbX + 10);
    expect(on.outlineContrast).toBeGreaterThanOrEqual(3);
    expect(on.textContrast).toBeGreaterThanOrEqual(4.5);
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await switchAppearance(control)).right).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: test.info().outputPath(`${theme}-switches.png`),
    });
  });
}
