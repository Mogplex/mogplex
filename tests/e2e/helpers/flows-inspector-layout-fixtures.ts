import { buildE2EAuthHeaders } from "./auth";
import { linkedVercelCapability } from "./activation-fixtures";
import type { Locator, Page, Route } from "@playwright/test";

// Re-export expect for the openAgentInspector function
import { expect } from "@playwright/test";

export const connectedUser = {
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
export const LONG_MODEL_ID = "minimax/minimax-m3";

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export const flowPayload = {
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

export async function setupWorkflowsPage(page: Page) {
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
export function parseCssAlpha(color: string) {
  const toNumber = (raw: string) =>
    raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);

  const slashSyntax = color.match(/\/\s*([\d.]+%?)\s*\)$/);
  if (slashSyntax) return toNumber(slashSyntax[1]);

  const commaSyntax = color.match(/^rgba?\(([^)]+)\)$/);
  if (!commaSyntax) return 1;
  const components = commaSyntax[1].split(",").map((part) => part.trim());
  return components.length < 4 ? 1 : toNumber(components[3]);
}

export async function openAgentInspector(page: Page) {
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.locator('.react-flow__node[data-id="agent-1"]').click();
  await expect(page.getByTestId("flows-right-sheet")).toBeVisible();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
}

/** Every pair of grid cells inside the inspector, checked for visual overlap. */
export async function findOverlappingCells(sheet: Locator) {
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
            overlaps.push(`${cells[i].text} <-> ${cells[j].text}`);
          }
        }
      }
    }
    return overlaps;
  });
}

/** Resolved track count of every `.grid` in the inspector, by its first cell. */
export async function gridTrackCounts(sheet: Locator) {
  return sheet.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>(".grid")).map((grid) => ({
      label: (grid.textContent || "").trim().slice(0, 30),
      tracks: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    }))
  );
}
