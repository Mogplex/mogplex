import { expect, test } from "@playwright/test";
import {
  LONG_MODEL_ID,
  setupWorkflowsPage,
  openAgentInspector,
  findOverlappingCells,
  gridTrackCounts,
  parseCssAlpha,
} from "./helpers/flows-inspector-layout-fixtures";

test("inspector leads with the model selector", async ({ page }) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize({ width: 2048, height: 1152 });
  await openAgentInspector(page);

  const modelBox = await page
    .getByLabel("Model", { exact: true })
    .boundingBox();
  const harnessBox = await page
    .getByRole("radiogroup", { name: "Harness" })
    .boundingBox();
  const taskBox = await page.getByLabel("Agent task").boundingBox();
  const promptBox = await page
    .getByLabel("System prompt override")
    .boundingBox();

  expect(modelBox).not.toBeNull();
  expect(harnessBox).not.toBeNull();
  expect(taskBox).not.toBeNull();
  expect(promptBox).not.toBeNull();
  expect(modelBox!.y).toBeLessThan(harnessBox!.y);
  expect(modelBox!.y).toBeLessThan(taskBox!.y);
  expect(modelBox!.y).toBeLessThan(promptBox!.y);
});

test("inspector grids never overlap their own cells", async ({ page }) => {
  await setupWorkflowsPage(page);

  // Docked (wide viewport, narrow panel) is where the viewport-based breakpoint
  // used to force two columns into a ~300px panel.
  await page.setViewportSize({ width: 2048, height: 1152 });
  await openAgentInspector(page);
  const sheet = page.getByTestId("flows-right-sheet");
  await expect(sheet).toContainText(LONG_MODEL_ID);
  expect(await findOverlappingCells(sheet)).toEqual([]);
  const dockedWidth = (await sheet.boundingBox())!.width;

  // Overlay mode, where the panel is wide enough for two columns. Wait for the
  // panel to actually widen rather than for a fixed delay -- the resize lands
  // via a ResizeObserver, so any timeout is a guess.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect
    .poll(async () => (await sheet.boundingBox())!.width)
    .toBeGreaterThan(dockedWidth);
  expect(await findOverlappingCells(sheet)).toEqual([]);

  const overflowing = await sheet.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
      (el) => el.getBoundingClientRect().right > bounds.right + 1
    ).length;
  });
  expect(overflowing).toBe(0);
});

test("inspector grids size to the panel, not the viewport", async ({
  page,
}) => {
  await setupWorkflowsPage(page);

  // The bug this pins: a viewport breakpoint (`sm:`) forced two columns into the
  // ~300px docked panel on a wide screen. `min-w-0` + `break-words` stop the
  // cells from visibly intersecting, so the overlap test alone cannot catch a
  // regression here -- assert the resolved column count instead.
  await page.setViewportSize({ width: 2048, height: 1152 });
  await openAgentInspector(page);
  const sheet = page.getByTestId("flows-right-sheet");
  await expect(sheet).toContainText(LONG_MODEL_ID);

  const docked = await gridTrackCounts(sheet);
  expect(docked.length).toBeGreaterThan(0);
  expect(docked.filter((grid) => grid.tracks > 1)).toEqual([]);

  // The same grids do take two columns once the panel itself is wide enough,
  // which is what proves they are reading the container and not just never
  // matching the breakpoint.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect
    .poll(async () => (await gridTrackCounts(sheet)).some((g) => g.tracks > 1))
    .toBe(true);
});

test("inspector header stays put while the body scrolls under it", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize({ width: 2048, height: 1152 });
  await openAgentInspector(page);

  const close = page.getByTestId("flows-inspector-close");
  const scroller = page.getByTestId("flows-inspector-scroll");
  const headerBefore = await close.boundingBox();

  // Scroll to the end rather than a fixed 400px, which would fail for the
  // unrelated reason of the inspector's content getting shorter.
  const scrolled = await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return { top: el.scrollTop, overflow: el.scrollHeight - el.clientHeight };
  });
  expect(scrolled.overflow).toBeGreaterThan(0);
  expect(scrolled.top).toBeGreaterThan(0);

  // The header does not move, and nothing scrolls into view above it.
  await expect
    .poll(async () => (await close.boundingBox())!.y)
    .toBeCloseTo(headerBefore!.y, 0);

  // The scroll viewport starts below the header, so scrolled content is clipped
  // instead of sliding through it, and the header is fully opaque.
  const chrome = await page.evaluate(() => {
    const el = (testId: string) =>
      document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const scrollBody = el("flows-inspector-scroll");
    const head = el("flows-inspector-header");
    if (!scrollBody || !head) return null;
    return {
      headerBottom: head.getBoundingClientRect().bottom,
      scrollerTop: scrollBody.getBoundingClientRect().top,
      headerBackground: getComputedStyle(head).backgroundColor,
      scrollerOverflowY: getComputedStyle(scrollBody).overflowY,
    };
  });
  expect(chrome).not.toBeNull();
  expect(chrome!.headerBottom).toBeLessThanOrEqual(chrome!.scrollerTop + 1);
  expect(chrome!.scrollerOverflowY).toBe("auto");
  // A translucent header would let scrolled content show through it. Read the
  // alpha channel directly instead of pattern-matching the colour syntax.
  expect(parseCssAlpha(chrome!.headerBackground)).toBe(1);
});

test("inspector empty state stays reachable on a short viewport", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  // Short enough that the icon, copy and node/connection counts cannot all fit.
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold.
  await page.setViewportSize({ width: 1600, height: 380 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const inspector = page.locator(".flows-inspector");
  await expect(inspector).toContainText("Select a node");

  const reach = await inspector.evaluate((root) => {
    const card = root.querySelector<HTMLElement>(
      '[data-testid="flows-inspector-empty"]'
    );
    const body = root.querySelector<HTMLElement>(
      '[data-testid="flows-inspector-empty-body"]'
    );
    if (!body || !card) return null;
    body.scrollTop = 0;
    return {
      // The card must not overflow itself. It has no scroller of its own and
      // sits inside an overflow-hidden aside, so anything past its client box
      // is clipped with no way back to it.
      cardOverflow: card.scrollHeight - card.clientHeight,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      firstChildTop: body.firstElementChild!.getBoundingClientRect().top,
      bodyTop: body.getBoundingClientRect().top,
    };
  });

  expect(reach).not.toBeNull();
  expect(reach!.cardOverflow).toBeLessThanOrEqual(1);
  // The overflow has to land on a real scroller rather than just disappearing.
  expect(reach!.bodyScrolls).toBe(true);
  // Scrolled to the very top, nothing may sit above the container's top edge --
  // centred overflow makes the start of the content permanently unreachable.
  expect(reach!.firstChildTop).toBeGreaterThanOrEqual(reach!.bodyTop - 1);
});

test("inspector empty panel minimizes and restores", async ({ page }) => {
  await setupWorkflowsPage(page);
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold where minimize/expand controls appear.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const inspector = page.locator(".flows-inspector");
  await expect(inspector).toContainText("Workflow configuration");

  await page.getByRole("button", { name: "Minimize inspector" }).click();
  await expect(inspector).toBeHidden();

  await page.getByRole("button", { name: "Expand inspector" }).click();
  await expect(inspector).toContainText("Workflow configuration");

  // Selecting a node still opens the full inspector while minimized.
  await page.getByRole("button", { name: "Minimize inspector" }).click();
  await expect(inspector).toBeHidden();
  await page.locator('.react-flow__node[data-id="agent-1"]').click();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
});
