import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";

for (const width of [1280, 390]) {
  test(`terminal shows recorded agent commands and keeps the shell available (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page);
    let activityRequests = 0;
    let failLoad = true;
    await page.route("**/api/observability/calls?**", async (route) => {
      const url = new URL(route.request().url());
      const scoped = url.searchParams.has("sandbox_record_id");
      if (scoped) {
        activityRequests++;
        expect(url.searchParams.get("repo_id")).toBe("repo-1");
        if (failLoad)
          return route.fulfill({
            status: 500,
            json: { error: "Activity unavailable" },
          });
      }
      await route.fulfill({
        json: {
          calls: scoped
            ? [
                {
                  id: "agent-call",
                  model: "model",
                  status: "success",
                  started_at: "2026-10-10T12:00:00Z",
                  metadata: {},
                },
              ]
            : [],
          total: scoped ? 1 : 0,
        },
      });
    });
    await page.route("**/api/observability/call-events?**", async (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: "start",
              ai_call_id: "agent-call",
              event_type: "tool_started",
              tool_name: "bash",
              message: null,
              created_at: "2026-10-10T12:00:00Z",
              payload: {
                tool_call_id: "cmd",
                input: { command: "pnpm build" },
              },
            },
            {
              id: "end",
              ai_call_id: "agent-call",
              event_type: "tool_finished",
              tool_name: "bash",
              message: null,
              created_at: "2026-10-10T12:00:01Z",
              payload: {
                tool_call_id: "cmd",
                success: true,
                output: { stdout: "Build completed successfully", exitCode: 0 },
              },
            },
          ],
        },
      })
    );
    await page.goto(scopedPath("projects/workspace"));
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
    if (width === 390)
      await page.getByRole("button", { name: "Terminal", exact: true }).click();
    const terminal = page.locator('[data-pane-type="terminal"]');
    const activity = terminal.getByRole("region", { name: "Agent commands" });
    await activity.getByRole("button", { name: "Show agent output" }).click();
    await expect(activity.getByRole("alert")).toContainText(
      "Unable to load agent commands"
    );
    failLoad = false;
    await activity.getByRole("button", { name: "Retry" }).click();
    await expect(activity).toContainText("pnpm build");
    await expect(activity).toContainText("Build completed successfully");
    await expect(activity.getByText("pnpm build", { exact: true })).toHaveCount(
      1
    );
    await expect(terminal.locator(".wterm")).toBeVisible();
    expect(activityRequests).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath(`agent-terminal-${width}.png`),
    });
  });
}
