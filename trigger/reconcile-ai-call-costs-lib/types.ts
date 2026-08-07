import * as Sentry from "@sentry/nextjs";
import type { meterReconciledTokenUsage } from "@/lib/billing/token-usage";
import type { supabaseAdmin } from "@/lib/supabase/admin";

export type AiCallCostReconciliationRow = {
  id: string;
  user_id: string;
  model: string;
  /** @deprecated Use gateway_generation_ids array instead. Kept for backward compat. */
  gateway_generation_id: string;
  /** All gateway generation IDs across tool-loop steps. W11 sums cost across all. */
  gateway_generation_ids: string[] | null;
  cost_source: "trigger" | "gateway" | "manual" | null;
  completed_at: string;
  metadata: Record<string, unknown> | null;
};

export type AiCallCostReconciliationSummary = {
  scanned: number;
  reconciled: number;
  skipped: number;
  errored: number;
};

export type GatewayGenerationInfoClient = {
  getGenerationInfo: (params: { id: string }) => Promise<unknown>;
};

export type SentryClient = {
  captureException: (
    exception: unknown,
    captureContext?: Parameters<typeof Sentry.captureException>[1]
  ) => unknown;
  captureMessage: (
    message: string,
    captureContext?: Parameters<typeof Sentry.captureMessage>[1]
  ) => unknown;
};

export type AiCallCostReconciliationDeps = {
  gateway?: GatewayGenerationInfoClient;
  supabase: typeof supabaseAdmin;
  sentry: SentryClient;
  now: () => Date;
  meterReconciledTokenUsage: typeof meterReconciledTokenUsage;
};

export type AiCallCostReconciliationOutcome =
  | "reconciled"
  | "skipped"
  | "errored";

export type AggregateGatewayCostResult =
  | { status: "complete"; totalCost: number; firstId: string }
  | {
      status: "incomplete";
      reason: "not_found" | "missing_cost";
      resolvedCount: number;
      totalCount: number;
    };
