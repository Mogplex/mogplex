import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduledTaskTools } from "../../lib/agents/scheduled-task";
import type { SandboxFileAccess } from "../../lib/agents/pr-fixer-utils";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
} from "./helpers/automation-job-fixtures";

test("native scheduled tasks receive the requested instructions and command tool, not generic refactor tools", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const run = createAutomationAgentRunner({
    generateText: async (input) => {
      assert.deepEqual(Object.keys(input.tools ?? {}), ["runCommand"]);
      assert.match(
        JSON.stringify(input.system),
        /Check registered model successors/
      );
      assert.match(String(input.prompt), /prepared task branch/);
      assert.match(String(input.prompt), /Never push to the default branch/);
      return {
        text: "NO_ACTION",
        steps: [makeStep({ text: "NO_ACTION" })],
        totalUsage: {},
      } as never;
    },
  });
  const outcome = await run(
    {
      assignmentType: "schedule",
      skillId: null,
      metadata: { flow_node_role: "task" },
      agent: {
        model: "openai/gpt-5.4",
        system_prompt: "Check registered model successors",
      },
      repo: {
        id: "repo",
        user_id: "owner",
        full_name: "acme/widgets",
        default_branch: "main",
        github_installation_id: 123,
      },
    },
    "test-token"
  );
  assert.equal(outcome.text, "NO_ACTION");
});

test("native scheduled tasks return command output and nonzero check results from their checkout", async () => {
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
    { toolCallId: "test", messages: [] }
  );
  assert.deepEqual(output, {
    exitCode: 1,
    stdout: "2 passing",
    stderr: "1 failing",
  });
  assert.deepEqual(commands, [
    {
      cmd: "sh",
      args: ["-lc", "pnpm test"],
      cwd: "/repo/app",
      env: { GH_TOKEN: "test-token", GITHUB_TOKEN: "test-token" },
    },
  ]);
});

test("native scheduled tasks surface unavailable workspaces instead of reporting success", async () => {
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
        { toolCallId: "test", messages: [] }
      ),
    /Workspace launch failed/
  );
});
