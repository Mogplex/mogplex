import { expect, test } from "@playwright/test";
import {
  openAgentInspector,
  setupWorkflowsPage,
} from "./helpers/flows-inspector-layout-fixtures";

/**
 * Wide enough that the flows container clears the 1080px dock threshold once
 * the app shell sidebar (~300px) is subtracted.
 */
const DOCKED_VIEWPORT = { width: 1600, height: 900 };

/** Bottom edges of the canvas toolbar and the docked panel header. */
async function headerEdges(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const toolbar = document
      .querySelector('[data-testid="flow-view-tabs"]')
      ?.closest("div.border-b") as HTMLElement | null;
    const panelHeader = document.querySelector<HTMLElement>(
      ".flows-inspector .flows-panel-header"
    );
    const sheet = document.querySelector<HTMLElement>(
      '[data-testid="flows-right-sheet"]'
    );
    const shell = document.querySelector<HTMLElement>(
      ".flows-inspector .flows-panel-shell"
    );
    if (!toolbar || !panelHeader || !sheet || !shell) return null;
    const sheetStyle = getComputedStyle(sheet);
    return {
      toolbarBottom: toolbar.getBoundingClientRect().bottom,
      panelHeaderBottom: panelHeader.getBoundingClientRect().bottom,
      // Content box, i.e. past the aside's own left divider border.
      sheetContentLeft: sheet.getBoundingClientRect().left + sheet.clientLeft,
      shellLeft: shell.getBoundingClientRect().left,
      shellRight: shell.getBoundingClientRect().right,
      sheetRight: sheet.getBoundingClientRect().right,
      sheetPadding: [
        sheetStyle.paddingTop,
        sheetStyle.paddingRight,
        sheetStyle.paddingBottom,
        sheetStyle.paddingLeft,
      ].join(" "),
      shellRadius: getComputedStyle(shell).borderTopLeftRadius,
    };
  });
}

test("docked panel header sits flush and lines up with the canvas toolbar", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize(DOCKED_VIEWPORT);
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  // Empty state: the panel is the column, so it carries no gutter and no
  // rounding, and its header border continues the toolbar's border.
  const empty = await headerEdges(page);
  expect(empty).not.toBeNull();
  expect(empty!.panelHeaderBottom).toBeCloseTo(empty!.toolbarBottom, 0);
  expect(empty!.sheetPadding).toBe("0px 0px 0px 0px");
  expect(empty!.shellRadius).toBe("0px");
  expect(empty!.shellLeft).toBeCloseTo(empty!.sheetContentLeft, 0);
  expect(empty!.shellRight).toBeCloseTo(empty!.sheetRight, 0);

  // Selected node: a different header, same alignment.
  await page.locator('.react-flow__node[data-id="agent-1"]').click();
  await expect(page.getByTestId("flows-inspector-header")).toBeVisible();
  const selected = await headerEdges(page);
  expect(selected).not.toBeNull();
  expect(selected!.panelHeaderBottom).toBeCloseTo(selected!.toolbarBottom, 0);

  // Assistant panel: same shell, same alignment.
  await page.getByTestId("flow-assistant-toggle").click();
  await expect(page.getByTestId("flow-assistant-panel")).toBeVisible();
  const assistant = await headerEdges(page);
  expect(assistant).not.toBeNull();
  expect(assistant!.panelHeaderBottom).toBeCloseTo(assistant!.toolbarBottom, 0);
});

test("docked panel resizes by drag and keyboard, and remembers its width", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize(DOCKED_VIEWPORT);
  await openAgentInspector(page);

  const sheet = page.getByTestId("flows-right-sheet");
  const grip = page.getByTestId("flows-panel-resizer");
  await expect(grip).toBeVisible();

  const startWidth = (await sheet.boundingBox())!.width;
  const gripBox = (await grip.boundingBox())!;
  const gripX = gripBox.x + gripBox.width / 2;
  const gripY = gripBox.y + gripBox.height / 2;

  // Dragging left widens the panel, since it is anchored to the right edge.
  await page.mouse.move(gripX, gripY);
  await page.mouse.down();
  await page.mouse.move(gripX - 60, gripY, { steps: 4 });
  await page.mouse.move(gripX - 140, gripY, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => (await sheet.boundingBox())!.width)
    .toBeCloseTo(startWidth + 140, 0);

  // The drag cursor lock is released rather than stranded on the body.
  expect(await page.evaluate(() => document.body.className)).not.toContain(
    "flows-panel-resizing"
  );

  // The header must still line up after the column changes width.
  const afterDrag = await headerEdges(page);
  expect(afterDrag!.panelHeaderBottom).toBeCloseTo(afterDrag!.toolbarBottom, 0);

  // Keyboard nudges the same separator.
  const draggedWidth = (await sheet.boundingBox())!.width;
  await grip.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await sheet.boundingBox())!.width)
    .toBeLessThan(draggedWidth);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await sheet.boundingBox())!.width)
    .toBeCloseTo(draggedWidth, 0);

  // The width survives a reload.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect
    .poll(async () => (await sheet.boundingBox())!.width)
    .toBeCloseTo(draggedWidth, 0);
});

test("panel resize refuses to squeeze the canvas out of the pane", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize(DOCKED_VIEWPORT);
  await openAgentInspector(page);

  const sheet = page.getByTestId("flows-right-sheet");
  const grip = page.getByTestId("flows-panel-resizer");
  const gripBox = (await grip.boundingBox())!;
  const gripY = gripBox.y + gripBox.height / 2;

  // Drag far past the left edge of the pane.
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripY);
  await page.mouse.down();
  await page.mouse.move(0, gripY, { steps: 8 });
  await page.mouse.up();

  const canvasWidth = (await page.locator(".react-flow").boundingBox())!.width;
  const panelWidth = (await sheet.boundingBox())!.width;
  expect(canvasWidth).toBeGreaterThanOrEqual(360);
  expect(panelWidth).toBeLessThanOrEqual(720);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("workflows editor fits every width from tablet up without page scroll", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  // 768px used to overflow because the pane carried a hard 760px min-width on
  // top of the app shell sidebar, and the toolbar keyed off the viewport rather
  // than the column it actually lives in.
  for (const width of [1600, 1440, 1280, 1024, 900, 768, 640]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      publishVisible: Boolean(
        document.querySelector('[data-testid="flow-publish-button"]')
      ),
    }));
    expect(
      metrics.scroll,
      `horizontal overflow at ${width}px`
    ).toBeLessThanOrEqual(metrics.client);
    expect(metrics.publishVisible, `publish missing at ${width}px`).toBe(true);
  }
});
