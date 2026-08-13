import { isValidSandboxBranchName } from "@/lib/sandbox/launch-config";
import { shellQuote } from "@/lib/sandbox/client-shell";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertWorktreeId(worktreeId: string): void {
  if (!UUID_V4_PATTERN.test(worktreeId)) {
    throw new TypeError("Invalid worktree id");
  }
}

function assertBranchName(branchName: string): void {
  if (!isValidSandboxBranchName(branchName)) {
    throw new TypeError("Invalid branch name");
  }
}

export function isManagedWorktreePath(
  checkoutPath: string,
  worktreeId?: string
): boolean {
  if (!checkoutPath.startsWith("/") || checkoutPath.includes("\0"))
    return false;
  const segments = checkoutPath.split("/");
  if (segments.includes("..")) return false;
  const id = segments.at(-1) ?? "";
  return (
    segments.at(-2) === ".worktrees" &&
    UUID_V4_PATTERN.test(id) &&
    (!worktreeId || id === worktreeId)
  );
}

export function buildCreateWorktreeCommand(input: {
  worktreeId: string;
  branchName: string;
  baseBranch: string;
}): string {
  assertWorktreeId(input.worktreeId);
  assertBranchName(input.branchName);
  assertBranchName(input.baseBranch);

  return `set -eu
MOGPLEX_WORKTREE_ID=${shellQuote(input.worktreeId)}
MOGPLEX_BRANCH=${shellQuote(input.branchName)}
MOGPLEX_BASE_BRANCH=${shellQuote(input.baseBranch)}
repo_root="$(git rev-parse --show-toplevel)"
worktree_path="$repo_root/.worktrees/$MOGPLEX_WORKTREE_ID"
git -C "$repo_root" check-ref-format --branch "$MOGPLEX_BRANCH" >/dev/null
git -C "$repo_root" check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git -C "$repo_root" fetch origin "$MOGPLEX_BASE_BRANCH:refs/remotes/origin/$MOGPLEX_BASE_BRANCH"
if git -C "$repo_root" worktree list --porcelain | grep -Fx "worktree $worktree_path" >/dev/null 2>&1; then
  current_branch="$(git -C "$worktree_path" branch --show-current)"
  [ "$current_branch" = "$MOGPLEX_BRANCH" ] || { echo "Managed checkout uses $current_branch, not $MOGPLEX_BRANCH" >&2; exit 1; }
elif git -C "$repo_root" show-ref --verify --quiet "refs/heads/$MOGPLEX_BRANCH"; then
  git -C "$repo_root" worktree add "$worktree_path" "$MOGPLEX_BRANCH"
elif git -C "$repo_root" ls-remote --exit-code --heads origin "$MOGPLEX_BRANCH" >/dev/null 2>&1; then
  git -C "$repo_root" fetch origin "$MOGPLEX_BRANCH:refs/remotes/origin/$MOGPLEX_BRANCH"
  git -C "$repo_root" worktree add -b "$MOGPLEX_BRANCH" "$worktree_path" "origin/$MOGPLEX_BRANCH"
else
  git -C "$repo_root" worktree add -b "$MOGPLEX_BRANCH" "$worktree_path" "origin/$MOGPLEX_BASE_BRANCH"
fi
printf 'MOGPLEX_WORKTREE_PATH=%s\n' "$worktree_path"`;
}

export function parseCreatedWorktreePath(
  stdout: string,
  worktreeId: string
): string | null {
  assertWorktreeId(worktreeId);
  const marker = stdout
    .split("\n")
    .find((line) => line.startsWith("MOGPLEX_WORKTREE_PATH="));
  if (!marker) return null;
  const checkoutPath = marker.slice("MOGPLEX_WORKTREE_PATH=".length).trim();
  return isManagedWorktreePath(checkoutPath, worktreeId) ? checkoutPath : null;
}

export function buildRebaseWorktreeCommand(input: {
  baseBranch: string;
}): string {
  assertBranchName(input.baseBranch);
  return `set -eu
MOGPLEX_BASE_BRANCH=${shellQuote(input.baseBranch)}
git check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git fetch origin "$MOGPLEX_BASE_BRANCH:refs/remotes/origin/$MOGPLEX_BASE_BRANCH"
if ! git rebase "origin/$MOGPLEX_BASE_BRANCH"; then
  git rebase --abort >/dev/null 2>&1 || true
  exit 1
fi`;
}

export function buildWorktreeDiffCommand(input: {
  baseBranch: string;
}): string {
  assertBranchName(input.baseBranch);
  return `set -eu
MOGPLEX_BASE_BRANCH=${shellQuote(input.baseBranch)}
git check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git diff --stat "origin/$MOGPLEX_BASE_BRANCH...HEAD"
git diff --binary "origin/$MOGPLEX_BASE_BRANCH...HEAD"`;
}

export function buildPruneWorktreeCommand(input: {
  checkoutPath: string;
  force: boolean;
}): string {
  if (!isManagedWorktreePath(input.checkoutPath)) {
    throw new TypeError("Invalid managed worktree path");
  }
  const force = input.force ? " --force" : "";
  return `set -eu
checkout_path=${shellQuote(input.checkoutPath)}
repo_root="$(git rev-parse --show-toplevel)"
git -C "$repo_root" worktree remove${force} "$checkout_path"
git -C "$repo_root" worktree prune`;
}
