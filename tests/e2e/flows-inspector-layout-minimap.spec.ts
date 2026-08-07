import { expect, test } from "@playwright/test";
import { setupWorkflowsPage } from "./helpers/flows-inspector-layout-fixtures";

test("canvas minimap scales with the viewport", async ({ page }) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const minimap = page.locator(".react-flow__minimap");
  await expect(minimap).toBeVisible();
  const tall = await minimap.boundingBox();
  expect(tall).not.toBeNull();

  await page.setViewportSize({ width: 1600, height: 520 });
  await expect
    .poll(async () => (await minimap.boundingBox())!.height)
    .toBeLessThan(tall!.height);
  const short = await minimap.boundingBox();
  expect(short).not.toBeNull();

  // It stays inside the canvas rather than hanging off the bottom.
  const canvas = await page.locator(".flows-canvas").boundingBox();
  expect(short!.y + short!.height).toBeLessThanOrEqual(
    canvas!.y + canvas!.height + 1
  );
});

test("minimap pan scale matches its rendered size", async ({ page }) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".react-flow__minimap")).toBeVisible();

  // React Flow builds the pannable drag scale from the width/height it was
  // given, not from the measured box. If CSS resizes the svg behind its back,
  // dragging the minimap moves the canvas by the wrong factor.
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1600, height: 560 },
  ]) {
    await page.setViewportSize(size);
    // Retry the comparison instead of sleeping: React Flow re-measures through a
    // ResizeObserver, so the attribute and the box settle a frame apart.
    await expect(async () => {
      const svg = await page
        .locator(".react-flow__minimap-svg")
        .evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return {
            attrWidth: Number(el.getAttribute("width")),
            attrHeight: Number(el.getAttribute("height")),
            renderedWidth: rect.width,
            renderedHeight: rect.height,
          };
        });
      expect(svg.renderedWidth).toBeCloseTo(svg.attrWidth, 0);
      expect(svg.renderedHeight).toBeCloseTo(svg.attrHeight, 0);
    }).toPass();
  }
});
