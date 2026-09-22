import {
  test,
  expect,
  fulfillJson,
  mockTeamSettings,
  TEAM_SETTINGS_PATH,
} from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { capacitySummary } from "./helpers/billing";

test.beforeEach(async ({ page }) => {
  await enableScopedE2EAuth(page);
  await page.route("**/api/settings/decision-checks", (route) =>
    fulfillJson(route, { enabled: true, viewer: { canManage: true } })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/settings/api-keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/mcp-servers", (route) =>
    fulfillJson(route, { servers: [] })
  );
});

test("Settings drills into page navigation and back restores the main menu", async ({
  page,
}) => {
  await page.goto(scopedPath("settings/account"));
  const nav = page.getByRole("navigation", { name: "Settings", exact: true });
  await expect(nav).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to main navigation" }).click();
  await expect(page.getByTestId("app-nav-connections")).toBeVisible();
  await expect(page).toHaveURL(scopedPath("settings/account"));
  await page.getByTestId("app-nav-settings").click();
  await expect(nav).toBeVisible();
  for (const [label, route] of [
    ["Teams", "teams"],
    ["Provider Keys", "keys"],
    ["Mogplex Keys", "mogplex-keys"],
    ["Account", "account"],
  ]) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(scopedPath(`settings/${route}`));
    await expect(
      page.getByRole("heading", { name: label, exact: true }).first()
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: label, exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("tab")).toHaveCount(0);
  }
  await page.reload();
  await expect(
    nav.getByRole("link", { name: "Account", exact: true })
  ).toHaveAttribute("aria-current", "page");
});

test("Billing has separate settings and usage, with history and reload support", async ({
  page,
}) => {
  const summary = capacitySummary();
  summary.recentCosts = [
    {
      operationId: "usage-1",
      description: "Repository review",
      status: "settled",
      occurredAt: "2026-09-22T12:00:00Z",
      totalCents: 125,
      items: [],
    },
  ];
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(route, summary)
  );
  await page.goto(scopedPath("settings/billing"));
  await expect(
    page.getByRole("tab", { name: "Billing Settings", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Add inference credit" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent usage costs" })
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Usage", exact: true }).click();
  await expect(page).toHaveURL(scopedPath("settings/billing?tab=usage"));
  await expect(
    page.getByText("Repository review", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("$1.25", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add inference credit" })
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Usage", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "Billing Settings", exact: true })
  ).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(
    page.getByText("Repository review", { exact: true })
  ).toBeVisible();
});

test("mobile Settings navigation opens, selects a page and closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(route, { ...capacitySummary(), recentCosts: [] })
  );
  await page.goto(scopedPath("settings/account"));
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  await dialog.getByRole("button", { name: "Back to main navigation" }).click();
  await expect(
    dialog.getByRole("link", { name: "Settings", exact: true })
  ).toBeFocused();
  await dialog.getByRole("link", { name: "Settings", exact: true }).click();
  await dialog.getByRole("link", { name: "Billing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(scopedPath("settings/billing"));
  await page.getByRole("tab", { name: "Usage", exact: true }).click();
  await expect(page.getByText("No usage costs yet.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Navigation" })
      .getByRole("link", { name: "Billing", exact: true })
  ).toBeVisible();
});

test("team Settings has team pages and limits Audit access", async ({
  page,
}) => {
  await mockTeamSettings(page, "viewer");
  await page.goto(TEAM_SETTINGS_PATH);
  await expect(page).toHaveURL(`${TEAM_SETTINGS_PATH}/members`);
  const nav = page.getByRole("navigation", { name: "Settings", exact: true });
  await expect(
    nav.getByRole("link", { name: "Members", exact: true })
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Account", exact: true })
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Audit", exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.goto(`${TEAM_SETTINGS_PATH}/audit`);
  await expect(
    page.getByText("Only a team owner or admin can view the audit log.")
  ).toBeVisible();
});

test("old key links open the right page and preserve unrelated query values", async ({
  page,
}) => {
  await page.goto(scopedPath("settings?tab=keys&sub=cli&keep=1"));
  await expect(page).toHaveURL(scopedPath("settings/mogplex-keys?keep=1"));
  await expect(
    page.getByRole("heading", { name: "Mogplex Keys", exact: true })
  ).toBeVisible();
  await page.goto(scopedPath("settings#teams"));
  await expect(page).toHaveURL(scopedPath("settings/teams"));
});

test("Settings expands a compact sidebar and preserves the main menu width", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("mogplex.appSidebar.width", "64");
    localStorage.setItem("mogplex.appSidebar.collapsed", "true");
    localStorage.setItem("mogplex-theme", "dark");
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { theme: "dark" })
  );
  await page.goto(scopedPath("settings/billing"));
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-compact", "false");
  await expect(page.getByTestId("settings-nav-billing")).toBeVisible();
  await page
    .getByRole("button", { name: "Back to main navigation" })
    .press("Enter");
  await expect(sidebar).toHaveAttribute("data-compact", "true");
  await page.getByTestId("app-nav-settings").press("Enter");
  await expect(sidebar).toHaveAttribute("data-compact", "false");
  await expect(page.getByTestId("settings-nav-account")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(
    page.getByRole("heading", { name: "Account", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Run checks" })).toBeEnabled();
});

test("team owners can open Keys and Audit as pages", async ({ page }) => {
  await mockTeamSettings(page, "owner");
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  const nav = page.getByRole("navigation", { name: "Settings", exact: true });
  await nav.getByRole("link", { name: "Provider Keys", exact: true }).click();
  await expect(page).toHaveURL(`${TEAM_SETTINGS_PATH}/keys`);
  await expect(
    page.getByRole("heading", { name: "Provider Keys", exact: true })
  ).toBeVisible();
  await nav.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page).toHaveURL(`${TEAM_SETTINGS_PATH}/audit`);
  await expect(
    page.getByRole("heading", { name: "Audit", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.reload();
  await expect(
    nav.getByRole("link", { name: "Audit", exact: true })
  ).toHaveAttribute("aria-current", "page");
});

test("Back restores focus and reentering Billing opens its Settings menu", async ({
  page,
}) => {
  await page.route("**/api/skills/catalog", (route) =>
    fulfillJson(route, { skills: [] })
  );
  await page.route("**/api/observability/calls**", (route) =>
    fulfillJson(route, { calls: [] })
  );
  await page.goto(scopedPath("settings/billing"));
  await page
    .getByRole("button", { name: "Back to main navigation" })
    .press("Enter");
  await expect(page.getByTestId("app-nav-settings")).toBeFocused();
  await page.getByTestId("app-nav-connections").click();
  await expect(page).toHaveURL(scopedPath("connections"));
  await page.getByRole("link", { name: "Manage billing", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Settings", exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("settings-nav-billing")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(
    page.getByRole("separator", { name: "Resize app navigation" })
  ).toHaveCount(0);
});
