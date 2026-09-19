import { beforeEach, describe, expect, it, vi } from "vitest";
import type { classify as runClassify } from "@/lib/decisions/classify";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import { createFlowNodeClassifier } from "./automation-job-classify";

const classify = vi.fn<typeof runClassify>();
const classifyFlowNode = createFlowNodeClassifier(classify);

function context(metadata: Record<string, unknown>): JobContext {
  return {
    metadata,
    assignmentType: "issue_triage",
    skillId: null,
    agent: { model: "model", system_prompt: null },
    repo: { id: "repo-1", user_id: "user-1", full_name: "acme/widgets" },
  };
}

const request = {
  jobRunId: "job-1",
  nodeId: "classify-1",
  nodeLabel: "Triage",
  question: "Is this a bug report?",
  output: { kind: "boolean" as const },
  state: "Login crashes",
  minConfidence: 0.7,
  flowId: "flow-1",
  flowVersionId: "version-1",
};

describe("classifyFlowNode", () => {
  beforeEach(() => {
    classify.mockReset();
    classify.mockResolvedValue({
      ok: false,
      message: "Classification failed.",
    });
  });

  it("should bind the run's owner, repo, and flow identifiers onto the request", async () => {
    const outcome = await classifyFlowNode({
      ...request,
      context: context({ product_team_id: " team-1 ", team_id: "team-2" }),
    });

    expect(outcome).toEqual({ ok: false, message: "Classification failed." });
    expect(classify).toHaveBeenCalledWith({
      question: "Is this a bug report?",
      output: { kind: "boolean" },
      state: "Login crashes",
      minConfidence: 0.7,
      scope: {
        surface: "automation",
        userId: "user-1",
        teamId: "team-1",
        repoId: "repo-1",
      },
      metadata: {
        flow_id: "flow-1",
        flow_version_id: "version-1",
        job_run_id: "job-1",
        flow_node_id: "classify-1",
        flow_node_label: "Triage",
      },
    });
  });

  it("should fall back to team_id, and to no team for a personal run", async () => {
    await classifyFlowNode({
      ...request,
      context: context({ product_team_id: "  ", team_id: "team-2" }),
    });
    await classifyFlowNode({ ...request, context: context({ team_id: 7 }) });

    expect(classify.mock.calls[0]?.[0].scope.teamId).toBe("team-2");
    expect(classify.mock.calls[1]?.[0].scope.teamId).toBeNull();
  });

  it("should use the repo's team when a scheduled run's metadata names none", async () => {
    const scheduled = context({});
    scheduled.repo.product_team_id = "team-3";

    await classifyFlowNode({ ...request, context: scheduled });

    expect(classify.mock.calls[0]?.[0].scope.teamId).toBe("team-3");
  });
});
