import assert from "node:assert/strict";
import test from "node:test";
import {
  getHarnessResumeSessionId,
  useConversationsStore,
} from "../../hooks/use-conversations";

test("getHarnessResumeSessionId only resumes sessions that belong to the active sandbox", () => {
  assert.equal(
    getHarnessResumeSessionId(
      {
        "claude-code": {
          sessionId: "claude-session-1",
          sandboxId: "sandbox-a",
        },
      },
      "claude-code",
      "sandbox-a"
    ),
    "claude-session-1"
  );

  assert.equal(
    getHarnessResumeSessionId(
      {
        "claude-code": {
          sessionId: "claude-session-1",
          sandboxId: "sandbox-a",
        },
      },
      "claude-code",
      "sandbox-b"
    ),
    null
  );

  assert.equal(
    getHarnessResumeSessionId(
      {
        "claude-code": {
          sessionId: "legacy-session-without-sandbox",
        },
      },
      "claude-code",
      "sandbox-a"
    ),
    null
  );
});

test("loadConversation normalizes persisted harness state and drops invalid sessions", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    Response.json(
      {
        id: "pane-1",
        messages: [],
        local_msgs: [],
        harness_state: {
          "claude-code": {
            sessionId: "claude-session-1",
            sandboxId: "sandbox-a",
          },
          codex: {
            sessionId: "",
            sandboxId: "sandbox-b",
          },
        },
        model: "harness:claude-code",
        mode: "AUTO",
        updated_at: null,
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )) as typeof fetch;

  try {
    await useConversationsStore.getState().loadConversation("pane-1");

    const conversation = useConversationsStore
      .getState()
      .getConversation("pane-1");
    assert.deepEqual(conversation.harnessState, {
      "claude-code": {
        sessionId: "claude-session-1",
        sandboxId: "sandbox-a",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    useConversationsStore.setState({
      conversations: {},
      conversationList: [],
      userId: null,
      defaultModel: "minimax/minimax-m2.5",
    });
  }
});
