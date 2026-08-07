import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMemoriesClient,
  makeClient,
  type Embedder,
} from "./helpers/memories-client-fixtures";

test("editMemory throws 'Memory not found' when no row is affected", async () => {
  const { mod, client, setAffectedIds } = await makeClient();
  setAffectedIds([]);
  await assert.rejects(
    () => mod.editMemory(client, "missing-id", "new content"),
    /Memory not found/
  );
});

test("editMemory skips embedding when embedder returns null (no data loss)", async () => {
  const { mod, client, calls, setAffectedIds } = await makeClient({
    embedder: (async () => null) as Embedder,
  });
  setAffectedIds(["memory-1"]);
  await mod.editMemory(client, "memory-1", "updated");
  const updateCall = calls.find((c) => c.method === "memories.update");
  assert.ok(updateCall);
  const payload = updateCall.args.updatePayload as Record<string, unknown>;
  assert.equal(payload.content, "updated");
  assert.ok(
    !("embedding" in payload),
    "embedding should be omitted when embedder returns null"
  );
});

test("editMemory writes embedding when embedder returns a vector", async () => {
  const embedding = Array.from({ length: 1536 }).fill(0.2);
  const { mod, client, calls, setAffectedIds } = await makeClient({
    embedder: (async () => embedding) as Embedder,
  });
  setAffectedIds(["memory-1"]);
  await mod.editMemory(client, "memory-1", "updated");
  const updateCall = calls.find((c) => c.method === "memories.update");
  const payload = updateCall?.args.updatePayload as Record<string, unknown>;
  assert.deepEqual(payload.embedding, embedding);
});

test("forgetMemory throws 'Memory not found' when no row is affected", async () => {
  const { mod, client, setAffectedIds } = await makeClient();
  setAffectedIds([]);
  await assert.rejects(
    () => mod.forgetMemory(client, "missing-id"),
    /Memory not found/
  );
});

test("vacuum deletes only session-lane rows older than 30 days for the user", async () => {
  const { mod, client, calls } = await makeClient();
  const now = new Date("2026-04-17T00:00:00Z");
  await mod.vacuum(client, now);
  const deleteCall = calls.find((c) => c.method === "memories.delete");
  assert.ok(deleteCall);
  assert.equal(deleteCall.args.user_id, "user-A");
  assert.equal(deleteCall.args.lane, "session");
  assert.equal(deleteCall.args.created_at__lt, "2026-03-18T00:00:00.000Z");
});

test("addToLane forwards user_id and metadata to the insert", async () => {
  const { mod, client, calls } = await makeClient({
    embedder: (async () => null) as Embedder,
  });
  await mod.addToLane(client, "semantic", "the sky is blue", {
    source: "chat",
  });
  const insertCall = calls.find((c) => c.method === "memories.insert.single");
  assert.ok(insertCall);
  const payload = insertCall.args.insertPayload as Record<string, unknown>;
  assert.equal(payload.user_id, "user-A");
  assert.equal(payload.lane, "semantic");
  assert.equal(payload.content, "the sky is blue");
  assert.deepEqual(payload.metadata, { source: "chat" });
  assert.equal(payload.embedding, null);
});

test("listByLane applies project and team memory scope filters", async () => {
  const { mod, client, calls } = await makeClient();

  await mod.listByLane(client, "semantic", 50, {
    repoId: "repo-1",
    resourceScope: "team",
    productTeamId: "team-1",
  });

  const teamCall = calls.find((c) => c.method === "memories.select");
  assert.ok(teamCall);
  assert.equal(teamCall.args.user_id, "user-A");
  assert.equal(teamCall.args.lane, "semantic");
  assert.deepEqual(teamCall.args.metadata__contains, {
    repo_id: "repo-1",
    product_team_id: "team-1",
  });
});

test("listByLane can filter personal memories without matching team rows", async () => {
  const { mod, client, calls } = await makeClient();

  await mod.listByLane(client, "semantic", 50, {
    resourceScope: "personal",
  });

  const selectCall = calls.find((c) => c.method === "memories.select");
  assert.ok(selectCall);
  assert.equal(selectCall.args.user_id, "user-A");
  assert.equal(selectCall.args["metadata->>product_team_id__is"], null);
});

test("editMemory / forgetMemory throw MemoryNotFoundError (instanceof-checkable)", async () => {
  const { mod, client, setAffectedIds } = await makeClient();
  setAffectedIds([]);
  await assert.rejects(
    () => mod.editMemory(client, "missing-id", "new content"),
    (err: unknown) => err instanceof mod.MemoryNotFoundError
  );
  await assert.rejects(
    () => mod.forgetMemory(client, "missing-id"),
    (err: unknown) => err instanceof mod.MemoryNotFoundError
  );
});

test("createMemoriesClient throws without a userId", async () => {
  const { createMemoriesClient } = await loadMemoriesClient();
  assert.throws(() => createMemoriesClient(), /requires a userId/);
});
