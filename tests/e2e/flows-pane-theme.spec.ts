import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import { selectAppOption } from "./helpers/app-select";
import type { Page, Route } from "@playwright/test";

const connectedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function getCanvasScale(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((viewport) => {
    const transform = getComputedStyle(viewport).transform;
    if (transform === "none") return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
}

async function normalizeCssColors(page: Page, colors: string[]) {
  return page.evaluate((values) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context unavailable");

    return values.map((value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).join(",");
    });
  }, colors);
}

const flowPayload = {
  id: "flow-1",
  installation_id: 101,
  name: "NEXTJS-REVIEWER · PR opened",
  description: "Migrated from Trigger",
  notes: "Capture intent, guardrails, and context for this flow.",
  source_kind: "github",
  status: "active",
  last_run_status: "success",
  published_version_id: "version-1",
  published_version: {
    id: "version-1",
    flow_id: "flow-1",
    version_number: 1,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 120, y: 160 },
          data: { label: "PR opened", event: "pr_opened" },
        },
        {
          id: "agent-1",
          type: "agent",
          position: { x: 380, y: 160 },
          data: { label: "NEXTJS-REVIEWER", agentId: "agent-1" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 660, y: 160 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-1", source: "start", target: "agent-1" },
        { id: "edge-2", source: "agent-1", target: "end" },
      ],
    },
    created_at: "2026-03-28T17:00:00.000Z",
  },
  draft_graph: {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 120, y: 160 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "agent-1",
        type: "agent",
        position: { x: 380, y: 160 },
        data: { label: "NEXTJS-REVIEWER", agentId: "agent-1" },
      },
      {
        id: "end",
        type: "end",
        position: { x: 660, y: 160 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "edge-1", source: "start", target: "agent-1" },
      { id: "edge-2", source: "agent-1", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

const flowRun = {
  id: "run-1",
  assignment_id: null,
  trigger_id: null,
  flow_id: "flow-1",
  flow_version_id: "version-1",
  runtime_provider: null,
  runtime_run_id: null,
  workflow_run_id: null,
  retry_of_job_run_id: null,
  status: "success",
  created_at: "2026-03-28T17:05:00.000Z",
  started_at: "2026-03-28T17:05:10.000Z",
  completed_at: "2026-03-28T17:06:00.000Z",
  input_tokens: 1200,
  output_tokens: 400,
  cost_usd: 0.02,
  duration_ms: 50000,
  error: null,
  start_attempts: 1,
  metadata: null,
  source_kind: "github",
  source_type: "pr_opened",
  repo: { id: "repo-1", full_name: "webrenew/blackbox" },
  agent: { id: "agent-1", name: "NEXTJS-REVIEWER", slug: "nextjs-reviewer" },
  latest_ai_call: null,
  latest_dispatch_event: null,
  repairable: false,
  requeueable: false,
  cancelable: false,
  node_runs: [],
};

const flowRunDetail = {
  ...flowRun,
  dispatch_events: [],
  ai_calls: [],
  review_findings: [],
};

async function setupWorkflowsPage(page: Page, theme: "light" | "dark") {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": "alex",
    "x-mogplex-scope-id": connectedUser.id,
  });
  await page.addInitScript((storedTheme) => {
    window.localStorage.setItem("theme", storedTheme);
    // Ensure the inspector and sidebar start expanded (not collapsed) in dock mode.
    window.localStorage.removeItem("flows-inspector-minimized");
    window.localStorage.removeItem("flows-sidebar-collapsed");
  }, theme);

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme })
  );
  await page.route("**/api/automations/harnesses**", (route) =>
    fulfillJson(route, {
      harnesses: {
        mogplex: {
          available: true,
          billingSource: "mogplex",
          reason: null,
        },
        "claude-code": {
          available: true,
          billingSource: "direct_provider",
          reason: null,
        },
        codex: {
          available: true,
          billingSource: "direct_provider",
          reason: null,
        },
      },
    })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
        },
      ],
      catalog: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_enabled: true,
        },
      ],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "agent-1",
        name: "NEXTJS-REVIEWER",
        slug: "nextjs-reviewer",
        model: "minimax/minimax-m2.5",
      },
    ])
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        repositories: [{ id: "repo-1", full_name: "webrenew/blackbox" }],
      },
    ])
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [flowPayload])
  );
  await page.route("**/api/flows/flow-1", (route) =>
    fulfillJson(route, flowPayload)
  );
  // `?` and `*` are glob wildcards in Playwright URL patterns, so regexes keep
  // the list and detail routes from shadowing each other.
  await page.route(/\/api\/flows\/flow-1\/runs\?/, (route) =>
    fulfillJson(route, { runs: [flowRun] })
  );
  await page.route(/\/api\/flows\/flow-1\/runs\/run-1$/, (route) =>
    fulfillJson(route, { run: flowRunDetail })
  );
}

test("app sidebar owns primary navigation and supports drag and keyboard resize", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "light");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toBeVisible();
  for (const destination of [
    "control",
    "workspaces",
    "automations",
    "delivery",
    "observe",
    "settings",
  ]) {
    await expect(page.getByTestId(`app-nav-${destination}`)).toBeVisible();
  }
  // /workflows is a legacy subpath of the Automations nav item.
  await expect(page.getByTestId("app-nav-automations")).toHaveAttribute(
    "aria-current",
    "page"
  );

  const initialBox = await sidebar.boundingBox();
  expect(initialBox).not.toBeNull();
  expect(initialBox!.width).toBeGreaterThan(120);
  await expect(page.getByTestId("app-sidebar-toggle")).toHaveCount(0);

  const resizer = page.getByTestId("app-sidebar-resizer");
  await expect(resizer).toBeVisible();
  const widthBeforeKeyboardResize = (await sidebar.boundingBox())!.width;
  await resizer.press("ArrowRight");
  const widthAfterKeyboardResize = (await sidebar.boundingBox())!.width;
  expect(widthAfterKeyboardResize).toBe(widthBeforeKeyboardResize + 8);

  const resizerBox = await resizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  await page.mouse.move(
    resizerBox!.x + resizerBox!.width / 2,
    resizerBox!.y + 80
  );
  await page.mouse.down();
  await page.mouse.move(56, resizerBox!.y + 80, { steps: 8 });
  await page.mouse.up();
  const widthAfterDrag = (await sidebar.boundingBox())!.width;
  expect(widthAfterDrag).toBe(56);
  await expect(sidebar).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("app-nav-automations")).toHaveAttribute(
    "aria-label",
    "Automations"
  );
  for (const compactLabel of [
    ".app-sidebar-title",
    ".app-sidebar-section-label",
    ".app-sidebar-link-label",
    ".app-sidebar-footer-label",
  ]) {
    await expect(sidebar.locator(compactLabel)).toHaveCount(0);
  }
  const compactSidebarBox = await sidebar.boundingBox();
  const compactLogoBox = await sidebar
    .locator(".app-sidebar-logo")
    .boundingBox();
  expect(compactSidebarBox).not.toBeNull();
  expect(compactLogoBox).not.toBeNull();
  expect(compactLogoBox!.x + compactLogoBox!.width).toBeLessThanOrEqual(
    compactSidebarBox!.x + compactSidebarBox!.width
  );
});

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
      "#0b0c0b",
      canvasBackgroundLayers.backgroundColor,
      "#111210",
    ]);
  expect(actualDarkBackground).toBe(expectedDarkBackground);
  expect(canvasBackgroundLayers.dotsClass).toContain("dots");
  expect(canvasBackgroundLayers.dotFill).toBe("rgba(255, 255, 255, 0.2)");
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

test("node library filters and inserts real workflow nodes", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const initialNodeCount = await page.locator(".react-flow__node").count();
  const nodeSearch = page.getByPlaceholder("Search nodes…");
  await nodeSearch.fill("await");

  await expect(page.getByTestId("flow-library-add-await_event")).toBeVisible();
  await expect(page.getByTestId("flow-library-add-agent")).not.toBeVisible();
  await page.getByTestId("flow-library-add-await_event").click();

  await expect(page.locator(".react-flow__node")).toHaveCount(
    initialNodeCount + 1
  );
  await expect(page.locator(".flows-inspector")).toContainText(
    "Await event operator"
  );
  const waitKind = page.getByLabel("Wait kind");
  await waitKind.click();
  await expect(page.getByRole("option")).toHaveText([
    "GitHub label added",
    "GitHub comment added",
    "GitHub Actions / CI completed",
    "Vercel preview ready",
    "Manual approval",
  ]);
  await page
    .locator('[role="option"][data-value="github_label_added"]')
    .click();
  await selectAppOption(waitKind, "github_comment_added");
  await expect(page.getByTestId("flow-await-comment-contains")).toBeVisible();
  await expect(page.getByTestId("flow-await-comment-author")).toBeVisible();
  await expect(
    page.getByText("Match the issue or pull request that started this run")
  ).toBeVisible();
  await selectAppOption(waitKind, "manual_approval");
  await expect(
    page.getByPlaceholder("e.g. Approve production deployment")
  ).toBeVisible();
});

test("action search exposes sandbox, Slack thread, and GitHub outcome inspectors", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const nodeSearch = page.getByPlaceholder("Search nodes…");
  await nodeSearch.fill("sandbox");
  const runCommand = page.getByTestId(
    "flow-library-add-action-sandbox-run-command"
  );
  await expect(runCommand).toBeVisible();
  await expect(
    page.getByTestId("flow-library-add-action-slack-send-message")
  ).not.toBeVisible();
  await runCommand.click();

  await expect(page.getByTestId("flow-action-operation")).toHaveAttribute(
    "data-value",
    "sandbox.run_command"
  );
  await page.getByTestId("flow-action-command").fill("pnpm lint");
  await page.getByTestId("flow-action-working-directory").fill("apps/web");
  await expect(page.locator(".flows-inspector")).toContainText(
    "reuse that workflow workspace"
  );

  await nodeSearch.fill("slack");
  await page.getByTestId("flow-library-add-action-slack-send-message").click();
  await expect(page.getByTestId("flow-action-operation")).toHaveAttribute(
    "data-value",
    "slack.send_message"
  );
  await expect(page.locator(".flows-inspector")).toContainText(
    "Connect Slack before publishing"
  );
  await expect(page.getByTestId("flow-action-slack-workspace")).toBeVisible();
  await expect(page.getByTestId("flow-action-slack-channel")).toBeDisabled();
  await expect(page.getByTestId("flow-action-slack-message")).toBeVisible();
  await selectAppOption(
    page.getByTestId("flow-action-slack-destination"),
    "trigger_thread"
  );
  await expect(
    page.getByTestId("flow-action-slack-workspace")
  ).not.toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "replies in the thread that started the workflow"
  );

  await nodeSearch.fill("github comment");
  await page.getByTestId("flow-library-add-action-github-post-comment").click();
  const operation = page.getByTestId("flow-action-operation");
  await expect(operation).toHaveAttribute("data-value", "github.post_comment");
  await expect(
    page.getByTestId("flow-action-github-target-number")
  ).toBeVisible();
  await expect(page.getByTestId("flow-action-github-comment")).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "limited to the workflow repository"
  );

  await selectAppOption(operation, "github.create_issue");
  await expect(
    page.getByTestId("flow-action-github-issue-title")
  ).toBeVisible();
  await expect(
    page.getByTestId("flow-action-github-issue-labels")
  ).toBeVisible();

  await selectAppOption(operation, "github.update_labels");
  await expect(page.getByTestId("flow-action-github-add-labels")).toBeVisible();
  await expect(
    page.getByTestId("flow-action-github-remove-labels")
  ).toBeVisible();

  await selectAppOption(operation, "github.set_status");
  await expect(
    page.getByTestId("flow-action-github-status-state")
  ).toHaveAttribute("data-value", "success");
  await expect(
    page.getByTestId("flow-action-github-status-context")
  ).toHaveValue("mogplex/workflow");

  await selectAppOption(operation, "github.submit_review");
  await expect(
    page.getByTestId("flow-action-github-review-event")
  ).toHaveAttribute("data-value", "COMMENT");
  await expect(
    page.getByTestId("flow-action-github-review-body")
  ).toBeVisible();

  await selectAppOption(operation, "github.merge_pull_request");
  await expect(
    page.getByTestId("flow-action-github-merge-target")
  ).toBeVisible();
  await expect(
    page.getByTestId("flow-action-github-merge-title")
  ).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "branch protection"
  );
});

test("Slack action selector loads channels beyond the first page", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.unroute("**/api/integrations/slack/installations");
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, {
      installations: [{ teamId: "T1", teamName: "Mogplex" }],
    })
  );
  await page.route(
    /\/api\/integrations\/slack\/installations\/T1\/channels(?:\?.*)?$/,
    (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      return fulfillJson(
        route,
        cursor === "page-2"
          ? {
              channels: [{ id: "C201", name: "release-ops", isPrivate: false }],
              nextCursor: null,
            }
          : {
              channels: [{ id: "C001", name: "engineering", isPrivate: false }],
              nextCursor: "page-2",
            }
      );
    }
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Search nodes…").fill("slack");
  await page.getByTestId("flow-library-add-action-slack-send-message").click();
  await selectAppOption(page.getByTestId("flow-action-slack-workspace"), "T1");

  const channelSelect = page.getByTestId("flow-action-slack-channel");
  await channelSelect.click();
  await expect(page.locator('[role="option"][data-value="C001"]')).toHaveCount(
    1
  );
  await expect(page.locator('[role="option"][data-value="C201"]')).toHaveCount(
    0
  );
  await page.locator('[role="option"][data-value="C001"]').click();

  await page.getByTestId("flow-action-slack-load-more").click();
  await channelSelect.click();
  await expect(page.locator('[role="option"][data-value="C201"]')).toHaveCount(
    1
  );
  await page.locator('[role="option"][data-value="C201"]').click();
  await expect(
    page.getByTestId("flow-action-slack-load-more")
  ).not.toBeVisible();
});

test("trigger presets configure GitHub, schedules, signed webhooks, and Dependabot reviews", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.route("**/api/flows/flow-1/webhook-secret", (route) =>
    fulfillJson(route, { secret: "whsec_test_generated_once" })
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("flow-trigger-preset-github").click();
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "pr_opened"
  );
  await expect(page.getByTestId("flow-trigger-repository-scope")).toContainText(
    "All repositories"
  );
  await expect(page.locator(".react-flow__node-start")).toContainText("GitHub");

  await page.getByTestId("flow-trigger-preset-schedule").click();
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "schedule"
  );
  await expect(page.getByTestId("flow-trigger-schedule-cron")).toHaveValue(
    "0 9 * * 1-5"
  );
  await expect(page.getByTestId("flow-trigger-schedule-timezone")).toHaveValue(
    "UTC"
  );
  await expect(page.getByTestId("flow-trigger-test-payload")).toContainText(
    '"timezone": "UTC"'
  );
  await expect(page.getByTestId("flow-trigger-test")).toBeDisabled();

  await selectAppOption(page.getByTestId("flow-trigger-event"), "webhook");
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "webhook"
  );
  await expect(page.getByTestId("flow-trigger-repository")).toHaveAttribute(
    "data-value",
    ""
  );
  await selectAppOption(
    page.getByTestId("flow-trigger-repository"),
    "webrenew/blackbox"
  );
  await expect(page.getByTestId("flow-trigger-repository")).toHaveAttribute(
    "data-value",
    "webrenew/blackbox"
  );
  await expect(page.getByTestId("flow-trigger-test-payload")).toHaveValue(
    /"prompt":/
  );
  await page.getByTestId("flow-trigger-test-payload").fill("{");
  await expect(
    page.getByTestId("flow-trigger-test-payload-error")
  ).toContainText("valid JSON");
  await page
    .getByTestId("flow-trigger-test-payload")
    .fill('{\n  "prompt": "Summarize release risk",\n  "release": "1.2.3"\n}');
  await expect(
    page.getByTestId("flow-trigger-test-payload-error")
  ).not.toBeVisible();
  await expect(page.getByTestId("flow-trigger-test-payload")).toHaveValue(
    /Summarize release risk/
  );
  await page.getByTestId("flow-webhook-generate-secret").click();
  await expect(page.getByTestId("flow-webhook-secret-value")).toHaveValue(
    "whsec_test_generated_once"
  );
  await expect(page.locator(".flows-inspector")).toContainText(
    "x-mogplex-signature"
  );
  await page.locator(".react-flow__node-agent").first().click();
  await expect(page.getByTestId("flow-agent-instructions")).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "Instructions / prompt"
  );

  await page.locator(".react-flow__node-start").click();
  await page.getByTestId("flow-trigger-preset-dependabot").click();
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "pr_opened"
  );
  await expect(page.getByTestId("flow-trigger-author-filter")).toHaveAttribute(
    "data-value",
    "dependabot_only"
  );
});

test("Slack mention trigger selects a connected workspace and channel", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.unroute("**/api/integrations/slack/installations");
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, {
      installations: [{ teamId: "T1", teamName: "Mogplex" }],
    })
  );
  await page.route(
    /\/api\/integrations\/slack\/installations\/T1\/channels(?:\?.*)?$/,
    (route) =>
      fulfillJson(route, {
        channels: [{ id: "C1", name: "release-ops", isPrivate: false }],
        nextCursor: null,
      })
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("flow-trigger-preset-slack-mention").click();
  await selectAppOption(page.getByTestId("flow-trigger-slack-workspace"), "T1");
  await selectAppOption(page.getByTestId("flow-trigger-slack-channel"), "C1");
  await expect(page.locator(".flows-inspector")).toContainText(
    "starts the workflow instead of the conversational assistant"
  );
});

test("workflows builder and portalled surfaces follow the light app theme", async ({
  page,
}, testInfo) => {
  await setupWorkflowsPage(page, "light");

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  // Prove the premise: the surrounding app really is in its light theme.
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // React Flow's own color mode has to track the app theme, not the OS.
  await expect(page.locator(".react-flow.light")).toBeVisible();
  await expect(page.locator(".react-flow.dark")).toHaveCount(0);

  const paneStyles = await page.locator(".flows-pane").evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      themeBackground: styles.getPropertyValue("--background").trim(),
      backgroundColor: styles.backgroundColor,
      color: styles.color,
      colorScheme: styles.colorScheme,
    };
  });
  const [
    expectedLightBackground,
    actualLightBackground,
    expectedLightForeground,
    actualLightForeground,
    expectedLightCard,
  ] = await normalizeCssColors(page, [
    "#f7f5ef",
    paneStyles.backgroundColor,
    "#191712",
    paneStyles.color,
    "#fdfcf9",
  ]);
  expect(paneStyles.themeBackground).not.toBe("");
  expect(actualLightBackground).toBe(expectedLightBackground);
  expect(actualLightForeground).toBe(expectedLightForeground);
  expect(paneStyles.colorScheme).toBe("light");

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
  expect(canvasThemeColors.canvasBackground).toBe(
    canvasThemeColors.themeBackground
  );
  const canvasBg = await page
    .locator(".react-flow__background")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect((await normalizeCssColors(page, [canvasBg]))[0]).toBe(
    expectedLightBackground
  );

  // Node cards must sit on a light surface too — they are the one place that
  // still paints its own background rather than inheriting the canvas.
  const nodeCardBackgrounds = await page
    .locator(".flows-node-card")
    .evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundColor)
    );
  expect(nodeCardBackgrounds.length).toBeGreaterThan(0);
  const normalizedLightNodeCards = await normalizeCssColors(
    page,
    nodeCardBackgrounds
  );
  expect(
    normalizedLightNodeCards.every(
      (background) => background === expectedLightCard
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("flows-pane-light-theme.png"),
    fullPage: true,
  });

  // The context menu portals to document.body, outside `.flows-pane`, and
  // relies on `.flows-theme` to pick up the same palette.
  await page
    .locator(".react-flow__pane")
    .click({ button: "right", position: { x: 200, y: 60 } });
  const contextMenu = page.getByTestId("flow-context-menu");
  await expect(contextMenu).toBeVisible();
  const menuStyles = await contextMenu.evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      insidePane: Boolean(node.closest(".flows-pane")),
      hasFlowsTheme: node.classList.contains("flows-theme"),
      themeBackground: styles.getPropertyValue("--background").trim(),
      backgroundColor: styles.backgroundColor,
      color: styles.color,
    };
  });
  expect(menuStyles.insidePane).toBe(false);
  expect(menuStyles.hasFlowsTheme).toBe(true);
  expect(menuStyles.themeBackground).not.toBe("");
  expect(menuStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect((await normalizeCssColors(page, [menuStyles.color]))[0]).toBe(
    expectedLightForeground
  );
  await page.keyboard.press("Escape");
  await expect(contextMenu).not.toBeVisible();

  // The run-details dialog also portals to document.body and must carry the
  // light palette via `.flows-theme`.
  await page.getByTestId("flows-runs-tab").click();
  await page.getByTestId("flow-run-card-run-1").click();
  const runDialog = page.locator('[data-slot="dialog-content"]');
  await expect(runDialog).toBeVisible();
  await expect(runDialog.getByText("Overview")).toBeVisible();
  const dialogStyles = await runDialog.evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      insidePane: Boolean(node.closest(".flows-pane")),
      hasFlowsTheme: node.classList.contains("flows-theme"),
      backgroundColor: styles.backgroundColor,
      color: styles.color,
    };
  });
  expect(dialogStyles.insidePane).toBe(false);
  expect(dialogStyles.hasFlowsTheme).toBe(true);
  const [dialogBackground, dialogForeground] = await normalizeCssColors(page, [
    dialogStyles.backgroundColor,
    dialogStyles.color,
  ]);
  expect(dialogBackground).toBe(expectedLightBackground);
  expect(dialogForeground).toBe(expectedLightForeground);
});
