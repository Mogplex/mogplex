import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { demoteStaleToolOutputs } from "./reduce";

function toolMessage(toolCallId: string, value: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName: "read_file",
        output: { type: "text", value },
      },
    ],
  };
}

function textMessage(role: "user" | "assistant", text: string): ModelMessage {
  return { role, content: text };
}

function toolOutputValue(message: ModelMessage): string {
  if (message.role !== "tool" || !Array.isArray(message.content)) {
    throw new Error("not a tool message");
  }
  const part = message.content[0];
  if (part.type !== "tool-result" || part.output.type !== "text") {
    throw new Error("unexpected part shape");
  }
  return part.output.value;
}

describe("demoteStaleToolOutputs", () => {
  const big = "y".repeat(5_000);

  it("should demote oversized stale tool outputs to typed references", () => {
    const messages: ModelMessage[] = [
      textMessage("user", "start"),
      toolMessage("call-1", big),
      ...Array.from({ length: 9 }, (_, index) =>
        textMessage("assistant", `later ${index}`)
      ),
    ];
    const reduced = demoteStaleToolOutputs(messages, {
      keepRecentMessages: 4,
      minChars: 1_000,
    });
    const demoted = toolOutputValue(reduced[1]);
    expect(demoted).toContain("[tool output demoted");
    expect(demoted).toContain("call-1");
    expect(demoted).toContain("read_file");
    expect(demoted.length).toBeLessThan(big.length);
    // Head excerpt preserved so the agent knows what the call returned.
    expect(demoted).toContain("yyyy");
  });

  it("should keep recent tool outputs intact", () => {
    const messages: ModelMessage[] = [
      textMessage("user", "start"),
      toolMessage("call-1", big),
    ];
    const reduced = demoteStaleToolOutputs(messages, {
      keepRecentMessages: 4,
      minChars: 1_000,
    });
    expect(reduced).toBe(messages);
    expect(toolOutputValue(reduced[1])).toBe(big);
  });

  it("should leave small outputs alone and return the same array", () => {
    const messages: ModelMessage[] = [
      toolMessage("call-1", "tiny"),
      ...Array.from({ length: 8 }, (_, index) =>
        textMessage("assistant", `later ${index}`)
      ),
    ];
    expect(
      demoteStaleToolOutputs(messages, {
        keepRecentMessages: 2,
        minChars: 1_000,
      })
    ).toBe(messages);
  });

  it("should not demote an already-demoted output twice", () => {
    const messages: ModelMessage[] = [
      toolMessage("call-1", big),
      ...Array.from({ length: 8 }, (_, index) =>
        textMessage("assistant", `later ${index}`)
      ),
    ];
    const once = demoteStaleToolOutputs(messages, {
      keepRecentMessages: 2,
      minChars: 1_000,
    });
    const twice = demoteStaleToolOutputs(once, {
      keepRecentMessages: 2,
      minChars: 10,
    });
    expect(toolOutputValue(twice[0])).toBe(toolOutputValue(once[0]));
  });

  it("should never touch user messages", () => {
    const bigUser = textMessage("user", big);
    const messages: ModelMessage[] = [
      bigUser,
      ...Array.from({ length: 8 }, (_, index) =>
        textMessage("assistant", `later ${index}`)
      ),
    ];
    const reduced = demoteStaleToolOutputs(messages, {
      keepRecentMessages: 2,
      minChars: 100,
    });
    expect(reduced[0]).toBe(bigUser);
  });
});
