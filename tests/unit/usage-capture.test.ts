import assert from "node:assert/strict";
import test from "node:test";

import {
  captureUsage,
  EMPTY_CAPTURED_USAGE,
  fillUsageGaps,
  mergeUsage,
} from "../../lib/observability/usage";
import type { LanguageModelUsage, ProviderMetadata } from "ai";

test("EMPTY_CAPTURED_USAGE is frozen so callers cannot mutate the sentinel", () => {
  assert.equal(Object.isFrozen(EMPTY_CAPTURED_USAGE), true);
  assert.throws(() => {
    EMPTY_CAPTURED_USAGE.inputTokens = 1;
  }, TypeError);
  assert.equal(EMPTY_CAPTURED_USAGE.inputTokens, null);
  assert.deepEqual(EMPTY_CAPTURED_USAGE.generationIds, []);
  // Inner array is also frozen to prevent runtime mutation
  assert.throws(() => {
    (EMPTY_CAPTURED_USAGE.generationIds as string[]).push("gen_abc");
  }, TypeError);
});

test("captureUsage reads token classes and gateway generation metadata", () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 50,
    inputTokenDetails: {
      noCacheTokens: 60,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
    },
    outputTokenDetails: {
      textTokens: 40,
      reasoningTokens: 10,
    },
    totalTokens: 150,
  } satisfies LanguageModelUsage;
  const metadata = {
    gateway: { generationId: "gen_abc" },
  } satisfies ProviderMetadata;

  assert.deepEqual(captureUsage(usage, metadata), {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 30,
    cacheCreationInputTokens: 10,
    reasoningTokens: 10,
    generationId: "gen_abc",
    generationIds: ["gen_abc"],
  });
});

test("captureUsage falls back to deprecated and provider-specific fields", () => {
  const usage = {
    inputTokens: undefined,
    outputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: undefined,
    cachedInputTokens: 7,
    reasoningTokens: 3,
  } satisfies LanguageModelUsage;
  const metadata = {
    anthropic: { cacheCreationInputTokens: 11 },
  } satisfies ProviderMetadata;

  assert.deepEqual(captureUsage(usage, metadata), {
    inputTokens: null,
    outputTokens: null,
    cacheReadInputTokens: 7,
    cacheCreationInputTokens: 11,
    reasoningTokens: 3,
    generationId: null,
    generationIds: [],
  });
});

test("mergeUsage adds token classes and keeps the first generation id", () => {
  assert.deepEqual(
    mergeUsage(
      {
        inputTokens: 5,
        outputTokens: null,
        cacheReadInputTokens: 2,
        cacheCreationInputTokens: null,
        reasoningTokens: 1,
        generationId: "gen_first",
        generationIds: ["gen_first"],
      },
      {
        inputTokens: 6,
        outputTokens: 9,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: 4,
        reasoningTokens: 2,
        generationId: "gen_second",
        generationIds: ["gen_second"],
      }
    ),
    {
      inputTokens: 11,
      outputTokens: 9,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 4,
      reasoningTokens: 3,
      generationId: "gen_first",
      generationIds: ["gen_first", "gen_second"],
    }
  );
});

test("mergeUsage concatenates and deduplicates generation ids", () => {
  assert.deepEqual(
    mergeUsage(
      {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: "gen_a",
        generationIds: ["gen_a", "gen_b"],
      },
      {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: "gen_b",
        generationIds: ["gen_b", "gen_c"],
      }
    ).generationIds,
    ["gen_a", "gen_b", "gen_c"]
  );
});

test("fillUsageGaps does not double-count aggregate totals", () => {
  assert.deepEqual(
    fillUsageGaps(
      {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        reasoningTokens: null,
        generationId: null,
        generationIds: [],
      },
      {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadInputTokens: 6,
        cacheCreationInputTokens: 1,
        reasoningTokens: 2,
        generationId: "gen_step",
        generationIds: ["gen_step"],
      }
    ),
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: 6,
      cacheCreationInputTokens: 1,
      reasoningTokens: 2,
      generationId: "gen_step",
      generationIds: ["gen_step"],
    }
  );
});

test("fillUsageGaps unions generation ids from primary and fallback", () => {
  const result = fillUsageGaps(
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: "gen_primary",
      generationIds: ["gen_primary", "gen_both"],
    },
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: "gen_fallback",
      generationIds: ["gen_fallback", "gen_both"],
    }
  );
  // Primary IDs come first, deduplicated
  assert.deepEqual(result.generationIds, [
    "gen_primary",
    "gen_both",
    "gen_fallback",
  ]);
});

test("fillUsageGaps uses fallback ids when primary is empty", () => {
  const result = fillUsageGaps(
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: null,
      generationIds: [],
    },
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: "gen_fallback",
      generationIds: ["gen_fallback1", "gen_fallback2"],
    }
  );
  assert.deepEqual(result.generationIds, ["gen_fallback1", "gen_fallback2"]);
  // Singleton should match first of effective IDs
  assert.equal(result.generationId, "gen_fallback1");
});

test("fillUsageGaps keeps singleton consistent with first merged ID when primary.generationId is null", () => {
  // When primary.generationId is null but primary.generationIds is non-empty,
  // the singleton should be the first of the merged IDs, not fallback.generationId.
  const result = fillUsageGaps(
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: null, // null singleton
      generationIds: ["gen_primary1", "gen_primary2"], // but has array IDs
    },
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      reasoningTokens: null,
      generationId: "gen_fallback_singleton",
      generationIds: ["gen_fallback1"],
    }
  );
  // Array should be union with primary first
  assert.deepEqual(result.generationIds, [
    "gen_primary1",
    "gen_primary2",
    "gen_fallback1",
  ]);
  // Singleton should be the first merged ID (gen_primary1), NOT gen_fallback_singleton
  assert.equal(result.generationId, "gen_primary1");
});

test("fillUsageGaps returns fallback generation ids when primary has none", () => {
  // Explicit test using EMPTY_CAPTURED_USAGE to cover the primaryIds.length === 0 branch
  const result = fillUsageGaps(
    { ...EMPTY_CAPTURED_USAGE, generationIds: [] },
    { ...EMPTY_CAPTURED_USAGE, generationIds: ["gen_a", "gen_b"] }
  );
  assert.deepEqual(result.generationIds, ["gen_a", "gen_b"]);
});
