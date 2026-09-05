import { expect, test } from "@playwright/test";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import { persistedControlStream } from "../../lib/control/persisted-stream";
import { controlRequestHistory } from "../../lib/control/request-history";
import { validateControlChatMessages } from "../../app/api/control/chat/_lib/messages";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("server transcript survives failed browser saving and preserves command evidence on follow-up", async ({
  page,
}) => {
  const fixture = await controlTranscriptDatabase();
  try {
    await enableScopedE2EAuth(page);
    await mockBaseChrome(page);
    await mockControlSessionBootstrap(page);
    await fixture.save([
      {
        id: "initial",
        role: "user",
        parts: [{ type: "text", text: "Check the repository" }],
      },
    ]);
    await page.route("**/api/control/sessions**", async (route) => {
      if (route.request().method() === "PUT") {
        return fulfillJson(route, { error: "Browser save unavailable" }, 503);
      }
      const saved = await fixture.save([]);
      return fulfillJson(
        route,
        new URL(route.request().url()).searchParams.has("id") ? saved : [saved]
      );
    });
    let turn = 0;
    await page.route("**/api/control/chat", async (route) => {
      const body = route.request().postDataJSON() as { messages: UIMessage[] };
      const incoming = await validateControlChatMessages(body.messages);
      const saved = await fixture.save(incoming);
      const history = await validateControlChatMessages(
        controlRequestHistory(saved.messages, incoming)
      );
      const modelHistory = await convertToModelMessages(history, {
        ignoreIncompleteToolCalls: true,
      });
      turn += 1;
      // Only the model provider is scripted. Validation, stream assembly and
      // persistence below are production code using a real isolated database.
      const answer =
        turn === 1
          ? "The repository check failed."
          : JSON.stringify(modelHistory).includes(
                "Fixture test assertion failed"
              )
            ? "The saved command failed its test assertion."
            : "No command evidence available.";
      const chunks: UIMessageChunk[] = [
        { type: "start" },
        { type: "start-step" },
        ...(turn === 1
          ? [
              {
                type: "tool-input-available" as const,
                toolCallId: "check",
                toolName: "run_command",
                input: { command: "pnpm test" },
              },
              {
                type: "tool-output-error" as const,
                toolCallId: "check",
                errorText: "Fixture test assertion failed",
              },
            ]
          : []),
        { type: "finish-step" },
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: answer },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: "stop" },
      ];
      const durable = await persistedControlStream({
        stream: new ReadableStream({
          start(c) {
            for (const chunk of chunks) c.enqueue(chunk);
            c.close();
          },
        }),
        messages: history,
        expectedMessages: saved.messages,
        messageId: `response-${turn}`,
        save: fixture.save,
        onError: () => "Save failed",
      });
      const response = createUIMessageStreamResponse({
        stream: durable.stream,
      });
      const streamBody = await response.text();
      await durable.completion;
      await route.fulfill({
        contentType: "text/event-stream",
        headers: { "x-vercel-ai-ui-message-stream": "v1" },
        body: streamBody,
      });
    });
    await page.goto(`${scopedPath("control")}?mission=${fixture.sessionId}`);
    const input = page.getByPlaceholder(
      "Ask for follow-up changes or attach images"
    );
    await input.fill("Run the tests");
    await input.press("Enter");
    await expect(
      page.getByText("The repository check failed.", { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("The repository check failed.", { exact: true })
    ).toBeVisible();
    await input.fill("Why did it fail?");
    await input.press("Enter");
    await expect(
      page.getByText("The saved command failed its test assertion.", {
        exact: true,
      })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("The saved command failed its test assertion.", {
        exact: true,
      })
    ).toBeVisible();
  } finally {
    await fixture.db.close();
  }
});
