import assert from "node:assert/strict";
import test from "node:test";
import { buildChatRequestBody } from "../../lib/agents/chat-request-body";

test("buildChatRequestBody prefers the active working branch over the repo default branch", () => {
  const payload = buildChatRequestBody(
    "gpt-5.4",
    {
      id: "repo-1",
      full_name: "acme/demo",
      default_branch: "main",
      working_branch: "feature/manual-override",
    },
    { id: "sandbox-1" },
    "conversation-1"
  );

  assert.equal(payload.repoBranch, "feature/manual-override");
  assert.equal(payload.sandboxId, "sandbox-1");
});
