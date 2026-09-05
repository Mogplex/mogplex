import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("a finished coordinator reply keeps worker failure and command output visible", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    class FixtureEventSource extends EventTarget {
      private listener: (event: Event) => void;
      constructor(url: string) {
        super();
        this.listener = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (decodeURIComponent(url).includes(detail.table))
            this.dispatchEvent(
              new MessageEvent("message", { data: JSON.stringify(detail) })
            );
        };
        window.addEventListener("fixture-table-event", this.listener);
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      close() {
        window.removeEventListener("fixture-table-event", this.listener);
      }
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEventSource });
  });
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  let failed = false;
  let unavailable = false;
  await page.route("**/api/control/workers?*", (route) =>
    unavailable
      ? fulfillJson(route, { error: "Unavailable" }, 503)
      : fulfillJson(route, {
          workers: [
            {
              id: "worker-1",
              worktreeId: "worktree-1",
              branch: "mogplex/task/mission/tests",
              status: failed ? "failed" : "pending",
              error: failed
                ? "Worker could not authenticate. Check its AI connection before retrying."
                : null,
              updatedAt: "2026-09-05T17:00:00Z",
              events: [
                {
                  id: "e1",
                  type: "tool_started",
                  toolName: "Command",
                  message: "Command started",
                  payload: {
                    toolCallId: "cmd",
                    input: { command: "pnpm test" },
                  },
                  createdAt: "2026-09-05T17:00:00Z",
                },
                {
                  id: "e2",
                  type: "tool_finished",
                  toolName: "Command",
                  message: "Command failed",
                  payload: {
                    toolCallId: "cmd",
                    state: "error",
                    input: { command: "pnpm test" },
                    output: "3 tests failed",
                  },
                  createdAt: "2026-09-05T17:00:01Z",
                },
              ],
            },
          ],
        })
  );
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body:
        [
          { type: "start" },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Workers launched." },
          { type: "text-end", id: "t" },
          { type: "finish" },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join("") + "data: [DONE]\n\n",
    })
  );
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Fix the tests");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByText("Workers launched.", { exact: true })
  ).toBeVisible();
  const workers = page.getByRole("region", { name: "Mission workers" });
  await expect(workers).toContainText("1 worker queued");
  failed = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fixture-table-event", {
        detail: { table: "external_agent_runs", op: "UPDATE" },
      })
    )
  );
  await expect(workers).toContainText("1 worker failed");
  await expect(workers).toContainText("Check its AI connection");
  await expect(
    workers.getByRole("link", {
      name: "View work for mogplex/task/mission/tests",
    })
  ).toHaveAttribute("href", scopedPath("projects/workspace?run=worker-1"));
  await expect(page.getByTestId("control-terminal-activity")).toContainText(
    "pnpm test"
  );
  await expect(page.getByTestId("control-terminal-activity")).toContainText(
    "3 tests failed"
  );
  await expect(page.getByTestId("control-terminal-activity")).toContainText(
    "mogplex/task/mission/tests"
  );
  await page.reload();
  await expect(workers).toContainText("1 worker failed");
  await expect(page.getByTestId("control-terminal-activity")).toContainText(
    "3 tests failed"
  );
  unavailable = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fixture-table-event", {
        detail: { table: "external_agent_runs", op: "UPDATE" },
      })
    )
  );
  await expect(workers).toContainText("Could not load worker status");
  await expect(workers).toContainText("Showing last received status");
  unavailable = false;
  await workers.getByRole("button", { name: "Refresh status" }).click();
  await expect(workers).not.toContainText("Could not load worker status");
  await page.screenshot({
    path: testInfo.outputPath("worker-status-desktop.png"),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(workers).toBeVisible();
  await expect(
    workers.getByRole("link", {
      name: "View work for mogplex/task/mission/tests",
    })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("worker-status-mobile.png"),
  });
});
