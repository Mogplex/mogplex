import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = [
  "neon/migrations/20260807190000_orchestration_runs.sql",
  "neon/migrations/20260809120000_orchestration_run_update.sql",
];

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const REPO_1 = "00000000-0000-4000-8000-000000000001";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  for (const migration of MIGRATIONS) {
    const sql = await readFile(path.join(REPO_ROOT, migration), "utf8");
    await db.exec(sql);
  }
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`truncate public.orchestration_runs cascade`);
});

async function insertRun(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orchestration_runs
       (user_id, repo_id, title, slug, request, base_branch, spec_branch,
        integration_branch, metadata)
     values ($1, $2, 'Fix login', 'fix-login', 'fix the login flow', 'main',
             'mogplex/spec/fix-login', 'mogplex/integrate/fix-login',
             '{"origin": "composer"}'::jsonb)
     returning id`,
    [USER_A, REPO_1]
  );
  return rows[0].id;
}

async function updateRun(input: {
  runId: string;
  userId: string;
  title?: string | null;
  approvalMode?: string | null;
  metadataPatch?: Record<string, unknown> | null;
}): Promise<boolean> {
  const { rows } = await db.query<{ update_orchestration_run: boolean }>(
    `select public.update_orchestration_run($1, $2, $3, $4, $5)`,
    [
      input.runId,
      input.userId,
      input.title ?? null,
      input.approvalMode ?? null,
      input.metadataPatch ? JSON.stringify(input.metadataPatch) : null,
    ]
  );
  return rows[0].update_orchestration_run;
}

async function readRun(runId: string) {
  const { rows } = await db.query<{
    title: string;
    approval_mode: string;
    metadata: Record<string, unknown>;
  }>(
    `select title, approval_mode, metadata
     from public.orchestration_runs where id = $1`,
    [runId]
  );
  return rows[0];
}

describe("update_orchestration_run RPC", () => {
  it("merges the metadata patch instead of replacing metadata", async () => {
    const runId = await insertRun();
    expect(
      await updateRun({
        runId,
        userId: USER_A,
        metadataPatch: { pinned: true },
      })
    ).toBe(true);
    const run = await readRun(runId);
    expect(run.metadata).toEqual({ origin: "composer", pinned: true });
  });

  it("leaves omitted fields untouched", async () => {
    const runId = await insertRun();
    expect(
      await updateRun({ runId, userId: USER_A, approvalMode: "auto_dispatch" })
    ).toBe(true);
    const run = await readRun(runId);
    expect(run.title).toBe("Fix login");
    expect(run.approval_mode).toBe("auto_dispatch");
    expect(run.metadata).toEqual({ origin: "composer" });
  });

  it("updates the title without altering the slug-derived branches", async () => {
    const runId = await insertRun();
    expect(
      await updateRun({ runId, userId: USER_A, title: "Fix login redirect" })
    ).toBe(true);
    const { rows } = await db.query<{
      title: string;
      slug: string;
      spec_branch: string;
    }>(
      `select title, slug, spec_branch
       from public.orchestration_runs where id = $1`,
      [runId]
    );
    expect(rows[0].title).toBe("Fix login redirect");
    expect(rows[0].slug).toBe("fix-login");
    expect(rows[0].spec_branch).toBe("mogplex/spec/fix-login");
  });

  it("returns false for a run owned by a different user and writes nothing", async () => {
    const runId = await insertRun();
    expect(await updateRun({ runId, userId: USER_B, title: "Hijacked" })).toBe(
      false
    );
    const run = await readRun(runId);
    expect(run.title).toBe("Fix login");
  });

  it("returns false for an unknown run id", async () => {
    expect(
      await updateRun({
        runId: "00000000-0000-4000-8000-0000000000ff",
        userId: USER_A,
        title: "Nope",
      })
    ).toBe(false);
  });
});
