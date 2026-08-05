import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LedgerBucket = "included" | "purchased";

export type LedgerKind =
  | "grant"
  | "grant_adjustment"
  | "grant_expiry"
  | "topup"
  | "usage_tokens"
  | "usage_sandbox"
  | "refund"
  | "adjustment"
  | "beta_credit";

export type LedgerEntry = {
  accountId: string;
  deltaCents: number;
  bucket: LedgerBucket;
  kind: LedgerKind;
  // Idempotency key (unique index): re-posting the same source_ref is a
  // silent no-op, which makes webhook redelivery and reconciler re-runs safe.
  sourceRef: string;
  period?: string;
  metadata?: Record<string, unknown>;
};

export type BillingBalance = {
  includedCents: number;
  purchasedCents: number;
  totalCents: number;
};

export type BillingPeriodGrant = {
  accountId: string;
  deltaCents: number;
  grantSourceRef: string;
  expirySourceRef: string;
  period: string;
  metadata?: Record<string, unknown>;
};

export type IncludedCreditExpiry = {
  accountId: string;
  sourceRef: string;
};

export type BillingUsageDebit = {
  accountId: string;
  amountCents: number;
  kind: Extract<LedgerKind, "usage_tokens" | "usage_sandbox">;
  sourceRef: string;
  period: string;
  metadata?: Record<string, unknown>;
};

export type BillingUsageDebitResult = {
  posted: boolean;
  debitedCents: number;
  includedDebitedCents: number;
  purchasedDebitedCents: number;
};

export type TokenUsageAccrual = {
  accountId: string;
  costUnits: number;
  sourceRef: string;
  period: string;
  metadata?: Record<string, unknown>;
};

export type TokenUsageAccrualResult = {
  posted: boolean;
  debitedCents: number;
  remainderCostUnits: number;
};

export async function postLedgerEntry(
  entry: LedgerEntry,
  client: SupabaseClient = supabaseAdmin
): Promise<{ posted: boolean }> {
  if (!Number.isInteger(entry.deltaCents)) {
    throw new TypeError(
      `ledger delta must be integer cents, got ${entry.deltaCents}`
    );
  }
  const { data, error } = await client.rpc("post_credit_ledger_entry", {
    p_account: entry.accountId,
    p_delta: entry.deltaCents,
    p_bucket: entry.bucket,
    p_kind: entry.kind,
    p_source_ref: entry.sourceRef,
    p_period: entry.period ?? null,
    p_metadata: entry.metadata ?? {},
  });
  if (error) {
    throw new Error(`credit_ledger insert failed: ${error.message}`);
  }
  return { posted: data === true };
}

export async function postBillingPeriodGrant(
  grant: BillingPeriodGrant,
  client: SupabaseClient = supabaseAdmin
): Promise<{ posted: boolean; expiredCents: number }> {
  if (!Number.isInteger(grant.deltaCents) || grant.deltaCents <= 0) {
    throw new TypeError(
      `billing period grant must be positive integer cents, got ${grant.deltaCents}`
    );
  }
  const { data, error } = await client.rpc("post_billing_period_grant", {
    p_account: grant.accountId,
    p_delta: grant.deltaCents,
    p_grant_source_ref: grant.grantSourceRef,
    p_expiry_source_ref: grant.expirySourceRef,
    p_period: grant.period,
    p_metadata: grant.metadata ?? {},
  });
  if (error) {
    throw new Error(`billing period grant failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    posted?: boolean;
    expired_cents?: number | string;
  } | null;
  return {
    posted: row?.posted === true,
    expiredCents: Number(row?.expired_cents ?? 0),
  };
}

export async function expireIncludedCredit(
  expiry: IncludedCreditExpiry,
  client: SupabaseClient = supabaseAdmin
): Promise<number> {
  const { data, error } = await client.rpc("expire_billing_included_credit", {
    p_account: expiry.accountId,
    p_source_ref: expiry.sourceRef,
  });
  if (error) {
    throw new Error(`included credit expiry failed: ${error.message}`);
  }
  return Number(data ?? 0);
}

export async function postBillingUsageDebit(
  debit: BillingUsageDebit,
  client: SupabaseClient = supabaseAdmin
): Promise<BillingUsageDebitResult> {
  if (!Number.isInteger(debit.amountCents) || debit.amountCents <= 0) {
    throw new TypeError(
      `billing usage debit must be a positive integer cents amount, got ${debit.amountCents}`
    );
  }
  const { data, error } = await client.rpc("post_billing_usage_debit", {
    p_account: debit.accountId,
    p_amount: debit.amountCents,
    p_kind: debit.kind,
    p_source_ref: debit.sourceRef,
    p_period: debit.period,
    p_metadata: debit.metadata ?? {},
  });
  if (error) {
    throw new Error(`billing usage debit failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    posted?: boolean;
    debited_cents?: number | string;
    included_debited_cents?: number | string;
    purchased_debited_cents?: number | string;
  } | null;
  return {
    posted: row?.posted === true,
    debitedCents: Number(row?.debited_cents ?? 0),
    includedDebitedCents: Number(row?.included_debited_cents ?? 0),
    purchasedDebitedCents: Number(row?.purchased_debited_cents ?? 0),
  };
}

export async function accrueTokenUsage(
  accrual: TokenUsageAccrual,
  client: SupabaseClient = supabaseAdmin
): Promise<TokenUsageAccrualResult> {
  if (!Number.isSafeInteger(accrual.costUnits) || accrual.costUnits <= 0) {
    throw new TypeError(
      `token usage cost must be positive integer cost units, got ${accrual.costUnits}`
    );
  }
  const { data, error } = await client.rpc("accrue_token_usage", {
    p_account: accrual.accountId,
    p_cost_units: accrual.costUnits,
    p_source_ref: accrual.sourceRef,
    p_period: accrual.period,
    p_metadata: accrual.metadata ?? {},
  });
  if (error) {
    throw new Error(`token usage accrual failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    posted?: boolean;
    debited_cents?: number | string;
    remainder_cost_units?: number | string;
  } | null;
  return {
    posted: row?.posted === true,
    debitedCents: Number(row?.debited_cents ?? 0),
    remainderCostUnits: Number(row?.remainder_cost_units ?? 0),
  };
}

export async function getBillingBalance(
  accountId: string
): Promise<BillingBalance> {
  const { data, error } = await supabaseAdmin.rpc("billing_balance", {
    p_account: accountId,
  });
  if (error) {
    throw new Error(`billing_balance rpc failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        included_cents: number | string;
        purchased_cents: number | string;
        total_cents: number | string;
      }
    | undefined;
  return {
    includedCents: Number(row?.included_cents ?? 0),
    purchasedCents: Number(row?.purchased_cents ?? 0),
    totalCents: Number(row?.total_cents ?? 0),
  };
}
