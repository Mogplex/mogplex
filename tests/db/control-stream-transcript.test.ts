import { convertToModelMessages, type UIMessageChunk } from "ai";
import { expect, it } from "vitest";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import { persistedControlStream } from "@/lib/control/persisted-stream";
import { validateControlChatMessages } from "@/app/api/control/chat/_lib/messages";

it("persists final tool evidence despite a racing browser save, then restores it for the next model turn", async () => {
  const fixture = await controlTranscriptDatabase();
  try {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    const durable = await persistedControlStream({
      stream: new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
      messages: [],
      expectedMessages: [],
      messageId: "reply",
      save: fixture.save,
      onError: () => "Save failed",
    });
    // A browser snapshot reaches the database before any server checkpoint.
    await fixture.save([
      {
        id: "reply",
        role: "assistant",
        parts: [{ type: "text", text: "incomplete" }],
      },
    ]);
    const leaving = durable.stream.cancel();
    controller.enqueue({ type: "start" });
    controller.enqueue({
      type: "tool-input-available",
      toolCallId: "command",
      toolName: "run_command",
      input: { command: "pnpm test" },
    });
    controller.enqueue({
      type: "tool-output-error",
      toolCallId: "command",
      errorText: "Test assertion failed",
    });
    controller.enqueue({ type: "finish", finishReason: "stop" });
    controller.close();
    await durable.completion;
    await leaving;
    const saved = await fixture.save([]);
    const next = await convertToModelMessages(
      await validateControlChatMessages(saved.messages)
    );
    expect(JSON.stringify(next)).toContain("Test assertion failed");
    expect(JSON.stringify(next)).not.toContain("incomplete");
    expect(saved.messages).toHaveLength(1);
  } finally {
    await fixture.db.close();
  }
});
