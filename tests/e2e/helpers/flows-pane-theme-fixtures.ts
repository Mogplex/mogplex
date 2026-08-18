import type { Page, Route } from "@playwright/test";
import { buildE2EAuthHeaders } from "./auth";
import { linkedVercelCapability } from "./activation-fixtures";

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

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export async function getCanvasScale(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((viewport) => {
    const transform = getComputedStyle(viewport).transform;
    if (transform === "none") return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
}

export async function normalizeCssColors(page: Page, colors: string[]) {
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

export const flowRun = {
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

export const flowRunDetail = {
  ...flowRun,
  dispatch_events: [],
  ai_calls: [],
  review_findings: [],
};

export async function setupWorkflowsPage(
  page: Page,
  theme: "light" | "dark",
  { flows = [flowPayload] }: { flows?: Array<typeof flowPayload> } = {}
) {
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
  await page.route("**/api/flows", (route) => fulfillJson(route, flows));
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
