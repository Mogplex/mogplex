import type * as Sentry from "@sentry/nextjs";

// node-postgres emits one `pg.connect` span for each socket a Pool opens. A
// cold serverless instance may open several in parallel, which Sentry's N+1
// detector mistakes for repeated database queries. Ignore only that low-level
// connection lifecycle span; keep `pg-pool.connect` and SQL spans so pool
// contention and genuine repeated-query problems remain observable.
export const SENTRY_SERVER_IGNORE_SPANS = [
  { op: "db", name: "pg.connect" },
] as const;

function exceptionValue(event: Sentry.Event): string {
  return event.exception?.values?.[0]?.value ?? "";
}

function topFrameFilename(event: Sentry.Event): string {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return frames.at(-1)?.filename ?? "";
}

export function isDevelopmentHttpAbortEvent(event: Sentry.Event): boolean {
  return (
    event.environment === "development" &&
    exceptionValue(event) === "aborted" &&
    topFrameFilename(event) === "node:_http_server"
  );
}

export function beforeSendServerEvent<TEvent extends Sentry.Event>(
  event: TEvent
): TEvent | null {
  if (isDevelopmentHttpAbortEvent(event)) {
    return null;
  }

  return event;
}
