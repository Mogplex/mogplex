import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION = "neon/migrations/20260807210000_control_approvals.sql";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

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
  await db.exec(`truncate public.control_approvals`);
});

async function insertApproval(overrides?: {
  userId?: string;
  toolCallId?: string;
  expiresAt?: string;
}): Promise<{ id: string; status: string }> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `insert into public.control_approvals
       (user_id, tool_name, tool_call_id, summary${overrides?.expiresAt ? ", expires_at" : ""})
     values ($1, 'delete_file', $2, 'Delete lib/old.ts'
             ${overrides?.expiresAt ? ", $3" : ""})
     returning id, status`,
    [
      overrides?.userId ?? USER_A,
      overrides?.toolCallId ?? "call-abc",
      ...(overrides?.expiresAt ? [overrides.expiresAt] : []),
    ]
  );
  return rows[0];
}

async function resolve(input: {
  approvalId: string;
  userId?: string;
  decision?: string;
  source?: string;
}): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select public.resolve_control_approval($1, $2, $3, $4, null) as ok`,
    [
      input.approvalId,
      input.userId ?? USER_A,
      input.decision ?? "approved",
      input.source ?? "in_stream",
    ]
  );
  return rows[0].ok;
}

describe("control_approvals schema", () => {
  it("should default to pending", async () => {
    const row = await insertApproval();
    expect(row.status).toBe("pending");
  });

  it("should allow only one PENDING row per user and tool_call_id but permit re-request after resolution", async () => {
    const first = await insertApproval();
    await expect(insertApproval()).rejects.toThrow(/duplicate|unique/i);
    expect(await resolve({ approvalId: first.id, decision: "expired" })).toBe(
      true
    );
    // Same tool_call_id becomes insertable again once no pending row holds it.
    const second = await insertApproval();
    expect(second.status).toBe("pending");
  });

  it("should scope tool_call_id uniqueness per user (no cross-tenant collisions)", async () => {
    await insertApproval({ userId: USER_A });
    const other = await insertApproval({ userId: USER_B });
    expect(other.status).toBe("pending");
  });
});

describe("resolve_control_approval RPC", () => {
  it("should resolve a pending approval exactly once", async () => {
    const row = await insertApproval();
    expect(await resolve({ approvalId: row.id })).toBe(true);
    expect(await resolve({ approvalId: row.id, decision: "denied" })).toBe(
      false
    );
    const { rows } = await db.query<{
      status: string;
      resolution_source: string;
      resolved_by: string;
    }>(
      `select status, resolution_source, resolved_by
       from public.control_approvals where id = $1`,
      [row.id]
    );
    expect(rows[0].status).toBe("approved");
    expect(rows[0].resolution_source).toBe("in_stream");
    expect(rows[0].resolved_by).toBe(USER_A);
  });

  it("should refuse resolution by a different user", async () => {
    const row = await insertApproval();
    expect(await resolve({ approvalId: row.id, userId: USER_B })).toBe(false);
    const { rows } = await db.query<{ status: string }>(
      `select status from public.control_approvals where id = $1`,
      [row.id]
    );
    expect(rows[0].status).toBe("pending");
  });

  it("should refuse approve/deny after expiry but still allow marking expired", async () => {
    const row = await insertApproval({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await resolve({ approvalId: row.id, decision: "approved" })).toBe(
      false
    );
    expect(await resolve({ approvalId: row.id, decision: "expired" })).toBe(
      true
    );
  });

  it("should reject unknown decisions", async () => {
    const row = await insertApproval();
    await expect(
      resolve({ approvalId: row.id, decision: "shrugged" })
    ).rejects.toThrow(/invalid approval decision/i);
  });
});
