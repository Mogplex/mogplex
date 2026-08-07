import { expect } from "vitest";
import type { AiCallInsert, Db } from "../harness";

export async function insertCall(
  db: Db,
  row: AiCallInsert
): Promise<Record<string, unknown>> {
  const cols = Object.keys(row) as (keyof AiCallInsert)[];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const result = await db.query<Record<string, unknown>>(
    `INSERT INTO ai_calls (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
    cols.map((c) => row[c])
  );
  return result.rows[0]!;
}

export async function selectCall(
  db: Db,
  id: string
): Promise<Record<string, unknown>> {
  const r = await db.query<Record<string, unknown>>(
    "SELECT * FROM ai_calls WHERE id = $1",
    [id]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`selectCall: no ai_calls row for id=${id}`);
  return row;
}

/**
 * Both reject helpers must only accept the specific PL/pgSQL `RAISE EXCEPTION`
 * emitted by the guard. Without the SQLSTATE check, an unrelated infra error
 * (column typo, syntax error, broken setup) whose message happened to match the
 * pattern would pass vacuously -- masking a real guard regression. The cost
 * migrations all `RAISE EXCEPTION` without ERRCODE, so the SQLSTATE is P0001
 * (raise_exception). Anything else is re-thrown so the test fails with the
 * real cause instead of silently going green.
 *
 * Shape contract -- verified at runtime: @electric-sql/pglite v0.4.5 throws a
 * `DatabaseError extends Error` with `.code` set directly on the instance
 * (see node_modules/@electric-sql/pglite/dist/index.d.ts:128). If pglite ever
 * reshaped this -- e.g. nesting under `.fields.code` -- every reject-path test
 * would fail noisily on the next upgrade rather than silently passing, because
 * `undefined !== 'P0001'` re-throws the original error to the runner. The 6
 * reject tests in this file collectively prove the contract still holds.
 *
 * Propagation contract: the `expect(...)` below throws a Vitest `AssertionError`
 * when the message doesn't match. That AssertionError is *intentionally* allowed
 * to propagate to the runner -- it is not a `DatabaseError`, so re-entering this
 * helper (e.g. via a future wrapper that catches everything) would re-throw it
 * rather than swallow it. Do not wrap this call in a try/catch that absorbs
 * assertion errors.
 */
export function assertPgRaise(err: unknown, pattern: RegExp): void {
  if (!(err instanceof Error) || (err as { code?: string }).code !== "P0001") {
    throw err;
  }
  expect(err.message).toMatch(pattern);
}

export async function expectInsertRejected(
  db: Db,
  row: AiCallInsert,
  pattern: RegExp
): Promise<void> {
  try {
    await insertCall(db, row);
  } catch (e) {
    assertPgRaise(e, pattern);
    return;
  }
  throw new Error("expected insert to be rejected");
}

export async function expectUpdateRejected(
  db: Db,
  id: string,
  set: AiCallInsert,
  pattern: RegExp
): Promise<void> {
  const cols = Object.keys(set) as (keyof AiCallInsert)[];
  const assignments = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  try {
    await db.query(`UPDATE ai_calls SET ${assignments} WHERE id = $1`, [
      id,
      ...cols.map((c) => set[c]),
    ]);
  } catch (e) {
    assertPgRaise(e, pattern);
    return;
  }
  throw new Error("expected update to be rejected");
}
