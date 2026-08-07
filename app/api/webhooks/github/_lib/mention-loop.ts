import {
  countRecentMentionEnqueues,
  logAutomationDispatchEvent,
} from "@/lib/automation-dispatch";
import {
  MENTION_LOOP_MAX,
  MENTION_LOOP_WINDOW_MINUTES,
  type EnqueuedWebhookJob,
  type PendingWebhookJob,
} from "./types";

type MentionLoopTarget = {
  key: string;
  repoId: string;
  issueNumber: number;
};

/**
 * The (repo, issue) a mention job loops on, or null when the job is not a
 * capped mention. Single source of truth for which jobs count toward
 * MENTION_LOOP_MAX, so the in-batch sibling count and the DB snapshot agree.
 */
function mentionLoopTarget(job: PendingWebhookJob): MentionLoopTarget | null {
  if (job.scope.sourceType !== "mention" || !job.scope.repoId) return null;
  const issueNumber = Number(
    (job.metadata as { issue_number?: unknown })?.issue_number
  );
  if (!Number.isInteger(issueNumber)) return null;
  return {
    key: `${job.scope.repoId}#${issueNumber}`,
    repoId: job.scope.repoId,
    issueNumber,
  };
}

/**
 * For each job in a batch, how many earlier jobs in the same batch share its
 * mention-loop key. Lets a single fan-out delivery count its own siblings
 * toward MENTION_LOOP_MAX instead of each job racing the same pre-batch count.
 */
export function countInBatchMentionSiblings(
  jobs: PendingWebhookJob[]
): number[] {
  const seen = new Map<string, number>();
  return jobs.map((job) => {
    const key = mentionLoopTarget(job)?.key;
    if (!key) return 0;
    const prior = seen.get(key) ?? 0;
    seen.set(key, prior + 1);
    return prior;
  });
}

/**
 * Decide, for every job in a single webhook delivery, whether the mention
 * loop-breaker should suppress it. Returns a parallel boolean array.
 *
 * The recent-enqueue count is snapshotted ONCE per loop key BEFORE any job in
 * the batch enqueues. Counting per-job during the batch would race the batch's
 * own INSERTs - a later sibling's SELECT could already observe an earlier
 * sibling's queued row, then double-count it against the in-batch tally and
 * suppress a job the cap should allow. Snapshotting up front makes
 * `snapshot + in-batch siblings` exact for the delivery.
 *
 * Fails open per key (treats it as not tripped) when the count query errors, so
 * a transient DB issue never blocks a legitimate mention.
 */
export async function evaluateMentionLoopBreaker(
  jobs: PendingWebhookJob[],
  countMentions: typeof countRecentMentionEnqueues = countRecentMentionEnqueues
): Promise<boolean[]> {
  const siblings = countInBatchMentionSiblings(jobs);

  const firstTargetByKey = new Map<string, MentionLoopTarget>();
  for (const job of jobs) {
    const target = mentionLoopTarget(job);
    if (target && !firstTargetByKey.has(target.key)) {
      firstTargetByKey.set(target.key, target);
    }
  }

  const snapshot = new Map<string, number>();
  await Promise.all(
    [...firstTargetByKey.values()].map(async (target) => {
      try {
        snapshot.set(
          target.key,
          await countMentions({
            repoId: target.repoId,
            issueNumber: target.issueNumber,
            sinceMinutes: MENTION_LOOP_WINDOW_MINUTES,
          })
        );
      } catch (error) {
        // Fail open: leave the key unset so its jobs are never suppressed.
        console.error("Mention loop-breaker count failed:", error);
      }
    })
  );

  return jobs.map((job, index) => {
    const key = mentionLoopTarget(job)?.key;
    if (!key) return false;
    const recent = snapshot.get(key);
    if (recent === undefined) return false;
    return recent + siblings[index] >= MENTION_LOOP_MAX;
  });
}

export async function suppressMentionLoopJob(
  job: PendingWebhookJob
): Promise<EnqueuedWebhookJob> {
  await logAutomationDispatchEvent({
    userId: job.userId,
    flowId: job.flow_id ?? null,
    flowVersionId: job.flow_version_id ?? null,
    repoId: job.scope.repoId,
    installationId: job.scope.installationId,
    sourceKind: job.scope.sourceKind,
    sourceType: job.scope.sourceType,
    eventKind: "enqueue",
    outcome: "suppressed",
    reason: "MENTION_LOOP_BREAKER",
    metadata: job.metadata,
  }).catch((error) => {
    console.error("Failed to log MENTION_LOOP_BREAKER suppression:", error);
  });

  return {
    jobRunId: null,
    outcome: "suppressed",
    reason: "MENTION_LOOP_BREAKER",
    flowId: job.flow_id ?? null,
    flowVersionId: job.flow_version_id ?? null,
    scope: job.scope,
  };
}
