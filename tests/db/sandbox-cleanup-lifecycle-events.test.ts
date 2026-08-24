import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION =
  "supabase/migrations/20260824200000_sandbox_cleanup_start_recovery.sql";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.sandbox_lifecycle_events (
      id uuid primary key default gen_random_uuid(),
      event_type text not null,
      constraint sandbox_lifecycle_events_event_type_check check (
        event_type in (
          'tab_attached',
          'tab_released',
          'auto_pause_queued',
          'auto_pause_decision',
          'auto_pause_succeeded',
          'auto_pause_failed',
          'resume_after_auto_pause'
        )
      )
    );
  `);
  const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

describe("sandbox cleanup lifecycle events", () => {
  it("accepts cleanup recovery and duplicate-start metrics", async () => {
    const eventTypes = [
      "start_waiting_cleanup",
      "start_cleanup_recovered",
      "start_cleanup_failed",
      "duplicate_start_joined",
    ];

    for (const eventType of eventTypes) {
      await db.query(
        "insert into public.sandbox_lifecycle_events (event_type) values ($1)",
        [eventType]
      );
    }

    const { rows } = await db.query<{ event_type: string }>(
      "select event_type from public.sandbox_lifecycle_events order by event_type"
    );
    expect(rows.map((row) => row.event_type)).toEqual([...eventTypes].sort());
  });

  it("retains the closed event-type allowlist", async () => {
    await expect(
      db.query(
        "insert into public.sandbox_lifecycle_events (event_type) values ('unknown_event')"
      )
    ).rejects.toThrow(/sandbox_lifecycle_events_event_type_check/);
  });
});
