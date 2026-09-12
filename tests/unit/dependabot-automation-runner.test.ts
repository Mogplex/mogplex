import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
} from "./helpers/automation-job-fixtures";
import type { buildDependabotTools } from "../../lib/agents/dependabot";

test("the native automation runner supplies alert context and executable guarded tools", async () => {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ number: 17, state: "fixed" });
  try {
    const runner = createAutomationAgentRunner({
      generateText: async (options) => {
        assert.ok(String(options.prompt).includes("GHSA-123"));
        const tools = options.tools as unknown as ReturnType<
          typeof buildDependabotTools
        >;
        const blocked = await tools.runCommand!.execute!(
          { command: "git push" },
          { toolCallId: "command", messages: [] }
        );
        assert.equal("blocked" in blocked && blocked.blocked, true);
        return {
          text: "Alert is already fixed; no changes made.",
          steps: [
            makeStep({
              text: "Alert is already fixed; no changes made.",
              inputTokens: 2,
              outputTokens: 3,
            }),
          ],
          totalUsage: { inputTokens: 2, outputTokens: 3 },
        } as never;
      },
    });
    const result = await runner(
      {
        assignmentType: "dependabot_alert",
        skillId: null,
        metadata: {
          alert_number: 17,
          webhook_action: "created",
          ghsa_id: "GHSA-123",
          flow_node_role: "triage",
        },
        agent: { model: "minimax/minimax-m2.5", system_prompt: null },
        repo: {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      "test-github-token"
    );
    assert.equal(result.text, "Alert is already fixed; no changes made.");
    assert.equal(result.usage?.outputTokens, 3);
  } finally {
    globalThis.fetch = original;
  }
});
