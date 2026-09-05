import type { ObservabilityJob, AiCallEvent } from "@/lib/types";
import { resolveGithubObservabilityLink } from "./github-links";
import { getAutomationStatusPresentation } from "./automation-run-presentation";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Only a recorded final assistant event is presented as an agent report. */
export function recordedAgentReport(calls: { events: AiCallEvent[] }[]) {
  return (
    calls
      .flatMap((call) => call.events)
      .filter(
        (event) =>
          event.payload.kind === "assistant_final" && text(event.message)
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .at(-1)?.message ?? null
  );
}

/** Outcome and artifact identity are separate from successful execution. */
export function presentWork(job: ObservabilityJob, scope: string) {
  const metadata = job.metadata;
  const github = resolveGithubObservabilityLink({
    sourceType: job.source_type,
    repoFullName: job.repo.full_name,
    metadata,
  });
  const review =
    job.source_kind !== "agent_run" &&
    (job.source_type === "pr_review" || /review/i.test(job.agent.name ?? ""));
  const title =
    review && github?.kind === "pr"
      ? `Review ${github.label}`
      : (text(metadata?.prompt) ??
        text(metadata?.pr_title) ??
        text(metadata?.issue_title) ??
        job.agent.name ??
        "Agent work");
  const status = getAutomationStatusPresentation({
    status: job.status,
    metadata: job.latest_dispatch_event?.metadata,
    error: job.error,
  });
  const waiting =
    job.status === "running" && metadata?.run_status === "awaiting_input";
  const noFindings =
    job.latest_dispatch_event?.reason === "PR_REVIEW_NO_FINDINGS";
  const label = waiting
    ? "Needs your input"
    : job.status === "success"
      ? "Completed"
      : status.label;
  const summary = waiting
    ? "The agent is waiting for your input. Open the work to review its request."
    : status.isTimedOut
      ? "The run reached its time limit. Check its output before starting another attempt."
      : job.status === "success" && review && noFindings
        ? "The review completed with no findings. This does not mean the PR has been merged."
        : job.status === "success"
          ? "Execution completed. Review the output to confirm the intended result."
          : job.status === "failed"
            ? (job.error ??
              "The run stopped before completing. Review the latest event and available recovery actions.")
            : job.status === "cancelled"
              ? "Execution was cancelled. Any recorded output remains available below."
              : job.status === "pending"
                ? "The run is waiting to start. No completed result is available yet."
                : "Execution is in progress. The latest recorded activity appears below.";
  return {
    title,
    label,
    summary,
    github,
    waiting,
    subtitle: text(metadata?.pr_title),
    workspaceHref:
      job.source_kind === "agent_run"
        ? `/${encodeURIComponent(scope)}/runs/${encodeURIComponent(job.id)}`
        : null,
    callHref: job.latest_ai_call
      ? `/${encodeURIComponent(scope)}/observability?view=usage&call_id=${encodeURIComponent(job.latest_ai_call.id)}`
      : null,
    branch: text(metadata?.working_branch) ?? text(metadata?.head_ref),
  };
}

export function workDuration(job: ObservabilityJob, now = Date.now()) {
  const elapsed =
    job.duration_ms ??
    (job.started_at
      ? (job.completed_at ? Date.parse(job.completed_at) : now) -
        Date.parse(job.started_at)
      : null);
  if (elapsed === null || !Number.isFinite(elapsed)) return "Not started";
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
