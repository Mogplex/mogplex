import { buildInternalApiHeaders } from "@/lib/internal-api-auth";

type ChatGitDeliveryInput = {
  userId: string;
  sandboxId: string;
  baseBranch: string;
  workingBranch: string;
};

type ChatGitDeliveryDeps = {
  fetch: typeof fetch;
  buildInternalApiHeaders: typeof buildInternalApiHeaders;
};

function resolveAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildChatGitDeliveryCommand(input: {
  baseBranch: string;
  workingBranch: string;
}) {
  const baseBranch = shellQuote(input.baseBranch);
  const workingBranch = shellQuote(input.workingBranch);

  return `
MOGPLEX_BASE_BRANCH=${baseBranch}
MOGPLEX_WORKING_BRANCH=${workingBranch}
set -eu
git check-ref-format --branch "$MOGPLEX_BASE_BRANCH" >/dev/null
git check-ref-format --branch "$MOGPLEX_WORKING_BRANCH" >/dev/null
git fetch origin "$MOGPLEX_BASE_BRANCH:refs/remotes/origin/$MOGPLEX_BASE_BRANCH"
if git ls-remote --exit-code --heads origin "$MOGPLEX_WORKING_BRANCH" >/dev/null 2>&1; then
  git fetch origin "$MOGPLEX_WORKING_BRANCH:refs/remotes/origin/$MOGPLEX_WORKING_BRANCH"
  if git show-ref --verify --quiet "refs/heads/$MOGPLEX_WORKING_BRANCH"; then
    git checkout "$MOGPLEX_WORKING_BRANCH"
  else
    git checkout -b "$MOGPLEX_WORKING_BRANCH" "origin/$MOGPLEX_WORKING_BRANCH"
  fi
  git merge --ff-only "origin/$MOGPLEX_WORKING_BRANCH"
else
  if git show-ref --verify --quiet "refs/heads/$MOGPLEX_WORKING_BRANCH"; then
    git checkout "$MOGPLEX_WORKING_BRANCH"
  else
    git checkout -b "$MOGPLEX_WORKING_BRANCH" "origin/$MOGPLEX_BASE_BRANCH"
  fi
  git push -u origin "$MOGPLEX_WORKING_BRANCH"
fi
`.trim();
}

export function createChatGitDeliveryPreparer(
  overrides: Partial<ChatGitDeliveryDeps> = {}
) {
  const deps: ChatGitDeliveryDeps = {
    fetch,
    buildInternalApiHeaders,
    ...overrides,
  };

  return async function prepareChatGitDelivery(
    input: ChatGitDeliveryInput
  ): Promise<void> {
    const response = await deps.fetch(
      `${resolveAppBaseUrl()}/api/sandbox/${encodeURIComponent(input.sandboxId)}/exec`,
      {
        method: "POST",
        headers: deps.buildInternalApiHeaders(input.userId),
        body: JSON.stringify({
          command: buildChatGitDeliveryCommand(input),
        }),
      }
    );
    const body = (await response.json().catch(() => ({}))) as {
      exitCode?: number;
      stderr?: string;
      error?: string;
    };

    if (!response.ok || body.exitCode !== 0) {
      const detail = body.error || body.stderr?.trim();
      throw new Error(
        `Could not prepare ${input.workingBranch} before the agent run${detail ? `: ${detail}` : ""}. Resolve the branch in Terminal or start a new sandbox, then retry.`
      );
    }
  };
}

export const prepareChatGitDelivery = createChatGitDeliveryPreparer();
