import { expect, type Locator, type Page } from "@playwright/test";

export async function expectFullRouteWidth(page: Page, content: Locator) {
  const available = await page
    .locator(".app-shell-content")
    .evaluate((element) => ({
      left: element.getBoundingClientRect().left + element.clientLeft,
      width: element.clientWidth,
      overflow: element.scrollWidth - element.clientWidth,
    }));
  const bounds = (await content.boundingBox())!;
  const gutter = page.viewportSize()!.width >= 768 ? 24 : 12;
  expect(Math.abs(bounds.x - available.left - gutter)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      bounds.x + bounds.width - (available.left + available.width - gutter)
    )
  ).toBeLessThanOrEqual(1);
  expect(
    available.overflow,
    "route does not scroll horizontally"
  ).toBeLessThanOrEqual(1);
}
