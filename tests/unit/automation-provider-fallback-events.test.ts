import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOperatorBlackboxFallbackEvent,
  persistOperatorBlackboxFallbackEvent,
  stripOperatorOnlyProviderDetails,
} from "../../lib/workflows/automation-provider-fallback-events";
import type { AutomationModelExecutionMetadata } from "../../lib/workflows/automation-model-execution-types";

const EXECUTION: AutomationModelExecutionMetadata = {
  phase: "pr_review",
  attempts: 1,
  retryCount: 0,
  retried: false,
  effectiveTimeoutMs: 300_000,
  recoveredFromFailureClass: null,
  recoveredFromMessage: null,
  finalFailureClass: null,
  finalFailureMessage: null,
  finalFailureStatusCode: null,
  requestedModelId: "zai/glm-5.2",
  observedUsage: {
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    generationId: "gen-fallback",
    generationIds: ["gen-fallback"],
  },
  gatewayModelAttemptCount: 1,
  gatewayModelAttempts: [
    {
      canonicalSlug: "zai/glm-5.2",
      modelId: null,
      success: true,
      providerAttemptCount: 2,
      providerAttempts: [
        {
          provider: "blackbox",
          success: false,
          statusCode: 503,
          providerTimeout: true,
        },
        {
          provider: "nebius",
          success: true,
          statusCode: 200,
          providerTimeout: false,
        },
      ],
    },
  ],
};

const EVENT_INPUT = {
  affectedUserId: "00000000-0000-4000-8000-000000000001",
  jobRunId: "00000000-0000-4000-8000-000000000002",
  repoId: "00000000-0000-4000-8000-000000000003",
  modelCallStartedAt: "2026-08-19T18:00:00.000Z",
  execution: EXECUTION,
};

test("builds a private Blackbox fallback event from safe routing details", () => {
  assert.deepEqual(buildOperatorBlackboxFallbackEvent(EVENT_INPUT), {
    affected_user_id: EVENT_INPUT.affectedUserId,
    job_run_id: EVENT_INPUT.jobRunId,
    repo_id: EVENT_INPUT.repoId,
    model_call_started_at: EVENT_INPUT.modelCallStartedAt,
    phase: "pr_review",
    requested_model_id: "zai/glm-5.2",
    pinned_model_id: null,
    served_provider: "nebius",
    fallback_providers: ["nebius"],
    blackbox_failure_count: 1,
    blackbox_failure_status_codes: [503],
    blackbox_provider_timeout: true,
    gateway_model_attempt_count: 1,
    generation_ids: ["gen-fallback"],
  });
});

test("does not create the private event without a failed Blackbox attempt", () => {
  assert.equal(
    buildOperatorBlackboxFallbackEvent({
      ...EVENT_INPUT,
      execution: {
        ...EXECUTION,
        gatewayModelAttempts: [
          {
            canonicalSlug: "zai/glm-5.2",
            modelId: null,
            success: true,
            providerAttemptCount: 1,
            providerAttempts: [
              {
                provider: "blackbox",
                success: true,
                statusCode: 200,
                providerTimeout: false,
              },
            ],
          },
        ],
      },
    }),
    null
  );
});

test("removes operator-only provider attempts from user-facing ai_calls metadata", () => {
  const redacted = stripOperatorOnlyProviderDetails(EXECUTION);

  assert.deepEqual(redacted.gatewayModelAttempts, [
    {
      canonicalSlug: "zai/glm-5.2",
      modelId: null,
      success: true,
      providerAttemptCount: 2,
    },
  ]);
  assert.equal(
    JSON.stringify(redacted).includes("blackbox"),
    false,
    "provider names must not reach user-facing metadata"
  );
});

test("writes the private event idempotently and reports storage failures", async () => {
  const writes: Array<{ table: string; row: unknown; options: unknown }> = [];
  const successfulClient = {
    from(table: string) {
      return {
        async upsert(row: unknown, options: unknown) {
          writes.push({ table, row, options });
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;

  assert.equal(
    await persistOperatorBlackboxFallbackEvent(EVENT_INPUT, successfulClient),
    null
  );
  assert.deepEqual(writes, [
    {
      table: "operator_ai_provider_fallback_events",
      row: buildOperatorBlackboxFallbackEvent(EVENT_INPUT),
      options: {
        onConflict: "job_run_id,phase,model_call_started_at",
        ignoreDuplicates: true,
      },
    },
  ]);

  const failingClient = {
    from() {
      return {
        async upsert() {
          return { error: { message: "operator log unavailable" } };
        },
      };
    },
  } as unknown as SupabaseClient;
  assert.equal(
    await persistOperatorBlackboxFallbackEvent(EVENT_INPUT, failingClient),
    "operator log unavailable"
  );
});

test("tryLogAiCall stores the private event but redacts provider details from ai_calls", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const { tryLogAiCall } =
    await import("../../lib/workflows/automation-job-persistence");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  let operatorEvent: unknown = null;
  let aiCall: Record<string, unknown> | null = null;

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: (table: string) => {
      if (table === "operator_ai_provider_fallback_events") {
        return {
          upsert: async (row: unknown) => {
            operatorEvent = row;
            return { error: null };
          },
        };
      }
      if (table === "ai_calls") {
        return {
          insert: async (row: Record<string, unknown>) => {
            aiCall = row;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  });

  try {
    assert.equal(
      await tryLogAiCall({
        context: {
          metadata: {},
          assignmentType: "pr_review",
          skillId: null,
          agent: {
            model: "zai/glm-5.2",
            system_prompt: null,
          },
          repo: {
            id: EVENT_INPUT.repoId,
            user_id: EVENT_INPUT.affectedUserId,
            full_name: "acme/widgets",
          },
        },
        jobRunId: EVENT_INPUT.jobRunId,
        status: "success",
        startedAt: EVENT_INPUT.modelCallStartedAt,
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 20,
        execution: EXECUTION,
      }),
      null
    );

    assert.deepEqual(
      operatorEvent,
      buildOperatorBlackboxFallbackEvent(EVENT_INPUT)
    );
    assert.ok(aiCall);
    const capturedAiCall = aiCall as unknown as Record<string, unknown>;
    const metadata = capturedAiCall.metadata as {
      automation_execution: AutomationModelExecutionMetadata;
    };
    assert.equal(
      JSON.stringify(metadata.automation_execution).includes("blackbox"),
      false
    );
    assert.deepEqual(metadata.automation_execution.gatewayModelAttempts, [
      {
        canonicalSlug: "zai/glm-5.2",
        modelId: null,
        success: true,
        providerAttemptCount: 2,
      },
    ]);
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
});
