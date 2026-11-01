import * as Sentry from "@sentry/nextjs";
import { CapacityBillingDisabledError } from "@/lib/billing/stripe";

/** The `billing_surface` tag value. Alert rules key on it, so it is a closed set. */
export type BillingSurface =
  | "capacity_checkout"
  | "capacity_events_account"
  | "capacity_events_stream"
  | "capacity_preview"
  | "capacity_schedule"
  | "capacity_summary"
  | "hosted_usage_checkout"
  | "plan_checkout"
  | "stripe_catalog_sync"
  | "stripe_webhook";

/**
 * Report a billing failure that a route catches and answers itself. Caught
 * errors never reach Next's `onRequestError` hook, so without this a broken
 * checkout, webhook, or catalog sync only ever shows up as a log line.
 * A closed capacity operations gate is intentional (the Stripe webhook keeps
 * those events for replay, and Stripe retries them for days), so it is never
 * reported.
 */
export function reportBillingError(
  surface: BillingSurface,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  if (error instanceof CapacityBillingDisabledError) return;
  Sentry.captureException(error, {
    tags: { billing_surface: surface },
    extra,
  });
}
