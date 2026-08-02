import assert from "node:assert/strict";
import test from "node:test";
import { HARNESSES } from "../../lib/harness/config";
import { getHarnessInstallSpec } from "../../lib/harness/install";
import {
  HarnessCancelRequestedError,
  runHarness,
} from "../../lib/harness/runner";

test("runHarness honors cancellation before launching the detached harness command", async () => {
  const runCommandCalls: Array<{
    cmd: string;
    args?: string[];
    detached?: boolean;
  }> = [];

  const sandbox = {
    async readFile() {
      throw new Error("missing");
    },
    async writeFiles() {},
    async runCommand(input: {
      cmd: string;
      args?: string[];
      detached?: boolean;
    }) {
      runCommandCalls.push(input);

      if (input.cmd === "sh" && input.args?.[1]?.startsWith("npm ls -g ")) {
        return {
          exitCode: 1,
          stdout: async () => "{}",
          stderr: async () => "",
        };
      }

      if (input.cmd === "sh" && input.args?.[1]?.startsWith("npm i -g ")) {
        return {
          exitCode: 0,
          stdout: async () => "installed harness",
          stderr: async () => "",
        };
      }

      return {
        cmdId: "cmd_123",
      };
    },
  } as const;

  let cancelChecks = 0;

  await assert.rejects(
    runHarness(sandbox as never, "codex", "hello world", "sk-test", {
      shouldCancel: async () => {
        cancelChecks += 1;
        return cancelChecks >= 3;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarnessCancelRequestedError);
      assert.equal(error.installed, true);
      assert.equal(error.installLogs, "installed harness");
      return true;
    }
  );

  assert.equal(
    runCommandCalls.some((call) => call.detached === true),
    false,
    "detached harness execution should never start after cancellation is requested"
  );
});

test("runHarness reinstalls when the installed harness version does not match the pinned version", async () => {
  const installSpec = getHarnessInstallSpec(HARNESSES.codex);
  const runCommandCalls: Array<{
    cmd: string;
    args?: string[];
    detached?: boolean;
    env?: Record<string, string>;
  }> = [];

  const sandbox = {
    async readFile() {
      throw new Error("missing");
    },
    async writeFiles() {},
    async runCommand(input: {
      cmd: string;
      args?: string[];
      detached?: boolean;
      env?: Record<string, string>;
    }) {
      runCommandCalls.push(input);

      if (input.cmd === "sh" && input.args?.[1]?.startsWith("npm ls -g ")) {
        return {
          exitCode: 0,
          stdout: async () =>
            JSON.stringify({
              dependencies: {
                "@openai/codex": { version: "0.117.0" },
              },
            }),
          stderr: async () => "",
        };
      }

      if (input.cmd === "sh" && input.args?.[1] === `npm i -g ${installSpec}`) {
        return {
          exitCode: 0,
          stdout: async () => "updated codex",
          stderr: async () => "",
        };
      }

      return {
        cmdId: "cmd_789",
      };
    },
  } as const;

  const result = await runHarness(
    sandbox as never,
    "codex",
    "ship it",
    "sk-test"
  );

  assert.equal(result.installed, true);
  assert.equal(result.installLogs, "updated codex");
  assert.ok(
    runCommandCalls.some(
      (call) => call.args?.[1] === `npm i -g ${installSpec}`
    ),
    "runHarness should upgrade stale codex installs to the pinned version"
  );
  assert.ok(runCommandCalls.some((call) => call.detached === true));
});

test("runHarness accepts a full auth env payload for gateway-backed execution", async () => {
  const runCommandCalls: Array<{
    cmd: string;
    args?: string[];
    detached?: boolean;
    env?: Record<string, string>;
  }> = [];

  const sandbox = {
    async readFile() {
      return Buffer.from("1");
    },
    async writeFiles() {},
    async runCommand(input: {
      cmd: string;
      args?: string[];
      detached?: boolean;
      env?: Record<string, string>;
    }) {
      runCommandCalls.push(input);
      return {
        cmdId: "cmd_456",
      };
    },
  } as const;

  await runHarness(sandbox as never, "codex", "hello world", {
    OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    OPENAI_API_KEY: "gateway-key",
    CODEX_API_KEY: "gateway-key",
  });

  const detachedCall = runCommandCalls.find((call) => call.detached);
  assert.ok(detachedCall);
  assert.deepEqual(detachedCall.env, {
    OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    OPENAI_API_KEY: "gateway-key",
    CODEX_API_KEY: "gateway-key",
  });
});
