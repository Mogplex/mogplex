import type * as Sentry from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { SCOPE_LAYOUT_MISSING_HEADERS_ERROR } from "@/lib/scope-context";
import {
  beforeSendServerEvent,
  isDevelopmentHttpAbortEvent,
  isVercelSuspenseCacheScopeHeaderEvent,
  SENTRY_SERVER_IGNORE_SPANS,
} from "./sentry-server-filters";

function serverEvent(input: {
  environment?: string;
  value: string;
  filename?: string;
  headers?: Record<string, string>;
  scopedRender?: boolean;
}): Sentry.Event {
  return {
    environment: input.environment,
    request: input.headers ? { headers: input.headers } : undefined,
    contexts: input.scopedRender
      ? {
          nextjs: {
            request_path: "/monitoring",
            router_kind: "App Router",
            router_path: "/[scope]",
            route_type: "render",
          },
        }
      : undefined,
    exception: {
      values: [
        {
          type: "Error",
          value: input.value,
          mechanism: input.scopedRender
            ? {
                handled: false,
                type: "auto.function.nextjs.on_request_error",
              }
            : undefined,
          stacktrace: input.filename
            ? { frames: [{ filename: input.filename }] }
            : undefined,
        },
      ],
    },
  };
}

describe("beforeSendServerEvent", () => {
  it("drops development Node HTTP socket aborts", () => {
    const event = serverEvent({
      environment: "development",
      value: "aborted",
      filename: "node:_http_server",
    });

    expect(isDevelopmentHttpAbortEvent(event)).toBe(true);
    expect(beforeSendServerEvent(event)).toBeNull();
  });

  it("keeps production abort events and unrelated development exceptions", () => {
    const productionAbort = serverEvent({
      environment: "production",
      value: "aborted",
      filename: "node:_http_server",
    });
    const developmentError = serverEvent({
      environment: "development",
      value: "database unavailable",
      filename: "app/api/jobs/route.ts",
    });

    expect(isDevelopmentHttpAbortEvent(productionAbort)).toBe(false);
    expect(beforeSendServerEvent(productionAbort)).toBe(productionAbort);
    expect(isDevelopmentHttpAbortEvent(developmentError)).toBe(false);
    expect(beforeSendServerEvent(developmentError)).toBe(developmentError);
  });

  it("drops the exact production Suspense Cache event signature", () => {
    const event = serverEvent({
      environment: "production",
      value: SCOPE_LAYOUT_MISSING_HEADERS_ERROR,
      scopedRender: true,
      headers: {
        "X-Vercel-Sc-Headers": "[Filtered]",
        "X-Vercel-Sc-Host": "iad1.suspense-cache.vercel-infra.com",
      },
    });

    expect(isVercelSuspenseCacheScopeHeaderEvent(event)).toBe(true);
    expect(beforeSendServerEvent(event)).toBeNull();
  });

  it("keeps matcher regressions, client-like spoof attempts, and unrelated errors", () => {
    const matcherRegression = serverEvent({
      environment: "production",
      value: SCOPE_LAYOUT_MISSING_HEADERS_ERROR,
      scopedRender: true,
    });
    const clientLikeSpoof = serverEvent({
      environment: "production",
      value: SCOPE_LAYOUT_MISSING_HEADERS_ERROR,
      headers: {
        "x-vercel-sc-headers": "spoofed",
        "x-vercel-sc-host": "iad1.suspense-cache.vercel-infra.com",
      },
    });
    const unrelatedCacheError = serverEvent({
      environment: "production",
      value: "database unavailable",
      scopedRender: true,
      headers: {
        "x-vercel-sc-headers": "[Filtered]",
        "x-vercel-sc-host": "iad1.suspense-cache.vercel-infra.com",
      },
    });
    const incompleteCacheMarker = serverEvent({
      environment: "production",
      value: SCOPE_LAYOUT_MISSING_HEADERS_ERROR,
      scopedRender: true,
      headers: {
        "x-vercel-sc-host": "iad1.suspense-cache.vercel-infra.com",
      },
    });

    for (const event of [
      matcherRegression,
      clientLikeSpoof,
      unrelatedCacheError,
      incompleteCacheMarker,
    ]) {
      expect(isVercelSuspenseCacheScopeHeaderEvent(event)).toBe(false);
      expect(beforeSendServerEvent(event)).toBe(event);
    }
  });
});

it("ignores only raw PostgreSQL connection lifecycle spans", () => {
  expect(SENTRY_SERVER_IGNORE_SPANS).toEqual([
    { op: "db", name: "pg.connect" },
  ]);

  const [filter] = SENTRY_SERVER_IGNORE_SPANS;
  const ignored = [
    { op: "db", name: "pg.connect" },
    { op: "db", name: "pg-pool.connect" },
    { op: "db", name: "select agents.* from agents" },
    { op: "http.client", name: "pg.connect" },
  ].filter((span) => span.op === filter.op && span.name === filter.name);

  expect(ignored).toEqual([{ op: "db", name: "pg.connect" }]);
});
