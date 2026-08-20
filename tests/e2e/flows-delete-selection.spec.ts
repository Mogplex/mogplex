import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
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

test("deleting the selected workflow selects another workflow even when the list revalidation returns stale data", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  const allFlows = [
    buildFlow({ id: "flow-1", name: "Live Review", status: "active" }),
    buildFlow({ id: "flow-2", name: "Paused Merger", status: "inactive" }),
  ];
  let flows = [...allFlows];
  // Simulates SWR deduping the post-delete mutate() into a revalidation that
  // started before the DELETE landed: the first list fetch after deletion
  // still contains the deleted flow.
  let staleListReadsRemaining = 0;

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
  await page.route("**/api/flows", (route) => {
    const stale = staleListReadsRemaining > 0;
    if (stale) staleListReadsRemaining -= 1;
    return fulfillJson(route, stale ? allFlows : flows);
  });
  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "DELETE") {
      flows = flows.filter((flow) => flow.id !== "flow-1");
      staleListReadsRemaining = 1;
      await fulfillJson(route, { success: true });
      return;
    }
    const flow = allFlows.find((candidate) => candidate.id === "flow-1");
    await fulfillJson(route, flow ?? {}, flow ? 200 : 404);
  });
  await page.route("**/api/flows/flow-2", (route) =>
    fulfillJson(
      route,
      allFlows.find((flow) => flow.id === "flow-2")
    )
  );
  await page.route("**/api/flows/*/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [] })
  );

  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(scopedPath("automations"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-1"
  );

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete flow" }).click();

  await expect(
    page
      .locator("li[class*='destructive']")
      .filter({ hasText: "Workflow deleted" })
  ).toBeVisible();

  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-2"
  );
});

test("deleting the selected workflow selects another workflow", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  let flows = [
    buildFlow({ id: "flow-1", name: "Live Review", status: "active" }),
    buildFlow({ id: "flow-2", name: "Paused Merger", status: "inactive" }),
  ];

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
      flows = flows.filter((flow) => flow.id !== "flow-1");
      await fulfillJson(route, { success: true });
      return;
    }
    const flow = flows.find((candidate) => candidate.id === "flow-1");
    await fulfillJson(route, flow ?? {}, flow ? 200 : 404);
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

  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(scopedPath("automations"));
  await page.waitForLoadState("networkidle");

  // flow-1 is selected by default (first visible flow)
  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-1"
  );

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete flow" }).click();

  await expect(
    page
      .locator("li[class*='destructive']")
      .filter({ hasText: "Workflow deleted" })
  ).toBeVisible();

  // After deletion, the selection should switch to the remaining flow (or be
  // cleared) rather than still pointing at the deleted flow.
  await expect(page.getByLabel("Select workflow")).not.toHaveAttribute(
    "data-value",
    "flow-1"
  );
});
