import { expect, test, type Page } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { fulfillJson, mockActivationFlow } from "./helpers/activation-fixtures";
import type { Agent, Assignment, ObservabilityJob } from "@/lib/types";
import type { AgentRosterItem } from "@/app/api/agents/roster/route";
import type { Session } from "@/hooks/session-types";
import type {
  TriggerWithAgent,
  Installation,
} from "@/components/panes/triggers-pane-types";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
});

const agent: Agent = {
  id: "agent-1",
  user_id: "user-1",
  name: "Review agent",
  slug: "review-agent",
  model: "test-model",
  system_prompt: "Review changes",
  created_at: "2026-10-01T00:00:00Z",
};
const assignment: Assignment = {
  id: "assignment-1",
  repo_id: "repo-1",
  agent_id: agent.id,
  type: "pr_review",
  cron_schedule: null,
  skill_id: null,
  enabled: true,
  created_at: "2026-10-01T00:00:00Z",
  last_job_run_id: "job-1",
  last_run_status: "running",
  last_run_cancelable: true,
};

type Rule = { id: string; name: string; content: string; type: string };
const rule: Rule = {
  id: "rule-1",
  name: "Review rules",
  content: "Original instructions",
  type: "rules",
};

async function setupRules(page: Page, failedMethod: string) {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  let saved = { ...rule };
  await page.route("**/api/rules**", async (route) => {
    const method = route.request().method();
    if (method === "GET") return fulfillJson(route, [saved]);
    if (method === failedMethod)
      return fulfillJson(route, { error: "Rule access denied" }, 403);
    if (method === "PUT") {
      const body = route.request().postDataJSON() as { content: string };
      saved = { ...saved, content: body.content };
    }
    return fulfillJson(route, saved);
  });
  await page.goto(scopedPath("agents/rules"));
  await expect(page.getByText(rule.name, { exact: true })).toBeVisible();
}

test("failed rule saves retain the draft and allow a successful retry", async ({
  page,
}) => {
  await setupRules(page, "PUT");
  await page.getByText(rule.name, { exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox").fill("Unsaved instructions");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Rule access denied", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("Unsaved instructions");
  await expect(page.getByText(rule.content, { exact: true })).toBeVisible();
  await page.route("**/api/rules", (route) =>
    fulfillJson(route, { ...rule, content: "Unsaved instructions" })
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByText("Unsaved instructions", { exact: true })
  ).toBeVisible();
});

test("failed rule creation keeps the name and form open", async ({ page }) => {
  await setupRules(page, "POST");
  await page.getByRole("button", { name: "New Rule", exact: true }).click();
  await page.getByPlaceholder("rule-name.md").fill("draft.md");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Rule access denied", { exact: true })
  ).toBeVisible();
  await expect(page.getByPlaceholder("rule-name.md")).toHaveValue("draft.md");
});

test("failed rule deletion retains the selected rule", async ({ page }) => {
  await setupRules(page, "DELETE");
  await page.getByText(rule.name, { exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Rule access denied", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true })
  ).toBeVisible();
  await expect(page.getByText(rule.content, { exact: true })).toHaveCount(2);
});

test("failed assignment actions report errors and restore their controls", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  await page.route("**/api/agents", (route) => fulfillJson(route, [agent]));
  await page.route("**/api/assignments**", (route) =>
    fulfillJson(
      route,
      route.request().method() === "GET"
        ? [assignment]
        : { error: "Assignment access denied" },
      route.request().method() === "GET" ? 200 : 403
    )
  );
  await page.route("**/api/observability/jobs/job-1/cancel", (route) =>
    fulfillJson(route, { error: "Cannot cancel run" }, 500)
  );
  await page.goto(scopedPath("assignments"));
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await cancel.click();
  await expect(
    page.getByText("Cannot cancel run", { exact: true })
  ).toBeVisible();
  await expect(cancel).toBeEnabled();
  await page.getByRole("button", { name: "Assignment actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Assignment access denied", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Last run: running", { exact: false })
  ).toBeVisible();
});

test("failed agent deletion keeps the agent and displays the server error", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  await page.route("**/api/agents**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/agents") return route.fallback();
    if (route.request().method() === "DELETE")
      return fulfillJson(route, { error: "Cannot delete agent" }, 403);
    return fulfillJson(route, [agent]);
  });
  await page.route("**/api/agent-categories**", (route) =>
    fulfillJson(route, [])
  );
  await page.goto(scopedPath("agents/roster"));
  await page.getByRole("button", { name: "Agent actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Cannot delete agent", { exact: true })
  ).toBeVisible();
  await expect(page.getByText(agent.name, { exact: true })).toBeVisible();
});

test("failed output run actions show an error and keep the run available", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  const roster: AgentRosterItem[] = [
    {
      id: agent.id,
      name: agent.name,
      description: "Review changes",
      status: "running",
      cycleCount: 1,
      lastActivity: "2026-10-01T00:00:00Z",
    },
  ];
  const job: ObservabilityJob = {
    id: "job-1",
    assignment_id: assignment.id,
    trigger_id: null,
    status: "running",
    created_at: "2026-10-01T00:00:00Z",
    started_at: "2026-10-01T00:00:00Z",
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    duration_ms: null,
    error: null,
    start_attempts: 1,
    metadata: null,
    source_kind: "assignment",
    source_type: "pr_review",
    repo: { id: "repo-1", full_name: "acme/widgets" },
    agent: { id: agent.id, name: agent.name, slug: agent.slug },
    latest_ai_call: null,
    latest_dispatch_event: null,
    repairable: false,
    requeueable: false,
    cancelable: true,
  };
  const sessions: Session[] = [
    {
      id: "output-workspace",
      index: 0,
      name: "Output workspace",
      color: "green",
      activeId: "output",
      paneTree: {
        id: "root",
        dir: "horizontal",
        sizes: [40, 60],
        children: [
          {
            id: "roster",
            type: "roster",
            name: "Agents",
            lines: [],
            status: "idle",
          },
          {
            id: "output",
            type: "output",
            name: "Output",
            lines: [],
            status: "idle",
          },
        ],
      },
    },
  ];
  await page.addInitScript(
    (state) =>
      localStorage.setItem(
        "mogplex-sessions",
        JSON.stringify({ state, version: 3 })
      ),
    { sessions, activeSessionId: "output-workspace" }
  );
  await page.route("**/api/agents/roster", (route) =>
    fulfillJson(route, roster)
  );
  await page.route("**/api/observability/jobs?**", (route) =>
    fulfillJson(route, { jobs: [job], total: 1, page: 1, limit: 30 })
  );
  await page.route("**/api/observability/jobs/job-1/cancel", (route) =>
    fulfillJson(route, { error: "Cannot cancel output run" }, 500)
  );
  await page.goto(scopedPath("projects/workspace"));
  await page
    .getByTestId("pane-roster")
    .getByRole("button", { name: /Review agent Review changes/ })
    .click();
  const output = page.getByTestId("pane-output");
  await output.getByRole("button", { name: /widgets/ }).click();
  const cancel = output.getByRole("button", { name: "Cancel", exact: true });
  await cancel.click();
  await expect(
    page.getByText("Cannot cancel output run", { exact: true })
  ).toBeVisible();
  await expect(cancel).toBeEnabled();
});

for (const paneType of ["cron", "triggers"] as const) {
  test(`failed ${paneType} toggles preserve the enabled item and report the server error`, async ({
    page,
  }) => {
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page);
    const sessions: Session[] = [
      {
        id: "legacy-workspace",
        index: 0,
        name: "Legacy workspace",
        color: "green",
        activeId: "legacy",
        paneTree: {
          id: "legacy",
          type: paneType,
          name: paneType,
          lines: [],
          status: "idle",
        },
      },
    ];
    await page.addInitScript(
      (state) =>
        localStorage.setItem(
          "mogplex-sessions",
          JSON.stringify({ state, version: 3 })
        ),
      { sessions, activeSessionId: "legacy-workspace" }
    );
    const trigger: TriggerWithAgent = {
      id: "trigger-1",
      user_id: "user-1",
      installation_id: 1,
      agent_id: agent.id,
      event: "pr_opened",
      is_default: false,
      enabled: true,
      created_at: assignment.created_at,
      agents: agent,
    };
    const installations: Installation[] = [
      {
        id: "installation-1",
        installation_id: 1,
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
        repositories: [],
      },
    ];
    await page.route("**/api/github/installations", (route) =>
      fulfillJson(route, installations)
    );
    const path = paneType === "cron" ? "assignments" : "triggers";
    await page.route(`**/api/${path}**`, (route) =>
      fulfillJson(
        route,
        route.request().method() === "GET"
          ? paneType === "cron"
            ? [{ ...assignment, type: "cron", cron_schedule: "0 9 * * *" }]
            : [trigger]
          : { error: "Cannot change enabled state" },
        route.request().method() === "GET" ? 200 : 403
      )
    );
    await page.goto(scopedPath("projects/workspace"));
    const pane = page.getByTestId("pane-legacy");
    const toggle = pane.getByRole("button").first();
    await toggle.click();
    await expect(
      page.getByText("Cannot change enabled state", { exact: true })
    ).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveClass(/bg-accent-green/);
  });
}
