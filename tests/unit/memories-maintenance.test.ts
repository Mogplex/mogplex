import assert from "node:assert/strict";
import test from "node:test";
import { makeClient } from "./helpers/memories-client-fixtures";

async function loadMaintenance() {
  return import("../../lib/memories-maintenance");
}

test("countByLane issues one exact head count per lane scoped to the user", async () => {
  const { client, calls } = await makeClient();
  const mod = await loadMaintenance();
  const counts = await mod.countByLane(client);
  assert.deepEqual(Object.keys(counts).sort(), [
    "episodic",
    "procedural",
    "semantic",
    "session",
  ]);
  const selects = calls.filter((c) => c.method === "memories.select");
  assert.equal(selects.length, 4);
  for (const call of selects) {
    assert.equal(call.args.user_id, "user-A");
    assert.ok(typeof call.args.lane === "string");
  }
});

test("countByLane applies repo scope filters like listByLane", async () => {
  const { client, calls } = await makeClient();
  const mod = await loadMaintenance();
  await mod.countByLane(client, { repoId: "repo-1" });
  const select = calls.find((c) => c.method === "memories.select");
  assert.ok(select);
  assert.deepEqual(select.args.metadata__contains, { repo_id: "repo-1" });
});

test("pruneNoise deletes only harness prompt dumps and automation outcomes for the user", async () => {
  const { client, calls, setAffectedIds } = await makeClient();
  const mod = await loadMaintenance();
  setAffectedIds(["a", "b", "c"]);
  const result = await mod.pruneNoise(client);
  const deletes = calls.filter((c) => c.method === "memories.delete");
  assert.equal(deletes.length, 2);

  const [prompts, outcomes] = deletes;
  assert.equal(prompts.args.user_id, "user-A");
  assert.equal(prompts.args.lane, "session");
  assert.equal(prompts.args["metadata->>source"], "harness");
  assert.equal(prompts.args["metadata->>kind"], "prompt");

  assert.equal(outcomes.args.user_id, "user-A");
  assert.equal(outcomes.args.lane, "episodic");
  assert.equal(outcomes.args["metadata->>source"], "automation");
  assert.equal("metadata->>kind" in outcomes.args, false);

  assert.deepEqual(result, { harnessPrompts: 3, automationOutcomes: 3 });
});
