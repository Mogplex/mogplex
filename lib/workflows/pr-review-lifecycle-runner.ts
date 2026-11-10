import type { readPrReviewTimelineComments } from "@/lib/github-check-runs";
import type {
  comparePrCommits,
  listPrConversationComments,
  listPrReviewThreads,
  replyAndResolvePrReviewThread,
} from "@/lib/github-pr-review-threads";
import type { ReviewFinding } from "@/lib/types";
import {
  loadPrReviewHistory,
  findingMarker,
  newestPrReviewState,
  serializePrReviewState,
  type PrReviewHistory,
  type PrReviewState,
  type PrReviewStateFinding,
} from "./pr-review-history";
import { buildPrReviewHistoryBlock } from "./pr-review-history-prompt";
import { createPrReviewSigner } from "./pr-review-signing";
import {
  PR_REVIEW_MAX_FINDINGS,
  assignFindingKeys,
  newFindingKey,
  planPrReviewThreads,
  type PrReviewThreadPlan,
} from "./pr-review-lifecycle";

export type PrReviewThreadsDeps = {
  readPrReviewTimelineComments: typeof readPrReviewTimelineComments;
  listPrReviewThreads: typeof listPrReviewThreads;
  comparePrCommits: typeof comparePrCommits;
  listPrConversationComments: typeof listPrConversationComments;
  replyAndResolvePrReviewThread: typeof replyAndResolvePrReviewThread;
  /** Key for the signed markers; without one the lifecycle stays off. */
  signingSecret: () => string | null;
};

const EMPTY_PLAN: PrReviewThreadPlan = {
  existingThreads: new Map(),
  resolve: [],
  resolvedFindings: [],
};

/**
 * One review run's memory of the previous review: loads it before the run,
 * plans what happens to its threads after, and writes the state the next
 * run reads. Without deps or a PR number every step is a no-op, so the
 * review behaves as a first review.
 */
export function createPrReviewLifecycle(input: {
  deps?: PrReviewThreadsDeps;
  githubToken: string;
  repoFullName: string;
  prNumber: number | null;
  headSha: string;
  now?: () => Date;
}) {
  const { githubToken, repoFullName, prNumber, headSha } = input;
  const now = input.now ?? (() => new Date());
  const secret = input.deps?.signingSecret() ?? null;
  const signer =
    secret && prNumber != null
      ? createPrReviewSigner(secret, { repoFullName, prNumber })
      : null;
  // Without a signer nothing can be written or trusted, so act as a first
  // review on every run.
  const deps = signer ? input.deps : undefined;
  let previousState: PrReviewState | null = null;
  let history: PrReviewHistory | null = null;
  let keys = new Map<ReviewFinding, string>();
  let plan = EMPTY_PLAN;
  // Earlier findings a possibly cut report left out: kept in the state, not
  // closed, so the next review still knows them.
  let carried: PrReviewStateFinding[] = [];
  let startedAt: Date | null = null;

  return {
    /** The prompt block for the previous review, or null for a first review. */
    async loadHistoryBlock(): Promise<string | null> {
      // The review time is when this run read the PR, so comments posted
      // while it runs are still new to the next review.
      startedAt = now();
      if (input.deps && !signer && prNumber != null) {
        console.warn(
          "[pr-review] no signing key (GITHUB_APP_PRIVATE_KEY); review memory is off"
        );
      }
      if (!deps || !signer || prNumber == null || headSha.length === 0)
        return null;
      const target = { githubToken, repoFullName, prNumber };
      history = await loadPrReviewHistory(headSha, {
        signer,
        readSummaryComments: async () => {
          const comments = await deps.readPrReviewTimelineComments(target);
          previousState = newestPrReviewState(comments, signer)?.state ?? null;
          return comments;
        },
        listThreads: () => deps.listPrReviewThreads(target),
        compare: (base) =>
          deps.comparePrCommits({
            githubToken,
            repoFullName,
            base,
            head: headSha,
          }),
        listConversation: (since) =>
          deps.listPrConversationComments({ ...target, since }),
      }).catch(() => null);
      return history ? buildPrReviewHistoryBlock(history) : null;
    },

    /** Key the report's findings and decide what happens to earlier threads. */
    planThreads(findings: ReviewFinding[], structured: boolean) {
      keys = assignFindingKeys(findings, history);
      const complete = structured && findings.length < PR_REVIEW_MAX_FINDINGS;
      plan = planPrReviewThreads({ history, keys, headSha, complete });
      const reported = new Set(keys.values());
      // Earlier findings this review neither reported nor closed (a cut
      // report, or files an incremental review did not read) stay known.
      const closed = new Set(plan.resolvedFindings.map((prior) => prior.key));
      carried = structured
        ? (history?.findings ?? [])
            .filter(
              (prior) => !reported.has(prior.key) && !closed.has(prior.key)
            )
            .map(({ id: _id, thread, ...prior }) => ({
              ...prior,
              // Without the thread list, keep what the state recorded.
              inline: history?.threadsLoaded
                ? thread != null && !thread.isResolved
                : prior.inline,
            }))
        : [];
      return { keys, plan };
    },

    keyOf(finding: ReviewFinding) {
      return keys.get(finding) ?? null;
    },

    /** The signed marker for a finding's inline comment, if it has a key. */
    markerFor(finding: ReviewFinding) {
      const key = keys.get(finding);
      return key && signer ? findingMarker(key, signer) : null;
    },

    get plan() {
      return plan;
    },

    /** Reply to and resolve the threads the plan closes. Best effort. */
    async resolveThreads(): Promise<number> {
      if (!deps) return 0;
      let resolved = 0;
      for (const entry of plan.resolve) {
        try {
          await deps.replyAndResolvePrReviewThread({
            githubToken,
            threadId: entry.threadId,
            body: entry.body,
          });
          resolved += 1;
        } catch (error) {
          // The thread stays open; the next review plans it again.
          console.warn("[pr-review] failed to resolve thread", {
            threadId: entry.threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return resolved;
    },

    /**
     * The hidden state for the summary comment. A structured report records
     * this review; any other run keeps the previous review's state, since it
     * judged nothing.
     */
    stateMarker(report: {
      structured: boolean;
      findings: ReviewFinding[];
      inline: ReadonlySet<ReviewFinding>;
    }): string | null {
      if (!signer) return null;
      if (!report.structured) {
        return previousState
          ? serializePrReviewState(previousState, signer)
          : null;
      }
      return serializePrReviewState(
        {
          sha: headSha,
          reviewedAt: (startedAt ?? now()).toISOString(),
          findings: [
            ...report.findings.map((finding) => ({
              key: keys.get(finding) ?? newFindingKey(finding),
              severity: finding.severity,
              title: finding.title,
              path: finding.path,
              line: finding.line,
              inline:
                report.inline.has(finding) || plan.existingThreads.has(finding),
            })),
            ...carried,
          ],
        },
        signer
      );
    },
  };
}

export type PrReviewLifecycle = ReturnType<typeof createPrReviewLifecycle>;
