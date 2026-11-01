import * as Sentry from "@sentry/nextjs";

/**
 * Report a billing failure that a route catches and answers itself. Caught
 * errors never reach Next's `onRequestError` hook, so without this a broken
 * checkout, webhook, or catalog sync only ever shows up as a log line.
 */
export function reportBillingError(
  surface: string,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  Sentry.captureException(error, {
    tags: { billing_surface: surface },
    extra,
  });
}
