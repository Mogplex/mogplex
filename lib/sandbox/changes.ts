/**
 * Live working-tree changes for a sandbox checkout: the shell scripts the
 * changes route runs inside the sandbox and the parsers for their output.
 * Pure helpers only; the route owns sandbox access.
 */
import { shellQuote } from "@/lib/sandbox/client-shell";

export type SandboxChangedFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

export type SandboxChangedFile = {
  /** Repository-root-relative path. */
  path: string;
  status: SandboxChangedFileStatus;
  previousPath?: string;
  additions: number;
  deletions: number;
};

export type SandboxChanges = {
  branch: string | null;
  baseBranch: string | null;
  ahead: number;
  behind: number;
  files: SandboxChangedFile[];
};

export type SandboxCommitResult = {
  committed: boolean;
  sha: string | null;
  pushed: boolean;
  pullRequestUrl: string | null;
};

const RUNTIME_EXCLUDE = "':(exclude).mogplex'";
const REPO_ROOT = 'cd "$(git rev-parse --show-toplevel)"';
const MARKERS = {
  branch: "MOGPLEX_BRANCH=",
  aheadBehind: "MOGPLEX_AHEAD_BEHIND=",
  status: "MOGPLEX_STATUS_BEGIN",
  numstat: "MOGPLEX_NUMSTAT_BEGIN",
  untracked: "MOGPLEX_UNTRACKED_BEGIN",
  committed: "MOGPLEX_COMMITTED=",
  sha: "MOGPLEX_SHA=",
  pushed: "MOGPLEX_PUSHED=",
  pullRequest: "MOGPLEX_PULL_REQUEST_URL=",
} as const;

export function isSafeRepoPath(path: string): boolean {
  if (!path || path.length > 4096) return false;
  if (path.includes("\0") || path.startsWith("/")) return false;
  return !path.split("/").includes("..");
}

function assertSafePath(path: string) {
  if (!isSafeRepoPath(path)) throw new TypeError(`Invalid path: ${path}`);
  return shellQuote(path);
}

export function buildChangesStatusScript(baseBranch: string | null): string {
  const aheadBehind = baseBranch
    ? `counts="$(git rev-list --left-right --count HEAD...origin/${shellQuote(baseBranch)} 2>/dev/null || printf '0\\t0')"
printf '${MARKERS.aheadBehind}%s\\n' "$counts"`
    : "";
  const script = `set -euo pipefail
${REPO_ROOT}
printf '${MARKERS.branch}%s\\n' "$(git branch --show-current)"
${aheadBehind}
echo ${MARKERS.status}
git status --porcelain=v1 -z --renames --untracked-files=no -- . ${RUNTIME_EXCLUDE} | base64
echo ${MARKERS.numstat}
git diff --numstat -z --find-renames HEAD -- . ${RUNTIME_EXCLUDE} | base64
echo ${MARKERS.untracked}
git ls-files -z --others --exclude-standard -- . ${RUNTIME_EXCLUDE} | while IFS= read -r -d '' f; do
  if [ -L "$f" ]; then count=1; else count="$(wc -l < "$f" | tr -d ' ')"; fi
  printf '%s\\t%s\\0' "$count" "$f"
done | base64`;
  // Encode the NUL-delimited sections for text-only sandbox transports. Git
  // filenames can contain newlines and even our section marker strings.
  return `bash -c ${shellQuote(script)}`;
}

export function buildFileDiffScript(path: string): string {
  const quoted = assertSafePath(path);
  return `set -eu
${REPO_ROOT}
p=${quoted}
export GIT_LITERAL_PATHSPECS=1
if git cat-file -e "HEAD:$p" 2>/dev/null || git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
  git diff HEAD -- "$p"
else
  git diff --no-index -- /dev/null "$p" || [ "$?" -eq 1 ]
fi`;
}

export function buildRevertScript(paths: string[]): string {
  const quoted = paths.map((path) => assertSafePath(path));
  return `bash -s -- ${quoted.join(" ")} <<'MOGPLEX_REVERT'
set -eu
${REPO_ROOT}
status_file="$(mktemp)"
trap 'rm -f -- "$status_file"' EXIT
git status --porcelain=v1 -z --untracked-files=no --renames > "$status_file"
originals=()
# In -z status, a rename is destination NUL source NUL. Read the whole
# snapshot before changing the index so multiple selected renames stay valid.
while IFS= read -r -d '' entry; do
  code="\${entry:0:2}"
  if [[ "$code" == *R* || "$code" == *C* ]]; then
    IFS= read -r -d '' original
    if [[ "$code" == *R* ]]; then
      for p in "$@"; do
        if [[ "$p" == "\${entry:3}" ]]; then originals+=("$original"); fi
      done
    fi
  fi
done < "$status_file"
export GIT_LITERAL_PATHSPECS=1
for p in "$@"; do
  if git cat-file -e "HEAD:$p" 2>/dev/null; then
    git checkout HEAD -- "$p"
  else
    git rm -q -f --cached --ignore-unmatch -- "$p"
    rm -f -- "$p"
  fi
done
if [ "\${#originals[@]}" -gt 0 ]; then
  git checkout HEAD -- "\${originals[@]}"
fi
MOGPLEX_REVERT`;
}

function pullRequestTitle(message: string) {
  const firstLine = message.split("\n", 1)[0]?.replace(/\s+/g, " ").trim();
  if (!firstLine) return "Mogplex agent changes";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export function buildCommitScript(input: {
  message: string;
  baseBranch: string;
  push?: boolean;
  openPullRequest?: boolean;
}): string {
  const base = shellQuote(input.baseBranch);
  const message = shellQuote(input.message);
  const title = shellQuote(pullRequestTitle(input.message));
  const push = input.push || input.openPullRequest;
  return `set -eu
${REPO_ROOT}
branch="$(git branch --show-current)"
if [ -z "$branch" ] || [ "$branch" = ${base} ]; then
  echo "Refusing to push to the base branch; switch to a working branch first." >&2
  exit 1
fi
git add -A -- . ${RUNTIME_EXCLUDE}
if git diff --cached --quiet; then
  echo ${MARKERS.committed}false
else
  git commit -q -m ${message}
  echo ${MARKERS.committed}true
fi
printf '${MARKERS.sha}%s\\n' "$(git rev-parse HEAD)"
${
  push
    ? `git push -u origin "$branch"
echo ${MARKERS.pushed}true`
    : ""
}
${
  input.openPullRequest
    ? `url="$(gh pr list --head "$branch" --base ${base} --state open --limit 1 --json url --jq '.[0].url // ""' 2>/dev/null || true)"
if [ -z "$url" ]; then
  url="$(gh pr create --base ${base} --head "$branch" --title ${title} --body 'Created from the Mogplex workspace.')"
fi
printf '${MARKERS.pullRequest}%s\\n' "$url"`
    : ""
}`;
}

function statusFromPorcelain(code: string): SandboxChangedFileStatus {
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

function readMarker(lines: string[], marker: string): string | null {
  const line = lines.find((entry) => entry.startsWith(marker));
  return line ? line.slice(marker.length) : null;
}

function section(lines: string[], start: string, end?: string): string[] {
  const from = lines.indexOf(start);
  if (from === -1) return [];
  const tail = lines.slice(from + 1);
  const stop = end === undefined ? -1 : tail.indexOf(end);
  return Buffer.from(
    (stop === -1 ? tail : tail.slice(0, stop)).join(""),
    "base64"
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

export function parseChangesOutput(
  stdout: string,
  baseBranch: string | null
): SandboxChanges {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const [ahead = "0", behind = "0"] = (
    readMarker(lines, MARKERS.aheadBehind) ?? ""
  ).split("\t");
  const counts = new Map<string, { additions: number; deletions: number }>();
  const stats = section(lines, MARKERS.numstat, MARKERS.untracked);
  for (let index = 0; index < stats.length; index += 1) {
    const line = stats[index];
    const [add, del, ...rest] = line.split("\t");
    let path = rest.join("\t");
    if (!path) {
      // Renames have an empty header path, then source NUL destination NUL.
      path = stats[index + 2];
      index += 2;
    }
    counts.set(path, {
      additions: Number.parseInt(add ?? "0", 10) || 0,
      deletions: Number.parseInt(del ?? "0", 10) || 0,
    });
  }
  const files: SandboxChangedFile[] = [];
  const statuses = section(lines, MARKERS.status, MARKERS.numstat);
  for (let index = 0; index < statuses.length; index += 1) {
    const line = statuses[index];
    const code = line.slice(0, 2);
    // Untracked files are listed separately with their line counts.
    if (code === "??") continue;
    const path = line.slice(3);
    const status = statusFromPorcelain(code);
    const previousPath =
      code.includes("R") || code.includes("C") ? statuses[++index] : undefined;
    const count = counts.get(path) ?? { additions: 0, deletions: 0 };
    files.push({
      path,
      status,
      ...(previousPath ? { previousPath } : {}),
      additions: count.additions,
      deletions: count.deletions,
    });
  }
  for (const line of section(lines, MARKERS.untracked)) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    files.push({
      path: line.slice(tab + 1),
      status: "untracked",
      additions: Number.parseInt(line.slice(0, tab), 10) || 0,
      deletions: 0,
    });
  }
  return {
    branch: readMarker(lines, MARKERS.branch) || null,
    baseBranch,
    ahead: Number.parseInt(ahead, 10) || 0,
    behind: Number.parseInt(behind, 10) || 0,
    files,
  };
}

export function parseCommitOutput(stdout: string): SandboxCommitResult {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  return {
    committed: readMarker(lines, MARKERS.committed) === "true",
    sha: readMarker(lines, MARKERS.sha) || null,
    pushed: readMarker(lines, MARKERS.pushed) === "true",
    pullRequestUrl: readMarker(lines, MARKERS.pullRequest) || null,
  };
}
