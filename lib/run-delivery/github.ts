import { z } from "zod";
import { createHash } from "node:crypto";
import { findInstallationToken } from "@/lib/agents/tools/github-shared";
import { loadPullRequestStatus } from "@/lib/agents/tools/github-pr-status";
import type { DeliverySnapshot } from "./types";

const pullSchema = z.object({
  draft: z.boolean().default(false),
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  merged_at: z.string().nullable(),
  merge_commit_sha: z.string().nullable(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  base: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }),
  }),
});
const depsDefault = {
  getToken: findInstallationToken,
  request: fetch,
  loadStatus: loadPullRequestStatus,
};
export type DeliveryGithubDeps = typeof depsDefault;
export type DeliveryGithubInput = {
  userId: string;
  repoFullName: string;
  workingBranch: string;
  baseBranch: string;
};

function blankSnapshot(): DeliverySnapshot {
  return {
    observedAt: new Date().toISOString(),
    repairRevision: "none",
    pullRequest: null,
    checks: {
      state: "unknown",
      failed: [],
      pending: 0,
      total: 0,
      incomplete: false,
    },
    review: { state: "unknown", unresolved: 0, incomplete: false },
    deployment: { state: "not_reported", environment: null, url: null },
  };
}

/** Reads the exact branch and commit. A webhook is a wake-up, never status evidence. */
export async function loadRunDeliveryGithub(
  input: DeliveryGithubInput,
  overrides: Partial<DeliveryGithubDeps> = {}
): Promise<DeliverySnapshot> {
  const deps = { ...depsDefault, ...overrides };
  const [owner, repo, extra] = input.repoFullName.split("/");
  if (
    !owner ||
    !repo ||
    extra ||
    !/^[\w.-]+\/[\w.-]+$/.test(input.repoFullName)
  )
    throw new Error("Invalid repository");
  const snapshot = blankSnapshot();
  const token = await deps.getToken({ userId: input.userId, owner });
  if (!token) throw new Error("GitHub connection is unavailable");
  const root = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  async function read(path: string): Promise<unknown> {
    const response = await deps.request(`${root}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error("GitHub delivery status is temporarily unavailable");
    return response.json();
  }
  const query = new URLSearchParams({
    head: `${owner}:${input.workingBranch}`,
    base: input.baseBranch,
    state: "all",
    sort: "created",
    direction: "desc",
    per_page: "100",
  });
  const pulls = z.array(pullSchema).parse(await read(`/pulls?${query}`));
  const pull = pulls.find(
    (value) =>
      value.head.ref === input.workingBranch &&
      value.base.ref === input.baseBranch &&
      value.head.repo?.full_name.toLowerCase() ===
        input.repoFullName.toLowerCase() &&
      value.base.repo.full_name.toLowerCase() ===
        input.repoFullName.toLowerCase()
  );
  if (!pull) return snapshot;
  const status = await deps.loadStatus({
    target: { owner, repo },
    number: pull.number,
    githubToken: token,
  });
  if ("error" in status || status.headSha !== pull.head.sha)
    throw new Error("Pull request changed while checking delivery. Try again.");
  snapshot.pullRequest = {
    draft: pull.draft,
    number: pull.number,
    url: `https://github.com/${input.repoFullName}/pull/${pull.number}`,
    state: pull.merged_at ? "merged" : pull.state,
    headSha: pull.head.sha,
    mergeSha: pull.merged_at ? pull.merge_commit_sha : null,
  };
  snapshot.checks = {
    state:
      status.checkRollupState === "failure" ||
      status.checkRollupState === "error"
        ? "failure"
        : status.checkRollupState === "pending" ||
            status.checkRollupState === "expected"
          ? "pending"
          : status.checkRollupState === "success" && !status.checksIncomplete
            ? "success"
            : "unknown",
    failed: status.checks
      .filter((check) =>
        [
          "failure",
          "error",
          "timed_out",
          "cancelled",
          "action_required",
          "startup_failure",
        ].includes(check.conclusion ?? "")
      )
      .map((check) => check.name),
    pending: status.checks.filter(
      (check) =>
        !["completed", "success", "failure", "error"].includes(
          check.status ?? ""
        )
    ).length,
    total: status.checks.length,
    incomplete: status.checksIncomplete,
  };
  snapshot.review = {
    state:
      status.reviewDecision === "changes_requested"
        ? "changes_requested"
        : status.reviewDecision === "approved"
          ? "approved"
          : status.reviewDecision === "review_required"
            ? "required"
            : status.reviewDecision === null
              ? "none"
              : "unknown",
    unresolved: status.unresolvedReviewThreadCount,
    incomplete:
      status.reviewThreadsIncomplete || status.formalReviewsIncomplete,
  };
  snapshot.repairRevision = createHash("sha256")
    .update(
      JSON.stringify({
        head: status.headSha,
        checks: status.checks.filter((check) =>
          snapshot.checks.failed.includes(check.name)
        ),
        reviewDecision: status.reviewDecision,
        // Thread identities remain stable when the agent replies to a finding.
        // Hashing reply text would retrigger the same repair on its own output.
        threads: status.unresolvedReviewThreads
          .map(
            (thread) => thread.id ?? thread.comments[0]?.url ?? "unknown-thread"
          )
          .sort(),
        reviews: status.formalReviews.filter(
          (review) => review.state === "changes_requested"
        ),
      })
    )
    .digest("hex");
  if (snapshot.pullRequest.mergeSha) {
    try {
      snapshot.deployment = await readProductionDeployment(
        snapshot.pullRequest.mergeSha,
        read
      );
    } catch {
      snapshot.deployment = {
        state: "unavailable",
        environment: null,
        url: null,
      };
    }
  }
  return snapshot;
}

const deploymentSchema = z.object({
  id: z.number(),
  sha: z.string(),
  environment: z.string(),
  production_environment: z.boolean().optional(),
});
async function readProductionDeployment(
  sha: string,
  read: (path: string) => Promise<unknown>
): Promise<DeliverySnapshot["deployment"]> {
  for (let page = 1; ; page++) {
    const deployments = z
      .array(deploymentSchema)
      .parse(
        await read(
          `/deployments?sha=${encodeURIComponent(sha)}&per_page=100&page=${page}`
        )
      );
    const production = deployments.find(
      (deployment) =>
        deployment.sha === sha && deployment.production_environment === true
    );
    if (production) {
      const statuses = z
        .array(
          z.object({
            state: z.string(),
            environment_url: z.string().optional(),
          })
        )
        .parse(await read(`/deployments/${production.id}/statuses?per_page=1`));
      const status = statuses[0];
      const url = status?.environment_url?.startsWith("https://")
        ? status.environment_url
        : null;
      return {
        state:
          status?.state === "success"
            ? "success"
            : ["error", "failure"].includes(status?.state ?? "")
              ? "failure"
              : status?.state === "inactive"
                ? "inactive"
                : "pending",
        environment: production.environment,
        url,
      };
    }
    if (deployments.length < 100)
      return { state: "not_reported", environment: null, url: null };
  }
}
