import { describe, expect, it } from "vitest";
import { createControlWorkerHandoff } from "@/lib/control/worker-handoff";
import {
  ORCHESTRATOR_TOOLS,
  buildOrchestratorTools,
  getImplementationStats,
  type OrchestratorToolContext,
} from "./registry";

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
  workerHandoffTool: createControlWorkerHandoff({
    userId: "user-1",
    sessionId: "mission-1",
    parentAiCallId: "ai-call-1",
    messages: [],
    context: { repoId: "repo-1", missionId: "mission-1", model: "fixture" },
  }).tool,
};

describe("buildOrchestratorTools", () => {
  const tools = buildOrchestratorTools(FULL_CONTEXT);

  it("exposes only implemented tools to the model", () => {
    expect(Object.keys(tools).sort()).toEqual(
      ORCHESTRATOR_TOOLS.filter((def) => def.implemented)
        .map((def) => def.name)
        .sort()
    );
    expect(tools.sandbox_provision).toBeUndefined();
    expect(tools.sandbox_pause).toBeUndefined();
    expect(tools.steer_agent).toBeUndefined();
  });

  it("should provide a real implementation for every def flagged implemented (drift guard)", () => {
    const drifted = ORCHESTRATOR_TOOLS.filter(
      (def) => def.implemented && !tools[def.name]
    ).map((def) => def.name);
    expect(drifted).toEqual([]);
  });

  it("keeps planned capabilities in diagnostic inventory metadata", () => {
    const stats = getImplementationStats();
    expect(stats.planned).toBeGreaterThan(0);
    expect(stats.total).toBe(stats.implemented + stats.planned);
    expect(
      ORCHESTRATOR_TOOLS.find((def) => def.name === "sandbox_provision")
        ?.implemented
    ).toBe(false);
  });

  it("should wire memory_write and memory_search to the memory tool implementations", () => {
    expect(tools.memory_write).toBeDefined();
    expect(tools.memory_search).toBeDefined();
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

  it("omits context-unavailable tools while retaining dynamically bound sandbox tools", () => {
    const withoutToken = buildOrchestratorTools({
      ...FULL_CONTEXT,
      githubToken: null,
    });
    expect(withoutToken.search_repo).toBeUndefined();
    expect(withoutToken.open_pr).toBeUndefined();
    expect(Object.keys(withoutToken)).not.toContain("sandbox_provision");

    const withoutSandbox = buildOrchestratorTools({
      ...FULL_CONTEXT,
      sandboxId: null,
    });
    expect(withoutSandbox.write_file).toBeDefined();
    expect(withoutSandbox.sandbox_stop).toBeDefined();

    const withoutRepository = buildOrchestratorTools({
      ...FULL_CONTEXT,
      repoId: null,
    });
    expect(withoutRepository.sandbox_start).toBeUndefined();
    expect(
      buildOrchestratorTools({ ...FULL_CONTEXT, workerHandoffTool: undefined })
        .await_workers
    ).toBeUndefined();
  });

  it("omits sandbox execution tools while server-owned selection is ambiguous", () => {
    const ambiguousSandbox = buildOrchestratorTools({
      ...FULL_CONTEXT,
      sandboxSelectionRequired: true,
    });

    expect(ambiguousSandbox.run_command).toBeUndefined();
    expect(ambiguousSandbox.sandbox_start).toBeUndefined();
    expect(ambiguousSandbox.sandbox_stop).toBeUndefined();
    expect(ambiguousSandbox.write_file).toBeUndefined();
    expect(ambiguousSandbox.spawn_worktree).toBeUndefined();
  });

  it("describes the sandbox and worktree decision contract consistently", () => {
    expect(tools.plan_mission.description).toMatch(
      /call once.*tasks must be a JSON array/i
    );
    expect(tools.sandbox_start.description).toMatch(/runtime|preview/i);
    expect(tools.sandbox_start.description).toMatch(
      /explicit request.*authorizes calling this tool immediately/i
    );
    expect(tools.sandbox_start.description).toMatch(
      /unavailable tool.*do not ask for reconfirmation/i
    );
    expect(tools.sandbox_start.description).toMatch(
      /does not create.*worktree/i
    );
    expect(tools.run_command.description).toMatch(/selected sandbox/i);
    expect(tools.run_command.description).toMatch(/does not create.*worktree/i);
    expect(tools.spawn_worktree.description).toMatch(/planned task/i);
    expect(tools.spawn_worktree.description).toMatch(
      /does not start.*sandbox/i
    );
    expect(tools.spawn_subagent.description).toMatch(
      /exact.*sandbox.*checkout/i
    );
    expect(tools.archive_worktree.description).toMatch(
      /without stopping|does not stop/i
    );
    expect(tools.prune_worktree.description).toMatch(
      /does not stop or delete/i
    );
  });

  it("keeps the selected sandbox server-owned when spawning a worktree", () => {
    const schema = tools.spawn_worktree.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(schema.shape)).toEqual(["taskId"]);
  });

  it("keeps the sandbox start repository server-owned", () => {
    const schema = tools.sandbox_start.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(schema.shape)).toEqual([]);
    expect(tools.sandbox_start.description).toMatch(
      /server-selected active repository/i
    );
  });

  it("keeps the selected sandbox server-owned when writing a file", () => {
    const schema = tools.write_file.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(schema.shape)).toEqual(["path", "content"]);
    expect(tools.write_file.description).toMatch(/server-selected sandbox/i);
  });

  it("uses a server-scoped GitHub issue mutation instead of a sandbox shell", () => {
    expect(tools.github_create_issue).toBeDefined();
    expect(tools.github_create_issue.description).toMatch(
      /current workspace repository/i
    );
    const schema = tools.github_create_issue.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(schema.shape).sort()).toEqual([
      "body",
      "labels",
      "title",
    ]);

    const withoutRepository = buildOrchestratorTools({
      ...FULL_CONTEXT,
      repoId: null,
    });
    expect(withoutRepository.github_create_issue).toBeUndefined();

    const whileSandboxIsPending = buildOrchestratorTools({
      ...FULL_CONTEXT,
      sandboxId: null,
      sandboxBinding: { sandboxId: null, status: "pending" },
    });
    expect(whileSandboxIsPending.github_create_issue).toBeDefined();
  });
});
