import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
  syncedRepo,
} from "./helpers/activation-fixtures";

for (const width of [1280, 390]) {
  test(`late GitHub sync preserves removal and restoration (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page);
    await page.goto(scopedPath("projects/workspace"));
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
    await expect(page.locator('[data-pane-type="agent"]')).toBeVisible();

    let hidden = false;
    await page.route(/\/api\/repos(?:\?.*)?$/, async (route) => {
      const patch = route.request().method() === "PATCH";
      if (patch)
        hidden = (route.request().postDataJSON() as { is_hidden: boolean })
          .is_hidden;
      const repo = { ...syncedRepo, is_hidden: hidden };
      await route.fulfill({ json: patch ? repo : [repo] });
    });
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({ json: [] })
    );
    const sections = page.getByRole("navigation", {
      name: "Projects sections",
    });

    for (const action of ["Remove", "Restore"] as const) {
      let release = () => {};
      let requested = () => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        requested = resolve;
      });
      // Capture the server's visible collection before the user changes it.
      const snapshot = hidden ? [] : [{ ...syncedRepo, is_hidden: false }];
      await page.route("**/api/github/repos", async (route) => {
        requested();
        await pending;
        await route.fulfill({ json: snapshot });
      });
      await sections
        .getByRole("link", { name: "Repositories", exact: true })
        .click();
      await started;
      if (action === "Restore")
        await page
          .getByRole("button", { name: "Show removed", exact: true })
          .click();
      await page
        .getByRole("button", { name: "Repo actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name: action, exact: true }).click();
      await expect(
        page.getByText(
          action === "Remove" ? "Repository removed" : "Repository restored",
          { exact: true }
        )
      ).toBeVisible();
      await sections
        .getByRole("link", { name: "Workspace", exact: true })
        .click();
      await (action === "Remove"
        ? expect(
            page.getByRole("heading", { name: "Repository removed" })
          ).toBeVisible()
        : expect(page.locator('[data-pane-type="agent"]')).toBeVisible());
      release();
      await page.waitForLoadState("networkidle");
      if (action === "Remove") {
        await expect(
          page.getByRole("heading", { name: "Repository removed" })
        ).toBeVisible();
        await expect(page.locator('[data-pane-type="agent"]')).toHaveCount(0);
        await expect(page.locator(".wterm")).toHaveCount(0);
      } else {
        await expect(page.locator('[data-pane-type="agent"]')).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Repository unavailable" })
        ).toHaveCount(0);
      }
      expect(hidden).toBe(action === "Remove");
    }
  });
}
