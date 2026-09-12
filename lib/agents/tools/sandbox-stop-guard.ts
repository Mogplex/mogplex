import type { postSandboxExec } from "./sandbox-http-execution";

/**
 * Legacy disposable sandboxes lose files on stop. Keep agent stop requests
 * conservative, and inspect the entire checkout including launch-folder siblings.
 * Only `.mogplex/` runtime artifacts are excluded. Configuration edits count
 * as work because boot patches cannot be distinguished from operator edits.
 */
export const UNCOMMITTED_CHANGES_COMMAND = [
  'git -C "$(git rev-parse --show-toplevel)" status --porcelain=v1 --untracked-files=all --',
  ".",
  "':(glob,exclude).mogplex/**'",
  "':(glob,exclude)**/.mogplex/**'",
].join(" ");

const MAX_LISTED_FILES = 8;

export type UncommittedChangesReport =
  | { status: "clean" }
  | { status: "dirty"; files: string[]; total: number }
  | { status: "unknown"; error: string };

export function parseUncommittedChanges(
  stdout: string
): Extract<UncommittedChangesReport, { status: "clean" | "dirty" }> {
  const files = stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  if (files.length === 0) return { status: "clean" };
  return {
    status: "dirty",
    files: files.slice(0, MAX_LISTED_FILES),
    total: files.length,
  };
}

export async function inspectUncommittedChanges(
  sandboxId: string,
  headers: HeadersInit,
  execute: typeof postSandboxExec
): Promise<UncommittedChangesReport> {
  let payload: { exitCode?: unknown; stdout?: unknown; error?: unknown };
  try {
    const response = await execute(sandboxId, headers, {
      command: UNCOMMITTED_CHANGES_COMMAND,
    });
    payload = (await response.json().catch(() => ({}))) as typeof payload;
  } catch (error) {
    return {
      status: "unknown",
      error: error instanceof Error ? error.message : "command failed",
    };
  }
  if (typeof payload.error === "string") {
    return { status: "unknown", error: payload.error };
  }
  if (payload.exitCode !== 0 || typeof payload.stdout !== "string") {
    return {
      status: "unknown",
      error: `git status exited with ${String(payload.exitCode ?? "no exit code")}`,
    };
  }
  return parseUncommittedChanges(payload.stdout);
}

export function describeUncommittedChanges(
  report: Extract<UncommittedChangesReport, { status: "dirty" }>
): string {
  const listed = report.files.join(", ");
  const more =
    report.total > report.files.length
      ? ` and ${report.total - report.files.length} more`
      : "";
  return `${report.total} uncommitted change(s): ${listed}${more}`;
}
