import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { loadControlWorkers } from "@/lib/control/workers-data";

it.each(["neon", "supabase"])(
  "%s RPC reads bounded worker activity through the real ownership schema and SQL adapter",
  async (migrationRoot) => {
    const db = new PGlite();
    const owner = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    const repo = "00000000-0000-4000-8000-000000000003";
    const sandbox = "00000000-0000-4000-8000-000000000004";
    const call = "00000000-0000-4000-8000-000000000005";
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role;
      create table external_agent_runs (id uuid primary key default gen_random_uuid(), user_id uuid not null, repo_id uuid not null,
        sandbox_record_id uuid, ai_call_id uuid, status text, error text, created_at timestamptz default now(), updated_at timestamptz default now());
      create table ai_call_events (id uuid primary key default gen_random_uuid(), user_id uuid, ai_call_id uuid,
        event_type text, tool_name text, message text, payload jsonb default '{}', created_at timestamptz default now());`);
      for (const file of [
        "20260807190000_orchestration_runs.sql",
        "20260810180000_control_sessions.sql",
        "20260812120000_control_sessions_repo.sql",
        "20260813120000_orchestration_worktrees.sql",
        "20260813133000_orchestration_worktrees_review_followup.sql",
      ]) {
        await db.exec(
          await readFile(
            new URL(`../../neon/migrations/${file}`, import.meta.url),
            "utf8"
          )
        );
      }
      const migration = await readFile(
        new URL(
          `../../${migrationRoot}/migrations/20260905181000_control_mission_worker_activity.sql`,
          import.meta.url
        ),
        "utf8"
      );
      await db.exec(migration);
      await db.exec(migration);
      const run = (
        await db.query<{ id: string }>(
          `insert into orchestration_runs (user_id,repo_id,title,slug,request,base_branch,spec_branch,integration_branch)
      values ($1,$2,'Mission','mission','Fix tests','main','spec/mission','integrate/mission') returning id`,
          [owner, repo]
        )
      ).rows[0]!.id;
      const session = (
        await db.query<{ id: string }>(
          `insert into control_sessions (user_id,repo_id,orchestration_run_id,title)
      values ($1,$2,$3,'Mission') returning id`,
          [owner, repo, run]
        )
      ).rows[0]!.id;
      const spec = (
        await db.query<{ id: string }>(
          `insert into orchestration_specs (run_id,kind,slug,title,file_path)
      values ($1,'task','tests','Tests','specs/tests.md') returning id`,
          [run]
        )
      ).rows[0]!.id;
      const task = (
        await db.query<{ id: string }>(
          `insert into orchestration_tasks (run_id,spec_id,repo_id,harness,branch_name,base_branch)
      values ($1,$2,$3,'codex','fix/tests','main') returning id`,
          [run, spec, repo]
        )
      ).rows[0]!.id;
      const tree = "00000000-0000-4000-8000-000000000006";
      await db.query(
        `insert into orchestration_worktrees (id,user_id,run_id,task_id,repo_id,sandbox_id,branch_name,base_branch,checkout_path,status)
      values ($1,$2,$3,$4,$5,$6,'fix/tests','main',$7,'active')`,
        [
          tree,
          owner,
          run,
          task,
          repo,
          sandbox,
          `/vercel/sandbox/.worktrees/${tree}`,
        ]
      );
      await db.query(
        `insert into external_agent_runs (user_id,repo_id,sandbox_record_id,worktree_id,ai_call_id,status,created_at)
      values ($1,$2,$3,$4,$5,'success','2026-09-04'),($1,$2,$3,$4,$5,'failed','2026-09-05')`,
        [owner, repo, sandbox, tree, call]
      );
      await db.query(
        `insert into ai_call_events (user_id,ai_call_id,event_type,tool_name,message,payload,created_at)
      values ($1,$2,'tool_started','Command','Start','{"toolCallId":"cmd","input":{"command":"pnpm test"}}','2026-09-05T01:00:00Z'),
      ($1,$2,'tool_finished','Command','Failed','{"toolCallId":"cmd","state":"error","output":"3 tests failed"}','2026-09-05T01:00:01Z'),
      ($3,$2,'message',null,'other user private output','{}','2026-09-05T01:00:02Z')`,
        [owner, call, other]
      );
      let queryCount = 0;
      const client = createPostgrestShim({
        query: async (sql, values) => {
          queryCount += 1;
          return {
            rows: (await db.query(sql, values ?? [])).rows as Record<
              string,
              unknown
            >[],
          };
        },
      });
      const boundary = client as unknown as Parameters<
        typeof loadControlWorkers
      >[2];
      const workers = await loadControlWorkers(owner, session, boundary);
      // First RPC lookup includes function-shape discovery; subsequent calls use one query.
      expect(queryCount).toBeLessThanOrEqual(2);
      expect(workers).toHaveLength(1);
      expect(workers?.[0]).toMatchObject({
        status: "failed",
        branch: "fix/tests",
        events: [
          {
            type: "tool_started",
            payload: { input: { command: "pnpm test" } },
          },
          { type: "tool_finished", payload: { output: "3 tests failed" } },
        ],
      });
      expect(JSON.stringify(workers)).not.toContain(
        "other user private output"
      );
      expect(await loadControlWorkers(other, session, boundary)).toBeNull();
      const beforeStatusOnly = queryCount;
      expect(
        await loadControlWorkers(owner, session, boundary, {
          includeEvents: false,
        })
      ).toMatchObject([{ status: "failed", events: [] }]);
      expect(queryCount - beforeStatusOnly).toBe(1);
      expect(
        (
          await db.query(
            "select role, has_function_privilege(role, 'public.control_mission_workers(uuid,uuid,boolean)', 'EXECUTE') as allowed from (values ('anon'), ('authenticated'), ('service_role')) roles(role)"
          )
        ).rows
      ).toEqual([
        { role: "anon", allowed: false },
        { role: "authenticated", allowed: false },
        { role: "service_role", allowed: true },
      ]);
      // A second checkout shares the mission but has its own attempt and event window.
      const secondTask = (
        await db.query<{ id: string }>(
          `insert into orchestration_tasks (run_id,spec_id,repo_id,harness,branch_name,base_branch)
      values ($1,$2,$3,'codex','fix/other','main') returning id`,
          [run, spec, repo]
        )
      ).rows[0]!.id;
      const secondTree = "00000000-0000-4000-8000-000000000007";
      const secondCall = "00000000-0000-4000-8000-000000000008";
      await db.query(
        `insert into orchestration_worktrees (id,user_id,run_id,task_id,repo_id,sandbox_id,branch_name,base_branch,checkout_path,status)
      values ($1,$2,$3,$4,$5,$6,'fix/other','main',$7,'active')`,
        [
          secondTree,
          owner,
          run,
          secondTask,
          repo,
          sandbox,
          `/vercel/sandbox/.worktrees/${secondTree}`,
        ]
      );
      await db.query(
        `insert into external_agent_runs (user_id,repo_id,sandbox_record_id,worktree_id,ai_call_id,status)
      values ($1,$2,$3,$4,$5,'streaming')`,
        [owner, repo, sandbox, secondTree, secondCall]
      );
      await db.query(
        `insert into ai_call_events (user_id,ai_call_id,event_type,message,created_at)
      select $1,$2,'message','line ' || n,'2026-09-05T02:00:00Z'::timestamptz + n * interval '1 second'
      from generate_series(1,105) n`,
        [owner, call]
      );
      await db.query(
        `insert into ai_call_events (user_id,ai_call_id,event_type,message)
      values ($1,$2,'message','Second worker is still working')`,
        [owner, secondCall]
      );
      const beforeMultipleWorkers = queryCount;
      const multiple = await loadControlWorkers(owner, session, boundary);
      expect(queryCount - beforeMultipleWorkers).toBe(1);
      expect(multiple).toHaveLength(2);
      const firstEvents = multiple?.find(
        (worker) => worker.worktreeId === tree
      )?.events;
      expect(firstEvents).toHaveLength(100);
      expect(firstEvents?.[0]?.message).toBe("line 6");
      expect(firstEvents?.at(-1)?.message).toBe("line 105");
      expect(
        multiple?.find((worker) => worker.worktreeId === secondTree)
      ).toMatchObject({
        status: "streaming",
        events: [{ message: "Second worker is still working" }],
      });
    } finally {
      await db.close();
    }
  }
);
