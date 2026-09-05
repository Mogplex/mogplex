import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tool, type UIMessage, type UIMessageChunk } from "ai";
import { z } from "zod";
import { controlContinuationDatabase } from "../support/control-continuation-database";
import { createControlWorkerHandoff } from "@/lib/control/worker-handoff";
import { persistedControlStream } from "@/lib/control/persisted-stream";
import { saveControlTranscript } from "@/lib/control/transcript-store";
import {
  assertControlContinuationCurrent,
  claimControlContinuation,
  controlContinuationContextSchema,
  listControlContinuations,
} from "@/lib/control/continuation-store";
import { notifyControlWorkerCompletion } from "@/lib/control/continuation-dispatch";
import { guardControlBackgroundTools } from "@/lib/control/background-context";

it.each(["stop", "abort", "error", "checkpoint-failure", "approval"] as const)(
  "%s preserves the parent barrier and prevents unsafe follow-up",
  async (ending) => {
    const f = await controlContinuationDatabase("neon");
    const client = f.client as unknown as Parameters<
      typeof saveControlTranscript
    >[1];
    try {
      const original = (
        await saveControlTranscript(
          { userId: f.owner, sessionId: f.sessionId, messages: [] },
          client
        )
      ).messages;
      let executions = 0;
      const deps = {
        client,
        trigger: async (ticket: { id: string }) => {
          if (
            await claimControlContinuation(
              f.owner,
              ticket.id,
              "runtime",
              client
            )
          )
            executions++;
          return { id: "runtime" };
        },
      };
      const binding = { sandboxId: null as string | null };
      const handoff = createControlWorkerHandoff(
        {
          userId: f.owner,
          sessionId: f.sessionId,
          parentAiCallId: f.parentCallId,
          messages: original,
          context: controlContinuationContextSchema.parse(f.context),
          sandboxBinding: binding,
        },
        deps
      );
      // Runtime created/selected after this request began must be preserved too.
      binding.sandboxId = randomUUID();
      const args = {
        workerRunIds: f.workerIds,
        instruction: f.registerArgs.p_instruction,
      };
      const output = await handoff.tool.execute!(args, {
        toolCallId: "wait",
        messages: [],
      });
      expect(output).toMatchObject({ status: "waiting" });
      expect(
        (await listControlContinuations(f.owner, f.sessionId, client))[0]
      ).toMatchObject({
        parent_ready: false,
        request_context: { sandboxId: binding.sandboxId },
      });
      await f.db.query(
        "update external_agent_runs set status='success' where id=any($1)",
        [f.workerIds]
      );
      await notifyControlWorkerCompletion(f.owner, f.workerIds[0], deps);
      expect(executions).toBe(0);
      const source = new ReadableStream<UIMessageChunk>({
        start(c) {
          c.enqueue({
            type: "start",
            messageMetadata: { ai_call_id: f.parentCallId },
          });
          c.enqueue({
            type: "tool-input-available",
            toolName: "await_workers",
            toolCallId: "wait",
            input: args,
          });
          c.enqueue({
            type: "tool-output-available",
            toolCallId: "wait",
            output,
          });
          if (ending === "approval") {
            c.enqueue({
              type: "tool-input-available",
              toolName: "bash",
              toolCallId: "approval-tool",
              input: { command: "git push" },
            });
            c.enqueue({
              type: "tool-approval-request",
              toolCallId: "approval-tool",
              approvalId: "approval-needed",
            });
          }
          c.enqueue(
            ending === "abort"
              ? { type: "abort" }
              : {
                  type: "finish",
                  finishReason:
                    ending === "error"
                      ? "error"
                      : ending === "approval"
                        ? "tool-calls"
                        : "stop",
                }
          );
          c.close();
        },
      });
      const durable = await persistedControlStream({
        stream: source,
        messages: original,
        expectedMessages: original,
        messageId: f.parentMessage.id,
        save: async (messages, expectedMessages) => {
          if (ending === "checkpoint-failure" && messages[0].parts.length > 0)
            throw new Error("DB unavailable");
          return saveControlTranscript(
            {
              userId: f.owner,
              sessionId: f.sessionId,
              messages,
              expectedMessages,
            },
            client
          );
        },
        onError: () => "Save failed",
        onComplete: (event) => handoff.complete(event),
      });
      if (ending === "checkpoint-failure") {
        await expect(durable.completion).rejects.toThrow("DB unavailable");
        await handoff.fail();
      } else await durable.completion;
      expect(executions).toBe(ending === "stop" ? 1 : 0);
      const ticket = (
        await listControlContinuations(f.owner, f.sessionId, client)
      )[0];
      expect(ticket.status).toBe(
        ending === "stop"
          ? "running"
          : ending === "approval"
            ? "needs_input"
            : "failed"
      );
      if (ending === "stop") {
        const saved = await saveControlTranscript(
          { userId: f.owner, sessionId: f.sessionId, messages: [] },
          client
        );
        expect(saved.messages.at(-1)?.parts).toContainEqual(
          expect.objectContaining({
            type: "tool-await_workers",
            state: "output-available",
            output,
          })
        );
        const tools = guardControlBackgroundTools(
          {
            read: tool({
              inputSchema: z.object({}),
              execute: async () => {
                executions++;
                return "actual tool output";
              },
            }),
          },
          () =>
            assertControlContinuationCurrent(
              f.owner,
              ticket.id,
              "runtime",
              client
            )
        );
        expect(
          await tools.read.execute!({}, { toolCallId: "before", messages: [] })
        ).toBe("actual tool output");
        const superseding: UIMessage = {
          id: "new-user",
          role: "user",
          parts: [{ type: "text", text: "Stop; report status only." }],
        };
        await saveControlTranscript(
          { userId: f.owner, sessionId: f.sessionId, messages: [superseding] },
          client
        );
        await expect(
          tools.read.execute!({}, { toolCallId: "after", messages: [] })
        ).rejects.toThrow("superseded");
        expect(executions).toBe(2);
        expect(
          (await listControlContinuations(f.owner, f.sessionId, client))[0]
            .status
        ).toBe("cancelled");
      }
    } finally {
      await f.db.close();
    }
  }
);

it("validates the worker tool input and refuses foreign mission workers without registering", async () => {
  const f = await controlContinuationDatabase("supabase");
  const client = f.client as unknown as Parameters<
    typeof saveControlTranscript
  >[1];
  try {
    const original = (
      await saveControlTranscript(
        { userId: f.owner, sessionId: f.sessionId, messages: [] },
        client
      )
    ).messages;
    const handoff = createControlWorkerHandoff(
      {
        userId: f.owner,
        sessionId: f.sessionId,
        parentAiCallId: f.parentCallId,
        messages: original,
        context: controlContinuationContextSchema.parse(f.context),
      },
      { client }
    );
    for (const workerRunIds of [[], ["invalid"], [randomUUID()]]) {
      await expect(
        handoff.tool.execute!(
          { workerRunIds, instruction: "Review results" },
          { toolCallId: "invalid", messages: [] }
        )
      ).rejects.toThrow();
    }
    expect(
      await listControlContinuations(f.owner, f.sessionId, client)
    ).toEqual([]);
    await f.db.query(
      "update external_agent_runs set status='success' where id=any($1)",
      [f.workerIds]
    );
    expect(
      await handoff.tool.execute!(
        { workerRunIds: f.workerIds, instruction: "Review results" },
        { toolCallId: "done", messages: [] }
      )
    ).toMatchObject({ status: "already_finished" });
    expect(
      await listControlContinuations(f.owner, f.sessionId, client)
    ).toEqual([]);
  } finally {
    await f.db.close();
  }
});
