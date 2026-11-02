import assert from "node:assert/strict";
import test from "node:test";
import { createRepositoryCheckProbe } from "../../lib/agents/orchestrator/checks/tool";

for (const sample of [
  {
    name: "a completed command with malformed output",
    output: { exitCode: 0, stdout: "malformed" },
    completion: "confirmed",
  },
  {
    name: "a completed command without Node available",
    output: { exitCode: 127, stdout: "", stderr: "node is unavailable" },
    completion: "confirmed",
  },
  {
    name: "a response with no exit evidence",
    output: { stdout: "No exit receipt" },
    completion: "unknown",
  },
  {
    name: "a lost command response",
    output: { error: "Sandbox is unavailable" },
    status: 410,
    completion: "unknown",
  },
] as const) {
  test(`the source probe distinguishes ${sample.name}`, async () => {
    const previous = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "fixture-internal-secret";
    let calls = 0;
    try {
      const probe = createRepositoryCheckProbe({
        userId: "user-1",
        repoId: "repo-1",
        sandboxBinding: { sandboxId: "sandbox-1", status: "running" },
        sandboxExecution: {
          checkOutput: async (result) => result,
          execute: async () => {
            calls += 1;
            return Response.json(sample.output, {
              status: "status" in sample ? sample.status : 200,
            });
          },
        },
      });
      const result = await probe({
        context: {},
        toolCallId: "probe",
        messages: [],
      });
      assert.equal(result.ok, false);
      if (result.ok)
        throw new Error("This fixture has no valid source receipt.");
      assert.equal(result.commandCompletion, sample.completion);
      assert.equal(calls, 1);
    } finally {
      if (previous === undefined) delete process.env.INTERNAL_API_SECRET;
      else process.env.INTERNAL_API_SECRET = previous;
    }
  });
}
