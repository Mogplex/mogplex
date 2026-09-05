import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finishCallAfterRuntime,
  syncRunAfterRuntime,
} from "./run-runtime-store";
import {
  buildAiCall,
  buildRunRow,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

// SQL predicates and isolation are exercised against real migrations in the
// DB tier. This boundary exercises rejected writes and returned results.
function databaseReply(data: unknown, error: { message: string } | null) {
  const query = {
    update: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    select: () => query,
    maybeSingle: async () => ({ data, error }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

it("propagates database failure so supervision retries instead of reporting cleanup", async () => {
  const client = databaseReply(null, { message: "database unavailable" });
  await expect(
    finishCallAfterRuntime(buildAiCall(), "failed", "timeout", client)
  ).rejects.toThrow("Failed to finalize worker call: database unavailable");
  await expect(
    syncRunAfterRuntime(buildRunRow(), "failed", "timeout", client)
  ).rejects.toThrow("Failed to finalize worker run: database unavailable");
});

it("returns null for a guarded write that loses a race", async () => {
  const client = databaseReply(null, null);
  expect(
    await finishCallAfterRuntime(buildAiCall(), "cancelled", null, client)
  ).toBeNull();
  expect(
    await syncRunAfterRuntime(
      buildRunRow({ runtime_run_id: "run_old" }),
      "cancelled",
      null,
      client
    )
  ).toBeNull();
});

it("returns the database's updated record", async () => {
  const call = buildAiCall({ status: "failed" });
  const run = buildRunRow({ status: "failed" });
  expect(
    await finishCallAfterRuntime(
      call,
      "failed",
      "timeout",
      databaseReply(call, null)
    )
  ).toBe(call);
  expect(
    await syncRunAfterRuntime(
      run,
      "failed",
      "timeout",
      databaseReply(run, null)
    )
  ).toBe(run);
});
