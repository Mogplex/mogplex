import { expect, test } from "@playwright/test";
import type { UIMessageChunk } from "ai";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";

for (const ending of ["eof", "abort", "error-finish", "error"] as const) {
  test(`an interrupted tool response (${ending}) stops its running indicator, persists uncertainty, and never replays`, async ({
    page,
  }) => {
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page);
    let requests = 0;
    const chunks: UIMessageChunk[] = [
      { type: "start", messageId: "interrupted-assistant" },
      {
        type: "tool-input-available",
        toolCallId: "unfinished-command",
        toolName: "bash",
        input: { command: "check-project" },
      },
    ];
    if (ending === "abort") chunks.push({ type: "abort" });
    if (ending === "error-finish")
      chunks.push({ type: "finish", finishReason: "error" });
    if (ending === "error")
      chunks.push({ type: "error", errorText: "server-private-diagnostic" });
    await page.route(/\/api\/chat(?:\?.*)?$/, async (route) => {
      requests += 1;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: chunks
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join(""),
      });
    });
    await page.goto(scopedPath("projects/workspace"));
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
    const composer = page.getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    });
    await composer.fill("Check this project once");
    await composer.press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: "Chat response interrupted" })
    ).toContainText("Check the sandbox before retrying");
    await expect(page.getByText("running...", { exact: true })).toHaveCount(0);
    const tool = page.getByRole("button", { name: /bash.*error/ });
    await tool.click();
    await expect(
      page.getByText(/The command may still be running/)
    ).toBeVisible();
    expect(requests).toBe(1);
    await expect(page.getByText("server-private-diagnostic")).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /bash.*error/ })
    ).toBeVisible();
    await expect(page.getByText("running...", { exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
  });
}
