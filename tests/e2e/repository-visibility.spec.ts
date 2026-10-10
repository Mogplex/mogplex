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
  await page.goto("/alex/projects/repositories");
  await expect(page.getByRole("button", { name: "Sync GitHub" })).toBeEnabled();
  return { repos, writes };
}

test("remove owner persists, and a removed repository can be restored", async ({
  page,
}) => {
  const { writes } = await dashboard(page);
  await page.getByRole("combobox").selectOption("alex");
  await page.getByRole("button", { name: "Remove alex", exact: true }).click();
  await expect(page.getByText("alpha", { exact: true })).toHaveCount(0);
  await expect(page.getByText("beta", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([
    { id: "alpha", is_hidden: true },
    { id: "beta", is_hidden: true },
  ]);
  await page.getByRole("button", { name: "Show removed" }).click();
  await page
    .getByRole("button", { name: "Repo actions", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(
    page.getByText("Repository restored", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Hide removed" }).click();
  await expect(page.getByText("alpha", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("beta", { exact: true })).toHaveCount(0);
});

test("restore failures show a retryable error and leave the repository removed", async ({
  page,
}) => {
  await dashboard(page, ["removed"]);
  await page.getByRole("button", { name: "Show removed" }).click();
  await page.getByPlaceholder("Search spaces...").fill("removed");
  await page.getByRole("button", { name: "Repo actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(
    page.getByText("Could not restore repository", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Repository restored", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hide removed" }).click();
  await expect(page.getByText("removed", { exact: true })).toHaveCount(0);
});

test("bulk removal reports partial failures without claiming every repository was removed", async ({
  page,
}) => {
  await dashboard(page, ["beta"]);
  await page.getByRole("combobox").selectOption("alex");
  await page.getByRole("button", { name: "Remove alex", exact: true }).click();
  await expect(
    page.getByText("Could not remove all repositories", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("1 removed; 1 could not be removed. Try again.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText("Removed 2 repositories", { exact: true })
  ).toHaveCount(0);
  await expect(page.getByText("alpha", { exact: true })).toHaveCount(0);
  await expect(page.getByText("beta", { exact: true })).toBeVisible();
});

test("network failures during removal are visible", async ({ page }) => {
  await dashboard(page);
  await page.route("**/api/repos**", (route) =>
    route.request().method() === "PATCH"
      ? route.abort("failed")
      : route.fallback()
  );
  await page
    .getByRole("button", { name: "Repo actions", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(
    page.getByText("Could not remove repository", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("alpha", { exact: true })).toBeVisible();
});
