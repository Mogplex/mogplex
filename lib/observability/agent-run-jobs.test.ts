import { describe, expect, it } from "vitest";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { createEmptyUserAutomationScope } from "@/lib/user-automation-scope";
import {
  AGENT_RUN_AI_CALL_BATCH_SIZE,
  buildAgentRunObservabilityJob,
  loadUserAgentRunJobs,
  mapAgentRunStatus,
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

describe("buildAgentRunObservabilityJob", () => {
  it("should present a failed run with its repo, harness, error and call summary", () => {
    const job = buildAgentRunObservabilityJob(makeScope(), makeRun(), call);

    expect(job.id).toBe("run-1");
    expect(job.source_kind).toBe("agent_run");
    expect(job.source_type).toBe("api");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("Trigger.dev runtime is not configured");
    expect(job.repo).toEqual({ id: "repo-1", full_name: "Mogplex/mogplex" });
    expect(job.agent.name).toBe("claude-code");
    expect(job.runtime_provider).toBe("trigger");
    expect(job.runtime_run_id).toBe("run_trigger_1");
    expect(job.started_at).toBe(call.started_at);
    expect(job.completed_at).toBe(call.completed_at);
    expect(job.input_tokens).toBe(120);
    expect(job.output_tokens).toBe(30);
    expect(job.cost_usd).toBe(0.02);
    expect(job.duration_ms).toBe(4200);
    expect(job.latest_ai_call).toEqual({
      id: "call-1",
      status: "failed",
      model: "anthropic/claude-sonnet-5",
      total_tokens: 150,
      tool_calls_count: 3,
      started_at: call.started_at,
    });
    expect(job.repairable).toBe(false);
    expect(job.requeueable).toBe(false);
    expect(job.cancelable).toBe(false);
    expect(job.metadata).toMatchObject({
      repo_id: "repo-1",
      repo_full_name: "Mogplex/mogplex",
      harness: "claude-code",
      ai_call_id: "call-1",
      working_branch: "mogplex/agent-1",
      prompt: "Fix the mobile layout",
    });
  });

  it("should label runs started from Slack and keep the repo id when the repo is unknown", () => {
    const job = buildAgentRunObservabilityJob(
      createEmptyUserAutomationScope(),
      makeRun({
        repo_id: "repo-missing",
        status: "streaming",
        metadata: { source: "external-api", slack: { teamId: "T1" } },
      }),
      null
    );

    expect(job.source_type).toBe("slack");
    expect(job.status).toBe("running");
    expect(job.repo).toEqual({ id: "repo-missing", full_name: null });
    expect(job.latest_ai_call).toBeNull();
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
  });

  it("should fall back to the run update time as completion when the call has none", () => {
    const job = buildAgentRunObservabilityJob(
      makeScope(),
      makeRun({ status: "success" }),
      { ...call, status: "success", completed_at: null }
    );

    expect(job.completed_at).toBe("2026-09-03T21:57:28.000Z");
  });
});

describe("loadUserAgentRunJobs", () => {
  it("should join each run with its call and skip the call lookup when there are no runs", async () => {
    const seen: string[][] = [];
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
        loadAiCalls: async (ids) => {
          seen.push(ids);
          return [call];
        },
      }
    );

    expect(seen).toEqual([["call-1", "call-2"]]);
    expect(jobs.map((job) => [job.id, job.latest_ai_call?.id ?? null])).toEqual(
      [
        ["run-1", "call-1"],
        ["run-2", null],
      ]
    );

    const empty = await loadUserAgentRunJobs(
      { userId: "user-1", scope: makeScope(), filters: {} },
      {
        loadRows: async () => [],
        loadAiCalls: async () => {
          throw new Error("should not be called");
        },
      }
    );
    expect(empty).toEqual([]);
  });

  it("should look up backing calls in bounded batches", async () => {
    const runCount = AGENT_RUN_AI_CALL_BATCH_SIZE * 2 + 1;
    const rows = Array.from({ length: runCount }, (_, index) =>
      makeRun({ id: `run-${index}`, ai_call_id: `call-${index}` })
    );
    const batches: string[][] = [];

    const jobs = await loadUserAgentRunJobs(
      { userId: "user-1", scope: makeScope(), filters: {} },
      {
        loadRows: async () => rows,
        loadAiCalls: async (ids) => {
          batches.push(ids);
          return ids.map((id) => ({ ...call, id }));
        },
      }
    );

    expect(batches.map((batch) => batch.length)).toEqual([
      AGENT_RUN_AI_CALL_BATCH_SIZE,
      AGENT_RUN_AI_CALL_BATCH_SIZE,
      1,
    ]);
    expect(jobs).toHaveLength(runCount);
    expect(
      jobs.every((job) => job.latest_ai_call?.id === `call-${job.id.slice(4)}`)
    ).toBe(true);
  });
});

describe("shouldLoadAgentRunJobs", () => {
  it("should skip the agent-run lookup when another source kind is selected", () => {
    expect(shouldLoadAgentRunJobs(undefined)).toBe(true);
    expect(shouldLoadAgentRunJobs("agent_run")).toBe(true);
    expect(shouldLoadAgentRunJobs("flow")).toBe(false);
  });
});
