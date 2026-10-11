import { expect, test } from "@playwright/test";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import { persistControlTerminalOutcome } from "../../lib/control/terminal-outcome";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";
import { captureRecoveryEvents } from "./helpers/control-recovery-fixtures";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`durable turn survives reload and shows saved failure evidence at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const f = await controlTranscriptDatabase();
    try {
      await enableScopedE2EAuth(page);
      await mockBaseChrome(page);
      await mockControlSessionBootstrap(page);
      await captureRecoveryEvents(page);
      await f.save([
        {
          id: "request",
          role: "user",
          parts: [{ type: "text", text: "Check this repository" }],
        },
      ]);
      let status = "idle";
      let posts = 0;
      await page.route("**/api/control/sessions**", async (route) => {
        if (route.request().method() === "PUT")
          return fulfillJson(route, { error: "Browser writes disabled" }, 503);
        const saved = await f.save([]);
        return fulfillJson(
          route,
          new URL(route.request().url()).searchParams.has("id")
            ? saved
            : [saved]
        );
      });
      await page.route("**/api/control/turns?**", async (route) =>
        fulfillJson(route, {
          sessionId: f.sessionId,
          messages: (await f.save([])).messages,
          call: status === "idle" ? null : { id: "call", status, error: null },
        })
      );
      await page.route("**/api/control/chat", async (route) => {
        posts++;
        await f.save(
          (route.request().postDataJSON() as { messages: UIMessage[] }).messages
        );
        status = "streaming";
        const response = createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) =>
              writer.write({
                type: "data-control-turn",
                data: { aiCallId: "call", sessionId: f.sessionId },
                transient: true,
              }),
          }),
        });
        await route.fulfill({
          contentType: "text/event-stream",
          headers: { "x-vercel-ai-ui-message-stream": "v1" },
          body: await response.text(),
        });
      });
      await page.goto(`${scopedPath("control")}?mission=${f.sessionId}`);
      const input = page.getByPlaceholder(
        "Ask for follow-up changes or attach images"
      );
      await input.fill("Run checks");
      await input.press("Enter");
      await expect(
        page.getByRole("button", { name: /stop/i }).first()
      ).toBeVisible();
      await f.save([
        {
          id: "partial",
          role: "assistant",
          parts: [
            { type: "text", text: "Tests passed. Checking the build." },
            {
              type: "dynamic-tool",
              toolName: "run_command",
              toolCallId: "build",
              state: "output-available",
              input: { command: "pnpm build | tail; echo finished" },
              output: {
                exitCode: 0,
                failures: [137],
                stdout: "finished",
                stderr: "Killed",
              },
            },
          ],
          metadata: {
            workspace_changes: {
              sandboxId: "sandbox",
              capturedAt: new Date().toISOString(),
              files: [
                {
                  path: "public/generated.js",
                  additions: 1,
                  deletions: 0,
                  patch:
                    "--- /dev/null\n+++ b/public/generated.js\n@@ -0,0 +1 @@\n+generated();",
                },
              ],
            },
          },
        },
      ]);
      await page.reload();
      await expect(
        page.getByText("Tests passed. Checking the build.", { exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /stop/i }).first()
      ).toBeVisible();
      await persistControlTerminalOutcome(
        {
          userId: f.owner,
          sessionId: f.sessionId,
          aiCallId: "call",
          cancelled: false,
        },
        f.client
      );
      status = "failed";
      await page.evaluate(() => {
        for (const source of (
          window as unknown as { recoveryEventSources: EventSource[] }
        ).recoveryEventSources) {
          source.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ table: "ai_calls", op: "UPDATE" }),
            })
          );
        }
      });
      await expect(
        page.getByText(/The agent stopped before finishing/)
      ).toBeVisible();
      await page.getByRole("button", { name: /^Agent commands/ }).click();
      await expect(page.getByTestId("control-terminal-activity")).toContainText(
        "Failed"
      );
      await expect(page.getByTestId("control-terminal-activity")).toContainText(
        "Killed"
      );
      await expect(page.getByTestId("control-terminal-activity")).toContainText(
        "137"
      );
      await page.getByRole("button", { name: "Close terminal" }).click();
      await page.getByRole("button", { name: "Open changes" }).click();
      await expect(
        page.getByText("generated.js", { exact: true })
      ).toBeVisible();
      expect(posts).toBe(1);
    } finally {
      await f.db.close();
    }
  });
}
