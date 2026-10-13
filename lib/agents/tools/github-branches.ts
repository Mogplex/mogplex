import { z } from "zod";
import {
  deferTeamAuditEvent,
  recordTeamAuditEvent,
  type RecordTeamAuditEventInput,
  type TeamAuditWriteResult,
} from "@/lib/team-audit";
import { defineTool, encodeGitHubPath } from "./shared";
import {
  findInstallationToken,
  normalizeLogin,
  normalizeRepoName,
} from "./github-shared";
import { loadBranchInventoryPage } from "./github-branch-status";

const GITHUB_API_ORIGIN = "https://api.github.com";
const DELETE_CONCURRENCY = 4;
// Mirrors `git check-ref-format --branch`: no whitespace, control or special
// characters, no "..", "@{", "//", leading "-" or "/", or trailing "/", "." or ".lock".
const INVALID_BRANCH_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000- \u007F~^:?*[\\]|\.\.|@\{|\/\/|^[-/]|\/$|\.$|\.lock$|^@$/;

export type GithubBranchToolOptions = {
  userId?: string | null;
  /** Team scope; branch deletions in a team land in its audit log. */
  teamId?: string | null;
  /** The agent turn, so an audit row joins to its run. */
  aiCallId?: string | null;
  /** The external event (e.g. Slack) that started the turn, if any. */
  requestId?: string | null;
  /** The workspace repo, used when the caller omits owner and repo. */
  defaultRepo?: { owner?: string; repo?: string };
  recordAuditEvent?: (
    input: RecordTeamAuditEventInput
  ) => Promise<TeamAuditWriteResult>;
};

const repoTargetParams = {
  owner: z
    .string()
    .optional()
    .describe(
      "GitHub organization or user login. Defaults to the current workspace repository."
    ),
  repo: z
    .string()
    .optional()
    .describe(
      "Repository name under the owner. Defaults to the current workspace repository."
    ),
};

const listParams = z
  .object({
    ...repoTargetParams,
    cursor: z
      .string()
      .optional()
      .describe("nextCursor from the previous page, to list more branches."),
  })
  .strict();

const branchName = z.string().trim().min(1).max(255);

const deleteParams = z
  .object({
    ...repoTargetParams,
    branches: z
      .array(branchName)
      .min(1)
      .describe("Branch names to delete, without the refs/heads/ prefix."),
  })
  .strict();

const createParams = z
  .object({
    ...repoTargetParams,
    branch: branchName.describe("Name of the branch to create."),
    from: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe(
        "Commit SHA, branch, or tag to start from. Use the SHA a deletion returned to restore that branch. Defaults to the default branch."
      ),
  })
  .strict();

function githubHeaders(githubToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mogplex-agent",
  };
}

function repoUrl(owner: string, repo: string, suffix = "") {
  return new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`,
    GITHUB_API_ORIGIN
  );
}

export function isValidBranchName(name: string) {
  return !INVALID_BRANCH_RE.test(name);
}

type BranchContext = {
  owner: string;
  repo: string;
  githubToken: string;
  defaultBranch: string;
};

/**
 * Resolve the target repository and prove the user's GitHub App installation
 * covers it. An org-wide installation can still exclude a repository, so the
 * repository read is the access check.
 */
async function resolveBranchContext(
  input: { owner?: string; repo?: string },
  options: GithubBranchToolOptions
): Promise<BranchContext | { error: string }> {
  const owner = normalizeLogin(
    input.owner ?? options.defaultRepo?.owner,
    "owner"
  );
  if ("error" in owner) return owner;
  const repo = normalizeRepoName(input.repo ?? options.defaultRepo?.repo);
  if ("error" in repo) return repo;
  if (!owner.value || !repo.value) {
    return {
      error:
        "No repository is in context. Ask which repository (owner/repo) to use.",
    };
  }
  if (!options.userId) {
    return {
      error:
        "GitHub branch access is unavailable because the current user is not authenticated.",
    };
  }
  let githubToken: string | null;
  try {
    githubToken = await findInstallationToken({
      userId: options.userId,
      owner: owner.value,
    });
  } catch (error) {
    console.error("[github-branches] installation lookup failed", error);
    return {
      error:
        "GitHub branch access is temporarily unavailable because Mogplex could not load its GitHub connection. Retry in a moment.",
    };
  }
  const label = `${owner.value}/${repo.value}`;
  if (!githubToken) {
    return {
      error: `GitHub branch access is unavailable for ${label}. Install the Mogplex GitHub App on ${owner.value}, then retry.`,
    };
  }
  const response = await fetch(repoUrl(owner.value, repo.value), {
    headers: githubHeaders(githubToken),
  });
  const body = (await response.json().catch(() => ({}))) as {
    default_branch?: string;
    message?: string;
  };
  if (!response.ok || !body.default_branch) {
    return {
      error:
        response.status === 404
          ? `The Mogplex GitHub App cannot access ${label}. Add the repository to the installation, then retry.`
          : body.message ||
            `GitHub could not load ${label} (${response.status}).`,
    };
  }
  return {
    owner: owner.value,
    repo: repo.value,
    githubToken,
    defaultBranch: body.default_branch,
  };
}

export type BranchDeleteResult =
  | { branch: string; status: "deleted"; sha: string }
  | { branch: string; status: "not_found" }
  | { branch: string; status: "skipped"; reason: string; sha?: string };

async function deleteOneBranch(
  context: BranchContext,
  branch: string
): Promise<BranchDeleteResult> {
  if (!isValidBranchName(branch)) {
    return { branch, status: "skipped", reason: "invalid branch name" };
  }
  if (branch === context.defaultBranch) {
    return { branch, status: "skipped", reason: "default branch" };
  }
  const headers = githubHeaders(context.githubToken);
  const encoded = encodeGitHubPath(branch);
  const branchResponse = await fetch(
    repoUrl(context.owner, context.repo, `/branches/${encoded}`),
    { headers }
  );
  if (branchResponse.status === 404) return { branch, status: "not_found" };
  const current = (await branchResponse.json().catch(() => ({}))) as {
    protected?: boolean;
    commit?: { sha?: string };
    message?: string;
  };
  const sha = current.commit?.sha;
  if (!branchResponse.ok || !sha) {
    return {
      branch,
      status: "skipped",
      reason:
        current.message ||
        `GitHub could not read the branch (${branchResponse.status})`,
    };
  }
  if (current.protected) {
    return { branch, status: "skipped", reason: "protected branch", sha };
  }

  const pullsUrl = repoUrl(context.owner, context.repo, "/pulls");
  pullsUrl.searchParams.set("state", "open");
  pullsUrl.searchParams.set("head", `${context.owner}:${branch}`);
  pullsUrl.searchParams.set("per_page", "1");
  const pullsResponse = await fetch(pullsUrl, { headers });
  const openPulls = (await pullsResponse.json().catch(() => null)) as Array<{
    number?: number;
  }> | null;
  if (!pullsResponse.ok || !Array.isArray(openPulls)) {
    return {
      branch,
      status: "skipped",
      reason: `GitHub could not check for open pull requests (${pullsResponse.status})`,
      sha,
    };
  }
  if (openPulls.length > 0) {
    return {
      branch,
      status: "skipped",
      reason: `open pull request #${openPulls[0]?.number}; deleting the branch would close it`,
      sha,
    };
  }

  const deleteResponse = await fetch(
    repoUrl(context.owner, context.repo, `/git/refs/heads/${encoded}`),
    { method: "DELETE", headers }
  );
  if (deleteResponse.status === 204) return { branch, status: "deleted", sha };
  if (deleteResponse.status === 422 || deleteResponse.status === 404) {
    return { branch, status: "not_found" };
  }
  const failure = (await deleteResponse.json().catch(() => ({}))) as {
    message?: string;
  };
  return {
    branch,
    status: "skipped",
    reason:
      failure.message ||
      `GitHub refused the deletion (${deleteResponse.status})`,
    sha,
  };
}

async function deleteBranches(context: BranchContext, branches: string[]) {
  const unique = [...new Set(branches)];
  const results: BranchDeleteResult[] = Array.from({ length: unique.length });
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const index = next++;
      const branch = unique[index] as string;
      try {
        results[index] = await deleteOneBranch(context, branch);
      } catch (error) {
        results[index] = {
          branch,
          status: "skipped",
          reason: error instanceof Error ? error.message : "request failed",
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DELETE_CONCURRENCY, unique.length) }, worker)
  );
  return results;
}

function auditDeletions(
  options: GithubBranchToolOptions,
  context: BranchContext,
  deleted: Array<{ branch: string; sha: string }>
) {
  if (!options.teamId || deleted.length === 0) return;
  deferTeamAuditEvent(options.recordAuditEvent ?? recordTeamAuditEvent, {
    productTeamId: options.teamId,
    actorUserId: options.userId ?? null,
    action: "github.branch.delete",
    decisionCode: "deleted",
    targetType: "github_repository",
    targetId: `${context.owner}/${context.repo}`,
    correlations: {
      aiCallId: options.aiCallId ?? null,
      requestId: options.requestId ?? null,
    },
    payload: { branches: deleted },
  });
}

/** Read-only branch inventory with a per-branch safe-to-delete verdict. */
export function createGithubBranchListTool(
  options: GithubBranchToolOptions = {}
) {
  return defineTool({
    description:
      "List a repository's branches and classify each one for cleanup: merged (all commits already on the default branch), squash_merged (its pull request merged at the branch's current commit), open_pull_request, closed_unmerged, unmerged, or default. safeToDelete is true only for merged and squash_merged branches that are not protected. Results are paged; when nextCursor is set, call again with it as cursor to cover every branch. Use this before pruning branches, then pass the chosen names to github_delete_branches.",
    inputSchema: listParams,
    execute: async (input: z.infer<typeof listParams>) => {
      const context = await resolveBranchContext(input, options);
      if ("error" in context) return { error: context.error };
      const page = await loadBranchInventoryPage({
        ...context,
        cursor: input.cursor,
      });
      if ("error" in page) return { error: page.error };
      const counts: Record<string, number> = {};
      for (const branch of page.branches) {
        counts[branch.status] = (counts[branch.status] ?? 0) + 1;
      }
      return {
        ok: true,
        repo: `${context.owner}/${context.repo}`,
        ...page,
        counts,
        safeToDelete: page.branches
          .filter((branch) => branch.safeToDelete)
          .map((branch) => branch.name),
      };
    },
  });
}

/** Delete branches on GitHub, refusing the default, protected, and open-PR branches. */
export function createGithubBranchDeleteTool(
  options: GithubBranchToolOptions = {}
) {
  return defineTool({
    description:
      "Delete branches from a GitHub repository covered by the current user's Mogplex GitHub App installation. Refuses the default branch, protected branches, and branches with an open pull request. Branches that no longer exist report not_found. Each deletion returns the branch's last commit SHA; github_create_branch with that SHA restores it. When the user asks to prune or clean up branches, delete branches github_list_branches marks safeToDelete without asking again. Delete branches that still hold unmerged work only when the user names them or confirms after seeing the list.",
    inputSchema: deleteParams,
    execute: async (input: z.infer<typeof deleteParams>) => {
      const context = await resolveBranchContext(input, options);
      if ("error" in context) return { error: context.error };
      const results = await deleteBranches(context, input.branches);
      const deleted = results.flatMap((result) =>
        result.status === "deleted"
          ? [{ branch: result.branch, sha: result.sha }]
          : []
      );
      auditDeletions(options, context, deleted);
      return {
        ok: true,
        repo: `${context.owner}/${context.repo}`,
        deleted: deleted.length,
        notFound: results.filter((result) => result.status === "not_found")
          .length,
        skipped: results.filter((result) => result.status === "skipped").length,
        results,
      };
    },
  });
}

async function resolveStartSha(
  context: BranchContext,
  from: string
): Promise<{ sha: string } | { error: string }> {
  if (/^[\da-f]{40}$/i.test(from)) return { sha: from.toLowerCase() };
  const response = await fetch(
    repoUrl(context.owner, context.repo, `/commits/${encodeGitHubPath(from)}`),
    {
      headers: {
        ...githubHeaders(context.githubToken),
        Accept: "application/vnd.github.sha",
      },
    }
  );
  const sha = (await response.text().catch(() => "")).trim();
  if (!response.ok || !/^[\da-f]{40}$/i.test(sha)) {
    return { error: `GitHub could not resolve "${from}" to a commit.` };
  }
  return { sha };
}

/** Create a branch, including restoring one deleted by github_delete_branches. */
export function createGithubBranchCreateTool(
  options: GithubBranchToolOptions = {}
) {
  return defineTool({
    description:
      "Create a branch in a GitHub repository covered by the current user's Mogplex GitHub App installation, starting from a commit SHA, branch, or tag (default: the default branch). Restore a deleted branch by passing the SHA github_delete_branches returned for it.",
    inputSchema: createParams,
    execute: async (input: z.infer<typeof createParams>) => {
      if (!isValidBranchName(input.branch)) {
        return { error: `"${input.branch}" is not a valid branch name.` };
      }
      const context = await resolveBranchContext(input, options);
      if ("error" in context) return { error: context.error };
      const start = await resolveStartSha(
        context,
        input.from ?? context.defaultBranch
      );
      if ("error" in start) return start;
      const response = await fetch(
        repoUrl(context.owner, context.repo, "/git/refs"),
        {
          method: "POST",
          headers: githubHeaders(context.githubToken),
          body: JSON.stringify({
            ref: `refs/heads/${input.branch}`,
            sha: start.sha,
          }),
        }
      );
      const created = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        return {
          error:
            response.status === 422
              ? `Branch ${input.branch} already exists or the commit is unavailable${created.message ? `: ${created.message}` : ""}.`
              : created.message ||
                `GitHub could not create the branch (${response.status}).`,
        };
      }
      return {
        ok: true,
        repo: `${context.owner}/${context.repo}`,
        branch: input.branch,
        sha: start.sha,
      };
    },
  });
}

/** The branch housekeeping tools, keyed by tool name. */
export function createGithubBranchTools(options: GithubBranchToolOptions) {
  return {
    github_list_branches: createGithubBranchListTool(options),
    github_delete_branches: createGithubBranchDeleteTool(options),
    github_create_branch: createGithubBranchCreateTool(options),
  };
}
