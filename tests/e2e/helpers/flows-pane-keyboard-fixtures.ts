import type { Page, Route } from "@playwright/test";
import { buildE2EAuthHeaders } from "./auth";
import { linkedVercelCapability } from "./activation-fixtures";
import type { FlowNode } from "../../../lib/types";

export const primaryModifier =
  process.platform === "darwin" ? "Meta" : "Control";
export const redoShortcut =
  process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Y";

export const connectedUser = {
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

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export interface StubFlowsPageOptions {
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

export async function stubFlowsPage(
  page: Page,
  options?: StubFlowsPageOptions
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
