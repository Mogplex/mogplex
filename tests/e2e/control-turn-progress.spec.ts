import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("a follow-up focuses the latest request and shows live command progress and stop", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/control/workers?*", (route) =>
    fulfillJson(route, {
      workers: ["ci", "docs", "accessibility", "links", "cleanup"].map(
        (task) => ({
          id: `old-worker-${task}`,
          worktreeId: task,
          branch: `mogplex/task/old-request/${task}`,
          status: "failed",
          error:
            "Worker could not authenticate. Check its AI connection before retrying.",
          updatedAt: "2026-08-13T00:00:00Z",
          events: [
            {
              id: `${task}-start`,
              type: "tool_started",
              toolName: "Command",
              message: "Started",
              payload: { toolCallId: task, input: { command: "old command" } },
              createdAt: "2026-08-13T00:00:00Z",
            },
            {
              id: `${task}-end`,
              type: "tool_finished",
              toolName: "Command",
              message: "Failed",
              payload: {
                toolCallId: task,
                state: "error",
                output: "Previous batch output",
              },
              createdAt: "2026-08-13T00:00:01Z",
            },
          ],
        })
      ),
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let count = 0;
    window.fetch = async (input, init) => {
      if (!String(input).endsWith("/api/control/chat"))
        return original(input, init);
      count++;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            const send = (chunk: object) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
              );
            send({ type: "start", messageId: `answer-${count}` });
            if (count === 1) {
              send({ type: "text-start", id: "t" });
              send({
                type: "text-delta",
                id: "t",
                delta: "Earlier analysis. ".repeat(100),
              });
              send({ type: "text-end", id: "t" });
              send({ type: "finish" });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } else {
              send({
                type: "tool-input-available",
                toolCallId: "cmd",
                toolName: "run_command",
                input: { command: "pnpm test" },
              });
              init?.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("Aborted", "AbortError")),
                { once: true }
              );
            }
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
        }
      );
    };
  });
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Review this repository");
  await page.getByRole("button", { name: "Start mission" }).click();
  const composer = page.getByPlaceholder(
    "Ask for follow-up changes or attach images"
  );
  await expect(
    page.getByRole("button", { name: "Send", exact: true })
  ).toBeVisible();
  await composer.fill("Fix the failing tests");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const progress = page.getByRole("status", { name: "Current activity" });
  await expect(progress).toContainText("Running command");
  await expect(progress).toContainText("pnpm test");
  const workers = page.getByRole("region", { name: "Mission workers" });
  await expect(workers).toContainText("5 workers failed");
  await expect(workers.getByRole("link", { name: /View work/ })).toHaveCount(0);
  await expect(page.getByTestId("control-terminal-activity")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Latest request" })
  ).toContainText("Fix the failing tests");
  await expect(page.getByText(/Earlier analysis/)).not.toBeVisible();
  await expect(
    page.getByText("Earlier conversation · 1 request")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toHaveText("Stop");
  await page.screenshot({ path: testInfo.outputPath("follow-up-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(progress).toBeInViewport();
  await expect(
    page
      .getByRole("region", { name: "Latest request" })
      .getByText("Fix the failing tests")
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("follow-up-mobile.png") });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.getByTestId("tool-activity")).toContainText("Interrupted");
  await page
    .getByRole("button", { name: "Earlier conversation · 1 request" })
    .click();
  await expect(page.getByText(/Earlier analysis/)).toBeVisible();
  expect(browserErrors).toEqual([]);
});
