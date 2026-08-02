import assert from "node:assert/strict";
import test from "node:test";

async function loadChatRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/chat/route");
}

test("POST /api/chat returns 429 before starting a chat run when limits are exceeded", async () => {
  const { createChatPostHandler } = await loadChatRoute();

  const handler = createChatPostHandler({
    requireUserId: async () => "user-123",
    enforceChatLimits: async () => ({
      allowed: false,
      status: 429,
      code: "chat_rate_limited",
      error: "Chat rate limit exceeded",
      reason: "chat_hourly_rate_exceeded",
      retryAfterSeconds: 120,
      limit: {
        name: "chat_starts_per_hour",
        value: 30,
        windowSeconds: 3600,
      },
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
        enableTools: true,
      }),
    })
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "Chat rate limit exceeded",
    code: "chat_rate_limited",
    retryAfterSeconds: 120,
    limit: {
      name: "chat_starts_per_hour",
      value: 30,
      windowSeconds: 3600,
    },
  });
});

test("buildMemoryQueryFromMessages prefers the latest user text content", async () => {
  const { buildMemoryQueryFromMessages } = await loadChatRoute();

  const query = buildMemoryQueryFromMessages([
    { role: "user", content: "first message" },
    { role: "assistant", content: "reply" },
    {
      role: "user",
      content: [
        { type: "text", text: "latest" },
        { type: "tool-result", text: "ignored" },
        { type: "text", text: "question" },
      ],
    },
  ]);

  assert.equal(query, "latest question");
});

test("buildMemoryContextSection formats rules and memories into a prompt section", async () => {
  const { buildMemoryContextSection } = await loadChatRoute();

  const section = buildMemoryContextSection({
    rules: [{ content: "Always cite sources" }],
    memories: [{ content: "Repo uses pnpm workspaces" }],
  });

  assert.equal(
    section,
    [
      "## Rules",
      "- Always cite sources",
      "## Relevant Memories",
      "- Repo uses pnpm workspaces",
    ].join("\n")
  );
});
