import assert from "node:assert/strict";
import { test } from "vitest";
import { asSchema } from "ai";
import { buildScheduledTaskTools } from "./scheduled-task";
import type { SandboxFileAccess } from "./pr-fixer-utils";

test("scheduled command tool requires a command and declares its write boundaries", async () => {
  const tools = buildScheduledTaskTools({
    githubToken: "test-token",
    loadSandbox: async () => {
      throw new Error("Schema discovery must not launch a workspace");
    },
  });
  assert.equal(typeof tools.runCommand.description, "string");
  assert.match(
    String(tools.runCommand.description),
    /Never merge.*default branch/
  );
  const schema = asSchema(tools.runCommand.inputSchema);
  assert.equal(
    (await schema.validate!({ command: "gh pr list" })).success,
    true
  );
  for (const input of [{}, { command: "" }, { command: 123 }]) {
    assert.equal((await schema.validate!(input)).success, false);
  }
});

test("scheduled tasks return command output and nonzero check results from their checkout", async () => {
  const commands: unknown[] = [];
  const sandbox = {
    runCommand: async (input: unknown) => {
      commands.push(input);
      return {
        exitCode: 1,
        stdout: async () => "2 passing",
        stderr: async () => "1 failing",
      };
    },
  } as unknown as SandboxFileAccess;
  const tools = buildScheduledTaskTools({
    githubToken: "test-token",
    loadSandbox: async () => ({ sandbox, cwd: "/repo/app" }),
  });
  const output = await tools.runCommand.execute!(
    { command: "pnpm test" },
    { context: {}, toolCallId: "test", messages: [] }
  );
  assert.deepEqual(output, {
    exitCode: 1,
    stdout: "2 passing",
    stderr: "1 failing",
  });
  assert.deepEqual(commands, [
    {
      cmd: "sh",
      args: ["-lc", 'export PATH="$HOME/.local/bin:$PATH"\npnpm test'],
      cwd: "/repo/app",
      env: { GH_TOKEN: "test-token", GITHUB_TOKEN: "test-token" },
    },
  ]);
});

test("scheduled tasks surface unavailable workspaces instead of reporting success", async () => {
  const tools = buildScheduledTaskTools({
    githubToken: "test-token",
    loadSandbox: async () => {
      throw new Error("Workspace launch failed");
    },
  });
  await assert.rejects(
    async () =>
      tools.runCommand.execute!(
        { command: "gh pr list" },
        { context: {}, toolCallId: "test", messages: [] }
      ),
    /Workspace launch failed/
  );
});
