import type { Sandbox } from "@vercel/sandbox";
import { buildAgentGitSyncScript } from "@/lib/sandbox/agent-git-sync";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type HarnessGitWorkspace = {
  baseBranch: string;
  workingBranch: string;
  createdBranch: boolean;
};

export type HarnessPullRequestDelivery = {
  pullRequestUrl: string | null;
  /** Whether the delivery branch currently contains commits ahead of base. */
  changed: boolean;
  autoCommittedFiles: string[];
};

const PULL_REQUEST_MARKER = "MOGPLEX_PULL_REQUEST_URL=";
const CHANGED_MARKER = "MOGPLEX_CHANGED=";
const AUTO_COMMITTED_FILE_MARKER = "MOGPLEX_AUTO_COMMITTED_FILE=";
const SYNCED_BRANCH_MARKER = "MOGPLEX_SYNCED_BRANCH=";

async function runShell(
  sandbox: Sandbox,
  command: string,
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<CommandResult> {
  const process = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", command],
    cwd: options.cwd,
    env: options.env,
  });
  const [stdout, stderr, result] = await Promise.all([
    process.stdout(),
    process.stderr(),
    process.wait(),
  ]);
  return { exitCode: result.exitCode, stdout, stderr };
}

export function buildHarnessWorkingBranch(aiCallId: string) {
  return `mogplex/agent-${aiCallId.replaceAll("-", "").slice(0, 12)}`;
}

export function buildHarnessDeliveryPrompt(input: {
  prompt: string;
  baseBranch: string;
  workingBranch: string;
}) {
  return `<delivery-contract>
You are working on branch ${input.workingBranch}, based on ${input.baseBranch}. The repository has already been fetched, checked out, and fast-forwarded before this run.

If you change code, you must finish the delivery loop before declaring success:
1. Run the relevant tests.
2. Commit every intended change on ${input.workingBranch}.
3. Push ${input.workingBranch} to origin without force-pushing.
4. Open or update a pull request into ${input.baseBranch} and include its URL in your final response.

Leave no untracked files in the repository. Commit intended new files, add disposable files to .gitignore, or delete scratch files before finishing; otherwise delivery fails closed.
Never commit files under .mogplex; they contain runtime configuration and delivery refuses them.

Do not leave completed work only in the sandbox. If GitHub delivery is blocked, state the exact blocker instead of claiming the work is finished.
</delivery-contract>

${input.prompt}`;
}

export async function syncHarnessGitWorkspace(
  sandbox: Sandbox,
  input: {
    aiCallId: string;
    baseBranch: string;
    workingBranch: string;
    cwd?: string;
    env?: Record<string, string>;
  }
): Promise<HarnessGitWorkspace> {
  const initialWorkingBranch =
    input.workingBranch === input.baseBranch
      ? buildHarnessWorkingBranch(input.aiCallId)
      : input.workingBranch;
  const fallbackBranch = buildHarnessWorkingBranch(input.aiCallId);
  const command = buildAgentGitSyncScript();

  const result = await runShell(sandbox, command, {
    cwd: input.cwd,
    env: {
      ...input.env,
      MOGPLEX_BASE_BRANCH: input.baseBranch,
      MOGPLEX_WORKING_BRANCH: initialWorkingBranch,
      MOGPLEX_CREATE_BRANCH:
        input.workingBranch === input.baseBranch ? "1" : "0",
      MOGPLEX_FALLBACK_BRANCH: fallbackBranch,
    },
  });
  if (result.exitCode !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `Could not synchronize ${initialWorkingBranch} before the agent run${detail.trim() ? `: ${detail.trim()}` : ""}. Resolve the branch in Terminal or start a new sandbox, then retry.`
    );
  }

  const workingBranch =
    result.stdout
      .split("\n")
      .find((line) => line.startsWith(SYNCED_BRANCH_MARKER))
      ?.slice(SYNCED_BRANCH_MARKER.length)
      .trim() || initialWorkingBranch;

  return {
    baseBranch: input.baseBranch,
    workingBranch,
    createdBranch: workingBranch !== input.workingBranch,
  };
}

function pullRequestTitle(prompt: string) {
  const firstLine = prompt.split("\n", 1)[0]?.replace(/\s+/g, " ").trim();
  if (!firstLine) return "Mogplex agent changes";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export async function publishHarnessPullRequest(
  sandbox: Sandbox,
  input: {
    prompt: string;
    baseBranch: string;
    workingBranch: string;
    cwd?: string;
    env?: Record<string, string>;
  }
): Promise<HarnessPullRequestDelivery> {
  const script = `
set -eu
git check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git check-ref-format --branch "$MOGPLEX_WORKING_BRANCH" >/dev/null
git fetch origin "$MOGPLEX_BASE_BRANCH"
current_branch="$(git branch --show-current)"
if [ "$current_branch" != "$MOGPLEX_WORKING_BRANCH" ]; then
  echo "Unexpected working branch: $current_branch" >&2
  exit 1
fi
changed=false
if [ -n "$(git status --porcelain)" ]; then
  tracked_runtime_files="$(git diff --name-only HEAD -- .mogplex)"
  if [ -n "$tracked_runtime_files" ]; then
    echo "Refusing to deliver tracked Mogplex runtime files:" >&2
    echo "$tracked_runtime_files" >&2
    exit 1
  fi
  untracked_files="$(git ls-files --others --exclude-standard)"
  if [ -n "$untracked_files" ]; then
    echo "Untracked files remain after the agent run; commit intended new files explicitly before delivery:" >&2
    echo "$untracked_files" >&2
    exit 1
  fi
  git diff --name-only HEAD -- . ':(exclude).mogplex' | while IFS= read -r file; do
    printf '${AUTO_COMMITTED_FILE_MARKER}%s\n' "$file"
  done
  git add -u -- . ':(exclude).mogplex'
  if ! git diff --cached --quiet; then
    git commit -m "$MOGPLEX_PR_TITLE"
    changed=true
  fi
fi
git push -u origin "$MOGPLEX_WORKING_BRANCH"
ahead="$(git rev-list --count "origin/$MOGPLEX_BASE_BRANCH"..HEAD)"
if [ "$ahead" -eq 0 ]; then
  echo "${CHANGED_MARKER}$changed"
  echo "${PULL_REQUEST_MARKER}"
  exit 0
fi
pull_request_url="$(gh pr view "$MOGPLEX_WORKING_BRANCH" --json url --jq .url 2>/dev/null || true)"
if [ -z "$pull_request_url" ]; then
  pull_request_url="$(gh pr create --base "$MOGPLEX_BASE_BRANCH" --head "$MOGPLEX_WORKING_BRANCH" --title "$MOGPLEX_PR_TITLE" --body "Created by a Mogplex agent run.")"
fi
echo "${CHANGED_MARKER}true"
echo "${PULL_REQUEST_MARKER}$pull_request_url"
`;
  const result = await runShell(sandbox, script, {
    cwd: input.cwd,
    env: {
      ...input.env,
      MOGPLEX_BASE_BRANCH: input.baseBranch,
      MOGPLEX_WORKING_BRANCH: input.workingBranch,
      MOGPLEX_PR_TITLE: pullRequestTitle(input.prompt),
    },
  });
  if (result.exitCode !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `The agent finished, but GitHub delivery failed${detail.trim() ? `: ${detail.trim()}` : ""}`
    );
  }

  const pullRequestUrl =
    result.stdout
      .split("\n")
      .find((line) => line.startsWith(PULL_REQUEST_MARKER))
      ?.slice(PULL_REQUEST_MARKER.length)
      .trim() || null;
  const changed = result.stdout.split("\n").includes(`${CHANGED_MARKER}true`);
  const autoCommittedFiles = result.stdout
    .split("\n")
    .filter((line) => line.startsWith(AUTO_COMMITTED_FILE_MARKER))
    .map((line) => line.slice(AUTO_COMMITTED_FILE_MARKER.length));

  return { pullRequestUrl, changed, autoCommittedFiles };
}
