import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION = "neon/migrations/20260807190000_orchestration_runs.sql";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const REPO_1 = "00000000-0000-4000-8000-000000000001";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`truncate public.orchestration_runs cascade`);
});

async function insertRun(overrides?: {
  slug?: string;
  status?: string;
}): Promise<{ id: string; status: string; updated_at: string }> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    updated_at: string;
  }>(
    `insert into public.orchestration_runs
       (user_id, repo_id, title, slug, request, base_branch, spec_branch,
        integration_branch${overrides?.status ? ", status" : ""})
     values ($1, $2, 'Fix login', $3, 'fix the login flow', 'main',
             'mogplex/spec/fix-login', 'mogplex/integrate/fix-login'
             ${overrides?.status ? ", $4" : ""})
     returning id, status, updated_at`,
    [
      USER_A,
      REPO_1,
      overrides?.slug ?? "fix-login",
      ...(overrides?.status ? [overrides.status] : []),
    ]
  );
  return rows[0];
}

async function transitionRun(input: {
  runId: string;
  from: string;
  to: string;
  error?: string | null;
  metadataPatch?: Record<string, unknown> | null;
}): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select public.transition_orchestration_run($1, $2, $3, $4, $5) as ok`,
    [
      input.runId,
      input.from,
      input.to,
      input.error ?? null,
      input.metadataPatch ? JSON.stringify(input.metadataPatch) : null,
    ]
  );
  return rows[0].ok;
}

describe("orchestration_runs schema", () => {
  it("should default new runs to drafting_master_spec", async () => {
    const run = await insertRun();
    expect(run.status).toBe("drafting_master_spec");
  });

  it("should reject unknown statuses", async () => {
    await expect(insertRun({ status: "vibing" })).rejects.toThrow(/check/i);
  });

  it("should reject malformed slugs", async () => {
    await expect(insertRun({ slug: "Bad_Slug!" })).rejects.toThrow(/check/i);
  });

  it("should enforce slug uniqueness per repo", async () => {
    await insertRun();
    await expect(insertRun()).rejects.toThrow(/duplicate|unique/i);
  });

  it("should bump updated_at on update", async () => {
    const run = await insertRun();
    await db.query(`select pg_sleep(0.02)`);
    await db.query(
      `update public.orchestration_runs set title = 'Fix login v2' where id = $1`,
      [run.id]
    );
    const { rows } = await db.query<{ updated_at: string }>(
      `select updated_at from public.orchestration_runs where id = $1`,
      [run.id]
    );
    expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(run.updated_at).getTime()
    );
  });
});

describe("transition_orchestration_run RPC (compare-and-swap)", () => {
  it("should transition when from-status matches and report true", async () => {
    const run = await insertRun();
    const ok = await transitionRun({
      runId: run.id,
      from: "drafting_master_spec",
      to: "awaiting_master_approval",
    });
    expect(ok).toBe(true);
    const { rows } = await db.query<{ status: string }>(
      `select status from public.orchestration_runs where id = $1`,
      [run.id]
    );
    expect(rows[0].status).toBe("awaiting_master_approval");
  });

  it("should refuse a stale from-status and leave the row untouched", async () => {
    const run = await insertRun();
    const ok = await transitionRun({
      runId: run.id,
      from: "running_tasks",
      to: "integrating",
    });
    expect(ok).toBe(false);
    const { rows } = await db.query<{ status: string }>(
      `select status from public.orchestration_runs where id = $1`,
      [run.id]
    );
    expect(rows[0].status).toBe("drafting_master_spec");
  });

  it("should raise for a missing run", async () => {
    await expect(
      transitionRun({
        runId: "00000000-0000-4000-8000-0000000000ff",
        from: "drafting_master_spec",
        to: "failed",
      })
    ).rejects.toThrow(/not found/i);
  });

  it("should merge metadata patches and record errors on failure", async () => {
    const run = await insertRun();
    await db.query(
      `update public.orchestration_runs set metadata = '{"keep":1}' where id = $1`,
      [run.id]
    );
    const ok = await transitionRun({
      runId: run.id,
      from: "drafting_master_spec",
      to: "failed",
      error: "planner exploded",
      metadataPatch: { failedStep: "draft" },
    });
    expect(ok).toBe(true);
    const { rows } = await db.query<{
      error: string;
      metadata: { keep: number; failedStep: string };
    }>(`select error, metadata from public.orchestration_runs where id = $1`, [
      run.id,
    ]);
    expect(rows[0].error).toBe("planner exploded");
    expect(rows[0].metadata).toEqual({ keep: 1, failedStep: "draft" });
  });

  it("should clear the error when recovering from failed", async () => {
    const run = await insertRun({ status: "failed" });
    await db.query(
      `update public.orchestration_runs set error = 'old failure' where id = $1`,
      [run.id]
    );
    const ok = await transitionRun({
      runId: run.id,
      from: "failed",
      to: "running_tasks",
    });
    expect(ok).toBe(true);
    const { rows } = await db.query<{ error: string | null }>(
      `select error from public.orchestration_runs where id = $1`,
      [run.id]
    );
    expect(rows[0].error).toBeNull();
  });
});

describe("orchestration child tables", () => {
  async function insertSpecAndTask(runId: string): Promise<{
    specId: string;
    taskId: string;
  }> {
    const spec = await db.query<{ id: string }>(
      `insert into public.orchestration_specs
         (run_id, kind, slug, title, file_path)
       values ($1, 'task', 'part-one', 'Part one', 'specs/fix-login/tasks/1-part-one.md')
       returning id`,
      [runId]
    );
    const task = await db.query<{ id: string }>(
      `insert into public.orchestration_tasks
         (run_id, spec_id, repo_id, harness, branch_name, base_branch)
       values ($1, $2, $3, 'claude-code', 'mogplex/task/fix-login/part-one', 'main')
       returning id`,
      [runId, spec.rows[0].id, REPO_1]
    );
    return { specId: spec.rows[0].id, taskId: task.rows[0].id };
  }

  it("should cascade-delete specs, tasks, and events with the run", async () => {
    const run = await insertRun();
    const { taskId } = await insertSpecAndTask(run.id);
    await db.query(
      `insert into public.orchestration_events (run_id, task_id, type, message)
       values ($1, $2, 'task_started', 'task launched')`,
      [run.id, taskId]
    );
    await db.query(`delete from public.orchestration_runs where id = $1`, [
      run.id,
    ]);
    for (const table of [
      "orchestration_specs",
      "orchestration_tasks",
      "orchestration_events",
    ]) {
      const { rows } = await db.query<{ count: number }>(
        `select count(*)::int as count from public.${table}`
      );
      expect(rows[0].count).toBe(0);
    }
  });

  it("should stamp pushed_at exactly once when a task reaches pushed", async () => {
    const run = await insertRun();
    const { taskId } = await insertSpecAndTask(run.id);
    for (const [from, to] of [
      ["planned", "queued"],
      ["queued", "running"],
      ["running", "pushed"],
    ]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select public.transition_orchestration_task($1, $2, $3, null, null) as ok`,
        [taskId, from, to]
      );
      expect(rows[0].ok).toBe(true);
    }
    const first = await db.query<{ pushed_at: string }>(
      `select pushed_at from public.orchestration_tasks where id = $1`,
      [taskId]
    );
    expect(first.rows[0].pushed_at).not.toBeNull();

    // Round-trip through conflict and back: the original pushed_at survives.
    await db.query(`select pg_sleep(0.02)`);
    for (const [from, to] of [
      ["pushed", "conflict"],
      ["conflict", "running"],
      ["running", "pushed"],
    ]) {
      await db.query(
        `select public.transition_orchestration_task($1, $2, $3, null, null)`,
        [taskId, from, to]
      );
    }
    const second = await db.query<{ pushed_at: string }>(
      `select pushed_at from public.orchestration_tasks where id = $1`,
      [taskId]
    );
    expect(new Date(second.rows[0].pushed_at).getTime()).toBe(
      new Date(first.rows[0].pushed_at).getTime()
    );
  });

  it("should refuse stale task transitions", async () => {
    const run = await insertRun();
    const { taskId } = await insertSpecAndTask(run.id);
    const { rows } = await db.query<{ ok: boolean }>(
      `select public.transition_orchestration_task($1, 'running', 'pushed', null, null) as ok`,
      [taskId]
    );
    expect(rows[0].ok).toBe(false);
  });
});
