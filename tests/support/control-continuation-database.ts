import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPostgrestShim } from "../../lib/db/postgrest-shim";

export async function controlContinuationDatabase(root: "neon" | "supabase") {
  const db = new PGlite();
  const owner = randomUUID();
  const repoId = randomUUID();
  const parentCallId = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table ai_calls (id uuid primary key, user_id uuid not null, metadata jsonb not null default '{}');
    create table external_agent_runs (id uuid primary key default gen_random_uuid(), user_id uuid not null, repo_id uuid not null,
      sandbox_record_id uuid, ai_call_id uuid, status text, error text, created_at timestamptz default now(), updated_at timestamptz default now());`);
  for (const name of [
    "20260803010000_realtime_notify_triggers.sql",
    "20260807190000_orchestration_runs.sql",
    "20260810180000_control_sessions.sql",
    "20260812120000_control_sessions_repo.sql",
    "20260813120000_orchestration_worktrees.sql",
    "20260813133000_orchestration_worktrees_review_followup.sql",
    "20260905184000_control_save_messages.sql",
  ])
    await db.exec(
      await readFile(join(process.cwd(), "neon/migrations", name), "utf8")
    );
  const migration = await readFile(
    join(
      process.cwd(),
      root,
      "migrations/20260905193000_control_continuations.sql"
    ),
    "utf8"
  );
  await db.exec(migration);
  await db.exec(migration);
  const mission = async () =>
    (
      await db.query<{ id: string }>(
        `insert into orchestration_runs
    (user_id,repo_id,title,slug,request,base_branch,spec_branch,integration_branch)
    values ($1,$2,'Mission',$3,'Fix tests','main','spec/mission','integrate/mission') returning id`,
        [owner, repoId, randomUUID()]
      )
    ).rows[0].id;
  const runId = await mission();
  const sessionId = (
    await db.query<{ id: string }>(
      `insert into control_sessions(user_id,repo_id,orchestration_run_id,title,messages)
    values ($1,$2,$3,'Mission',$4) returning id`,
      [
        owner,
        repoId,
        runId,
        JSON.stringify([
          {
            id: "origin",
            role: "user",
            parts: [{ type: "text", text: "Fix, verify, and open a PR." }],
          },
        ]),
      ]
    )
  ).rows[0].id;
  await db.query(
    "insert into ai_calls(id,user_id,metadata) values ($1,$2,$3)",
    [parentCallId, owner, JSON.stringify({ mission_id: sessionId })]
  );
  const addWorker = async (workerMission = runId) => {
    const specId = (
      await db.query<{ id: string }>(
        `insert into orchestration_specs(run_id,kind,slug,title,file_path)
      values ($1,'task',$2,'Task',$3) returning id`,
        [workerMission, randomUUID(), `specs/${randomUUID()}.md`]
      )
    ).rows[0].id;
    const branch = `fix/${randomUUID()}`;
    const taskId = (
      await db.query<{ id: string }>(
        `insert into orchestration_tasks(run_id,spec_id,repo_id,harness,branch_name,base_branch)
      values ($1,$2,$3,'codex',$4,'main') returning id`,
        [workerMission, specId, repoId, branch]
      )
    ).rows[0].id;
    const treeId = randomUUID();
    const sandboxId = randomUUID();
    await db.query(
      `insert into orchestration_worktrees(id,user_id,run_id,task_id,repo_id,sandbox_id,branch_name,base_branch,checkout_path,status)
      values ($1,$2,$3,$4,$5,$6,$7,'main',$8,'active')`,
      [
        treeId,
        owner,
        workerMission,
        taskId,
        repoId,
        sandboxId,
        branch,
        `/vercel/sandbox/.worktrees/${treeId}`,
      ]
    );
    return (
      await db.query<{ id: string }>(
        `insert into external_agent_runs(user_id,repo_id,sandbox_record_id,worktree_id,ai_call_id,status)
      values ($1,$2,$3,$4,$5,'streaming') returning id`,
        [owner, repoId, sandboxId, treeId, randomUUID()]
      )
    ).rows[0].id;
  };
  const workerIds = [await addWorker(), await addWorker()];
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values ?? [])).rows as Record<
        string,
        unknown
      >[],
    }),
  });
  const context = {
    repoId,
    missionId: sessionId,
    model: "fixture-model",
    mode: "run",
    permissions: "default",
    teamId: null,
  };
  const registerArgs = {
    p_user_id: owner,
    p_session_id: sessionId,
    p_parent_ai_call_id: parentCallId,
    p_origin_message_id: "origin",
    p_worker_run_ids: workerIds,
    p_request_context: context,
    p_instruction:
      "Review the workers, integrate and verify before opening the requested PR.",
  };
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>
  ): Promise<T> => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  const parentMessage = {
    id: `control-${parentCallId}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Workers are running; I will review their results.",
      },
    ],
    metadata: { ai_call_id: parentCallId },
  };
  const checkpointParent = () =>
    rpc("control_save_messages", {
      p_user_id: owner,
      p_session_id: sessionId,
      p_messages: [parentMessage],
    });
  return {
    db,
    client,
    owner,
    repoId,
    runId,
    sessionId,
    parentCallId,
    workerIds,
    context,
    registerArgs,
    rpc,
    parentMessage,
    checkpointParent,
    addWorker,
    mission,
  };
}
