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
  it.each([
    [
      "pending",
      "Pending",
      "The run is waiting to start. No completed result is available yet.",
    ],
    [
      "running",
      "Running",
      "Execution is in progress. The latest recorded activity appears below.",
    ],
    [
      "cancelled",
      "Cancelled",
      "Execution was cancelled. Any recorded output remains available below.",
    ],
    [
      "failed",
      "Failed",
      "The run stopped before completing. Review the latest event and available recovery actions.",
    ],
    [
      "success",
      "Completed",
      "Execution completed. Review the output to confirm the intended result.",
    ],
  ] as const)(
    "explains %s without inventing an outcome",
    (status, label, summary) => {
      expect(presentWork(jobFixture({ status }), "me")).toMatchObject({
        label,
        summary,
        waiting: false,
        callHref: null,
      });
    }
  );
  it("uses a recorded failure and exposes awaiting input only while still active", () => {
    expect(
      presentWork(
        jobFixture({ status: "failed", error: "Could not complete this run." }),
        "me"
      ).summary
    ).toBe("Could not complete this run.");
    expect(
      presentWork(
        jobFixture({
          status: "running",
          metadata: { run_status: "awaiting_input" },
        }),
        "me"
      )
    ).toMatchObject({
      waiting: true,
      label: "Needs your input",
      summary:
        "The agent is waiting for your input. Open the work to review its request.",
    });
    expect(
      presentWork(
        jobFixture({
          status: "success",
          metadata: { run_status: "awaiting_input" },
        }),
        "me"
      ).waiting
    ).toBe(false);
  });
  it("falls back through task identity and trims recorded branch names", () => {
    const base = jobFixture({ source_kind: "agent_run", metadata: {} });
    expect(
      presentWork(
        {
          ...base,
          metadata: {
            prompt: "  Fix controls  ",
            pr_title: "PR title",
            working_branch: " fix/mobile ",
            head_ref: "old",
          },
        },
        "me"
      )
    ).toMatchObject({
      title: "Fix controls",
      subtitle: "PR title",
      branch: "fix/mobile",
    });
    expect(
      presentWork(
        { ...base, metadata: { prompt: " ", pr_title: "PR title" } },
        "me"
      ).title
    ).toBe("PR title");
    expect(
      presentWork(
        {
          ...base,
          metadata: { issue_title: "Issue title", head_ref: " fix/issue " },
        },
        "me"
      )
    ).toMatchObject({
      title: "Issue title",
      subtitle: null,
      branch: "fix/issue",
    });
    expect(presentWork(base, "me").title).toBe("PR Review Agent");
    expect(
      presentWork(
        { ...base, agent: { id: null, name: null, slug: null } },
        "me"
      ).title
    ).toBe("Agent work");
  });
  it("links actual call usage and encodes scope and run identities", () => {
    const job = jobFixture({
      id: "run/one",
      source_kind: "agent_run",
      latest_ai_call: {
        id: "call/one",
        model: "test-model",
        status: "success",
        total_tokens: 12,
        tool_calls_count: 1,
        started_at: "2026-09-05",
      },
    });
    expect(presentWork(job, "team one")).toMatchObject({
      workspaceHref: "/team%20one/runs/run%2Fone",
      callHref: "/team%20one/observability?view=usage&call_id=call%2Fone",
    });
  });
  it("uses completed timestamps, clamps negative duration and rejects invalid dates", () => {
    expect(workDuration(jobFixture({ duration_ms: null }))).toBe("1m 10s");
    expect(workDuration(jobFixture({ duration_ms: -1000 }))).toBe("0s");
    expect(workDuration(jobFixture({ duration_ms: 1999 }))).toBe("1s");
    expect(
      workDuration(jobFixture({ duration_ms: null, started_at: "invalid" }))
    ).toBe("Not started");
  });
});
