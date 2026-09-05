import { describe, expect, it } from "vitest";
import type { ObservabilityJob, AiCallEvent } from "@/lib/types";
import {
  presentWork,
  recordedAgentReport,
  workDuration,
} from "./work-presentation";

export function jobFixture(
  overrides: Partial<ObservabilityJob> = {}
): ObservabilityJob {
  return {
    id: "job-1",
    assignment_id: null,
    trigger_id: null,
    status: "success",
    created_at: "2026-09-05T10:00:00Z",
    started_at: "2026-09-05T10:00:00Z",
    completed_at: "2026-09-05T10:01:10Z",
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: 0.352,
    duration_ms: 70000,
    error: null,
    start_attempts: 1,
    metadata: { pr_number: 1477, pr_title: "Fix mobile canvas header overlap" },
    source_kind: "flow",
    source_type: "pr_opened",
    repo: { id: "repo-1", full_name: "acme/widgets" },
    agent: { id: "agent-1", name: "PR Review Agent", slug: "review" },
    latest_ai_call: null,
    latest_dispatch_event: null,
    repairable: false,
    requeueable: false,
    cancelable: false,
    ...overrides,
  };
}

describe("work presentation", () => {
  it("uses only the latest recorded final report, never tool output or unfinished text", () => {
    const event = (id: string, kind: string, message: string): AiCallEvent => ({
      id,
      ai_call_id: "call",
      user_id: "owner",
      conversation_id: null,
      repo_id: null,
      event_type: "log",
      tool_name: null,
      message,
      payload: { kind },
      created_at: `2026-09-05T10:0${id}:00Z`,
    });
    const draft = event("4", "assistant_delta", "Still working");
    expect(recordedAgentReport([{ events: [draft] }])).toBeNull();
    expect(
      recordedAgentReport([
        { events: [event("3", "assistant_final", "Finished"), draft] },
        { events: [event("1", "assistant_final", "Old report")] },
      ])
    ).toBe("Finished");
  });
  it("explains an explicitly recorded no-findings result without implying merge", () => {
    const job = jobFixture({
      latest_dispatch_event: {
        id: "event",
        event_kind: "control",
        outcome: "completed",
        reason: "PR_REVIEW_NO_FINDINGS",
        metadata: null,
        created_at: "2026-09-05",
      },
    });
    expect(presentWork(job, "me").summary).toBe(
      "The review completed with no findings. This does not mean the PR has been merged."
    );
  });
  it("leads with reviewed work without claiming merge or no findings from success alone", () => {
    const result = presentWork(jobFixture(), "me");
    expect(result.title).toBe("Review PR #1477");
    expect(result.label).toBe("Completed");
    expect(result.summary).not.toContain("no findings");
    expect(result.workspaceHref).toBeNull();
    expect(result.github?.href).toBe(
      "https://github.com/acme/widgets/pull/1477"
    );
  });
  it("only links actual agent runs to work and exposes waiting instead of running", () => {
    const result = presentWork(
      jobFixture({
        source_kind: "agent_run",
        status: "running",
        metadata: { run_status: "awaiting_input", prompt: "Fix the header" },
      }),
      "me"
    );
    expect(result.title).toBe("Fix the header");
    expect(result.label).toBe("Needs your input");
    expect(result.workspaceHref).toBe("/me/runs/job-1");
  });
  it("does not invent recovery from a timeout", () => {
    const result = presentWork(
      jobFixture({ status: "failed", error: "Timed out" }),
      "me"
    );
    expect(result.label).toBe("Timed out");
    expect(result.summary).toContain("Check its output");
    expect(result.summary).not.toMatch(/checkpoint|saved/);
  });
  it("uses elapsed time for active work and preserves a measured zero", () => {
    expect(workDuration(jobFixture())).toBe("1m 10s");
    expect(workDuration(jobFixture({ duration_ms: 0 }))).toBe("0s");
    expect(
      workDuration(
        jobFixture({ duration_ms: null, completed_at: null }),
        Date.parse("2026-09-05T10:02:00Z")
      )
    ).toBe("2m 0s");
    expect(
      workDuration(jobFixture({ duration_ms: null, started_at: null }))
    ).toBe("Not started");
  });
});
