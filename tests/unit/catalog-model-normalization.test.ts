import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCatalogModel,
  normalizeCatalogModelName,
} from "../../lib/models/catalog-normalization";

test("normalizeCatalogModelName upgrades Claude Sonnet 4.6 label", () => {
  assert.equal(
    normalizeCatalogModelName("anthropic/claude-sonnet-4.6", "Claude Sonnet 4"),
    "Claude Sonnet 4.6"
  );
});

test("normalizeCatalogModelName upgrades Claude Opus 4.8 label", () => {
  assert.equal(
    normalizeCatalogModelName("anthropic/claude-opus-4.8", "claude-opus-4.8"),
    "Claude Opus 4.8"
  );
});

test("normalizeCatalogModelName upgrades Claude Sonnet 5 label", () => {
  assert.equal(
    normalizeCatalogModelName("anthropic/claude-sonnet-5", "claude-sonnet-5"),
    "Claude Sonnet 5"
  );
});

test("normalizeCatalogModelName upgrades Claude Fable 5 label", () => {
  assert.equal(
    normalizeCatalogModelName("anthropic/claude-fable-5", "claude-fable-5"),
    "Claude Fable 5"
  );
});

test("normalizeCatalogModel preserves unrelated catalog entries", () => {
  const model = {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
  };

  assert.deepEqual(normalizeCatalogModel(model), model);
});
