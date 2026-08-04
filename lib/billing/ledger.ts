import { supabaseAdmin } from "@/lib/supabase/admin";

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

const UNIQUE_VIOLATION = "23505";

export async function postLedgerEntry(
  entry: LedgerEntry
): Promise<{ posted: boolean }> {
  if (!Number.isInteger(entry.deltaCents)) {
    throw new TypeError(
      `ledger delta must be integer cents, got ${entry.deltaCents}`
    );
  }
  const { error } = await supabaseAdmin.from("credit_ledger").insert({
    account_id: entry.accountId,
    delta_cents: entry.deltaCents,
    bucket: entry.bucket,
    kind: entry.kind,
    source_ref: entry.sourceRef,
    period: entry.period ?? null,
    metadata: entry.metadata ?? {},
  });
  if (!error) return { posted: true };
  if (error.code === UNIQUE_VIOLATION) return { posted: false };
  throw new Error(`credit_ledger insert failed: ${error.message}`);
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
