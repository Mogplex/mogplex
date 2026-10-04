import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import type { Connection } from "@/lib/types";
import {
  buildUiMessageStreamBody,
  fulfillJson,
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";
import {
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

async function checkNames(page: Page, info: TestInfo, surface: string) {
  const result = await new AxeBuilder({ page })
    .withRules(["button-name", "aria-dialog-name"])
    .analyze();
  await info.attach(`${surface}-accessible-names`, {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.violations).toEqual([]);
}

test("Control code actions have accessible names", async ({ page }, info) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/connections**", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody(
        "```typescript\nconst accessible = true;\n```"
      ),
    })
  );
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Show an example");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByRole("button", { name: /^Copy code$/i })
  ).toBeVisible();
  await checkNames(page, info, "control");
});

test("workspace announces sandbox and connection status without colour", async ({
  page,
}, info) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  let connections: Connection[] = [];
  await page.route(/\/api\/(?:repos\/[^/]+\/)?connections(?:\?.*)?$/, (route) =>
    fulfillJson(route, { connections, overrides: [] })
  );
  await page.route(/\/api\/chat(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody(
        "```typescript\nconst accessible = true;\n```"
      ),
    })
  );
  await page.goto(scopedPath("projects/workspace"));
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^ready$/ })
      .first()
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "No connections" })
  ).toHaveCount(1);
  const composer = page.getByRole("textbox", {
    name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
  });
  await composer.fill("Show an example");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: /^Copy code$/i })
  ).toBeVisible();
  await checkNames(page, info, "workspace");
  connections = [
    {
      id: "connection-1",
      user_id: "user-1",
      name: "Example tools",
      type: "mcp_server",
      base_url: null,
      auth_type: "none",
      auth_header: null,
      mcp_transport: "http",
      mcp_url: "https://example.com/mcp",
      description: null,
      is_enabled: true,
      approval_mode: "auto",
      health_status: "healthy",
      scope: "global",
      repo_id: null,
      oauth_client_id: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      oauth_scopes: null,
      oauth_authorized_at: null,
      oauth_token_expires_at: null,
      source_preset: null,
      last_tested_at: null,
      last_test_error: null,
      last_test_http_status: null,
      last_test_tool_count: null,
      created_at: "2026-10-04T00:00:00Z",
      updated_at: "2026-10-04T00:00:00Z",
    },
  ];
  await page.getByRole("button", { name: /^Tools:/ }).click();
  const connectionsDialog = page.getByRole("dialog", { name: "MCP servers" });
  await connectionsDialog
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "All connections healthy" })
  ).toHaveCount(1);
  await expect(connectionsDialog.getByRole("status")).toHaveText("Healthy");
  connections[0] = { ...connections[0], health_status: "unreachable" };
  await connectionsDialog
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Some connections failed" })
  ).toHaveCount(1);
  await expect(connectionsDialog.getByRole("status")).toHaveText("Unreachable");
  await checkNames(page, info, "workspace-connections");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("acme/demo-app");
  const openWorkspace = palette.getByRole("option", {
    name: /Open workspace.*acme\/demo-app/,
  });
  await expect(openWorkspace).toBeVisible();
  await expect(openWorkspace.getByRole("status")).toHaveText("Running");
  await expect(
    palette.getByRole("status").filter({ hasText: "Running" }).first()
  ).toHaveCount(1);
  await checkNames(page, info, "workspace-palette");
});
