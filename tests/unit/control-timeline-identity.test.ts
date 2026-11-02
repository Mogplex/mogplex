import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";

test("message and tool identities survive prepended history and streamed tool state changes", () => {
  const user: UIMessage = {
    id: "request-1",
    role: "user",
    parts: [{ type: "text", text: "Run checks" }],
  };
  const assistant = (
    state: "input-streaming" | "input-available"
  ): UIMessage => ({
    id: "response-1",
    role: "assistant",
    parts: [
      {
        type: "tool-run_command",
        toolCallId: "command-1",
        state,
        input: { command: "pnpm test" },
      },
    ],
  });
  const original = buildCombinedTimeline(
    [],
    [user, assistant("input-streaming")]
  );
  const updated = buildCombinedTimeline(
    [
      {
        kind: "assistant",
        label: "MOGPLEX",
        time: "earlier",
        body: "Saved activity",
      },
    ],
    [user, assistant("input-available")]
  );
  assert.ok(original[0].id);
  assert.ok(original[1].id);
  assert.equal(original[0].id, updated[1].id);
  assert.equal(original[1].id, updated[2].id);
  assert.equal(updated[2].messageId, "response-1");
});
