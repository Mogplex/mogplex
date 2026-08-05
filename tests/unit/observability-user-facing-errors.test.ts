import assert from "node:assert/strict";
import test from "node:test";
import {
  buildObservabilityIncidentId,
  presentObservabilityFailure,
  sanitizeObservabilityEvent,
  sanitizeObservabilityPayload,
  sanitizeObservabilityToolEntry,
} from "../../lib/observability/user-facing-errors";

test("observability incidents are stable and contain no raw diagnostic", () => {
  const raw = {
    id: "call-123456789",
    status: "failed",
    error: "INTERNAL_API_SECRET is required at http://worker.internal:8080/run",
    metadata: {
      stack: "Error: database failed\n    at execute (/srv/app.ts:42:1)",
      provider_failure_message: "postgres connection refused",
      detail: "opaque upstream response body containing sensitive context",
      error_code: "VERCEL_INTEGRATION_REQUIRED",
      child: { id: "node-1", error: "database connection failed" },
    },
  };

  const first = sanitizeObservabilityPayload(raw, "CALL", raw.id);
  const second = sanitizeObservabilityPayload(raw, "CALL", raw.id);
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(serialized.includes("INTERNAL_API_SECRET"), false);
  assert.equal(serialized.includes("worker.internal"), false);
  assert.equal(serialized.includes("/srv/app.ts"), false);
  assert.equal(serialized.includes("postgres"), false);
  assert.equal(serialized.includes("upstream response"), false);
  assert.equal(
    first.metadata.error_code,
    "VERCEL_INTEGRATION_REQUIRED",
    "stable machine codes remain available to clients"
  );
  assert.equal(serialized.includes("MOG-RUN-"), false);
  assert.match(serialized, /MOG-CALL-NODE1/);
  assert.match(first.error, /Incident MOG-/);
});

test("known actionable failures use specific safe guidance", () => {
  const incident = buildObservabilityIncidentId("CALL", "call-1");
  assert.match(
    presentObservabilityFailure("HTTP 429 rate limit exceeded", incident),
    /rate limit or quota/
  );
  assert.match(
    presentObservabilityFailure("deadline timed out", incident),
    /exceeded its time limit/
  );
  assert.match(
    presentObservabilityFailure("GitHub permission denied", incident),
    /Reconnect it in Settings/
  );
  assert.match(
    presentObservabilityFailure("MODEL_PROVIDER is required", incident),
    /model or provider configuration/
  );
});

test("failed events and tool diagnostics are sanitized at the API boundary", () => {
  const event = sanitizeObservabilityEvent({
    id: "event-1",
    event_type: "failed",
    message: "database password authentication failed",
    payload: { stderr: "secret stack trace" },
  });
  const tool = sanitizeObservabilityToolEntry({
    id: "call-1-tool-0",
    output_preview: "command failed: token=super-secret-value",
    output: { error: "STRIPE_SECRET_KEY is missing" },
  });

  assert.equal(JSON.stringify(event).includes("password"), false);
  assert.equal(JSON.stringify(tool).includes("super-secret-value"), false);
  assert.equal(JSON.stringify(tool).includes("STRIPE_SECRET_KEY"), false);
});

test("benign log progress is not misclassified as a failed run", () => {
  const event = sanitizeObservabilityEvent({
    id: "event-2",
    event_type: "log",
    message: "Retrying after HTTP 429 with exponential backoff",
    payload: {},
  });

  assert.equal(
    event.message,
    "Retrying after HTTP 429 with exponential backoff"
  );
});
