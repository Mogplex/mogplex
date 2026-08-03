import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import type { Route } from "@playwright/test";

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
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

function buildFlow(input: {
  id: string;
  name: string;
  status: "active" | "inactive";
}) {
  return {
    id: input.id,
    installation_id: 101,
    name: input.name,
    description: "",
    notes: "",
    source_kind: "github",
    status: input.status,
    last_run_status: null,
    published_version_id: null,
    published_version: null,
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 0, y: 160 },
          data: { label: "Start", config: { event: "pr_opened", filter: {} } },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}

test("workflow picker surfaces active/inactive status and deletion shows a destructive toast", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": connectedUser.username,
    "x-mogplex-scope-id": connectedUser.id,
  });

  let flows = [
    buildFlow({ id: "flow-1", name: "Live Review", status: "active" }),
    buildFlow({ id: "flow-2", name: "Paused Merger", status: "inactive" }),
  ];
  let deleteCalls = 0;

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [], catalog: [] })
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
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
  await page.route("**/api/flows", (route) => fulfillJson(route, flows));
  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "DELETE") {
      deleteCalls += 1;
      flows = flows.filter((flow) => flow.id !== "flow-1");
      await fulfillJson(route, { success: true });
      return;
    }
    await fulfillJson(route, flows[0] ?? {}, flows[0] ? 200 : 404);
  });
  await page.route("**/api/flows/flow-2", (route) =>
    fulfillJson(
      route,
      flows.find((flow) => flow.id === "flow-2")
    )
  );
  await page.route("**/api/flows/*/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [] })
  );

  // At 1280px the centered flow-name pill overlaps the header action buttons
  // (it is hidden below xl); widen past the collision so Delete is clickable.
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  // The label row summarizes how many workflows are live without opening
  // the picker.
  await expect(page.getByTestId("flow-active-count")).toHaveText("1/2 active");

  // The open picker doubles as the status overview: every workflow is listed
  // with its active/inactive state exposed to accessibility queries.
  await page.getByLabel("Select workflow").click();
  await expect(
    page.getByRole("option", { name: "Live Review (active)" })
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Paused Merger (inactive)" })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Deleting the selected workflow confirms with a red (destructive) toast
  // that names the deleted workflow.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete flow" }).click();

  await expect.poll(() => deleteCalls).toBe(1);
  const toast = page
    .locator("li[class*='destructive']")
    .filter({ hasText: "Workflow deleted" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('"Live Review" was permanently deleted.');
});
