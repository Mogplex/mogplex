import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxTaskLifecycle } from "../../lib/agents/orchestrator/sandbox-task-lifecycle";

for (const [reason, status, expected] of [
  [
    "uncommitted_changes",
    409,
    "Commit and push the changes before stopping compute.",
  ],
  ["inspection_unavailable", 409, "Review the changes before stopping it."],
  ["activity_unknown", 503, "Check compute status before stopping it."],
] as const) {
  test(`automatic cleanup explains the known ${reason} refusal`, async () => {
    const originalFetch = globalThis.fetch;
    const originalSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
    globalThis.fetch = async () => Response.json({ reason }, { status });
    try {
      const lifecycle = createSandboxTaskLifecycle({
        userId: "user-1",
        aiCallId: "current-call",
        userText: "fix the test",
        binding: { sandboxId: "sandbox-1", status: "running" },
        deps: {
          loadState: async () => ({
            status: "running",
            previewUrl: null,
          }),
        },
      });
      lifecycle.onToolStart({ toolCall: { toolName: "edit_file" } });
      lifecycle.onToolFinish({
        toolCall: { toolName: "edit_file" },
        success: true,
      });
      const footer = await lifecycle.footer();
      assert.ok(footer);
      assert.ok(footer.endsWith(expected));
      assert.doesNotMatch(footer, /could not confirm/i);
      assert.equal((await lifecycle.cleanup()).state, "running");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
      else process.env.INTERNAL_API_SECRET = originalSecret;
    }
  });
}

test("a caller without an owning call is logged and does not exclude any active call", async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalWarn = console.warn;
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
  const warnings: unknown[][] = [];
  console.warn = (...args) => warnings.push(args);
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ reason: "sandbox_active_work" }, { status: 409 });
  };
  try {
    const binding = { sandboxId: "sandbox-1", status: "running" as const };
    const lifecycle = createSandboxTaskLifecycle({
      userId: "user-1",
      aiCallId: null,
      userText: "fix the test",
      binding,
      deps: {
        loadState: async () => ({ status: "running", previewUrl: null }),
      },
    });
    lifecycle.onToolStart({ toolCall: { toolName: "edit_file" } });
    lifecycle.onToolFinish({
      toolCall: { toolName: "edit_file" },
      success: true,
    });
    assert.equal(await lifecycle.footer(), null);
    assert.equal(binding.status, "running");
    assert.deepEqual(requestBody, { automatic: true });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /no completing ai_call/);
    assert.deepEqual(warnings[0][1], { sandboxId: "sandbox-1" });
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = originalSecret;
  }
});
