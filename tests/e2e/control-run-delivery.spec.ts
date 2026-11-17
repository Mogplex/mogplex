import { expect, test } from "@playwright/test";
import { setupControlSidebar } from "./helpers/control-sidebar-fixture";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";
import { deliverySnapshot } from "@/lib/run-delivery/fixtures.test-support";

for (const mobile of [false, true])
  test(`delivery shows separate PR, checks, merge and production evidence (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }) => {
    const { sessions } = await setupControlSidebar(page);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const runId = "00000000-0000-4000-8000-000000000901";
    sessions[0].external_run_id = runId;
    const context: RunWorkspaceContext = {
      runId,
      aiCallId: "00000000-0000-4000-8000-000000000902",
      prompt: "Implement SSH signing and open a PR",
      status: "success",
      sandboxRecordId: null,
      workingBranch: "feature/signing",
      canGuide: false,
      delivery: null,
      deliveryFollowThrough: true,
      repo: {
        id: "repo-1",
        user_id: "owner",
        full_name: "acme/widgets",
        created_at: "2026-11-17T00:00:00Z",
      },
    };
    const receipt = deliverySnapshot();
    receipt.checks.state = "pending";
    receipt.checks.failed = [];
    await page.route("**/api/runs/*/workspace", (route) =>
      route.fulfill({ json: context })
    );
    await page.route("**/api/runs/*/stream?*", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: `event: run\ndata: ${JSON.stringify(context)}\n\nevent: replay_complete\ndata: {}\n\n`,
      })
    );
    let fail = false;
    let refreshes = 0;
    let starts = 0;
    await page.route("**/api/runs/*/checkpoint", (route) => {
      starts++;
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected approval" },
      });
    });
    await page.route("**/api/runs/*/delivery", (route) => {
      refreshes++;
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: "Temporarily unavailable" },
        });
      context.delivery = receipt;
      return route.fulfill({ json: { delivery: receipt } });
    });
    await page.reload();
    const delivery = page.getByRole("region", { name: "Delivery progress" });
    await expect(
      page.getByText("Agent finished", { exact: true })
    ).toBeVisible();
    await expect(delivery).toContainText(
      "Delivery status has not been checked"
    );
    const refresh = delivery.getByRole("button", { name: "Refresh delivery" });
    await refresh.click();
    await expect(
      delivery.getByRole("link", { name: "#42 · Open" })
    ).toHaveAttribute("href", "https://github.com/acme/widgets/pull/42");
    await expect(delivery).toContainText("Checks running");
    await expect(delivery).toContainText("Not merged");
    await expect(delivery).toContainText("No deployment reported");
    receipt.checks.state = "failure";
    receipt.checks.failed = ["unit tests"];
    context.deliveryLastRepairRevision = receipt.repairRevision;
    await refresh.click();
    await expect(delivery).toContainText("Checks failing: unit tests");
    await expect(delivery).toContainText("Needs attention");
    await page.screenshot({
      path: test.info().outputPath("delivery-needs-attention.png"),
    });
    receipt.checks.state = "success";
    receipt.checks.failed = [];
    receipt.review.state = "required";
    await refresh.click();
    await expect(delivery).toContainText("Checks passed · Review required");
    await expect(delivery).toContainText("Not merged");
    receipt.pullRequest!.state = "merged";
    receipt.pullRequest!.mergeSha = "merge-1";
    await refresh.click();
    await expect(
      delivery.getByRole("link", { name: "#42 · Merged" })
    ).toBeVisible();
    await expect(delivery).toContainText("No deployment reported");
    receipt.deployment.state = "success";
    await refresh.click();
    await expect(delivery).toContainText("Deployment reported successful");
    fail = true;
    await refresh.click();
    await expect(delivery.getByRole("alert")).toContainText(
      "Could not refresh delivery status"
    );
    await expect(delivery).toContainText("Deployment reported successful");
    expect(refreshes).toBe(6);
    expect(starts).toBe(0);
    await expect(refresh).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("delivery-progress.png"),
    });
  });
