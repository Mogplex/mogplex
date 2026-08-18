import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { accrueTokenUsage } from "@/lib/billing/ledger";
import { loadExplicitPlatformAccess } from "@/lib/platform-access";

export type TokenUsageMeteringInput = {
  aiCallId: string;
  userId: string;
  model: string;
  costUsd: number;
  completedAt: string;
  generationIds: string[];
  metadata: Record<string, unknown> | null;
};

export type TokenUsageMeteringResult = {
  metered: boolean;
  reason:
    | "posted"
    | "duplicate"
    | "allowlisted"
    | "no_billing_account"
    | "before_billing_account"
    | "zero_cost";
  amountCents: number;
  costUnits: number;
};

type TokenUsageMeteringDeps = {
  loadExplicitPlatformAccess: typeof loadExplicitPlatformAccess;
  findBillingAccountForScope: typeof findBillingAccountForScope;
  accrueTokenUsage: typeof accrueTokenUsage;
};

const defaultDeps: TokenUsageMeteringDeps = {
  loadExplicitPlatformAccess,
  findBillingAccountForScope,
  accrueTokenUsage,
};

function readMetadataTeamId(metadata: Record<string, unknown> | null) {
  for (const key of ["product_team_id", "team_id"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function tokenCostUsdToCostUnits(costUsd: number) {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.round(costUsd * 1e8);
}

function billingPeriod(completedAt: string) {
  const parsed = new Date(completedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Invalid ai_call completion time: ${completedAt}`);
  }
  return parsed.toISOString().slice(0, 7);
}

export function tokenUsageCustomerDescription(
  metadata: Record<string, unknown> | null
): string {
  const repo = metadataText(metadata, "repo_full_name");
  const pullRequest = metadataText(metadata, "pr_number");
  if (repo && pullRequest) return `Code review · ${repo} #${pullRequest}`;
  if (metadata?.source === "cli") return "CLI task";
  return metadataText(metadata, "flow_node_label") ?? "AI inference";
}

function metadataText(
  metadata: Record<string, unknown> | null,
  key: string
): string | null {
  const value = metadata?.[key];
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value).trim() || null;
}

export async function meterReconciledTokenUsage(
  input: TokenUsageMeteringInput,
  overrides: Partial<TokenUsageMeteringDeps> = {}
): Promise<TokenUsageMeteringResult> {
  const deps = { ...defaultDeps, ...overrides };
  const costUnits = tokenCostUsdToCostUnits(input.costUsd);
  if (costUnits === 0) {
    return {
      metered: false,
      reason: "zero_cost",
      amountCents: 0,
      costUnits,
    };
  }
  const explicitAccess = await deps.loadExplicitPlatformAccess(input.userId);
  if (explicitAccess.allowPlatformAi) {
    return {
      metered: false,
      reason: "allowlisted",
      amountCents: 0,
      costUnits,
    };
  }

  const productTeamId = readMetadataTeamId(input.metadata);
  const account = await deps.findBillingAccountForScope(
    productTeamId
      ? { kind: "team", userId: input.userId, productTeamId }
      : { kind: "personal", userId: input.userId, productTeamId: null }
  );
  if (!account) {
    return {
      metered: false,
      reason: "no_billing_account",
      amountCents: 0,
      costUnits,
    };
  }

  const accountCreatedAt = account.created_at
    ? Date.parse(account.created_at)
    : Number.NaN;
  const completedAt = Date.parse(input.completedAt);
  if (
    Number.isFinite(accountCreatedAt) &&
    Number.isFinite(completedAt) &&
    completedAt < accountCreatedAt
  ) {
    return {
      metered: false,
      reason: "before_billing_account",
      amountCents: 0,
      costUnits,
    };
  }

  const accrual = await deps.accrueTokenUsage({
    accountId: account.id,
    costUnits,
    sourceRef: `tok:${input.aiCallId}`,
    period: billingPeriod(input.completedAt),
    metadata: {
      ai_call_id: input.aiCallId,
      customer_description: tokenUsageCustomerDescription(input.metadata),
      gateway_generation_ids: input.generationIds,
      model: input.model,
      cost_usd: input.costUsd,
    },
  });
  return {
    metered: accrual.posted,
    reason: accrual.posted ? "posted" : "duplicate",
    amountCents: accrual.debitedCents,
    costUnits,
  };
}
