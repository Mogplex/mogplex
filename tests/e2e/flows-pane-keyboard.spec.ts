import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import { selectAppOption } from "./helpers/app-select";
import { FLOW_AGENT_DEFAULT_MAX_STEPS } from "../../lib/flows/agent-defaults";
import { AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS } from "../../lib/workflows/automation-model-defaults";
import type { Page, Route } from "@playwright/test";
import type { FlowNode } from "../../lib/types";

const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
const redoShortcut =
  process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Y";
const defaultTimeoutSeconds = Math.round(
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS / 1000
);
const defaultMaxStepsPlaceholder = `${FLOW_AGENT_DEFAULT_MAX_STEPS} (default)`;
const defaultTimeoutPlaceholder = `${defaultTimeoutSeconds} (default)`;
// 100 ms past the 900 ms autosave debounce — enough to confirm no save fires.
const autosaveSettleMs = 1000;

const connectedUser = {
  id: "user-1",
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

async function stubFlowsPage(
  page: Page,
  options?: {
    teamId?: string;
    flowUpdateDelayMs?: number;
    installations?: Array<{
      id: string;
      installation_id: number;
      account_login: string;
      account_type: "Organization" | "User";
      repositories: Array<{ id: string; full_name: string }>;
    }>;
    flowStatus?: "active" | "inactive";
    personalTemplates?: Array<{
      id: string;
      name: string;
      description: string | null;
      trigger_event: "pr_opened" | "webhook";
      reconnect: Array<"agent" | "slack" | "webhook">;
      requires_repository: boolean;
    }>;
    teamTemplates?: Array<{
      id: string;
      name: string;
      description: string | null;
      trigger_event: "pr_opened" | "webhook";
      reconnect: Array<"agent" | "slack" | "webhook">;
      requires_repository: boolean;
    }>;
    onFlowCreate?: (payload: Record<string, unknown>) => void;
    onFlowPublish?: () => void;
    onTemplateCreate?: (
      payload: Record<string, unknown>,
      scope: "personal" | "team"
    ) => void;
    onFlowUpdate?: (payload: Record<string, unknown>) => void;
  }
) {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": options?.teamId ? "team" : "personal",
    "x-mogplex-scope-slug": options?.teamId ? "acme" : connectedUser.username,
    "x-mogplex-scope-id": options?.teamId ?? connectedUser.id,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

  const agentRequestMethods: string[] = [];
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme: "dark" })
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
          available: false,
          billingSource: null,
          reason: "No OpenAI API key configured.",
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
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
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
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_enabled: true,
        },
      ],
    })
  );
  await page.route("**/api/agents", (route) => {
    agentRequestMethods.push(route.request().method());
    return fulfillJson(route, [
      {
        id: "agent-a",
        name: "Reviewer A",
        slug: "reviewer-a",
        model: "minimax/minimax-m2.5",
      },
      {
        id: "agent-b",
        name: "Reviewer B",
        slug: "reviewer-b",
        model: "minimax/minimax-m2.5",
      },
    ]);
  });
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(
      route,
      options?.installations ?? [
        {
          id: "inst-1",
          installation_id: 101,
          account_login: "webrenew",
          account_type: "Organization",
          repositories: [{ id: "repo-1", full_name: "webrenew/blackbox" }],
        },
      ]
    )
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );

  let currentFlow = {
    id: "flow-1",
    installation_id: 101,
    name: "Review Flow",
    description: "Flow description",
    notes: "Flow notes",
    source_kind: "github",
    status: options?.flowStatus ?? "active",
    last_run_status: "success",
    published_version_id: "version-1",
    published_version: {
      id: "version-1",
      flow_id: "flow-1",
      version_number: 1,
      graph: {},
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
          id: "agent-a",
          type: "agent",
          position: { x: 380, y: 160 },
          data: { label: "Reviewer A", agentId: "agent-a" },
        },
        {
          id: "agent-b",
          type: "agent",
          position: { x: 640, y: 160 },
          data: { label: "Reviewer B", agentId: "agent-b" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 900, y: 160 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-1", source: "start", target: "agent-a" },
        { id: "edge-2", source: "agent-a", target: "agent-b" },
        { id: "edge-3", source: "agent-b", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
  currentFlow.published_version.graph = structuredClone(
    currentFlow.draft_graph
  );

  let currentTemplates = options?.personalTemplates ?? [];
  let currentTeamTemplates = options?.teamTemplates ?? [];
  await page.route("**/api/flows/templates**", async (route) => {
    const isTeamRequest =
      Boolean(options?.teamId) &&
      route.request().headers()["x-mogplex-team-id"] === options?.teamId;
    const templates = isTeamRequest ? currentTeamTemplates : currentTemplates;
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        templates,
        next_cursor: null,
        ...(isTeamRequest ? { can_write: true } : {}),
      });
      return;
    }
    if (route.request().method() === "DELETE") {
      const templateId = route.request().url().split("/").at(-1);
      if (isTeamRequest) {
        currentTeamTemplates = currentTeamTemplates.filter(
          (template) => template.id !== templateId
        );
      } else {
        currentTemplates = currentTemplates.filter(
          (template) => template.id !== templateId
        );
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    const payload = route.request().postDataJSON() as Record<string, unknown>;
    options?.onTemplateCreate?.(payload, isTeamRequest ? "team" : "personal");
    const created = {
      id: `template-${templates.length + 1}`,
      name: String(payload.name || currentFlow.name),
      description: currentFlow.description,
      trigger_event: "pr_opened" as const,
      reconnect: [],
      requires_repository: false,
    };
    if (isTeamRequest) {
      currentTeamTemplates = [created, ...currentTeamTemplates];
    } else {
      currentTemplates = [created, ...currentTemplates];
    }
    await fulfillJson(route, created, 201);
  });

  await page.route("**/api/flows", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, [currentFlow]);
      return;
    }

    const payload = route.request().postDataJSON() as Record<string, unknown>;
    options?.onFlowCreate?.(payload);
    currentFlow = {
      ...currentFlow,
      name:
        payload.template_id === "dependabot-autopilot"
          ? "Dependabot autopilot"
          : currentFlow.name,
    };
    await fulfillJson(route, currentFlow, 201);
  });

  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, currentFlow);
      return;
    }

    const payload = route.request().postDataJSON() as Partial<
      typeof currentFlow
    > & { draft_graph: typeof currentFlow.draft_graph };
    options?.onFlowUpdate?.(payload as Record<string, unknown>);
    if (options?.flowUpdateDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.flowUpdateDelayMs)
      );
    }
    currentFlow = {
      ...currentFlow,
      ...payload,
      draft_graph: payload.draft_graph ?? currentFlow.draft_graph,
    };
    await fulfillJson(route, currentFlow);
  });
  await page.route("**/api/flows/flow-1/publish", async (route) => {
    options?.onFlowPublish?.();
    const start = (currentFlow.draft_graph.nodes as FlowNode[]).find(
      (node) => node.type === "start"
    );
    const installationIds =
      start?.type === "start" ? (start.data.filter?.installationIds ?? []) : [];
    currentFlow = {
      ...currentFlow,
      installation_id:
        installationIds.length === 1
          ? installationIds[0]
          : currentFlow.installation_id,
      status: "active",
      published_version_id: "version-2",
      published_version: {
        ...currentFlow.published_version,
        id: "version-2",
        version_number: 2,
        graph: structuredClone(currentFlow.draft_graph),
      },
    };
    await fulfillJson(route, currentFlow);
  });

  return {
    getFlow: () => currentFlow,
    getAgentRequestMethods: () => agentRequestMethods,
  };
}

test("keyboard shortcuts duplicate, delete, undo, and redo canvas nodes", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const canvasNodes = page.locator(".react-flow__node");
  await expect(canvasNodes).toHaveCount(4);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer B" })
    .click();
  await page.keyboard.press(`${primaryModifier}+D`);
  await expect(canvasNodes).toHaveCount(5);

  await page.keyboard.press("Backspace");
  await expect(canvasNodes).toHaveCount(4);

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect(canvasNodes).toHaveCount(5);

  await page.keyboard.press(redoShortcut);
  await expect(canvasNodes).toHaveCount(4);
});

test("open workflow selectors own shortcuts without disabling them after close", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const canvasNodes = page.locator(".react-flow__node");
  await expect(canvasNodes).toHaveCount(4);

  await canvasNodes.filter({ hasText: "Reviewer B" }).click();
  const taskSelect = page.getByLabel("Agent task");
  await taskSelect.click();
  await expect(taskSelect).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Backspace");
  await expect(canvasNodes).toHaveCount(4);

  await page.keyboard.press("Escape");
  await expect(taskSelect).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Backspace");
  await expect(canvasNodes).toHaveCount(3);
});

test("keyboard shortcuts copy, paste, cut, undo, and redo canvas nodes", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const canvasNodes = page.locator(".react-flow__node");
  const reviewerANodes = canvasNodes.filter({ hasText: "Reviewer A" });
  const reviewerBNodes = canvasNodes.filter({ hasText: "Reviewer B" });
  await expect(canvasNodes).toHaveCount(4);

  await reviewerBNodes.click();
  await page.keyboard.press(`${primaryModifier}+C`);

  await reviewerANodes.click();
  await page.getByRole("tab", { name: "Canvas" }).evaluate((tab) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(tab);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press(`${primaryModifier}+C`);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(reviewerANodes).toHaveCount(1);
  await expect(reviewerBNodes).toHaveCount(2);
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect(canvasNodes).toHaveCount(4);

  await page.getByTestId("flows-runs-tab").click();
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(canvasNodes).toHaveCount(4);

  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(canvasNodes).toHaveCount(4);

  await reviewerBNodes.click();
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(canvasNodes).toHaveCount(5);
  await expect(reviewerBNodes).toHaveCount(2);

  await page.keyboard.press(`${primaryModifier}+X`);
  await expect(canvasNodes).toHaveCount(4);
  await expect(reviewerBNodes).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect(canvasNodes).toHaveCount(5);

  await page.keyboard.press(redoShortcut);
  await expect(canvasNodes).toHaveCount(4);
});

test("new workflow picker creates a selected starter template", async ({
  page,
}) => {
  const createPayloads: Record<string, unknown>[] = [];
  await stubFlowsPage(page, {
    onFlowCreate: (payload) => {
      createPayloads.push(payload);
    },
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New workflow" }).click();
  const picker = page.getByTestId("flow-template-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("Nothing runs until you publish it.");
  await expect(picker.getByRole("button")).toHaveCount(5);

  await page.getByTestId("flow-template-dependabot-autopilot").click();

  await expect
    .poll(() => createPayloads[0]?.template_id)
    .toBe("dependabot-autopilot");
  expect(createPayloads[0]?.installation_id).toBe(101);
  await expect(picker).toBeHidden();
  await expect(
    page.getByText("Started from Dependabot autopilot.", { exact: true })
  ).toBeVisible();
});

test("personal workflow templates bind a target repository and can be saved from the picker", async ({
  page,
}) => {
  const flowCreatePayloads: Record<string, unknown>[] = [];
  const templateCreatePayloads: Record<string, unknown>[] = [];
  await stubFlowsPage(page, {
    installations: [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        account_type: "Organization",
        repositories: [
          { id: "repo-1", full_name: "webrenew/blackbox" },
          { id: "repo-2", full_name: "webrenew/mogplex" },
        ],
      },
    ],
    personalTemplates: [
      {
        id: "template-strict-review",
        name: "Strict PR review",
        description: "Extra checks for critical repositories.",
        trigger_event: "webhook",
        reconnect: ["webhook"],
        requires_repository: true,
      },
    ],
    onFlowCreate: (payload) => flowCreatePayloads.push(payload),
    onTemplateCreate: (payload) => templateCreatePayloads.push(payload),
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New workflow" }).click();
  const personalTemplate = page.getByTestId(
    "flow-personal-template-template-strict-review"
  );
  await expect(personalTemplate).toBeDisabled();
  await expect(personalTemplate).toContainText("Reconnect webhook");

  await selectAppOption(
    page.getByRole("combobox", { name: "New workflow repository" }),
    "webrenew/blackbox"
  );
  await expect(personalTemplate).toBeEnabled();
  await personalTemplate.click();

  await expect
    .poll(() => flowCreatePayloads[0]?.personal_template_id)
    .toBe("template-strict-review");
  expect(flowCreatePayloads[0]?.repo_full_name).toBe("webrenew/blackbox");

  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByTestId("flow-save-personal-template").click();
  const dialog = page.getByTestId("flow-save-template-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Template name").fill("Critical repo review");
  await page.getByTestId("flow-save-template-submit").click();

  await expect
    .poll(() => templateCreatePayloads[0]?.name)
    .toBe("Critical repo review");
  expect(templateCreatePayloads[0]?.flow_id).toBe("flow-1");

  await page
    .getByRole("button", { name: "Delete Critical repo review template" })
    .click();
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(
    page.getByRole("button", { name: "Delete Critical repo review template" })
  ).toHaveCount(0);
});

test("team workflow templates are separated, reused, and saved in active team scope", async ({
  page,
}) => {
  const teamId = "11111111-2222-4333-8444-555555555555";
  const flowCreateRequests: Array<{
    payload: Record<string, unknown>;
    teamId: string | undefined;
  }> = [];
  const templateCreates: Array<{
    payload: Record<string, unknown>;
    scope: "personal" | "team";
  }> = [];

  await stubFlowsPage(page, {
    teamId,
    personalTemplates: [
      {
        id: "template-personal",
        name: "My review",
        description: "Personal baseline",
        trigger_event: "pr_opened",
        reconnect: [],
        requires_repository: false,
      },
    ],
    teamTemplates: [
      {
        id: "template-team",
        name: "Team release gate",
        description: "Shared release checks",
        trigger_event: "pr_opened",
        reconnect: ["agent"],
        requires_repository: false,
      },
    ],
    onFlowCreate: (payload) => {
      flowCreateRequests.push({ payload, teamId: undefined });
    },
    onTemplateCreate: (payload, scope) => {
      templateCreates.push({ payload, scope });
    },
  });
  await page.route("**/api/flows", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    flowCreateRequests.push({
      payload: route.request().postDataJSON() as Record<string, unknown>,
      teamId: route.request().headers()["x-mogplex-team-id"],
    });
    await fulfillJson(
      route,
      {
        id: "flow-created",
        name: "Team release gate",
      },
      201
    );
  });

  await page.goto("/acme/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New workflow" }).click();
  const picker = page.getByTestId("flow-template-picker");
  await expect(picker).toContainText("Team templates");
  await expect(picker).toContainText("Your templates");
  const teamTemplate = page.getByTestId("flow-team-template-template-team");
  await expect(teamTemplate).toContainText("Reconnect agent");
  await teamTemplate.click();

  await expect
    .poll(() => flowCreateRequests.at(-1)?.payload.team_template_id)
    .toBe("template-team");
  expect(flowCreateRequests.at(-1)?.teamId).toBe(teamId);

  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByTestId("flow-save-personal-template").click();
  const dialog = page.getByTestId("flow-save-template-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("flow-template-scope-team")).toBeChecked();
  await dialog.getByLabel("Template name").fill("Shared critical review");
  await page.getByTestId("flow-save-template-submit").click();

  await expect.poll(() => templateCreates.at(-1)?.scope).toBe("team");
  expect(templateCreates.at(-1)?.payload.name).toBe("Shared critical review");
});

test("keyboard shortcuts save from text fields without hijacking text input selection", async ({
  page,
}) => {
  const { getFlow } = await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  const notes = page.getByPlaceholder(
    "Capture intent, guardrails, and context for this flow."
  );
  await notes.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.type("Updated flow notes");
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect.poll(() => getFlow().notes).toBe("Updated flow notes");
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Reviewer A" })
  ).toHaveCount(1);
});

test("draft edits autosave and surface save status without a manual save click", async ({
  page,
}) => {
  const { getFlow } = await stubFlowsPage(page, {
    // Keep the PUT in flight past the 900 ms debounce so transient states are observable.
    flowUpdateDelayMs: 1200,
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  const notes = page.getByPlaceholder(
    "Capture intent, guardrails, and context for this flow."
  );
  await notes.fill("Autosaved flow notes");

  const liveStatus = page.getByTestId("flow-save-status-live");
  await expect(page.getByTestId("flow-save-status")).toContainText(
    /Autosave queued|Autosaving/
  );
  await expect(liveStatus).toBeEmpty();
  await expect.poll(() => getFlow().notes).toBe("Autosaved flow notes");
  const status = page.getByTestId("flow-save-status");
  await expect(status).toContainText("Saved");
  await expect(liveStatus).toHaveText("Saved");
});

test("clean saved status stays visually quiet", async ({ page }) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const status = page.getByTestId("flow-save-status");
  await expect(status).toHaveText("Saved");
  const liveStatus = page.getByTestId("flow-save-status-live");
  await expect(liveStatus).toHaveAttribute("role", "status");
  await expect(liveStatus).toBeEmpty();
  const presentation = await status.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
    };
  });

  expect(presentation.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(presentation.borderTopWidth).toBe("0px");
});

test("canvas viewport changes do not autosave without graph edits", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-04-30T12:00:00Z") });
  let flowUpdateCount = 0;
  await stubFlowsPage(page, {
    onFlowUpdate: () => {
      flowUpdateCount += 1;
    },
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);

  // Advance past the 900ms autosave debounce after initial fit-view adjustments.
  await page.clock.runFor(autosaveSettleMs);
  // The primary regression assertion: no PUT must have fired for a
  // viewport-only change. The "Saved" text reflects the initial load state
  // rendered by stubFlowsPage (no dirty edits outstanding at page load).
  expect(flowUpdateCount).toBe(0);
  await expect(page.getByTestId("flow-save-status")).toContainText("Saved");

  await page.locator(".react-flow").click({ position: { x: 520, y: 300 } });
  // A canvas click that only changes the viewport must not trigger autosave.
  await page.clock.runFor(autosaveSettleMs);
  expect(flowUpdateCount).toBe(0);
  await expect(page.getByTestId("flow-save-status")).toContainText("Saved");
});

test("autosave does not replay an older server snapshot over newer local edits", async ({
  page,
}) => {
  let flowUpdateCount = 0;
  const { getFlow } = await stubFlowsPage(page, {
    flowUpdateDelayMs: 1800,
    onFlowUpdate: () => {
      flowUpdateCount += 1;
    },
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  const notes = page.getByPlaceholder(
    "Capture intent, guardrails, and context for this flow."
  );
  await notes.fill("First autosave snapshot");

  await expect.poll(() => flowUpdateCount).toBe(1);

  await notes.fill("Second local edit should win");
  await expect(page.getByTestId("flow-save-status")).toContainText(
    /Autosaving|Autosave queued/
  );

  await expect
    .poll(async () => notes.inputValue())
    .toBe("Second local edit should win");

  // Confirm the persisted server payload — not just the UI field — ends on the newer edit.
  // Without this the test would pass even if a stale server echo transiently overwrote the draft,
  // as long as React re-rendered the latest value back.
  await expect.poll(() => flowUpdateCount).toBeGreaterThanOrEqual(2);
  await expect.poll(() => getFlow().notes).toBe("Second local edit should win");
});

test("adding a condition node does not let the first autosave overwrite follow-up inspector edits", async ({
  page,
}) => {
  let flowUpdateCount = 0;
  const { getFlow } = await stubFlowsPage(page, {
    flowUpdateDelayMs: 1800,
    onFlowUpdate: () => {
      flowUpdateCount += 1;
    },
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /If branch/ }).click();
  await expect(page.getByLabel("Source field")).toBeVisible();

  await expect.poll(() => flowUpdateCount).toBe(1);

  const labelInput = page.getByLabel("Label");
  await labelInput.fill("Branch on repo source");

  await expect
    .poll(async () => labelInput.inputValue())
    .toBe("Branch on repo source");

  // Verify the persisted server payload reflects the follow-up inspector edit.
  // This is the regression guard: a broken build where the first autosave echo overwrites
  // the condition-node label would still render the local input correctly but would persist
  // the original "Condition" label to the server.
  await expect.poll(() => flowUpdateCount).toBeGreaterThanOrEqual(2);
  const getConditionNodeLabel = () => {
    const nodes = (getFlow().draft_graph?.nodes ?? []) as FlowNode[];
    for (const node of nodes) {
      if (node.type === "condition") return node.data.label;
    }
    return null;
  };
  await expect.poll(getConditionNodeLabel).toBe("Branch on repo source");
});

test("select all and escape only affect agent-node selection and preserve structural nodes", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const selectedNodes = page.locator(".react-flow__node.selected");
  const initialNodeCount = await page.locator(".react-flow__node").count();

  await page.locator(".flows-pane-grid > section").click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Reviewer A" })
  ).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Reviewer B" })
  ).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "PR opened" })
  ).toHaveCount(0);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Done" })
  ).toHaveCount(0);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" })
    .click();
  await page.keyboard.press("Delete");
  expect(
    await page.locator(".react-flow__node").count()
  ).toBeGreaterThanOrEqual(initialNodeCount);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "PR opened" })
  ).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Done" })
  ).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(selectedNodes).toHaveCount(0);
});

test("agent node overrides persist to the flow graph without mutating the base agent catalog", async ({
  page,
}) => {
  const { getFlow, getAgentRequestMethods } = await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  await selectAppOption(page.getByLabel("Agent task"), "edit");
  await selectAppOption(
    page.getByLabel("Model", { exact: true }),
    "minimax/minimax-m2.5"
  );
  const maxStepsOverride = page.getByLabel("Max steps override");
  const timeoutOverride = page.getByLabel("Timeout override (seconds)");
  await expect(maxStepsOverride).toHaveAttribute(
    "placeholder",
    defaultMaxStepsPlaceholder
  );
  await expect(timeoutOverride).toHaveAttribute(
    "placeholder",
    defaultTimeoutPlaceholder
  );
  await maxStepsOverride.fill("42");
  await timeoutOverride.fill("18");
  await page
    .getByLabel("System prompt override")
    .fill("Focus on correctness regressions before style issues.");
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect
    .poll(() => {
      const agentNode = (getFlow().draft_graph.nodes as FlowNode[]).find(
        (node) => node.id === "agent-a"
      );
      return agentNode?.data;
    })
    .toMatchObject({
      label: "Reviewer A",
      agentId: "agent-a",
      role: "edit",
      modelOverride: "minimax/minimax-m2.5",
      maxStepsOverride: 42,
      timeoutMsOverride: 18000,
      systemPromptOverride:
        "Focus on correctness regressions before style issues.",
    });

  expect(
    getAgentRequestMethods().every((method) => method === "GET")
  ).toBeTruthy();
});

test("agent nodes persist an available CLI harness and disable missing-key harnesses", async ({
  page,
}) => {
  const { getFlow } = await stubFlowsPage(page);

  await page.goto("/alex/automations?tab=editor");
  await expect(page).toHaveURL("/alex/workflows?tab=editor");
  await page.waitForLoadState("networkidle");

  const agentNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" });
  await expect(
    agentNode.getByTestId("flow-canvas-harness-icon-mogplex")
  ).toBeVisible();
  await expect(agentNode).toContainText("Mogplex");
  await expect(agentNode).not.toContainText("agent-a");
  await agentNode.click();

  const harnessGroup = page.getByRole("radiogroup", { name: "Harness" });
  await expect(
    harnessGroup.getByRole("radio", { name: "Mogplex" })
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    harnessGroup.getByRole("radio", { name: "Codex" })
  ).toBeDisabled();

  await harnessGroup.getByRole("radio", { name: "Claude Code" }).click();
  await expect(
    agentNode.getByTestId("flow-canvas-harness-icon-claude-code")
  ).toBeVisible();
  await expect(agentNode).toContainText("Claude Code");
  await expect(
    page.getByText("Claude Code runs this node inside a fresh repo sandbox")
  ).toBeVisible();
  await expect(page.getByLabel("Mogplex agent")).toHaveCount(0);
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect
    .poll(() => {
      const agentNode = (getFlow().draft_graph.nodes as FlowNode[]).find(
        (node) => node.id === "agent-a"
      );
      return agentNode?.data;
    })
    .toMatchObject({
      label: "Reviewer A",
      agentId: null,
      harness: "claude-code",
    });
});

test("workflow viewing filters stay outside the canvas and trigger scope binds account plus repository", async ({
  page,
}) => {
  let publishCount = 0;
  const { getFlow } = await stubFlowsPage(page, {
    flowStatus: "inactive",
    onFlowPublish: () => {
      publishCount += 1;
    },
    installations: [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        account_type: "Organization",
        repositories: [
          { id: "repo-1", full_name: "webrenew/blackbox" },
          { id: "repo-2", full_name: "webrenew/mogplex" },
        ],
      },
      {
        id: "inst-2",
        installation_id: 202,
        account_login: "alex",
        account_type: "User",
        repositories: [{ id: "repo-3", full_name: "alex/priority-project" }],
      },
    ],
  });
  const broadFlow = getFlow();
  const scopedFlow = (
    id: string,
    name: string,
    installationId: number,
    repo: string
  ) => ({
    ...structuredClone(broadFlow),
    id,
    name,
    installation_id: installationId,
    draft_graph: {
      ...structuredClone(broadFlow.draft_graph),
      nodes: broadFlow.draft_graph.nodes.map((node) =>
        node.type === "start"
          ? {
              ...structuredClone(node),
              data: {
                ...structuredClone(node.data),
                filter: {
                  scope: "all",
                  installationIds: [installationId],
                  repos: [repo],
                },
              },
            }
          : structuredClone(node)
      ),
    },
  });
  await page.unroute("**/api/flows");
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [
      broadFlow,
      scopedFlow(
        "flow-blackbox",
        "Blackbox strict checks",
        101,
        "webrenew/blackbox"
      ),
      scopedFlow(
        "flow-mogplex",
        "Mogplex strict checks",
        101,
        "webrenew/mogplex"
      ),
      scopedFlow(
        "flow-personal",
        "Personal checks",
        202,
        "alex/priority-project"
      ),
    ])
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const filterBar = page.getByTestId("flow-browser-filters");
  const canvas = page.locator(".react-flow");
  await expect(filterBar).toBeVisible();
  await expect(
    page.getByLabel("Filter workflows by GitHub account")
  ).toHaveAttribute("data-value", "all");
  await expect(page.getByLabel("New workflow installation")).toHaveCount(0);
  const filterBox = await filterBar.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(filterBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(filterBox!.y + filterBox!.height).toBeLessThanOrEqual(canvasBox!.y);

  await selectAppOption(page.getByTestId("flow-browser-account"), "101");
  await expect(filterBar).toContainText("3 of 4 workflows");
  const repositoryFilter = page.getByTestId("flow-browser-repository");
  await repositoryFilter.click();
  await page
    .getByTestId("flow-browser-repository-option-webrenew/blackbox")
    .click();
  await repositoryFilter.click();
  await expect(filterBar).toContainText("2 of 4 workflows");
  await repositoryFilter.click();
  await page
    .getByTestId("flow-browser-repository-option-webrenew/mogplex")
    .click();
  await repositoryFilter.click();
  await expect(repositoryFilter).toContainText("2 repositories");
  await expect(filterBar).toContainText("3 of 4 workflows");
  await page.getByLabel("Select workflow").click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Escape");

  const startNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" });
  await startNode.click();

  const account = page.getByTestId("flow-trigger-account");
  await expect(account).toHaveAttribute("data-value", "101");
  const repositoryScope = page.getByTestId("flow-trigger-repository-scope");
  await expect(repositoryScope).toContainText("All repositories");
  await repositoryScope.click();
  await page
    .getByTestId("flow-trigger-repository-option-webrenew/blackbox")
    .click();
  await repositoryScope.click();
  await expect(startNode).toContainText("webrenew · webrenew/blackbox");

  await selectAppOption(account, "202");
  await expect(repositoryScope).toContainText("All repositories");
  await repositoryScope.click();
  await page
    .getByTestId("flow-trigger-repository-option-alex/priority-project")
    .click();
  await repositoryScope.click();
  await expect(startNode).toContainText("alex · alex/priority-project");
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect.poll(() => getFlow().installation_id).toBe(101);
  await expect
    .poll(() => {
      const start = (getFlow().draft_graph.nodes as FlowNode[]).find(
        (node) => node.type === "start"
      );
      return start?.data.filter;
    })
    .toMatchObject({
      scope: "all",
      installationIds: [202],
      repos: ["alex/priority-project"],
    });
  const publishButton = page.getByTestId("flow-publish-button");
  await expect(publishButton).toHaveText("Publish & activate");
  await publishButton.click();
  await expect.poll(() => publishCount).toBe(1);
  await expect.poll(() => getFlow().installation_id).toBe(202);
});
