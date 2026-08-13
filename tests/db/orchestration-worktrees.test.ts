import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildReservedCheckoutPath } from "../../lib/worktrees/store";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = [
  "neon/migrations/20260807190000_orchestration_runs.sql",
  "neon/migrations/20260810180000_control_sessions.sql",
  "neon/migrations/20260812120000_control_sessions_repo.sql",
  "neon/migrations/20260813120000_orchestration_worktrees.sql",
  "neon/migrations/20260813133000_orchestration_worktrees_review_followup.sql",
];
const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const REPO_A = "00000000-0000-4000-8000-00000000001a";
const REPO_B = "00000000-0000-4000-8000-00000000001b";
const SANDBOX_A = "00000000-0000-4000-8000-00000000002a";
const LEGACY_SESSION = "00000000-0000-4000-8000-00000000003a";
const LEGACY_LONG_SESSION = "00000000-0000-4000-8000-00000000003b";
let db: PGlite;
let legacyBackfills: Array<{
  run_id: string;
  base_branch: string;
  title: string;
}> = [];
beforeAll(async () => {
  db = new PGlite();
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
        insert into public.control_sessions (id, user_id, repo_id, title)
        values
          ('${LEGACY_SESSION}', '${USER_A}', '${REPO_A}', ''),
          ('${LEGACY_LONG_SESSION}', '${USER_A}', '${REPO_A}', repeat('x', 600));
      `);
    }
    const sql = await readFile(path.join(REPO_ROOT, migration), "utf8");
    await db.exec(sql);
  }
  const backfill = await db.query<{
    run_id: string;
    base_branch: string;
    title: string;
  }>(
    `select run.id as run_id, run.base_branch, run.title
     from public.control_sessions session
     join public.orchestration_runs run
       on run.id = session.orchestration_run_id
     where session.id in ($1, $2)
     order by session.id`,
    [LEGACY_SESSION, LEGACY_LONG_SESSION]
  );
  legacyBackfills = backfill.rows;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(`
    truncate public.control_sessions cascade;
    truncate public.external_agent_runs cascade;
    truncate public.orchestration_runs cascade;
  `);
});
async function insertRun(userId = USER_A, repoId = REPO_A) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orchestration_runs
       (user_id, repo_id, title, slug, request, base_branch,
        spec_branch, integration_branch)
     values ($1, $2, 'Worktree mission', $3, 'Build it', 'main',
       'mogplex/spec/worktree-mission', 'mogplex/integrate/worktree-mission')
     returning id`,
    [userId, repoId, `worktree-mission-${userId.slice(-1)}-${repoId.slice(-1)}`]
  );
  return rows[0]!.id;
}
async function insertTask(runId: string, repoId = REPO_A) {
  const spec = await db.query<{ id: string }>(
    `insert into public.orchestration_specs
       (run_id, kind, slug, title, file_path)
     values ($1, 'task', 'implementation', 'Implementation',
       'specs/worktree-mission/tasks/0-implementation.md')
     returning id`,
    [runId]
  );
  const task = await db.query<{ id: string }>(
    `insert into public.orchestration_tasks
       (run_id, spec_id, repo_id, harness, branch_name, base_branch)
     values ($1, $2, $3, 'codex', 'mogplex/task/implementation', 'main')
     returning id`,
    [runId, spec.rows[0]!.id, repoId]
  );
  return task.rows[0]!.id;
}
async function insertWorktree(input: {
  runId: string;
  taskId: string;
  userId?: string;
  repoId?: string;
  status?: string;
}) {
  const worktreeId = randomUUID();
  return db.query<{ id: string }>(
    `insert into public.orchestration_worktrees
       (id, user_id, run_id, task_id, repo_id, sandbox_id, branch_name,
        base_branch, checkout_path, status, archived_at)
     values ($7::uuid, $1, $2, $3, $4, $5, 'mogplex/task/implementation', 'main',
       $8, $6,
       case when $6 = 'archived' then now() else null end)
     returning id`,
    [
      input.userId ?? USER_A,
      input.runId,
      input.taskId,
      input.repoId ?? REPO_A,
      SANDBOX_A,
      input.status ?? "active",
      worktreeId,
      buildReservedCheckoutPath(worktreeId),
    ]
  );
}
describe("orchestration worktree persistence", () => {
  it("backfills legacy sessions without mirrored repos and clamps titles", () => {
    expect(legacyBackfills).toHaveLength(2);
    expect(legacyBackfills.map((row) => row.base_branch)).toEqual([
      "main",
      "main",
    ]);
    expect(legacyBackfills.map((row) => row.title)).toEqual([
      "New session",
      "x".repeat(500),
    ]);
  });
  it("keeps every worktree RPC service-role only", async () => {
    const signatures = [
      "public.activate_orchestration_worktree(uuid,uuid,text)",
      "public.prune_orchestration_worktree(uuid,uuid)",
      "public.bind_orchestration_worktree_agent(uuid,uuid,uuid)",
      "public.create_orchestration_plan(uuid,uuid,text,text,text[],jsonb)",
    ];
    for (const signature of signatures) {
      const privileges = await db.query<{
        authenticated: boolean;
        service_role: boolean;
      }>(
        `select
           has_function_privilege('authenticated', $1, 'execute')
             as authenticated,
           has_function_privilege('service_role', $1, 'execute')
             as service_role`,
        [signature]
      );
      expect(privileges.rows[0], signature).toEqual({
        authenticated: false,
        service_role: true,
      });
    }
  });
  it("creates every mission task atomically", async () => {
    const runId = await insertRun();
    const tasks = [
      {
        orderIndex: 0,
        slug: "code",
        title: "Code",
        filePath: "specs/worktree-mission/tasks/0-code.md",
        branchName: "mogplex/task/worktree-mission/code",
        harness: "codex",
        ownedPaths: ["lib"],
        blockedPaths: [],
        dependsOn: [],
        acceptanceCriteria: ["works"],
        validationCommands: ["pnpm test"],
        prompt: "Implement",
      },
      {
        orderIndex: 1,
        slug: "tests",
        title: "Tests",
        filePath: "specs/worktree-mission/tasks/1-tests.md",
        branchName: "mogplex/task/worktree-mission/tests",
        harness: "claude-code",
        ownedPaths: ["tests"],
        blockedPaths: [],
        dependsOn: [],
        acceptanceCriteria: [],
        validationCommands: [],
        prompt: "Verify",
      },
    ];
    const created = await db.query<{ task_count: number }>(
      `select jsonb_array_length(
         public.create_orchestration_plan($1, $2, $3, $4, $5, $6)
       ) as task_count`,
      [runId, USER_A, "Build it", "Context", ["Safe"], JSON.stringify(tasks)]
    );
    expect(created.rows[0]!.task_count).toBe(2);
    const counts = await db.query<{ specs: number; tasks: number }>(
      `select
         (select count(*)::int from public.orchestration_specs where run_id = $1) as specs,
         (select count(*)::int from public.orchestration_tasks where run_id = $1) as tasks`,
      [runId]
    );
    expect(counts.rows[0]).toEqual({ specs: 3, tasks: 2 });
    const failingRun = await insertRun(USER_A, REPO_B);
    await expect(
      db.query(
        `select public.create_orchestration_plan($1, $2, $3, $4, $5, $6)`,
        [
          failingRun,
          USER_A,
          "Fail atomically",
          "",
          [],
          JSON.stringify([
            tasks[0],
            { ...tasks[1], slug: "bad", harness: "unknown" },
          ]),
        ]
      )
    ).rejects.toThrow();
    const partial = await db.query<{ count: number }>(
      `select count(*)::int as count from public.orchestration_specs where run_id = $1`,
      [failingRun]
    );
    expect(partial.rows[0]!.count).toBe(0);
  });
  it("binds a worktree to one owned run, task, repo, sandbox, and checkout", async () => {
    const runId = await insertRun();
    const taskId = await insertTask(runId);
    const worktree = await insertWorktree({ runId, taskId });
    const { rows } = await db.query<{
      worktree_id: string | null;
      sandbox_id: string | null;
    }>(
      `select worktree_id, sandbox_id
       from public.orchestration_tasks where id = $1`,
      [taskId]
    );
    expect(worktree.rows[0]!.id).toBeTruthy();
    expect(rows[0]).toEqual({ worktree_id: null, sandbox_id: null });

    await db.query(
      `update public.orchestration_tasks
       set worktree_id = $1, sandbox_id = $2 where id = $3`,
      [worktree.rows[0]!.id, SANDBOX_A, taskId]
    );
    const linked = await db.query<{
      worktree_id: string;
      sandbox_id: string;
    }>(
      `select worktree_id, sandbox_id
       from public.orchestration_tasks where id = $1`,
      [taskId]
    );
    expect(linked.rows[0]).toEqual({
      worktree_id: worktree.rows[0]!.id,
      sandbox_id: SANDBOX_A,
    });
  });

  it("rejects cross-user, cross-repo, and cross-run task bindings", async () => {
    const runA = await insertRun(USER_A, REPO_A);
    const taskA = await insertTask(runA, REPO_A);
    const runB = await insertRun(USER_B, REPO_B);
    const taskB = await insertTask(runB, REPO_B);

    await expect(
      insertWorktree({ runId: runA, taskId: taskA, userId: USER_B })
    ).rejects.toThrow();
    await expect(
      insertWorktree({ runId: runA, taskId: taskA, repoId: REPO_B })
    ).rejects.toThrow();
    await expect(
      insertWorktree({ runId: runA, taskId: taskB })
    ).rejects.toThrow();
  });

  it("allows one sandbox to host multiple task worktrees", async () => {
    const runId = await insertRun();
    const firstTask = await insertTask(runId);
    const secondSpec = await db.query<{ id: string }>(
      `insert into public.orchestration_specs
         (run_id, kind, slug, title, file_path)
       values ($1, 'task', 'tests', 'Tests',
         'specs/worktree-mission/tasks/1-tests.md') returning id`,
      [runId]
    );
    const secondTask = await db.query<{ id: string }>(
      `insert into public.orchestration_tasks
         (run_id, spec_id, repo_id, harness, branch_name, base_branch)
       values ($1, $2, $3, 'codex', 'mogplex/task/tests', 'main')
       returning id`,
      [runId, secondSpec.rows[0]!.id, REPO_A]
    );

    await insertWorktree({ runId, taskId: firstTask });
    await db.query(
      `insert into public.orchestration_worktrees
         (id, user_id, run_id, task_id, repo_id, sandbox_id, branch_name,
          base_branch, checkout_path, status)
       values ('22222222-2222-4222-8222-222222222222', $1, $2, $3, $4, $5,
         'mogplex/task/tests', 'main',
         '/vercel/sandbox/.worktrees/22222222-2222-4222-8222-222222222222',
         'active')`,
      [USER_A, runId, secondTask.rows[0]!.id, REPO_A, SANDBOX_A]
    );

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.orchestration_worktrees
       where sandbox_id = $1`,
      [SANDBOX_A]
    );
    expect(rows[0]!.count).toBe(2);
  });

  it("keeps archived worktrees until explicit prune and then releases bindings", async () => {
    const runId = await insertRun();
    const taskId = await insertTask(runId);
    const first = await insertWorktree({ runId, taskId, status: "archived" });

    await expect(
      insertWorktree({ runId, taskId, status: "active" })
    ).rejects.toThrow();

    await db.query(
      `update public.orchestration_worktrees
       set status = 'pruned', pruned_at = now() where id = $1`,
      [first.rows[0]!.id]
    );
    const replacement = await insertWorktree({
      runId,
      taskId,
      status: "active",
    });
    expect(replacement.rows[0]!.id).not.toBe(first.rows[0]!.id);
  });

  it("activates and prunes the worktree and task binding atomically", async () => {
    const runId = await insertRun();
    const taskId = await insertTask(runId);
    const worktree = await insertWorktree({
      runId,
      taskId,
      status: "creating",
    });
    const worktreeId = worktree.rows[0]!.id;
    const checkoutPath = `/vercel/sandbox/.worktrees/${worktreeId}`;

    await db.query(
      `select public.activate_orchestration_worktree($1, $2, $3)`,
      [worktreeId, USER_A, checkoutPath]
    );
    const activated = await db.query<{
      status: string;
      worktree_id: string;
      root_directory: string;
    }>(
      `select w.status, t.worktree_id, t.root_directory
       from public.orchestration_worktrees w
       join public.orchestration_tasks t on t.id = w.task_id
       where w.id = $1`,
      [worktreeId]
    );
    expect(activated.rows[0]).toEqual({
      status: "active",
      worktree_id: worktreeId,
      root_directory: checkoutPath,
    });

    const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query(
      `select public.bind_orchestration_worktree_agent($1, $2, $3)`,
      [worktreeId, USER_A, agentId]
    );
    const agentBinding = await db.query<{
      worktree_agent_id: string;
      task_agent_id: string;
    }>(
      `select w.agent_id as worktree_agent_id, t.agent_id as task_agent_id
       from public.orchestration_worktrees w
       join public.orchestration_tasks t on t.id = w.task_id
       where w.id = $1`,
      [worktreeId]
    );
    expect(agentBinding.rows[0]).toEqual({
      worktree_agent_id: agentId,
      task_agent_id: agentId,
    });

    await db.query(
      `update public.orchestration_worktrees
       set status = 'archived', archived_at = now() where id = $1`,
      [worktreeId]
    );
    await db.query(`select public.prune_orchestration_worktree($1, $2)`, [
      worktreeId,
      USER_A,
    ]);
    const pruned = await db.query<{
      status: string;
      worktree_id: string | null;
      root_directory: string | null;
    }>(
      `select w.status, t.worktree_id, t.root_directory
       from public.orchestration_worktrees w
       join public.orchestration_tasks t on t.id = w.task_id
       where w.id = $1`,
      [worktreeId]
    );
    expect(pruned.rows[0]).toEqual({
      status: "pruned",
      worktree_id: null,
      root_directory: null,
    });
  });

  it("links Control sessions and worker runs to the exact owned worktree", async () => {
    const runId = await insertRun();
    const taskId = await insertTask(runId);
    const worktree = await insertWorktree({ runId, taskId });

    const session = await db.query<{ orchestration_run_id: string }>(
      `insert into public.control_sessions
         (user_id, repo_id, title, orchestration_run_id)
       values ($1, $2, 'Worktree mission', $3)
       returning orchestration_run_id`,
      [USER_A, REPO_A, runId]
    );
    expect(session.rows[0]!.orchestration_run_id).toBe(runId);

    const worker = await db.query<{ worktree_id: string }>(
      `insert into public.external_agent_runs
         (user_id, repo_id, sandbox_record_id, worktree_id)
       values ($1, $2, $3, $4) returning worktree_id`,
      [USER_A, REPO_A, SANDBOX_A, worktree.rows[0]!.id]
    );
    expect(worker.rows[0]!.worktree_id).toBe(worktree.rows[0]!.id);

    await expect(
      db.query(
        `insert into public.external_agent_runs
           (user_id, repo_id, sandbox_record_id, worktree_id)
         values ($1, $2, $3, $4)`,
        [USER_B, REPO_A, SANDBOX_A, worktree.rows[0]!.id]
      )
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.external_agent_runs
           (user_id, repo_id, worktree_id)
         values ($1, $2, $3)`,
        [USER_A, REPO_A, worktree.rows[0]!.id]
      )
    ).rejects.toThrow();
  });

  it("deletes a run with an active worktree without circular FK failure", async () => {
    const runId = await insertRun();
    const taskId = await insertTask(runId);
    const worktree = await insertWorktree({
      runId,
      taskId,
      status: "creating",
    });
    await db.query(
      `select public.activate_orchestration_worktree($1, $2, $3)`,
      [
        worktree.rows[0]!.id,
        USER_A,
        `/vercel/sandbox/.worktrees/${worktree.rows[0]!.id}`,
      ]
    );
    await db.query(`delete from public.orchestration_runs where id = $1`, [
      runId,
    ]);
    const remaining = await db.query<{ count: number }>(
      `select count(*)::int as count
       from public.orchestration_worktrees where run_id = $1`,
      [runId]
    );
    expect(remaining.rows[0]!.count).toBe(0);
  });
});
