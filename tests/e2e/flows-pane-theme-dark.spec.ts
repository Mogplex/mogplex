import { expect, test } from "@playwright/test";
import {
  setupWorkflowsPage,
  flowPayload,
  fulfillJson,
  getCanvasScale,
  normalizeCssColors,
} from "./helpers/flows-pane-theme-fixtures";

test("workflows pane keeps canvas chrome and native controls in dark mode", async ({
  page,
}, testInfo) => {
  await setupWorkflowsPage(page, "dark");

  await page.setViewportSize({ width: 2048, height: 1152 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await expect(page.locator(".react-flow.dark")).toBeVisible();
  await expect(
    page.locator(".react-flow__controls-button").first()
  ).toBeVisible();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.getByTestId("flow-node-library")).toBeVisible();
  await expect(page.getByTestId("flow-library-current-trigger")).toBeVisible();
  await expect(page.getByTestId("flow-library-add-agent")).toBeVisible();
  await expect(page.getByTestId("flow-library-icon-mogplex")).toBeVisible();
  await expect(page.getByTestId("flow-execution-log")).toBeVisible();
  await expect(page.locator(".flows-inspector")).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText("Select a node");
  await page.locator(".react-flow__viewport").waitFor({ state: "attached" });
  await expect.poll(() => getCanvasScale(page)).toBeLessThanOrEqual(1);
  const canvasBox = await page.locator(".react-flow").boundingBox();
  const viewTabsBox = await page.getByTestId("flow-view-tabs").boundingBox();
  const insertToolbarBox = await page
    .getByTestId("flow-insert-toolbar")
    .boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(viewTabsBox).not.toBeNull();
  expect(insertToolbarBox).not.toBeNull();
  expect(viewTabsBox!.y + viewTabsBox!.height).toBeLessThanOrEqual(
    canvasBox!.y
  );
  expect(insertToolbarBox!.y - canvasBox!.y).toBeLessThanOrEqual(16);

  const controlsButtonBg = await page
    .locator(".react-flow__controls-button")
    .first()
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const miniMapBg = await page
    .locator(".react-flow__minimap")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const canvasThemeColors = await page
    .locator(".flows-canvas")
    .evaluate((node) => {
      const styles = getComputedStyle(node);
      return {
        canvasBackground: styles
          .getPropertyValue("--xy-background-color")
          .trim(),
        themeBackground: styles.getPropertyValue("--background").trim(),
      };
    });
  const canvasBackgroundLayers = await page
    .locator(".flows-canvas")
    .evaluate((node) => {
      const background = node.querySelector(".react-flow__background");
      const dots = node.querySelector(".react-flow__background-pattern.dots");
      const vignette = node.querySelector(
        '[data-testid="flow-canvas-vignette"]'
      );
      const viewport = node.querySelector(".react-flow__viewport");

      if (!background || !dots || !vignette || !viewport) {
        throw new Error("Flow canvas background layers are incomplete");
      }

      const backgroundStyles = getComputedStyle(background);
      const vignetteStyles = getComputedStyle(vignette);
      const viewportStyles = getComputedStyle(viewport);

      return {
        backgroundColor: backgroundStyles.backgroundColor,
        backgroundZIndex: Number(backgroundStyles.zIndex),
        dotsClass: dots.getAttribute("class") ?? "",
        dotFill: getComputedStyle(dots).fill,
        vignetteBackground: vignetteStyles.backgroundImage,
        vignettePointerEvents: vignetteStyles.pointerEvents,
        vignetteZIndex: Number(vignetteStyles.zIndex),
        viewportZIndex: Number(viewportStyles.zIndex),
      };
    });
  const nodeCardBackgrounds = await page
    .locator(".flows-node-card")
    .evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundColor)
    );
  const nodeTypeClasses = await page
    .locator(".flows-node-card")
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          Array.from(node.classList).find((className) =>
            className.startsWith("flows-node-type-")
          ) ?? ""
      )
    );

  expect(controlsButtonBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(miniMapBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(canvasThemeColors.canvasBackground).toBe(
    canvasThemeColors.themeBackground
  );
  const [expectedDarkBackground, actualDarkBackground, expectedDarkCard] =
    await normalizeCssColors(page, [
      "#040503",
      canvasBackgroundLayers.backgroundColor,
      "#080907",
    ]);
  expect(actualDarkBackground).toBe(expectedDarkBackground);
  expect(canvasBackgroundLayers.dotsClass).toContain("dots");
  const [actualDotFill, expectedDotFill] = await normalizeCssColors(page, [
    canvasBackgroundLayers.dotFill,
    "oklch(98.84% 0.006 95 / 12%)",
  ]);
  expect(actualDotFill).toBe(expectedDotFill);
  expect(canvasBackgroundLayers.vignetteBackground).toContain(
    "radial-gradient"
  );
  expect(canvasBackgroundLayers.vignettePointerEvents).toBe("none");
  expect(canvasBackgroundLayers.backgroundZIndex).toBeLessThan(
    canvasBackgroundLayers.vignetteZIndex
  );
  expect(canvasBackgroundLayers.vignetteZIndex).toBeLessThan(
    canvasBackgroundLayers.viewportZIndex
  );
  expect(nodeCardBackgrounds.length).toBeGreaterThan(0);
  const normalizedDarkNodeCards = await normalizeCssColors(
    page,
    nodeCardBackgrounds
  );
  expect(
    normalizedDarkNodeCards.every(
      (background) => background === expectedDarkCard
    )
  ).toBe(true);
  expect(nodeTypeClasses.every(Boolean)).toBe(true);
  expect(
    nodeTypeClasses.every(
      (className) => !/(success|warn|danger|error)/.test(className)
    )
  ).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath("flows-pane-dark-theme.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1180, height: 720 });
  await expect(page.getByTestId("flow-name-input-desktop")).not.toBeVisible();
  await expect(page.getByTestId("flow-name-input-compact")).toBeVisible();
  await page.getByTestId("flow-name-input-compact").fill("Laptop rename");
  await expect(page.getByTestId("flow-name-input-compact")).toHaveValue(
    "Laptop rename"
  );

  await page.setViewportSize({ width: 390, height: 720 });
  await expect(page.getByTestId("flow-name-input-compact")).toBeVisible();
  const scrollMetrics = await page.locator(".flows-pane").evaluate((pane) => {
    const scrollContainer = pane.parentElement?.parentElement;
    return {
      clientWidth: scrollContainer?.clientWidth ?? 0,
      scrollWidth: scrollContainer?.scrollWidth ?? 0,
    };
  });
  const railBox = await page
    .locator(".flows-pane-grid > aside:not(.flows-inspector)")
    .boundingBox();
  const gridBox = await page.locator(".flows-pane-grid").boundingBox();
  const compactRenameBox = await page
    .getByTestId("flow-name-input-compact")
    .boundingBox();
  const publishButtonBox = await page
    .getByTestId("flow-publish-button")
    .boundingBox();
  expect(railBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  expect(compactRenameBox).not.toBeNull();
  expect(publishButtonBox).not.toBeNull();
  const railRight = railBox!.x + railBox!.width;

  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
  expect(gridBox!.width).toBeGreaterThanOrEqual(760);
  expect(compactRenameBox!.x).toBeGreaterThanOrEqual(railRight);
  expect(compactRenameBox!.width).toBeGreaterThan(120);
  expect(publishButtonBox!.x).toBeGreaterThanOrEqual(railRight);

  // Navigate to /workflows through the test scope — the page where the tablet overflow was reported —
  // and verify the top-bar no longer causes page-level horizontal scroll at 768px.
  await page.setViewportSize({ width: 768, height: 720 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  const tabletPageMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(tabletPageMetrics.scrollWidth).toBeLessThanOrEqual(
    tabletPageMetrics.clientWidth
  );
  const tabletTabsBox = await page.getByTestId("flow-view-tabs").boundingBox();
  const tabletActionsBox = await page
    .getByTestId("flow-header-actions")
    .boundingBox();
  const tabletCanvasBox = await page.locator(".react-flow").boundingBox();
  expect(tabletTabsBox).not.toBeNull();
  expect(tabletActionsBox).not.toBeNull();
  expect(tabletCanvasBox).not.toBeNull();
  expect(tabletTabsBox!.y).toBeGreaterThanOrEqual(
    tabletActionsBox!.y + tabletActionsBox!.height
  );
  expect(tabletTabsBox!.y + tabletTabsBox!.height).toBeLessThanOrEqual(
    tabletCanvasBox!.y
  );

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const expandSidebarButton = page.getByRole("button", {
    name: "Expand sidebar",
  });
  const expandSidebarBox = await expandSidebarButton.boundingBox();
  const saveStatusBox = await page
    .getByTestId("flow-save-status")
    .boundingBox();
  expect(expandSidebarBox).not.toBeNull();
  expect(saveStatusBox).not.toBeNull();
  expect(expandSidebarBox!.x + expandSidebarBox!.width).toBeLessThanOrEqual(
    saveStatusBox!.x
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId("flow-name-input-desktop")).toBeVisible();

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "NEXTJS-REVIEWER" })
    .click();
  await expect(page.locator(".flows-inspector")).toBeVisible();
  await expect(page.getByText("Effective config")).toBeVisible();
  const notesBg = await page
    .getByPlaceholder("Capture intent, guardrails, and context for this flow.")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(notesBg).not.toBe("rgb(255, 255, 255)");

  // Empty state styling is verified by inspector-layout tests; this theme test
  // focuses on dark-mode node/canvas chrome which is already covered above.
});

test("persisted workflow nodes stay visible when the assistant sheet opens", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");

  const persistedFlowPayload = {
    ...flowPayload,
    name: "Persisted branch flow",
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: -1_344, y: -442 },
          data: { label: "@mogplex", event: "mention" },
        },
        {
          id: "agent-1",
          type: "agent",
          position: { x: -980, y: -327 },
          data: { label: "Primary reviewer", agentId: "agent-1" },
        },
        {
          id: "retry-agent",
          type: "agent",
          position: { x: -537, y: 112 },
          data: { label: "Retry reviewer", agentId: "agent-1" },
        },
        {
          id: "end",
          type: "end",
          position: { x: -103, y: -317 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-1", source: "start", target: "agent-1" },
        { id: "edge-2", source: "agent-1", target: "end" },
        {
          id: "edge-3",
          source: "agent-1",
          target: "retry-agent",
          sourceHandle: "error",
        },
        { id: "edge-4", source: "retry-agent", target: "end" },
      ],
      viewport: { x: 1_087, y: 502, zoom: 0.73 },
    },
  };

  await page.unroute("**/api/flows");
  await page.unroute("**/api/flows/flow-1");
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [persistedFlowPayload])
  );
  await page.route("**/api/flows/flow-1", (route) =>
    fulfillJson(route, persistedFlowPayload)
  );

  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("flow-assistant-toggle").click();
  await expect(page.getByTestId("flow-assistant-panel")).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".react-flow").evaluate((canvas) => {
        const canvasRect = canvas.getBoundingClientRect();
        const nodeRects = Array.from(
          canvas.querySelectorAll(".react-flow__node")
        ).map((node) => node.getBoundingClientRect());
        return (
          nodeRects.length === 4 &&
          nodeRects.every(
            (node) =>
              node.left >= canvasRect.left &&
              node.top >= canvasRect.top &&
              node.right <= canvasRect.right &&
              node.bottom <= canvasRect.bottom
          )
        );
      })
    )
    .toBe(true);
});

test("workflow assistant opens in the right sheet without covering the canvas", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 2048, height: 1152 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("flow-assistant-toggle").click();

  const canvas = page.locator(".react-flow");
  const rightSheet = page.locator(".flows-inspector");
  const assistant = page.getByTestId("flow-assistant-panel");

  await expect(assistant).toBeVisible();
  await expect(rightSheet).toContainText("Flow assistant");
  await expect
    .poll(() =>
      assistant.evaluate((node) => Boolean(node.closest(".flows-inspector")))
    )
    .toBe(true);

  const canvasBox = await canvas.boundingBox();
  const sheetBox = await rightSheet.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.x).toBeGreaterThanOrEqual(
    canvasBox!.x + canvasBox!.width - 1
  );

  await page.setViewportSize({ width: 900, height: 720 });
  const compactSheetBox = await rightSheet.boundingBox();
  expect(compactSheetBox).not.toBeNull();
  expect(
    await rightSheet.evaluate((node) => getComputedStyle(node).position)
  ).toBe("fixed");
  expect(
    Math.abs(compactSheetBox!.x + compactSheetBox!.width - 900)
  ).toBeLessThanOrEqual(1);
});

test("agent harness choices stack vertically with visible labels and the Mogplex mark", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "NEXTJS-REVIEWER" })
    .click();

  const harnessGroup = page.getByRole("radiogroup", { name: "Harness" });
  const mogplexHarness = harnessGroup.getByRole("radio", { name: "Mogplex" });

  await expect(harnessGroup).toBeVisible();
  await expect(
    mogplexHarness.getByTestId("flow-harness-icon-mogplex")
  ).toBeVisible();

  const harnesses = [
    { slug: "mogplex", name: "Mogplex" },
    { slug: "claude-code", name: "Claude Code" },
    { slug: "codex", name: "Codex" },
  ] as const;

  for (const harness of harnesses) {
    const label = page.getByTestId(`flow-harness-label-${harness.slug}`);
    const description = page.getByTestId(
      `flow-harness-description-${harness.slug}`
    );

    await expect(label).toBeVisible();
    await expect(description).toBeVisible();
    expect(
      await label.evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true);
    expect(
      await description.evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true);
  }

  const harnessBoxes = await Promise.all(
    harnesses.map(async (harness) => {
      const cardBox = await harnessGroup
        .getByRole("radio", { name: harness.name })
        .boundingBox();
      expect(cardBox).not.toBeNull();
      return cardBox!;
    })
  );

  expect(harnessBoxes[1].y).toBeGreaterThanOrEqual(
    harnessBoxes[0].y + harnessBoxes[0].height
  );
  expect(harnessBoxes[2].y).toBeGreaterThanOrEqual(
    harnessBoxes[1].y + harnessBoxes[1].height
  );
  expect(
    harnessBoxes.every(
      (box) =>
        Math.abs(box.x - harnessBoxes[0].x) <= 1 &&
        Math.abs(box.width - harnessBoxes[0].width) <= 1
    )
  ).toBe(true);
});
