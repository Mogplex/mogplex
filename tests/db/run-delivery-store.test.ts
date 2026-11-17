import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import {
  createRunDeliveryStore,
  type DeliveryRun,
} from "@/lib/run-delivery/store";
import type { DeliverySnapshot } from "@/lib/run-delivery/types";

const owner = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
const repoId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const callId = "00000000-0000-4000-8000-000000000005";
const nextCall = "00000000-0000-4000-8000-000000000006";
function snapshot(observedAt = "2026-11-17T00:00:01.000Z"): DeliverySnapshot {
  return {
    observedAt,
    repairRevision: "revision-1",
    pullRequest: {
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      state: "open",
      draft: false,
      headSha: "head-1",
      mergeSha: null,
    },
    checks: {
      state: "failure",
      failed: ["tests"],
      pending: 0,
      total: 1,
      incomplete: false,
    },
    review: { state: "none", unresolved: 0, incomplete: false },
    deployment: { state: "not_reported", environment: null, url: null },
  };
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE repos(id uuid PRIMARY KEY, full_name text);
    CREATE TABLE external_agent_runs(id uuid PRIMARY KEY, user_id uuid, repo_id uuid REFERENCES repos(id), ai_call_id uuid, status text, runtime_provider text, runtime_run_id text, error text, metadata jsonb, updated_at timestamptz);
    INSERT INTO repos VALUES ('${repoId}', 'acme/widgets');
    INSERT INTO external_agent_runs VALUES ('${runId}', '${owner}', '${repoId}', '${callId}', 'awaiting_input', null, null, null, '{"checkpoint_kind":"review","unrelated":"keep"}', now()); ALTER TABLE external_agent_runs ADD COLUMN working_branch text DEFAULT 'feature/signing';`);
  const store = createRunDeliveryStore(async (sql, values) => ({
    rows: (await db.query<DeliveryRun>(sql, values)).rows,
  }));
  return { db, store, run: (await store.load(owner, runId))! };
}

test("delivery authorization is owned and bound to an implementation checkpoint", async () => {
  const f = await fixture();
  try {
    expect(await f.store.load(foreign, runId)).toBeNull();
    expect(await f.store.authorize({ ...f.run, user_id: foreign })).toBeNull();
    expect(
      await f.store.authorize({ ...f.run, ai_call_id: nextCall })
    ).toBeNull();
    await f.db.query(
      'UPDATE external_agent_runs SET metadata = metadata || \'{"checkpoint_kind":"plan"}\'::jsonb'
    );
    expect(await f.store.authorize(f.run)).toBeNull();
    await f.db.query(
      'UPDATE external_agent_runs SET metadata = metadata || \'{"checkpoint_kind":"review"}\'::jsonb'
    );
    const allowed = await f.store.authorize(f.run);
    expect(allowed?.metadata.delivery_follow_through).toBe(true);
    expect(allowed?.metadata.unrelated).toBe("keep");
    expect(await f.store.listForRepos([], { branches: [], shas: [] })).toEqual(
      []
    );
    await f.db.query("UPDATE external_agent_runs SET status = 'success'");
    expect(
      await f.store.listForRepos([repoId], {
        branches: ["feature/signing"],
        shas: [],
      })
    ).toHaveLength(1);
    await f.db.query("UPDATE external_agent_runs SET status = 'cancelled'");
    expect(
      await f.store.listForRepos([repoId], {
        branches: ["feature/signing"],
        shas: [],
      })
    ).toEqual([]);
  } finally {
    await f.db.close();
  }
});

test("old responses and prior segments cannot overwrite newer delivery receipts", async () => {
  const f = await fixture();
  try {
    expect(await f.store.save(f.run, snapshot())).not.toBeNull();
    expect(
      await f.store.save(f.run, snapshot("2026-11-17T00:00:00.000Z"))
    ).toBeNull();
    expect((await f.store.load(owner, runId))?.metadata.unrelated).toBe("keep");
    await f.db.query("UPDATE external_agent_runs SET ai_call_id = $1", [
      nextCall,
    ]);
    expect(
      await f.store.save(f.run, snapshot("2026-11-17T00:00:02.000Z"))
    ).toBeNull();
  } finally {
    await f.db.close();
  }
});

test("repair claims atomically bind worker and call, and reject stale heads, duplicates, and cancellation", async () => {
  const f = await fixture();
  try {
    await f.store.authorize(f.run);
    await f.store.save(f.run, snapshot());
    await f.db.query("UPDATE external_agent_runs SET status = 'success'");
    const claim = {
      run: f.run,
      revision: "revision-1",
      headSha: "head-1",
      aiCallId: nextCall,
      runtimeRunId: "worker-new",
    };
    expect(
      await f.store.claimRepair({ ...claim, headSha: "stale" })
    ).toBeNull();
    expect(
      await f.store.claimRepair({ ...claim, revision: "stale" })
    ).toBeNull();
    await f.db.query("UPDATE external_agent_runs SET status = 'cancelled'");
    expect(await f.store.claimRepair(claim)).toBeNull();
    await f.db.query("UPDATE external_agent_runs SET status = 'success'");
    const admitted = await f.store.claimRepair(claim);
    expect(admitted).toMatchObject({
      status: "streaming",
      ai_call_id: nextCall,
      runtime_run_id: "worker-new",
      runtime_provider: "trigger",
    });
    expect(admitted?.metadata.delivery_last_repair_revision).toBe("revision-1");
    expect(await f.store.claimRepair(claim)).toBeNull();
  } finally {
    await f.db.close();
  }
});

test("the first PR stays pinned and withdrawn follow-through rejects queued repair", async () => {
  const f = await fixture();
  try {
    await f.store.authorize(f.run);
    await f.store.save(f.run, snapshot());
    expect(
      (await f.store.load(owner, runId))?.metadata.delivery_pull_request_number
    ).toBe(42);
    const reused = snapshot("2026-11-17T00:00:02.000Z");
    reused.pullRequest!.number = 43;
    expect(await f.store.save(f.run, reused)).toBeNull();
    expect(await f.store.stop(f.run)).toBeNull();
    await f.db.query("UPDATE external_agent_runs SET status = 'success'");
    expect(await f.store.stop({ ...f.run, user_id: foreign })).toBeNull();
    const stopped = await f.store.stop(f.run);
    expect(stopped?.metadata.delivery_follow_through).toBe(false);
    expect(stopped?.metadata.unrelated).toBe("keep");
    expect(
      await f.store.claimRepair({
        run: f.run,
        revision: "revision-1",
        headSha: "head-1",
        aiCallId: nextCall,
        runtimeRunId: "queued-worker",
      })
    ).toBeNull();
  } finally {
    await f.db.close();
  }
});
test("implementation approval cannot revive a cancellation during worker startup", async () => {
  const f = await fixture();
  try {
    await f.store.authorize(f.run);
    await f.db.query("UPDATE external_agent_runs SET status = 'cancelled'");
    expect(
      await f.store.claimCheckpoint({
        run: f.run,
        aiCallId: nextCall,
        runtimeRunId: "late-worker",
      })
    ).toBeNull();
  } finally {
    await f.db.close();
  }
});

test("webhook candidates match the branch or recorded commit, and completed delivery retires the watcher", async () => {
  const f = await fixture();
  try {
    await f.store.authorize(f.run);
    await f.store.save(f.run, snapshot());
    await f.db.query("UPDATE external_agent_runs SET status = 'success'");
    expect(
      await f.store.listForRepos([repoId], { branches: [], shas: [] })
    ).toEqual([]);
    expect(
      await f.store.listForRepos([repoId], {
        branches: ["main"],
        shas: ["unrelated"],
      })
    ).toEqual([]);
    expect(
      await f.store.listForRepos([repoId], { branches: [], shas: ["head-1"] })
    ).toHaveLength(1);
    const merged = snapshot("2026-11-17T00:00:02.000Z");
    merged.pullRequest!.state = "merged";
    merged.pullRequest!.mergeSha = "merge-1";
    await f.store.save(f.run, merged);
    expect(
      await f.store.listForRepos([repoId], { branches: [], shas: ["merge-1"] })
    ).toHaveLength(1);
    merged.observedAt = "2026-11-17T00:00:03.000Z";
    merged.deployment.state = "success";
    await f.store.save(f.run, merged);
    expect(
      await f.store.listForRepos([repoId], { branches: [], shas: ["merge-1"] })
    ).toEqual([]);
    expect(
      (await f.store.load(owner, runId))?.metadata.delivery_follow_through
    ).toBe(false);
  } finally {
    await f.db.close();
  }
});
