import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildTranscriptMarkdown } from "../../lib/control/export-transcript";

test("buildTranscriptMarkdown renders roles, text, attachments, and tools", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [
        { type: "text", text: "Fix the auth bug" },
        {
          type: "file",
          filename: "trace.log",
          mediaType: "text/plain",
          url: "data:text/plain;base64,eA==",
        },
      ],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Found it." },
        {
          type: "tool-read_file",
          toolCallId: "call-1",
          state: "output-available",
          input: { path: "auth.ts" },
          output: "ok",
        },
      ],
    },
  ] as unknown as UIMessage[];

  const markdown = buildTranscriptMarkdown("Auth investigation", messages);

  assert.ok(markdown.startsWith("# Auth investigation"));
  assert.ok(markdown.includes("## You"));
  assert.ok(markdown.includes("## Mogplex"));
  assert.ok(markdown.includes("Fix the auth bug"));
  assert.ok(markdown.includes("_Attachment: trace.log_"));
  assert.ok(markdown.includes("`read_file` — output-available"));
});

test("buildTranscriptMarkdown skips blank text parts", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "   " },
        { type: "text", text: "Real answer" },
      ],
    },
  ] as unknown as UIMessage[];

  const markdown = buildTranscriptMarkdown("Session", messages);
  const bodies = markdown.split("\n").filter((line) => line.trim() === "");
  assert.ok(markdown.includes("Real answer"));
  // No double blank-line gap from the skipped empty text part.
  assert.ok(!markdown.includes("\n\n\n"));
  assert.ok(bodies.length > 0);
});
