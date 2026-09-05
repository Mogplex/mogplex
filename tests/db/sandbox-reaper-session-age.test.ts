import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { loadActiveSandboxes } from "@/lib/sandbox/reaper-loaders";
import { buildActiveSandboxEvaluation } from "@/lib/sandbox/reaper-decisions";

it("loads the persisted boot clock through the real reaper SQL query", async () => {
  const pg = await PGlite.create();
  try {
    await pg.exec(`
      create table workspaces(id uuid primary key, sandbox_timeout_ms integer, sandbox_idle_timeout_ms integer);
      create table repos(id uuid primary key, workspace_id uuid references workspaces(id), sandbox_timeout_ms integer, sandbox_idle_timeout_ms integer);
      create table sandboxes(
        id uuid primary key, repo_id uuid references repos(id), sandbox_id text,
        user_id uuid, status text, health_status text, exec_lock_token text,
        persistent boolean, created_at timestamptz, last_active_at timestamptz,
        billing_source text, billing_team_id text, billing_project_id text,
        vercel_team_id text, vercel_project_id text, error text
      );
    `);
    await pg.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260322094000_sandbox_preview_control_plane.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const now = Date.now();
    const boot = new Date(now - 60_000).toISOString();
    await pg.query(
      `insert into sandboxes(
      id,sandbox_id,status,health_status,persistent,created_at,last_active_at,last_boot_started_at
    ) values ('00000000-0000-4000-8000-000000000001','retained-vm','running','running',true,$1,$2,$3)`,
      [
        new Date(now - 24 * 60 * 60_000).toISOString(),
        new Date(now).toISOString(),
        boot,
      ]
    );
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const client = createPostgrestShim(queryable) as unknown as SupabaseClient;
    const records = await loadActiveSandboxes(client);
    expect(records).toHaveLength(1);
    const evaluation = buildActiveSandboxEvaluation(
      records[0],
      undefined,
      new Set(),
      now
    );
    expect(evaluation.ageMs).toBe(60_000);
  } finally {
    await pg.close();
  }
});
