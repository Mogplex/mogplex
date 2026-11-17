import { z } from "zod";
import { createRunDeliveryStore, type DeliveryRun } from "./store";
import { refreshRunDelivery } from "./refresh";
import { readDeliverySnapshot } from "./types";

export const RUN_DELIVERY_EVENTS: readonly string[] = [
  "check_run",
  "workflow_run",
  "status",
  "pull_request",
  "pull_request_review",
  "pull_request_review_thread",
  "pull_request_review_comment",
  "deployment_status",
];
const schema = z
  .object({
    pull_request: z
      .object({
        head: z.object({
          ref: z.string(),
          sha: z.string(),
          repo: z.object({ full_name: z.string() }).nullable().optional(),
        }),
      })
      .optional(),
    check_run: z.object({ head_sha: z.string() }).optional(),
    workflow_run: z
      .object({
        head_sha: z.string(),
        head_branch: z.string().nullable().optional(),
      })
      .optional(),
    sha: z.string().optional(),
    deployment: z
      .object({ sha: z.string(), ref: z.string().optional() })
      .optional(),
  })
  .passthrough();
const defaults = {
  list: createRunDeliveryStore().listForRepos,
  refresh: refreshRunDelivery,
};

export function deliveryEventMatchesRun(
  run: DeliveryRun,
  body: z.infer<typeof schema>
) {
  const snapshot = readDeliverySnapshot(run.metadata);
  const pull = body.pull_request;
  if (pull)
    return (
      pull.head.ref === run.working_branch &&
      pull.head.repo?.full_name.toLowerCase() ===
        run.repo_full_name.toLowerCase()
    );
  const sha =
    body.check_run?.head_sha ??
    body.workflow_run?.head_sha ??
    body.deployment?.sha ??
    body.sha;
  if (
    sha &&
    (sha === snapshot?.pullRequest?.headSha ||
      sha === snapshot?.pullRequest?.mergeSha)
  )
    return true;
  if (body.workflow_run?.head_branch === run.working_branch) return true;
  // A production deployment can precede the merge event. Refresh base-branch
  // candidates, then require exact merge-SHA proof in the GitHub reader.
  return body.deployment?.ref === run.base_branch;
}

/** Only call after signature verification and repository/installation resolution. */
export async function refreshDeliveryForGithubEvent(
  input: {
    event: string | null;
    body: unknown;
    repos: { id: string; user_id: string; full_name?: string | null }[];
  },
  deps = defaults
) {
  if (!RUN_DELIVERY_EVENTS.includes(input.event ?? "")) return;
  const parsed = schema.safeParse(input.body);
  if (!parsed.success) return;
  const runs = await deps.list(input.repos.map((repo) => repo.id));
  const matches = runs.filter(
    (run) =>
      input.repos.some(
        (repo) =>
          repo.id === run.repo_id &&
          repo.full_name?.toLowerCase() === run.repo_full_name.toLowerCase()
      ) && deliveryEventMatchesRun(run, parsed.data)
  );
  const results = await Promise.allSettled(
    matches.map((run) => deps.refresh(run, true))
  );
  // Native webhook task retries are durable; already queued repairs deduplicate.
  if (results.some((result) => result.status === "rejected"))
    throw new Error("Could not refresh run delivery");
}
