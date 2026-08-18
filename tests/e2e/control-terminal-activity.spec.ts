import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("control shows sandbox launch and command output above the composer", async ({
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
      toolCallId: "sandbox-call",
      toolName: "sandbox_start",
      input: { repoId: "repo-1" },
    },
    {
      type: "tool-output-available",
      toolCallId: "sandbox-call",
      output: { sandboxId: "sandbox-demo" },
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

  const terminal = page.getByTestId("control-terminal-activity");
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText("Live terminal");
  await expect(terminal).toContainText("Read only");
  await expect(terminal).toContainText("sandbox-demo");
  await expect(terminal).toContainText("pnpm test");
  await expect(terminal).toContainText("12 tests passed");

  // The terminal and composer use the conversation rail, rather than each
  // introducing a slightly narrower content column.
  const terminalBox = await page
    .getByTestId("control-terminal-surface")
    .boundingBox();
  const composerBox = await page
    .getByTestId("control-composer-dropzone")
    .boundingBox();
  expect(terminalBox?.x).toBeCloseTo(composerBox?.x ?? 0, 1);
  expect(terminalBox?.width).toBeCloseTo(composerBox?.width ?? 0, 1);
});
