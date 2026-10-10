import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
  syncedRepo,
} from "./helpers/activation-fixtures";

for (const width of [1280, 390]) {
  test(`cached workspace requires restoration before reopening a removed repo (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    const fixture = await mockActivationFlow(page);
    await page.goto(scopedPath("projects/workspace"));
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
    await expect(page.locator('[data-pane-type="agent"]')).toBeVisible();

    let hidden = true;
    let restoreFails = true;
    let loadFails = false;
    const runtimeWrites: string[] = [];
    fixture.setSandboxState("repo-1", { status: "paused" });
    await page.route(/\/api\/repos(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "PATCH") {
        const patch = route.request().postDataJSON() as {
          id: string;
          is_hidden: boolean;
        };
        expect(patch.id).toBe("repo-1");
        expect(typeof patch.is_hidden).toBe("boolean");
        if (restoreFails)
          return route.fulfill({ status: 500, json: { error: "Unavailable" } });
        hidden = patch.is_hidden;
      }
      if (loadFails)
        return route.fulfill({ status: 500, json: { error: "Unavailable" } });
      return route.fulfill({
        json:
          route.request().method() === "PATCH"
            ? { ...syncedRepo, is_hidden: hidden }
            : [{ ...syncedRepo, is_hidden: hidden }],
      });
    });
    await page.route(/\/api\/sandbox(?:\/.*)?$/, (route) => {
      if (route.request().method() === "POST") {
        const path = new URL(route.request().url()).pathname;
        // Unloading the previously open workspace must release its presence.
        const releasing =
          path.endsWith("/presence") &&
          route.request().postDataJSON().event === "release";
        if (!releasing) runtimeWrites.push(path);
      }
      return route.fallback();
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Repository removed" })
    ).toBeVisible();
    await expect(page.locator('[data-pane-type="agent"]')).toHaveCount(0);
    await expect(page.locator(".wterm")).toHaveCount(0);
    expect(runtimeWrites).toEqual([]);
    await page
      .getByRole("button", { name: "Restore repository", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Could not restore repository" })
    ).toBeVisible();
    expect(hidden).toBe(true);
    expect(runtimeWrites).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`removed-workspace-${width}.png`),
    });

    loadFails = true;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Could not load repository" })
    ).toBeVisible();
    expect(runtimeWrites).toEqual([]);
    loadFails = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Repository removed" })
    ).toBeVisible();
    restoreFails = false;
    fixture.setSandboxState("repo-1", { status: "running" });
    await page
      .getByRole("button", { name: "Restore repository", exact: true })
      .click();
    await expect(page.locator('[data-pane-type="agent"]')).toBeVisible();
    expect(hidden).toBe(false);
    await page.reload();
    await expect(page.locator('[data-pane-type="agent"]')).toBeVisible();

    await page.route("**/api/workspaces", (route) =>
      route.fulfill({ json: [] })
    );
    const sections = page.getByRole("navigation", {
      name: "Projects sections",
    });
    await sections
      .getByRole("link", { name: "Repositories", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Repo actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
    await expect(
      page.getByText("Repository removed", { exact: true })
    ).toBeVisible();
    await sections
      .getByRole("link", { name: "Workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Repository removed" })
    ).toBeVisible();
    await expect(page.locator(".wterm")).toHaveCount(0);
    if (width === 1280) {
      await page.getByTestId("session-tab-1").click({ button: "right" });
      await expect(
        page.getByRole("menuitem", {
          name: "Start fresh sandbox…",
          exact: true,
        })
      ).toHaveCount(0);
    }
  });
}
