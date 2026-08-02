import assert from "node:assert/strict";
import test from "node:test";
import {
  detectNewModelArrivals,
  maxArrivalCreatedAt,
} from "../../lib/models/new-arrivals";

const seenAt = "2026-06-01T00:00:00.000Z";

function model(
  id: string,
  created_at: string | null,
  overrides: Partial<{ name: string; provider: string }> = {}
) {
  return {
    id,
    name: overrides.name ?? id,
    provider: overrides.provider ?? "anthropic",
    created_at,
  };
}

test("returns models created after the seen-at high-water mark", () => {
  const result = detectNewModelArrivals({
    models: [
      model("anthropic/old", "2026-05-01T00:00:00.000Z"),
      model("anthropic/new", "2026-06-15T00:00:00.000Z"),
    ],
    seenAt,
    preferenceModelIds: new Set(),
  });

  assert.deepEqual(
    result.map((m) => m.id),
    ["anthropic/new"]
  );
});

test("ignores models the user has already pinned a preference for", () => {
  const result = detectNewModelArrivals({
    models: [model("anthropic/new", "2026-06-15T00:00:00.000Z")],
    seenAt,
    preferenceModelIds: new Set(["anthropic/new"]),
  });

  assert.deepEqual(result, []);
});

test("ignores models without a created_at or with unparseable timestamps", () => {
  const result = detectNewModelArrivals({
    models: [
      model("anthropic/missing", null),
      model("anthropic/garbage", "not-a-date"),
    ],
    seenAt,
    preferenceModelIds: new Set(),
  });

  assert.deepEqual(result, []);
});

test("treats every dated model as new when the user has never been seen", () => {
  const result = detectNewModelArrivals({
    models: [
      model("anthropic/a", "2026-05-01T00:00:00.000Z"),
      model("anthropic/b", "2026-06-15T00:00:00.000Z"),
    ],
    seenAt: null,
    preferenceModelIds: new Set(),
  });

  assert.deepEqual(result.map((m) => m.id).sort(), [
    "anthropic/a",
    "anthropic/b",
  ]);
});

test("projects id, name, provider, and created_at onto the arrival", () => {
  const [arrival] = detectNewModelArrivals({
    models: [
      model("anthropic/new", "2026-06-15T00:00:00.000Z", {
        name: "Claude Next",
        provider: "anthropic",
      }),
    ],
    seenAt,
    preferenceModelIds: new Set(),
  });

  assert.deepEqual(arrival, {
    id: "anthropic/new",
    name: "Claude Next",
    provider: "anthropic",
    created_at: "2026-06-15T00:00:00.000Z",
  });
});

test("maxArrivalCreatedAt returns the newest created_at, or null when empty", () => {
  assert.equal(maxArrivalCreatedAt([]), null);
  assert.equal(
    maxArrivalCreatedAt([
      { created_at: "2026-06-10T00:00:00.000Z" },
      { created_at: "2026-06-15T00:00:00.000Z" },
      { created_at: "2026-06-12T00:00:00.000Z" },
    ]),
    "2026-06-15T00:00:00.000Z"
  );
});
