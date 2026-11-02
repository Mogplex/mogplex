import { expect, test } from "@playwright/test";
import { loadStatusToastFixture } from "./helpers/status-toast-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`status cards in ${theme} have real tints, readable icons, and visible controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStatusToastFixture(page, theme);
    await page
      .getByRole("button", { name: "Show statuses", exact: true })
      .click();
    await expect(page.locator("[data-variant]")).toHaveCount(4);
    const icons: string[] = [];
    for (const variant of ["success", "info", "warning", "destructive"]) {
      const toast = page.locator(`[data-variant="${variant}"]`);
      await expect(toast).toHaveCSS("opacity", "1");
      const measured = await toast.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const rgb = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = "#000000";
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const luminance = (channels: number[]) =>
          channels
            .slice(0, 3)
            .map((value) => {
              const c = value / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (total, value, index) =>
                total + value * [0.2126, 0.7152, 0.0722][index],
              0
            );
        const background = rgb(getComputedStyle(element).backgroundColor);
        const contrast = (node: Element) => {
          const color = rgb(getComputedStyle(node).color);
          const alpha = color[3] / 255;
          const painted = color.map(
            (channel, index) =>
              channel * alpha + background[index] * (1 - alpha)
          );
          const values = [luminance(painted), luminance(background)].sort(
            (a, b) => a - b
          );
          return (values[1] + 0.05) / (values[0] + 0.05);
        };
        const icon = element.querySelector("svg")!;
        const title = element.querySelector('[data-slot="toast-title"]')!;
        const close = element.querySelector(
          'button[aria-label="Dismiss notification"]'
        )!;
        const description = element.querySelector(
          '[data-slot="toast-description"]'
        )!;
        const neutral = document.createElement("span");
        neutral.hidden = true;
        neutral.style.backgroundColor = "var(--popover)";
        document.body.append(neutral);
        const popover = rgb(getComputedStyle(neutral).backgroundColor);
        neutral.remove();
        return {
          background,
          popover,
          icon: contrast(icon),
          title: contrast(title),
          close: contrast(close),
          description: contrast(description),
          closeOpacity: getComputedStyle(close).opacity,
          iconMarkup: Array.from(icon.querySelectorAll("path"), (path) =>
            path.getAttribute("d")
          ).join("|"),
        };
      });
      expect(measured.background).not.toEqual(measured.popover);
      expect(measured.icon).toBeGreaterThanOrEqual(3);
      expect(measured.title).toBeGreaterThanOrEqual(4.5);
      expect(measured.close).toBeGreaterThanOrEqual(3);
      expect(measured.description).toBeGreaterThanOrEqual(4.5);
      expect(measured.closeOpacity).toBe("1");
      icons.push(measured.iconMarkup);
    }
    expect(new Set(icons).size).toBe(4);
    await page
      .locator("ol")
      .screenshot({ path: `/tmp/mogplex-711-toasts-${theme}.png` });
  });
}

test("routine warnings announce politely while failures interrupt", async ({
  page,
}) => {
  await loadStatusToastFixture(page, "light");
  await page
    .getByRole("button", { name: "Show statuses", exact: true })
    .click();
  await expect(
    page
      .locator('[role="status"][aria-live="polite"]')
      .filter({ hasText: "Checks need attention" })
  ).toHaveCount(1);
  await expect(
    page
      .locator('[role="status"][aria-live="assertive"]')
      .filter({ hasText: "Build failed" })
  ).toHaveCount(1);
});

test("notifications keep steering and stop controls available and can be dismissed individually", async ({
  page,
}) => {
  await loadStatusToastFixture(page, "dark");
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/__e2e/notify", async (route) => {
    await ready;
    await route.fulfill({ json: { ok: true } });
  });
  await page
    .getByRole("button", { name: "Simulate background completion" })
    .click();
  const composer = page.getByRole("textbox", { name: "Steer agent" });
  await composer.fill("Keep the changes focused.");
  release();
  await expect(page.locator("[data-variant=success]")).toContainText(
    "Background task finished"
  );
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("Keep the changes focused.");
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
  await expect(page.getByTestId("stop-count")).toHaveText("1");
  await page
    .getByRole("button", { name: "Show statuses", exact: true })
    .click();
  await expect(page.locator("[data-variant]")).toHaveCount(5);
  await page
    .locator("[data-variant=destructive]")
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await expect(page.locator("[data-variant=destructive]")).toHaveCount(0);
  await expect(page.locator("[data-variant=warning]")).toBeVisible();
  await page
    .getByRole("button", { name: "Show statuses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show statuses", exact: true })
    .click();
  await expect(page.locator("[data-variant]")).toHaveCount(12);
  expect(
    await page
      .locator("ol")
      .evaluate((viewport) => viewport.scrollHeight > viewport.clientHeight)
  ).toBe(true);
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
  await expect(page.getByTestId("stop-count")).toHaveText("2");
});

test("toast actions and keyboard dismissal work on mobile with reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadStatusToastFixture(page, "light");
  await page.getByRole("button", { name: "Show action", exact: true }).click();
  const toast = page.locator("[data-variant=info]");
  await expect(toast).toHaveCSS("animation-name", "none");
  const close = toast.getByRole("button", { name: "Dismiss notification" });
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  const actionBox = await toast
    .getByRole("button", { name: "Undo", exact: true })
    .boundingBox();
  expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  expect(actionBox?.width).toBeGreaterThanOrEqual(44);
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("undo-count")).toHaveText("1");
  await expect(page.getByTestId("closed-count")).toHaveText("1");
  await expect(toast).toHaveCount(0);
  await page.getByRole("button", { name: "Show action", exact: true }).click();
  await toast.getByRole("button", { name: "Dismiss notification" }).focus();
  await page.keyboard.press("Enter");
  await expect(toast).toHaveCount(0);
  await expect(page.getByTestId("closed-count")).toHaveText("2");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ).toBe(false);
  await page
    .getByRole("button", { name: "Show statuses", exact: true })
    .click();
  await page.screenshot({ path: "/tmp/mogplex-711-toasts-mobile.png" });
});

test("hover pauses expiry until the user leaves the notification", async ({
  page,
}) => {
  await loadStatusToastFixture(page, "dark");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Show brief toast", exact: true })
    .click();
  const toast = page.locator("[data-variant=success]");
  await toast.hover();
  await page.clock.fastForward(3000);
  await expect(toast).toBeVisible();
  await page.mouse.move(1, 1);
  await page.clock.fastForward(1001);
  await expect(toast).toHaveCount(0);
});

test("keyboard focus pauses expiry while a notification is being read", async ({
  page,
}) => {
  await loadStatusToastFixture(page, "dark");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Show brief toast", exact: true })
    .click();
  const toast = page.locator("[data-variant=success]");
  await toast.getByRole("button", { name: "Dismiss notification" }).focus();
  await page.clock.fastForward(3000);
  await expect(toast).toBeVisible();
  await page.getByRole("textbox", { name: "Steer agent" }).focus();
  await page.clock.fastForward(1001);
  await expect(toast).toHaveCount(0);
});

test.describe("touch notifications", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("mobile stacks support vertical touch scrolling and horizontal swipe dismissal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStatusToastFixture(page, "light");
    await page.getByRole("button", { name: "Show burst", exact: true }).click();
    await expect(page.locator("[data-variant]")).toHaveCount(12);
    const first = page.locator("[data-variant]").first();
    await expect(first).toHaveCSS("touch-action", "pan-y");
    await expect(first).toHaveCSS("opacity", "1");
    const viewport = page.locator("ol");
    const bounds = await viewport.boundingBox();
    expect(bounds).not.toBeNull();
    const scrollCard = await page
      .locator("[data-variant]")
      .nth(2)
      .boundingBox();
    expect(scrollCard).not.toBeNull();
    const client = await page.context().newCDPSession(page);
    await client.send("Input.synthesizeScrollGesture", {
      x: Math.round(bounds!.x + bounds!.width / 2),
      y: Math.round(scrollCard!.y + scrollCard!.height / 2),
      yDistance: -120,
      gestureSourceType: "touch",
    });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press("F8");
    await page.keyboard.press("Home");
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBe(0);
    const toast = await first.boundingBox();
    expect(toast).not.toBeNull();
    const start = {
      x: Math.round(toast!.x + 48),
      y: Math.round(toast!.y + 28),
    };
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (const distance of [40, 90, 160, 210]) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x + distance, y: start.y }],
      });
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator("[data-variant]")).toHaveCount(11);
    await page.getByRole("button", { name: "Stop agent", exact: true }).click();
    await expect(page.getByTestId("stop-count")).toHaveText("1");
    await client.detach();
  });
});
