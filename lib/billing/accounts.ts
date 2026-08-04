import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ProductResourceScope } from "@/lib/team-resource-scope";

export type BillingAccount = {
  id: string;
  owner_type: "user" | "team";
  owner_user_id: string | null;
  product_team_id: string | null;
  stripe_customer_id: string | null;
  tier: "free" | "pro" | "team";
  period_anchor: string | null;
  status: "active" | "past_due" | "frozen_topups";
};

const UNIQUE_VIOLATION = "23505";

const ACCOUNT_COLUMNS =
  "id, owner_type, owner_user_id, product_team_id, stripe_customer_id, tier, period_anchor, status";

async function findAccountForScope(
  scope: ProductResourceScope
): Promise<BillingAccount | null> {
  let query = supabaseAdmin
    .from("billing_accounts")
    .select(ACCOUNT_COLUMNS)
    .limit(1);
  query =
    scope.kind === "team"
      ? query
          .eq("owner_type", "team")
          .eq("product_team_id", scope.productTeamId)
      : query.eq("owner_type", "user").eq("owner_user_id", scope.userId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`billing_accounts lookup failed: ${error.message}`);
  }
  return (data as BillingAccount | null) ?? null;
}

export async function getOrCreateBillingAccount(
  scope: ProductResourceScope
): Promise<BillingAccount> {
  const existing = await findAccountForScope(scope);
  if (existing) return existing;

  const insert =
    scope.kind === "team"
      ? { owner_type: "team", product_team_id: scope.productTeamId }
      : { owner_type: "user", owner_user_id: scope.userId };
  const { data, error } = await supabaseAdmin
    .from("billing_accounts")
    .insert(insert)
    .select(ACCOUNT_COLUMNS)
    .single();
  if (!error) return data as BillingAccount;

  // Concurrent create for the same scope: the partial unique index rejects
  // the second insert — re-read the winner.
  if (error.code === UNIQUE_VIOLATION) {
    const winner = await findAccountForScope(scope);
    if (winner) return winner;
  }
  throw new Error(`billing_accounts insert failed: ${error.message}`);
}

export async function findBillingAccountById(
  id: string
): Promise<BillingAccount | null> {
  const { data, error } = await supabaseAdmin
    .from("billing_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`billing_accounts lookup failed: ${error.message}`);
  }
  return (data as BillingAccount | null) ?? null;
}

export async function findBillingAccountByStripeCustomer(
  stripeCustomerId: string
): Promise<BillingAccount | null> {
  const { data, error } = await supabaseAdmin
    .from("billing_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) {
    throw new Error(`billing_accounts lookup failed: ${error.message}`);
  }
  return (data as BillingAccount | null) ?? null;
}

export async function updateBillingAccount(
  id: string,
  updates: Partial<
    Pick<
      BillingAccount,
      "stripe_customer_id" | "tier" | "period_anchor" | "status"
    >
  >
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("billing_accounts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    throw new Error(`billing_accounts update failed: ${error.message}`);
  }
}
