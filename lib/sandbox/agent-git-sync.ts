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
git fetch origin "$MOGPLEX_BASE_BRANCH:refs/remotes/origin/$MOGPLEX_BASE_BRANCH"
remote_branch=false
if git ls-remote --exit-code --heads origin "$MOGPLEX_WORKING_BRANCH" >/dev/null 2>&1; then
  remote_branch=true
  git fetch origin "$MOGPLEX_WORKING_BRANCH:refs/remotes/origin/$MOGPLEX_WORKING_BRANCH"
fi
if git show-ref --verify --quiet "refs/heads/$MOGPLEX_WORKING_BRANCH"; then
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
`.trim();
}
