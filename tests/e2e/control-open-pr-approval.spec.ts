import { expect, test } from "@playwright/test";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { wrapWithPolicy } from "../../lib/agents/orchestrator/policy";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

for (const decision of ["Approve", "Deny"] as const) {
  test(`opening a PR waits for operator approval: ${decision}`, async ({
    page,
  }) => {
    await enableScopedE2EAuth(page);
    await mockBaseChrome(page);
    await mockControlSessionBootstrap(page);
    await page.route("**/api/control/approvals**", (route) =>
      fulfillJson(route, { approvals: [] })
    );
    let createdPrs = 0;
    const approvals: string[] = [];
    const resolved: string[] = [];
    const openPr = wrapWithPolicy(
      "open_pr",
      tool({
        inputSchema: z.object({ title: z.string() }),
        execute: async () => {
          createdPrs += 1;
          return { url: "https://github.com/acme/widgets/pull/42" };
        },
      }),
      { userId: "user-1", repoBranch: "feat/work", controlMode: "run" },
      {
        createApproval: async (input) => {
          approvals.push(input.toolCallId);
          return { id: "approval-pr" };
        },
        resolveApprovalByToolCall: async (input) => {
          resolved.push(input.toolCallId);
        },
      }
    );
    let turns = 0;
    await page.route("**/api/control/chat", async (route) => {
      const { messages } = route.request().postDataJSON() as {
        messages: UIMessage[];
      };
      const firstTurn = turns++ === 0;
      let emittedTool = false;
      const result = streamText({
        stopWhen: [],
        model: new MockLanguageModelV3({
          doStream: async () => ({
            stream: new ReadableStream({
              start(controller) {
                const callsTool = firstTurn && !emittedTool;
                emittedTool = true;
                if (callsTool) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "open-pr-call",
                    toolName: "open_pr",
                    input: JSON.stringify({ title: "Fix regression" }),
                  });
                } else {
                  controller.enqueue({ type: "text-start", id: "answer" });
                  controller.enqueue({
                    type: "text-delta",
                    id: "answer",
                    delta: createdPrs
                      ? "Pull request created."
                      : "Pull request was not created.",
                  });
                  controller.enqueue({ type: "text-end", id: "answer" });
                }
                controller.enqueue({
                  type: "finish",
                  finishReason: {
                    unified: callsTool ? "tool-calls" : "stop",
                    raw: undefined,
                  },
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
                controller.close();
              },
            }),
          }),
        }),
        tools: { open_pr: openPr },
        messages: await convertToModelMessages(messages),
      });
      const response = result.toUIMessageStreamResponse({
        originalMessages: messages,
      });
      await route.fulfill({
        contentType: "text/event-stream",
        headers: { "x-vercel-ai-ui-message-stream": "v1" },
        body: await response.text(),
      });
    });

    await page.goto(scopedPath("control"));
    await page
      .getByPlaceholder("Ask anything or run a command...")
      .fill("Open a PR for this change");
    const request = page.waitForResponse("**/api/control/chat");
    await page.getByRole("button", { name: "Start mission" }).click();
    expect((await request).ok()).toBe(true);
    await expect(
      page.getByRole("button", { name: "Approve", exact: true })
    ).toBeVisible();
    expect(createdPrs).toBe(0);
    expect(approvals).toEqual(["open-pr-call"]);

    const continuation = page.waitForResponse("**/api/control/chat");
    await page.getByRole("button", { name: decision, exact: true }).click();
    expect((await continuation).ok()).toBe(true);
    await expect(
      page.getByText(
        decision === "Approve"
          ? "Pull request created."
          : "Pull request was not created.",
        { exact: true }
      )
    ).toBeVisible();
    expect(createdPrs).toBe(decision === "Approve" ? 1 : 0);
    expect(resolved).toEqual(decision === "Approve" ? ["open-pr-call"] : []);
  });
}
