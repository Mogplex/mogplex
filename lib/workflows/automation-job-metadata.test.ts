import { describe, expect, it } from "vitest";
import {
  buildAutomationExecutionMetadataFields,
  mergeAutomationExecutionMetadata,
} from "./automation-job-metadata";
import type { AutomationModelExecutionMetadata } from "./automation-model-execution-types";

function execution(
  overrides: Partial<AutomationModelExecutionMetadata> = {}
): AutomationModelExecutionMetadata {
  return {
    phase: "pr_review",
    attempts: 1,
    retryCount: 0,
    retried: false,
    effectiveTimeoutMs: 750_000,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    finalFailureClass: null,
    finalFailureMessage: null,
    finalFailureStatusCode: null,
    ...overrides,
  };
}

function result(metadata: AutomationModelExecutionMetadata) {
  return { text: "", steps: [], usage: null, execution: metadata };
}

describe("fail-over chain in run metadata", () => {
  it("should keep every switch when executions are merged", () => {
    const merged = mergeAutomationExecutionMetadata([
      result(execution({ failoverModelIds: ["zai/glm-5.3-fast"] })),
      result(execution()),
      result(execution({ failoverModelIds: ["zai/glm-5.3-fast", "b"] })),
    ]);
    expect(merged?.failoverModelIds).toEqual(["zai/glm-5.3-fast", "b"]);
  });

  it("should omit the chain when no execution failed over", () => {
    const merged = mergeAutomationExecutionMetadata([result(execution())]);
    expect(merged).not.toHaveProperty("failoverModelIds");
  });

  it("should emit the chain as a dispatch event field", () => {
    expect(
      buildAutomationExecutionMetadataFields(
        execution({ failoverModelIds: ["zai/glm-5.3-fast"] })
      )
    ).toMatchObject({ model_failover_ids: ["zai/glm-5.3-fast"] });
    expect(
      buildAutomationExecutionMetadataFields(execution())
    ).not.toHaveProperty("model_failover_ids");
  });
});
