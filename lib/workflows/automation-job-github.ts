/**
 * GitHub interaction helpers for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { extractGithubApiErrorMessage } from "@/lib/github-create";
import { createGithubInstallationAccessToken } from "@/lib/github-app";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  JobContext,
  PullRequestDetails,
  RepoVariant,
} from "@/lib/workflows/automation-job-types";
import {
  isRecord,
  splitRepoFullName,
  pickPreferredRepoVariant,
} from "@/lib/workflows/automation-job-utils";
import { GITHUB_PR_ACCESS_FAILURE_PREFIX } from "@/lib/workflows/automation-job-types";

export function classifyGithubAppTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("installation")
  ) {
    return {
      code: "GITHUB_APP_INSTALLATION_UNAVAILABLE",
      message,
    };
  }

  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("forbidden") ||
    lower.includes("denied")
  ) {
    return {
      code: "GITHUB_APP_TOKEN_FORBIDDEN",
      message,
    };
  }

  return {
    code: "GITHUB_APP_TOKEN_FAILED",
    message,
  };
}

export async function noteGithubTokenFallback(input: {
  jobRunId?: string | null;
  kind: "primary" | "autofix";
  repo: JobContext["repo"];
  resolution: "fallback_user_token" | "skip_autofix";
  reasonCode: string;
  reasonMessage: string;
}) {
  if (!input.jobRunId) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("metadata")
    .eq("id", input.jobRunId)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      "[automation-job] failed to load job metadata for github token fallback note",
      {
        jobRunId: input.jobRunId,
        repoId: input.repo.id,
        reasonCode: input.reasonCode,
        error: error?.message ?? "missing job run",
      }
    );
    return;
  }

  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const existingNotes = Array.isArray(metadata.github_token_fallbacks)
    ? metadata.github_token_fallbacks
    : [];

  const { error: updateError } = await supabaseAdmin
    .from("job_runs")
    .update({
      metadata: {
        ...metadata,
        github_token_fallbacks: [
          ...existingNotes.slice(-4),
          {
            kind: input.kind,
            resolution: input.resolution,
            reason_code: input.reasonCode,
            reason_message: input.reasonMessage,
            repo_id: input.repo.id,
            repo_full_name: input.repo.full_name,
            at: new Date().toISOString(),
          },
        ],
      },
    })
    .eq("id", input.jobRunId);

  if (updateError) {
    console.warn(
      "[automation-job] failed to persist github token fallback note",
      {
        jobRunId: input.jobRunId,
        repoId: input.repo.id,
        reasonCode: input.reasonCode,
        error: updateError.message,
      }
    );
  }
}

export async function loadPullRequestDetails(input: {
  repoFullName: string;
  prNumber: number;
  githubToken: string;
  fallbackHeadRef?: string | null;
  fallbackHeadSha?: string | null;
  fallbackHeadRepoFullName?: string | null;
  fallbackBaseRef?: string | null;
  fallbackBaseSha?: string | null;
  fallbackBaseRepoFullName?: string | null;
}): Promise<PullRequestDetails | null> {
  "use step";

  const [owner, repo] = input.repoFullName.split("/");
  if (!owner || !repo) return null;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${input.prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${input.githubToken}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!res.ok) {
    if (!input.fallbackHeadRef || !input.fallbackBaseRef) return null;
    return {
      number: input.prNumber,
      title: null,
      body: null,
      headRef: input.fallbackHeadRef,
      headSha: input.fallbackHeadSha ?? null,
      headRepoFullName: input.fallbackHeadRepoFullName ?? input.repoFullName,
      baseRef: input.fallbackBaseRef,
      baseSha: input.fallbackBaseSha ?? null,
      baseRepoFullName: input.fallbackBaseRepoFullName ?? input.repoFullName,
    };
  }

  const data = (await res.json()) as {
    number: number;
    title?: string | null;
    body?: string | null;
    head?: { ref?: string; sha?: string; repo?: { full_name?: string | null } };
    base?: { ref?: string; sha?: string; repo?: { full_name?: string | null } };
  };

  const headRef = data.head?.ref ?? input.fallbackHeadRef ?? null;
  const baseRef = data.base?.ref ?? input.fallbackBaseRef ?? null;
  const headRepoFullName =
    data.head?.repo?.full_name ??
    input.fallbackHeadRepoFullName ??
    input.repoFullName;
  const baseRepoFullName =
    data.base?.repo?.full_name ??
    input.fallbackBaseRepoFullName ??
    input.repoFullName;

  if (!headRef || !baseRef || !headRepoFullName || !baseRepoFullName)
    return null;

  return {
    number: data.number,
    title: data.title ?? null,
    body: data.body ?? null,
    headRef,
    headSha: data.head?.sha ?? input.fallbackHeadSha ?? null,
    headRepoFullName,
    baseRef,
    baseSha: data.base?.sha ?? input.fallbackBaseSha ?? null,
    baseRepoFullName,
  };
}

function buildGithubPrAccessFailureMessage(input: {
  repoFullName: string;
  prNumber: number;
  status: number;
  body: string;
}) {
  const repoParts = splitRepoFullName(input.repoFullName);
  const ownerHint = repoParts?.owner
    ? `the "${repoParts.owner}" org or personal account`
    : "the repo owner";
  const detail = extractGithubApiErrorMessage(input.body);
  const detailLabel = detail
    ? `GitHub responded with ${input.status}: ${detail}.`
    : `GitHub responded with ${input.status}.`;

  return [
    `${GITHUB_PR_ACCESS_FAILURE_PREFIX} for ${input.repoFullName}#${input.prNumber}.`,
    detailLabel,
    `Open Settings > GitHub App coverage and add ${ownerHint}, then rerun the review.`,
  ].join(" ");
}

export async function assertPullRequestGithubAccess(input: {
  repoFullName: string;
  prNumber: number;
  githubToken: string;
}) {
  const repoParts = splitRepoFullName(input.repoFullName);
  if (!repoParts) return;

  const response = await fetch(
    `https://api.github.com/repos/${repoParts.owner}/${repoParts.repo}/pulls/${input.prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${input.githubToken}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    }
  );

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    throw new Error(
      buildGithubPrAccessFailureMessage({
        repoFullName: input.repoFullName,
        prNumber: input.prNumber,
        status: response.status,
        body,
      })
    );
  }

  const detail = extractGithubApiErrorMessage(body) || "Unknown GitHub error";
  throw new Error(
    `GitHub PR lookup failed (${response.status}) for ${input.repoFullName}#${input.prNumber}: ${detail}`
  );
}

export async function resolveAutofixTargetRepo(input: {
  contextRepo: JobContext["repo"];
  headRepoFullName: string;
}): Promise<JobContext["repo"] | null> {
  "use step";

  if (input.headRepoFullName === input.contextRepo.full_name) {
    return input.contextRepo;
  }

  const { data, error } = await supabaseAdmin
    .from("repos")
    .select(
      "id, user_id, full_name, default_branch, github_installation_id, root_directory, parent_repo_id"
    )
    .eq("user_id", input.contextRepo.user_id)
    .eq("full_name", input.headRepoFullName);

  if (error) {
    throw new Error(`Failed to resolve autofix target repo: ${error.message}`);
  }

  const preferred = pickPreferredRepoVariant((data || []) as RepoVariant[]);
  if (!preferred) return null;

  return {
    id: preferred.id,
    user_id: preferred.user_id,
    full_name: preferred.full_name,
    default_branch: preferred.default_branch ?? null,
    github_installation_id: preferred.github_installation_id ?? null,
  };
}

export async function resolveAutofixGithubToken(
  repo: JobContext["repo"],
  options?: { jobRunId?: string | null }
) {
  "use step";

  if (!repo.github_installation_id) return null;

  try {
    const { token } = await createGithubInstallationAccessToken(
      repo.github_installation_id
    );
    return token;
  } catch (error) {
    const reason = classifyGithubAppTokenError(error);
    console.warn("[automation-job] autofix github token unavailable", {
      repoId: repo.id,
      repoFullName: repo.full_name,
      githubInstallationId: repo.github_installation_id,
      reasonCode: reason.code,
      error: reason.message,
    });
    await noteGithubTokenFallback({
      jobRunId: options?.jobRunId ?? null,
      kind: "autofix",
      repo,
      resolution: "skip_autofix",
      reasonCode: reason.code,
      reasonMessage: reason.message,
    });
    return null;
  }
}

export async function resolveGithubToken(
  repo: JobContext["repo"],
  options?: { jobRunId?: string | null }
) {
  "use step";

  let githubToken: string | null = null;

  if (repo.github_installation_id) {
    try {
      const { token } = await createGithubInstallationAccessToken(
        repo.github_installation_id
      );
      githubToken = token;
    } catch (error) {
      const reason = classifyGithubAppTokenError(error);
      console.warn("[automation-job] falling back to user github token", {
        repoId: repo.id,
        repoFullName: repo.full_name,
        githubInstallationId: repo.github_installation_id,
        reasonCode: reason.code,
        error: reason.message,
      });
      await noteGithubTokenFallback({
        jobRunId: options?.jobRunId ?? null,
        kind: "primary",
        repo,
        resolution: "fallback_user_token",
        reasonCode: reason.code,
        reasonMessage: reason.message,
      });
    }
  }

  if (!githubToken) {
    githubToken = await getGithubAccessTokenForRepo(repo);
  }

  return githubToken;
}
