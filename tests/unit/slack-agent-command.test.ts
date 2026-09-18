import assert from "node:assert/strict";
import test from "node:test";
import {
  findAgentSelection,
  slackAgentCommandText,
  type SlackAgentCommandDeps,
} from "../../lib/slack/agent-command";
import type { AgentRuntimeRow } from "../../lib/agents/runtime/types";

const scope = {
  installationId: "installation-1",
  channelId: "C1",
  slackUserId: "U1",
};

const rows: AgentRuntimeRow[] = [
  {
    id: "agent-1",
    user_id: "user-1",
    team_id: null,
    name: "NEXTJS-REVIEWER",
    slug: "nextjs-reviewer",
    model: null,
    system_prompt: null,
  },
  {
    id: "agent-2",
    user_id: "user-2",
    team_id: "team-1",
    name: "Security Sweep",
    slug: null,
    model: null,
    system_prompt: null,
  },
];

function deps(
  saved: string | null,
  onSave: (agentId: string | null) => void = () => {}
): SlackAgentCommandDeps {
  return {
    getAgentPreference: async () => saved,
    saveAgentPreference: async (input) => {
      onSave(input.agentId);
    },
    listAgentsForUser: async () => rows,
  };
}

test("agent command without an argument reports the current selection", async () => {
  assert.match(
    await slackAgentCommandText(deps(null), scope, "user-1", ""),
    /Current agent: none \(harness default\)/
  );
  assert.match(
    await slackAgentCommandText(deps("agent-2"), scope, "user-1", ""),
    /Current agent: Security Sweep\./
  );
  assert.match(
    await slackAgentCommandText(
      deps("preset:PR-REVIEWER"),
      scope,
      "user-1",
      ""
    ),
    /Current agent: PR-REVIEWER\./
  );
});

test("agent command selects by slug, by name, and by preset name", async () => {
  const saved: Array<string | null> = [];
  const record = (agentId: string | null) => saved.push(agentId);
  assert.match(
    await slackAgentCommandText(
      deps(null, record),
      scope,
      "user-1",
      "nextjs-reviewer"
    ),
    /Agent set to NEXTJS-REVIEWER/
  );
  assert.match(
    await slackAgentCommandText(
      deps(null, record),
      scope,
      "user-1",
      "security sweep"
    ),
    /Agent set to Security Sweep/
  );
  assert.match(
    await slackAgentCommandText(
      deps(null, record),
      scope,
      "user-1",
      "pr-reviewer"
    ),
    /Agent set to PR-REVIEWER/
  );
  assert.deepEqual(saved, ["agent-1", "agent-2", "preset:PR-REVIEWER"]);
});

test("agent command clears the selection and rejects unknown names without saving", async () => {
  const saved: Array<string | null> = [];
  const record = (agentId: string | null) => saved.push(agentId);
  assert.match(
    await slackAgentCommandText(
      deps("agent-1", record),
      scope,
      "user-1",
      "none"
    ),
    /Agent cleared/
  );
  const unknown = await slackAgentCommandText(
    deps("agent-1", record),
    scope,
    "user-1",
    "does-not-exist"
  );
  assert.match(unknown, /No agent matches "does-not-exist"/);
  assert.match(unknown, /Your agents: nextjs-reviewer, Security Sweep\./);
  assert.deepEqual(saved, [null]);
});

test("findAgentSelection prefers roster rows over presets with the same name", () => {
  const selection = findAgentSelection(
    [{ ...rows[0], name: "PR-REVIEWER", slug: "pr-reviewer" }],
    "PR-REVIEWER"
  );
  assert.deepEqual(selection, { id: "agent-1", name: "PR-REVIEWER" });
});
