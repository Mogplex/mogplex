import { describe, expect, it } from "vitest";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { sanitizeObservabilityPayload } from "@/lib/observability/user-facing-errors";
import { createEmptyUserAutomationScope } from "@/lib/user-automation-scope";
import {
  AGENT_RUN_AI_CALL_BATCH_SIZE,
  attachAgentRunAiCalls,
  buildAgentRunObservabilityJob,
  loadUserAgentRunJobs,
  mapAgentRunStatus,
  needsAgentRunAiCallsBeforeSort,
  resolveAgentRunStatusFilter,
  shouldLoadAgentRunJobs,
  type AgentRunAiCallSummary,
} from "./agent-run-jobs";

function makeRun(
  overrides: Partial<ExternalAgentRunRow> = {}
): ExternalAgentRunRow {
  return {
    id: "run-1",
    user_id: "user-1",
    repo_id: "repo-1",
    ai_call_id: "call-1",
    sandbox_record_id: null,
    sandbox_id: null,
    worktree_id: null,
    idempotency_key: "idem-1",
    request_hash: "hash-1",
    harness: "claude-code",
    status: "failed",
    prompt: "Fix the mobile layout",
    base_branch: "main",
    working_branch: "mogplex/agent-1",
    create_branch: true,
    root_directory: null,
    conversation_id: null,
    workspace_session_id: null,
    mode: null,
    runtime_provider: "trigger",
    runtime_run_id: "run_trigger_1",
    error: "Trigger.dev runtime is not configured",
    metadata: { source: "external-api" },
    created_at: "2026-09-03T21:57:27.442Z",
    updated_at: "2026-09-03T21:57:28.000Z",
    ...overrides,
  };
}

const call: AgentRunAiCallSummary = {
  id: "call-1",
  status: "failed",
  model: "anthropic/claude-sonnet-5",
  input_tokens: 120,
  output_tokens: 30,
  total_tokens: 150,
  cost_usd: 0.02,
  duration_ms: 4200,
  tool_calls_count: 3,
  started_at: "2026-09-03T21:57:27.500Z",
  completed_at: "2026-09-03T21:57:31.700Z",
};

function makeScope() {
  const scope = createEmptyUserAutomationScope();
  scope.reposById.set("repo-1", {
    id: "repo-1",
    full_name: "Mogplex/mogplex",
  } as never);
  return scope;
}

describe("mapAgentRunStatus", () => {
  it("should map streaming agent runs onto the running job status", () => {
    expect(mapAgentRunStatus("streaming")).toBe("running");
    expect(mapAgentRunStatus("awaiting_input")).toBe("running");
    expect(mapAgentRunStatus("pending")).toBe("pending");
    expect(mapAgentRunStatus("success")).toBe("success");
    expect(mapAgentRunStatus("failed")).toBe("failed");
    expect(mapAgentRunStatus("cancelled")).toBe("cancelled");
  });
});

describe("resolveAgentRunStatusFilter", () => {
  it("should translate the running job filter into the streaming run status", () => {
    expect(resolveAgentRunStatusFilter("running")).toBe("streaming");
    expect(resolveAgentRunStatusFilter("failed")).toBe("failed");
    expect(resolveAgentRunStatusFilter(undefined)).toBeNull();
  });
});

describe("shouldLoadAgentRunJobs", () => {
  it("should skip the agent-run lookup when another source kind is selected", () => {
    expect(shouldLoadAgentRunJobs(undefined)).toBe(true);
    expect(shouldLoadAgentRunJobs("agent_run")).toBe(true);
    expect(shouldLoadAgentRunJobs("flow")).toBe(false);
  });
});

describe("needsAgentRunAiCallsBeforeSort", () => {
  it("should require call usage before sorting by call-derived fields only", () => {
    expect(needsAgentRunAiCallsBeforeSort("duration_ms")).toBe(true);
    expect(needsAgentRunAiCallsBeforeSort("started_at")).toBe(true);
    expect(needsAgentRunAiCallsBeforeSort("completed_at")).toBe(true);
    expect(needsAgentRunAiCallsBeforeSort("created_at")).toBe(false);
    expect(needsAgentRunAiCallsBeforeSort("status")).toBe(false);
  });
});

describe("buildAgentRunObservabilityJob", () => {
  it("should present a run with its repo, harness, error and curated metadata", () => {
    const job = buildAgentRunObservabilityJob(
      makeScope(),
      makeRun({
        metadata: {
          source: "external-api",
          slack: { teamId: "T1", channelId: "C1" },
          slack_team_id: "T1",
          slack_user_id: "U1",
        },
      })
    );

    expect(job.id).toBe("run-1");
    expect(job.source_kind).toBe("agent_run");
    expect(job.source_type).toBe("slack");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("Trigger.dev runtime is not configured");
    expect(job.repo).toEqual({ id: "repo-1", full_name: "Mogplex/mogplex" });
    expect(job.agent.name).toBe("claude-code");
    expect(job.runtime_provider).toBe("trigger");
    expect(job.runtime_run_id).toBe("run_trigger_1");
    expect(job.started_at).toBe("2026-09-03T21:57:27.442Z");
    expect(job.completed_at).toBe("2026-09-03T21:57:28.000Z");
    expect(job.latest_ai_call).toBeNull();
    expect(job.cost_usd).toBeNull();
    expect(job.repairable).toBe(false);
    expect(job.requeueable).toBe(false);
    expect(job.cancelable).toBe(false);
    expect(job.metadata).toEqual({
      source: "external-api",
      origin: "slack",
      repo_id: "repo-1",
      repo_full_name: "Mogplex/mogplex",
      harness: "claude-code",
      ai_call_id: "call-1",
      base_branch: "main",
      working_branch: "mogplex/agent-1",
      sandbox_id: null,
      worktree_id: null,
      conversation_id: null,
      slack_team_id: "T1",
      slack_user_id: "U1",
      prompt: "Fix the mobile layout",
    });
  });

  it("should label API runs, keep an unknown repo id, and leave pending runs unstarted", () => {
    const job = buildAgentRunObservabilityJob(
      createEmptyUserAutomationScope(),
      makeRun({ repo_id: "repo-missing", status: "pending", error: null })
    );

    expect(job.source_type).toBe("api");
    expect(job.status).toBe("pending");
    expect(job.repo).toEqual({ id: "repo-missing", full_name: null });
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
    expect(job.metadata?.slack_team_id).toBeUndefined();
  });

  it("should read the run origin from metadata when present", () => {
    const job = buildAgentRunObservabilityJob(
      makeScope(),
      makeRun({ metadata: { source: "external-api", run_origin: "mcp" } })
    );

    expect(job.source_type).toBe("mcp");
    expect(job.metadata?.origin).toBe("mcp");
  });

  it("should keep the run details readable after failure sanitization", () => {
    const job = buildAgentRunObservabilityJob(makeScope(), makeRun());
    const sanitized = sanitizeObservabilityPayload(job, "JOB", job.id);

    expect(sanitized.metadata).toMatchObject({
      harness: "claude-code",
      prompt: "Fix the mobile layout",
      base_branch: "main",
      working_branch: "mogplex/agent-1",
      repo_full_name: "Mogplex/mogplex",
      ai_call_id: "call-1",
    });
    expect(sanitized.error).not.toContain("Trigger.dev");
  });
});

describe("loadUserAgentRunJobs", () => {
  it("should translate the status filter and build one job per run", async () => {
    const jobs = await loadUserAgentRunJobs(
      { userId: "user-1", scope: makeScope(), filters: { status: "running" } },
      {
        loadRows: async (input) => {
          expect(input).toEqual({
            userId: "user-1",
            status: "streaming",
            from: undefined,
            to: undefined,
          });
          return [
            makeRun({ status: "streaming" }),
            makeRun({ id: "run-2", ai_call_id: "call-2" }),
          ];
        },
      }
    );

    expect(jobs.map((job) => [job.id, job.status])).toEqual([
      ["run-1", "running"],
      ["run-2", "failed"],
    ]);
  });
});

describe("attachAgentRunAiCalls", () => {
  it("should overlay call usage on agent-run jobs only and leave others untouched", async () => {
    const agentJob = buildAgentRunObservabilityJob(makeScope(), makeRun());
    const otherJob = {
      ...buildAgentRunObservabilityJob(makeScope(), makeRun({ id: "job-9" })),
      source_kind: "flow" as const,
      metadata: { ai_call_id: "call-9" },
    };
    const seen: string[][] = [];

    await attachAgentRunAiCalls([agentJob, otherJob], {
      loadAiCalls: async (ids) => {
        seen.push(ids);
        return [call];
      },
    });

    expect(seen).toEqual([["call-1"]]);
    expect(agentJob.latest_ai_call).toEqual({
      id: "call-1",
      status: "failed",
      model: "anthropic/claude-sonnet-5",
      total_tokens: 150,
      tool_calls_count: 3,
      started_at: call.started_at,
    });
    expect(agentJob.started_at).toBe(call.started_at);
    expect(agentJob.completed_at).toBe(call.completed_at);
    expect(agentJob.input_tokens).toBe(120);
    expect(agentJob.output_tokens).toBe(30);
    expect(agentJob.cost_usd).toBe(0.02);
    expect(agentJob.duration_ms).toBe(4200);
    expect(otherJob.latest_ai_call).toBeNull();
  });

  it("should skip the lookup with no agent runs and fetch large sets in bounded batches", async () => {
    await attachAgentRunAiCalls([], {
      loadAiCalls: async () => {
        throw new Error("should not be called");
      },
    });

    const runCount = AGENT_RUN_AI_CALL_BATCH_SIZE * 2 + 1;
    const jobs = Array.from({ length: runCount }, (_, index) =>
      buildAgentRunObservabilityJob(
        makeScope(),
        makeRun({ id: `run-${index}`, ai_call_id: `call-${index}` })
      )
    );
    const batches: string[][] = [];

    await attachAgentRunAiCalls(jobs, {
      loadAiCalls: async (ids) => {
        batches.push(ids);
        return ids.map((id) => ({ ...call, id }));
      },
    });

    expect(batches.map((batch) => batch.length)).toEqual([
      AGENT_RUN_AI_CALL_BATCH_SIZE,
      AGENT_RUN_AI_CALL_BATCH_SIZE,
      1,
    ]);
    expect(
      jobs.every((job) => job.latest_ai_call?.id === `call-${job.id.slice(4)}`)
    ).toBe(true);
  });
});
