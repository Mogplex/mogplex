import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestratorToolContext } from "../../lib/agents/orchestrator/types";
import type { SandboxCommandExecution } from "../../lib/agents/tools/sandbox";
import {
  createRunChecksTool,
  type RepositoryCheckReceipt,
} from "../../lib/agents/orchestrator/checks/tool";

const options = { context: {}, toolCallId: "checks", messages: [] };
async function withChecks(
  input: {
    commandOutput?: Record<string, unknown>;
    changed?: boolean;
    invalidProbe?: boolean;
    deniedProbe?: boolean;
    lostCheck?: boolean;
  },
  run: (receipt: RepositoryCheckReceipt, commands: string[]) => void
) {
  const secret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
  const commands: string[] = [];
  let probes = 0;
  const execution: SandboxCommandExecution = {
    checkOutput: async (result) => result,
    execute: async (_id, _headers, body) => {
      commands.push(body.command);
      if (body.command.startsWith("node --input-type=commonjs")) {
        probes += 1;
        if (input.deniedProbe)
          return Response.json({ error: "Not permitted" }, { status: 403 });
        return Response.json({
          exitCode: 0,
          stdout: input.invalidProbe
            ? "malformed"
            : JSON.stringify({
                revision: (input.changed && probes > 1 ? "b" : "a").repeat(64),
                manifest: {
                  available: true,
                  packageManager: "pnpm@10.12.4",
                  scripts: {
                    typecheck: "defined",
                    lint: "defined",
                    build: "defined",
                    "test:all": "defined",
                  },
                  lockfiles: [],
                },
              }),
        });
      }
      if (input.lostCheck)
        return Response.json(
          { error: "Sandbox no longer available" },
          { status: 410 }
        );
      return Response.json(
        input.commandOutput ?? { exitCode: 0, stdout: "Passed", stderr: "" }
      );
    },
  };
  const context: OrchestratorToolContext = {
    userId: "user-1",
    repoId: "repo-1",
    sandboxBinding: { sandboxId: "sandbox-1", status: "running" },
    sandboxExecution: execution,
    verificationPaths: new Set([".mogplex/identity.ts"]),
  };
  try {
    const tool = createRunChecksTool(context);
    const receipt = (await tool.execute!(
      {},
      options
    )) as RepositoryCheckReceipt;
    run(receipt, commands);
  } finally {
    if (secret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = secret;
  }
}

test("run_checks executes the full scripts in one workspace and returns source-bound receipts", async () => {
  await withChecks({}, (receipt, commands) => {
    assert.equal(receipt.ok, true);
    assert.equal(receipt.sandboxId, "sandbox-1");
    assert.equal(receipt.receiptVersion, 1);
    assert.equal(
      receipt.workspaceRevisionBefore,
      receipt.workspaceRevisionAfter
    );
    assert.deepEqual(commands.slice(1, 5), [
      "CI=1 pnpm run typecheck",
      "CI=1 pnpm run lint",
      "CI=1 pnpm run build",
      "CI=1 pnpm run test:all",
    ]);
    assert.equal(commands.length, 6);
    assert.ok(receipt.checks.every((check) => check.status === "passed"));
    assert.ok(commands[0].includes(".mogplex/identity.ts"));
  });
});

test("passing commands cannot verify a different final source revision", async () => {
  await withChecks({ changed: true }, (receipt) => {
    assert.equal(receipt.ok, false);
    assert.ok(receipt.checks.every((check) => check.status === "passed"));
    assert.notEqual(
      receipt.workspaceRevisionBefore,
      receipt.workspaceRevisionAfter
    );
    assert.match(receipt.error ?? "", /contents changed/);
  });
});

test("run_checks retains confirmed failures and still runs the other checks", async () => {
  await withChecks(
    { commandOutput: { exitCode: 2, stdout: "Type error" } },
    (receipt, commands) => {
      assert.equal(receipt.ok, false);
      assert.equal(commands.length, 6);
      assert.ok(receipt.checks.every((check) => check.status === "failed"));
    }
  );
});

test("run_checks neither retries a lost command nor launches the final probe afterward", async () => {
  await withChecks({ lostCheck: true }, (receipt, commands) => {
    assert.equal(receipt.ok, false);
    assert.equal(commands.length, 2);
    assert.equal(receipt.workspaceRevisionAfter, null);
    assert.ok(receipt.checks.every((check) => check.status === "blocked"));
  });
});

for (const input of [{ invalidProbe: true }, { deniedProbe: true }]) {
  test(`run_checks stops before check execution when its initial probe is ${input.invalidProbe ? "invalid" : "unauthorized"}`, async () => {
    await withChecks(input, (receipt, commands) => {
      assert.equal(receipt.ok, false);
      assert.equal(commands.length, 1);
      assert.equal(receipt.checks.length, 4);
      assert.ok(receipt.checks.every((check) => check.status === "blocked"));
      assert.equal(receipt.workspaceRevisionBefore, null);
    });
  });
}
