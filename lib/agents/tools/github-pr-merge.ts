import { z } from "zod";
import { mergePullRequestIfSafe } from "@/lib/github-merge";
import { defineTool } from "./shared";
import {
  findInstallationToken,
  normalizeLogin,
  normalizeRepoName,
} from "./github-shared";

export type GithubPullRequestMergeAuthorization = {
  owner: string;
  repo: string;
  number: number;
};

type GithubPullRequestMergeOptions = {
  userId?: string | null;
  authorization?: GithubPullRequestMergeAuthorization | null;
};

function isExplicitMergeInstruction(text: string) {
  if (/\b(?:do not|don't|dont|never)\b.{0,40}\bmerge\b/i.test(text)) {
    return false;
  }
  return (
    /(?:^|[.!?]\s*|\bplease\s+|\bthen\s+|\bnow\s+)(?:squash[- ]?)?merge\b/i.test(
      text
    ) ||
    /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:squash[- ]?)?merge\b/i.test(
      text
    ) ||
    /\bi\s+(?:want|need)\s+you\s+to\s+(?:squash[- ]?)?merge\b/i.test(text)
  );
}

function parseExplicitMergeTarget(
  text: string,
  context: { repoOwner?: string | null; repoName?: string | null }
): GithubPullRequestMergeAuthorization | null {
  const githubUrl = text.match(
    /github\.com\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\/pull\/(\d+)/i
  );
  if (githubUrl) {
    return {
      owner: githubUrl[1],
      repo: githubUrl[2].replace(/\.git$/i, ""),
      number: Number(githubUrl[3]),
    };
  }

  const shorthand = text.match(
    /\b([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+?)#(\d+)\b/i
  );
  if (shorthand) {
    return {
      owner: shorthand[1],
      repo: shorthand[2].replace(/\.git$/i, ""),
      number: Number(shorthand[3]),
    };
  }

  const repository = text.match(
    /\b([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\b/i
  );
  const pullRequest = text.match(/\b(?:pr|pull request)\s*#?\s*(\d+)\b/i);
  if (repository && pullRequest) {
    return {
      owner: repository[1],
      repo: repository[2].replace(/\.git$/i, ""),
      number: Number(pullRequest[1]),
    };
  }

  const contextualPullRequest = text.match(/(?:\bpr\s*#?\s*|#)(\d+)\b/i);
  if (context.repoOwner && context.repoName && contextualPullRequest) {
    return {
      owner: context.repoOwner,
      repo: context.repoName,
      number: Number(contextualPullRequest[1]),
    };
  }
  return null;
}

/**
 * Derive a narrow mutation grant from the current user-authored request. The
 * model cannot create or widen this authorization, and prior assistant/tool
 * content is deliberately excluded from the decision.
 */
export function deriveGithubPullRequestMergeAuthorization(input: {
  userText?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
}): GithubPullRequestMergeAuthorization | null {
  const text = input.userText?.trim() ?? "";
  if (!text || !isExplicitMergeInstruction(text)) return null;
  return parseExplicitMergeTarget(text, input);
}

function isAuthorizedMergeTarget(
  authorization: GithubPullRequestMergeAuthorization | null | undefined,
  target: { owner: string; repo: string },
  number: number
) {
  return (
    authorization?.owner.toLowerCase() === target.owner.toLowerCase() &&
    authorization.repo.toLowerCase() === target.repo.toLowerCase() &&
    authorization.number === number
  );
}

const githubPullRequestMergeParams = z
  .object({
    owner: z
      .string()
      .describe("GitHub organization or user login, e.g. 'acme'."),
    repo: z
      .string()
      .describe("Repository name under the owner, e.g. 'widgets'."),
    number: z.number().int().positive().describe("Pull request number."),
    expectedHeadSha: z
      .string()
      .regex(/^[a-f\d]{40}$/i)
      .describe("Exact reviewed 40-character pull request head SHA."),
    commitTitle: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

function normalizePullRequestTarget(input: { owner: string; repo: string }) {
  const owner = normalizeLogin(input.owner, "owner");
  if ("error" in owner) return owner;
  const repo = normalizeRepoName(input.repo);
  if ("error" in repo) return repo;
  if (!owner.value || !repo.value) {
    return { error: "owner and repo are required." };
  }
  return { owner: owner.value, repo: repo.value };
}

export function createGithubPullRequestMergeTool(
  options: GithubPullRequestMergeOptions = {}
) {
  return defineTool({
    description:
      "Safely squash-merge a GitHub pull request in a repository covered by the current user's GitHub connection. Requires the exact reviewed head SHA. GitHub branch protection is enforced; pending protected checks enable native auto-merge instead of bypassing safeguards.",
    inputSchema: githubPullRequestMergeParams,
    execute: async ({
      owner,
      repo,
      number,
      expectedHeadSha,
      commitTitle,
    }: z.infer<typeof githubPullRequestMergeParams>) => {
      const target = normalizePullRequestTarget({ owner, repo });
      if ("error" in target) return { error: target.error };
      if (!options.userId) {
        return {
          error:
            "GitHub pull request merging is unavailable because the current user is not authenticated.",
        };
      }
      if (!isAuthorizedMergeTarget(options.authorization, target, number)) {
        return {
          error:
            "This pull request merge was not explicitly authorized by the current user request. Ask the user to name the repository and pull request number in a merge instruction.",
        };
      }
      let githubToken: string | null;
      try {
        githubToken = await findInstallationToken({
          userId: options.userId,
          owner: target.owner,
        });
      } catch {
        return {
          error:
            "GitHub pull request merging is temporarily unavailable. Check the repository connection, then retry.",
        };
      }
      if (!githubToken) {
        return {
          error: `GitHub pull request merging is unavailable for ${target.owner}/${target.repo}. Connect that repository with pull request write access, then retry.`,
        };
      }

      try {
        const outcome = await mergePullRequestIfSafe({
          githubToken,
          owner: target.owner,
          repo: target.repo,
          prNumber: number,
          expectedHeadSha,
          commitTitle,
        });
        const ok = outcome.merged || outcome.queued === true;
        return {
          ok,
          repo: `${target.owner}/${target.repo}`,
          pullRequestNumber: number,
          merged: outcome.merged,
          queued: outcome.queued === true,
          reason: outcome.reason,
          sha: outcome.sha ?? null,
        };
      } catch (error) {
        return {
          ok: false,
          repo: `${target.owner}/${target.repo}`,
          pullRequestNumber: number,
          merged: false,
          queued: false,
          error:
            error instanceof Error
              ? error.message
              : "GitHub pull request merge failed.",
        };
      }
    },
  });
}
