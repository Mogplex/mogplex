import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";

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

const modelId = "minimax/minimax-m2.5";

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

type TriggerPayload = {
  installation_id?: number;
  agent_id?: string;
  event?: string;
  is_default?: boolean;
};

test("triggers installation combobox shows scope and supports repo-name search", async ({
  page,
}) => {
  let postedTrigger: TriggerPayload | undefined;

  await enableScopedE2EAuth(page);

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      { id: "repo-1", full_name: "acme/web-app", github_installation_id: 101 },
      { id: "repo-2", full_name: "acme/api", github_installation_id: 101 },
      {
        id: "repo-3",
        full_name: "alex/personal-tool",
        github_installation_id: 202,
      },
    ])
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: modelId, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, context_length: 128000, is_enabled: true }],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      { id: "agent-1", name: "Triage", slug: "triage", model: modelId },
      { id: "agent-2", name: "CI Watcher", slug: "ci-watcher", model: modelId },
    ])
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [
      {
        id: "inst-org",
        installation_id: 101,
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
        repositories: [
          { id: "repo-1", full_name: "acme/web-app" },
          { id: "repo-2", full_name: "acme/api" },
        ],
      },
      {
        id: "inst-user",
        installation_id: 202,
        account_login: "alex",
        account_type: "User",
        target_type: "User",
        repositories: [{ id: "repo-3", full_name: "alex/personal-tool" }],
      },
    ])
  );
  await page.route("**/api/triggers", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, []);
      return;
    }

    const payload = route.request().postDataJSON() as TriggerPayload;
    postedTrigger = payload;
    await fulfillJson(
      route,
      {
        id: "trigger-1",
        installation_id: payload.installation_id,
        agent_id: payload.agent_id,
        event: payload.event,
        enabled: true,
        is_default: payload.is_default,
        agents: {
          id: "agent-2",
          name: "CI Watcher",
          slug: "ci-watcher",
          model: modelId,
        },
      },
      201
    );
  });

  await page.goto(scopedPath("triggers"));
  await page.waitForLoadState("networkidle");

  const emptyState = page.getByTestId("triggers-empty-state");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText("Create your first triggered agent");
  await expect(emptyState).toContainText("Choose an installation");

  await page.getByRole("button", { name: "Create first trigger" }).click();

  const combobox = page.getByTestId("trigger-installation-combobox");
  await combobox.click();
  await expect(page.getByText("acme/web-app, acme/api")).toBeVisible();
  await expect(page.getByText("alex/personal-tool")).toBeVisible();

  await page
    .getByPlaceholder("Search installations or repos...")
    .fill("personal-tool");
  await page.getByRole("option", { name: /alex/i }).click();
  await page.keyboard.press("Escape");

  await expect(combobox).toContainText("alex");
  await expect(combobox).toContainText("User · alex/personal-tool");

  await page
    .locator("select")
    .filter({ has: page.locator('option[value="agent-2"]') })
    .last()
    .selectOption("agent-2");
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="ci_failure"]') })
    .first()
    .selectOption("ci_failure");
  await page.getByRole("button", { name: "Create" }).click();

  const submittedTrigger = postedTrigger;
  expect(submittedTrigger).toBeTruthy();
  if (!submittedTrigger) {
    throw new Error("Trigger payload was not captured");
  }
  expect(submittedTrigger.installation_id).toBe(202);
  expect(submittedTrigger.agent_id).toBe("agent-2");
  expect(submittedTrigger.event).toBe("ci_failure");
});

test("triggers empty state explains missing GitHub App installations", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, {
      user: {
        ...connectedUser,
        github_app_connected: false,
        github_connection_mode: "oauth",
      },
    })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "alex/personal-tool",
        github_installation_id: null,
      },
      { id: "repo-2", full_name: "alex/infra", github_installation_id: null },
    ])
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: modelId, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, context_length: 128000, is_enabled: true }],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      { id: "agent-1", name: "Triage", slug: "triage", model: modelId },
    ])
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/triggers", (route) => fulfillJson(route, []));

  await page.goto(scopedPath("triggers"));
  await page.waitForLoadState("networkidle");

  const emptyState = page.getByTestId("triggers-empty-state");
  await expect(emptyState).toContainText("No GitHub App installations found");
  await expect(emptyState).toContainText("2 synced repos");
  await expect(
    page.getByRole("link", { name: "Install GitHub App" })
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Install GitHub App" })
    .first()
    .evaluate((node) => node.getAttribute("href"));

  await page
    .getByRole("link", { name: "Install GitHub App" })
    .first()
    .isVisible();
  await page
    .getByRole("link", { name: "Install GitHub App" })
    .first()
    .evaluate((node) => {
      if (
        !(node instanceof HTMLAnchorElement) ||
        node.getAttribute("href") !== "/api/auth/github"
      ) {
        throw new Error("Expected install CTA to target /api/auth/github");
      }
    });

  await page.getByRole("button", { name: "New trigger" }).click();
  await expect(
    page.getByText("Install the GitHub App to create triggers")
  ).toBeVisible();
  await expect(
    page.getByText("Current connection: GitHub OAuth")
  ).toBeVisible();
});
