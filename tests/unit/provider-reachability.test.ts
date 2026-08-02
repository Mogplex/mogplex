import assert from "node:assert/strict";
import test from "node:test";

import {
  isModelReachable,
  type UserProviderAccess,
} from "../../lib/models/provider-reachability";

const noAccess: UserProviderAccess = {
  hasGateway: false,
  hasOpenAi: false,
  hasAnthropic: false,
  hasOpenRouter: false,
};

test("openrouter/* requires an OpenRouter key — gateway access does NOT unlock it", () => {
  assert.equal(
    isModelReachable("openrouter/openai/gpt-5", {
      ...noAccess,
      hasGateway: true,
    }),
    false
  );
  assert.equal(
    isModelReachable("openrouter/openai/gpt-5", {
      ...noAccess,
      hasOpenRouter: true,
    }),
    true
  );
});

test("AI Gateway access reaches every non-openrouter provider", () => {
  const access = { ...noAccess, hasGateway: true };
  assert.equal(isModelReachable("openai/gpt-5", access), true);
  assert.equal(isModelReachable("anthropic/claude-opus-4-7", access), true);
  assert.equal(isModelReachable("moonshotai/kimi-k2.6", access), true);
  assert.equal(isModelReachable("deepseek/deepseek-v4-pro", access), true);
  assert.equal(isModelReachable("xai/grok-4", access), true);
});

test("direct provider keys reach only their own provider", () => {
  assert.equal(
    isModelReachable("openai/gpt-5", { ...noAccess, hasOpenAi: true }),
    true
  );
  assert.equal(
    isModelReachable("anthropic/claude-opus-4-7", {
      ...noAccess,
      hasOpenAi: true,
    }),
    false
  );
  assert.equal(
    isModelReachable("anthropic/claude-opus-4-7", {
      ...noAccess,
      hasAnthropic: true,
    }),
    true
  );
});

test("gateway-only labs are unreachable without gateway access", () => {
  assert.equal(
    isModelReachable("moonshotai/kimi-k2.6", { ...noAccess, hasOpenAi: true }),
    false
  );
  assert.equal(
    isModelReachable("deepseek/deepseek-v4-pro", {
      ...noAccess,
      hasAnthropic: true,
      hasOpenRouter: true,
    }),
    false
  );
});

test("a user with no provider access reaches nothing", () => {
  assert.equal(isModelReachable("openai/gpt-5", noAccess), false);
  assert.equal(isModelReachable("openrouter/openai/gpt-5", noAccess), false);
  assert.equal(isModelReachable("moonshotai/kimi-k2.6", noAccess), false);
});
