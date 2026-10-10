import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("control shows sandbox launch and command output in the task drawer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );

  const streamChunks = [
    { type: "start" },
    {
      type: "tool-input-available",
      toolCallId: "failed-sandbox-call",
      toolName: "sandbox_start",
      input: { repoId: "repo-1" },
    },
    {
      type: "tool-output-available",
      toolCallId: "failed-sandbox-call",
      output: { status: "error", error: "Sandbox capacity unavailable" },
    },
    {
      type: "tool-input-available",
      toolCallId: "sandbox-call",
      toolName: "sandbox_start",
      input: { repoId: "repo-1" },
    },
    {
      type: "tool-output-available",
      toolCallId: "sandbox-call",
      output: {
        sandboxId: "sandbox-demo",
        status: "running",
        recoveredFromCleanup: true,
        cleanupWaitMs: 2_500,
      },
    },
    {
      type: "tool-input-available",
      toolCallId: "command-call",
      toolName: "run_command",
      input: { command: "pnpm test" },
    },
    {
      type: "tool-output-available",
      toolCallId: "command-call",
      output: {
        sandboxId: "sandbox-demo",
        stdout: "12 tests passed",
        stderr: "",
      },
    },
    { type: "finish" },
  ];
  const streamBody =
    streamChunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: streamBody,
    })
  );

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("run the checks");
  await page.getByRole("button", { name: "Start mission" }).click();

  await page.getByRole("button", { name: /^Agent commands/ }).click();
  const terminal = page.getByTestId("control-terminal-activity");
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText("Read only.");
  await expect(terminal).not.toContainText("sandbox-demo");
  await expect(terminal).toContainText("pnpm test");
  await expect(
    terminal.getByText("12 tests passed", { exact: true })
  ).toBeVisible();
  await expect(terminal).toContainText("Sandbox failed");
  await expect(terminal).toContainText("Sandbox capacity unavailable");
  await expect(terminal).toContainText(
    "Sandbox recovered and ready · cleanup 3s"
  );
  const drawer = page.getByRole("region", { name: "Task terminal" });
  const before = await drawer.boundingBox();
  await page
    .getByRole("separator", { name: "Resize terminal", exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  expect((await drawer.boundingBox())!.height).toBeGreaterThan(before!.height);
  await page.getByRole("button", { name: "Close terminal" }).click();
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Ask for follow-up changes" })
  ).toBeVisible();
});
