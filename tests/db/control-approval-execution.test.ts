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

const pending: UIMessage = {
  id: "approval-message",
  role: "assistant",
  parts: [
    {
      type: "tool-action",
      toolCallId: "action-call",
      state: "approval-requested",
      input: {},
      approval: { id: "approval-1" },
    },
  ],
};
const approved: UIMessage = {
  ...pending,
  parts: [
    {
      type: "tool-action",
      toolCallId: "action-call",
      state: "approval-responded",
      input: {},
      approval: { id: "approval-1", approved: true },
    },
  ],
};

it.each(["neon", "supabase"])(
  "%s claims an approval before the real SDK tool executes, once across concurrent submissions",
  async (root) => {
    const fixture = await controlTranscriptDatabase();
    try {
      await fixture.db.exec(
        await readFile(
          join(
            process.cwd(),
            root,
            "migrations",
            "20260905184500_control_approval_executions.sql"
          ),
          "utf8"
        )
      );
      await fixture.save([pending]);
      let executions = 0;
      const model = new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
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
      });
      const tools = {
        action: tool({
          inputSchema: z.object({}),
          execute: async () => {
            executions += 1;
            return { done: true };
          },
        }),
      };
      const execute = async (aiCallId: string) => {
        const prepared = await prepareControlRequestHistory(
          {
            userId: fixture.owner,
            sessionId: fixture.sessionId,
            aiCallId,
            savedMessages: [pending],
            incomingMessages: [approved],
          },
          fixture.client
        );
        const result = streamText({
          model,
          tools,
          messages: await convertToModelMessages(
            controlMessagesForModel(
              prepared.messages,
              prepared.claimedApprovalIds
            )
          ),
        });
        await result.consumeStream();
        return result.finishReason;
      };
      const results = await Promise.allSettled([
        execute("00000000-0000-4000-8000-000000000010"),
        execute("00000000-0000-4000-8000-000000000011"),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(executions).toBe(1);
      await expect(
        execute("00000000-0000-4000-8000-000000000012")
      ).rejects.toThrow("already submitted");
      const stored = await fixture.save([]);
      expect(stored.messages).toEqual([pending]);
      expect(
        (
          await fixture.db.query(
            "select count(*)::int as n from control_approval_executions"
          )
        ).rows
      ).toEqual([{ n: 1 }]);
      // An aborted stream can persist an approval response without its result.
      // Loading it in a later user turn must not execute the action again.
      await fixture.save([approved], [pending]);
      const followup: UIMessage = {
        id: "followup",
        role: "user",
        parts: [{ type: "text", text: "What happened?" }],
      };
      const prepared = await prepareControlRequestHistory(
        {
          userId: fixture.owner,
          sessionId: fixture.sessionId,
          aiCallId: "00000000-0000-4000-8000-000000000013",
          savedMessages: [approved, followup],
          incomingMessages: [approved, followup],
        },
        fixture.client
      );
      const followupResult = streamText({
        model,
        tools,
        messages: await convertToModelMessages(
          controlMessagesForModel(
            prepared.messages,
            prepared.claimedApprovalIds
          )
        ),
      });
      await followupResult.consumeStream();
      expect(await followupResult.finishReason).toBe("stop");
      expect(executions).toBe(1);
      // A different tenant cannot reserve an unclaimed decision.
      const fresh = {
        ...pending,
        id: "fresh-message",
        parts: [{ ...pending.parts[0], approval: { id: "approval-2" } }],
      } as UIMessage;
      await fixture.save([fresh]);
      const args = {
        p_user_id: "00000000-0000-4000-8000-000000000099",
        p_session_id: fixture.sessionId,
        p_message_id: fresh.id,
        p_approval_ids: ["approval-2"],
        p_ai_call_id: "00000000-0000-4000-8000-000000000014",
        p_expected_message: fresh,
      };
      expect(
        (await fixture.client!.rpc("control_claim_approvals", args)).data
      ).toBe(false);
      await fixture.db.query(
        "update control_sessions set archived = true where id = $1",
        [fixture.sessionId]
      );
      expect(
        (
          await fixture.client!.rpc("control_claim_approvals", {
            ...args,
            p_user_id: fixture.owner,
          })
        ).data
      ).toBe(false);
      expect(
        (
          await fixture.db.query(
            "select count(*)::int as n from control_approval_executions"
          )
        ).rows
      ).toEqual([{ n: 1 }]);
    } finally {
      await fixture.db.close();
    }
  }
);
