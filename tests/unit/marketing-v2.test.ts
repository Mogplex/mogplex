import assert from "node:assert/strict";
import test from "node:test";

test("GitHub star count formatting and visibility handle API edge cases", async () => {
  const { fetchStarCount, formatStarCount, shouldShowStarCount } =
    await import("../../components/marketing/mpx-chrome");

  assert.equal(formatStarCount(999), "999");
  assert.equal(formatStarCount(1250), "1.3k");
  assert.equal(formatStarCount(12_600), "13k");
  assert.equal(shouldShowStarCount(null), false);
  assert.equal(shouldShowStarCount(undefined), false);
  assert.equal(shouldShowStarCount(0), false);
  assert.equal(shouldShowStarCount(1), true);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 403 });
    assert.equal(await fetchStarCount(), null);

    globalThis.fetch = async () =>
      Response.json({ stargazers_count: "not-a-number" });
    assert.equal(await fetchStarCount(), null);

    globalThis.fetch = async () => Response.json({ stargazers_count: 1250 });
    assert.equal(await fetchStarCount(), 1250);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native model rotation wraps through each provider pair", async () => {
  const { nativeModelRotation, nextNativeModelIndex } =
    await import("../../components/marketing/landing-v2");

  assert.deepEqual(nativeModelRotation, [
    ["claude-opus-5", "vault://platform/anthropic"],
    ["gpt-5.6-sol", "vault://platform/openai"],
    ["kimi-k3", "vault://platform/moonshot"],
  ]);
  assert.equal(nextNativeModelIndex(0), 1);
  assert.equal(nextNativeModelIndex(1), 2);
  assert.equal(nextNativeModelIndex(2), 0);
});
