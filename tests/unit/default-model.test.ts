import assert from "node:assert/strict";
import test from "node:test";

async function loadDefaultModelModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/models/default-model");
}

test("resolveUsableDefaultModelId prefers the configured MiniMax default when preferences are still empty", async () => {
  const { resolveUsableDefaultModelId } = await loadDefaultModelModule();

  const resolved = resolveUsableDefaultModelId(
    null,
    [
      { id: "minimax/minimax-m2.7", is_available: true },
      { id: "openai/gpt-5.4", is_available: true },
    ],
    []
  );

  assert.equal(resolved, "minimax/minimax-m2.7");
});

test("isUsableDefaultModelId treats missing preference rows as enabled for available models", async () => {
  const { isUsableDefaultModelId } = await loadDefaultModelModule();

  const usable = isUsableDefaultModelId(
    "minimax/minimax-m2.7",
    [
      { id: "minimax/minimax-m2.7", is_available: true },
      { id: "openai/gpt-5.4", is_available: true },
    ],
    []
  );

  assert.equal(usable, true);
});

test("default model resolver does not select unavailable models even when explicitly enabled", async () => {
  const { isUsableDefaultModelId, resolveUsableDefaultModelId } =
    await loadDefaultModelModule();

  const catalog = [
    { id: "sakana/fugu-ultra", is_available: false },
    { id: "openai/gpt-5.4", is_available: true },
  ];
  const preferences = [{ model_id: "sakana/fugu-ultra", is_enabled: true }];

  assert.equal(
    isUsableDefaultModelId("sakana/fugu-ultra", catalog, preferences),
    false
  );
  assert.equal(
    resolveUsableDefaultModelId("sakana/fugu-ultra", catalog, preferences),
    "openai/gpt-5.4"
  );
});

test("pickUsableDefaultModelId returns null when no usable models exist", async () => {
  const { pickUsableDefaultModelId } = await loadDefaultModelModule();

  assert.equal(pickUsableDefaultModelId(null, []), null);
  assert.equal(pickUsableDefaultModelId("sakana/fugu-ultra", []), null);
  assert.equal(pickUsableDefaultModelId("minimax/minimax-m2.7", []), null);
});

test("pickUsableDefaultModelId only chooses the static default when it survived filtering", async () => {
  const { pickUsableDefaultModelId } = await loadDefaultModelModule();

  assert.equal(
    pickUsableDefaultModelId("sakana/fugu-ultra", ["openai/gpt-5.4"]),
    "openai/gpt-5.4"
  );
  assert.equal(
    pickUsableDefaultModelId(null, ["minimax/minimax-m2.7", "openai/gpt-5.4"]),
    "minimax/minimax-m2.7"
  );
});

test("resolveUsableDefaultModelId keeps the static terminal fallback for runtime callers", async () => {
  const { resolveUsableDefaultModelId } = await loadDefaultModelModule();

  // Runtime/display paths need a concrete ID and never persist it; an
  // unusable fallback fails loudly at invocation. The nullable fail-closed
  // contract lives on pickUsableDefaultModelId / the scoped stored resolver.
  assert.equal(
    resolveUsableDefaultModelId(null, [], []),
    "minimax/minimax-m2.7"
  );
});

test("fallback selection is deterministic and agrees with /api/models regardless of catalog row order", async () => {
  // loadUserModelCatalogState reads ai_models without ORDER BY, so the
  // catalog can arrive in any order. The first-usable fallback must not
  // depend on that order, and must match the fallback getDefaultNewAgentModel
  // computes for /api/models' default_model — otherwise a persisted fork
  // could disagree with the default the UI displays (and vary between calls).
  const { resolveUsableDefaultModelId } = await loadDefaultModelModule();
  const { getDefaultNewAgentModel } =
    await import("../../lib/agents/model-options");

  // Neither the stored default nor the static default is present, forcing
  // both paths onto their first-selectable fallback.
  const catalog = [
    {
      id: "openai/gpt-5.4",
      provider: "openai",
      name: "GPT-5.4",
      context_length: 1_100_000,
      capabilities: [],
      is_available: true,
    },
    {
      id: "sakana/fugu-ultra",
      provider: "sakana",
      name: "Fugu Ultra",
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
  ];
  const reversed = catalog.slice().reverse();

  assert.equal(
    resolveUsableDefaultModelId(null, catalog, []),
    "anthropic/claude-sonnet-4.6"
  );
  assert.equal(
    resolveUsableDefaultModelId(null, reversed, []),
    "anthropic/claude-sonnet-4.6"
  );
  assert.equal(
    getDefaultNewAgentModel(catalog, null),
    resolveUsableDefaultModelId(null, catalog, [])
  );
  assert.equal(
    getDefaultNewAgentModel(reversed, null),
    resolveUsableDefaultModelId(null, reversed, [])
  );
});

test("default model resolver does not select hidden catalog rows", async () => {
  const { isUsableDefaultModelId, resolveUsableDefaultModelId } =
    await loadDefaultModelModule();

  const catalog = [
    {
      id: "minimax/minimax-m2.7",
      is_available: true,
      is_hidden: true,
    },
    {
      id: "openai/gpt-5.4",
      is_available: true,
      is_hidden: false,
    },
  ];

  assert.equal(
    isUsableDefaultModelId("minimax/minimax-m2.7", catalog, []),
    false
  );
  assert.equal(
    resolveUsableDefaultModelId(null, catalog, []),
    "openai/gpt-5.4"
  );
});
