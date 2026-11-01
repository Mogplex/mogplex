import * as Sentry from "@sentry/nextjs";
import { CapacityBillingDisabledError } from "@/lib/billing/capacity-billing-errors";

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

/** Which billing account a route failure belongs to; unset if resolving it failed. */
export type BillingErrorContext = {
  scope: "personal" | "team";
  accountId: string | undefined;
};

/**
 * Report a billing failure that a route catches and answers itself. Caught
 * errors never reach Next's `onRequestError` hook, so without this a broken
 * checkout, webhook, or catalog sync only ever shows up as a log line.
 * The Stripe webhook keeps a schedule projection refused by a closed capacity
 * operations gate for replay, and Stripe retries it for days, so that one
 * `CapacityBillingDisabledError` is not reported; on any other surface it is.
 *
 * Route handlers are not wrapped by the SDK under Turbopack, so nothing flushes
 * at handler return; await delivery here, on the failure path only, before a
 * serverless function can freeze. A telemetry outage never replaces the
 * original response.
 */
export async function reportBillingError(
  surface: BillingSurface,
  error: unknown,
  extra: Record<string, unknown> = {}
): Promise<void> {
  // Self-hosted installs without a DSN have no client; nothing to deliver.
  if (!Sentry.getClient()) return;
  if (
    surface === "stripe_webhook" &&
    error instanceof CapacityBillingDisabledError
  ) {
    return;
  }
  try {
    Sentry.captureException(error, {
      tags: { billing_surface: surface },
      extra,
    });
    // flush resolves false on timeout rather than rejecting.
    if (!(await Sentry.flush(2_000))) {
      console.error("[billing] Error report did not flush in time");
    }
  } catch (deliveryError) {
    console.error("[billing] Could not deliver error report", {
      error:
        deliveryError instanceof Error
          ? deliveryError.message
          : "Unknown error",
    });
  }
}
