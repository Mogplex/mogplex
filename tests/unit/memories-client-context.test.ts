import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMemoriesClient,
  makeFakeSupabase,
  type Embedder,
} from "./helpers/memories-client-fixtures";

test("loadMemoryContextNative skips embedder when user has zero memories", async () => {
  const mod = await loadMemoriesClient();
  const { supabase, calls } = makeFakeSupabase([]);
  let embedderCalls = 0;
  const embedder: Embedder = (async () => {
    embedderCalls += 1;
    return null;
  }) as Embedder;

  const result = await mod.loadMemoryContextNative("user-A", "hello", 10, {
    supabase,
    embedder,
  });

  assert.equal(result, null, "should short-circuit to null");
  assert.equal(
    embedderCalls,
    0,
    "embedder must not be invoked when no memories exist"
  );
  const rpcCall = calls.find((c) => c.method.startsWith("rpc."));
  assert.equal(rpcCall, undefined, "no vector RPC should run");
  assert.equal(
    calls.filter((c) => c.method === "memories.select").length,
    1,
    "only the existence check select should run"
  );
});

test("loadMemoryContextNative invokes embedder + search when memories exist", async () => {
  const mod = await loadMemoriesClient();
  const row = {
    id: "memory-1",
    lane: "session" as const,
    content: "remembered fact",
    metadata: undefined,
    created_at: "2026-04-17T00:00:00.000Z",
    updated_at: "2026-04-17T00:00:00.000Z",
  };
  const { supabase, calls } = makeFakeSupabase([row]);
  let embedderCalls = 0;
  const embedder: Embedder = (async () => {
    embedderCalls += 1;
    return null;
  }) as Embedder;

  const result = await mod.loadMemoryContextNative("user-A", "hello", 10, {
    supabase,
    embedder,
  });

  assert.deepEqual(result, { memories: [{ content: "remembered fact" }] });
  assert.equal(
    embedderCalls,
    1,
    "embedder runs exactly once for the searchMemories call"
  );
  const existenceCheck = calls.find(
    (c) => c.method === "memories.select" && c.args.user_id === "user-A"
  );
  assert.ok(existenceCheck, "existence check should run with user_id filter");
});

test("loadMemoryContextNative excludes session memories from other workspace sessions", async () => {
  const mod = await loadMemoriesClient();
  const rows = [
    {
      id: "session-current",
      lane: "session" as const,
      content: "current workspace context",
      metadata: {
        repo_id: "repo-1",
        workspace_session_id: "ws-1",
        conversation_id: "conv-1",
      },
      created_at: "2026-04-18T00:00:00.000Z",
      updated_at: "2026-04-18T00:00:00.000Z",
    },
    {
      id: "session-other-conversation",
      lane: "session" as const,
      content: "other conversation context",
      metadata: {
        repo_id: "repo-1",
        workspace_session_id: "ws-1",
        conversation_id: "conv-2",
      },
      created_at: "2026-04-17T12:00:00.000Z",
      updated_at: "2026-04-17T12:00:00.000Z",
    },
    {
      id: "session-other",
      lane: "session" as const,
      content: "other workspace context",
      metadata: {
        repo_id: "repo-1",
        workspace_session_id: "ws-2",
      },
      created_at: "2026-04-17T00:00:00.000Z",
      updated_at: "2026-04-17T00:00:00.000Z",
    },
    {
      id: "semantic-repo",
      lane: "semantic" as const,
      content: "repo context",
      metadata: {
        repo_id: "repo-1",
      },
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
    },
  ];
  const { supabase } = makeFakeSupabase(rows);
  const result = await mod.loadMemoryContextNative(
    "user-A",
    "context",
    10,
    {
      supabase,
      embedder: (async () => null) as Embedder,
    },
    {
      repoId: "repo-1",
      workspaceSessionId: "ws-1",
      conversationId: "conv-1",
    }
  );

  assert.deepEqual(result, {
    memories: [
      { content: "current workspace context" },
      { content: "repo context" },
    ],
  });
});
