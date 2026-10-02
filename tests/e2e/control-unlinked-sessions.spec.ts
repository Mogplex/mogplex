import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("unlinked legacy sessions show truthful repository context and retain saved history", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  const sessions = [
    {
      id: "legacy",
      title: "Legacy investigation",
      project: "widgets",
      repo_id: null,
    },
    {
      id: "linked",
      title: "Linked investigation",
      project: "acme/widgets",
      repo_id: "repo",
    },
  ].map((session) => ({
    ...session,
    pinned: false,
    archived: false,
    model_id: null,
    orchestration_run_id: null,
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    messages: [
      {
        id: `${session.id}-message`,
        role: "assistant",
        parts: [{ type: "text", text: `Saved ${session.id} history` }],
      },
    ],
  }));
  await page.route("**/api/repos**", (route) =>
    fulfillJson(route, [
      {
        id: "repo",
        full_name: "acme/widgets",
        name: "widgets",
        owner: "acme",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id ? sessions.find((session) => session.id === id) : sessions
    );
  });
  await page.goto(scopedPath("/control"));
  const unlinked = page.getByRole("button", {
    name: "Unlinked 1",
    exact: true,
  });
  await expect(unlinked).toBeVisible();
  await expect(unlinked).toHaveAttribute(
    "title",
    "This session has no linked repository. Start a new mission to link one."
  );
  await expect(
    page.getByRole("button", { name: "acme/widgets 1", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: /^Legacy investigation/ }).click();
  await expect(
    page.getByText("Saved legacy history", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("header").getByText("Unlinked", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "View on GitHub" })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Linked investigation/ }).click();
  await expect(
    page.getByText("Saved linked history", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("header").getByText("acme/widgets", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "View on GitHub" })
  ).toBeVisible();
});
