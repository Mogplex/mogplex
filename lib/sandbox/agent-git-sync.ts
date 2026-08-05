/**
 * Shared agent branch synchronization state machine. Callers provide
 * MOGPLEX_BASE_BRANCH, MOGPLEX_WORKING_BRANCH, and MOGPLEX_CREATE_BRANCH in
 * the command environment; transport-specific code decides how to inject
 * them.
 */
export function buildAgentGitSyncScript() {
  return `
set -eu
git check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git check-ref-format --branch "$MOGPLEX_WORKING_BRANCH" >/dev/null
if [ -n "$MOGPLEX_FALLBACK_BRANCH" ]; then
  git check-ref-format --branch "$MOGPLEX_FALLBACK_BRANCH" >/dev/null
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
