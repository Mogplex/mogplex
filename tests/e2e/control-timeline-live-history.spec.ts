import { expect, test } from "@playwright/test";
import type { UIMessage } from "ai";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";
import { captureRecoveryEvents } from "./helpers/control-recovery-fixtures";

test("loading earlier activity and steering a live request preserve open details and live status", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await captureRecoveryEvents(page);
  const sessionId = "00000000-0000-4000-8000-000000000077";
  const messages: UIMessage[] = [
    {
      id: "first-request",
      role: "user",
      parts: [{ type: "text", text: "Inspect the source and run tests" }],
    },
    {
      id: "live-response",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "read",
          state: "output-available",
          input: { path: "app/page.tsx" },
          output: { content: "source" },
        },
        {
          type: "tool-run_command",
          toolCallId: "tests",
          state: "input-available",
          input: { command: "pnpm test" },
        },
      ],
    },
  ];
  const session = {
    id: sessionId,
    title: "Live review",
    project: "acme/widgets",
    repo_id: "repo-control-default",
    model_id: null,
    orchestration_run_id: null,
    pinned: false,
    archived: false,
    messages,
    created_at: "2026-11-02T12:00:00Z",
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
      sessionId,
      messages,
      call: { id: "call", status: "streaming", error: null },
    })
  );
  await page.goto(`${scopedPath("control")}?mission=${sessionId}`);
  const read = page
    .getByTestId("tool-activity")
    .filter({ hasText: "Reading file" });
  await read.locator("summary").click();
  await expect(read.locator("details")).toHaveAttribute("open", "");
  messages.unshift({
    id: "older-activity",
    role: "assistant",
    parts: [{ type: "text", text: "Earlier saved activity" }],
  });
  messages.push({
    id: "guidance",
    role: "user",
    parts: [{ type: "text", text: "Keep the layout" }],
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
    page.getByText("Keep the layout", { exact: true })
  ).toBeVisible();
  await expect(read.locator("details")).toHaveAttribute("open", "");
  await expect(
    page.getByRole("region", { name: "Earlier activity" })
  ).toContainText("Earlier saved activity");
  await expect(
    page.getByRole("region", { name: "Request 1", exact: true })
  ).toContainText("Inspect the source");
  const command = page
    .getByTestId("tool-activity")
    .filter({ hasText: "Running command" });
  await expect(command).toContainText("Running");
  await expect(command).not.toContainText("Status unconfirmed");
  await expect(command).not.toContainText("Interrupted");
});
