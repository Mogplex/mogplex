import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupersessionMap,
  planSupersessionWrites,
  resolveUpgradedModelId,
} from "../../lib/models/model-supersessions";

function row(deprecated_model_id: string, successor_model_id: string) {
  return { deprecated_model_id, successor_model_id };
}

test("buildSupersessionMap collapses a chain to the terminal successor", () => {
  const map = buildSupersessionMap([
    row("anthropic/claude-opus-4.6", "anthropic/claude-opus-4.7"),
    row("anthropic/claude-opus-4.7", "anthropic/claude-opus-4.8"),
    row("anthropic/claude-opus-4.8", "anthropic/claude-opus-5"),
  ]);

  assert.equal(map.get("anthropic/claude-opus-4.6"), "anthropic/claude-opus-5");
  assert.equal(map.get("anthropic/claude-opus-4.7"), "anthropic/claude-opus-5");
});

test("buildSupersessionMap drops cycles rather than picking a member", () => {
  const map = buildSupersessionMap([
    row("model-a", "model-b"),
    row("model-b", "model-a"),
  ]);

  assert.equal(map.size, 0);
});

test("resolveUpgradedModelId passes through models that were not superseded", () => {
  const map = buildSupersessionMap([
    row("anthropic/claude-opus-4.8", "anthropic/claude-opus-5"),
  ]);

  assert.equal(resolveUpgradedModelId("openai/gpt-5.4", map), "openai/gpt-5.4");
  assert.equal(
    resolveUpgradedModelId("anthropic/claude-opus-4.8", map),
    "anthropic/claude-opus-5"
  );
});

test("planSupersessionWrites repoints stored rows when a newer version ships", () => {
  // Opus 5 arrives at Opus 4.8's price: 4.8 is newly deprecated, and the
  // already-stored 4.6/4.7 rows must skip past 4.8 to stay terminal.
  const writes = planSupersessionWrites({
    existing: [
      row("anthropic/claude-opus-4.6", "anthropic/claude-opus-4.8"),
      row("anthropic/claude-opus-4.7", "anthropic/claude-opus-4.8"),
    ],
    discovered: [
      {
        deprecatedId: "anthropic/claude-opus-4.8",
        successorId: "anthropic/claude-opus-5",
      },
    ],
  });

  assert.deepEqual(
    [...writes].sort((left, right) =>
      left.deprecated_model_id.localeCompare(right.deprecated_model_id)
    ),
    [
      row("anthropic/claude-opus-4.6", "anthropic/claude-opus-5"),
      row("anthropic/claude-opus-4.7", "anthropic/claude-opus-5"),
      row("anthropic/claude-opus-4.8", "anthropic/claude-opus-5"),
    ]
  );
});

test("planSupersessionWrites is a no-op on a steady-state sync", () => {
  const writes = planSupersessionWrites({
    existing: [row("anthropic/claude-opus-4.7", "anthropic/claude-opus-4.8")],
    discovered: [
      {
        deprecatedId: "anthropic/claude-opus-4.7",
        successorId: "anthropic/claude-opus-4.8",
      },
    ],
  });

  assert.deepEqual(writes, []);
});

test("buildSupersessionMap reports ids it drops as unresolvable", () => {
  // A cycle means the table has been corrupted; the caller logs these so the
  // symptom isn't "pins silently stop upgrading".
  const dropped: string[] = [];
  const map = buildSupersessionMap(
    [
      row("model-a", "model-b"),
      row("model-b", "model-a"),
      row("anthropic/claude-opus-4.7", "anthropic/claude-opus-5"),
    ],
    dropped
  );

  assert.equal(map.get("anthropic/claude-opus-4.7"), "anthropic/claude-opus-5");
  assert.deepEqual([...dropped].sort(), ["model-a", "model-b"]);
});

test("buildSupersessionMap reports a self-referencing row", () => {
  const dropped: string[] = [];
  buildSupersessionMap([row("model-a", "model-a")], dropped);
  assert.deepEqual(dropped, ["model-a"]);
});

test("buildSupersessionMap reports nothing for a healthy table", () => {
  const dropped: string[] = [];
  buildSupersessionMap(
    [row("anthropic/claude-opus-4.7", "anthropic/claude-opus-5")],
    dropped
  );
  assert.deepEqual(dropped, []);
});

test("planSupersessionWrites reports unresolvable chains", () => {
  // The writer half must be as loud as buildSupersessionMap — it is the one
  // that would persist a corrupted chain.
  const dropped: string[] = [];
  const writes = planSupersessionWrites(
    {
      existing: [row("model-a", "model-b"), row("model-b", "model-a")],
      discovered: [
        {
          deprecatedId: "anthropic/claude-opus-4.7",
          successorId: "anthropic/claude-opus-5",
        },
      ],
    },
    dropped
  );

  assert.deepEqual(writes, [
    row("anthropic/claude-opus-4.7", "anthropic/claude-opus-5"),
  ]);
  assert.deepEqual([...dropped].sort(), ["model-a", "model-b"]);
});

test("planSupersessionWrites reports nothing for a healthy table", () => {
  const dropped: string[] = [];
  planSupersessionWrites(
    {
      existing: [],
      discovered: [
        {
          deprecatedId: "anthropic/claude-opus-4.8",
          successorId: "anthropic/claude-opus-5",
        },
      ],
    },
    dropped
  );
  assert.deepEqual(dropped, []);
});
