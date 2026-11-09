import type { readPrReviewTimelineComment } from "@/lib/github-check-runs";
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
  parsePrReviewState,
  serializePrReviewState,
  type PrReviewHistory,
  type PrReviewState,
} from "./pr-review-history";
import { buildPrReviewHistoryBlock } from "./pr-review-history-prompt";
import { createPrReviewSigner } from "./pr-review-signing";
import {
  assignFindingKeys,
  planPrReviewThreads,
  type PrReviewThreadPlan,
} from "./pr-review-lifecycle";

export type PrReviewThreadsDeps = {
  readPrReviewTimelineComment: typeof readPrReviewTimelineComment;
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

  return {
    /** The prompt block for the previous review, or null for a first review. */
    async loadHistoryBlock(): Promise<string | null> {
      if (!deps || !signer || prNumber == null || headSha.length === 0)
        return null;
      const target = { githubToken, repoFullName, prNumber };
      history = await loadPrReviewHistory(headSha, {
        signer,
        readSummaryComment: async () => {
          const body = await deps.readPrReviewTimelineComment(target);
          previousState = parsePrReviewState(body, signer);
          return body;
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
      plan = planPrReviewThreads({ history, keys, headSha, structured });
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
        } catch {
          // The thread stays open; the next review plans it again.
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
          reviewedAt: now().toISOString(),
          findings: report.findings.map((finding) => ({
            key: keys.get(finding) ?? "",
            severity: finding.severity,
            title: finding.title,
            path: finding.path,
            line: finding.line,
            inline:
              report.inline.has(finding) || plan.existingThreads.has(finding),
          })),
        },
        signer
      );
    },
  };
}

export type PrReviewLifecycle = ReturnType<typeof createPrReviewLifecycle>;
