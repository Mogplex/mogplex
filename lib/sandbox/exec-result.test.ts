import assert from "node:assert/strict";
import { test } from "vitest";
import type { Sandbox } from "@vercel/sandbox";
import { executeSandboxCommand } from "./exec-result";

function fixture() {
  let saved = false;
  let killed = false;
  const command = {
    cmdId: "cmd-one",
    exitCode: null,
    wait: async () => {
      if (!killed) assert.equal(saved, true);
      return { exitCode: 137 };
    },
    kill: async () => {
      killed = true;
    },
    stdout: async () => "partial output",
    stderr: async () => "Killed",
  };
  return {
    sandbox: { runCommand: async () => command } as unknown as Sandbox,
    onStarted: async () => {
      saved = true;
    },
    killed: () => killed,
  };
}

test("command identity is saved before waiting and detached exit status is retained", async () => {
  const f = fixture();
  const result = await executeSandboxCommand(f.sandbox, {
    command: "pnpm build",
    cwd: "/repo",
    env: {},
    onStarted: f.onStarted,
  });
  assert.equal(result.exitCode, 137);
  assert.equal(result.stdout, "partial output");
});

test("a command is killed when durable ownership cannot be saved or cancellation races the save", async () => {
  const f = fixture();
  await assert.rejects(
    executeSandboxCommand(f.sandbox, {
      command: "build",
      cwd: "/repo",
      env: {},
      onStarted: async () => {
        throw new Error("Save failed");
      },
    }),
    /Save failed/
  );
  assert.equal(f.killed(), true);
  const cancelled = fixture();
  const controller = new AbortController();
  await assert.rejects(
    executeSandboxCommand(cancelled.sandbox, {
      command: "build",
      cwd: "/repo",
      env: {},
      onStarted: async () => {
        await cancelled.onStarted();
        controller.abort();
      },
      signal: controller.signal,
    }),
    /abort/i
  );
  assert.equal(cancelled.killed(), true);
});
