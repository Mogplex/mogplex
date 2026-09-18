import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

const repo = {
  id: "repo-1",
  full_name: "acme/widgets",
  owner: "acme",
  name: "widgets",
  default_branch: "main",
};

const longContent = `${"Prefers pnpm over npm. ".repeat(40)}END-OF-MEMORY`;

const memoriesPayload = {
  session: [],
  semantic: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      lane: "semantic",
      content: longContent,
      metadata: { repo_id: repo.id, source: "memories-pane" },
      created_at: "2026-09-10T00:00:00.000Z",
      updated_at: "2026-09-10T00:00:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      lane: "semantic",
      content: "Charles signs off on all pricing numbers.",
      metadata: { source: "promotion" },
      created_at: "2026-09-11T00:00:00.000Z",
      updated_at: "2026-09-11T00:00:00.000Z",
    },
  ],
  episodic: [],
  procedural: [],
  counts: { session: 3, semantic: 2, episodic: 11266, procedural: 0 },
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("memories page shows exact lane totals, origin chips, and prunes noise", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "openai/gpt-5", theme: "dark" })
  );
  await page.route("**/api/memberships", (route) => fulfillJson(route, []));
  await page.route("**/api/repos", (route) => fulfillJson(route, [repo]));
  await page.route("**/api/memories?**", (route) =>
    fulfillJson(route, memoriesPayload)
  );
  await page.route("**/api/memories", (route) =>
    fulfillJson(route, memoriesPayload)
  );
  const actions: string[] = [];
  await page.route("**/api/memories/actions", async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    actions.push(body.action);
    await fulfillJson(route, {
      ok: true,
      pruned: { harnessPrompts: 3, automationOutcomes: 11266 },
    });
  });

  await page.goto(scopedPath("agents/context"));
  // Agents is a primary destination: the sidebar highlights it, not Settings.
  await expect(page.getByTestId("app-nav-agents")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.getByTestId("app-nav-settings")).not.toHaveAttribute(
    "aria-current",
    "page"
  );

  // Lane tabs show exact server totals, not the 50-row page size.
  await expect(page.getByRole("button", { name: "Facts (2)" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Events (11266)" })
  ).toBeVisible();
  await expect(page.getByText("11271 stored")).toBeVisible();

  // Facts is the default lane; cards carry repo and origin chips.
  const cards = page.getByTestId("memory-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first().getByText("acme/widgets")).toBeVisible();
  await expect(
    cards.nth(1).getByText("promoted from a checkpoint")
  ).toBeVisible();

  // Long content collapses until the reader asks for it.
  await expect(cards.first()).not.toContainText("END-OF-MEMORY");
  await cards.first().getByRole("button", { name: "Show more" }).click();
  await expect(cards.first()).toContainText("END-OF-MEMORY");

  // Prune runs the stale-session compaction and the noise purge.
  await page.getByRole("button", { name: "Prune" }).click();
  await expect.poll(() => actions).toEqual(["compact", "prune_noise"]);
});
