import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxTaskLifecycle } from "../../lib/agents/orchestrator/sandbox-task-lifecycle";

for (const [reason, expected] of [
  [
    "uncommitted_changes",
    "Commit and push the changes before stopping compute.",
  ],
  ["inspection_unavailable", "Review its changes before stopping it."],
] as const) {
  test(`automatic cleanup explains the known ${reason} refusal`, async () => {
    const originalFetch = globalThis.fetch;
    const originalSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
    globalThis.fetch = async () => Response.json({ reason }, { status: 409 });
    try {
      const lifecycle = createSandboxTaskLifecycle({
        userId: "user-1",
        userText: "fix the test",
        binding: { sandboxId: "sandbox-1", status: "running" },
        deps: {
          loadState: async () => ({
            status: "running",
            persistent: false,
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
