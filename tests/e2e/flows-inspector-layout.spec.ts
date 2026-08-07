import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Locator, Page, Route } from "@playwright/test";

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

// Long enough that a two-column grid cell cannot hold it on one line, which is
// what used to push it over the neighbouring cell.
const LONG_MODEL_ID = "minimax/minimax-m3";

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
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
          data: {
            label: "NEXTJS-REVIEWER",
            agentId: "agent-1",
            role: "review",
            harness: "mogplex",
            modelOverride: LONG_MODEL_ID,
          },
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
        data: {
          label: "NEXTJS-REVIEWER",
          agentId: "agent-1",
          role: "review",
          harness: "mogplex",
          modelOverride: LONG_MODEL_ID,
        },
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

async function setupWorkflowsPage(page: Page) {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": "alex",
    "x-mogplex-scope-id": connectedUser.id,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
    // Ensure the inspector starts expanded (not collapsed) in dock mode.
    window.localStorage.removeItem("flows-inspector-minimized");
  });

  const model = {
    id: LONG_MODEL_ID,
    provider: "minimax",
    name: "MiniMax M3",
    context_length: 1000000,
    capabilities: ["text"],
    is_available: true,
  };

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: LONG_MODEL_ID, theme: "dark" })
  );
  await page.route("**/api/automations/harnesses**", (route) =>
    fulfillJson(route, {
      harnesses: {
        mogplex: { available: true, billingSource: "mogplex", reason: null },
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
      models: [model],
      catalog: [{ ...model, is_enabled: true }],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "agent-1",
        name: "NEXTJS-REVIEWER",
        slug: "nextjs-reviewer",
        model: LONG_MODEL_ID,
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
  await page.route(/\/api\/flows\/flow-1\/runs\?/, (route) =>
    fulfillJson(route, { runs: [] })
  );
}

/**
 * Alpha channel of a computed `backgroundColor`, for both the legacy
 * `rgba(r, g, b, a)` and the modern `rgb(r g b / a)` syntax. Opaque colours
 * omit the channel entirely, hence the 1 default -- note `rgb(r, g, b)` must
 * not be read as if its third component were the alpha.
 */
function parseCssAlpha(color: string) {
  const toNumber = (raw: string) =>
    raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);

  const slashSyntax = color.match(/\/\s*([\d.]+%?)\s*\)$/);
  if (slashSyntax) return toNumber(slashSyntax[1]);

  const commaSyntax = color.match(/^rgba?\(([^)]+)\)$/);
  if (!commaSyntax) return 1;
  const components = commaSyntax[1].split(",").map((part) => part.trim());
  return components.length < 4 ? 1 : toNumber(components[3]);
}

async function openAgentInspector(page: Page) {
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.locator('.react-flow__node[data-id="agent-1"]').click();
  await expect(page.getByTestId("flows-right-sheet")).toBeVisible();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
}

/** Every pair of grid cells inside the inspector, checked for visual overlap. */
async function findOverlappingCells(sheet: Locator) {
  return sheet.evaluate((root) => {
    const overlaps: string[] = [];
    for (const grid of root.querySelectorAll<HTMLElement>(".grid")) {
      const cells = Array.from(grid.children).map((child) => ({
        text: (child.textContent || "").trim().slice(0, 40),
        rect: child.getBoundingClientRect(),
      }));
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          const a = cells[i].rect;
          const b = cells[j].rect;
          const overlapX =
            Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY =
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 0.5 && overlapY > 0.5) {
            overlaps.push(`${cells[i].text} ↔ ${cells[j].text}`);
          }
        }
      }
    }
    return overlaps;
  });
}

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

/** Resolved track count of every `.grid` in the inspector, by its first cell. */
async function gridTrackCounts(sheet: Locator) {
  return sheet.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>(".grid")).map((grid) => ({
      label: (grid.textContent || "").trim().slice(0, 30),
      tracks: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    }))
  );
}

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

test("assistant panel keeps its own scroller inside the sheet", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("flow-assistant-toggle").click();
  await expect(page.getByTestId("flow-assistant-panel")).toBeVisible();

  const measure = () =>
    page.evaluate(() => {
      const el = (testId: string) =>
        document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      const sheet = el("flows-right-sheet");
      const root = el("flow-assistant-panel");
      const transcript = el("flow-assistant-transcript");
      if (!sheet || !root || !transcript) return null;
      const rootRect = root.getBoundingClientRect();
      return {
        panelOverflow: root.scrollHeight - root.clientHeight,
        panelTop: rootRect.top,
        panelBottom: rootRect.bottom,
        sheetTop: sheet.getBoundingClientRect().top,
        sheetBottom: sheet.getBoundingClientRect().bottom,
        transcriptHeight: transcript.getBoundingClientRect().height,
        transcriptTop: transcript.getBoundingClientRect().top,
        transcriptOverflowY: getComputedStyle(transcript).overflowY,
      };
    });

  // The assistant shares the sheet with the inspector, and the sheet went from
  // scrolling itself to `flex-col overflow-hidden`. The panel therefore has to
  // fit the sheet and scroll internally, or its transcript is clipped with no
  // way back to it.
  const roomy = await measure();
  expect(roomy).not.toBeNull();
  expect(roomy!.panelOverflow).toBeLessThanOrEqual(1);
  expect(roomy!.panelTop).toBeGreaterThanOrEqual(roomy!.sheetTop - 1);
  expect(roomy!.panelBottom).toBeLessThanOrEqual(roomy!.sheetBottom + 1);
  expect(roomy!.transcriptOverflowY).toBe("auto");

  // Squeezed, the transcript is what gives way -- it stays on screen and keeps
  // its own scroller instead of the header or composer being pushed out.
  await page.setViewportSize({ width: 1280, height: 380 });
  await expect
    .poll(async () => (await measure())!.transcriptHeight)
    .toBeLessThan(roomy!.transcriptHeight);
  const squeezed = await measure();
  expect(squeezed!.transcriptHeight).toBeGreaterThan(0);
  expect(squeezed!.transcriptOverflowY).toBe("auto");
  expect(squeezed!.transcriptTop).toBeGreaterThanOrEqual(
    squeezed!.panelTop - 1
  );
  expect(squeezed!.panelBottom).toBeLessThanOrEqual(squeezed!.sheetBottom + 1);
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
