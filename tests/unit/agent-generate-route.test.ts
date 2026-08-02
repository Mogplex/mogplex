import assert from "node:assert/strict";
import test from "node:test";

function setSupabaseTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

async function loadAgentGenerateRoute() {
  setSupabaseTestEnv();
  return import("../../app/api/agents/generate/route");
}

test("POST /api/agents/generate contains ai_call logging failures in onFinish", async () => {
  setSupabaseTestEnv();
  const [{ supabaseAdmin }, { supabaseAdmin: aliasedSupabaseAdmin }] =
    await Promise.all([
      import("../../lib/supabase/admin"),
      import("@/lib/supabase/admin"),
    ]);
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  const originalAliasedFrom =
    aliasedSupabaseAdmin.from.bind(aliasedSupabaseAdmin);
  const originalConsoleError = console.error;
  const errorLogs: unknown[][] = [];
  let capturedOnFinish: ((event: never) => unknown) | undefined;

  function throwingFrom(table: string) {
    if (table === "ai_calls") {
      return {
        insert: async () => {
          throw new Error("network down");
        },
      };
    }
    return originalFrom(table as never);
  }

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: throwingFrom,
  });
  Object.defineProperty(aliasedSupabaseAdmin, "from", {
    configurable: true,
    value: throwingFrom,
  });
  console.error = (...args: unknown[]) => {
    errorLogs.push(args);
  };

  try {
    const { createAgentGeneratePostHandler } = await loadAgentGenerateRoute();
    const handler = createAgentGeneratePostHandler({
      requireUserId: async () => "user-123",
      resolveUserDefaultModelId: async () => "minimax/minimax-m2.7",
      canUserSetDefaultModel: async () => true,
      resolveUserLanguageModel: async () => "mock-model" as never,
      streamText: ((input) => {
        capturedOnFinish = input.onFinish as typeof capturedOnFinish;
        return {
          toTextStreamResponse() {
            return new Response("{}", { status: 200 });
          },
        };
      }) as typeof import("ai").streamText,
    });

    const response = await handler(
      new Request("http://localhost/api/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Create a PR review agent.",
          generatorModel: "minimax/minimax-m2.7",
        }),
      })
    );

    assert.equal(response.status, 200);
    const onFinish = capturedOnFinish;
    assert.ok(onFinish);
    await assert.doesNotReject(async () => {
      await onFinish({
        totalUsage: undefined,
        providerMetadata: undefined,
        finishReason: "stop",
      } as never);
    });
    assert.equal(
      errorLogs[0]?.[0],
      "[agent-generate] failed to record ai_call"
    );
    assert.match(String(errorLogs[0]?.[1]), /network down/);
  } finally {
    console.error = originalConsoleError;
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: originalFrom,
    });
    Object.defineProperty(aliasedSupabaseAdmin, "from", {
      configurable: true,
      value: originalAliasedFrom,
    });
  }
});

test("sanitizeExistingAgentForPrompt drops raw system prompt text", async () => {
  const { sanitizeExistingAgentForPrompt } = await loadAgentGenerateRoute();

  const sanitized = sanitizeExistingAgentForPrompt({
    name: "REVIEWER-BOT",
    description: "Reviews pull requests.",
    category: "code-review",
    system_prompt:
      "You are a reviewer.\n\n## REVIEW FOCUS\n- Rollout safety\nSecret token sk-secret-key\n## OUTPUT FORMAT\n- Findings",
  });

  assert.deepEqual(sanitized, {
    name: "REVIEWER-BOT",
    description: "Reviews pull requests.",
    category: "code-review",
    system_prompt_sections: ["REVIEW FOCUS", "OUTPUT FORMAT"],
  });
});

test("POST /api/agents/generate rejects disabled generator models", async () => {
  const { createAgentGeneratePostHandler } = await loadAgentGenerateRoute();
  let resolveCalls = 0;
  let streamCalls = 0;

  const handler = createAgentGeneratePostHandler({
    requireUserId: async () => "user-123",
    resolveUserDefaultModelId: async () => "minimax/minimax-m2.7",
    canUserSetDefaultModel: async () => false,
    resolveUserLanguageModel: async () => {
      resolveCalls += 1;
      return "mock-model" as never;
    },
    streamText: ((_) => {
      streamCalls += 1;
      return {
        toTextStreamResponse() {
          return new Response("{}", { status: 200 });
        },
      };
    }) as typeof import("ai").streamText,
  });

  const response = await handler(
    new Request("http://localhost/api/agents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Create a PR review agent.",
        generatorModel: "anthropic/claude-sonnet-4.6",
      }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "generatorModel must be enabled and available",
  });
  assert.equal(resolveCalls, 0);
  assert.equal(streamCalls, 0);
});

test("POST /api/agents/generate only forwards sanitized edit context", async () => {
  const { createAgentGeneratePostHandler } = await loadAgentGenerateRoute();
  let capturedPrompt = "";

  const handler = createAgentGeneratePostHandler({
    requireUserId: async () => "user-123",
    resolveUserDefaultModelId: async () => "minimax/minimax-m2.7",
    canUserSetDefaultModel: async () => true,
    resolveUserLanguageModel: async () => "mock-model" as never,
    streamText: ((input) => {
      const firstMessage = input.messages?.[0];
      capturedPrompt = String(firstMessage?.content ?? "");
      return {
        toTextStreamResponse() {
          return new Response("{}", { status: 200 });
        },
      };
    }) as typeof import("ai").streamText,
  });

  const response = await handler(
    new Request("http://localhost/api/agents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Make this stricter on rollout safety.",
        generatorModel: "minimax/minimax-m2.7",
        existingAgent: {
          name: "REVIEWER-BOT",
          description: "Reviews pull requests.",
          category: "code-review",
          system_prompt:
            "Review code carefully.\n\n## REVIEW FOCUS\n- Rollout safety\nSecret token sk-secret-key",
        },
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.match(capturedPrompt, /Existing agent context/);
  assert.match(capturedPrompt, /"name": "REVIEWER-BOT"/);
  assert.match(capturedPrompt, /"description": "Reviews pull requests\."/);
  assert.match(capturedPrompt, /"category": "code-review"/);
  assert.match(capturedPrompt, /"system_prompt_sections": \[/);
  assert.doesNotMatch(capturedPrompt, /Review code carefully\./);
  assert.doesNotMatch(capturedPrompt, /sk-secret-key/);
});
