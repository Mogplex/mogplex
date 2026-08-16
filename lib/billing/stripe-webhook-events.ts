import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

// A claim (row with null processed_at) older than this is presumed to belong
// to a crashed handler and may be taken over by a later delivery.
const CLAIM_TAKEOVER_MS = 10 * 60 * 1_000;

export type StripeEventClaim = "claimed" | "processed" | "in_progress";

async function resolveDuplicateClaim(
  event: Stripe.Event,
  client: SupabaseClient,
  now: () => Date
): Promise<StripeEventClaim> {
  const claimedAt = now();
  const cutoff = new Date(
    claimedAt.getTime() - CLAIM_TAKEOVER_MS
  ).toISOString();
  const takeover = await client
    .from("billing_events")
    .update({ received_at: claimedAt.toISOString() })
    .eq("stripe_event_id", event.id)
    .is("processed_at", null)
    .lt("received_at", cutoff)
    .select("stripe_event_id");
  if (takeover.error) {
    throw new Error(
      `billing_events takeover failed: ${takeover.error.message}`
    );
  }
  if ((takeover.data?.length ?? 0) > 0) return "claimed";

  const existing = await client
    .from("billing_events")
    .select("processed_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`billing_events lookup failed: ${existing.error.message}`);
  }
  return existing.data?.processed_at ? "processed" : "in_progress";
}

// Claims the event id and distinguishes completed duplicates from active
// work. In-progress duplicates receive a non-2xx response so Stripe keeps
// retrying until the first handler completes or the stale claim is taken over.
export async function claimStripeEvent(
  event: Stripe.Event,
  client: SupabaseClient = supabaseAdmin,
  now: () => Date = () => new Date()
): Promise<StripeEventClaim> {
  const insert = await client.from("billing_events").insert({
    stripe_event_id: event.id,
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!insert.error) return "claimed";
  if (insert.error.code !== "23505") {
    throw new Error(`billing_events insert failed: ${insert.error.message}`);
  }
  return resolveDuplicateClaim(event, client, now);
}

export async function markStripeEventProcessed(
  eventId: string,
  client: SupabaseClient = supabaseAdmin,
  now: () => Date = () => new Date()
): Promise<void> {
  // Drop the raw provider payload after success to minimize retained customer
  // data. Durable billing facts remain in the ledger and entitlement snapshot
  // tables; failed or interrupted events retain their payload for recovery.
  const { error } = await client
    .from("billing_events")
    .update({ processed_at: now().toISOString(), payload: {} })
    .eq("stripe_event_id", eventId);
  if (error) {
    // Processing succeeded. An unmarked claim only causes a redundant,
    // idempotent replay after the takeover window.
    console.error(`[stripe-webhook] mark processed failed for ${eventId}`);
  }
}
