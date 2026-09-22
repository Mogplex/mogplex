import { expect, test } from "@playwright/test";
import {
  buildE2EAuthHeaders,
  enableScopedE2EAuth,
  E2E_SCOPE_USER,
  scopedPath,
} from "./helpers/auth";
import {
  fulfillJson,
  mockSettingsShell,
} from "./helpers/billing-settings-fixtures";

test.beforeEach(async ({ page }) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);
  await page.route("**/api/settings/decision-checks", (route) =>
    fulfillJson(route, { enabled: true, viewer: { canManage: true } })
  );
});

test("Connections has its own navigation destination outside Settings", async ({
  page,
}) => {
  await page.goto(scopedPath("settings"));
  await expect(page.getByTestId("settings-nav-mcp")).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Connections", exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to main navigation" }).click();
  await page.getByTestId("app-nav-connections").click();
  await expect(page).toHaveURL(scopedPath("connections"));
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("app-nav-connections")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByTestId("app-nav-settings")).not.toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByTestId("settings-preset-neon")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Install to Slack" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true })
  ).toBeVisible();
});

for (const legacy of [
  "settings?tab=connections&oauth=success",
  "settings?oauth=success#connections",
]) {
  test(`legacy ${legacy} preserves the OAuth result`, async ({ page }) => {
    await page.goto(scopedPath(legacy));
    await expect(
      page.getByText(
        "OAuth connection established. Run a test to verify tools."
      )
    ).toBeVisible();
    await expect(page).toHaveURL(scopedPath("connections"));
  });
}

test("legacy Slack returns reach Connections and show the result", async ({
  page,
}) => {
  await page.goto(scopedPath("settings?slack=connected&team=T123"));
  await expect(
    page.getByText("Slack workspace connected", { exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(scopedPath("connections"));
});

test("Team Connections does not load personal connections inside a team scope", async ({
  page,
}) => {
  const team = {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "acme",
    name: "Acme",
    iconUrl: null,
    role: "owner",
  };
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(E2E_SCOPE_USER.id),
    "x-mogplex-scope-kind": "team",
    "x-mogplex-scope-slug": team.slug,
    "x-mogplex-scope-id": team.id,
  });
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: { slug: "alex", name: "Alex", avatarUrl: null },
      teams: [team],
    })
  );
  const connectionRequests: string[] = [];
  await page.route("**/api/connections", (route) => {
    connectionRequests.push(route.request().method());
    return fulfillJson(route, { connections: [] });
  });
  await page.route("**/api/mcp-servers", (route) => {
    connectionRequests.push("MCP");
    return fulfillJson(route, { servers: [] });
  });
  await page.goto("/acme/settings?tab=connections");
  await expect(page).toHaveURL("/acme/connections");
  await expect(
    page.getByRole("link", { name: "Open personal connections" })
  ).toHaveAttribute("href", "/alex/connections");
  await expect(page.getByTestId("settings-preset-neon")).toHaveCount(0);
  expect(connectionRequests).toEqual([]);
  await page.goto("/acme/settings/mcp");
  await expect(page).toHaveURL("/acme/connections?tab=mcp");
  await expect(
    page.getByRole("link", { name: "Open personal connections" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add server" })).toHaveCount(0);
  expect(connectionRequests).toEqual([]);
});

test("Connections tabs preserve selection through history and reload on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let mcpReads = 0;
  await page.route("**/api/mcp-servers", (route) => {
    mcpReads += 1;
    return fulfillJson(route, { servers: [] });
  });
  await page.goto(scopedPath("connections?keep=1"));
  const integrations = page.getByRole("tab", {
    name: "Integrations",
    exact: true,
  });
  const mcp = page.getByRole("tab", { name: "MCP Servers", exact: true });
  await expect(integrations).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("settings-preset-neon")).toBeVisible();
  expect(mcpReads).toBe(0);
  await mcp.click();
  await expect(page).toHaveURL(scopedPath("connections?keep=1&tab=mcp"));
  await expect(mcp).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Add server" })).toBeVisible();
  await expect(page.getByTestId("settings-preset-neon")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to Settings" })
  ).toHaveCount(0);
  await page.reload();
  await expect(mcp).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Add server" })).toBeVisible();
  await integrations.click();
  await expect(page).toHaveURL(scopedPath("connections?keep=1"));
  await page.goBack();
  await expect(mcp).toHaveAttribute("aria-selected", "true");
  const bounds = await page
    .getByRole("tablist", { name: "Connections sections" })
    .boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

for (const legacy of [
  "settings/mcp?keep=1",
  "settings?tab=mcp&keep=1",
  "settings?keep=1#mcp",
]) {
  test(`legacy ${legacy} opens the Connections MCP tab`, async ({ page }) => {
    await page.route("**/api/mcp-servers", (route) =>
      fulfillJson(route, { servers: [] })
    );
    await page.goto(scopedPath(legacy));
    await expect(page).toHaveURL(scopedPath("connections?keep=1&tab=mcp"));
    await expect(
      page.getByRole("heading", { name: "Connections", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "MCP Servers", exact: true })
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("button", { name: "Add server" })
    ).toBeVisible();
    await expect(page.getByTestId("app-nav-connections")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
}

test("Connections keeps service actions visible on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scopedPath("connections"));
  const card = page.getByTestId("settings-preset-neon");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "+ Add" }).click();
  await expect(card.getByPlaceholder("Neon API key")).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});
