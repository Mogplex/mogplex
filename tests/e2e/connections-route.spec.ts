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
  await expect(
    page.getByRole("tab", { name: "Connections", exact: true })
  ).toHaveCount(0);
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
  await page.goto("/acme/settings?tab=connections");
  await expect(page).toHaveURL("/acme/connections");
  await expect(
    page.getByRole("link", { name: "Open personal connections" })
  ).toHaveAttribute("href", "/alex/connections");
  await expect(page.getByTestId("settings-preset-neon")).toHaveCount(0);
  expect(connectionRequests).toEqual([]);
});

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
