import { createHash } from "node:crypto";
import type { ReviewFinding } from "@/lib/types";
import type { PrReviewHistory, PriorFinding } from "./pr-review-history";

export const MOGPLEX_REPLY_MARKER = "<!-- mogplex-reply -->";

/** The most findings one native review report may carry. */
export const PR_REVIEW_MAX_FINDINGS = 20;

/** A key from the finding's own content. */
export function newFindingKey(finding: ReviewFinding) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        finding.path ?? null,
        finding.title.trim(),
        finding.body.trim(),
      ])
    )
    .digest("hex")
    .slice(0, 12);
}

const normalized = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

/** The earlier finding a new one continues, if any, and not one already taken. */
function priorFor(
  finding: ReviewFinding,
  priors: PriorFinding[],
  used: Set<string>
): PriorFinding | undefined {
  const sameFile = (prior: PriorFinding) =>
    normalized(prior.path) === normalized(finding.path);
  const linked = finding.priorId
    ? priors.find((prior) => prior.id === finding.priorId)
    : undefined;
  // A priorId only counts for the same file: a miscopied id must not hand an
  // unrelated finding another finding's thread.
  if (linked && sameFile(linked) && !used.has(linked.key)) return linked;
  // The reviewer may report a finding again without its priorId, with a new
  // body; the same file and title still identify it.
  return priors.find(
    (prior) =>
      !used.has(prior.key) &&
      sameFile(prior) &&
      normalized(prior.title) === normalized(finding.title)
  );
}

/**
 * A stable key per finding. A finding that continues an earlier one (linked
 * by `priorId` in the same file, or with the same file and title) keeps that
 * finding's key, once; any other finding gets a key from its own content.
 */
export function assignFindingKeys(
  findings: ReviewFinding[],
  history: PrReviewHistory | null
): Map<ReviewFinding, string> {
  const priors = history?.findings ?? [];
  const keys = new Map<ReviewFinding, string>();
  const used = new Set<string>();
  for (const finding of findings) {
    const prior = priorFor(finding, priors, used);
    let key = prior ? prior.key : newFindingKey(finding);
    let suffix = 2;
    while (used.has(key)) {
      key = `${newFindingKey(finding).slice(0, 10)}${suffix.toString(16).padStart(2, "0")}`;
      suffix += 1;
    }
    used.add(key);
    keys.set(finding, key);
  }
  return keys;
}

export type PrReviewThreadPlan = {
  /** Findings that already have an open Mogplex thread, with its URL. */
  existingThreads: Map<ReviewFinding, string | null>;
  /** Open Mogplex threads to reply to and resolve. */
  resolve: Array<{ threadId: string; body: string }>;
  /** Earlier findings this review did not report again. */
  resolvedFindings: PriorFinding[];
};

/**
 * What to do with the previous review's threads. Only a review that filed a
 * complete structured report closes anything: an incomplete or failed run has
 * not judged the earlier findings, and a report at the findings cap may have
 * left live ones out. A thread someone resolved stays resolved.
 */
export function planPrReviewThreads(input: {
  history: PrReviewHistory | null;
  keys: Map<ReviewFinding, string>;
  headSha: string;
  /** A structured report that cannot have been cut at the findings cap. */
  complete: boolean;
}): PrReviewThreadPlan {
  const plan: PrReviewThreadPlan = {
    existingThreads: new Map(),
    resolve: [],
    resolvedFindings: [],
  };
  if (!input.history) return plan;

  const priorByKey = new Map(
    input.history.findings.map((prior) => [prior.key, prior])
  );
  const reported = new Set(input.keys.values());
  for (const [finding, key] of input.keys) {
    const thread = priorByKey.get(key)?.thread;
    if (thread && !thread.isResolved) {
      plan.existingThreads.set(finding, thread.url);
    }
  }
  if (!input.complete) return plan;

  const changed = new Set(input.history.changedFiles);
  for (const prior of input.history.findings) {
    if (reported.has(prior.key)) continue;
    // An incremental review reads only the files changed since; it has not
    // re-checked a finding elsewhere, so that finding stays open.
    if (
      input.history.mode === "incremental" &&
      !(prior.path && changed.has(prior.path))
    ) {
      continue;
    }
    plan.resolvedFindings.push(prior);
    if (prior.thread && !prior.thread.isResolved) {
      plan.resolve.push({
        threadId: prior.thread.id,
        body: `${MOGPLEX_REPLY_MARKER}\nNo longer reported at \`${input.headSha.slice(0, 7)}\`.`,
      });
    }
  }
  return plan;
}
