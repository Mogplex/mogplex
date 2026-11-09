import { expect, test, type Page } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

async function dashboard(page: Page, failedIds: string[] = []) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  const repos = [
    {
      id: "alpha",
      name: "alpha",
      full_name: "alex/alpha",
      owner: "alex",
      github_installation_id: 11,
      is_hidden: false,
    },
    {
      id: "beta",
      name: "beta",
      full_name: "alex/beta",
      owner: "alex",
      is_hidden: false,
    },
    {
      id: "removed",
      name: "removed",
      full_name: "alex/removed",
      owner: "alex",
      is_hidden: true,
    },
    {
      id: "other",
      name: "other",
      full_name: "team/other",
      owner: "team",
      is_hidden: false,
    },
  ];
  const writes: { id: string; is_hidden: boolean }[] = [];
  await page.route("**/api/repos**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        id: string;
        is_hidden: boolean;
      };
      writes.push(body);
      if (failedIds.includes(body.id))
        return fulfillJson(route, { error: "Database unavailable" }, 500);
      const repo = repos.find((row) => row.id === body.id)!;
      repo.is_hidden = body.is_hidden;
      return fulfillJson(route, repo);
    }
    return fulfillJson(route, repos);
  });
  await page.route("**/api/github/repos", (route) =>
    fulfillJson(
      route,
      repos.filter((repo) => !repo.is_hidden)
    )
  );
  for (const name of ["workspaces", "agents", "assignments", "memberships"]) {
    await page.route(`**/api/${name}`, (route) => fulfillJson(route, []));
  }
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.goto("/alex/settings/repositories");
  await expect(page.getByRole("button", { name: "Sync GitHub" })).toBeEnabled();
  return { repos, writes };
}

const connected = (page: Page) =>
  page.getByRole("region", { name: "Connected repositories" });

test("connected repositories are grouped by owner and flag owners without the GitHub App", async ({
  page,
}) => {
  await dashboard(page);
  const alex = connected(page).getByRole("region", {
    name: "alex",
    exact: true,
  });
  const team = connected(page).getByRole("region", {
    name: "team",
    exact: true,
  });

  await expect(alex.getByRole("heading", { name: "alex" })).toBeVisible();
  await expect(alex.getByText("2 repositories")).toBeVisible();
  await expect(alex.getByText("alex/alpha")).toBeVisible();
  await expect(alex.getByText("team/other")).toHaveCount(0);
  await expect(alex.getByText("GitHub App connected")).toBeVisible();
  await expect(alex.getByText("Not connected")).toHaveCount(0);
  await expect(team.getByText("team/other")).toBeVisible();
  await expect(team.getByText("Not connected")).toBeVisible();
  await expect(
    team.getByText(/PR reviews and automations never run here/)
  ).toBeVisible();
  // App-connected owners are listed before owners without the App.
  await expect(connected(page).getByRole("heading", { level: 2 })).toHaveText([
    "alex",
    "team",
  ]);
});

test("remove owner persists, and a removed repository can be restored", async ({
  page,
}) => {
  const { writes } = await dashboard(page);
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await page
    .getByRole("button", { name: "Remove all from alex", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Remove all 2 repositories from alex?" })
    .getByRole("button", { name: "Remove 2 repositories" })
    .click();
  await expect(connected(page).getByText("alex/alpha")).toHaveCount(0);
  await expect(connected(page).getByText("alex/beta")).toHaveCount(0);
  await expect(
    page
      .locator('[data-variant="info"]')
      .filter({ hasText: "Removed 2 repositories" })
  ).toBeVisible();
  expect(writes).toEqual([
    { id: "alpha", is_hidden: true },
    { id: "beta", is_hidden: true },
  ]);
  await page.getByRole("button", { name: /Show removed/ }).click();
  await page.getByRole("button", { name: "Restore alex/alpha" }).click();
  await expect(
    page.getByText("Repository restored", { exact: true })
  ).toBeVisible();
  await expect(connected(page).getByText("alex/alpha")).toBeVisible();
  await page.reload();
  await expect(connected(page).getByText("alex/alpha")).toBeVisible();
  await expect(connected(page).getByText("alex/beta")).toHaveCount(0);
});

test("bulk removal waits for confirmation", async ({ page }) => {
  const { writes } = await dashboard(page);
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await page
    .getByRole("button", { name: "Remove all from alex", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(connected(page).getByText("alex/alpha")).toBeVisible();
  expect(writes).toEqual([]);
});

test("bulk removal stays available while a search hides that owner's repositories", async ({
  page,
}) => {
  await dashboard(page);
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await page.getByLabel("Search repositories").fill("no-such-repo");

  await expect(
    page.getByRole("button", { name: "Remove all from alex", exact: true })
  ).toBeVisible();
});

test("restore failures show a retryable error and leave the repository removed", async ({
  page,
}) => {
  await dashboard(page, ["removed"]);
  await page.getByRole("button", { name: /Show removed/ }).click();
  await page.getByLabel("Search repositories").fill("removed");
  await page.getByRole("button", { name: "Restore alex/removed" }).click();
  await expect(
    page.getByText("Could not restore alex/removed", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Database unavailable", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Repository restored", { exact: true })
  ).toHaveCount(0);
  await expect(connected(page).getByText("alex/removed")).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Removed repositories" })
      .getByText("alex/removed")
  ).toBeVisible();
});

test("bulk removal reports partial failures without claiming every repository was removed", async ({
  page,
}) => {
  await dashboard(page, ["beta"]);
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await page
    .getByRole("button", { name: "Remove all from alex", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Remove all 2 repositories from alex?" })
    .getByRole("button", { name: "Remove 2 repositories" })
    .click();
  await expect(
    page.getByText("Could not remove all repositories", { exact: true })
  ).toBeVisible();
  await expect(
    page
      .locator('[data-variant="warning"]')
      .filter({ hasText: "Could not remove all repositories" })
  ).toBeVisible();
  await expect(
    page.getByText("1 removed; 1 could not be removed. Database unavailable", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText("Removed 2 repositories", { exact: true })
  ).toHaveCount(0);
  await expect(connected(page).getByText("alex/alpha")).toHaveCount(0);
  await expect(connected(page).getByText("alex/beta")).toBeVisible();
});

test("bulk removal reports a full failure when no repositories were removed", async ({
  page,
}) => {
  await dashboard(page, ["alpha", "beta"]);
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await page
    .getByRole("button", { name: "Remove all from alex", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Remove all 2 repositories from alex?" })
    .getByRole("button", { name: "Remove 2 repositories" })
    .click();
  const failure = page
    .locator('[data-variant="destructive"]')
    .filter({ hasText: "Could not remove all repositories" });
  await expect(failure).toContainText("0 removed; 2 could not be removed.");
  await expect(connected(page).getByText("alex/alpha")).toBeVisible();
  await expect(connected(page).getByText("alex/beta")).toBeVisible();
});

test("network failures during removal are visible", async ({ page }) => {
  await dashboard(page);
  await page.route("**/api/repos**", (route) =>
    route.request().method() === "PATCH"
      ? route.abort("failed")
      : route.fallback()
  );
  await page.getByRole("button", { name: "Remove alex/alpha" }).click();
  await page
    .getByRole("alertdialog", { name: "Remove alex/alpha?" })
    .getByRole("button", { name: "Remove repository" })
    .click();
  await expect(
    page.getByText("Could not remove alex/alpha", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      "Could not reach Mogplex. Check your connection and try again.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(connected(page).getByText("alex/alpha")).toBeVisible();
});

test("removing one repository waits for confirmation", async ({ page }) => {
  const { writes } = await dashboard(page);
  await page.getByRole("button", { name: "Remove alex/alpha" }).click();
  await page
    .getByRole("alertdialog", { name: "Remove alex/alpha?" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(connected(page).getByText("alex/alpha")).toBeVisible();
  expect(writes).toEqual([]);

  await page.getByRole("button", { name: "Remove alex/alpha" }).click();
  await page
    .getByRole("alertdialog", { name: "Remove alex/alpha?" })
    .getByRole("button", { name: "Remove repository" })
    .click();
  await expect(
    page.getByText("Repository removed", { exact: true })
  ).toBeVisible();
  await expect(connected(page).getByText("alex/alpha")).toHaveCount(0);
  expect(writes).toEqual([{ id: "alpha", is_hidden: true }]);
});

test("project settings open from a repository with no sessions", async ({
  page,
}) => {
  await dashboard(page);
  await page.getByRole("button", { name: "Settings for alex/beta" }).click();
  const drawer = page.getByRole("dialog", { name: "Project settings" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("alex/beta")).toBeVisible();
  await expect(
    drawer.getByRole("tab", { name: "Environment variables" })
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    drawer.getByRole("button", { name: "Save variables" })
  ).toBeVisible();
});

test("an owner without the GitHub App can be removed in one step", async ({
  page,
}) => {
  const { writes } = await dashboard(page);
  await page
    .getByRole("button", {
      name: "Remove all not-connected repositories from team",
    })
    .click();
  await page
    .getByRole("alertdialog", { name: "Remove all 1 repository from team?" })
    .getByRole("button", { name: "Remove 1 repository" })
    .click();
  await expect(connected(page).getByText("team/other")).toHaveCount(0);
  expect(writes).toEqual([{ id: "other", is_hidden: true }]);
});
