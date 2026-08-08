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

test("failed jobs keep benign dispatch context while scrubbing diagnostics", () => {
  const raw = {
    id: "12ae72a2-aaae-4578-83d8-f602e1dbf6f6",
    status: "failed",
    error: "TRIGGER_SECRET_KEY is required at http://worker.internal:8080/run",
    metadata: {
      pr_url: "https://github.com/Mogplex/cli/pull/104",
      pr_title: "chore(deps): bump the npm-minor-and-patch group",
      pr_author: "dependabot[bot]",
      pr_number: 104,
      base_ref: "main",
      head_ref: "dependabot/npm_and_yarn/npm-minor-and-patch",
      base_sha: "dcdd9de2712096d52253762927d31154e52f9563",
      head_sha: "e8bce4bee4ec43b46fecb4ef30c005b5993b6876",
      repo_full_name: "Mogplex/cli",
      review_dedup_key:
        "github-pr-review:flow:11cd584d:pr_opened:ac481943:150968809:104:e8bce4be",
      source_type: "pr_opened",
      detail: "opaque upstream response body containing sensitive context",
    },
    latest_dispatch_event: {
      id: "8cb958cc-8d6a-4356-8065-59d3347b4145",
      outcome: "failed",
      reason: "PR_REVIEW_INFRA_FAILED",
      metadata: {
        runtime_provider: "trigger",
        review_outcome: "PR_REVIEW_INFRA_FAILED",
        review_outcome_label: "Automation infra failed",
        model_execution_phase: "pr_review:model_resolution",
        model_failure_class: "configuration",
        model_failure_message: "postgres connection refused",
        review_check_run_url: "https://github.com/Mogplex/cli/runs/93044681185",
      },
    },
  };

  const sanitized = sanitizeObservabilityPayload(raw, "JOB", raw.id);
  const serialized = JSON.stringify(sanitized);

  // Diagnostics still scrub, fail-closed for unknown prose fields.
  assert.equal(serialized.includes("TRIGGER_SECRET_KEY"), false);
  assert.equal(serialized.includes("postgres"), false);
  assert.equal(serialized.includes("upstream response"), false);

  // Benign dispatch context set before the failure must survive verbatim.
  assert.deepEqual(
    { ...sanitized.metadata, detail: "scrubbed" },
    { ...raw.metadata, detail: "scrubbed" }
  );
  assert.equal(
    sanitized.latest_dispatch_event.reason,
    "PR_REVIEW_INFRA_FAILED",
    "reason codes stay machine-readable so labels format correctly"
  );
  assert.equal(
    sanitized.latest_dispatch_event.metadata.runtime_provider,
    "trigger"
  );
  assert.equal(
    sanitized.latest_dispatch_event.metadata.model_failure_class,
    "configuration",
    "known failure classes remain filterable"
  );
  assert.equal(
    sanitized.latest_dispatch_event.metadata.review_outcome_label,
    "Automation infra failed"
  );
  assert.equal(
    sanitized.latest_dispatch_event.metadata.review_check_run_url,
    "https://github.com/Mogplex/cli/runs/93044681185"
  );
});

test("token-shaped secrets in failure context are scrubbed unless key-scoped", () => {
  const raw = {
    id: "job-7",
    status: "failed",
    error: "run failed",
    metadata: {
      captured_value: "AKIAIOSFODNN7EXAMPLE",
      opaque_body: "DEADBEEF0123456789ABCDEF0123456789ABCDEF",
      env_name: "STRIPE_WEBHOOK_SIGNING_SECRET",
      resolution: "timeout",
      trace_url: "https://logs.example.com/run/7",
      reason: "PR_REVIEW_INFRA_FAILED",
      review_outcome: "PR_REVIEW_INFRA_FAILED",
      retry_class: "timeout",
    },
  };

  const sanitized = sanitizeObservabilityPayload(raw, "JOB", raw.id);
  const serialized = JSON.stringify(sanitized);

  // Value shape is not proof of benignity: token-shaped strings, bare
  // env-var names, class-vocabulary words, and non-GitHub URLs under
  // unknown keys all fail closed.
  assert.equal(serialized.includes("AKIAIOSFODNN7EXAMPLE"), false);
  assert.equal(serialized.includes("DEADBEEF"), false);
  assert.equal(serialized.includes("STRIPE_WEBHOOK_SIGNING_SECRET"), false);
  assert.match(sanitized.metadata.resolution, /Incident MOG-/);
  assert.equal(serialized.includes("logs.example.com"), false);

  // Enum-carrying keys keep their machine codes and failure classes.
  assert.equal(sanitized.metadata.reason, "PR_REVIEW_INFRA_FAILED");
  assert.equal(sanitized.metadata.review_outcome, "PR_REVIEW_INFRA_FAILED");
  assert.equal(sanitized.metadata.retry_class, "timeout");
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
