import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimStripeEvent,
  markStripeEventProcessed,
} from "../../lib/billing/stripe-webhook-events";
import { billingEventsClient } from "./helpers/stripe-webhook-fixtures";

test("event claims insert a fresh event", async () => {
  const { client, calls } = billingEventsClient({});
  const event = {
    id: "evt_fresh",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await claimStripeEvent(
      event,
      client as unknown as SupabaseClient,
      () => new Date("2026-08-04T20:00:00.000Z")
    ),
    "claimed"
  );
  assert.equal(calls[0]?.method, "insert");
});

test("event claims take over only stale unprocessed duplicate rows", async () => {
  const { client, calls } = billingEventsClient({
    insertError: { code: "23505", message: "duplicate" },
    takeoverData: [{ stripe_event_id: "evt_stale" }],
  });
  const event = {
    id: "evt_stale",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await claimStripeEvent(
      event,
      client as unknown as SupabaseClient,
      () => new Date("2026-08-04T20:00:00.000Z")
    ),
    "claimed"
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "is" &&
        call.column === "processed_at" &&
        call.value === null
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "lt" &&
        call.column === "received_at" &&
        call.value === "2026-08-04T19:50:00.000Z"
    )
  );
});

test("event claims distinguish an in-progress duplicate", async () => {
  const { client } = billingEventsClient({
    insertError: { code: "23505", message: "duplicate" },
  });
  const event = {
    id: "evt_duplicate",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await claimStripeEvent(event, client as unknown as SupabaseClient),
    "in_progress"
  );
});

test("event claims distinguish an already processed duplicate", async () => {
  const { client } = billingEventsClient({
    insertError: { code: "23505", message: "duplicate" },
    processedAt: "2026-08-04T20:00:00.000Z",
  });
  const event = {
    id: "evt_processed_duplicate",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  assert.equal(
    await claimStripeEvent(event, client as unknown as SupabaseClient),
    "processed"
  );
});

test("event claim storage failures surface instead of acknowledging the webhook", async () => {
  const { client } = billingEventsClient({
    insertError: { code: "08006", message: "connection failed" },
  });
  const event = {
    id: "evt_db_error",
    type: "invoice.paid",
    data: { object: {} },
  } as Stripe.Event;

  await assert.rejects(
    claimStripeEvent(event, client as unknown as SupabaseClient),
    /billing_events insert failed: connection failed/
  );
});

test("processed event claims record the completion timestamp", async () => {
  const { client, calls } = billingEventsClient({});

  await markStripeEventProcessed(
    "evt_processed",
    client as unknown as SupabaseClient,
    () => new Date("2026-08-04T20:05:00.000Z")
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "update" &&
        (call.value as { processed_at?: string; payload?: unknown })
          .processed_at === "2026-08-04T20:05:00.000Z" &&
        JSON.stringify(
          (call.value as { processed_at?: string; payload?: unknown }).payload
        ) === "{}"
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "eq" &&
        call.column === "stripe_event_id" &&
        call.value === "evt_processed"
    )
  );
});
