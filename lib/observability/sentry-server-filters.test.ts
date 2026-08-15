import type * as Sentry from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
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
}): Sentry.Event {
  return {
    environment: input.environment,
    request: input.headers ? { headers: input.headers } : undefined,
    exception: {
      values: [
        {
          type: "Error",
          value: input.value,
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

  it("drops the missing-scope error only for Vercel Suspense Cache renders", () => {
    const event = serverEvent({
      environment: "production",
      value: "ScopeLayout: x-mogplex-scope-* headers missing for scoped route",
      headers: {
        "X-Vercel-Sc-Host": "iad1.suspense-cache.vercel-infra.com",
      },
    });

    expect(isVercelSuspenseCacheScopeHeaderEvent(event)).toBe(true);
    expect(beforeSendServerEvent(event)).toBeNull();
  });

  it("keeps real matcher regressions and unrelated cache-render errors", () => {
    const matcherRegression = serverEvent({
      environment: "production",
      value: "ScopeLayout: x-mogplex-scope-* headers missing for scoped route",
    });
    const unrelatedCacheError = serverEvent({
      environment: "production",
      value: "database unavailable",
      headers: {
        "x-vercel-sc-host": "iad1.suspense-cache.vercel-infra.com",
      },
    });
    const spoofedHost = serverEvent({
      environment: "production",
      value: "ScopeLayout: x-mogplex-scope-* headers missing for scoped route",
      headers: { "x-vercel-sc-host": "suspense-cache.example.com" },
    });

    for (const event of [matcherRegression, unrelatedCacheError, spoofedHost]) {
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
