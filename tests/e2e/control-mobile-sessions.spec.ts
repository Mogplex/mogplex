import { expect, test, type Page } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

async function installSessions(page: Page) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos**", (route) =>
    fulfillJson(route, [
      {
        id: "repo-alpha",
        full_name: "acme/alpha",
        owner: "acme",
        name: "alpha",
        default_branch: "main",
      },
      {
        id: "repo-widgets",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  const sessions = ["First", "Second"].map((title, index) => ({
    id: `session-${index}`,
    title: `${title} investigation`,
    project: "acme/widgets",
    repo_id: "repo-widgets",
    pinned: false,
    archived: false,
    created_at: "2026-10-03T00:00:00.000Z",
    updated_at: "2026-10-03T00:00:00.000Z",
    messages: [
      {
        id: `message-${index}`,
        role: "assistant",
        parts: [{ type: "text", text: `${title} saved response` }],
      },
    ],
  }));
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id)
      return fulfillJson(
        route,
        sessions.find((session) => session.id === id)
      );
    return fulfillJson(
      route,
      sessions.map(({ messages: _messages, ...summary }) => summary)
    );
  });
}

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("mobile drawer starts a new session in the current project and closes", async ({
  page,
}) => {
  await installSessions(page);
  // A stored desktop collapse must not turn the phone drawer into an icon rail.
  await page.addInitScript(() =>
    localStorage.setItem("mogplex.sessionList.collapsed", "true")
  );
  await page.goto(`${scopedPath("control")}?mission=session-0`);
  await expect(
    page.getByText("First saved response", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "Sessions", exact: true });
  await expect(
    drawer.getByRole("separator", { name: "Resize sheet", includeHidden: true })
  ).toBeHidden();
  await expect(
    drawer.getByRole("button", { name: /^Second investigation/ })
  ).toBeVisible();
  await drawer
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByPlaceholder("Ask anything or run a command...")
  ).toBeVisible();
  await expect(page.getByLabel("Project", { exact: true })).toContainText(
    "acme/widgets"
  );
});

test("mobile drawer switches sessions and stays available from the new composer", async ({
  page,
}) => {
  await installSessions(page);
  await page.goto(scopedPath("control"));
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "Sessions", exact: true });
  await drawer.getByRole("button", { name: /^Second investigation/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByText("Second saved response", { exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(/mission=session-1/);
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  await drawer.getByRole("button", { name: /^First investigation/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page).toHaveURL(/mission=session-0/);
  await expect(
    page.getByRole("banner").getByText("First investigation", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("First saved response", { exact: true }).last()
  ).toBeVisible();
});

test("desktop keeps its sessions sidebar without a mobile trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installSessions(page);
  await page.goto(`${scopedPath("control")}?mission=session-0`);
  await expect(
    page.getByRole("complementary", { name: "Sessions", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open sessions", exact: true })
  ).not.toBeVisible();
});

test("mobile drawer hands search focus to the command palette", async ({
  page,
}) => {
  await installSessions(page);
  await page.goto(`${scopedPath("control")}?mission=session-0`);
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "Sessions", exact: true });
  await drawer.getByRole("button", { name: /Search/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByPlaceholder("Search projects, settings, and actions...")
  ).toBeFocused();
});

test("resizing to desktop dismisses the mobile overlay", async ({ page }) => {
  await installSessions(page);
  await page.goto(`${scopedPath("control")}?mission=session-0`);
  await page
    .getByRole("button", { name: "Open sessions", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sessions", exact: true })
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("dialog", { name: "Sessions", exact: true })
  ).not.toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Sessions", exact: true })
  ).toBeVisible();
});
