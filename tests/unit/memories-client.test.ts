import assert from "node:assert/strict";
import test from "node:test";

async function loadMemoriesClient() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/memories-client");
}

type MemoriesModule = Awaited<ReturnType<typeof loadMemoriesClient>>;
type Embedder = Parameters<MemoriesModule["createMemoriesClient"]>[1] extends
  | {
      embedder: infer E;
    }
  | undefined
  ? E
  : never;
type Memory = Awaited<ReturnType<MemoriesModule["addToLane"]>>;
type MemoriesClient = Parameters<MemoriesModule["editMemory"]>[0];
type SupabaseLike = Parameters<
  MemoriesModule["createMemoriesClient"]
>[1] extends { supabase: infer S } | undefined
  ? S
  : never;

type Call = { method: string; args: Record<string, unknown> };

function makeFakeSupabase(rows: Memory[] = []) {
  const calls: Call[] = [];
  let affectedIds: string[] = rows.map((r) => r.id);
  let rpcError: { message: string } | null = null;

  const filters: Record<string, unknown> = {};
  let currentTable = "";
  let mutation: "select" | "insert" | "update" | "delete" = "select";
  let insertPayload: Record<string, unknown> | null = null;
  let updatePayload: Record<string, unknown> | null = null;
  let ilikePattern: string | null = null;
  let returnSelect = false;

  const reset = () => {
    for (const key of Object.keys(filters)) delete filters[key];
    mutation = "select";
    insertPayload = null;
    updatePayload = null;
    ilikePattern = null;
    returnSelect = false;
  };

  const unescapeLike = (value: string) => value.replace(/\\([\\%_])/g, "$1");

  const readRowValue = (row: Memory, column: string) => {
    if (column.startsWith("metadata->>")) {
      const key = column.slice("metadata->>".length);
      return row.metadata?.[key] ?? null;
    }
    return (row as Record<string, unknown>)[column];
  };

  const matchesFilters = (row: Memory) =>
    Object.entries(filters).every(([key, value]) => {
      if (key.endsWith("__contains")) {
        const column = key.slice(0, -"__contains".length);
        const rowValue = readRowValue(row, column);
        if (
          !rowValue ||
          typeof rowValue !== "object" ||
          Array.isArray(rowValue)
        ) {
          return false;
        }

        return Object.entries(value as Record<string, unknown>).every(
          ([nestedKey, nestedValue]) =>
            (rowValue as Record<string, unknown>)[nestedKey] === nestedValue
        );
      }

      if (key.endsWith("__ilike")) {
        const column = key.slice(0, -7);
        const rowValue = readRowValue(row, column);
        if (typeof rowValue !== "string") return false;
        const needle = unescapeLike(String(value))
          .replace(/%/g, "")
          .toLowerCase();
        return rowValue.toLowerCase().includes(needle);
      }

      if (key.endsWith("__is")) {
        const column = key.slice(0, -4);
        const rowValue = readRowValue(row, column);
        if (value === null) return rowValue == null;
        return rowValue === value;
      }

      if (key.endsWith("__lt")) {
        const column = key.slice(0, -4);
        const rowValue = readRowValue(row, column);
        return rowValue === undefined
          ? true
          : String(rowValue).localeCompare(String(value)) < 0;
      }

      const rowValue = readRowValue(row, key);
      return rowValue === undefined ? true : rowValue === value;
    });

  const filteredRows = () => rows.filter(matchesFilters);

  const builder: Record<string, unknown> = {
    insert(payload: Record<string, unknown>) {
      mutation = "insert";
      insertPayload = payload;
      return builder;
    },
    update(payload: Record<string, unknown>) {
      mutation = "update";
      updatePayload = payload;
      return builder;
    },
    delete() {
      mutation = "delete";
      return builder;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    lt(col: string, val: unknown) {
      filters[`${col}__lt`] = val;
      return builder;
    },
    ilike(col: string, pattern: string) {
      filters[`${col}__ilike`] = pattern;
      ilikePattern = pattern;
      return builder;
    },
    contains(col: string, value: Record<string, unknown>) {
      filters[`${col}__contains`] = value;
      return builder;
    },
    is(col: string, val: unknown) {
      filters[`${col}__is`] = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    single() {
      const selectedRows = filteredRows();
      calls.push({
        method: `${currentTable}.${mutation}.single`,
        args: { ...filters, insertPayload, updatePayload },
      });
      const data =
        mutation === "insert" && insertPayload
          ? {
              id: "inserted-id",
              lane: insertPayload.lane,
              content: insertPayload.content,
              metadata: insertPayload.metadata ?? null,
              created_at: "now",
              updated_at: "now",
            }
          : (selectedRows[0] ?? null);
      reset();
      return Promise.resolve({ data, error: null });
    },
    then(onFulfilled: (value: unknown) => unknown) {
      const selectedRows = filteredRows();
      calls.push({
        method: `${currentTable}.${mutation}`,
        args: {
          ...filters,
          insertPayload,
          updatePayload,
          ilikePattern,
          returnSelect,
        },
      });
      let data: unknown = selectedRows;
      if (mutation === "update" || mutation === "delete") {
        data = returnSelect ? affectedIds.map((id) => ({ id })) : null;
      }
      const result = { data, error: null };
      reset();
      return Promise.resolve(onFulfilled(result));
    },
  };

  builder.select = (_cols: string) => {
    if (mutation === "update" || mutation === "delete") returnSelect = true;
    return builder;
  };

  const fakeSupabase = {
    from(table: string) {
      currentTable = table;
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc.${name}`, args });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    supabase: fakeSupabase as unknown as SupabaseLike,
    calls,
    setAffectedIds(ids: string[]) {
      affectedIds = ids;
    },
    setRpcError(err: { message: string } | null) {
      rpcError = err;
    },
  };
}

async function makeClient(
  opts: {
    embedder?: Embedder;
    rows?: Memory[];
  } = {}
): Promise<{
  mod: MemoriesModule;
  client: MemoriesClient;
  calls: Call[];
  setAffectedIds: (ids: string[]) => void;
  setRpcError: (err: { message: string } | null) => void;
}> {
  const mod = await loadMemoriesClient();
  const { supabase, calls, setAffectedIds, setRpcError } = makeFakeSupabase(
    opts.rows ?? []
  );
  const embedder: Embedder = opts.embedder ?? ((async () => null) as Embedder);
  const client = mod.createMemoriesClient("user-A", { supabase, embedder });
  return { mod, client, calls, setAffectedIds, setRpcError };
}

test("escapeLikePattern escapes %, _, and backslash", async () => {
  const { escapeLikePattern } = await loadMemoriesClient();
  assert.equal(escapeLikePattern("50%"), "50\\%");
  assert.equal(escapeLikePattern("foo_bar"), "foo\\_bar");
  assert.equal(escapeLikePattern("a\\b"), "a\\\\b");
  assert.equal(escapeLikePattern("plain text"), "plain text");
});

test("searchMemories ILIKE fallback escapes user metacharacters", async () => {
  const { mod, client, calls } = await makeClient({
    embedder: (async () => null) as Embedder,
  });
  await mod.searchMemories(client, "50% off_deal");
  const ilikeCall = calls.find((c) => typeof c.args.ilikePattern === "string");
  assert.ok(ilikeCall, "expected an ILIKE call");
  assert.equal(ilikeCall.args.ilikePattern, "%50\\% off\\_deal%");
  assert.equal(ilikeCall.args.user_id, "user-A");
});

test("searchMemories uses RPC with user_id when embedder returns a vector", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.1);
  const { mod, client, calls } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  await mod.searchMemories(client, "anything", "semantic", 5);
  const rpcCall = calls.find((c) => c.method === "rpc.match_memories");
  assert.ok(rpcCall);
  assert.equal(rpcCall.args.match_user_id, "user-A");
  assert.equal(rpcCall.args.match_lane, "semantic");
  assert.equal(rpcCall.args.match_count, 5);
});

test("searchMemories supplements vector hits with ILIKE on non-embedded rows", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.1);
  const { mod, client, calls } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  await mod.searchMemories(client, "needle");
  const rpcCall = calls.find((c) => c.method === "rpc.match_memories");
  const ilikeCall = calls.find((c) => typeof c.args.ilikePattern === "string");
  assert.ok(rpcCall, "expected vector RPC call");
  assert.ok(ilikeCall, "expected lexical supplement call");
  assert.equal(
    ilikeCall.args.embedding__is,
    null,
    "lexical supplement must be scoped to rows where embedding IS NULL"
  );
  assert.equal(ilikeCall.args.user_id, "user-A");
});

test("editMemory throws 'Memory not found' when no row is affected", async () => {
  const { mod, client, setAffectedIds } = await makeClient();
  setAffectedIds([]);
  await assert.rejects(
    () => mod.editMemory(client, "missing-id", "new content"),
    /Memory not found/
  );
});

test("editMemory skips embedding when embedder returns null (no data loss)", async () => {
  const { mod, client, calls, setAffectedIds } = await makeClient({
    embedder: (async () => null) as Embedder,
  });
  setAffectedIds(["memory-1"]);
  await mod.editMemory(client, "memory-1", "updated");
  const updateCall = calls.find((c) => c.method === "memories.update");
  assert.ok(updateCall);
  const payload = updateCall.args.updatePayload as Record<string, unknown>;
  assert.equal(payload.content, "updated");
  assert.ok(
    !("embedding" in payload),
    "embedding should be omitted when embedder returns null"
  );
});

test("editMemory writes embedding when embedder returns a vector", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.2);
  const { mod, client, calls, setAffectedIds } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  setAffectedIds(["memory-1"]);
  await mod.editMemory(client, "memory-1", "updated");
  const updateCall = calls.find((c) => c.method === "memories.update");
  const payload = updateCall?.args.updatePayload as Record<string, unknown>;
  assert.deepEqual(payload.embedding, embedding);
});

test("forgetMemory throws 'Memory not found' when no row is affected", async () => {
  const { mod, client, setAffectedIds } = await makeClient();
  setAffectedIds([]);
  await assert.rejects(
    () => mod.forgetMemory(client, "missing-id"),
    /Memory not found/
  );
});

test("vacuum deletes only session-lane rows older than 30 days for the user", async () => {
  const { mod, client, calls } = await makeClient();
  const now = new Date("2026-04-17T00:00:00Z");
  await mod.vacuum(client, now);
  const deleteCall = calls.find((c) => c.method === "memories.delete");
  assert.ok(deleteCall);
  assert.equal(deleteCall.args.user_id, "user-A");
  assert.equal(deleteCall.args.lane, "session");
  assert.equal(deleteCall.args.created_at__lt, "2026-03-18T00:00:00.000Z");
});

test("addToLane forwards user_id and metadata to the insert", async () => {
  const { mod, client, calls } = await makeClient({
    embedder: (async () => null) as Embedder,
  });
  await mod.addToLane(client, "semantic", "the sky is blue", {
    source: "chat",
  });
  const insertCall = calls.find((c) => c.method === "memories.insert.single");
  assert.ok(insertCall);
  const payload = insertCall.args.insertPayload as Record<string, unknown>;
  assert.equal(payload.user_id, "user-A");
  assert.equal(payload.lane, "semantic");
  assert.equal(payload.content, "the sky is blue");
  assert.deepEqual(payload.metadata, { source: "chat" });
  assert.equal(payload.embedding, null);
});

test("listByLane applies project and team memory scope filters", async () => {
  const { mod, client, calls } = await makeClient();

  await mod.listByLane(client, "semantic", 50, {
    repoId: "repo-1",
    resourceScope: "team",
    productTeamId: "team-1",
  });

  const teamCall = calls.find((c) => c.method === "memories.select");
  assert.ok(teamCall);
  assert.equal(teamCall.args.user_id, "user-A");
  assert.equal(teamCall.args.lane, "semantic");
  assert.deepEqual(teamCall.args.metadata__contains, {
    repo_id: "repo-1",
    product_team_id: "team-1",
  });
});

test("listByLane can filter personal memories without matching team rows", async () => {
  const { mod, client, calls } = await makeClient();

  await mod.listByLane(client, "semantic", 50, {
    resourceScope: "personal",
  });

  const selectCall = calls.find((c) => c.method === "memories.select");
  assert.ok(selectCall);
  assert.equal(selectCall.args.user_id, "user-A");
  assert.equal(selectCall.args["metadata->>product_team_id__is"], null);
});

test("searchMemories propagates RPC errors rather than swallowing them", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.1);
  const { mod, client, setRpcError } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  setRpcError({ message: "connection failed" });
  await assert.rejects(
    () => mod.searchMemories(client, "anything"),
    /connection failed/
  );
});

test("editMemory / forgetMemory throw MemoryNotFoundError (instanceof-checkable)", async () => {
  const { mod, client, setAffectedIds } = await makeClient();
  setAffectedIds([]);
  await assert.rejects(
    () => mod.editMemory(client, "missing-id", "new content"),
    (err: unknown) => err instanceof mod.MemoryNotFoundError
  );
  await assert.rejects(
    () => mod.forgetMemory(client, "missing-id"),
    (err: unknown) => err instanceof mod.MemoryNotFoundError
  );
});

test("createMemoriesClient throws without a userId", async () => {
  const { createMemoriesClient } = await loadMemoriesClient();
  assert.throws(() => createMemoriesClient(), /requires a userId/);
});

test("validateMetadata returns undefined for null/undefined", async () => {
  const { validateMetadata } = await loadMemoriesClient();
  assert.equal(validateMetadata(undefined), undefined);
  assert.equal(validateMetadata(null), undefined);
});

test("validateMetadata accepts plain objects", async () => {
  const { validateMetadata } = await loadMemoriesClient();
  const input = { source: "chat", nested: { ok: true } };
  assert.deepEqual(validateMetadata(input), input);
});

test("validateMetadata rejects arrays, primitives, and non-plain objects", async () => {
  const { validateMetadata, InvalidMetadataError } = await loadMemoriesClient();
  for (const bad of [[], "string", 42, true, new Date()]) {
    assert.throws(
      () => validateMetadata(bad),
      (err: unknown) => err instanceof InvalidMetadataError
    );
  }
});

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
  // Only the existence check should run — no rpc, and no follow-up
  // listByLane / searchMemories selects beyond the single existence probe.
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
  // Once for listByLane(session), once for searchMemories(query). The
  // existence check is a non-embedder select so it doesn't increment.
  assert.equal(
    embedderCalls,
    1,
    "embedder runs exactly once for the searchMemories call"
  );
  // Verify the existence check is scoped to user_id.
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

test("getMemoryScopeForLane keeps conversation scope inside a workspace session", async () => {
  const { getMemoryScopeForLane } = await loadMemoriesClient();

  assert.deepEqual(
    getMemoryScopeForLane("session", {
      repoId: "repo-1",
      workspaceSessionId: "ws-1",
      conversationId: "conv-1",
      resourceScope: "team",
      productTeamId: "team-1",
      sandboxId: "sbx-1",
    }),
    {
      repoId: "repo-1",
      workspaceSessionId: "ws-1",
      conversationId: "conv-1",
      resourceScope: "team",
      productTeamId: "team-1",
    }
  );
});

test("buildLaneScopedMetadata applies lane-specific scope fields", async () => {
  const { buildLaneScopedMetadata } = await loadMemoriesClient();

  assert.deepEqual(
    buildLaneScopedMetadata(
      "session",
      { role: "user" },
      {
        repoId: "repo-1",
        workspaceSessionId: "ws-1",
        conversationId: "conv-1",
        sandboxId: "sbx-1",
        source: "native-chat",
        agent: "native",
      }
    ),
    {
      role: "user",
      repo_id: "repo-1",
      workspace_session_id: "ws-1",
      conversation_id: "conv-1",
      sandbox_id: "sbx-1",
      source: "native-chat",
      agent: "native",
    }
  );

  assert.deepEqual(
    buildLaneScopedMetadata(
      "episodic",
      { outcome: "completed" },
      {
        repoId: "repo-1",
        workspaceSessionId: "ws-1",
        conversationId: "conv-1",
      }
    ),
    {
      outcome: "completed",
      repo_id: "repo-1",
      workspace_session_id: "ws-1",
    }
  );

  assert.deepEqual(
    buildLaneScopedMetadata(
      "semantic",
      { topic: "repo" },
      {
        repoId: "repo-1",
        resourceScope: "team",
        productTeamId: "team-1",
        workspaceSessionId: "ws-1",
        conversationId: "conv-1",
      }
    ),
    {
      topic: "repo",
      repo_id: "repo-1",
      resource_scope: "team",
      product_team_id: "team-1",
    }
  );
});

test("buildLaneScopedMetadata enforces the final metadata size cap after scope fields are merged", async () => {
  const { buildLaneScopedMetadata, InvalidMetadataError, MAX_METADATA_BYTES } =
    await loadMemoriesClient();

  const almostTooLarge = {
    note: "x".repeat(MAX_METADATA_BYTES - 32),
  };

  assert.throws(
    () =>
      buildLaneScopedMetadata("session", almostTooLarge, {
        repoId: "repo-123",
        workspaceSessionId: "workspace-123",
        conversationId: "conversation-123",
        sandboxId: "sandbox-123",
        source: "native-chat",
        agent: "native",
      }),
    (error: unknown) => error instanceof InvalidMetadataError
  );
});

test("validateMetadata rejects payloads over MAX_METADATA_BYTES", async () => {
  const { validateMetadata, MAX_METADATA_BYTES, InvalidMetadataError } =
    await loadMemoriesClient();
  const huge = { data: "x".repeat(MAX_METADATA_BYTES + 1) };
  assert.throws(
    () => validateMetadata(huge),
    (err: unknown) =>
      err instanceof InvalidMetadataError && err.message.includes("exceeds")
  );
});
