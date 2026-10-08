import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockActivationFlow } from "./helpers/activation-fixtures";
import { buildObservabilitySummary } from "./helpers/sandbox-fixtures";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";

for (const width of [390, 1280]) {
  for (const snapshot of ["current", "legacy", "missing"] as const) {
    test(`Slack run repository is readable at ${width}px with ${snapshot} metadata`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await enableScopedE2EAuth(page);
      await mockActivationFlow(page);
      const metadata = {
        run_origin: "slack",
        ...(snapshot === "current"
          ? { repo_full_name: "webrenew/gtm-supahost" }
          : {}),
        ...(snapshot === "legacy" ? { repo: "webrenew/gtm-supahost" } : {}),
        slack: { mode: "repo_agent", attribution_mode: "mapped_profile" },
      };
      await page.route("**/api/observability/stats*", (route) =>
        fulfillJson(route, buildObservabilitySummary([]))
      );
      // The actual target isn't in the current workspace's repository picker.
      await page.route("**/api/repos*", (route) =>
        fulfillJson(route, [
          { id: "context-repo", full_name: "Mogplex/mogplex" },
        ])
      );
      await page.route("**/api/observability/calls*", (route) =>
        fulfillJson(route, {
          calls: [
            {
              id: "slack-call",
              type: "agent",
              model: "openai/gpt-6-astra-fast",
              repo_id: "actual-target",
              status: "streaming",
              metadata,
              started_at: new Date().toISOString(),
              tool_calls: [],
              tool_calls_count: 0,
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
        })
      );
      await page.route("**/api/observability/call-events*", (route) =>
        fulfillJson(route, { events: [] })
      );
      await page.goto(scopedPath("observability?call_id=slack-call"));
      const summary = page.getByLabel("Run repository", { exact: true });
      const details = page.getByLabel("Run repository details", {
        exact: true,
      });
      await expect(summary).toHaveText(
        snapshot === "missing"
          ? "Repository not recorded"
          : "webrenew/gtm-supahost"
      );
      await expect(details).toContainText(
        snapshot === "missing" ? "Not recorded" : "webrenew/gtm-supahost"
      );
      await expect(details).not.toContainText("Mogplex/mogplex");
      // No horizontal scroll, hover, raw event JSON, or open workspace needed.
      for (const label of [summary, details]) {
        await expect(label).toBeVisible();
        const box = await label.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    });
  }
}
