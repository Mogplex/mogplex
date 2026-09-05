import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import {
  controlMessagesForModel,
  prepareControlRequestHistory,
} from "../../lib/control/request-history";
import { persistedControlStream } from "../../lib/control/persisted-stream";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("approving the same action in two tabs executes it once and rejects the duplicate", async ({
  page,
  context,
}) => {
  const fixture = await controlTranscriptDatabase();
  const second = await context.newPage();
  try {
    await fixture.db.exec(
      await readFile(
        join(
          process.cwd(),
          "neon/migrations/20260905184500_control_approval_executions.sql"
        ),
        "utf8"
      )
    );
    await fixture.save([
      {
        id: "approval-message",
        role: "assistant",
        parts: [
          {
            type: "tool-action",
            toolCallId: "action-call",
            state: "approval-requested",
            input: {},
            approval: { id: "approval" },
          },
        ],
      },
    ]);
    const counts = { executions: 0, submissions: 0 };
    const { promise: bothSubmitted, resolve: release } =
      Promise.withResolvers<void>();
    for (const tab of [page, second]) {
      await enableScopedE2EAuth(tab);
      await mockBaseChrome(tab);
      await mockControlSessionBootstrap(tab);
      await tab.route("**/api/control/approvals**", (route) =>
        fulfillJson(route, { approvals: [] })
      );
      await tab.route("**/api/control/sessions**", async (route) => {
        const saved = await fixture.save([]);
        if (route.request().method() === "PUT")
          return fulfillJson(route, { ok: true, session: saved });
        return fulfillJson(
          route,
          new URL(route.request().url()).searchParams.has("id")
            ? saved
            : [saved]
        );
      });
      await tab.route("**/api/control/chat", async (route) => {
        const { messages } = route.request().postDataJSON() as {
          messages: UIMessage[];
        };
        const saved = await fixture.save([]);
        const submission = ++counts.submissions;
        if (counts.submissions === 2) release();
        await bothSubmitted;
        try {
          const prepared = await prepareControlRequestHistory(
            {
              userId: fixture.owner,
              sessionId: fixture.sessionId,
              aiCallId: `00000000-0000-4000-8000-00000000000${submission}`,
              savedMessages: saved.messages,
              incomingMessages: messages,
            },
            fixture.client
          );
          const result = streamText({
            model: new MockLanguageModelV3({
              doStream: async () => ({
                stream: new ReadableStream({
                  start(c) {
                    c.enqueue({ type: "text-start", id: "answer" });
                    c.enqueue({
                      type: "text-delta",
                      id: "answer",
                      delta: "Approved action completed once.",
                    });
                    c.enqueue({ type: "text-end", id: "answer" });
                    c.enqueue({
                      type: "finish",
                      finishReason: { unified: "stop", raw: undefined },
                      usage: {
                        inputTokens: {
                          total: 1,
                          noCache: 1,
                          cacheRead: 0,
                          cacheWrite: 0,
                        },
                        outputTokens: { total: 1, text: 1, reasoning: 0 },
                      },
                    });
                    c.close();
                  },
                }),
              }),
            }),
            tools: {
              action: tool({
                inputSchema: z.object({}),
                execute: async () => {
                  counts.executions += 1;
                  return { completed: true };
                },
              }),
            },
            messages: await convertToModelMessages(
              controlMessagesForModel(
                prepared.messages,
                prepared.claimedApprovalIds
              )
            ),
          });
          const durable = await persistedControlStream({
            stream: result.toUIMessageStream(),
            messages: prepared.messages,
            expectedMessages: saved.messages,
            continuationMessageId: prepared.continuationMessageId,
            messageId: "unused",
            save: fixture.save,
            onError: () => "Save failed",
          });
          const response = createUIMessageStreamResponse({
            stream: durable.stream,
          });
          const body = await response.text();
          await durable.completion;
          await route.fulfill({
            contentType: "text/event-stream",
            headers: { "x-vercel-ai-ui-message-stream": "v1" },
            body,
          });
        } catch (error) {
          await fulfillJson(
            route,
            {
              error: error instanceof Error ? error.message : "Approval failed",
            },
            409
          );
        }
      });
      await tab.goto(`${scopedPath("control")}?mission=${fixture.sessionId}`);
      await expect(
        tab.getByRole("button", { name: "Approve", exact: true })
      ).toBeVisible();
    }
    const responses = [
      page.waitForResponse("**/api/control/chat"),
      second.waitForResponse("**/api/control/chat"),
    ];
    await Promise.all(
      [page, second].map((tab) =>
        tab.getByRole("button", { name: "Approve", exact: true }).click()
      )
    );
    const completed = await Promise.all(responses);
    expect(counts.executions).toBe(1);
    expect(
      completed.map((response) => response.status()).sort((a, b) => a - b)
    ).toEqual([200, 409]);
    const successfulTab = completed[0].ok() ? page : second;
    await expect(
      successfulTab.getByText("Approved action completed once.", {
        exact: true,
      })
    ).toBeVisible();
    const rejected = completed.find((response) => response.status() === 409)!;
    expect((await rejected.json()).error).toContain("already submitted");
    await successfulTab.reload();
    await expect(
      successfulTab.getByText("Approved action completed once.", {
        exact: true,
      })
    ).toBeVisible();
  } finally {
    await second.close();
    await fixture.db.close();
  }
});
