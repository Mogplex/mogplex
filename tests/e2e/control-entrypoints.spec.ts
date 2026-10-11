import { expect, test } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { scopedPath } from "./helpers/auth";

test("opening a repository selects its most recent task without starting work", async ({
  page,
}) => {
  const { sessions, mutations } = await mockControlWorkspace(page);
  sessions[0].updated_at = "2026-10-10T12:00:00Z";
  sessions[1].updated_at = "2026-10-10T13:00:00Z";
  const chats: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/control/chat")
    )
      chats.push(request.url());
  });
  for (const resource of ["workspaces", "agents", "assignments", "memberships"])
    await page.route(`**/api/${resource}`, (route) =>
      route.fulfill({ json: [] })
    );
  await page.goto(scopedPath("projects/repositories"));
  await page
    .getByRole("button", { name: "Open Workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/mission=task-two/);
  await expect(
    page.getByRole("banner").getByText("Review billing flow", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open preview", exact: true })
  ).toBeVisible();
  expect(mutations).toEqual([]);
  expect(chats).toEqual([]);
});

test("a repository with no task opens a composer for that repository", async ({
  page,
}) => {
  const { sessions, mutations } = await mockControlWorkspace(page);
  sessions.splice(0);
  await page.goto(scopedPath("control?repo=repo-widgets"));
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true })
  ).toHaveText("acme/widgets");
  await expect(page.getByRole("textbox").last()).toBeVisible();
  await expect(page).toHaveURL(/repo=repo-widgets/);
  expect(mutations).toEqual([]);
});

test("an unavailable repository entry shows a recoverable error", async ({
  page,
}) => {
  await mockControlWorkspace(page);
  await page.goto(scopedPath("control?repo=missing"));
  await expect(
    page.getByRole("alert").filter({ hasText: "Repository is not available" })
  ).toContainText("Repository is not available");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.route("**/api/repos**", (route) =>
    route.fulfill({
      json: [
        {
          id: "missing",
          full_name: "acme/restored",
          name: "restored",
          owner: "acme",
        },
      ],
    })
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true })
  ).toHaveText("acme/restored");
});
