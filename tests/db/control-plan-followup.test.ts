import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const REPO = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
let runId: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role;"
  );
  for (const file of [
    "20260807190000_orchestration_runs.sql",
    "20260810180000_control_sessions.sql",
    "20260812120000_control_sessions_repo.sql",
    "20260813120000_orchestration_worktrees.sql",
    "20260813133000_orchestration_worktrees_review_followup.sql",
    "20260907010000_control_followup_planning.sql",
  ]) {
    if (file === "20260813120000_orchestration_worktrees.sql")
      await db.exec(
        "create table external_agent_runs (id uuid primary key, user_id uuid, repo_id uuid, sandbox_record_id uuid);"
      );
    await db.exec(
      await readFile(
        new URL(`../../neon/migrations/${file}`, import.meta.url),
        "utf8"
      )
    );
  }
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("truncate orchestration_runs cascade;");
  runId = randomUUID();
  await db.query(
    `insert into orchestration_runs (id,user_id,repo_id,title,slug,request,base_branch,spec_branch,integration_branch) values ($1,$2,$3,'Review','review','Review','main','spec/review','integration/review')`,
    [runId, OWNER, REPO]
  );
});
function task(slug: string, orderIndex = 0) {
  return {
    slug,
    orderIndex,
    title: slug,
    prompt: `Review ${slug}`,
    harness: "codex",
    filePath: `specs/review/tasks/${orderIndex}-${slug}.md`,
    branchName: `mogplex/task/review/${slug}`,
    ownedPaths: [slug],
    blockedPaths: [],
    dependsOn: [],
    acceptanceCriteria: [],
    validationCommands: [],
  };
}
async function plan(tasks: ReturnType<typeof task>[], owner = OWNER) {
  const result = await db.query<{
    tasks: Array<{ id: string; spec_id: string }>;
  }>("select create_orchestration_plan($1,$2,'Review','','{}',$3) as tasks", [
    runId,
    owner,
    JSON.stringify(tasks),
  ]);
  return result.rows[0]!.tasks;
}

it("appends a follow-up plan and replays matching tasks without replacing earlier work", async () => {
  const original = await plan([task("ci")]);
  expect(await plan([task("ci")])).toEqual(original);
  const added = await plan([task("docs", 1)]);
  expect(added[0]!.id).not.toBe(original[0]!.id);
  const counts = await db.query<{ tasks: number; masters: number }>(
    "select (select count(*)::int from orchestration_tasks) as tasks,(select count(*)::int from orchestration_specs where kind='master') as masters"
  );
  expect(counts.rows[0]).toEqual({ tasks: 2, masters: 1 });
  await expect(
    plan([{ ...task("ci"), prompt: "Replace earlier instructions" }])
  ).rejects.toThrow(/slug/i);
  await expect(plan([task("other")], OTHER)).rejects.toThrow(
    /mission not found/
  );
});

it("rolls back every new follow-up task when one conflicts with existing instructions", async () => {
  await plan([task("ci")]);
  await expect(
    plan([task("docs", 1), { ...task("ci"), prompt: "Different work" }])
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::int as count from orchestration_tasks"
      )
    ).rows[0]!.count
  ).toBe(1);
});

it("keeps each follow-up's plan instructions with its tasks and preserves the original master", async () => {
  await plan([task("ci")]);
  const instructions = {
    objective: "Review compatibility",
    context: "Existing clients depend on this API",
    constraints: ["Do not change the public API"],
  };
  const args = [
    runId,
    OWNER,
    instructions.objective,
    instructions.context,
    instructions.constraints,
    JSON.stringify([task("compatibility", 1)]),
  ];
  await db.query("select create_orchestration_plan($1,$2,$3,$4,$5,$6)", args);
  const saved = await db.query<{ metadata: { plan: typeof instructions } }>(
    "select t.metadata from orchestration_tasks t join orchestration_specs s on s.id=t.spec_id where s.slug='compatibility'"
  );
  expect(saved.rows[0]!.metadata.plan).toEqual(instructions);
  const master = await db.query(
    "select prompt,acceptance_criteria from orchestration_specs where kind='master'"
  );
  expect(master.rows[0]).toEqual({ prompt: "Review", acceptance_criteria: [] });
  await expect(
    db.query("select create_orchestration_plan($1,$2,$3,$4,$5,$6)", [
      ...args.slice(0, 4),
      ["Change the public API"],
      args[5],
    ])
  ).rejects.toThrow(/slug/i);
});

it("reactivates an archived checkout without changing its branch, path or saved work", async () => {
  const [planned] = await plan([task("ci")]);
  const worktreeId = randomUUID();
  const checkout = `/vercel/sandbox/.worktrees/${worktreeId}`;
  await db.query(
    `insert into orchestration_worktrees(id,user_id,run_id,task_id,repo_id,sandbox_id,branch_name,base_branch,checkout_path,status,archived_at,latest_commit_sha) values ($1,$2,$3,$4,$5,$6,'mogplex/task/review/ci','main',$7,'archived',now(),'saved-commit')`,
    [worktreeId, OWNER, runId, planned!.id, REPO, randomUUID(), checkout]
  );
  const claim = async (owner = OWNER) =>
    (
      await db.query<{ token: string | null }>(
        "select claim_archived_worktree($1,$2,(select updated_at from orchestration_worktrees where id=$1)) as token",
        [worktreeId, owner]
      )
    ).rows[0]!.token;
  expect(await claim(OTHER)).toBeNull();
  const token = await claim();
  expect(token).toEqual(expect.any(String));
  expect(await claim()).toBeNull();
  await db.query("select release_archived_worktree($1,$2,$3)", [
    worktreeId,
    OTHER,
    token,
  ]);
  await db.query("select release_archived_worktree($1,$2,$3)", [
    worktreeId,
    OWNER,
    randomUUID(),
  ]);
  expect(await claim()).toBeNull();
  await expect(
    db.query("select activate_orchestration_worktree($1,$2,$3)", [
      worktreeId,
      OTHER,
      checkout,
    ])
  ).rejects.toThrow();
  await expect(
    db.query("select activate_orchestration_worktree($1,$2,$3)", [
      worktreeId,
      OWNER,
      `/other/.worktrees/${worktreeId}`,
    ])
  ).rejects.toThrow();
  await db.query("select activate_orchestration_worktree($1,$2,$3)", [
    worktreeId,
    OWNER,
    checkout,
  ]);
  const result = await db.query(
    "select w.status,w.archived_at,w.checkout_path,w.branch_name,w.latest_commit_sha,t.worktree_id from orchestration_worktrees w join orchestration_tasks t on t.id=w.task_id where w.id=$1",
    [worktreeId]
  );
  expect(result.rows[0]).toMatchObject({
    status: "active",
    archived_at: null,
    checkout_path: checkout,
    branch_name: "mogplex/task/review/ci",
    latest_commit_sha: "saved-commit",
    worktree_id: worktreeId,
  });
  await db.query("select release_archived_worktree($1,$2,$3)", [
    worktreeId,
    OWNER,
    token,
  ]);
  expect(await claim()).toBeNull();
});
