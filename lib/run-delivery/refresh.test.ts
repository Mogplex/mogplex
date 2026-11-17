import { expect, test } from "vitest";
import { refreshRunDelivery } from "./refresh";
import { createRunDeliveryStore } from "./store";
import { deliveryRun, deliverySnapshot } from "./fixtures.test-support";

function fixture() {
  const run = deliveryRun();
  const snapshot = deliverySnapshot();
  const queued: unknown[] = [];
  let saved = true;
  const store = {
    ...createRunDeliveryStore(),
    load: async () => null,
    save: async () => (saved ? run : null),
  };
  const deps = {
    store,
    loadGithub: async () => snapshot,
    queueRepair: async (input: unknown) => {
      queued.push(input);
      return { runtimeProvider: "trigger" as const, runtimeRunId: "worker" };
    },
  };
  return {
    run,
    snapshot,
    queued,
    deps,
    stale: () => {
      saved = false;
    },
  };
}
test("manual refresh updates evidence without starting an agent", async () => {
  const f = fixture();
  expect(await refreshRunDelivery(f.run, false, f.deps)).toEqual(f.snapshot);
  expect(f.queued).toEqual([]);
});
test("trusted events queue exact-head repair with stable deduplication and bounded authority", async () => {
  const f = fixture();
  await refreshRunDelivery(f.run, true, f.deps);
  expect(f.queued).toHaveLength(1);
  expect(f.queued[0]).toMatchObject({
    runId: f.run.id,
    userId: f.run.user_id,
    mode: "delivery",
    delivery: { headSha: "head-1", revision: "revision-1" },
    idempotencyKey: `run-delivery:${f.run.id}:revision-1`,
  });
  expect((f.queued[0] as { steer: string }).steer).toContain(
    "Merge only if the user explicitly authorized"
  );
});
test("unapproved, running, cancelled, stale, already-attempted, and green states never auto-launch", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.run.metadata.delivery_follow_through = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.run.status = "streaming";
    },
    (f: ReturnType<typeof fixture>) => {
      f.run.status = "cancelled";
    },
    (f: ReturnType<typeof fixture>) => f.stale(),
    (f: ReturnType<typeof fixture>) => {
      f.run.metadata.delivery_last_repair_revision = f.snapshot.repairRevision;
    },
    (f: ReturnType<typeof fixture>) => {
      f.snapshot.checks.state = "success";
    },
  ]) {
    const f = fixture();
    change(f);
    await refreshRunDelivery(f.run, true, f.deps);
    expect(f.queued).toEqual([]);
  }
});

test("a newer manual receipt cannot swallow a verified event's repair wake-up", async () => {
  const f = fixture();
  f.stale();
  f.run.metadata.delivery_progress = f.snapshot;
  const deps = {
    ...f.deps,
    store: { ...f.deps.store, load: async () => f.run },
  };
  await refreshRunDelivery(f.run, true, deps);
  expect(f.queued).toHaveLength(1);
});
