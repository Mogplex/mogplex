import assert from "node:assert/strict";
import test from "node:test";

import {
  gatewayProviderOptions,
  withGatewaySystemCaching,
} from "../../lib/models/gateway-provider-routing";

const baseContext = {
  userId: "user-123",
  tags: ["surface:test"],
};

test("pins lab models to fireworks while preserving user and tags", () => {
  assert.deepEqual(
    gatewayProviderOptions("moonshotai/kimi-k2.6", baseContext),
    {
      gateway: {
        user: "user-123",
        sort: "tps",
        tags: ["surface:test"],
        order: ["fireworks"],
      },
    }
  );
  assert.deepEqual(
    gatewayProviderOptions("deepseek/deepseek-r1", baseContext),
    {
      gateway: {
        user: "user-123",
        sort: "tps",
        tags: ["surface:test"],
        order: ["fireworks"],
      },
    }
  );
  assert.deepEqual(gatewayProviderOptions("minimax/minimax-m2", baseContext), {
    gateway: {
      user: "user-123",
      sort: "tps",
      tags: ["surface:test"],
      order: ["fireworks"],
    },
  });
});

test("pins nemotron-3-ultra to baseten via exact model match", () => {
  assert.deepEqual(
    gatewayProviderOptions("nvidia/nemotron-3-ultra-550b-a55b", baseContext)
      .gateway.order,
    ["baseten"]
  );
  // Exact-match pin must not leak to the sibling super model blackbox can't serve.
  assert.deepEqual(
    gatewayProviderOptions("nvidia/nemotron-3-super-120b-a12b", baseContext)
      .gateway.order,
    undefined
  );
});

test("matches lab prefixes case-insensitively and ignores substring matches", () => {
  assert.deepEqual(
    gatewayProviderOptions("  MoonshotAI/Kimi-K2.6  ", baseContext).gateway
      .order,
    ["fireworks"]
  );
  assert.deepEqual(
    gatewayProviderOptions("not-moonshotai/foo", baseContext).gateway.order,
    undefined
  );
  assert.deepEqual(
    gatewayProviderOptions("xdeepseek/foo", baseContext).gateway.order,
    undefined
  );
});

test("caps tags at the gateway limit and enables caching only when requested", () => {
  const options = gatewayProviderOptions("openai/gpt-5", {
    userId: "user-123",
    tags: Array.from({ length: 12 }, (_, index) => `tag:${index}`),
    caching: "auto",
  });

  assert.equal(options.gateway.user, "user-123");
  assert.deepEqual(options.gateway.tags, [
    "tag:0",
    "tag:1",
    "tag:2",
    "tag:3",
    "tag:4",
    "tag:5",
    "tag:6",
    "tag:7",
    "tag:8",
    "tag:9",
  ]);
  assert.equal(options.gateway.sort, "tps");
  assert.equal(options.gateway.caching, "auto");
});

test("omits optional gateway fields when no context requests them", () => {
  assert.deepEqual(gatewayProviderOptions("openai/gpt-5", { userId: "u" }), {
    gateway: { user: "u", sort: "tps" },
  });
});

test("adds one normalized fallback model while excluding the primary", () => {
  assert.deepEqual(
    gatewayProviderOptions(" XAI/Grok-4.5 ", { userId: "u" }, [
      " xai/grok-4.5 ",
      " zai/glm-5.2-fast ",
      "ZAI/GLM-5.2-FAST",
      "openai/gpt-5.4",
    ]),
    {
      gateway: {
        user: "u",
        sort: "tps",
        models: ["zai/glm-5.2-fast"],
      },
    }
  );
});

test("omits fallback models when no distinct non-empty candidate remains", () => {
  assert.deepEqual(
    gatewayProviderOptions("zai/glm-5.2-fast", { userId: "u" }, [
      "",
      "  ",
      "ZAI/GLM-5.2-FAST",
    ]),
    { gateway: { user: "u", sort: "tps" } }
  );
});

test("leaves system prompts as strings when gateway caching is off or omitted", () => {
  const off = withGatewaySystemCaching("system text", {
    userId: "u",
    caching: "off",
  });
  const omitted = withGatewaySystemCaching("system text", {
    userId: "u",
  });

  assert.equal(typeof off, "string");
  assert.equal(off, "system text");
  assert.equal(typeof omitted, "string");
  assert.equal(omitted, "system text");
});

test("adds Anthropic cache control to system prompts when gateway caching is enabled", () => {
  assert.deepEqual(
    withGatewaySystemCaching("system text", {
      userId: "u",
      caching: "auto",
    }),
    {
      role: "system",
      content: "system text",
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
    }
  );
});
