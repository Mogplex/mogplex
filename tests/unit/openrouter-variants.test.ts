import assert from "node:assert/strict";
import test from "node:test";

import { applyOpenRouterNitro } from "../../lib/models/openrouter-variants";

test("applyOpenRouterNitro appends :nitro when no variant is set", () => {
  assert.equal(
    applyOpenRouterNitro("deepseek/deepseek-v4-pro"),
    "deepseek/deepseek-v4-pro:nitro"
  );
  assert.equal(
    applyOpenRouterNitro("moonshotai/kimi-k2.6"),
    "moonshotai/kimi-k2.6:nitro"
  );
  assert.equal(applyOpenRouterNitro("openai/gpt-5.4"), "openai/gpt-5.4:nitro");
});

test("applyOpenRouterNitro respects an existing variant", () => {
  assert.equal(
    applyOpenRouterNitro("deepseek/deepseek-v4-pro:nitro"),
    "deepseek/deepseek-v4-pro:nitro"
  );
  assert.equal(
    applyOpenRouterNitro("deepseek/deepseek-v4-pro:floor"),
    "deepseek/deepseek-v4-pro:floor"
  );
  assert.equal(
    applyOpenRouterNitro("anthropic/claude-opus-4-7:thinking"),
    "anthropic/claude-opus-4-7:thinking"
  );
  assert.equal(
    applyOpenRouterNitro("perplexity/sonar:online"),
    "perplexity/sonar:online"
  );
});
