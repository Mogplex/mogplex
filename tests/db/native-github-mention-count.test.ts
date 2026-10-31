import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { countRecentMentionEnqueues } from "@/lib/automation-dispatch";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";

test("native retry excludes its own committed enqueue while retaining other and legacy delivery counts", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create table repos (id uuid primary key, github_installation_id bigint);
      create table assignments (id uuid primary key, repo_id uuid);
      create table triggers (id uuid primary key, installation_id bigint);
      create table job_runs (id uuid primary key default gen_random_uuid(), assignment_id uuid, trigger_id uuid, retry_of_job_run_id uuid, flow_id uuid, flow_version_id uuid, status text, metadata jsonb, idempotency_key text unique);
      create table automation_dispatch_events (id uuid default gen_random_uuid(), user_id uuid, job_run_id uuid, assignment_id uuid, trigger_id uuid, flow_id uuid, flow_version_id uuid, repo_id uuid, installation_id bigint, source_kind text, source_type text, event_kind text, outcome text, reason text, metadata jsonb not null default '{}', created_at timestamptz not null default now());
    `);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260329120000_automation_dispatch_flow_source_kind.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const repoId = "00000000-0000-4000-8000-000000000002";
    for (const [key, metadata] of [
      ["other", { issue_number: 7, github_delivery_id: "other-delivery" }],
      ["legacy", { issue_number: 7 }],
      ["current", { issue_number: 7, github_delivery_id: "current-delivery" }],
      [
        "other-issue",
        { issue_number: 8, github_delivery_id: "other-delivery" },
      ],
    ] as const) {
      await db.query(
        `select * from public.enqueue_automation_job_run(
        p_user_id => '00000000-0000-4000-8000-000000000001',
        p_repo_id => $1, p_installation_id => 99, p_source_kind => 'flow',
        p_source_type => 'mention', p_idempotency_key => $2, p_metadata => $3::jsonb
      )`,
        [repoId, key, JSON.stringify(metadata)]
      );
    }
    const client = createPostgrestShim({
      query: async (sql, params) => {
        const result = await db.query(sql, params ?? []);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    }) as unknown as Pick<SupabaseClient, "from">;
    const input = { repoId, issueNumber: 7, sinceMinutes: 15 };
    expect(await countRecentMentionEnqueues(input, client)).toBe(3);
    expect(
      await countRecentMentionEnqueues(
        { ...input, excludeDeliveryId: "current-delivery" },
        client
      )
    ).toBe(2);
    expect(
      await countRecentMentionEnqueues(
        { ...input, excludeDeliveryId: 'unrelated"delivery' },
        client
      )
    ).toBe(3);
  } finally {
    await db.close();
  }
});
