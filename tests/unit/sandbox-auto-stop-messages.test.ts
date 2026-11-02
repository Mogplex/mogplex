import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxTaskLifecycle } from "../../lib/agents/orchestrator/sandbox-task-lifecycle";

test("a caller without an owning call is logged and does not exclude any active call", async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalWarn = console.warn;
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
  const warnings: unknown[][] = [];
  console.warn = (...args) => warnings.push(args);
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
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
      output: { sandboxId: "sandbox-2" },
      success: true,
    });
    assert.equal(await lifecycle.footer(), null);
    assert.equal(binding.status, "running");
    assert.deepEqual(requestBodies, [{ automatic: true }, { automatic: true }]);
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
