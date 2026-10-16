/**
 * Everything a run changed on its branch: committed work since the base
 * branch plus uncommitted and untracked files, with unified diffs, in one
 * sandbox round trip. `changes.ts` covers only uncommitted work for the
 * workspace editor; a run summary also needs what the agent committed.
 */
import { shellQuote } from "@/lib/sandbox/client-shell";
import type { SandboxHandle } from "@/lib/sandbox/provider/types";

export type BranchChangedFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed";

export type BranchChangedFile = {
  /** Repository-root-relative path. */
  path: string;
  previousPath?: string;
  status: BranchChangedFileStatus;
  additions: number;
  deletions: number;
  /** Unified diff for this file. Absent when it did not fit the read budget. */
  patch?: string;
};

export type BranchChanges = {
  files: BranchChangedFile[];
  /** Some patches were cut or dropped to fit the read budget. */
  patchTruncated: boolean;
};

const EXCLUDE = "':(exclude).mogplex'";
const MARKERS = {
  nameStatus: "MOGPLEX_NAME_STATUS_BEGIN",
  numstat: "MOGPLEX_NUMSTAT_BEGIN",
  untracked: "MOGPLEX_UNTRACKED_BEGIN",
  patch: "MOGPLEX_PATCH_BEGIN",
} as const;

/** Patch bytes read from the sandbox; Slack shows far less than this. */
export const BRANCH_PATCH_READ_BYTES = 256 * 1024;

/**
 * Diffs the working tree against the merge base with `origin/<base>`, so
 * committed and uncommitted work both count. Without a reachable base the
 * diff falls back to HEAD (uncommitted work only). Each section is base64
 * on one line: paths and patches may contain newlines or marker text.
 */
export function buildBranchChangesScript(
  baseBranch: string | null,
  maxPatchBytes = BRANCH_PATCH_READ_BYTES
): string {
  const mergeBase = baseBranch
    ? `git merge-base HEAD origin/${shellQuote(baseBranch)} 2>/dev/null || git rev-parse HEAD`
    : "git rev-parse HEAD";
  const untracked = `git ls-files -z --others --exclude-standard -- . ${EXCLUDE}`;
  const script = `set -eu
cd "$(git rev-parse --show-toplevel)"
base="$(${mergeBase})"
echo ${MARKERS.nameStatus}
git diff --name-status -z --find-renames "$base" -- . ${EXCLUDE} | base64 | tr -d '\\n'; echo
echo ${MARKERS.numstat}
git diff --numstat -z --find-renames "$base" -- . ${EXCLUDE} | base64 | tr -d '\\n'; echo
echo ${MARKERS.untracked}
${untracked} | while IFS= read -r -d '' f; do
  if [ -L "$f" ]; then count=1; else count="$(wc -l < "$f" | tr -d ' ')"; fi
  printf '%s\\t%s\\0' "$count" "$f"
done | base64 | tr -d '\\n'; echo
echo ${MARKERS.patch}
{
  git diff --no-color --find-renames "$base" -- . ${EXCLUDE}
  ${untracked} | while IFS= read -r -d '' f; do
    git diff --no-color --no-index -- /dev/null "$f" || true
  done
} 2>/dev/null | head -c ${Math.max(0, Math.floor(maxPatchBytes))} | base64 | tr -d '\\n'; echo`;
  return `bash -c ${shellQuote(script)}`;
}

function sectionValue(lines: string[], marker: string): string {
  const index = lines.indexOf(marker);
  if (index === -1) return "";
  return Buffer.from(lines[index + 1] ?? "", "base64").toString("utf8");
}

function statusFromCode(code: string): BranchChangedFileStatus {
  if (code.startsWith("R")) return "renamed";
  if (code.startsWith("D")) return "deleted";
  if (code.startsWith("A") || code.startsWith("C")) return "added";
  return "modified";
}

function count(value: string | undefined) {
  return Number.parseInt(value ?? "0", 10) || 0;
}

/** Split `git diff` output into one chunk per file, in output order. */
export function splitUnifiedDiff(patch: string): string[] {
  if (!patch) return [];
  const chunks = patch.split(/^(?=diff --git )/m);
  return chunks.filter((chunk) => chunk.startsWith("diff --git "));
}

/**
 * Patch chunks are matched to files by position. `git diff` lists files in
 * the same order for `--name-status`, `--numstat` and the patch, and the
 * untracked loop follows `ls-files` order, so no path parsing is needed
 * (quoted and unusual paths stay exact).
 */
export function parseBranchChangesOutput(
  stdout: string,
  maxPatchBytes = BRANCH_PATCH_READ_BYTES
): BranchChanges {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const statusFields = sectionValue(lines, MARKERS.nameStatus)
    .split("\0")
    .filter(Boolean);
  const numstatFields = sectionValue(lines, MARKERS.numstat)
    .split("\0")
    .filter(Boolean);
  const untrackedFields = sectionValue(lines, MARKERS.untracked)
    .split("\0")
    .filter(Boolean);
  const rawPatch = sectionValue(lines, MARKERS.patch);

  const counts = new Map<string, { additions: number; deletions: number }>();
  for (let index = 0; index < numstatFields.length; index += 1) {
    const [add, del, ...rest] = numstatFields[index].split("\t");
    let path = rest.join("\t");
    if (!path) {
      // Renames: empty path, then source NUL destination NUL.
      path = numstatFields[index + 2] ?? "";
      index += 2;
    }
    counts.set(path, { additions: count(add), deletions: count(del) });
  }

  const files: BranchChangedFile[] = [];
  for (let index = 0; index < statusFields.length; index += 1) {
    const code = statusFields[index];
    const status = statusFromCode(code);
    const hasSource = code.startsWith("R") || code.startsWith("C");
    const previousPath = hasSource ? statusFields[++index] : undefined;
    const path = statusFields[++index] ?? "";
    if (!path) continue;
    const stats = counts.get(path) ?? { additions: 0, deletions: 0 };
    files.push({
      path,
      status,
      ...(status === "renamed" && previousPath ? { previousPath } : {}),
      ...stats,
    });
  }
  for (const field of untrackedFields) {
    const tab = field.indexOf("\t");
    if (tab === -1) continue;
    files.push({
      path: field.slice(tab + 1),
      status: "added",
      additions: count(field.slice(0, tab)),
      deletions: 0,
    });
  }

  const chunks = splitUnifiedDiff(rawPatch);
  const readAll = Buffer.byteLength(rawPatch) < maxPatchBytes;
  const patched = Math.min(files.length, chunks.length);
  for (let index = 0; index < patched; index += 1) {
    const chunk = chunks[index];
    // The last chunk read may have been cut by the byte budget.
    const complete = readAll || index < chunks.length - 1;
    files[index].patch = complete
      ? chunk
      : `${chunk.replace(/\n?[^\n]*$/, "")}\n`;
  }
  return {
    files,
    patchTruncated: !readAll || chunks.length < files.length,
  };
}

/** Run the branch changes script in a live sandbox. Never resumes it. */
export async function readSandboxBranchChanges(
  sandbox: Pick<SandboxHandle, "runCommand">,
  input: { cwd: string; baseBranch: string | null; signal?: AbortSignal }
): Promise<BranchChanges> {
  const command = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", buildBranchChangesScript(input.baseBranch)],
    cwd: input.cwd,
    signal: input.signal,
  });
  const [stdout, stderr] = await Promise.all([
    command.stdout(),
    command.stderr(),
  ]);
  if (command.exitCode !== 0) {
    throw new Error(
      `Branch changes failed: ${stderr.trim().slice(0, 300) || `exit ${command.exitCode}`}`
    );
  }
  return parseBranchChangesOutput(stdout);
}
