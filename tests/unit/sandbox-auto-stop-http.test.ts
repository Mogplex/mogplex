import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxTaskLifecycle } from "../../lib/agents/orchestrator/sandbox-task-lifecycle";

const unconfirmed =
  "Could not confirm that sandbox compute stopped. Check its status before leaving.";
const cases = [
  {
    name: "200 confirmed stop",
    status: 200,
    body: { sandbox: { runtime_summary: { status: "stopped" } } },
    reason: null,
    footer: null,
  },
  {
    name: "200 missing stop confirmation",
    status: 200,
    body: {},
    reason: "unconfirmed",
    footer: unconfirmed,
  },
  {
    name: "409 uncommitted_changes",
    status: 409,
    body: { reason: "uncommitted_changes" },
    reason: "unsaved_work",
    footer:
      "Compute was left running to protect changes that cannot be preserved when their workspace stops. Commit and push the changes before stopping compute.",
  },
  {
    name: "409 inspection_unavailable",
    status: 409,
    body: { reason: "inspection_unavailable" },
    reason: "inspection_unavailable",
    footer:
      "Could not check all workspaces for unsaved changes. Compute was left running to protect your work. Review the changes before stopping it.",
  },
  {
    name: "409 sandbox_busy",
    status: 409,
    body: { reason: "sandbox_busy" },
    reason: "follow_up",
    footer: null,
  },
  {
    name: "409 sandbox_active_work",
    status: 409,
    body: { reason: "sandbox_active_work" },
    reason: "follow_up",
    footer: null,
  },
  {
    name: "503 activity_unknown",
    status: 503,
    body: { reason: "activity_unknown" },
    reason: "activity_unknown",
    footer:
      "Compute was left running because active work could not be checked. Check compute status before stopping it.",
  },
  {
    name: "503 unknown refusal",
    status: 503,
    body: { reason: "unexpected_reason" },
    reason: "unconfirmed",
    footer: unconfirmed,
  },
  {
    name: "409 mismatched activity_unknown status",
    status: 409,
    body: { reason: "activity_unknown" },
    reason: "unconfirmed",
    footer: unconfirmed,
  },
] as const;

for (const fixture of cases) {
  test(`automatic cleanup maps HTTP ${fixture.name} through the real stop client`, async () => {
    const originalFetch = globalThis.fetch;
    const originalSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
    let calls = 0;
    // Mock only the network boundary: deps.stop remains the production client.
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        automatic: true,
        completingAiCallId: "current-call",
      });
      return Response.json(fixture.body, { status: fixture.status });
    };
    try {
      const binding = {
        sandboxId: "sandbox-1" as string | null,
        status: "running" as "running" | "pending" | "unavailable",
      };
      const lifecycle = createSandboxTaskLifecycle({
        userId: "user-1",
        aiCallId: "current-call",
        userText: "fix the test",
        binding,
        deps: {
          loadState: async () => ({ status: "running", previewUrl: null }),
        },
      });
      const toolCall = { toolName: "edit_file" };
      lifecycle.onToolStart({ toolCall });
      lifecycle.onToolFinish({ toolCall, success: true });
      assert.equal(await lifecycle.footer(), fixture.footer);
      const outcome = await lifecycle.cleanup();
      if (fixture.reason === null) {
        assert.equal(outcome.state, "stopped");
        assert.equal(binding.status, "unavailable");
      } else {
        assert.equal(outcome.state, "running");
        assert.ok(outcome.state === "running");
        assert.equal(outcome.reason, fixture.reason);
        assert.deepEqual(outcome.reasons, [fixture.reason]);
        assert.equal(binding.status, "running");
      }
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
      else process.env.INTERNAL_API_SECRET = originalSecret;
    }
  });
}
