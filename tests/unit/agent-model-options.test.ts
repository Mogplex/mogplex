import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NEW_AGENT_MODEL_ID,
  buildAgentModelOptions,
  buildSelectableAgentModelCatalog,
  compareModelsForDefaultSelection,
  getDefaultNewAgentModel,
} from "../../lib/agents/model-options";
import type { AIModel } from "../../lib/types";

test("getDefaultNewAgentModel prefers the configured Minimax default when it exists in the catalog", () => {
  const catalog: AIModel[] = [
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
    {
      id: DEFAULT_NEW_AGENT_MODEL_ID,
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.equal(getDefaultNewAgentModel(catalog), DEFAULT_NEW_AGENT_MODEL_ID);
});

test("getDefaultNewAgentModel falls back to the first visible catalog model when the configured default is absent", () => {
  const catalog: AIModel[] = [
    {
      id: "openai/gpt-5.4",
      provider: "openai",
      name: "GPT-5.4",
      context_length: 1_100_000,
      capabilities: [],
      is_available: true,
    },
    {
      id: "minimax/minimax-m2.5",
      provider: "minimax",
      name: "MiniMax M2.5",
      context_length: 200_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.equal(getDefaultNewAgentModel(catalog), "minimax/minimax-m2.5");
});

test("getDefaultNewAgentModel prefers the caller's preferred model when it is selectable", () => {
  const catalog: AIModel[] = [
    {
      id: "sakana/fugu-ultra",
      provider: "sakana",
      name: "Fugu Ultra",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
    {
      id: DEFAULT_NEW_AGENT_MODEL_ID,
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.equal(
    getDefaultNewAgentModel(catalog, "sakana/fugu-ultra"),
    "sakana/fugu-ultra"
  );
});

test("getDefaultNewAgentModel ignores a preferred model that is unavailable or hidden", () => {
  const catalog: AIModel[] = [
    {
      id: "sakana/fugu-ultra",
      provider: "sakana",
      name: "Fugu Ultra",
      context_length: 1_000_000,
      capabilities: [],
      is_available: false,
    },
    {
      id: DEFAULT_NEW_AGENT_MODEL_ID,
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.equal(
    getDefaultNewAgentModel(catalog, "sakana/fugu-ultra"),
    DEFAULT_NEW_AGENT_MODEL_ID
  );
  assert.equal(
    getDefaultNewAgentModel(catalog, "missing/not-in-catalog"),
    DEFAULT_NEW_AGENT_MODEL_ID
  );
});

test("compareModelsForDefaultSelection is a total order: provider, name, then id", () => {
  // The id tie-breaker keeps fallback selection deterministic even when two
  // catalog rows share a provider and display name — Postgres row order is
  // not stable, so without it the persisted pick could vary between calls.
  const rows = [
    { id: "openai/gpt-5.4", provider: "openai", name: "GPT-5.4" },
    { id: "minimax/minimax-m2.5-b", provider: "minimax", name: "MiniMax M2.5" },
    { id: "minimax/minimax-m2.5-a", provider: "minimax", name: "MiniMax M2.5" },
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude",
    },
  ];

  const sorted = rows.slice().sort(compareModelsForDefaultSelection);
  assert.deepEqual(
    sorted.map((row) => row.id),
    [
      "anthropic/claude-sonnet-4.6",
      "minimax/minimax-m2.5-a",
      "minimax/minimax-m2.5-b",
      "openai/gpt-5.4",
    ]
  );
});

test("buildAgentModelOptions lists available DB models and preserves legacy selections", () => {
  const catalog: AIModel[] = [
    {
      id: "minimax/minimax-m2.7",
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
    {
      id: "openai/gpt-5.4",
      provider: "openai",
      name: "GPT-5.4",
      context_length: 1_100_000,
      capabilities: [],
      is_available: false,
    },
  ];

  const options = buildAgentModelOptions(catalog, "legacy/custom-model");

  assert.deepEqual(
    options.map((option) => option.id),
    [
      "legacy/custom-model",
      "anthropic/claude-sonnet-4.6",
      "minimax/minimax-m2.7",
    ]
  );
  assert.equal(options[0]?.label, "Legacy · legacy/custom-model");
  assert.match(
    options[1]?.label ?? "",
    /Anthropic · Claude Sonnet 4\.6 · 1M ctx/
  );
  assert.match(options[2]?.label ?? "", /Minimax · MiniMax M2\.7 · 1M ctx/);
});

test("buildAgentModelOptions treats hidden DB rows as legacy selections only", () => {
  const catalog: AIModel[] = [
    {
      id: "legacy/hidden-model",
      provider: "legacy",
      name: "Hidden Legacy",
      context_length: 200_000,
      capabilities: [],
      is_available: true,
      is_hidden: true,
    },
    {
      id: "minimax/minimax-m2.7",
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];

  const options = buildAgentModelOptions(catalog, "legacy/hidden-model");

  assert.deepEqual(
    options.map((option) => [option.id, option.isLegacy]),
    [
      ["legacy/hidden-model", true],
      ["minimax/minimax-m2.7", false],
    ]
  );
});

test("getDefaultNewAgentModel ignores hidden copies of the configured default", () => {
  const catalog: AIModel[] = [
    {
      id: DEFAULT_NEW_AGENT_MODEL_ID,
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
      is_hidden: true,
    },
    {
      id: "openai/gpt-5.4",
      provider: "openai",
      name: "GPT-5.4",
      context_length: 1_100_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.equal(getDefaultNewAgentModel(catalog), "openai/gpt-5.4");
});

test("buildSelectableAgentModelCatalog keeps new selections limited to enabled models", () => {
  const enabledModels: AIModel[] = [
    {
      id: "minimax/minimax-m2.7",
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];
  const fullCatalog: AIModel[] = [
    ...enabledModels,
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.deepEqual(
    buildSelectableAgentModelCatalog(enabledModels, fullCatalog).map(
      (model) => model.id
    ),
    ["minimax/minimax-m2.7"]
  );
});

test("buildSelectableAgentModelCatalog preserves the current visible model even when it is disabled", () => {
  const enabledModels: AIModel[] = [
    {
      id: "minimax/minimax-m2.7",
      provider: "minimax",
      name: "MiniMax M2.7",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];
  const fullCatalog: AIModel[] = [
    ...enabledModels,
    {
      id: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      context_length: 1_000_000,
      capabilities: [],
      is_available: true,
    },
  ];

  assert.deepEqual(
    buildSelectableAgentModelCatalog(
      enabledModels,
      fullCatalog,
      "anthropic/claude-sonnet-4.6"
    ).map((model) => model.id),
    ["minimax/minimax-m2.7", "anthropic/claude-sonnet-4.6"]
  );
});
