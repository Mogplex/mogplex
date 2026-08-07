import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import {
  setupWorkflowsPage,
  fulfillJson,
} from "./helpers/flows-pane-theme-fixtures";

test("node library filters and inserts real workflow nodes", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const initialNodeCount = await page.locator(".react-flow__node").count();
  const nodeSearch = page.getByPlaceholder("Search nodes…");
  await nodeSearch.fill("await");

  await expect(page.getByTestId("flow-library-add-await_event")).toBeVisible();
  await expect(page.getByTestId("flow-library-add-agent")).not.toBeVisible();
  await page.getByTestId("flow-library-add-await_event").click();

  await expect(page.locator(".react-flow__node")).toHaveCount(
    initialNodeCount + 1
  );
  await expect(page.locator(".flows-inspector")).toContainText(
    "Await event operator"
  );
  const waitKind = page.getByLabel("Wait kind");
  await waitKind.click();
  await expect(page.getByRole("option")).toHaveText([
    "GitHub label added",
    "GitHub comment added",
    "GitHub Actions / CI completed",
    "Vercel preview ready",
    "Manual approval",
  ]);
  await page
    .locator('[role="option"][data-value="github_label_added"]')
    .click();
  await selectAppOption(waitKind, "github_comment_added");
  await expect(page.getByTestId("flow-await-comment-contains")).toBeVisible();
  await expect(page.getByTestId("flow-await-comment-author")).toBeVisible();
  await expect(
    page.getByText("Match the issue or pull request that started this run")
  ).toBeVisible();
  await selectAppOption(waitKind, "manual_approval");
  await expect(
    page.getByPlaceholder("e.g. Approve production deployment")
  ).toBeVisible();
});

test("action search exposes sandbox, Slack thread, and GitHub outcome inspectors", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const nodeSearch = page.getByPlaceholder("Search nodes…");
  await nodeSearch.fill("sandbox");
  const runCommand = page.getByTestId(
    "flow-library-add-action-sandbox-run-command"
  );
  await expect(runCommand).toBeVisible();
  await expect(
    page.getByTestId("flow-library-add-action-slack-send-message")
  ).not.toBeVisible();
  await runCommand.click();

  await expect(page.getByTestId("flow-action-operation")).toHaveAttribute(
    "data-value",
    "sandbox.run_command"
  );
  await page.getByTestId("flow-action-command").fill("pnpm lint");
  await page.getByTestId("flow-action-working-directory").fill("apps/web");
  await expect(page.locator(".flows-inspector")).toContainText(
    "reuse that workflow workspace"
  );

  await nodeSearch.fill("slack");
  await page.getByTestId("flow-library-add-action-slack-send-message").click();
  await expect(page.getByTestId("flow-action-operation")).toHaveAttribute(
    "data-value",
    "slack.send_message"
  );
  await expect(page.locator(".flows-inspector")).toContainText(
    "Connect Slack before publishing"
  );
  await expect(page.getByTestId("flow-action-slack-workspace")).toBeVisible();
  await expect(page.getByTestId("flow-action-slack-channel")).toBeDisabled();
  await expect(page.getByTestId("flow-action-slack-message")).toBeVisible();
  await selectAppOption(
    page.getByTestId("flow-action-slack-destination"),
    "trigger_thread"
  );
  await expect(
    page.getByTestId("flow-action-slack-workspace")
  ).not.toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "replies in the thread that started the workflow"
  );

  await nodeSearch.fill("github comment");
  await page.getByTestId("flow-library-add-action-github-post-comment").click();
  const operation = page.getByTestId("flow-action-operation");
  await expect(operation).toHaveAttribute("data-value", "github.post_comment");
  await expect(
    page.getByTestId("flow-action-github-target-number")
  ).toBeVisible();
  await expect(page.getByTestId("flow-action-github-comment")).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "limited to the workflow repository"
  );

  await selectAppOption(operation, "github.create_issue");
  await expect(
    page.getByTestId("flow-action-github-issue-title")
  ).toBeVisible();
  await expect(
    page.getByTestId("flow-action-github-issue-labels")
  ).toBeVisible();

  await selectAppOption(operation, "github.update_labels");
  await expect(page.getByTestId("flow-action-github-add-labels")).toBeVisible();
  await expect(
    page.getByTestId("flow-action-github-remove-labels")
  ).toBeVisible();

  await selectAppOption(operation, "github.set_status");
  await expect(
    page.getByTestId("flow-action-github-status-state")
  ).toHaveAttribute("data-value", "success");
  await expect(
    page.getByTestId("flow-action-github-status-context")
  ).toHaveValue("mogplex/workflow");

  await selectAppOption(operation, "github.submit_review");
  await expect(
    page.getByTestId("flow-action-github-review-event")
  ).toHaveAttribute("data-value", "COMMENT");
  await expect(
    page.getByTestId("flow-action-github-review-body")
  ).toBeVisible();

  await selectAppOption(operation, "github.merge_pull_request");
  await expect(
    page.getByTestId("flow-action-github-merge-target")
  ).toBeVisible();
  await expect(
    page.getByTestId("flow-action-github-merge-title")
  ).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "branch protection"
  );
});

test("Slack action selector loads channels beyond the first page", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.unroute("**/api/integrations/slack/installations");
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, {
      installations: [{ teamId: "T1", teamName: "Mogplex" }],
    })
  );
  await page.route(
    /\/api\/integrations\/slack\/installations\/T1\/channels(?:\?.*)?$/,
    (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      return fulfillJson(
        route,
        cursor === "page-2"
          ? {
              channels: [{ id: "C201", name: "release-ops", isPrivate: false }],
              nextCursor: null,
            }
          : {
              channels: [{ id: "C001", name: "engineering", isPrivate: false }],
              nextCursor: "page-2",
            }
      );
    }
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Search nodes…").fill("slack");
  await page.getByTestId("flow-library-add-action-slack-send-message").click();
  await selectAppOption(page.getByTestId("flow-action-slack-workspace"), "T1");

  const channelSelect = page.getByTestId("flow-action-slack-channel");
  await channelSelect.click();
  await expect(page.locator('[role="option"][data-value="C001"]')).toHaveCount(
    1
  );
  await expect(page.locator('[role="option"][data-value="C201"]')).toHaveCount(
    0
  );
  await page.locator('[role="option"][data-value="C001"]').click();

  await page.getByTestId("flow-action-slack-load-more").click();
  await channelSelect.click();
  await expect(page.locator('[role="option"][data-value="C201"]')).toHaveCount(
    1
  );
  await page.locator('[role="option"][data-value="C201"]').click();
  await expect(
    page.getByTestId("flow-action-slack-load-more")
  ).not.toBeVisible();
});
