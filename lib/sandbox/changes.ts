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
  return `set -eu
${REPO_ROOT}
printf '${MARKERS.branch}%s\\n' "$(git branch --show-current)"
${aheadBehind}
echo ${MARKERS.status}
git status --porcelain=v1 --untracked-files=no -- . ${RUNTIME_EXCLUDE}
echo ${MARKERS.numstat}
git diff --numstat HEAD -- . ${RUNTIME_EXCLUDE}
echo ${MARKERS.untracked}
git ls-files --others --exclude-standard -- . ${RUNTIME_EXCLUDE} | while IFS= read -r f; do
  printf '%s\\t%s\\n' "$(wc -l < "$f" | tr -d ' ')" "$f"
done`;
}

export function buildFileDiffScript(path: string): string {
  const quoted = assertSafePath(path);
  return `set -eu
${REPO_ROOT}
p=${quoted}
if git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
  git diff HEAD -- "$p"
else
  git diff --no-index -- /dev/null "$p" || true
fi`;
}

export function buildRevertScript(paths: string[]): string {
  const quoted = paths.map((path) => assertSafePath(path));
  return `set -eu
${REPO_ROOT}
for p in ${quoted.join(" ")}; do
  if git cat-file -e "HEAD:$p" 2>/dev/null; then
    git checkout HEAD -- "$p"
  else
    git rm -q --cached --ignore-unmatch -- "$p"
    rm -f -- "$p"
  fi
done`;
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

function unquoteGitPath(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function statusFromPorcelain(code: string): SandboxChangedFileStatus {
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

/** `dir/{a => b}/f.ts` and `a.ts => b.ts` both name the new path. */
function numstatNewPath(raw: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`;
  const arrow = raw.indexOf(" => ");
  return arrow === -1 ? raw : raw.slice(arrow + 4);
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
  return (stop === -1 ? tail : tail.slice(0, stop)).filter(Boolean);
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
  for (const line of section(lines, MARKERS.numstat, MARKERS.untracked)) {
    const [add, del, ...rest] = line.split("\t");
    counts.set(numstatNewPath(unquoteGitPath(rest.join("\t"))), {
      additions: Number.parseInt(add ?? "0", 10) || 0,
      deletions: Number.parseInt(del ?? "0", 10) || 0,
    });
  }
  const files: SandboxChangedFile[] = [];
  for (const line of section(lines, MARKERS.status, MARKERS.numstat)) {
    const code = line.slice(0, 2);
    // Untracked files are listed separately with their line counts.
    if (code === "??") continue;
    const rawPath = line.slice(3);
    const status = statusFromPorcelain(code);
    const arrow = status === "renamed" ? rawPath.indexOf(" -> ") : -1;
    const path = unquoteGitPath(
      arrow === -1 ? rawPath : rawPath.slice(arrow + 4)
    );
    const previousPath =
      arrow === -1 ? undefined : unquoteGitPath(rawPath.slice(0, arrow));
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
      path: unquoteGitPath(line.slice(tab + 1)),
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
