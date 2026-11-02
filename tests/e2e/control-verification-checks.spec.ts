import { expect, test, type Page } from "@playwright/test";
import type { UIMessage } from "ai";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";
import { captureRecoveryEvents } from "./helpers/control-recovery-fixtures";
import { CHECK_KINDS } from "../../lib/agents/orchestrator/checks/plan";
import type { RepositoryVerificationSummary } from "../../lib/agents/orchestrator/checks/receipt";

const summary = (): RepositoryVerificationSummary => ({
  version: 1,
  changed: true,
  required: false,
  verified: true,
  error: null,
  checks: CHECK_KINDS.map((kind) => ({
    kind,
    command: `CI=1 pnpm run ${kind}`,
    status: "passed",
    exitCode: 0,
    stdout: `${kind} completed successfully.`,
  })),
});

async function setup(page: Page, evidence: RepositoryVerificationSummary) {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await captureRecoveryEvents(page);
  const id = "00000000-0000-4000-8000-000000000077";
  const messages: UIMessage[] = [
    {
      id: "request",
      role: "user",
      parts: [{ type: "text", text: "Update the source and run full checks." }],
    },
    {
      id: "result",
      role: "assistant",
      parts: [{ type: "text", text: "Updated the workspace." }],
      metadata: { repository_verification: evidence },
    },
  ];
  const session = {
    id,
    title: "Repository verification",
    project: "acme/widgets",
    repo_id: "repo-control-default",
    model_id: null,
    orchestration_run_id: null,
    pinned: false,
    archived: false,
    messages,
    updated_at: "2026-11-02T12:00:00Z",
  };
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? session
        : [session]
    )
  );
  await page.route("**/api/control/turns?**", (route) =>
    fulfillJson(route, {
      sessionId: id,
      messages,
      call: { id: "call-1", status: "streaming", error: null },
    })
  );
  await page.goto(`${scopedPath("control")}?mission=${id}`);
  return messages;
}

test("workspace check receipts preserve expanded output while a chat is steered", async ({
  page,
}, testInfo) => {
  const messages = await setup(page, summary());
  const card = page.getByTestId("repository-checks");
  await expect(
    card.getByRole("heading", { name: "Workspace checks passed" })
  ).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(4);
  const typecheck = card.locator("details").first();
  await typecheck.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(typecheck).toContainText("CI=1 pnpm run typecheck");
  await expect(typecheck).toContainText("typecheck completed successfully.");
  await expect(typecheck).toContainText("Exit code: 0");
  messages.unshift({
    id: "older",
    role: "assistant",
    parts: [{ type: "text", text: "Earlier saved context." }],
  });
  messages.push({
    id: "steer",
    role: "user",
    parts: [{ type: "text", text: "Keep the change focused." }],
  });
  await page.evaluate(() => {
    for (const source of (
      window as unknown as { recoveryEventSources: EventSource[] }
    ).recoveryEventSources)
      source.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ table: "ai_calls", op: "UPDATE" }),
        })
      );
  });
  await expect(
    page.getByText("Keep the change focused.", { exact: true })
  ).toBeVisible();
  await expect(typecheck).toHaveAttribute("open", "");
  await expect(card).toHaveCount(1);
  await card.screenshot({
    path: testInfo.outputPath("workspace-checks-passed.png"),
  });
});

test("mobile check results distinguish failed, unconfirmed, and skipped work", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const evidence = summary();
  evidence.verified = false;
  evidence.checks[1] = {
    kind: "lint",
    command: "CI=1 pnpm run lint",
    status: "failed",
    exitCode: 1,
    stderr:
      "index.ts:12 Unused import\n    at lint (/vercel/sandbox/src/index.ts:12:2)\nexpected /api/health/200",
  };
  evidence.checks[2] = {
    kind: "build",
    command: "CI=1 pnpm run build",
    status: "blocked",
    exitCode: null,
    reason: "Command completion could not be confirmed.",
  };
  evidence.checks[3] = {
    kind: "test",
    command: null,
    status: "skipped",
    exitCode: null,
    reason: "The operator requested no tests for this edit.",
  };
  await setup(page, evidence);
  const card = page.getByTestId("repository-checks");
  await expect(
    card.getByRole("heading", { name: "Workspace checks need attention" })
  ).toBeVisible();
  const rows = card.getByRole("listitem");
  expect(
    (await rows.first().locator("summary").boundingBox())?.height
  ).toBeGreaterThanOrEqual(44);
  for (const [index, status] of [
    "Passed",
    "Failed",
    "Unconfirmed",
    "Skipped",
  ].entries())
    await expect(rows.nth(index).locator("summary")).toContainText(status);
  await rows.nth(1).locator("summary").click();
  await expect(rows.nth(1)).toContainText("index.ts:12 Unused import");
  await expect(rows.nth(1)).toContainText(
    "at lint (/vercel/sandbox/src/index.ts:12:2)"
  );
  await expect(rows.nth(1)).toContainText("expected /api/health/200");
  await rows.nth(2).locator("summary").click();
  await expect(rows.nth(2)).toContainText(
    "Command completion could not be confirmed."
  );
  await rows.nth(3).locator("summary").click();
  await expect(rows.nth(3)).toContainText(
    "The operator requested no tests for this edit."
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ).toBe(false);
  await card.screenshot({
    path: testInfo.outputPath("workspace-checks-mobile.png"),
  });
});
