import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { expect, it } from "vitest";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import {
  prepareControlRequestHistory,
  controlMessagesForModel,
} from "@/lib/control/request-history";
import { persistedControlStream } from "@/lib/control/persisted-stream";

it.each(["neon", "supabase"])(
  "%s serializes different approvals in one message and retains both executed results",
  async (root) => {
    const fixture = await controlTranscriptDatabase();
    try {
      await fixture.db.exec(
        await readFile(
          join(
            process.cwd(),
            root,
            "migrations/20260905184500_control_approval_executions.sql"
          ),
          "utf8"
        )
      );
      const pending: UIMessage = {
        id: "two-approvals",
        role: "assistant",
        parts: ["a", "b"].map((id) => ({
          type: "tool-action",
          toolCallId: id,
          state: "approval-requested",
          input: { id },
          approval: { id },
        })),
      };
      await fixture.save([pending]);
      const approve = (message: UIMessage, id: string): UIMessage =>
        ({
          ...message,
          parts: message.parts.map((part) =>
            part.type === "tool-action" &&
            "approval" in part &&
            part.approval?.id === id
              ? {
                  ...part,
                  state: "approval-responded",
                  approval: { id, approved: true },
                }
              : part
          ),
        }) as UIMessage;
      const claim = (saved: UIMessage, id: string, call: number) =>
        prepareControlRequestHistory(
          {
            userId: fixture.owner,
            sessionId: fixture.sessionId,
            aiCallId: `00000000-0000-4000-8000-${String(call).padStart(12, "0")}`,
            savedMessages: [saved],
            incomingMessages: [approve(saved, id)],
          },
          fixture.client
        );
      const raced = await Promise.allSettled([
        claim(pending, "a", 10),
        claim(pending, "b", 11),
      ]);
      expect(
        raced.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const winner = raced.find((result) => result.status === "fulfilled")!;
      if (winner.status !== "fulfilled") throw new Error("No winning claim");
      const first = winner.value;
      const firstId = first.claimedApprovalIds[0];
      const secondId = firstId === "a" ? "b" : "a";
      const winningCall =
        firstId === "a"
          ? "00000000-0000-4000-8000-000000000010"
          : "00000000-0000-4000-8000-000000000011";
      // A different tenant or stale writer cannot release this continuation.
      for (const [userId, aiCallId] of [
        ["00000000-0000-4000-8000-000000000099", winningCall],
        [fixture.owner, "00000000-0000-4000-8000-000000000099"],
      ]) {
        expect(
          (
            await fixture.client!.rpc("control_finish_approval_continuation", {
              p_user_id: userId,
              p_session_id: fixture.sessionId,
              p_message_id: pending.id,
              p_ai_call_id: aiCallId,
            })
          ).data
        ).toBe(false);
      }
      await expect(claim(pending, secondId, 15)).rejects.toThrow(
        "already submitted"
      );
      const executions: string[] = [];
      const finish = Promise.withResolvers<void>();
      const checkpoint = Promise.withResolvers<void>();
      const run = async (
        prepared: typeof first,
        saved: UIMessage,
        waitForFinish: boolean
      ) => {
        const result = streamText({
          model: new MockLanguageModelV3({
            doStream: async () => ({
              stream: new ReadableStream({
                start(c) {
                  c.enqueue({ type: "text-start", id: "answer" });
                  c.enqueue({
                    type: "text-delta",
                    id: "answer",
                    delta: "Action finished.",
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
              inputSchema: z.object({ id: z.string() }),
              execute: async ({ id }) => {
                executions.push(id);
                return { result: `completed-${id}` };
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
        return persistedControlStream({
          stream: result.toUIMessageStream(),
          messages: prepared.messages,
          expectedMessages: [saved],
          continuationMessageId: prepared.continuationMessageId,
          messageId: "unused",
          save: async (messages, previous) => {
            const value = await fixture.save(messages, previous);
            checkpoint.resolve();
            if (waitForFinish) await finish.promise;
            return value;
          },
          onError: () => "Save failed",
          onComplete: prepared.complete,
        });
      };
      const running = await run(first, pending, true);
      await checkpoint.promise;
      const intermediate = (await fixture.save([])).messages[0];
      expect(JSON.stringify(intermediate)).toContain(`completed-${firstId}`);
      // Even a fresh transcript with the first tool result is not permission to
      // replace the message while its owning model stream is still writing.
      await expect(claim(intermediate, secondId, 12)).rejects.toThrow(
        "already submitted"
      );
      finish.resolve();
      await running.completion;
      const latest = (await fixture.save([])).messages[0];
      const second = await claim(latest, secondId, 13);
      const next = await run(second, latest, false);
      await next.completion;
      expect(executions.sort()).toEqual(["a", "b"]);
      const reloaded = JSON.stringify((await fixture.save([])).messages);
      expect(reloaded).toContain("completed-a");
      expect(reloaded).toContain("completed-b");
      await expect(claim(pending, firstId, 14)).rejects.toThrow(
        "already submitted"
      );
    } finally {
      await fixture.db.close();
    }
  }
);
