import assert from "node:assert/strict";
import test from "node:test";
import { generateText as aiGenerateText } from "ai";
import {
  AutomationModelExecutionError,
  executeAutomationTextGeneration,
} from "../../lib/workflows/automation-model-execution";
import {
  createSuccessfulModelResult,
  createTestAutomationModel,
} from "./helpers/automation-model-execution-fixtures";

function captureLogger() {
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  return {
    warnings,
    errors,
    logger: {
      warn: (...args: unknown[]) => warnings.push(args),
      error: (...args: unknown[]) => errors.push(args),
    },
  };
}

test("logs a retryable provider failure without prompts or provider secrets", async () => {
  const captured = captureLogger();
  const testModel = createTestAutomationModel({
    onGenerate(callNumber) {
      if (callNumber === 1) {
        throw Object.assign(
          new Error(
            "Cannot connect. Authorization: Bearer provider-secret-token"
          ),
          { code: "UND_ERR_HEADERS_TIMEOUT" }
        );
      }
      return createSuccessfulModelResult("recovered");
    },
  });

  await executeAutomationTextGeneration({
    phase: "pr_review",
    requestedModelId: "zai/glm-5.2",
    generateText: aiGenerateText,
    logger: captured.logger,
    request: {
      model: testModel.model,
      providerOptions: {
        gateway: { order: ["blackbox"] },
      },
      prompt: "private prompt that must not be logged",
    },
  });

  assert.deepEqual(captured.warnings, [
    [
      "[automation-model] provider attempt failed",
      {
        event: "automation_model_provider_attempt_failed",
        phase: "pr_review",
        requestedModelId: "zai/glm-5.2",
        pinnedModelId: null,
        providerOnly: [],
        providerOrder: ["blackbox"],
        attempt: 1,
        willRetry: true,
        classification: "timeout",
        errorName: "Error",
        errorCode: "UND_ERR_HEADERS_TIMEOUT",
        errorType: null,
        statusCode: null,
        retryable: true,
        generationId: null,
        message: "Cannot connect. Authorization: Bearer [redacted]",
      },
    ],
  ]);
  assert.doesNotMatch(
    JSON.stringify(captured),
    /private prompt|provider-secret/
  );
});

test("logs the terminal provider failure after the bounded retry", async () => {
  const captured = captureLogger();
  const testModel = createTestAutomationModel({
    onGenerate() {
      throw Object.assign(new Error("Service temporarily unavailable"), {
        statusCode: 503,
        name: "GatewayInternalServerError",
        type: "internal_server_error",
        generationId: "gen-blackbox-failure",
        isRetryable: true,
      });
    },
  });

  await assert.rejects(
    () =>
      executeAutomationTextGeneration({
        phase: "pr_fix",
        requestedModelId: "zai/glm-5.2",
        generateText: aiGenerateText,
        logger: captured.logger,
        request: {
          model: testModel.model,
          providerOptions: {
            gateway: {
              only: ["blackbox"],
              order: ["blackbox"],
            },
          },
          prompt: "Apply a fix",
        },
      }),
    (error: unknown) => error instanceof AutomationModelExecutionError
  );

  assert.equal(captured.warnings.length, 1);
  assert.deepEqual(captured.errors, [
    [
      "[automation-model] generation failed",
      {
        event: "automation_model_generation_failed",
        phase: "pr_fix",
        requestedModelId: "zai/glm-5.2",
        pinnedModelId: null,
        providerOnly: ["blackbox"],
        providerOrder: ["blackbox"],
        attempts: 2,
        retryCount: 1,
        classification: "provider_unavailable",
        errorName: "GatewayInternalServerError",
        errorCode: null,
        errorType: "internal_server_error",
        statusCode: 503,
        retryable: true,
        generationId: "gen-blackbox-failure",
        message: "Service temporarily unavailable",
      },
    ],
  ]);
});

test("logs a dedicated event when Blackbox fails and Gateway uses another provider", async () => {
  const captured = captureLogger();
  const testModel = createTestAutomationModel({
    onGenerate() {
      return createSuccessfulModelResult("fallback response", {
        gateway: {
          generationId: "gen-fallback",
          routing: {
            resolvedProvider: "nebius",
            planningReasoning: "blackbox failed; routed to nebius",
            modelAttempts: [
              {
                canonicalSlug: "zai/glm-5.2",
                success: true,
                providerAttemptCount: 2,
                providerAttempts: [
                  {
                    provider: "blackbox",
                    credentialType: "system",
                    success: false,
                    statusCode: 503,
                  },
                  {
                    provider: "nebius",
                    credentialType: "system",
                    success: true,
                    statusCode: 200,
                  },
                ],
              },
            ],
          },
        },
      });
    },
  });

  await executeAutomationTextGeneration({
    phase: "pr_review",
    requestedModelId: "zai/glm-5.2",
    generateText: aiGenerateText,
    logger: captured.logger,
    request: {
      model: testModel.model,
      providerOptions: { gateway: { order: ["blackbox"] } },
      prompt: "Review this PR",
    },
  });

  assert.deepEqual(captured.warnings, [
    [
      "[automation-model] Blackbox failed. AI Gateway used a fallback provider",
      {
        event: "automation_model_blackbox_fallback_used",
        phase: "pr_review",
        requestedModelId: "zai/glm-5.2",
        pinnedModelId: null,
        providerOnly: [],
        providerOrder: ["blackbox"],
        preferredProvider: "blackbox",
        generationId: "gen-fallback",
        servedProvider: "nebius",
        planningReasoning: "blackbox failed; routed to nebius",
        fallbackProviders: ["nebius"],
        blackboxFailureCount: 1,
        blackboxFailures: [
          {
            canonicalSlug: "zai/glm-5.2",
            statusCode: 503,
            providerTimeout: false,
          },
        ],
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
                providerTimeout: false,
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
      },
    ],
  ]);
});
