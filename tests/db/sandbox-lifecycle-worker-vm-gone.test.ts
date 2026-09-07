import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = "20260907160000_sandbox_lifecycle_worker_vm_gone.sql";

// Production Neon still carried the 2026-05 constraint (seven event names)
// when issue #434 was diagnosed; the migration must widen it from that state.
const LIVE_TABLE_SQL = `
  create table public.sandbox_lifecycle_events (
    id uuid primary key default gen_random_uuid(),
    sandbox_record_id uuid,
    user_id uuid,
    tab_id text,
    session_id text,
    event_type text not null check (
      event_type in (
        'tab_attached', 'tab_released', 'auto_pause_queued',
        'auto_pause_decision', 'auto_pause_succeeded', 'auto_pause_failed',
        'resume_after_auto_pause'
      )
    ),
    decision_code text,
    worker_run_id text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
`;

async function insertEvent(db: PGlite, eventType: string) {
  return db.query(
    "insert into public.sandbox_lifecycle_events (event_type, payload) values ($1, '{}') returning id",
    [eventType]
  );
}

describe("sandbox_lifecycle_events worker_vm_gone migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(LIVE_TABLE_SQL);
    await expect(insertEvent(db, "worker_vm_gone")).rejects.toMatchObject({
      code: "23514",
    });
    const migration = await readFile(
      path.resolve(import.meta.dirname, `../../neon/migrations/${MIGRATION}`),
      "utf8"
    );
    await db.exec(migration);
  });

  afterAll(async () => {
    await db.close();
  });

  it("accepts worker_vm_gone and the cleanup names that never reached Neon", async () => {
    for (const eventType of [
      "worker_vm_gone",
      "start_waiting_cleanup",
      "start_cleanup_recovered",
      "start_cleanup_failed",
      "duplicate_start_joined",
      "auto_pause_decision",
    ]) {
      const result = await insertEvent(db, eventType);
      expect(result.rows).toHaveLength(1);
    }
  });

  it("still rejects unknown event names", async () => {
    await expect(insertEvent(db, "worker_exploded")).rejects.toMatchObject({
      code: "23514",
    });
  });
});
