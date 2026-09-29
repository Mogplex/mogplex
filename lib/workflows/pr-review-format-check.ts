/**
 * Publish-time format check for PR reviews. The evaluation model judges the
 * text Mogplex is about to post; when it finds a problem, a platform model
 * rewrites the text and a second check must confirm the rewrite kept every
 * claim before it replaces the original.
 *
 * Every call here runs on the platform's gateway credential, so the check is
 * free to the account. It never throws and never blocks publishing: any
 * failure publishes the reviewer's original text.
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { decide } from "@/lib/decisions/decide";
import {
  reviewFormatProblems,
  type ReviewFormatProblem,
} from "@/lib/decisions/definitions";
import { resolveDecisionGateway } from "@/lib/decisions/evaluator";
import type { DecisionScope } from "@/lib/decisions/types";
import { metadataTeamId } from "./automation-job-classify";
import type { JobContext } from "./automation-job-types";
import { buildPrReviewCheckText } from "./pr-review-harness";
import type {
  PrReviewHarnessResult,
  ReviewOutcome,
} from "./pr-review-harness-types";
import { toOptionalString } from "./pr-review-harness-utils";

export const PR_REVIEW_REWRITE_MODEL = "anthropic/claude-sonnet-5";
const REWRITE_TIMEOUT_MS = 30_000;

export type PrReviewRewrite = {
  summary: string;
  commentBody: string | null;
  findingBodies: string[];
};

export type PrReviewRewriter = (input: {
  outcome: ReviewOutcome;
  problems: readonly string[];
  userId: string | null;
}) => Promise<{
  rewrite: PrReviewRewrite;
  usage: Record<string, unknown>;
} | null>;

export type PrReviewFormatDeps = {
  /** False when no platform credential exists, so nothing is attempted. */
  available: () => boolean;
  decide: typeof decide;
  rewrite: PrReviewRewriter;
};

const REWRITE_INSTRUCTIONS = [
  "You fix the formatting of a pull request review before it is posted on GitHub. Change how the review reads, never what it says.",
  "Keep every claim, verdict, file path, line number, identifier, and recommendation. Do not add, drop, soften, or strengthen any of them.",
  "summary: one to three sentences with the verdict and the most important reason.",
  "commentBody: the remaining supporting points as a markdown bullet list, one point per bullet. Return null when there are findings or nothing is left after the summary.",
  "findingBodies: one entry per input finding, in the same order. Keep each body's meaning; split long bodies into short paragraphs or bullets.",
  "Wrap file paths, functions, identifiers, and commands in backticks. Never use markdown headings.",
  "Remove mentions of the reviewer's tools, report fields, or process, such as reportReview or hasIssues. Remove sentences that only point to details stated elsewhere.",
].join("\n");

const rewriteSchema = z.object({
  summary: z.string(),
  commentBody: z.string().nullable(),
  findingBodies: z.array(z.string()),
});

export const rewritePrReviewText: PrReviewRewriter = async (input) => {
  const gateway = resolveDecisionGateway();
  if (!gateway) return null;
  const model =
    process.env.PR_REVIEW_REWRITE_MODEL?.trim() || PR_REVIEW_REWRITE_MODEL;
  const startedAt = performance.now();
  const result = await generateText({
    model: gateway(model),
    providerOptions: {
      gateway: {
        ...(input.userId ? { user: input.userId } : {}),
        tags: ["surface:decisions", "decision:review_format_rewrite"],
      },
    },
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(REWRITE_TIMEOUT_MS),
    output: Output.object({ schema: rewriteSchema }),
    instructions: REWRITE_INSTRUCTIONS,
    prompt: JSON.stringify({
      problems: input.problems,
      summary: input.outcome.summary,
      commentBody: input.outcome.commentBody,
      findings: input.outcome.findings.map(({ title, body }) => ({
        title,
        body,
      })),
    }),
  });
  return {
    rewrite: result.output,
    usage: {
      model,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    },
  };
};

const defaultDeps: PrReviewFormatDeps = {
  available: () => resolveDecisionGateway() !== null,
  decide,
  rewrite: rewritePrReviewText,
};

/** The narrative and findings exactly as the timeline comment renders them. */
function renderForJudging(harnessResult: PrReviewHarnessResult) {
  return buildPrReviewCheckText({
    harnessResult,
    fallbackText: null,
    conclusion: "success",
  });
}

/** The account and repo a PR review's decisions are recorded under. */
export function prReviewDecisionScope(
  context: JobContext,
  aiCallId: string | null
): DecisionScope {
  return {
    surface: "pr_review",
    userId: context.repo.user_id,
    teamId:
      metadataTeamId(context.metadata) ?? context.repo.product_team_id ?? null,
    repoId: context.repo.id,
    aiCallId,
  };
}

/**
 * What the format check found wrong with the review as it would be
 * published. None when no platform credential exists; the check itself
 * fails open.
 */
export async function findReviewFormatProblems(
  harnessResult: PrReviewHarnessResult,
  scope: DecisionScope,
  metadata: Record<string, unknown>,
  deps: Pick<PrReviewFormatDeps, "available" | "decide"> = defaultDeps
): Promise<ReviewFormatProblem[]> {
  if (!deps.available()) return [];
  const format = await deps.decide(
    "review_format",
    { review_markdown: renderForJudging(harnessResult) },
    scope,
    { metadata }
  );
  return format.act && format.answers
    ? reviewFormatProblems(format.answers)
    : [];
}

/** Titles, paths, lines, and severities stay the reviewer's own. */
function applyRewrite(
  harnessResult: PrReviewHarnessResult,
  rewrite: PrReviewRewrite
): PrReviewHarnessResult | null {
  const { findings } = harnessResult.reviewOutcome;
  const summary = toOptionalString(rewrite.summary);
  if (!summary || rewrite.findingBodies.length !== findings.length) {
    return null;
  }
  const bodies = rewrite.findingBodies.map((body) => toOptionalString(body));
  if (bodies.includes(null)) return null;
  return {
    ...harnessResult,
    reviewOutcome: {
      ...harnessResult.reviewOutcome,
      summary,
      commentBody:
        findings.length > 0 ? null : toOptionalString(rewrite.commentBody),
      findings: findings.map((finding, index) => ({
        ...finding,
        body: bodies[index] ?? finding.body,
      })),
    },
  };
}

/**
 * Returns the result to publish: the input unchanged unless the format check
 * flagged it and a faithful rewrite exists.
 */
export async function polishPrReviewForPublish(
  harnessResult: PrReviewHarnessResult | null,
  scope: DecisionScope,
  metadata: Record<string, unknown> = {},
  deps: PrReviewFormatDeps = defaultDeps
): Promise<PrReviewHarnessResult | null> {
  if (harnessResult?.source !== "structured" || !deps.available()) {
    return harnessResult;
  }

  try {
    const problems = await findReviewFormatProblems(
      harnessResult,
      scope,
      metadata,
      deps
    );
    if (problems.length === 0) return harnessResult;

    const original = renderForJudging(harnessResult);
    const rewritten = await deps.rewrite({
      outcome: harnessResult.reviewOutcome,
      problems,
      userId: scope.userId ?? null,
    });
    const candidate = rewritten
      ? applyRewrite(harnessResult, rewritten.rewrite)
      : null;
    if (!(rewritten && candidate)) return harnessResult;

    const faithful = await deps.decide(
      "review_rewrite_faithful",
      { original, rewritten: renderForJudging(candidate) },
      scope,
      { metadata: { ...metadata, problems, rewrite: rewritten.usage } }
    );
    return faithful.act ? candidate : harnessResult;
  } catch (error) {
    console.warn("[pr-review] format check failed open", { error });
    return harnessResult;
  }
}
