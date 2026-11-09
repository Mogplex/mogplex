import { resolveEffectiveSandboxTimeoutMs } from "@/lib/repo-settings";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import type { SandboxRecord, SandboxRecordRow } from "@/lib/types";
import type { ActiveSandboxRecord, CliSandboxRecord } from "./types";

export function toStreamSandboxRecord(
  record: SandboxRecordRow | SandboxRecord
) {
  return toSandboxClientRecord(record);
}

export function isSandboxClientRecord(
  record: SandboxRecordRow | SandboxRecord
): record is SandboxRecord {
  return (
    "billing_summary" in record &&
    "runtime_summary" in record &&
    "error_summary" in record
  );
}

export function toStreamStatusSandboxRecord(
  record: SandboxRecordRow | SandboxRecord
) {
  return isSandboxClientRecord(record) ? record : toStreamSandboxRecord(record);
}

export function toCliSandboxRecord(
  record: ActiveSandboxRecord
): CliSandboxRecord {
  const repo = Array.isArray(record.repos) ? record.repos[0] : record.repos;
  const workspace = repo?.workspaces
    ? Array.isArray(repo.workspaces)
      ? repo.workspaces[0]
      : repo.workspaces
    : null;
  return {
    id: record.id,
    sandboxId:
      record.sandbox_id && record.sandbox_id !== "pending"
        ? record.sandbox_id
        : null,
    repo: repo?.full_name ?? null,
    workspace: workspace?.name ?? null,
    branch: record.working_branch || null,
    status: record.status,
    createdAt: record.created_at,
    url: record.preview_url,
  };
}

export function readSandboxFormat(request: Request): "cli" | null {
  try {
    return new URL(request.url).searchParams.get("format") === "cli"
      ? "cli"
      : null;
  } catch {
    return null;
  }
}

export function resolveEffectiveTimeoutFromActiveRecord(
  record: ActiveSandboxRecord
): number {
  const repo = Array.isArray(record.repos) ? record.repos[0] : record.repos;
  const workspace = repo?.workspaces
    ? Array.isArray(repo.workspaces)
      ? repo.workspaces[0]
      : repo.workspaces
    : null;
  return resolveEffectiveSandboxTimeoutMs({
    repoTimeoutMs: repo?.sandbox_timeout_ms,
    workspaceTimeoutMs: workspace?.sandbox_timeout_ms,
  });
}
