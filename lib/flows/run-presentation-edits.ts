import type { FlowRunDetail } from "@/lib/types";
import { isRecord, toOptionalTrimmedString } from "./run-presentation-parsing";
import { resolveCommitUrl } from "./run-presentation-links";

export type RunEditDiff = {
  id: string;
  sourceLabel: string;
  path: string | null;
  branch: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  patch: string | null;
};

// Keep run details bounded even when a workflow edits many files.
export const MAX_RUN_EDIT_DIFFS = 20;

function readRecordField(value: unknown, field: string) {
  return isRecord(value) ? value[field] : null;
}

function readToolCallEditDiff(input: {
  toolCall: unknown;
  sourceLabel: string;
  fallbackId: string;
}): RunEditDiff | null {
  const toolCall = isRecord(input.toolCall) ? input.toolCall : null;
  if (!toolCall) return null;

  const toolName =
    toOptionalTrimmedString(toolCall.name) ??
    toOptionalTrimmedString(toolCall.toolName);
  if (toolName !== "updateFile") return null;

  const toolInput = readRecordField(toolCall, "input");
  const toolOutput = readRecordField(toolCall, "output");
  if (!isRecord(toolOutput)) return null;

  const path =
    toOptionalTrimmedString(readRecordField(toolOutput, "path")) ??
    toOptionalTrimmedString(readRecordField(toolInput, "path"));
  const branch = toOptionalTrimmedString(readRecordField(toolOutput, "branch"));
  const commitSha = toOptionalTrimmedString(
    readRecordField(toolOutput, "commitSha")
  );
  // Sanitize at collection time so the field that lands in the rendered
  // <a href> is always a canonical https://github.com/<owner>/<repo>/commit/<sha>
  // URL — never a `javascript:` URL or arbitrary attacker-controlled string.
  const commitUrl = resolveCommitUrl(
    toOptionalTrimmedString(readRecordField(toolOutput, "commitUrl"))
  );
  const success = toolOutput.success;
  if (success === false) return null;
  if (success !== true && !commitSha && !commitUrl) return null;

  const patch =
    toOptionalTrimmedString(readRecordField(toolOutput, "patch")) ??
    toOptionalTrimmedString(readRecordField(toolOutput, "diff"));

  if (!path && !commitSha && !commitUrl && !patch) return null;

  return {
    // fallbackId includes the tool-call index; it only runs for degraded
    // records where the commit metadata is missing.
    id:
      commitSha ??
      commitUrl ??
      `${input.fallbackId}:updateFile:${path ?? "edit"}`,
    sourceLabel: input.sourceLabel,
    path,
    branch,
    commitSha,
    commitUrl,
    patch,
  } satisfies RunEditDiff;
}

function readNodeRunToolCalls(output: unknown) {
  const toolCalls = readRecordField(output, "tool_calls");
  return Array.isArray(toolCalls) ? toolCalls : [];
}

export function collectRunEditDiffs(run: FlowRunDetail) {
  const edits: RunEditDiff[] = [];
  const seen = new Set<string>();

  const append = (edit: RunEditDiff | null) => {
    if (!edit || seen.has(edit.id)) return;
    seen.add(edit.id);
    edits.push(edit);
  };

  for (const nodeRun of run.node_runs) {
    const sourceLabel = nodeRun.node_label || nodeRun.node_id;
    for (const [index, toolCall] of readNodeRunToolCalls(
      nodeRun.output
    ).entries()) {
      append(
        readToolCallEditDiff({
          toolCall,
          sourceLabel,
          fallbackId: `${nodeRun.id}:${index}`,
        })
      );
    }
  }

  for (const call of run.ai_calls) {
    for (const [index, toolCall] of call.tool_calls.entries()) {
      append(
        readToolCallEditDiff({
          toolCall,
          sourceLabel: call.model,
          fallbackId: `${call.id}:${index}`,
        })
      );
    }
  }

  return edits.slice(0, MAX_RUN_EDIT_DIFFS);
}
