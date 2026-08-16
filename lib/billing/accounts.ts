import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ProductResourceScope } from "@/lib/team-resource-scope";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapacityPlanCode } from "@/lib/billing/capacity-catalog";

export type BillingAccount = {
  id: string;
  owner_type: "user" | "team";
  owner_user_id: string | null;
  product_team_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  tier: "free" | "pro" | "team" | "business";
  period_anchor: string | null;
  subscription_checkout_generation: number;
  status: "active" | "past_due" | "frozen_topups";
  plan_code?: CapacityPlanCode | null;
  included_hosted_usage_cents?: number | string;
  entitlement_projection_effective_at?: string | null;
  entitlement_projection_event_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

const UNIQUE_VIOLATION = "23505";

const ACCOUNT_COLUMNS =
  "id, owner_type, owner_user_id, product_team_id, stripe_customer_id, stripe_subscription_id, tier, period_anchor, subscription_checkout_generation, status, plan_code, included_hosted_usage_cents, entitlement_projection_effective_at, entitlement_projection_event_id, created_at, updated_at";

export async function findBillingAccountForScope(
  scope: ProductResourceScope,
  client: SupabaseClient = supabaseAdmin
): Promise<BillingAccount | null> {
  let query = client.from("billing_accounts").select(ACCOUNT_COLUMNS).limit(1);
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
  scope: ProductResourceScope,
  client: SupabaseClient = supabaseAdmin
): Promise<BillingAccount> {
  const existing = await findBillingAccountForScope(scope, client);
  if (existing) return existing;

  const insert =
    scope.kind === "team"
      ? { owner_type: "team", product_team_id: scope.productTeamId }
      : { owner_type: "user", owner_user_id: scope.userId };
  const { data, error } = await client
    .from("billing_accounts")
    .insert(insert)
    .select(ACCOUNT_COLUMNS)
    .single();
  if (!error) return data as BillingAccount;

  // Concurrent create for the same scope: the partial unique index rejects
  // the second insert — re-read the winner.
  if (error.code === UNIQUE_VIOLATION) {
    const winner = await findBillingAccountForScope(scope, client);
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
      | "stripe_customer_id"
      | "stripe_subscription_id"
      | "tier"
      | "period_anchor"
      | "status"
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
