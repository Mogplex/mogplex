import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { collectChangedFiles, workspaceSnapshotWarning } from "./changed-files";

it("uses persisted Git evidence including shell-generated and untracked assets after compute stops", () => {
  const files = [
    {
      path: "public/site.min.js",
      additions: 1,
      deletions: 0,
      patch:
        "--- /dev/null\n+++ b/public/site.min.js\n@@ -0,0 +1 @@\n+minified();\n",
    },
  ];
  const messages: UIMessage[] = [
    {
      id: "reply",
      role: "assistant",
      metadata: {
        workspace_changes: {
          sandboxId: "sandbox",
          capturedAt: "2026-10-11T12:00:00Z",
          files,
        },
      },
      parts: [
        {
          type: "dynamic-tool",
          toolName: "write_file",
          toolCallId: "write",
          state: "output-available",
          input: { path: "deleted-later.ts" },
          output: { success: true },
        },
      ],
    },
  ];
  expect(collectChangedFiles(messages)).toEqual([
    { ...files[0], state: "done" },
  ]);
  messages.push({
    id: "committed",
    role: "assistant",
    parts: [],
    metadata: {
      workspace_changes: {
        sandboxId: "sandbox",
        capturedAt: "2026-10-11T12:01:00Z",
        files: [],
      },
    },
  });
  expect(collectChangedFiles(messages)).toEqual([]);
  messages.push({
    id: "user-metadata",
    role: "user",
    parts: [],
    metadata: {
      workspace_changes: {
        sandboxId: "sandbox",
        capturedAt: "2026-10-11T12:02:00Z",
        files,
      },
    },
  });
  expect(collectChangedFiles(messages)).toEqual([]);
  messages.push({
    id: "stale",
    role: "assistant",
    parts: [],
    metadata: { workspace_snapshot_error: "private provider failure" },
  });
  expect(workspaceSnapshotWarning(messages)).toContain("out of date");
  expect(workspaceSnapshotWarning(messages)).not.toContain("private provider");
});
