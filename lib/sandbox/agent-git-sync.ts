import { createHash } from "node:crypto";
import {
  buildNextConfigInjectedLine,
  buildStandaloneNextConfig,
} from "@/lib/sandbox/runtimes/next-config-patch";

/**
 * Git blob id (`git hash-object`) of the standalone next.config the platform
 * writes at sandbox boot for repos without one. The sync script only deletes
 * an untracked config whose blob id still matches, so any user edit to that
 * file keeps it in place and fails the clean-tree check.
 */
export function getStandaloneNextConfigBlobId() {
  const content = Buffer.from(buildStandaloneNextConfig(), "utf8");
  // Git blob ids are SHA-1 by definition; this is an identity check, not a
  // security hash.
  // eslint-disable-next-line sonarjs/hashing
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

/**
 * Shared agent branch synchronization state machine. Callers provide
 * MOGPLEX_BASE_BRANCH, MOGPLEX_WORKING_BRANCH, and MOGPLEX_CREATE_BRANCH in
 * the command environment; transport-specific code decides how to inject
 * them.
 */
export function buildAgentGitSyncScript() {
  const injectedLine = buildNextConfigInjectedLine();
  if (injectedLine.includes("'") || injectedLine.includes("\n")) {
    throw new Error(
      "next.config injected line cannot be embedded in the sync script"
    );
  }
  const standaloneBlobId = getStandaloneNextConfigBlobId();
  return `
set -eu
git check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git check-ref-format --branch "$MOGPLEX_WORKING_BRANCH" >/dev/null
if [ -n "$MOGPLEX_FALLBACK_BRANCH" ]; then
  git check-ref-format --branch "$MOGPLEX_FALLBACK_BRANCH" >/dev/null
fi
if [ "$MOGPLEX_REQUIRE_CLEAN" = 1 ]; then
  # Sandbox boot leaves platform-owned artifacts behind: runtime files under
  # .mogplex/ and the allowedDevOrigins preview patch in next.config.*. Neither
  # is the user's work, so neutralize both before judging whether the tree is
  # clean. A tracked next.config.* whose diff is anything other than the exact
  # injected line (including a file-mode change), or an untracked one that no
  # longer matches the boot-generated file byte for byte, is left alone and
  # fails the check like any other local change.
  repo_top="$(git rev-parse --show-toplevel)"
  for runtime_dir in "$repo_top/.mogplex" ./.mogplex; do
    if [ -d "$runtime_dir" ] && [ ! -e "$runtime_dir/.gitignore" ]; then
      printf '*\n' > "$runtime_dir/.gitignore"
    fi
  done
  for cfg in next.config.mjs next.config.js next.config.ts next.config.cjs; do
    [ -f "$cfg" ] || continue
    if git ls-files --error-unmatch -- "$cfg" >/dev/null 2>&1; then
      if ! git diff --quiet -- "$cfg" && [ -z "$(git diff --summary -- "$cfg")" ] && [ "$(git diff -U0 -- "$cfg" | grep -E '^[-+][^-+]')" = '+${injectedLine}' ]; then
        git checkout -- "$cfg"
      fi
    elif [ "$(git hash-object --no-filters -- "$cfg")" = "${standaloneBlobId}" ]; then
      rm -f -- "$cfg"
    fi
  done
fi
if [ "$MOGPLEX_REQUIRE_CLEAN" = 1 ] && [ -n "$(git status --porcelain)" ]; then
  echo "The sandbox workspace is not clean before the agent run. Commit, discard, or move the existing changes, then retry." >&2
  git status --short >&2
  exit 1
fi
git fetch origin "$MOGPLEX_BASE_BRANCH:refs/remotes/origin/$MOGPLEX_BASE_BRANCH"
remote_branch=false
if git ls-remote --exit-code --heads origin "$MOGPLEX_WORKING_BRANCH" >/dev/null 2>&1; then
  remote_branch=true
  git fetch origin "$MOGPLEX_WORKING_BRANCH:refs/remotes/origin/$MOGPLEX_WORKING_BRANCH"
fi
local_branch=false
if git show-ref --verify --quiet "refs/heads/$MOGPLEX_WORKING_BRANCH"; then
  local_branch=true
fi
if [ -n "$MOGPLEX_FALLBACK_BRANCH" ] && [ "$MOGPLEX_FALLBACK_BRANCH" != "$MOGPLEX_WORKING_BRANCH" ]; then
  pull_request_state="$(gh pr list --head "$MOGPLEX_WORKING_BRANCH" --state all --limit 1 --json state --jq '.[0].state // ""' 2>/dev/null || true)"
  if [ "$pull_request_state" = MERGED ] || [ "$pull_request_state" = CLOSED ] || { [ "$remote_branch" = false ] && [ "$local_branch" = false ]; }; then
    MOGPLEX_WORKING_BRANCH="$MOGPLEX_FALLBACK_BRANCH"
    MOGPLEX_CREATE_BRANCH=1
    remote_branch=false
    local_branch=false
    if git ls-remote --exit-code --heads origin "$MOGPLEX_WORKING_BRANCH" >/dev/null 2>&1; then
      remote_branch=true
      git fetch origin "$MOGPLEX_WORKING_BRANCH:refs/remotes/origin/$MOGPLEX_WORKING_BRANCH"
    fi
    if git show-ref --verify --quiet "refs/heads/$MOGPLEX_WORKING_BRANCH"; then
      local_branch=true
    fi
  fi
fi
if [ "$local_branch" = true ]; then
  git checkout "$MOGPLEX_WORKING_BRANCH"
elif [ "$remote_branch" = true ]; then
  git checkout -b "$MOGPLEX_WORKING_BRANCH" "origin/$MOGPLEX_WORKING_BRANCH"
elif [ "$MOGPLEX_CREATE_BRANCH" = 1 ]; then
  git checkout -b "$MOGPLEX_WORKING_BRANCH" "origin/$MOGPLEX_BASE_BRANCH"
else
  echo "Working branch is unavailable on origin" >&2
  exit 1
fi
if [ "$remote_branch" = true ]; then
  git merge --ff-only "origin/$MOGPLEX_WORKING_BRANCH"
else
  git push -u origin "$MOGPLEX_WORKING_BRANCH"
fi
printf 'MOGPLEX_SYNCED_BRANCH=%s\n' "$MOGPLEX_WORKING_BRANCH"
`.trim();
}
