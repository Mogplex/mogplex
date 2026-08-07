import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import {
  setupWorkflowsPage,
  fulfillJson,
} from "./helpers/flows-pane-theme-fixtures";

test("trigger presets configure GitHub, schedules, signed webhooks, and Dependabot reviews", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.route("**/api/flows/flow-1/webhook-secret", (route) =>
    fulfillJson(route, { secret: "whsec_test_generated_once" })
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("flow-trigger-preset-github").click();
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "pr_opened"
  );
  await expect(page.getByTestId("flow-trigger-repository-scope")).toContainText(
    "All repositories"
  );
  await expect(page.locator(".react-flow__node-start")).toContainText("GitHub");

  await page.getByTestId("flow-trigger-preset-schedule").click();
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "schedule"
  );
  await expect(page.getByTestId("flow-trigger-schedule-cron")).toHaveValue(
    "0 9 * * 1-5"
  );
  await expect(page.getByTestId("flow-trigger-schedule-timezone")).toHaveValue(
    "UTC"
  );
  await expect(page.getByTestId("flow-trigger-test-payload")).toContainText(
    '"timezone": "UTC"'
  );
  await expect(page.getByTestId("flow-trigger-test")).toBeDisabled();

  await selectAppOption(page.getByTestId("flow-trigger-event"), "webhook");
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "webhook"
  );
  await expect(page.getByTestId("flow-trigger-repository")).toHaveAttribute(
    "data-value",
    ""
  );
  await selectAppOption(
    page.getByTestId("flow-trigger-repository"),
    "webrenew/blackbox"
  );
  await expect(page.getByTestId("flow-trigger-repository")).toHaveAttribute(
    "data-value",
    "webrenew/blackbox"
  );
  await expect(page.getByTestId("flow-trigger-test-payload")).toHaveValue(
    /"prompt":/
  );
  await page.getByTestId("flow-trigger-test-payload").fill("{");
  await expect(
    page.getByTestId("flow-trigger-test-payload-error")
  ).toContainText("valid JSON");
  await page
    .getByTestId("flow-trigger-test-payload")
    .fill('{\n  "prompt": "Summarize release risk",\n  "release": "1.2.3"\n}');
  await expect(
    page.getByTestId("flow-trigger-test-payload-error")
  ).not.toBeVisible();
  await expect(page.getByTestId("flow-trigger-test-payload")).toHaveValue(
    /Summarize release risk/
  );
  await page.getByTestId("flow-webhook-generate-secret").click();
  await expect(page.getByTestId("flow-webhook-secret-value")).toHaveValue(
    "whsec_test_generated_once"
  );
  await expect(page.locator(".flows-inspector")).toContainText(
    "x-mogplex-signature"
  );
  await page.locator(".react-flow__node-agent").first().click();
  await expect(page.getByTestId("flow-agent-instructions")).toBeVisible();
  await expect(page.locator(".flows-inspector")).toContainText(
    "Instructions / prompt"
  );

  await page.locator(".react-flow__node-start").click();
  await page.getByTestId("flow-trigger-preset-dependabot").click();
  await expect(page.getByTestId("flow-trigger-event")).toHaveAttribute(
    "data-value",
    "pr_opened"
  );
  await expect(page.getByTestId("flow-trigger-author-filter")).toHaveAttribute(
    "data-value",
    "dependabot_only"
  );
});

test("Slack mention trigger selects a connected workspace and channel", async ({
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
    (route) =>
      fulfillJson(route, {
        channels: [{ id: "C1", name: "release-ops", isPrivate: false }],
        nextCursor: null,
      })
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("flow-trigger-preset-slack-mention").click();
  await selectAppOption(page.getByTestId("flow-trigger-slack-workspace"), "T1");
  await selectAppOption(page.getByTestId("flow-trigger-slack-channel"), "C1");
  await expect(page.locator(".flows-inspector")).toContainText(
    "starts the workflow instead of the conversational assistant"
  );
});
