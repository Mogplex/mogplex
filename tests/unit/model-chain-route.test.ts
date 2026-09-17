import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createModelChainHandlers } from "../../app/api/settings/model-chain/route";
import {
  addFallback,
  chainIncludes,
  chainsEqual,
  moveFallback,
  removeFallback,
  replaceFallback,
  setChainPrimary,
} from "../../components/library/model-chain";

test("model chain reads and writes require authentication", async () => {
  const handlers = createModelChainHandlers({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await handlers.GET()).status, 401);
  assert.equal(
    (await handlers.PATCH(new Request("http://localhost", { method: "PATCH" })))
      .status,
    401
  );
});

test("invalid chains fail before storage access", async () => {
  const { PATCH } = createModelChainHandlers({
    requireUserId: async () => "owner",
  });
  for (const body of [
    "not json",
    "null",
    "[]",
    "{}",
    ...[
      { primary: "a/b", fallbacks: ["a/b"] },
      { primary: "a/b", fallbacks: ["a/c", "a/c"] },
      { primary: "", fallbacks: [] },
      { primary: 3, fallbacks: [] },
      { primary: "a/b", fallbacks: ["openrouter/c"] },
      { primary: "a/b", fallbacks: ["a/1", "a/2", "a/3", "a/4", "a/5"] },
    ].map((value) => JSON.stringify(value)),
  ]) {
    assert.equal(
      (await PATCH(new Request("http://localhost", { method: "PATCH", body })))
        .status,
      400
    );
  }
});

test("chain helpers keep primary pinned, enforce capacity and preserve fallback order", () => {
  const chain = { primary: "a/primary", fallbacks: ["a/one", "a/two"] };
  assert.equal(chainIncludes(chain, "a/one"), true);
  assert.equal(chainIncludes(chain, "a/other"), false);
  assert.deepEqual(setChainPrimary(chain, "a/two"), {
    primary: "a/two",
    fallbacks: ["a/one"],
  });
  assert.equal(addFallback(chain, "a/primary"), chain);
  assert.equal(replaceFallback(chain, 0, "a/two"), chain);
  assert.deepEqual(replaceFallback(chain, 0, "a/three").fallbacks, [
    "a/three",
    "a/two",
  ]);
  assert.deepEqual(moveFallback(chain, 0, 1).fallbacks, ["a/two", "a/one"]);
  assert.deepEqual(moveFallback(chain, 1, -1).fallbacks, ["a/two", "a/one"]);
  assert.equal(moveFallback(chain, 0, -1), chain);
  assert.equal(moveFallback(chain, 1, 1), chain);
  assert.deepEqual(removeFallback(chain, 0).fallbacks, ["a/two"]);
  const full = addFallback(addFallback(chain, "a/three"), "a/four");
  assert.equal(addFallback(full, "a/five"), full);
  assert.equal(
    chainsEqual(chain, { ...chain, fallbacks: [...chain.fallbacks] }),
    true
  );
  assert.equal(chainsEqual(chain, moveFallback(chain, 0, 1)), false);
});
