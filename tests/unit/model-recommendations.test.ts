import assert from "node:assert/strict";
import test from "node:test";
import { computeModelRecommendations } from "../../lib/models/recommendations";

test("computeModelRecommendations returns a balanced 2 frontier + 2 open mix", () => {
  const recommendations = computeModelRecommendations([
    {
      id: "minimax/minimax-m2.7",
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 204_800,
      pricing_input: 0.0000003,
      pricing_output: 0.0000012,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      pricing_input: 0.000003,
      pricing_output: 0.000015,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
    {
      id: "google/gemini-3-pro-preview",
      provider: "google",
      name: "Gemini 3 Pro Preview",
      context_length: 1_000_000,
      pricing_input: 0.000002,
      pricing_output: 0.000012,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
    {
      id: "openai/gpt-oss-120b",
      provider: "openai",
      name: "gpt-oss-120b",
      context_length: 128_000,
      pricing_input: 0.00000015,
      pricing_output: 0.0000006,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
    {
      id: "deepseek/deepseek-v3.2",
      provider: "deepseek",
      name: "DeepSeek V3.2",
      context_length: 128_000,
      pricing_input: 0.00000028,
      pricing_output: 0.00000042,
      capabilities: ["tool-use"],
      is_available: true,
    },
  ]);

  assert.equal(recommendations.size, 4);
  assert.deepEqual(Array.from(recommendations.entries()), [
    [
      "anthropic/claude-sonnet-4.6",
      { bucket: "frontier", rank: 1, reason: "frontier_latest_general" },
    ],
    [
      "google/gemini-3-pro-preview",
      { bucket: "frontier", rank: 2, reason: "frontier_fast_general" },
    ],
    [
      "minimax/minimax-m2.7",
      { bucket: "open", rank: 1, reason: "open_best_general" },
    ],
    [
      "openai/gpt-oss-120b",
      { bucket: "open", rank: 2, reason: "open_best_economy" },
    ],
  ]);
});

test("computeModelRecommendations ranks Claude Opus 4.8 as the top frontier pick when present", () => {
  const recommendations = computeModelRecommendations([
    {
      id: "anthropic/claude-opus-4.8",
      provider: "anthropic",
      name: "Claude Opus 4.8",
      context_length: 1_000_000,
      pricing_input: 0.000005,
      pricing_output: 0.000025,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      pricing_input: 0.000003,
      pricing_output: 0.000015,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
  ]);

  assert.equal(
    recommendations.get("anthropic/claude-opus-4.8")?.rank,
    1,
    "opus 4.8 should rank above sonnet 4.6 when both are available"
  );
  assert.equal(
    recommendations.get("anthropic/claude-opus-4.8")?.bucket,
    "frontier"
  );
});

test("computeModelRecommendations never recommends unavailable models", () => {
  const recommendations = computeModelRecommendations([
    {
      id: "minimax/minimax-m2.7",
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 204_800,
      pricing_input: 0.0000003,
      pricing_output: 0.0000012,
      capabilities: ["reasoning", "tool-use"],
      is_available: false,
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      pricing_input: 0.000003,
      pricing_output: 0.000015,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
    {
      id: "openai/gpt-oss-120b",
      provider: "openai",
      name: "gpt-oss-120b",
      context_length: 128_000,
      pricing_input: 0.00000015,
      pricing_output: 0.0000006,
      capabilities: ["reasoning", "tool-use"],
      is_available: true,
    },
  ]);

  assert.equal(recommendations.has("minimax/minimax-m2.7"), false);
  assert.equal(recommendations.has("anthropic/claude-sonnet-4.6"), true);
  assert.equal(recommendations.has("openai/gpt-oss-120b"), true);
});
