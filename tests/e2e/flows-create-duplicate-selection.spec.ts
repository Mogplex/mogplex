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

type FlowFixture = ReturnType<typeof buildFlow>;

// Shared mock scaffolding. The returned `reads` object simulates SWR deduping
// the post-write mutate() into a revalidation that started before the write
// landed: the first list fetch after a create/duplicate still lacks the new
// flow.
async function stubFlowsSurface(
  page: import("@playwright/test").Page,
  initialFlows: FlowFixture[]
) {
  let flows = [...initialFlows];
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
    if (route.request().method() === "POST") {
      const created = buildFlow({
        id: "flow-3",
        name: "Blank workflow",
        status: "inactive",
      });
      flows = [...flows, created];
      staleListReadsRemaining = 1;
      return fulfillJson(route, created, 201);
    }
    const stale = staleListReadsRemaining > 0;
    if (stale) staleListReadsRemaining -= 1;
    return fulfillJson(
      route,
      stale ? flows.filter((flow) => flow.id !== "flow-3") : flows
    );
  });
  await page.route("**/api/flows/flow-1/duplicate", (route) => {
    const duplicate = buildFlow({
      id: "flow-3",
      name: "Live Review Copy",
      status: "inactive",
    });
    flows = [...flows, duplicate];
    staleListReadsRemaining = 1;
    return fulfillJson(route, duplicate);
  });
  await page.route("**/api/flows/flow-1", (route) =>
    fulfillJson(
      route,
      flows.find((flow) => flow.id === "flow-1")
    )
  );
  await page.route("**/api/flows/flow-2", (route) =>
    fulfillJson(
      route,
      flows.find((flow) => flow.id === "flow-2")
    )
  );
  await page.route("**/api/flows/flow-3", (route) =>
    fulfillJson(
      route,
      flows.find((flow) => flow.id === "flow-3")
    )
  );
  await page.route("**/api/flows/*/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [] })
  );

  return {
    markNextListReadStale: () => {
      staleListReadsRemaining = 1;
    },
  };
}

const initialFlows = () => [
  buildFlow({ id: "flow-1", name: "Live Review", status: "active" }),
  buildFlow({ id: "flow-2", name: "Paused Merger", status: "inactive" }),
];

test("duplicating the selected workflow selects the copy even when the list revalidation returns stale data", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await stubFlowsSurface(page, initialFlows());

  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(scopedPath("automations"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-1"
  );

  await page.getByRole("button", { name: "Duplicate flow" }).click();

  await expect(
    page.locator("li").filter({ hasText: "Flow duplicated" })
  ).toBeVisible();

  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-3"
  );
});

test("creating a workflow selects it even when the list revalidation returns stale data", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await stubFlowsSurface(page, initialFlows());

  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(scopedPath("automations"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-1"
  );

  await page.getByRole("button", { name: "New automation" }).click();
  await page
    .getByTestId("flow-template-picker")
    .getByRole("button", { name: "Blank workflow" })
    .click();

  await expect(
    page.locator("li").filter({ hasText: "Workflow created" })
  ).toBeVisible();

  await expect(page.getByLabel("Select workflow")).toHaveAttribute(
    "data-value",
    "flow-3"
  );
});
