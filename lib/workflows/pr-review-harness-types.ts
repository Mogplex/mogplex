import type { ReviewFinding } from "@/lib/types";

export type AutomationAgentReviewResult = {
  text: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    toolResults?: unknown[];
  }>;
};

export type ReviewOutcome = {
  hasIssues: boolean;
  summary: string;
  commentBody: string | null;
  affectedFiles: string[];
  findings: ReviewFinding[];
};

export type PrAutofixCommit = {
  path: string | null;
  branch: string | null;
  commitSha: string | null;
  commitUrl: string | null;
};

export type PrAutofixOutcome = {
  applied: boolean;
  summary: string | null;
  updatedFiles: string[];
  commits: PrAutofixCommit[];
};

export type PrReviewContractSource =
  | "structured"
  | "legacy_post_comment"
  | "legacy_text";

export type PrReviewHarnessResult = {
  source: PrReviewContractSource;
  reviewOutcome: ReviewOutcome;
  fallbackText: string | null;
  autofix?: PrAutofixOutcome | null;
};

export type PrReviewConclusion = "success" | "neutral" | "failure";

export type PrReviewFailureDetails = {
  reasonLabel?: string | null;
  error?: string | null;
  infraFailureClass?: string | null;
  infraFailureMessage?: string | null;
  modelFailureClass?: string | null;
  modelFailureMessage?: string | null;
  modelFailureStatusCode?: number | null;
  modelEffectiveTimeoutMs?: number | null;
  modelAttempts?: number | null;
  modelRetryAttempted?: boolean | null;
  modelRetryCount?: number | null;
  runtimeProvider?: string | null;
  runtimeRunId?: string | null;
};
