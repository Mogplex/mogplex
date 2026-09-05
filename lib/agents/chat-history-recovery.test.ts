import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import type { AiCall } from "@/lib/types";
import { CHAT_TOOL_INTERRUPTED_MESSAGE } from "./chat-stream";
import {
  needsChatHistoryRecovery,
  reconcileChatHistory,
} from "./chat-history-recovery";

function message(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: "response",
    role: "assistant",
    metadata: { ai_call_id: "call" },
    parts: [
      {
        type: "tool-bash",
        toolCallId: "unfinished",
        state: "input-available",
        input: { command: "check" },
      },
      {
        type: "tool-bash",
        toolCallId: "complete",
        state: "output-available",
        input: {},
        output: "retained",
      },
      { type: "text", text: "Partial response", state: "streaming" },
    ],
    ...overrides,
  };
}
function call(
  overrides: Partial<
    Pick<AiCall, "id" | "type" | "status" | "conversation_id">
  > = {}
) {
  return {
    id: "call",
    type: "chat" as const,
    status: "failed" as const,
    conversation_id: "conversation",
    ...overrides,
  };
}

describe("saved chat recovery", () => {
  it.each(["failed", "cancelled", "success"] as const)(
    "reconciles missing results from a %s run without inventing success",
    (status) => {
      const messages = [message()];
      const next = reconcileChatHistory(
        messages,
        [call({ status })],
        "conversation"
      );
      expect(next[0].parts[0]).toMatchObject({
        state: "output-error",
        errorText: CHAT_TOOL_INTERRUPTED_MESSAGE,
      });
      expect(next[0].parts[1]).toBe(messages[0].parts[1]);
      expect(next[0].parts[2]).toMatchObject({
        text: "Partial response",
        state: "done",
      });
      expect(messages[0].parts[0]).toMatchObject({ state: "input-available" });
      expect(
        reconcileChatHistory(next, [call({ status })], "conversation")
      ).toBe(next);
    }
  );
  it.each([
    [],
    [call({ status: "pending" })],
    [call({ status: "streaming" })],
    [call({ id: "other" })],
    [call({ type: "agent" })],
    [call({ conversation_id: "other" })],
  ])(
    "does not infer interruption from missing, live, or unrelated evidence (%j)",
    (...calls) => {
      const messages = [message()];
      expect(reconcileChatHistory(messages, calls, "conversation")).toBe(
        messages
      );
    }
  );
  it("leaves unknown metadata, non-assistant messages, completed tools, and approvals intact", () => {
    const messages = [
      message({ metadata: undefined }),
      message({ metadata: "malformed" }),
      message({ metadata: { ai_call_id: 42 } }),
      message({ metadata: {} }),
      message({ role: "user" }),
      message({
        parts: [
          {
            type: "tool-bash",
            toolCallId: "approval",
            state: "approval-requested",
            input: {},
            approval: { id: "approval" },
          },
        ],
      }),
      message({
        parts: [
          {
            type: "tool-bash",
            toolCallId: "done",
            state: "output-available",
            input: {},
            output: "retained",
          },
        ],
      }),
    ];
    expect(messages.some(needsChatHistoryRecovery)).toBe(false);
    expect(reconcileChatHistory(messages, [call()], "conversation")).toBe(
      messages
    );
  });
});
