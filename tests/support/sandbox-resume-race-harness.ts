import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSandboxResumeHandler } from "@/app/api/sandbox/[id]/resume/route";
import { RESUME_SELECT } from "@/app/api/sandbox/[id]/resume/_lib/constants";
import { buildLoadedResumeContext } from "../unit/helpers/sandbox-resume-route-fixtures";

export async function withResumeDatabase(
  run: (input: {
    pg: PGlite;
    resume: () => Promise<Response>;
  }) => Promise<void>,
  recordId = "sandbox-1",
  duringWake: (pg: PGlite) => Promise<void> = async () => {}
) {
  const pg = new PGlite({
    parsers: Object.fromEntries(
      Object.entries(SHIM_TYPE_PARSERS).map(([oid, parse]) => [
        Number(oid),
        parse,
      ])
    ),
  });
  const previous = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  try {
    await pg.exec(`
      create table workspaces(id text primary key);
      create table repos(id text primary key, workspace_id text references workspaces(id), root_directory text,
        dev_command text, dev_port integer, dev_port_auto boolean, runtime text);
      create table sandboxes(
        id text primary key, repo_id text references repos(id), user_id text, sandbox_id text,
        base_branch text, working_branch text, status text, stop_reason text, health_status text,
        preview_url text, snapshot_id text, snapshot_billing_project_id text, snapshot_billing_team_id text,
        install_log text, dev_log text, runtime text, terminal_cwd text, root_directory text,
        error text, last_preview_error text, last_boot_error text, created_at timestamptz default now(),
        last_active_at timestamptz, billing_source text, billing_team_id text, billing_project_id text,
        vercel_team_id text, vercel_project_id text, persistent boolean, limit_claim_id text,
        last_boot_started_at timestamptz, last_boot_completed_at timestamptz
      );
      insert into repos(id, dev_port, dev_port_auto, runtime) values ('repo-1',3000,true,'node22');
    `);
    await pg.query(
      `insert into sandboxes(id,repo_id,user_id,sandbox_id,base_branch,working_branch,status,health_status,persistent,snapshot_id)
      values($1,'repo-1','user-1','vm_123','main','saved-work','paused','paused',true,'snap_saved')`,
      [recordId]
    );
    await pg.exec(
      await readFile(
        path.join(
          process.cwd(),
          "neon/migrations/20261011173500_sandbox_boot_reconciliation.sql"
        ),
        "utf8"
      )
    );
    const queryable: Queryable = {
      query: async (sql, values) => {
        const result = await pg.query(sql, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const db = createPostgrestShim(queryable);
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: db.from.bind(db),
    });
    const handler = createSandboxResumeHandler({
      loadOwnedSandboxRouteContext: (async () => {
        const { data, error } = await db
          .from("sandboxes")
          .select(RESUME_SELECT)
          .eq("id", recordId)
          .single();
        if (error) throw new Error(error.message);
        return { ...buildLoadedResumeContext(), record: data };
      }) as never,
      enforceSandboxBootLimits: async () => ({ allowed: true }) as never,
      getSandbox: async () => {
        await duringWake(pg);
        return { stop: async () => {} } as never;
      },
      requireSandboxBillingSession: async () =>
        ({ metered: false, reason: "not_platform" }) as never,
      resolveRepoSandboxEnv: async () =>
        ({ envVars: {}, sync: { mode: "sandbox-only" } }) as never,
      async *bootstrapFromSnapshotStreaming() {
        yield { type: "preview_url", url: "https://preview.example.com" };
        yield { type: "status", status: "running" };
      },
      prepareSandboxBillingClose: async () => null,
      finalizeSandboxBillingClose: async () => ({
        finalized: false,
        metered: false,
      }),
    });
    await run({
      pg,
      resume: () =>
        handler(
          new Request(`http://localhost/api/sandbox/${recordId}/resume`, {
            method: "POST",
          }),
          { params: Promise.resolve({ id: recordId }) }
        ),
    });
  } finally {
    if (previous) Object.defineProperty(supabaseAdmin, "from", previous);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await pg.close();
  }
}

export async function legacyMissingVmWrite(pg: PGlite) {
  await pg.exec(
    "update sandboxes set status='stopped',health_status='stopped',stop_reason='vm_gone' where status in ('creating','installing','running')"
  );
}
