import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
} from "./helpers/automation-job-fixtures";

test("native scheduled tasks receive the requested instructions and command tool, not generic refactor tools", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const run = createAutomationAgentRunner({
    generateText: async (input) => {
      assert.deepEqual(Object.keys(input.tools ?? {}), [
        "runCommand",
        "web_search",
        "web_fetch",
      ]);
      assert.match(
        JSON.stringify(input.instructions),
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
