import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomationFailureBreakdowns,
  buildAutomationFailureFilterOptions,
  filterAutomationFailureRecords,
  presentAutomationFailureDiagnostics,
  summarizeAutomationResilience,
  type AutomationFailureRecord,
} from "../../lib/automation-failure-observability";

function createFailureRecord(
  overrides: Partial<AutomationFailureRecord> = {}
): AutomationFailureRecord {
  return {
    id: "evt_1",
    jobRunId: "job_1",
    createdAt: "2026-04-14T12:00:00.000Z",
    sourceKind: "flow",
    sourceType: "pr_opened",
    reason: "AUTOMATION_FAILED",
    reasonLabel: "Automation failed",
    outcome: "failed",
    repo: {
      id: "repo_1",
      fullName: "webrenew/mogplex",
    },
    agent: {
      id: "agent_1",
      name: "Reviewer",
      slug: "reviewer",
      model: "openai/gpt-5.4",
      provider: "openai",
    },
    diagnostics: {
      failureClass: "timeout",
      failureLabel: "Timeout",
      failureMessage: "Gateway request timed out",
      failureStatusCode: 504,
      executionPhase: "generate",
      effectiveTimeoutMs: 180000,
      timeoutBucket: "under_5m",
      timeoutBucketLabel: "3m-4.9m",
      retryAttempted: true,
      retryCount: 1,
      attempts: 2,
      recoveredFromFailureClass: null,
      recoveredFromFailureLabel: null,
      recoveredFromMessage: null,
    },
    metadata: {
      model_failure_class: "timeout",
    },
    ...overrides,
  };
}

test("presentAutomationFailureDiagnostics normalizes model metadata", () => {
  const diagnostics = presentAutomationFailureDiagnostics({
    model_failure_class: "provider_unavailable",
    model_failure_message: "Provider unavailable",
    model_failure_status_code: 503,
    model_execution_phase: "generate",
    model_effective_timeout_ms: 360000,
    model_retry_attempted: true,
    model_retry_count: 2,
    model_attempts: 3,
    model_recovered_from_failure_class: "rate_limited",
    model_recovered_from_message: "Recovered after retry",
  });

  assert.deepEqual(diagnostics, {
    failureClass: "provider_unavailable",
    failureLabel: "Provider unavailable",
    failureMessage: "Provider unavailable",
    failureStatusCode: 503,
    executionPhase: "generate",
    effectiveTimeoutMs: 360000,
    timeoutBucket: "5m_plus",
    timeoutBucketLabel: "5m+",
    retryAttempted: true,
    retryCount: 2,
    attempts: 3,
    recoveredFromFailureClass: "rate_limited",
    recoveredFromFailureLabel: "Rate limited",
    recoveredFromMessage: "Recovered after retry",
  });
});

test("buildAutomationFailureFilterOptions and filters operate on failed records", () => {
  const timeoutRecord = createFailureRecord();
  const authRecord = createFailureRecord({
    id: "evt_2",
    sourceType: "manual_retry",
    agent: {
      id: "agent_2",
      name: "Fixer",
      slug: "fixer",
      model: "anthropic/claude-sonnet-4",
      provider: "anthropic",
    },
    diagnostics: {
      ...createFailureRecord().diagnostics,
      failureClass: "authentication",
      failureLabel: "Authentication",
      failureStatusCode: 401,
      timeoutBucket: "unknown",
      timeoutBucketLabel: "Unknown",
      retryAttempted: false,
      retryCount: 0,
      attempts: 1,
    },
  });

  const filterOptions = buildAutomationFailureFilterOptions([
    timeoutRecord,
    authRecord,
  ]);
  const filtered = filterAutomationFailureRecords([timeoutRecord, authRecord], {
    failureClass: "authentication",
    provider: "anthropic",
  });

  assert.deepEqual(
    filterOptions.failureClasses.map((option) => option.value),
    ["authentication", "timeout"]
  );
  assert.deepEqual(
    filterOptions.providers.map((option) => option.value),
    ["anthropic", "openai"]
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "evt_2");
});

test("resilience summary counts dependency failures separately from provider ones", () => {
  // dependencyFailures is a new counter and the UI reads it as
  // `summary?.dependencyFailures ?? 0`, so a plumbing break would render a
  // permanent zero that neither TypeScript nor the `?? 0` default would catch.
  // Kept out of providerFailures on purpose: these are our own dependencies
  // failing, which points at Mogplex/Supabase rather than the model provider.
  const dependencyFailure = createFailureRecord({
    id: "evt_dep",
    diagnostics: {
      ...createFailureRecord().diagnostics,
      failureClass: "dependency_unavailable",
      failureLabel: "Dependency unavailable",
      failureStatusCode: null,
    },
  });
  const providerFailure = createFailureRecord({
    id: "evt_provider",
    diagnostics: {
      ...createFailureRecord().diagnostics,
      failureClass: "provider_unavailable",
      failureLabel: "Provider unavailable",
    },
  });

  const summary = summarizeAutomationResilience([
    dependencyFailure,
    providerFailure,
  ]);

  assert.equal(summary.dependencyFailures, 1);
  assert.equal(summary.providerFailures, 1);

  // And it reaches the filter/breakdown surfaces the dashboard drives from.
  const breakdowns = buildAutomationFailureBreakdowns([
    dependencyFailure,
    providerFailure,
  ]);
  assert.ok(
    breakdowns.byFailureClass.some(
      (item) => item.key === "dependency_unavailable" && item.count === 1
    ),
    "dependency_unavailable must appear in the failure-class breakdown"
  );
});

test("breakdowns and resilience summary reflect failure classes and recoveries", () => {
  const timeoutFailure = createFailureRecord();
  const providerFailure = createFailureRecord({
    id: "evt_3",
    diagnostics: {
      ...createFailureRecord().diagnostics,
      failureClass: "provider_unavailable",
      failureLabel: "Provider unavailable",
      failureStatusCode: 503,
      timeoutBucket: "5m_plus",
      timeoutBucketLabel: "5m+",
    },
  });
  const recoveredRun = createFailureRecord({
    id: "evt_4",
    outcome: "completed",
    diagnostics: {
      ...createFailureRecord().diagnostics,
      failureClass: null,
      failureLabel: null,
      failureMessage: null,
      failureStatusCode: null,
      retryAttempted: true,
      retryCount: 1,
      attempts: 2,
      recoveredFromFailureClass: "timeout",
      recoveredFromFailureLabel: "Timeout",
      recoveredFromMessage: "Recovered on retry",
    },
  });

  const breakdowns = buildAutomationFailureBreakdowns([
    timeoutFailure,
    providerFailure,
  ]);
  const summary = summarizeAutomationResilience([
    timeoutFailure,
    providerFailure,
    recoveredRun,
  ]);

  assert.deepEqual(
    breakdowns.byFailureClass.map((item) => [item.key, item.count]),
    [
      ["provider_unavailable", 1],
      ["timeout", 1],
    ]
  );
  assert.deepEqual(
    breakdowns.byTimeoutBucket.map((item) => [item.key, item.count]),
    [
      ["under_5m", 1],
      ["5m_plus", 1],
    ]
  );
  assert.deepEqual(summary, {
    failedTotal: 2,
    successfulRecoveries: 1,
    retriedFailures: 2,
    timeoutFailures: 1,
    authenticationFailures: 0,
    configurationFailures: 0,
    providerFailures: 1,
    dependencyFailures: 0,
  });
});
