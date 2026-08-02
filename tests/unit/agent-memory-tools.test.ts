import assert from "node:assert/strict";
import test from "node:test";

async function loadToolsModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/agents/tools");
}

test("buildStaticTools registers memory tools when a userId is provided", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools(
    undefined,
    "user-123",
    null,
    undefined,
    undefined,
    {
      workspaceSessionId: "ws-1",
      conversationId: "conv-1",
    }
  );

  for (const name of ["add_memory", "search_memories", "list_memories"]) {
    assert.ok(name in tools, `expected ${name} to be registered`);
  }
});

test("buildStaticTools omits memory tools when userId is missing", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools();

  for (const name of ["add_memory", "search_memories", "list_memories"]) {
    assert.equal(
      name in tools,
      false,
      `expected ${name} NOT to be registered without a user`
    );
  }
});

test("add_memory input schema rejects invalid lane and enforces content bounds", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools(undefined, "user-123");
  const tool = (
    tools as Record<
      string,
      { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }
    >
  )["add_memory"];
  assert.ok(tool, "add_memory tool must exist");

  assert.equal(
    tool.inputSchema.safeParse({ lane: "nope", content: "hi" }).success,
    false,
    "bogus lane should fail"
  );
  assert.equal(
    tool.inputSchema.safeParse({ lane: "session", content: "" }).success,
    false,
    "empty content should fail"
  );
  assert.equal(
    tool.inputSchema.safeParse({ lane: "session", content: "note" }).success,
    true,
    "valid args should pass"
  );
  assert.equal(
    tool.inputSchema.safeParse({
      lane: "session",
      content: "x".repeat(16_001),
    }).success,
    false,
    "content over 16 000 chars should fail"
  );
  assert.equal(
    tool.inputSchema.safeParse({
      lane: "session",
      content: "note",
      metadata: { blob: "y".repeat(5000) },
    }).success,
    false,
    "metadata exceeding 4096 serialised bytes should fail"
  );
  assert.equal(
    tool.inputSchema.safeParse({
      lane: "session",
      content: "note",
      metadata: { tag: "small" },
    }).success,
    true,
    "small metadata should pass"
  );
});

test("search_memories / list_memories share the lane enum", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools(undefined, "user-123") as Record<
    string,
    { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }
  >;

  assert.equal(
    tools.search_memories.inputSchema.safeParse({ query: "foo", lane: "bad" })
      .success,
    false
  );
  assert.equal(
    tools.search_memories.inputSchema.safeParse({ query: "foo" }).success,
    true,
    "search without a lane should be allowed"
  );
  assert.equal(
    tools.list_memories.inputSchema.safeParse({ lane: "session" }).success,
    true
  );
  assert.equal(
    tools.list_memories.inputSchema.safeParse({ lane: "what" }).success,
    false
  );
});
