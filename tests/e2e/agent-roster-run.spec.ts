import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";

const enabledModel = {
  id: "minimax/minimax-m2.7",
  provider: "minimax",
  name: "MiniMax M2.7",
  context_length: 1_000_000,
  capabilities: ["tool-use"],
  is_available: true,
};

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

const sharedAgent = {
  id: "33333333-3333-4333-8333-333333333333",
  user_id: "user-1",
  team_id: "44444444-4444-4444-8444-444444444444",
  name: "SECURITY-SWEEP",
  slug: "security-sweep",
  model: enabledModel.id,
  system_prompt: "Look for auth bypasses.",
  description: "Auth and secrets review",
  category: "security",
  source_template: null,
  created_at: "2026-09-01T00:00:00.000Z",
  shared: true,
  owned: true,
  skill_ids: ["skill-1"],
  rule_ids: [],
};

const repo = {
  id: "55555555-5555-4555-8555-555555555555",
  user_id: "user-1",
  full_name: "acme/widgets",
  owner: "acme",
  name: "widgets",
  default_branch: "main",
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("roster shows sharing and usage, attaches skills in the editor, and starts a run as the agent", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  const runRequests: Array<Record<string, unknown>> = [];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModel.id, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [enabledModel],
      catalog: [{ ...enabledModel, is_enabled: true }],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [sharedAgent])
  );
  await page.route("**/api/agents/usage", (route) =>
    fulfillJson(route, {
      [sharedAgent.id]: {
        automations: [{ id: "flow-1", name: "PR-Review", status: "active" }],
        runs: 3,
        lastRunAt: "2026-09-17T00:00:00.000Z",
      },
    })
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(route, [
      { id: "skill-1", name: "Secrets audit", description: "Env exposure" },
      { id: "skill-2", name: "RSC audit", description: null },
    ])
  );
  await page.route("**/api/rules?table=agent_rules", (route) =>
    fulfillJson(route, [
      { id: "rule-1", name: "no-any.md", content: "# No any" },
    ])
  );
  await page.route("**/api/repos", (route) => fulfillJson(route, [repo]));
  await page.route("**/api/agents/run", async (route) => {
    runRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await fulfillJson(
      route,
      {
        replayed: false,
        run: {
          runId: "66666666-6666-4666-8666-666666666666",
          agentId: sharedAgent.id,
          branch: {
            base: "main",
            working: "mogplex/external/abc",
            createBranch: true,
          },
        },
      },
      201
    );
  });

  await page.goto(scopedPath("agents/roster"));

  const card = page
    .locator("div", { has: page.getByText("SECURITY-SWEEP", { exact: true }) })
    .filter({ has: page.getByTestId("agent-shared-badge") })
    .first();
  await expect(card.getByTestId("agent-shared-badge")).toHaveText(
    "Shared with team"
  );
  await expect(card.getByTestId("agent-usage")).toHaveText(
    "1 automation · 3 runs"
  );

  await card.getByRole("button", { name: "Agent actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Agent" });
  await expect(
    dialog.getByRole("checkbox", { name: /Secrets audit/ })
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /RSC audit/ })
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /no-any\.md/ })
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: /Share with team/ })
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await card.getByRole("button", { name: "Run" }).click();
  const runDialog = page.getByRole("dialog", { name: "Run SECURITY-SWEEP" });
  await expect(runDialog.getByLabel("Repository")).toHaveValue(repo.id);
  await runDialog.getByLabel("Harness").selectOption("claude-code");
  await runDialog.getByLabel("Task").fill("Audit the auth routes");
  await runDialog.getByRole("button", { name: "Start run" }).click();

  await expect(runDialog.getByText("Run started on branch")).toBeVisible();
  await expect(runDialog.getByText("mogplex/external/abc")).toBeVisible();
  expect(runRequests).toEqual([
    {
      agentId: sharedAgent.id,
      repoId: repo.id,
      harness: "claude-code",
      prompt: "Audit the auth routes",
    },
  ]);
});
