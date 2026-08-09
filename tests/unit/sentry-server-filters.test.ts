import assert from "node:assert/strict";
import test from "node:test";
import type * as Sentry from "@sentry/nextjs";
import {
  beforeSendServerEvent,
  isDevelopmentHttpAbortEvent,
} from "@/lib/observability/sentry-server-filters";

function serverEvent(input: {
  environment: string;
  value: string;
  filename: string;
}): Sentry.Event {
  return {
    environment: input.environment,
    exception: {
      values: [
        {
          type: "Error",
          value: input.value,
          stacktrace: {
            frames: [{ filename: input.filename }],
          },
        },
      ],
    },
  };
}

test("drops development Node HTTP socket aborts", () => {
  const event = serverEvent({
    environment: "development",
    value: "aborted",
    filename: "node:_http_server",
  });

  assert.equal(isDevelopmentHttpAbortEvent(event), true);
  assert.equal(beforeSendServerEvent(event), null);
});

test("keeps production abort events", () => {
  const event = serverEvent({
    environment: "production",
    value: "aborted",
    filename: "node:_http_server",
  });

  assert.equal(isDevelopmentHttpAbortEvent(event), false);
  assert.equal(beforeSendServerEvent(event), event);
});

test("keeps unrelated development server exceptions", () => {
  const event = serverEvent({
    environment: "development",
    value: "database unavailable",
    filename: "app/api/jobs/route.ts",
  });

  assert.equal(isDevelopmentHttpAbortEvent(event), false);
  assert.equal(beforeSendServerEvent(event), event);
});
