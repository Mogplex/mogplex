import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";

const SAMPLE_PATCH = [
  "diff --git a/lib/auth.ts b/lib/auth.ts",
  "--- a/lib/auth.ts",
  "+++ b/lib/auth.ts",
  "@@ -1,3 +1,4 @@",
  " import { session } from './session'",
  "+import { audit } from './audit'",
  " export function login() {",
  "-  return session.start()",
  "+  audit('login')",
  "+  return session.start()",
  " }",
].join("\n");

test("buildCombinedTimeline emits an inline diff event for patch-carrying tool output", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-apply_patch",
          toolCallId: "c1",
          state: "output-available",
          input: { file_path: "lib/auth.ts" },
          output: { patch: SAMPLE_PATCH, ok: true },
        },
      ],
    },
  ] as unknown as UIMessage[];

  const events = buildCombinedTimeline([], messages);
  const diffEvent = events.find((event) => event.kind === "diff");

  assert.ok(diffEvent, "expected a diff event");
  assert.equal(diffEvent.kind, "diff");
  if (diffEvent.kind !== "diff") return;
  assert.equal(diffEvent.patch, SAMPLE_PATCH);
  assert.deepEqual(diffEvent.files, [
    { path: "lib/auth.ts", add: "+3", del: "-1" },
  ]);
});

test("buildCombinedTimeline detects a patch in tool input when output has none", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-run_command",
          toolCallId: "c1",
          state: "output-available",
          input: { command: "git diff" },
          output: { stdout: SAMPLE_PATCH },
        },
      ],
    },
  ] as unknown as UIMessage[];

  const events = buildCombinedTimeline([], messages);

  assert.ok(events.some((event) => event.kind === "tool"));
  assert.ok(
    events.some((event) => event.kind === "diff"),
    "stdout carrying a patch should produce a diff event"
  );
});

test("buildCombinedTimeline does not emit diff events for plain tool output", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-list_worktrees",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { worktrees: ["wt-1", "wt-2"] },
        },
      ],
    },
  ] as unknown as UIMessage[];

  const events = buildCombinedTimeline([], messages);

  assert.equal(events.filter((event) => event.kind === "diff").length, 0);
  assert.equal(events.filter((event) => event.kind === "tool").length, 1);
});
