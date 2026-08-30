import assert from "node:assert/strict";
import test from "node:test";
import { useConversationsStore } from "../../hooks/use-conversations";
import { pickConversationMutableFields } from "../../app/api/conversations/route";

function resetStore() {
  useConversationsStore.setState({
    conversations: {},
    conversationList: [],
    userId: null,
    defaultModel: "minimax/minimax-m2.5",
  });
}

test("conversation updates allowlist mutable fields and redact persisted secrets", () => {
  const fields = pickConversationMutableFields({
    user_id: "victim-user",
    repo_id: "victim-repo",
    workspace_session_id: "victim-workspace",
    model: "openai/gpt-5.6-sol",
    mode: "SAFE",
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "token ghp_abcdefgh12345678" }],
      },
    ],
  });

  assert.equal(Object.hasOwn(fields, "user_id"), false);
  assert.equal(Object.hasOwn(fields, "repo_id"), false);
  assert.equal(Object.hasOwn(fields, "workspace_session_id"), false);
  assert.equal(fields.model, "openai/gpt-5.6-sol");
  assert.equal(fields.mode, "SAFE");
  assert.doesNotMatch(JSON.stringify(fields.messages), /ghp_abcdefgh12345678/);
});

test("starting a new chat assigns a fresh persisted identity without clearing the previous row", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];

  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json({
      conversation: {
        id: "conversation-new",
        updated_at: "2026-08-30T12:00:00.000Z",
      },
    });
  }) as typeof fetch;

  try {
    useConversationsStore.setState({
      userId: "user-1",
      conversations: {
        "pane-1": {
          id: "conversation-old",
          repoId: "repo-old",
          workspaceSessionId: "workspace-old",
          messages: [{ id: "message-old", role: "user", parts: [] }],
          localMsgs: [],
          harnessState: {},
          model: "openai/gpt-5.6-sol",
          mode: "AUTO",
          updatedAt: "2026-08-30T11:00:00.000Z",
        },
      },
    });

    useConversationsStore.getState().startConversation("pane-1", {
      id: "conversation-new",
      repoId: "repo-new",
      workspaceSessionId: "workspace-new",
    });

    assert.equal(requests.length, 0);
    assert.deepEqual(
      useConversationsStore.getState().getConversation("pane-1"),
      {
        id: "conversation-new",
        repoId: "repo-new",
        workspaceSessionId: "workspace-new",
        messages: [],
        localMsgs: [],
        harnessState: {},
        model: "openai/gpt-5.6-sol",
        mode: "AUTO",
        updatedAt: null,
      }
    );

    assert.equal(
      await useConversationsStore.getState().syncToSupabase("pane-1"),
      true
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body, {
      id: "conversation-new",
      repo_id: "repo-new",
      workspace_session_id: "workspace-new",
      model: "openai/gpt-5.6-sol",
      mode: "AUTO",
      messages: [],
      local_msgs: [],
      harness_state: {},
      title: "",
      expected_updated_at: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
    resetStore();
  }
});

test("a conversation conflict never advances the stale local version", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ expected_updated_at: string; messages: unknown[] }> =
    [];

  globalThis.fetch = (async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(
      {
        error: "CONFLICT",
        conversation: {
          updated_at: "2026-08-30T12:00:00.000Z",
          messages: [{ id: "server-message", role: "user", parts: [] }],
        },
      },
      { status: 409 }
    );
  }) as typeof fetch;

  try {
    useConversationsStore.setState({
      userId: "user-1",
      conversations: {
        "pane-1": {
          id: "conversation-1",
          repoId: "repo-1",
          workspaceSessionId: "workspace-1",
          messages: [{ id: "stale-message", role: "user", parts: [] }],
          localMsgs: [],
          harnessState: {},
          model: "openai/gpt-5.6-sol",
          mode: "AUTO",
          updatedAt: "2026-08-30T11:00:00.000Z",
        },
      },
    });

    assert.equal(
      await useConversationsStore.getState().syncToSupabase("pane-1"),
      false
    );
    assert.equal(
      await useConversationsStore.getState().syncToSupabase("pane-1"),
      false
    );
    assert.deepEqual(
      requests.map((request) => request.expected_updated_at),
      ["2026-08-30T11:00:00.000Z", "2026-08-30T11:00:00.000Z"]
    );
    assert.equal(
      useConversationsStore.getState().conversations["pane-1"]?.messages[0]?.id,
      "stale-message"
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetStore();
  }
});

test("closing a pane deletes its persisted conversation identity, not the pane identity", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    useConversationsStore.setState({
      conversations: {
        "pane-1": {
          id: "conversation-1",
          repoId: "repo-1",
          workspaceSessionId: "workspace-1",
          messages: [],
          localMsgs: [],
          harnessState: {},
          model: "openai/gpt-5.6-sol",
          mode: "AUTO",
          updatedAt: null,
        },
      },
    });

    await useConversationsStore.getState().removeConversation("pane-1");

    assert.deepEqual(requests, ["/api/conversations?id=conversation-1"]);
    assert.equal(
      useConversationsStore.getState().conversations["pane-1"],
      undefined
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetStore();
  }
});

test("loading history activates the selected conversation in the current pane without writing a clone", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return Response.json({
      id: "conversation-old",
      repo_id: "repo-1",
      workspace_session_id: "workspace-original",
      messages: [{ id: "message-1", role: "user", parts: [] }],
      local_msgs: [],
      harness_state: {},
      model: "anthropic/claude-sonnet-4.6",
      mode: "SAFE",
      title: "Existing conversation",
      updated_at: "2026-08-30T10:00:00.000Z",
    });
  }) as typeof fetch;

  try {
    const loaded = await useConversationsStore
      .getState()
      .loadConversation("pane-current", "conversation-old", "repo-1");

    assert.equal(loaded?.id, "conversation-old");
    assert.equal(
      useConversationsStore.getState().getConversation("pane-current").id,
      "conversation-old"
    );
    assert.deepEqual(requests, [
      {
        url: "/api/conversations?id=conversation-old",
        method: "GET",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    resetStore();
  }
});

test("loading a conversation refuses to retarget it into another repository", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      id: "conversation-a",
      repo_id: "repo-a",
      workspace_session_id: "workspace-a",
      messages: [],
      local_msgs: [],
      model: "openai/gpt-5.6-sol",
      mode: "AUTO",
      updated_at: "2026-08-30T10:00:00.000Z",
    })) as typeof fetch;

  try {
    const loaded = await useConversationsStore
      .getState()
      .loadConversation("pane-1", "conversation-a", "repo-b");

    assert.equal(loaded, null);
    assert.equal(
      useConversationsStore.getState().conversations["pane-1"],
      undefined
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetStore();
  }
});
