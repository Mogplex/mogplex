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

test("Stop during admission cancels the queued turn and preserves the outcome after reload", async ({
  page,
}) => {
  const f = await controlTranscriptDatabase();
  const admitted = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  let status = "idle";
  let posts = 0;
  let cancellations = 0;
  try {
    await enableScopedE2EAuth(page);
    await mockBaseChrome(page);
    await mockControlSessionBootstrap(page);
    await page.route("**/api/control/sessions**", async (route) => {
      const saved = await f.save([]);
      await fulfillJson(
        route,
        new URL(route.request().url()).searchParams.has("id") ? saved : [saved]
      );
    });
    await page.route("**/api/control/turns?**", async (route) =>
      fulfillJson(route, {
        sessionId: f.sessionId,
        messages: (await f.save([])).messages,
        call:
          status === "idle"
            ? null
            : { id: "admitted-call", status, error: null },
      })
    );
    await page.route(
      "**/api/observability/calls/admitted-call/cancel",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        cancellations++;
        status = "cancelled";
        await persistControlTerminalOutcome(
          {
            userId: f.owner,
            sessionId: f.sessionId,
            aiCallId: "admitted-call",
            cancelled: true,
          },
          f.client
        );
        await fulfillJson(route, { ok: true, status });
      }
    );
    await page.route("**/api/control/chat", async (route) => {
      posts++;
      await f.save(
        (route.request().postDataJSON() as { messages: UIMessage[] }).messages
      );
      status = "pending";
      admitted.resolve();
      await acknowledge.promise;
      const response = createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) =>
            writer.write({
              type: "data-control-turn",
              data: { sessionId: f.sessionId, aiCallId: "admitted-call" },
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
    await input.fill("Cancellation canary");
    await input.press("Enter");
    await admitted.promise;
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    acknowledge.resolve();
    await expect(
      page.getByText("The agent was stopped. Your saved work is preserved.", {
        exact: true,
      })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("The agent was stopped. Your saved work is preserved.", {
        exact: true,
      })
    ).toBeVisible();
    await expect(input).toBeEnabled();
    expect(posts).toBe(1);
    expect(cancellations).toBe(1);
  } finally {
    acknowledge.resolve();
    await f.db.close();
  }
});
