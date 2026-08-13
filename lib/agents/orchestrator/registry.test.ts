import { describe, expect, it } from "vitest";
import {
  ORCHESTRATOR_TOOLS,
  buildOrchestratorTools,
  type OrchestratorToolContext,
} from "./registry";
import { isStubTool } from "./helpers";

/**
 * A context with every optional field populated: no tool may degrade to a
 * stub for lack of context here. Tool factories only capture context at
 * build time — nothing executes against these fake values.
 */
const FULL_CONTEXT: OrchestratorToolContext = {
  userId: "user-1",
  sandboxId: "sandbox-1",
  repoId: "repo-1",
  repoOwner: "mogplex",
  repoName: "mogplex",
  repoBranch: "feat/anything",
  repoBaseBranch: "main",
  githubToken: "ghs_test-token",
  teamId: "team-1",
  missionId: "mission-1",
  orchestrationRunId: "11111111-2222-4333-8444-555555555555",
  conversationId: "conversation-1",
  workspaceSessionId: "ws-session-1",
  aiCallId: "ai-call-1",
};

describe("buildOrchestratorTools", () => {
  const tools = buildOrchestratorTools(FULL_CONTEXT);

  it("should build one tool per registry definition", () => {
    expect(Object.keys(tools).sort()).toEqual(
      ORCHESTRATOR_TOOLS.map((def) => def.name).sort()
    );
  });

  it("should provide a real implementation for every def flagged implemented (drift guard)", () => {
    const drifted = ORCHESTRATOR_TOOLS.filter(
      (def) => def.implemented && isStubTool(tools[def.name])
    ).map((def) => def.name);
    expect(drifted).toEqual([]);
  });

  it("should keep every def flagged unimplemented as a stub (reverse drift guard)", () => {
    const undeclared = ORCHESTRATOR_TOOLS.filter(
      (def) => !def.implemented && !isStubTool(tools[def.name])
    ).map((def) => def.name);
    expect(undeclared).toEqual([]);
  });

  it("should wire memory_write and memory_search to the memory tool implementations", () => {
    expect(isStubTool(tools.memory_write)).toBe(false);
    expect(isStubTool(tools.memory_search)).toBe(false);
    // The real memory tools carry the memories-surface descriptions, not the
    // registry def descriptions the stubs would echo back.
    expect(tools.memory_write.description).toContain("durable memory");
    expect(tools.memory_search.description).toContain("saved memories");
  });

  it("should describe sandbox_stop as non-deleting", () => {
    expect(tools.sandbox_stop.description).toContain(
      "does not delete the sandbox record"
    );
  });

  it("should degrade github-dependent tools to stubs when the token is missing", () => {
    const withoutToken = buildOrchestratorTools({
      ...FULL_CONTEXT,
      githubToken: null,
    });
    expect(isStubTool(withoutToken.search_repo)).toBe(true);
    expect(isStubTool(withoutToken.open_pr)).toBe(true);
  });
});
