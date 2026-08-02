import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnthropicNewestVersionPolicy } from "../../lib/models/anthropic-version-policy";

function row(
  id: string,
  provider: string,
  pricing_input: number | null,
  pricing_output: number | null
) {
  return { id, provider, pricing_input, pricing_output };
}

test("keeps only the newest Opus when all versions share the same pricing", () => {
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.5", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4.6", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4.7", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
  ]);

  assert.deepEqual(
    retained.map((model) => model.id),
    ["anthropic/claude-opus-4.8"]
  );
});

test("keeps an older version when its pricing differs", () => {
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.7", "anthropic", 0.000015, 0.000075),
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
  ]);

  assert.deepEqual(
    retained.map((model) => model.id),
    ["anthropic/claude-opus-4.7", "anthropic/claude-opus-4.8"]
  );
});

test("handles the claude-<version>-<family> id shape", () => {
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-3.7-sonnet", "anthropic", 0.000003, 0.000015),
    row("anthropic/claude-sonnet-4.5", "anthropic", 0.000003, 0.000015),
    row("anthropic/claude-sonnet-4.6", "anthropic", 0.000003, 0.000015),
  ]);

  assert.deepEqual(
    retained.map((model) => model.id),
    ["anthropic/claude-sonnet-4.6"]
  );
});

test("does not compare across Claude families", () => {
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-haiku-4.5", "anthropic", 0.000001, 0.000005),
    row("anthropic/claude-fable-5", "anthropic", 0.00001, 0.00005),
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
  ]);

  assert.equal(retained.length, 3);
});

test("supersedes a serving variant by the same variant of a newer version", () => {
  // Live catalog shape: opus-4.8-fast and opus-5-fast both at $10/$50, while
  // the standard models sit at $5/$25. Before the id parser understood the
  // suffix, `-fast` ids failed to parse at all and were retained forever.
  const { retained, supersessions } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-5", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4.8-fast", "anthropic", 0.00001, 0.00005),
    row("anthropic/claude-opus-5-fast", "anthropic", 0.00001, 0.00005),
  ]);

  assert.deepEqual(retained.map((model) => model.id).sort(), [
    "anthropic/claude-opus-5",
    "anthropic/claude-opus-5-fast",
  ]);
  assert.deepEqual(
    [...supersessions].sort((left, right) =>
      left.deprecatedId.localeCompare(right.deprecatedId)
    ),
    [
      {
        deprecatedId: "anthropic/claude-opus-4.8",
        successorId: "anthropic/claude-opus-5",
      },
      {
        deprecatedId: "anthropic/claude-opus-4.8-fast",
        successorId: "anthropic/claude-opus-5-fast",
      },
    ]
  );
});

test("captures the variant on the version-then-family id shape too", () => {
  // VERSION_THEN_FAMILY gained the same optional group, and its capture indices
  // differ (family is [2], variant [3]). Without this the second regex could
  // mis-index or let the version group swallow the suffix and nothing would
  // catch it — every other variant case uses the family-first shape.
  const { retained, supersessions } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-3.7-sonnet-fast", "anthropic", 0.00001, 0.00005),
    row("anthropic/claude-4.5-sonnet-fast", "anthropic", 0.00001, 0.00005),
    row("anthropic/claude-4.5-sonnet", "anthropic", 0.00001, 0.00005),
  ]);

  assert.deepEqual(retained.map((model) => model.id).sort(), [
    "anthropic/claude-4.5-sonnet",
    "anthropic/claude-4.5-sonnet-fast",
  ]);
  // Superseded by its own line, not by the same-priced plain model.
  assert.deepEqual(supersessions, [
    {
      deprecatedId: "anthropic/claude-3.7-sonnet-fast",
      successorId: "anthropic/claude-4.5-sonnet-fast",
    },
  ]);
});

test("treats a multi-segment variant as its own line", () => {
  // The grammar allows `(?:-[a-z][\da-z]*)*`, so `-fast-preview` parses to
  // variant "fast-preview". Intended, not incidental — it is what lets a
  // future compound variant work without editing the regex — but nothing
  // exercised it, so a later tightening of the repetition would silently
  // change which ids supersede.
  const { retained, supersessions } = resolveAnthropicNewestVersionPolicy([
    row(
      "anthropic/claude-opus-4.8-fast-preview",
      "anthropic",
      0.00001,
      0.00005
    ),
    row("anthropic/claude-opus-5-fast-preview", "anthropic", 0.00001, 0.00005),
    // Same pricing, single-segment `-fast`: a different line, so neither side
    // may cross into it.
    row("anthropic/claude-opus-5-fast", "anthropic", 0.00001, 0.00005),
  ]);

  assert.deepEqual(retained.map((model) => model.id).sort(), [
    "anthropic/claude-opus-5-fast",
    "anthropic/claude-opus-5-fast-preview",
  ]);
  assert.deepEqual(supersessions, [
    {
      deprecatedId: "anthropic/claude-opus-4.8-fast-preview",
      successorId: "anthropic/claude-opus-5-fast-preview",
    },
  ]);
});

test("leaves a digit-leading suffix unparseable so date-stamped ids stay retained", () => {
  // The letter-leading requirement is what keeps `-20251101` from reading as a
  // variant. Pinned because the doc comment calls it load-bearing.
  const { retained, supersessions } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4-5-20251101", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4-5-20260101", "anthropic", 0.000005, 0.000025),
  ]);

  // Names the ids, not just the count: a length assertion passes even if the
  // wrong pair survived, and this pins load-bearing behaviour.
  assert.deepEqual(retained.map((model) => model.id).sort(), [
    "anthropic/claude-opus-4-5-20251101",
    "anthropic/claude-opus-4-5-20260101",
  ]);
  assert.deepEqual(supersessions, []);
});

test("never crosses variant lines even when pricing coincides", () => {
  // A `-fast` pin exists because the automation wanted that latency profile.
  // Matching prices are not a licence to move it onto the standard model.
  const { retained, supersessions } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.8-fast", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-5", "anthropic", 0.000005, 0.000025),
  ]);

  assert.deepEqual(retained.map((model) => model.id).sort(), [
    "anthropic/claude-opus-4.8-fast",
    "anthropic/claude-opus-5",
  ]);
  assert.deepEqual(supersessions, []);
});

test("keeps a variant whose pricing differs from the newer variant", () => {
  // opus-4.7-fast is live at $30/$150 against opus-5-fast's $10/$50, so the
  // pricing guard retains it — a cheaper successor is still a different deal.
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.7-fast", "anthropic", 0.00003, 0.00015),
    row("anthropic/claude-opus-5-fast", "anthropic", 0.00001, 0.00005),
  ]);

  assert.deepEqual(retained.map((model) => model.id).sort(), [
    "anthropic/claude-opus-4.7-fast",
    "anthropic/claude-opus-5-fast",
  ]);
});

test("leaves non-Anthropic models untouched", () => {
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("openai/gpt-5", "openai", 0.00000125, 0.00001),
    row("openai/gpt-5.4", "openai", 0.00000125, 0.00001),
  ]);

  assert.equal(retained.length, 2);
});

test("maps every superseded version straight to the newest, not the next one up", () => {
  // Opus 5 at Opus 4.8's price: 4.6/4.7/4.8 all collapse to 5 in one pass, so
  // a saved reference never needs a chain walk to reach a live model.
  const { retained, supersessions } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.6", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4.7", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-5", "anthropic", 0.000005, 0.000025),
  ]);

  assert.deepEqual(
    retained.map((model) => model.id),
    ["anthropic/claude-opus-5"]
  );
  assert.deepEqual(supersessions, [
    {
      deprecatedId: "anthropic/claude-opus-4.6",
      successorId: "anthropic/claude-opus-5",
    },
    {
      deprecatedId: "anthropic/claude-opus-4.7",
      successorId: "anthropic/claude-opus-5",
    },
    {
      deprecatedId: "anthropic/claude-opus-4.8",
      successorId: "anthropic/claude-opus-5",
    },
  ]);
});

test("records no supersession when pricing differs", () => {
  const { supersessions } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-fable-5", "anthropic", 0.00001, 0.00005),
  ]);

  assert.deepEqual(supersessions, []);
});

test("keeps rows with missing pricing or unparseable ids", () => {
  const { retained } = resolveAnthropicNewestVersionPolicy([
    row("anthropic/claude-opus-4.7", "anthropic", null, null),
    row("anthropic/claude-opus-4.8", "anthropic", 0.000005, 0.000025),
    row("anthropic/claude-opus-4-5-20251101", "anthropic", 0.000005, 0.000025),
  ]);

  assert.deepEqual(
    retained.map((model) => model.id),
    [
      "anthropic/claude-opus-4.7",
      "anthropic/claude-opus-4.8",
      "anthropic/claude-opus-4-5-20251101",
    ]
  );
});
