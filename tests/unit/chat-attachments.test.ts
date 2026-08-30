import assert from "node:assert/strict";
import test from "node:test";
import { normalizeChatMessages } from "../../app/api/chat/_lib/messages";
import {
  materializeBrowserAttachmentsForHarness,
  normalizeBrowserHarnessAttachments,
} from "../../lib/harness/browser-attachments";

test("native chat preserves validated AI SDK file and tool parts", () => {
  const messages = normalizeChatMessages([
    {
      role: "user",
      parts: [
        { type: "text", text: "Review this" },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          url: "data:text/plain;base64,bm90ZXM=",
        },
        {
          type: "tool-search",
          toolCallId: "tool-1",
          state: "output-available",
          input: { query: "Mogplex" },
          output: { matches: 1 },
        },
      ],
    },
  ]);

  assert.deepEqual(messages[0]?.parts, [
    { type: "text", text: "Review this" },
    {
      type: "file",
      mediaType: "text/plain",
      filename: "notes.txt",
      url: "data:text/plain;base64,bm90ZXM=",
    },
    {
      type: "tool-search",
      toolCallId: "tool-1",
      state: "output-available",
      input: { query: "Mogplex" },
      output: { matches: 1 },
    },
  ]);
});

test("native chat rejects remote and oversized file parts", () => {
  assert.throws(
    () =>
      normalizeChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "text/plain",
              url: "https://example.com/notes.txt",
            },
          ],
        },
      ]),
    /data URLs/
  );
  assert.throws(
    () =>
      normalizeChatMessages([
        {
          role: "user",
          parts: Array.from({ length: 6 }, () => ({
            type: "file" as const,
            mediaType: "text/plain",
            url: "data:text/plain;base64,bm90ZXM=",
          })),
        },
      ]),
    /up to 5 file attachments/
  );
  assert.throws(
    () =>
      normalizeChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              mediaType: "image/png",
              url: "data:text/plain;base64,bm90ZXM=",
            },
          ],
        },
      ]),
    /Invalid chat file attachment/
  );
  assert.throws(
    () => normalizeChatMessages([{ role: "owner", parts: [] }]),
    /Invalid chat message role/
  );
  assert.throws(
    () => normalizeChatMessages([{ role: "user", parts: [null as never] }]),
    /Invalid chat message part/
  );
  assert.throws(
    () =>
      normalizeChatMessages([
        { role: "user", parts: [{ type: "text", text: 7 as never }] },
      ]),
    /Invalid chat text part/
  );
});

test("browser harness attachments are decoded into ignored sandbox files", async () => {
  const writes: Array<{ path: string; content: Buffer }> = [];
  const attachments = normalizeBrowserHarnessAttachments([
    {
      name: "../screen shot.txt",
      mediaType: "text/plain",
      dataUrl: "data:text/plain;base64,aGVsbG8=",
    },
  ]);

  const result = await materializeBrowserAttachmentsForHarness({
    sandbox: {
      async readFile() {
        throw new Error("missing");
      },
      async writeFiles(files) {
        writes.push(...files);
      },
    },
    rootDirectory: "apps/web",
    attachments,
  });

  assert.deepEqual(
    writes.map((write) => write.path),
    [
      "apps/web/.mogplex/.gitignore",
      "apps/web/.mogplex/chat-attachments/01-screen_shot.txt",
    ]
  );
  assert.equal(writes[1]?.content.toString(), "hello");
  assert.match(
    result.promptSection ?? "",
    /\.mogplex\/chat-attachments\/01-screen_shot\.txt/
  );
});

test("browser harness attachment validation rejects malformed data", () => {
  assert.equal(normalizeBrowserHarnessAttachments("not-an-array"), null);
  assert.throws(
    () =>
      normalizeBrowserHarnessAttachments([
        {
          name: "remote.txt",
          mediaType: "text/plain",
          dataUrl: "https://example.com/remote.txt",
        },
      ]),
    /data URL/
  );
});
