import type * as Sentry from "@sentry/nextjs";
import { SCOPE_LAYOUT_MISSING_HEADERS_ERROR } from "@/lib/scope-context";

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

const VERCEL_SUSPENSE_CACHE_HOST_SUFFIX = ".suspense-cache.vercel-infra.com";
const NEXT_REQUEST_ERROR_MECHANISM = "auto.function.nextjs.on_request_error";

function requestHeader(event: Sentry.Event, name: string): string | undefined {
  const headers = event.request?.headers;
  if (!headers) return undefined;

  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  )?.[1];
}

function isScopedAppRouterRender(event: Sentry.Event): boolean {
  const nextjs = event.contexts?.nextjs;
  const mechanism = event.exception?.values?.[0]?.mechanism;

  return (
    mechanism?.type === NEXT_REQUEST_ERROR_MECHANISM &&
    nextjs?.router_kind === "App Router" &&
    nextjs.router_path === "/[scope]" &&
    nextjs.route_type === "render"
  );
}

export function isDevelopmentHttpAbortEvent(event: Sentry.Event): boolean {
  return (
    event.environment === "development" &&
    exceptionValue(event) === "aborted" &&
    topFrameFilename(event) === "node:_http_server"
  );
}

export function isVercelSuspenseCacheScopeHeaderEvent(
  event: Sentry.Event
): boolean {
  const suspenseCacheHost = requestHeader(
    event,
    "x-vercel-sc-host"
  )?.toLowerCase();

  return (
    exceptionValue(event) === SCOPE_LAYOUT_MISSING_HEADERS_ERROR &&
    isScopedAppRouterRender(event) &&
    suspenseCacheHost?.endsWith(VERCEL_SUSPENSE_CACHE_HOST_SUFFIX) === true &&
    requestHeader(event, "x-vercel-sc-headers") !== undefined
  );
}

export function beforeSendServerEvent<TEvent extends Sentry.Event>(
  event: TEvent
): TEvent | null {
  if (
    isDevelopmentHttpAbortEvent(event) ||
    isVercelSuspenseCacheScopeHeaderEvent(event)
  ) {
    return null;
  }

  return event;
}
