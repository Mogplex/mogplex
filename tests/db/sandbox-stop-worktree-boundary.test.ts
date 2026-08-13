import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const SANDBOX_ID = "00000000-0000-4000-8000-00000000002a";
const WORKTREE_ID = "00000000-0000-4000-8000-00000000003a";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.sandboxes (
      id uuid primary key,
      user_id uuid not null,
      repo_id uuid not null,
      sandbox_id text not null,
      status text not null
    );
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
    await db.exec(await readFile(path.join(REPO_ROOT, migration), "utf8"));
  }
});

afterAll(async () => {
  await db.close();
});

describe("sandbox Stop worktree boundary", () => {
  it("keeps the worktree and task binding usable through a stopped record", async () => {
    const checkoutPath = `/vercel/sandbox/.worktrees/${WORKTREE_ID}`;
    const run = await db.query<{ id: string }>(
      `insert into public.orchestration_runs
         (user_id, repo_id, title, slug, request, base_branch,
          spec_branch, integration_branch)
       values ($1, $2, 'Stop boundary', 'stop-boundary', 'Verify Stop', 'main',
         'mogplex/spec/stop-boundary', 'mogplex/integrate/stop-boundary')
       returning id`,
      [USER_ID, REPO_ID]
    );
    const runId = run.rows[0]!.id;
    const spec = await db.query<{ id: string }>(
      `insert into public.orchestration_specs
         (run_id, kind, slug, title, file_path)
       values ($1, 'task', 'implementation', 'Implementation',
         'specs/stop-boundary/tasks/0-implementation.md') returning id`,
      [runId]
    );
    const task = await db.query<{ id: string }>(
      `insert into public.orchestration_tasks
         (run_id, spec_id, repo_id, harness, branch_name, base_branch)
       values ($1, $2, $3, 'codex', 'mogplex/task/stop-boundary', 'main')
       returning id`,
      [runId, spec.rows[0]!.id, REPO_ID]
    );
    await db.query(
      `insert into public.sandboxes
         (id, user_id, repo_id, sandbox_id, status)
       values ($1, $2, $3, 'vm-worktree', 'running')`,
      [SANDBOX_ID, USER_ID, REPO_ID]
    );
    await db.query(
      `insert into public.orchestration_worktrees
         (id, user_id, run_id, task_id, repo_id, sandbox_id, branch_name,
          base_branch, checkout_path, status)
       values ($1, $2, $3, $4, $5, $6, 'mogplex/task/stop-boundary',
         'main', $7, 'creating')`,
      [
        WORKTREE_ID,
        USER_ID,
        runId,
        task.rows[0]!.id,
        REPO_ID,
        SANDBOX_ID,
        checkoutPath,
      ]
    );
    await db.query(
      `select public.activate_orchestration_worktree($1, $2, $3)`,
      [WORKTREE_ID, USER_ID, checkoutPath]
    );

    await db.query(
      `update public.sandboxes set status = 'stopped' where id = $1`,
      [SANDBOX_ID]
    );

    const { rows } = await db.query<{
      sandbox_status: string;
      worktree_status: string;
      worktree_id: string;
      checkout_path: string;
      task_worktree_id: string;
      task_root_directory: string;
    }>(
      `select sandbox.status as sandbox_status,
              worktree.status as worktree_status,
              worktree.id as worktree_id,
              worktree.checkout_path,
              task.worktree_id as task_worktree_id,
              task.root_directory as task_root_directory
       from public.sandboxes sandbox
       join public.orchestration_worktrees worktree
         on worktree.sandbox_id = sandbox.id
       join public.orchestration_tasks task on task.id = worktree.task_id
       where sandbox.id = $1`,
      [SANDBOX_ID]
    );
    expect(rows[0]).toEqual({
      sandbox_status: "stopped",
      worktree_status: "active",
      worktree_id: WORKTREE_ID,
      checkout_path: checkoutPath,
      task_worktree_id: WORKTREE_ID,
      task_root_directory: checkoutPath,
    });

    // Restart targets the same persisted sandbox record and recovers the
    // existing checkout relationship; it does not mint another worktree.
    await db.query(
      `update public.sandboxes set status = 'running' where id = $1`,
      [SANDBOX_ID]
    );
    const restarted = await db.query<{
      sandbox_id: string;
      sandbox_status: string;
      worktree_id: string;
      worktree_status: string;
    }>(
      `select sandbox.id as sandbox_id, sandbox.status as sandbox_status,
              worktree.id as worktree_id, worktree.status as worktree_status
       from public.sandboxes sandbox
       join public.orchestration_worktrees worktree
         on worktree.sandbox_id = sandbox.id
       where sandbox.id = $1`,
      [SANDBOX_ID]
    );
    expect(restarted.rows[0]).toEqual({
      sandbox_id: SANDBOX_ID,
      sandbox_status: "running",
      worktree_id: WORKTREE_ID,
      worktree_status: "active",
    });

    // Worktree lifecycle is independent in the other direction: archive and
    // prune release the task checkout while compute stays running.
    await db.query(
      `update public.orchestration_worktrees
       set status = 'archived', archived_at = now() where id = $1`,
      [WORKTREE_ID]
    );
    await db.query(`select public.prune_orchestration_worktree($1, $2)`, [
      WORKTREE_ID,
      USER_ID,
    ]);
    const pruned = await db.query<{
      sandbox_status: string;
      worktree_status: string;
      task_worktree_id: string | null;
      task_root_directory: string | null;
    }>(
      `select sandbox.status as sandbox_status,
              worktree.status as worktree_status,
              task.worktree_id as task_worktree_id,
              task.root_directory as task_root_directory
       from public.sandboxes sandbox
       join public.orchestration_worktrees worktree
         on worktree.sandbox_id = sandbox.id
       join public.orchestration_tasks task on task.id = worktree.task_id
       where sandbox.id = $1`,
      [SANDBOX_ID]
    );
    expect(pruned.rows[0]).toEqual({
      sandbox_status: "running",
      worktree_status: "pruned",
      task_worktree_id: null,
      task_root_directory: null,
    });
  });
});
