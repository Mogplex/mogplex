import { findBillingAccountForScope } from "@/lib/billing/accounts";
import { postBillingUsageDebit } from "@/lib/billing/ledger";
import { isBillingEnabled } from "@/lib/billing/stripe";
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
    | "billing_disabled"
    | "allowlisted"
    | "no_billing_account"
    | "before_billing_account"
    | "below_one_cent";
  amountCents: number;
};

type TokenUsageMeteringDeps = {
  isBillingEnabled: typeof isBillingEnabled;
  loadExplicitPlatformAccess: typeof loadExplicitPlatformAccess;
  findBillingAccountForScope: typeof findBillingAccountForScope;
  postBillingUsageDebit: typeof postBillingUsageDebit;
};

const defaultDeps: TokenUsageMeteringDeps = {
  isBillingEnabled,
  loadExplicitPlatformAccess,
  findBillingAccountForScope,
  postBillingUsageDebit,
};

function readMetadataTeamId(metadata: Record<string, unknown> | null) {
  for (const key of ["product_team_id", "team_id"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function tokenCostUsdToCents(costUsd: number) {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.round(costUsd * 100);
}

function billingPeriod(completedAt: string) {
  const parsed = new Date(completedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Invalid ai_call completion time: ${completedAt}`);
  }
  return parsed.toISOString().slice(0, 7);
}

export async function meterReconciledTokenUsage(
  input: TokenUsageMeteringInput,
  overrides: Partial<TokenUsageMeteringDeps> = {}
): Promise<TokenUsageMeteringResult> {
  const deps = { ...defaultDeps, ...overrides };
  const amountCents = tokenCostUsdToCents(input.costUsd);
  if (!deps.isBillingEnabled()) {
    return { metered: false, reason: "billing_disabled", amountCents };
  }
  if (amountCents === 0) {
    return { metered: false, reason: "below_one_cent", amountCents };
  }
  const explicitAccess = await deps.loadExplicitPlatformAccess(input.userId);
  if (explicitAccess.allowPlatformAi) {
    return { metered: false, reason: "allowlisted", amountCents };
  }

  const productTeamId = readMetadataTeamId(input.metadata);
  const account = await deps.findBillingAccountForScope(
    productTeamId
      ? { kind: "team", userId: input.userId, productTeamId }
      : { kind: "personal", userId: input.userId, productTeamId: null }
  );
  if (!account) {
    return { metered: false, reason: "no_billing_account", amountCents };
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
      amountCents,
    };
  }

  const debit = await deps.postBillingUsageDebit({
    accountId: account.id,
    amountCents,
    kind: "usage_tokens",
    sourceRef: `tok:${input.aiCallId}`,
    period: billingPeriod(input.completedAt),
    metadata: {
      ai_call_id: input.aiCallId,
      gateway_generation_ids: input.generationIds,
      model: input.model,
      cost_usd: input.costUsd,
    },
  });
  return {
    metered: debit.posted,
    reason: debit.posted ? "posted" : "duplicate",
    amountCents,
  };
}
