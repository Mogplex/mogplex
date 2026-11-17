import { expect, test } from "vitest";
import { createDeliveryResume } from "./resume";
import { createRunDeliveryStore } from "./store";
import { deliveryRun, deliverySnapshot } from "./fixtures.test-support";

function fixture() {
  const run = deliveryRun();
  const snapshot = deliverySnapshot();
  let owned = true;
  let saved = true;
  const deps = {
    store: {
      ...createRunDeliveryStore(),
      load: async () => (owned ? run : null),
      save: async () => (saved ? run : null),
    },
    loadGithub: async () => snapshot,
    cancelCall: async () => {},
  };
  return {
    run,
    snapshot,
    resume: createDeliveryResume(deps),
    missing: () => {
      owned = false;
    },
    stale: () => {
      saved = false;
    },
  };
}
test("delivery workers recheck current GitHub evidence before consuming an authorization", async () => {
  const f = fixture();
  const expected = { headSha: "head-1", revision: "revision-1" };
  expect(await f.resume.prepare(f.run, expected)).toBe(true);
  f.snapshot.pullRequest!.headSha = "head-2";
  expect(await f.resume.prepare(f.run, expected)).toBe(false);
  f.snapshot.pullRequest!.headSha = "head-1";
  f.snapshot.repairRevision = "new-review";
  expect(await f.resume.prepare(f.run, expected)).toBe(false);
  f.snapshot.repairRevision = "revision-1";
  f.snapshot.checks.state = "success";
  expect(await f.resume.prepare(f.run, expected)).toBe(false);
});
test("missing authorization, cancelled runs, prior repairs and stale receipts are no-ops", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.run.status = "cancelled";
    },
    (f: ReturnType<typeof fixture>) => {
      f.run.metadata.delivery_follow_through = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.run.metadata.delivery_last_repair_revision = "revision-1";
    },
    (f: ReturnType<typeof fixture>) => f.missing(),
    (f: ReturnType<typeof fixture>) => f.stale(),
  ]) {
    const f = fixture();
    change(f);
    expect(
      await f.resume.prepare(f.run, {
        headSha: "head-1",
        revision: "revision-1",
      })
    ).toBe(false);
  }
});
