import assert from "node:assert/strict";
import test from "node:test";
import { loadZombieReaper } from "./helpers/zombie-reaper-fixtures";

test("buildZombieReaperResponse reduces the summary to a JSON-safe shape", async () => {
  const { buildZombieReaperResponse } = await loadZombieReaper();

  const response = buildZombieReaperResponse({
    processed: 2,
    reaped: 1,
    message: "[zombie-reaper] reaped 1 (ai_calls=1/1 repos=0/0 job_runs=0/1)",
    tables: [
      {
        table: "ai_calls",
        scanned: 1,
        reaped: 1,
        results: [
          {
            table: "ai_calls",
            id: "call-zombie",
            ageMs: 1_000,
            action: "marked_failed",
          },
        ],
        error: null,
      },
      {
        table: "repos",
        scanned: 0,
        reaped: 0,
        results: [],
        error: null,
      },
      {
        table: "job_runs",
        scanned: 1,
        reaped: 0,
        results: [],
        error: "select failed",
      },
    ],
  });

  assert.equal(response.processed, 2);
  assert.equal(response.reaped, 1);
  assert.equal(response.tables.length, 3);
  assert.deepEqual(response.tables[0]?.sample_ids, ["call-zombie"]);
  assert.equal(response.tables[2]?.error, "select failed");
});

test("buildZombieReaperResponse caps sample_ids so log surfaces don't pick up unbounded id lists", async () => {
  const { buildZombieReaperResponse } = await loadZombieReaper();

  const ids = Array.from({ length: 25 }, (_, i) => `call-${i}`);
  const response = buildZombieReaperResponse({
    processed: ids.length,
    reaped: ids.length,
    message: "test",
    tables: [
      {
        table: "ai_calls",
        scanned: ids.length,
        reaped: ids.length,
        results: ids.map((id) => ({
          table: "ai_calls" as const,
          id,
          ageMs: 1000,
          action: "marked_failed" as const,
        })),
        error: null,
      },
    ],
  });

  // Sample is bounded; full list never reaches the wire.
  assert.equal(response.tables[0]?.sample_ids.length, 5);
  assert.deepEqual(response.tables[0]?.sample_ids, ids.slice(0, 5));
});
