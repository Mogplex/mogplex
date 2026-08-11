import assert from "node:assert/strict";
import test from "node:test";
import { agentOperator } from "../../lib/flows/operators/agent";
import { resolveFlowAgentOverrides } from "../../lib/workflows/automation-job-context-resolution";
import {
  AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL,
  getAutomationModelFallbackIds,
  getAutomationModelFallbackIdsWithOverride,
} from "../../lib/workflows/automation-model-defaults";

test("agent node coercion keeps a fallback model override and drops junk", () => {
  const coerce = agentOperator.coerceData;
  assert.equal(
    coerce({ fallbackModelOverride: "openai/gpt-5.4" }).fallbackModelOverride,
    "openai/gpt-5.4"
  );
  assert.equal(coerce({}).fallbackModelOverride, null);
  assert.equal(
    coerce({ fallbackModelOverride: "" }).fallbackModelOverride,
    null
  );
  assert.equal(
    coerce({ fallbackModelOverride: 42 }).fallbackModelOverride,
    null
  );
});

test("resolveFlowAgentOverrides carries the node's fallback model onto the run context", () => {
  const agent = {
    id: "agent-1",
    name: "Reviewer",
    slug: "reviewer",
    system_prompt: "Review things.",
    max_steps: 10,
    timeout_ms: 1000,
  };
  const baseNode = {
    id: "node-1",
    type: "agent" as const,
    position: { x: 0, y: 0 },
  };

  const withFallback = resolveFlowAgentOverrides(
    agent,
    {
      ...baseNode,
      data: {
        label: "Reviewer",
        agentId: "agent-1",
        modelOverride: "openai/gpt-5.4",
        fallbackModelOverride: "zai/glm-5.2-fast",
      },
    },
    "openai/gpt-5.4"
  );
  assert.equal(withFallback.fallback_model, "zai/glm-5.2-fast");

  const withoutFallback = resolveFlowAgentOverrides(
    agent,
    {
      ...baseNode,
      data: {
        label: "Reviewer",
        agentId: "agent-1",
        modelOverride: "openai/gpt-5.4",
      },
    },
    "openai/gpt-5.4"
  );
  assert.equal(withoutFallback.fallback_model, null);
});

test("a user-picked fallback leads the gateway fallback pool", () => {
  assert.deepEqual(
    getAutomationModelFallbackIdsWithOverride(
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.4",
      "google/gemini-3-flash"
    ),
    ["openai/gpt-5.4", "google/gemini-3-flash"]
  );
  // No env pool configured: the user's fallback alone replaces the defaults.
  assert.deepEqual(
    getAutomationModelFallbackIdsWithOverride(
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.4"
    ),
    ["openai/gpt-5.4"]
  );
});

test("the fallback pool composition ignores blank or primary-echoing overrides", () => {
  // Blank override: identical to the plain pool resolution.
  assert.deepEqual(
    getAutomationModelFallbackIdsWithOverride(
      "openai/gpt-5.4",
      "  ",
      "google/gemini-3-flash"
    ),
    getAutomationModelFallbackIds("openai/gpt-5.4", "google/gemini-3-flash")
  );
  // Override echoing the primary is filtered; the env pool still applies.
  assert.deepEqual(
    getAutomationModelFallbackIdsWithOverride(
      "openai/gpt-5.4",
      "openai/gpt-5.4",
      "google/gemini-3-flash"
    ),
    ["google/gemini-3-flash"]
  );
  // Override echoing the primary with no env pool falls back to defaults.
  assert.deepEqual(
    getAutomationModelFallbackIdsWithOverride(
      "openai/gpt-5.4",
      "openai/gpt-5.4"
    ),
    AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL.filter(
      (modelId) => modelId !== "openai/gpt-5.4"
    )
  );
});
