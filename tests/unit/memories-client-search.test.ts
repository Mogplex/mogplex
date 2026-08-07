import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMemoriesClient,
  makeClient,
  type Embedder,
} from "./helpers/memories-client-fixtures";

test("escapeLikePattern escapes %, _, and backslash", async () => {
  const { escapeLikePattern } = await loadMemoriesClient();
  assert.equal(escapeLikePattern("50%"), "50\\%");
  assert.equal(escapeLikePattern("foo_bar"), "foo\\_bar");
  assert.equal(escapeLikePattern("a\\b"), "a\\\\b");
  assert.equal(escapeLikePattern("plain text"), "plain text");
});

test("searchMemories ILIKE fallback escapes user metacharacters", async () => {
  const { mod, client, calls } = await makeClient({
    embedder: (async () => null) as Embedder,
  });
  await mod.searchMemories(client, "50% off_deal");
  const ilikeCall = calls.find((c) => typeof c.args.ilikePattern === "string");
  assert.ok(ilikeCall, "expected an ILIKE call");
  assert.equal(ilikeCall.args.ilikePattern, "%50\\% off\\_deal%");
  assert.equal(ilikeCall.args.user_id, "user-A");
});

test("searchMemories uses RPC with user_id when embedder returns a vector", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.1);
  const { mod, client, calls } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  await mod.searchMemories(client, "anything", "semantic", 5);
  const rpcCall = calls.find((c) => c.method === "rpc.match_memories");
  assert.ok(rpcCall);
  assert.equal(rpcCall.args.match_user_id, "user-A");
  assert.equal(rpcCall.args.match_lane, "semantic");
  assert.equal(rpcCall.args.match_count, 5);
});

test("searchMemories supplements vector hits with ILIKE on non-embedded rows", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.1);
  const { mod, client, calls } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  await mod.searchMemories(client, "needle");
  const rpcCall = calls.find((c) => c.method === "rpc.match_memories");
  const ilikeCall = calls.find((c) => typeof c.args.ilikePattern === "string");
  assert.ok(rpcCall, "expected vector RPC call");
  assert.ok(ilikeCall, "expected lexical supplement call");
  assert.equal(
    ilikeCall.args.embedding__is,
    null,
    "lexical supplement must be scoped to rows where embedding IS NULL"
  );
  assert.equal(ilikeCall.args.user_id, "user-A");
});

test("searchMemories propagates RPC errors rather than swallowing them", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.1);
  const { mod, client, setRpcError } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  setRpcError({ message: "connection failed" });
  await assert.rejects(
    () => mod.searchMemories(client, "anything"),
    /connection failed/
  );
});
