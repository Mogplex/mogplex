import { findInstallationToken } from "@/lib/agents/tools/github-shared";
import { githubHeaders } from "@/lib/github-merge";

export type SlackPullRequestBranch =
  | { ok: true; headRef: string; baseRef: string }
  | { ok: false; error: string };

type PullRequestRefs = {
  state?: string;
  head?: { ref?: string; repo?: { full_name?: string } | null };
  base?: { ref?: string; repo?: { full_name?: string } | null };
};

/**
 * The branch a run continues when it updates an existing pull request. Only
 * an open pull request whose head lives in the same repository qualifies:
 * a run pushes to its working branch, and a fork's branch is not ours to push.
 */
export async function loadSlackPullRequestBranch(
  input: {
    mogplexUserId: string;
    owner: string;
    repo: string;
    number: number;
  },
  deps: {
    findToken?: typeof findInstallationToken;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<SlackPullRequestBranch> {
  const label = `${input.owner}/${input.repo}#${input.number}`;
  const token = await (deps.findToken ?? findInstallationToken)({
    userId: input.mogplexUserId,
    owner: input.owner,
  }).catch(() => null);
  if (!token) {
    return {
      ok: false,
      error: `GitHub access to ${input.owner}/${input.repo} is unavailable, so pull request #${input.number} can't be continued. Ask the user to reconnect GitHub.`,
    };
  }
  const res = await (deps.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.number}`,
    { headers: githubHeaders(token) }
  ).catch(() => null);
  if (!res?.ok) {
    return {
      ok: false,
      error:
        res?.status === 404
          ? `Pull request ${label} was not found.`
          : `GitHub could not load pull request ${label}. Try again.`,
    };
  }
  const pr = (await res.json().catch(() => null)) as PullRequestRefs | null;
  const headRef = pr?.head?.ref?.trim();
  const baseRef = pr?.base?.ref?.trim();
  if (pr?.state !== "open" || !headRef || !baseRef) {
    return { ok: false, error: `Pull request ${label} is not open.` };
  }
  const headRepo = pr.head?.repo?.full_name?.toLowerCase();
  const baseRepo = pr.base?.repo?.full_name?.toLowerCase();
  if (!headRepo || headRepo !== baseRepo) {
    return {
      ok: false,
      error: `Pull request ${label} comes from a fork, so a run can't push to its branch. Start a new run instead.`,
    };
  }
  return { ok: true, headRef, baseRef };
}
