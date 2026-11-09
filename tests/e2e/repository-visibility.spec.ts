import { expect, test } from "@playwright/test";
import {
  connected,
  dashboard,
  repoLink,
} from "./helpers/repository-settings-fixtures";

test("connected repositories are grouped by GitHub owner and open on GitHub in a new tab", async ({
  page,
}) => {
  await dashboard(page);
  await expect(connected(page).getByRole("heading", { level: 2 })).toHaveText([
    "acme",
    "alex",
    "team",
  ]);
  const alex = connected(page).getByRole("region", {
    name: "alex",
    exact: true,
  });
  await expect(alex.getByText("2 repositories")).toBeVisible();
  await expect(
    alex.getByRole("link", { name: "alex", exact: true })
  ).toHaveAttribute("href", "https://github.com/alex");
  const alpha = repoLink(page, "alex/alpha");
  await expect(alpha).toHaveText("alpha");
  await expect(alpha).toHaveAttribute("href", "https://github.com/alex/alpha");
  await expect(alpha).toHaveAttribute("target", "_blank");
  await expect(alpha).toHaveAttribute("rel", "noopener noreferrer");
});

test("repositories without the GitHub App stay out of the list and can be removed together", async ({
  page,
}) => {
  const { writes } = await dashboard(page);
  await expect(connected(page).getByText("skhard99")).toHaveCount(0);
  await expect(
    page
      .getByLabel("Owner", { exact: true })
      .locator("option", { hasText: "skhard99" })
  ).toHaveCount(0);
  // Removed legacy rows are not offered for restore either.
  await expect(
    page.getByRole("button", { name: "Show removed (1)" })
  ).toBeVisible();

  const notice = page.getByRole("region", {
    name: "Not connected repositories",
  });
  await expect(notice.getByText("2 repositories not connected")).toBeVisible();
  await notice.getByText("Show repositories").click();
  // An owner with the App installed is told the repository isn't selected,
  // not that the App is missing.
  await expect(
    notice.getByRole("listitem").filter({ hasText: "alex/legacy" })
  ).toContainText("not selected in the GitHub App's repository access");
  await expect(
    notice.getByRole("listitem").filter({ hasText: "skhard99/docs" })
  ).toContainText("GitHub App not installed for this owner");
  await notice
    .getByRole("button", { name: "Remove all not-connected repositories" })
    .click();
  const dialog = page.getByRole("alertdialog", {
    name: "Remove 2 not-connected repositories?",
  });
  await expect(dialog).toContainText(
    "add them to an existing installation's repository access"
  );
  await dialog.getByRole("button", { name: "Remove 2 repositories" }).click();
  await expect(notice).toHaveCount(0);
  expect(writes).toEqual([
    { id: "alex-legacy", is_hidden: true },
    { id: "fork", is_hidden: true },
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
  await expect(repoLink(page, "alex/alpha")).toHaveCount(0);
  await expect(repoLink(page, "alex/beta")).toHaveCount(0);
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
  await expect(repoLink(page, "alex/alpha")).toBeVisible();
  await page.reload();
  await expect(repoLink(page, "alex/alpha")).toBeVisible();
  await expect(repoLink(page, "alex/beta")).toHaveCount(0);
});

test("bulk removal waits for confirmation", async ({ page }) => {
  const { writes } = await dashboard(page);
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await page
    .getByRole("button", { name: "Remove all from alex", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(repoLink(page, "alex/alpha")).toBeVisible();
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
  await expect(repoLink(page, "alex/removed")).toHaveCount(0);
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
  await expect(repoLink(page, "alex/alpha")).toHaveCount(0);
  await expect(repoLink(page, "alex/beta")).toBeVisible();
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
  await expect(repoLink(page, "alex/alpha")).toBeVisible();
  await expect(repoLink(page, "alex/beta")).toBeVisible();
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
  await expect(repoLink(page, "alex/alpha")).toBeVisible();
});

test("removing one repository waits for confirmation", async ({ page }) => {
  const { writes } = await dashboard(page);
  await page.getByRole("button", { name: "Remove alex/alpha" }).click();
  await page
    .getByRole("alertdialog", { name: "Remove alex/alpha?" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(repoLink(page, "alex/alpha")).toBeVisible();
  expect(writes).toEqual([]);

  await page.getByRole("button", { name: "Remove alex/alpha" }).click();
  await page
    .getByRole("alertdialog", { name: "Remove alex/alpha?" })
    .getByRole("button", { name: "Remove repository" })
    .click();
  await expect(
    page.getByText("Repository removed", { exact: true })
  ).toBeVisible();
  await expect(repoLink(page, "alex/alpha")).toHaveCount(0);
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

test("the not-connected card waits for filters to clear and shows removal progress", async ({
  page,
}) => {
  await dashboard(page);
  const notice = page.getByRole("region", {
    name: "Not connected repositories",
  });
  await expect(notice).toBeVisible();
  await page.getByLabel("Search repositories").fill("alpha");
  await expect(notice).toHaveCount(0);
  await page.getByLabel("Search repositories").fill("");
  await expect(notice).toBeVisible();

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/repos**", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await held;
    return route.fallback();
  });
  await notice
    .getByRole("button", { name: "Remove all not-connected repositories" })
    .click();
  await page
    .getByRole("alertdialog", { name: "Remove 2 not-connected repositories?" })
    .getByRole("button", { name: "Remove 2 repositories" })
    .click();
  await expect(
    notice.getByRole("button", {
      name: "Remove all not-connected repositories",
    })
  ).toHaveText("Removing 0/2…");
  release();
  await expect(notice).toHaveCount(0);
});

test("Show removed counts only the removed repositories the filters would show", async ({
  page,
}) => {
  await dashboard(page);
  await page.getByLabel("Owner", { exact: true }).selectOption("team");
  await expect(page.getByRole("button", { name: /Show removed/ })).toHaveCount(
    0
  );
  await page.getByLabel("Owner", { exact: true }).selectOption("alex");
  await expect(
    page.getByRole("button", { name: "Show removed (1)" })
  ).toBeVisible();
});

test("the signed-in GitHub account's repositories are listed first", async ({
  page,
}) => {
  await dashboard(page, [], "team");
  await expect(connected(page).getByRole("heading", { level: 2 })).toHaveText([
    "team",
    "acme",
    "alex",
  ]);
});
