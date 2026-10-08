import { buildSandboxObservabilityHref } from "@/lib/sandbox/navigation";
import { scopedHref } from "@/lib/scoped-href";
import type { FlowRunDetail } from "@/lib/types";
import { isRecord } from "./run-presentation-parsing";

export type RunInvocation = {
  versionNumber: number | null;
  triggeredBy: string | null;
  input: string | null;
  workingBranch: string | null;
  workspaceHref: string | null;
  sandboxHref: string | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function describeTrigger(trigger: unknown) {
  if (!isRecord(trigger)) return null;
  const label = text(trigger.label);
  if (trigger.credential === "integration") {
    return label ? `Integration · ${label}` : "Integration key";
  }
  if (trigger.credential === "interactive") return label ?? "Mogplex login";
  return null;
}

function findSandboxRecordId(
  metadata: Record<string, unknown>,
  calls: FlowRunDetail["ai_calls"]
) {
  const recorded = text(metadata.sandbox_record_id);
  if (recorded) return recorded;
  for (const call of calls.toReversed()) {
    const id = isRecord(call.metadata)
      ? text(call.metadata.sandbox_record_id)
      : null;
    if (id) return id;
  }
  return null;
}

function buildRunLinks(
  run: Pick<FlowRunDetail, "ai_calls" | "repo">,
  sandboxRecordId: string | null,
  scope: string | null | undefined
) {
  if (!scope) return { workspaceHref: null, sandboxHref: null };
  const latestCall = run.ai_calls.at(-1);
  const repoId = run.repo?.id;
  return {
    workspaceHref: latestCall
      ? scopedHref(
          scope,
          `/observability?call_id=${encodeURIComponent(latestCall.id)}`
        )
      : null,
    sandboxHref:
      sandboxRecordId && repoId
        ? buildSandboxObservabilityHref({ scope, repoId, sandboxRecordId })
        : null,
  };
}

/**
 * Who started an automation run and with what: the published version, the
 * credential, the accepted input snapshot and the branch it works on, plus
 * where to inspect its transcript and sandbox.
 */
export function getRunInvocation(
  run: Pick<FlowRunDetail, "metadata" | "ai_calls" | "repo">,
  scope: string | null | undefined
): RunInvocation {
  const metadata = isRecord(run.metadata) ? run.metadata : {};
  return {
    versionNumber:
      typeof metadata.flow_version_number === "number"
        ? metadata.flow_version_number
        : null,
    triggeredBy: describeTrigger(metadata.trigger),
    input: "input" in metadata ? JSON.stringify(metadata.input, null, 2) : null,
    workingBranch: text(metadata.working_branch),
    ...buildRunLinks(run, findSandboxRecordId(metadata, run.ai_calls), scope),
  };
}
