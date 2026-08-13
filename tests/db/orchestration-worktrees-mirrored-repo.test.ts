import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = [
  "neon/migrations/20260807190000_orchestration_runs.sql",
  "neon/migrations/20260810180000_control_sessions.sql",
  "neon/migrations/20260812120000_control_sessions_repo.sql",
  "neon/migrations/20260813120000_orchestration_worktrees.sql",
  "neon/migrations/20260813133000_orchestration_worktrees_review_followup.sql",
];
const USER_ID = "00000000-0000-4000-8000-00000000000a";
const REPO_ID = "00000000-0000-4000-8000-00000000001a";
const SESSION_ID = "00000000-0000-4000-8000-00000000003a";
const ORPHANED_SESSION_ID = "00000000-0000-4000-8000-00000000003b";
const ORPHANED_RUN_ID = "00000000-0000-4000-8000-00000000004b";

it("uses the mirrored repository default branch when that table exists", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
    `);
    for (const migration of MIGRATIONS) {
      if (migration.endsWith("orchestration_worktrees.sql")) {
        await db.exec(`
          create table public.external_agent_runs (
            id uuid primary key default gen_random_uuid(),
            user_id uuid not null,
            repo_id uuid not null,
            sandbox_record_id uuid
          );
        `);
      }
      if (migration.endsWith("orchestration_worktrees_review_followup.sql")) {
        await db.exec(`
          create table public.repos (
            id uuid primary key,
            default_branch text not null default 'main'
          );
          insert into public.repos (id, default_branch)
          values ('${REPO_ID}', 'develop');
          insert into public.control_sessions (id, user_id, repo_id, title)
          values
            ('${SESSION_ID}', '${USER_ID}', '${REPO_ID}', 'Legacy'),
            ('${ORPHANED_SESSION_ID}', '${USER_ID}', '${REPO_ID}', 'Orphaned');
          insert into public.orchestration_runs
            (id, user_id, repo_id, title, slug, request, base_branch,
             spec_branch, integration_branch)
          values
            ('${ORPHANED_RUN_ID}', '${USER_ID}', '${REPO_ID}', 'Orphaned',
             'control-' || replace('${ORPHANED_SESSION_ID}', '-', ''),
             'Orphaned', 'develop', 'mogplex/spec/orphaned',
             'mogplex/integrate/orphaned');
        `);
      }
      await db.exec(await readFile(path.join(REPO_ROOT, migration), "utf8"));
    }
    const result = await db.query<{
      orchestration_run_id: string;
      base_branch: string;
    }>(
      `select session.orchestration_run_id, run.base_branch
       from public.control_sessions session
       join public.orchestration_runs run
         on run.id = session.orchestration_run_id
       where session.id in ($1, $2)
       order by session.id`,
      [SESSION_ID, ORPHANED_SESSION_ID]
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.base_branch).toBe("develop");
    expect(result.rows[1]).toEqual({
      orchestration_run_id: ORPHANED_RUN_ID,
      base_branch: "develop",
    });
  } finally {
    await db.close();
  }
});
